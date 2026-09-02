/**
 * Node-side tests for a priori (AP) decoding: src/dsp/apDecode.ts and the AP mask path through
 * src/dsp/ldpcCodec.ts.
 *
 * The twin of tests/test_ap_decode.py, and deliberately not a translation of it: this side owns
 * the message packer, so it is this side that checks the hypotheses are built out of bits a real
 * transmitter would emit. The shared callsign packing vectors are asserted from here and from
 * Python, the same arrangement crc14_vectors.json already uses.
 *
 * Every expected value is computed from the arrays under test. Nothing here asserts a recorded
 * decode count - a count written down once and asserted forever passes because it was copied.
 *
 * Run with:  npx tsx tests/apDecode.test.mjs
 */

import { readFileSync } from 'node:fs';
import {
  AP_DEEP_TYPE,
  AP_FREQ_WINDOW_HZ,
  AP_STAGE_LADDER,
  AP_TYPE_LABELS,
  AP_TYPE_MODIFIER,
  apCallsignUsable,
  buildApHypotheses,
  buildApHypothesis,
  decodeWithAp,
  describeApDecode,
  hypothesisHolds,
  withinApWindow,
} from '../src/dsp/apDecode.ts';
import {
  AP_LLR_MARGIN,
  apLlrMagnitude,
  applyApHypothesis,
  ldpcCodec,
  LDPC_MAX_ITERATIONS,
} from '../src/dsp/ldpcCodec.ts';
import {
  decodeCallsign28,
  encodeCallsign28,
  packZ30Message,
  unpackZ30Message,
  buildQsoMacros,
} from '../src/dsp/z30Codec.ts';
import { createSeededRandom } from '../src/dsp/seededRandom.ts';

let failures = 0;
let section = '';

function group(name) {
  section = name;
  console.log(`\n${name}`);
}

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok  ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${section} / ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

const MY_CALL = 'W1AW';
const DX_CALL = 'K1ABC';

/**
 * Channel LLRs for a codeword at a given noise level, from the seeded generator.
 *
 * A plain BPSK-like model rather than the real demodulator: these tests are about the decoder's
 * treatment of an AP mask, and putting the modem in front of it would make a failure ambiguous
 * between the two. `benchmark.py --ap` measures the real receive chain.
 */
function noisyLlrs(codeword, sigma, rng, amplitude = 4.0) {
  const out = new Float32Array(codeword.length);
  for (let i = 0; i < codeword.length; i++) {
    const clean = 1.0 - 2.0 * codeword[i];
    out[i] = Math.max(-25, Math.min(25, amplitude * clean + sigma * rng.normal()));
  }
  return out;
}

function payloadBitsFor(message) {
  return packZ30Message(message).infoBits.slice(0, 63);
}

// ------------------------------------------------------------------ the packer defect AP found

group('Message packing: the closing modifiers');
{
  // Building the AP ladder is what surfaced this: `/^\d+$/` matches '73', so while the numeric
  // report branch came first the `third === '73'` arm was unreachable and every sign-off was
  // packed as extraCode min(60, 73+30) = 60 - a +30 dB signal report. AP type 5 asserted a
  // message the transmitter could not produce.
  const cases = [
    ['RRR', 61],
    ['73', 62],
    ['RR73', 63],
  ];
  for (const [modifier, expectedCode] of cases) {
    const packed = packZ30Message(`${MY_CALL} ${DX_CALL} ${modifier}`);
    let extra = 0;
    for (let i = 0; i < 7; i++) extra = (extra << 1) | packed.infoBits[56 + i];
    const unpacked = unpackZ30Message(packed.infoBits);
    check(
      `'${modifier}' packs to the code the unpacker reads back as '${modifier}'`,
      extra === expectedCode && unpacked.report === modifier,
      `extra=${extra} report=${unpacked.report}`
    );
  }

  // Numeric reports must still take the report branch, so the reorder did not shadow them.
  for (const report of ['-12', '+03', '-30']) {
    const unpacked = unpackZ30Message(packZ30Message(`${MY_CALL} ${DX_CALL} ${report}`).infoBits);
    check(
      `a numeric report '${report}' still round-trips as a report`,
      unpacked.type === 'REPORT' && Number(unpacked.report) === Number(report),
      `got ${unpacked.type} ${unpacked.report}`
    );
  }

  // The Tx5 macro is the message that was being mis-packed in the field.
  const tx5 = buildQsoMacros(MY_CALL, 'FN31', DX_CALL, '-12').tx5;
  check(
    'the Tx5 sign-off macro transmits a 73, not a +30 dB report',
    unpackZ30Message(packZ30Message(tx5).infoBits).report === '73',
    tx5
  );
}

// ------------------------------------------------------------------ callsign packing vectors

group('Shared 28-bit callsign packing vectors');
{
  const doc = JSON.parse(readFileSync(new URL('./vectors/callsign_pack_vectors.json', import.meta.url), 'utf8'));
  check('the vector file carries the field width it describes', doc.field_width_bits === 28);
  check('the vector file is not empty', doc.vectors.length >= 10);

  let mismatches = 0;
  for (const v of doc.vectors) {
    const packed = encodeCallsign28(v.call);
    const unpacked = decodeCallsign28(packed);
    if (packed !== v.packed || unpacked !== v.unpacked) {
      mismatches += 1;
      console.error(`       ${v.call}: got ${packed}/${unpacked}, vector says ${v.packed}/${v.unpacked}`);
    }
    if (packed < 0 || packed > 0x0fffffff) {
      mismatches += 1;
      console.error(`       ${v.call}: packed ${packed} is outside the 28-bit field`);
    }
  }
  check('every vector packs and unpacks as recorded', mismatches === 0);

  // The round-trip flag in the file has to agree with the gate that reads it, or the AP path and
  // the vectors would disagree about which callsigns are assertable.
  let gateDisagreements = 0;
  for (const v of doc.vectors) {
    const isToken = ['CQ', 'CQ DX', 'CQ TEST', 'QRZ'].includes(v.call.trim().toUpperCase());
    const isPlaceholder = v.call.trim().toUpperCase() === 'NOCAL';
    const expected = v.round_trips && !isToken && !isPlaceholder;
    if (apCallsignUsable(v.call) !== expected) {
      gateDisagreements += 1;
      console.error(`       ${v.call}: apCallsignUsable=${apCallsignUsable(v.call)}, expected ${expected}`);
    }
  }
  check('apCallsignUsable agrees with the vectors it is derived from', gateDisagreements === 0);
}

// ------------------------------------------------------------------ the AP LLR

group('A priori LLR construction');
{
  const rng = createSeededRandom(0x4150);
  const llr = new Float32Array(216);
  for (let i = 0; i < 216; i++) llr[i] = 6.0 * rng.normal();

  let peak = 0;
  for (let i = 0; i < 216; i++) peak = Math.max(peak, Math.abs(llr[i]));
  check(
    'apLlrMagnitude is the frame peak times the margin',
    Math.abs(apLlrMagnitude(llr) - AP_LLR_MARGIN * peak) < 1e-6,
    `${apLlrMagnitude(llr)} vs ${AP_LLR_MARGIN * peak}`
  );
  check('an asserted bit outranks every measured bit', apLlrMagnitude(llr) > peak);

  const mask = new Uint8Array(216);
  for (let i = 7; i < 40; i++) mask[i] = 1;
  const bits = new Uint8Array(216);
  for (let i = 0; i < 216; i++) bits[i] = rng.next() < 0.5 ? 0 : 1;

  const out = applyApHypothesis(llr, mask, bits);
  const apmag = apLlrMagnitude(llr);
  let wrongMasked = 0;
  let touchedUnmasked = 0;
  for (let i = 0; i < 216; i++) {
    if (mask[i]) {
      const want = Math.fround(bits[i] === 0 ? apmag : -apmag);
      if (out[i] !== want) wrongMasked += 1;
    } else if (out[i] !== llr[i]) {
      touchedUnmasked += 1;
    }
  }
  check('every masked position carries the asserted LLR', wrongMasked === 0);
  check('no unmasked position was modified', touchedUnmasked === 0);

  // The sign convention: this codec decides `llr < 0 -> 1`, WSJT-X decides `zn > 0 -> 1`.
  // Transcribing its `apsym = 2*bit-1` would assert every AP bit inverted.
  for (const bit of [0, 1]) {
    const flat = new Float32Array(216).fill(3.0);
    const all = new Uint8Array(216).fill(1);
    const asserted = applyApHypothesis(flat, all, new Uint8Array(216).fill(bit));
    let wrong = 0;
    for (let i = 0; i < 216; i++) if ((asserted[i] < 0 ? 1 : 0) !== bit) wrong += 1;
    check(`asserting ${bit} produces hard decisions of ${bit}`, wrong === 0);
  }

  const zeroFrame = applyApHypothesis(new Float32Array(216), new Uint8Array(216).fill(1), new Uint8Array(216).fill(1));
  check('an all-zero frame asserts nothing rather than asserting zeroes', zeroFrame.every((v) => v === 0));
}

// ------------------------------------------------------------------ pinning

group('Pinned bits in the decoder');
{
  const rng = createSeededRandom(0x4151);
  const payload = payloadBitsFor(`${MY_CALL} ${DX_CALL} RR73`);
  const codeword = ldpcCodec.encode(payload).codeword;
  const llr = noisyLlrs(codeword, 2.0, rng);

  // Assert the OPPOSITE of the truth and require it to survive every iteration.
  const mask = new Uint8Array(216);
  const wrong = new Uint8Array(216);
  for (let i = 0; i < 28; i++) {
    mask[i] = 1;
    wrong[i] = codeword[i] ^ 1;
  }
  const apLlr = applyApHypothesis(llr, mask, wrong);
  const pinned = ldpcCodec.decodeMinSum(apLlr, LDPC_MAX_ITERATIONS, mask);
  let moved = 0;
  for (let i = 0; i < 28; i++) if (pinned.infoBits[i] !== wrong[i]) moved += 1;
  check('belief propagation cannot move a pinned bit', moved === 0, `${moved} of 28 moved`);

  // And the pre-AP path is untouched: an empty mask must decode bit-identically to no mask.
  let identical = 0;
  const idRng = createSeededRandom(0x4152);
  for (let trial = 0; trial < 6; trial++) {
    const p = new Array(63);
    for (let i = 0; i < 63; i++) p[i] = idRng.next() < 0.5 ? 0 : 1;
    const cw = ldpcCodec.encode(p).codeword;
    const noisy = noisyLlrs(cw, 4.5, idRng);
    const a = ldpcCodec.decodeMinSum(noisy);
    const b = ldpcCodec.decodeMinSum(noisy, LDPC_MAX_ITERATIONS, new Uint8Array(216));
    const same =
      a.success === b.success &&
      a.iterations === b.iterations &&
      a.syndromeWeight === b.syndromeWeight &&
      a.infoBits.every((bit, i) => bit === b.infoBits[i]);
    if (same) identical += 1;
  }
  check('an all-zero AP mask decodes bit-identically to no mask at all', identical === 6, `${identical}/6`);

  let rejected = true;
  try {
    ldpcCodec.decodeMinSum(new Float32Array(216), LDPC_MAX_ITERATIONS, new Uint8Array(217));
    rejected = false;
  } catch {
    rejected = true;
  }
  check('a mask longer than the code is refused', rejected);
}

// ------------------------------------------------------------------ the ladder

group('The hypothesis ladder');
{
  const expectations = {
    1: [28, 'CQ', null, null],
    2: [28, MY_CALL, null, null],
    3: [56, MY_CALL, DX_CALL, null],
    4: [63, MY_CALL, DX_CALL, 'RRR'],
    5: [63, MY_CALL, DX_CALL, '73'],
    6: [63, MY_CALL, DX_CALL, 'RR73'],
  };
  check(
    'every catalogued AP type has an expectation here',
    Object.keys(AP_TYPE_LABELS).sort().join(',') === Object.keys(expectations).sort().join(',')
  );

  for (const [typeStr, [bitCount, toCall, fromCall, modifier]] of Object.entries(expectations)) {
    const apType = Number(typeStr);
    const h = buildApHypothesis(apType, MY_CALL, DX_CALL);
    if (!h) {
      check(`type ${apType} builds for two standard callsigns`, false);
      continue;
    }

    let summed = 0;
    for (let i = 0; i < h.mask.length; i++) summed += h.mask[i];
    check(
      `type ${apType} asserts ${bitCount} payload bits`,
      summed === bitCount && h.assertedBitCount === summed && h.mask.length === 63,
      `mask sums to ${summed}, reports ${h.assertedBitCount}, length ${h.mask.length}`
    );

    // Decode the assertion back through the message codec: the mask and the label cannot drift.
    const asInfo = [...h.bits, ...new Array(14).fill(0)];
    const unpacked = unpackZ30Message(asInfo);
    const assertedTo = unpacked.callTo === undefined ? 'CQ' : unpacked.callTo;
    check(`type ${apType} asserts destination ${toCall}`, assertedTo === toCall, assertedTo);
    if (fromCall !== null) {
      check(`type ${apType} asserts source ${fromCall}`, unpacked.callFrom === fromCall, unpacked.callFrom);
    }
    if (modifier !== null) {
      check(
        `type ${apType} asserts the ${modifier} modifier`,
        unpacked.report === modifier && AP_TYPE_MODIFIER[apType] === modifier,
        `${unpacked.report}`
      );
    }
  }

  const counts = {};
  for (const t of Object.keys(AP_TYPE_LABELS)) counts[t] = buildApHypothesis(Number(t), MY_CALL, DX_CALL).assertedBitCount;
  check(
    'the ladder is ordered by how much it claims',
    counts[1] === counts[2] && counts[2] < counts[3] && counts[3] < counts[4] &&
      counts[4] === counts[5] && counts[5] === counts[6],
    JSON.stringify(counts)
  );

  // Types 1 and 2 differ only in WHICH destination they assert, so they must not be the same bits.
  const cq = buildApHypothesis(1, MY_CALL, DX_CALL);
  const mine = buildApHypothesis(2, MY_CALL, DX_CALL);
  let differs = false;
  for (let i = 0; i < 28; i++) if (cq.bits[i] !== mine.bits[i]) differs = true;
  check('the CQ hypothesis and the MyCall hypothesis assert different destinations', differs);

  // The CQ variant is selectable, exactly as WSJT-X selects mcq vs mcqtest by contest mode.
  const cqDx = buildApHypothesis(1, MY_CALL, DX_CALL, 'CQ DX');
  let variantDiffers = false;
  for (let i = 0; i < 28; i++) if (cqDx.bits[i] !== cq.bits[i]) variantDiffers = true;
  check("'CQ DX' asserts different bits from 'CQ'", variantDiffers);
}

group('Gates on the ladder');
{
  for (const bad of ['', 'NOCAL', 'W1AW/P', 'EA8/G4XYZ', '3DA0RS']) {
    check(`${bad || '(empty)'} is not assertable`, !apCallsignUsable(bad));
    check(`type 2 refuses ${bad || '(empty)'} as my callsign`, buildApHypothesis(2, bad, DX_CALL) === null);
    check(`type 3 refuses ${bad || '(empty)'} as the DX callsign`, buildApHypothesis(3, MY_CALL, bad) === null);
  }
  check('a standard callsign IS assertable', apCallsignUsable(MY_CALL) && buildApHypothesis(3, MY_CALL, DX_CALL) !== null);
  check('a CQ hypothesis needs no callsign at all', buildApHypothesis(1, '', '') !== null);

  // The frequency window, measured at both its edges so the constant governs both assertions.
  const worked = 1500;
  const inside = buildApHypotheses(
    { stage: 'SENDING_REPORT', myCall: MY_CALL, dxCall: DX_CALL, rxFreqHz: worked },
    worked + AP_FREQ_WINDOW_HZ - 1
  );
  const outside = buildApHypotheses(
    { stage: 'SENDING_REPORT', myCall: MY_CALL, dxCall: DX_CALL, rxFreqHz: worked },
    worked + AP_FREQ_WINDOW_HZ + 1
  );
  check('deep types are permitted inside the window', inside.some((h) => h.apType >= AP_DEEP_TYPE));
  check('deep types are refused outside the window', !outside.some((h) => h.apType >= AP_DEEP_TYPE));
  check(
    'a split station is near either of the two frequencies it works',
    withinApWindow(2400, [1000, 2400]) && !withinApWindow(2400, [1000, 1800])
  );
  check('no candidate frequency means the gate does not fire', withinApWindow(undefined, [1000]));
  check('no worked frequency means the gate does not fire', withinApWindow(2400, []));

  const shallowFar = buildApHypotheses(
    { stage: 'IDLE', myCall: MY_CALL, dxCall: DX_CALL, rxFreqHz: 2900 },
    250
  );
  check(
    'shallow types are permitted right across the passband',
    shallowFar.map((h) => h.apType).join(',') === '1,2',
    shallowFar.map((h) => h.apType).join(',')
  );

  const unknownStage = buildApHypotheses({ stage: 'SOME_FUTURE_STAGE', myCall: MY_CALL, dxCall: DX_CALL });
  check('an unrecognised QSO stage produces no hypotheses', unknownStage.length === 0);

  let ladderOk = true;
  for (const [stage, ladder] of Object.entries(AP_STAGE_LADDER)) {
    if (ladder.length === 0) ladderOk = false;
    if (new Set(ladder).size !== ladder.length) ladderOk = false;
    for (const t of ladder) if (!AP_TYPE_LABELS[t]) ladderOk = false;
    if (!ladderOk) console.error(`       stage ${stage}: ${JSON.stringify(ladder)}`);
  }
  check('every stage ladder is non-empty, duplicate-free and names known types', ladderOk);
}

// ------------------------------------------------------------------ end to end

group('Decoding with a priori information');
{
  const truthMessage = `${MY_CALL} ${DX_CALL} RR73`;
  const payload = payloadBitsFor(truthMessage);
  const codeword = ldpcCodec.encode(payload).codeword;
  const hypotheses = buildApHypotheses({ stage: 'SENDING_REPORT', myCall: MY_CALL, dxCall: DX_CALL });
  check('the SENDING_REPORT ladder is populated', hypotheses.length === AP_STAGE_LADDER.SENDING_REPORT.length);

  const rng = createSeededRandom(0x4153);
  let onlyAp = 0;
  let onlyPlain = 0;
  let lostAnAgreement = 0;
  for (let trial = 0; trial < 24; trial++) {
    const llr = noisyLlrs(codeword, 4.4, rng);
    const plain = ldpcCodec.decodeMinSum(llr);
    const plainCorrect = plain.success && plain.crcValid && payload.every((b, i) => plain.infoBits[i] === b);

    const ap = decodeWithAp(llr, hypotheses);
    const apCorrect =
      ap.result.success && ap.result.crcValid && payload.every((b, i) => ap.result.infoBits[i] === b);

    if (apCorrect && !plainCorrect) onlyAp += 1;
    if (plainCorrect && !apCorrect) onlyPlain += 1;
    if (plainCorrect && ap.apType !== 0) lostAnAgreement += 1;
  }
  check('AP never loses a frame the ordinary decoder found', onlyPlain === 0, `${onlyPlain} lost`);
  check('a frame that decodes on its own is not tagged as AP', lostAnAgreement === 0);
  check('AP recovers frames the ordinary decoder loses', onlyAp > 0, `${onlyAp} recovered of 24`);

  // A hypothesis naming other stations must be rejected by the CRC, every time.
  const liar = buildApHypothesis(3, 'G0ABC', 'VK2DEF');
  const liarRng = createSeededRandom(0x4154);
  let falseAccepts = 0;
  for (let trial = 0; trial < 20; trial++) {
    const llr = noisyLlrs(codeword, 4.2, liarRng);
    const out = decodeWithAp(llr, [liar]);
    if (out.apType !== 0) falseAccepts += 1;
  }
  check('a hypothesis naming other stations is never accepted', falseAccepts === 0, `${falseAccepts}`);

  // Determinism: schedule 4's dither is derived from the LLR vector, and AP hands it a rewritten
  // one, so this asserts the derivation still holds when the input has been asserted over.
  const detRng = createSeededRandom(0x4155);
  let stable = 0;
  for (let trial = 0; trial < 5; trial++) {
    const llr = noisyLlrs(codeword, 4.6, detRng);
    const a = decodeWithAp(llr, hypotheses);
    const b = decodeWithAp(llr, hypotheses);
    if (
      a.result.success === b.result.success &&
      a.apType === b.apType &&
      a.result.iterations === b.result.iterations &&
      a.result.infoBits.every((bit, i) => bit === b.result.infoBits[i])
    ) {
      stable += 1;
    }
  }
  check('the AP decode is a pure function of its input', stable === 5, `${stable}/5`);

  // With no hypotheses at all, decodeWithAp must be exactly one plain decode.
  const bareRng = createSeededRandom(0x4156);
  const bareLlr = noisyLlrs(codeword, 4.0, bareRng);
  const bare = decodeWithAp(bareLlr, []);
  const reference = ldpcCodec.decodeMinSum(bareLlr);
  check(
    'no hypotheses means one ordinary decode and nothing else',
    bare.apType === 0 &&
      bare.hypothesesTried === 0 &&
      bare.result.success === reference.success &&
      bare.result.iterations === reference.iterations &&
      bare.result.infoBits.every((b, i) => b === reference.infoBits[i])
  );
}

group('Guards and reporting');
{
  const h = buildApHypothesis(3, MY_CALL, DX_CALL);
  const truth = payloadBitsFor(`${MY_CALL} ${DX_CALL} 73`);
  check('an intact payload satisfies its hypothesis', hypothesisHolds(truth, h));

  let caught = 0;
  for (const flip of [0, 13, 27, 28, 55]) {
    const tampered = [...truth];
    tampered[flip] ^= 1;
    if (!hypothesisHolds(tampered, h)) caught += 1;
  }
  check('a flipped asserted bit is caught', caught === 5, `${caught}/5`);

  const free = [...truth];
  free[60] ^= 1;
  check('a bit outside the assertion is not the hypothesis’s business', hypothesisHolds(free, h));
  check('a short payload cannot satisfy a hypothesis', !hypothesisHolds([0, 1, 0], h));

  for (const apType of Object.keys(AP_TYPE_LABELS).map(Number)) {
    const outcome = { result: { success: true }, apType, apLabel: AP_TYPE_LABELS[apType], hypothesesTried: 1 };
    check(`an a${apType} decode is labelled a${apType}`, describeApDecode(outcome) === `a${apType}`);
  }
  check(
    'an ordinary decode carries no AP label',
    describeApDecode({ result: { success: true }, apType: 0, apLabel: '', hypothesesTried: 0 }) === ''
  );
  check(
    'a failed decode carries no AP label',
    describeApDecode({ result: { success: false }, apType: 3, apLabel: 'x', hypothesesTried: 4 }) === ''
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll a priori decoding checks passed.');
