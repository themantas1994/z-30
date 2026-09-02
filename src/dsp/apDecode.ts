/**
 * z-30 a priori (AP) decoding - the hypothesis ladder and the constrained decode.
 * ==============================================================================
 *
 * The TypeScript twin of `z30_dsp/ap_decode.py`. That file carries the full rationale, the
 * provenance of every constant, and the honest statement of what AP costs in false-accept
 * probability; read it first. Both halves are pinned against each other by
 * `tests/test_cross_language_parity.py`.
 *
 * The one thing this side does differently, and does better: it derives its asserted bits by
 * packing a real message through `packZ30Message` and reading the bits back out. That is
 * WSJT-X's `ft8apset` exactly - pack a dummy standard message, unpack it, and refuse to supply
 * any a priori symbols unless the round trip is exact. The Python side has no message
 * tokenizer (the grid table lives here alone, deliberately - see `z30_dsp/message_codec.py`)
 * and builds the same bits field by field.
 *
 * The benefit of doing it through the real packer is that the assertion cannot describe a frame
 * the transmitter would not produce. If `packZ30Message` ever changed how it encodes `RR73`,
 * the hypothesis would change with it, in the same commit, without anyone remembering to.
 */

import { QsoStage } from '../types/z30';
import { ldpcCodec, applyApHypothesis, LdpcDecodeResult, LDPC_MAX_ITERATIONS } from './ldpcCodec';
import { decodeCallsign28, encodeCallsign28, packZ30Message } from './z30Codec';
import { PLACEHOLDER_CALLSIGN } from './z30Constants';

/**
 * Half-width, in Hz, of the window around the worked frequency inside which the deep AP
 * hypotheses (types 3 and up) are permitted.
 *
 * WSJT-X sets `napwid=75` in `lib/jt9.f90` and applies it as
 * `abs(f1-nfqso).gt.napwid .and. abs(f1-nftx).gt.napwid` - the candidate has to be near either
 * the receive frequency or the transmit frequency. z-30 occupies the same 50 Hz an FT8 signal
 * does, so the number ports across unchanged: it is one signal width either side of the carrier
 * the operator is actually working.
 *
 * The twin of `AP_FREQ_WINDOW_HZ` in z30_dsp/ap_decode.py.
 */
export const AP_FREQ_WINDOW_HZ = 75.0;

/**
 * The lowest AP type that asserts more than one field, and so the lowest one the frequency
 * window applies to. Types 1 and 2 assert 28 bits and are cheap enough to try passband-wide,
 * which is what lets a CQ or a call to you be dug out of a corner you were not watching.
 */
export const AP_DEEP_TYPE = 3;

/** Payload width in bits. The AP mask never reaches the 14 CRC bits or the 139 parity bits. */
const PAYLOAD_BITS = 63;

/**
 * The AP hypothesis catalogue, adapted from the `iaptype` table in WSJT-X's `lib/ft8/ft8b.f90`.
 * See `z30_dsp/ap_decode.py` for the table and for why types 4-6 leave the CRC free.
 */
export const AP_TYPE_LABELS: Readonly<Record<number, string>> = {
  1: 'CQ ??? ???',
  2: 'MyCall ??? ???',
  3: 'MyCall DxCall ???',
  4: 'MyCall DxCall RRR',
  5: 'MyCall DxCall 73',
  6: 'MyCall DxCall RR73',
};

/** The message modifier each closing hypothesis asserts, as `packZ30Message` spells it. */
export const AP_TYPE_MODIFIER: Readonly<Record<number, string>> = {
  4: 'RRR',
  5: '73',
  6: 'RR73',
};

/**
 * QSO stage -> the AP types to try, in order.
 *
 * The twin of WSJT-X's `naptypes(nQSOProgress,1:4)` table, mapped onto z-30's `QsoStage` union.
 * The orderings are WSJT-X's, stage for stage. The twin of `AP_STAGE_LADDER` in
 * z30_dsp/ap_decode.py.
 */
export const AP_STAGE_LADDER: Readonly<Record<QsoStage, readonly number[]>> = {
  IDLE: [1, 2],
  CALLING_CQ: [1, 2],
  REPLYING_CQ: [2, 3],
  SENDING_REPORT: [3, 4, 5, 6],
  SENDING_R_REPORT: [3, 4, 5, 6],
  SENDING_73: [3, 1, 2],
  QSO_COMPLETED: [1, 2],
};

/** One assertion about a frame's 63 payload bits. */
export interface ApHypothesis {
  apType: number;
  label: string;
  /** The message the assertion describes, as `packZ30Message` would be given it. */
  sourceMessage: string;
  /** 63 entries: 1 where the bit is asserted. */
  mask: Uint8Array;
  /** 63 entries: the asserted values, meaningful only where `mask` is 1. */
  bits: Uint8Array;
  /** How many of the 63 payload bits this hypothesis claims to know. */
  assertedBitCount: number;
}

/** Everything a live receiver knows that could constrain a frame. */
export interface ApContext {
  /** Where the QSO state machine currently is. */
  stage: QsoStage;
  myCall: string;
  dxCall: string;
  /** The CQ variant this station calls with - `packZ30Message` encodes 'CQ' and 'CQ DX' apart. */
  cqToken?: string;
  /** The receive and transmit audio carriers the operator is working, for the frequency gate. */
  rxFreqHz?: number;
  txFreqHz?: number;
}

/** What `decodeWithAp` made of one frame. */
export interface ApDecodeOutcome {
  result: LdpcDecodeResult;
  /** 0 for a frame that decoded on its own; otherwise the hypothesis that recovered it. */
  apType: number;
  apLabel: string;
  hypothesesTried: number;
}

/**
 * Whether a callsign may be asserted as a priori knowledge.
 *
 * The z-30 equivalent of the `msg.eq.msgchk` test WSJT-X's `ft8apset` performs. A callsign that
 * does not survive the 28-bit packing - a portable prefix, a `/P` suffix, a special event call -
 * packs to an integer that unpacks to something else, so asserting those bits would assert a
 * callsign nobody transmitted and every hypothesis built on it is guaranteed wrong. The
 * placeholder is rejected for a different reason: it is what Station Settings holds before the
 * operator has entered anything, so it is a default rather than knowledge.
 */
export function apCallsignUsable(call: string): boolean {
  const clean = (call || '').trim().toUpperCase();
  if (!clean || clean === PLACEHOLDER_CALLSIGN) return false;
  if (clean === 'CQ' || clean === 'CQ DX' || clean === 'CQ TEST' || clean === 'QRZ') return false;
  return decodeCallsign28(encodeCallsign28(clean)) === clean;
}

/**
 * The 63 payload bits `packZ30Message` produces for a message, or null if it will not round-trip.
 *
 * `ft8apset`'s structure: pack, unpack, and only trust the bits if what comes back is what went
 * in. The check is against the packed integers rather than the message text, because the text
 * carries a grid that the 7-bit field compresses lossily - and the grid is never asserted by any
 * hypothesis here, so its compression is not the AP path's business.
 */
function packedPayloadBits(callTo: string, callFrom: string, modifier: string): Uint8Array | null {
  const packed = packZ30Message(`${callTo} ${callFrom} ${modifier}`.trim());
  const bits = new Uint8Array(PAYLOAD_BITS);
  for (let i = 0; i < PAYLOAD_BITS; i++) bits[i] = packed.infoBits[i] & 1;

  let numTo = 0;
  for (let i = 0; i < 28; i++) numTo = (numTo << 1) | bits[i];
  let numFrom = 0;
  for (let i = 0; i < 28; i++) numFrom = (numFrom << 1) | bits[28 + i];

  if (numTo !== encodeCallsign28(callTo) || numFrom !== encodeCallsign28(callFrom)) return null;
  return bits;
}

/** Marks `[offset, offset+width)` of a fresh mask. */
function maskRange(...ranges: Array<[number, number]>): Uint8Array {
  const mask = new Uint8Array(PAYLOAD_BITS);
  for (const [offset, width] of ranges) {
    for (let i = offset; i < offset + width; i++) mask[i] = 1;
  }
  return mask;
}

/**
 * The hypothesis for one AP type, or null when the station data cannot support it.
 *
 * Returns null rather than a weaker hypothesis, matching WSJT-X's
 * `if(iaptype.ge.2 .and. apsym(1).gt.1) cycle` and `if(iaptype.ge.3 .and. apsym(30).gt.1) cycle`.
 */
export function buildApHypothesis(
  apType: number,
  myCall: string,
  dxCall: string,
  cqToken: string = 'CQ'
): ApHypothesis | null {
  const label = AP_TYPE_LABELS[apType];
  if (!label) throw new Error(`unknown AP type ${apType}`);

  const my = (myCall || '').trim().toUpperCase();
  const dx = (dxCall || '').trim().toUpperCase();

  if (apType === 1) {
    // Only the destination field is asserted; the calling station and its grid stay unknown, so
    // the message packed here supplies them only as carriers for the bits that ARE asserted.
    const bits = packedPayloadBits(cqToken, my || 'W1AW', 'FN31');
    if (!bits) return null;
    return finishHypothesis(apType, label, `${cqToken} ??? ???`, maskRange([0, 28]), bits);
  }

  if (!apCallsignUsable(my)) return null;

  if (apType === 2) {
    const bits = packedPayloadBits(my, my, 'FN31');
    if (!bits) return null;
    return finishHypothesis(apType, label, `${my} ??? ???`, maskRange([0, 28]), bits);
  }

  if (!apCallsignUsable(dx)) return null;

  if (apType === 3) {
    const bits = packedPayloadBits(my, dx, 'FN31');
    if (!bits) return null;
    return finishHypothesis(apType, label, `${my} ${dx} ???`, maskRange([0, 28], [28, 28]), bits);
  }

  const modifier = AP_TYPE_MODIFIER[apType];
  if (!modifier) return null;
  const bits = packedPayloadBits(my, dx, modifier);
  if (!bits) return null;
  return finishHypothesis(
    apType,
    label,
    `${my} ${dx} ${modifier}`,
    maskRange([0, 28], [28, 28], [56, 7]),
    bits
  );
}

function finishHypothesis(
  apType: number,
  label: string,
  sourceMessage: string,
  mask: Uint8Array,
  bits: Uint8Array
): ApHypothesis {
  let assertedBitCount = 0;
  for (let i = 0; i < mask.length; i++) assertedBitCount += mask[i];
  return { apType, label, sourceMessage, mask, bits, assertedBitCount };
}

/**
 * Whether a candidate is close enough to a worked frequency for the deep hypotheses.
 *
 * No candidate frequency, or no worked frequency to compare it against, means the gate cannot be
 * evaluated and does not fire - see the note on the Python twin.
 */
export function withinApWindow(
  candidateFreqHz: number | undefined,
  workedFreqsHz: Array<number | undefined>
): boolean {
  if (candidateFreqHz === undefined || !Number.isFinite(candidateFreqHz)) return true;
  const usable = workedFreqsHz.filter(
    (f): f is number => typeof f === 'number' && Number.isFinite(f) && f > 0
  );
  if (usable.length === 0) return true;
  return usable.some((f) => Math.abs(candidateFreqHz - f) <= AP_FREQ_WINDOW_HZ);
}

/**
 * The ordered hypothesis ladder for a candidate, already filtered by the gates.
 *
 * An unrecognised stage yields no hypotheses. AP is an optimisation, and a state machine that
 * has grown a stage nobody wrote a ladder for should decode exactly as it did before, not guess.
 */
export function buildApHypotheses(ctx: ApContext, candidateFreqHz?: number): ApHypothesis[] {
  const ladder = AP_STAGE_LADDER[ctx.stage];
  if (!ladder) return [];

  const nearWorked = withinApWindow(candidateFreqHz, [ctx.rxFreqHz, ctx.txFreqHz]);
  const out: ApHypothesis[] = [];
  for (const apType of ladder) {
    if (apType >= AP_DEEP_TYPE && !nearWorked) continue;
    const hypothesis = buildApHypothesis(apType, ctx.myCall, ctx.dxCall, ctx.cqToken || 'CQ');
    if (hypothesis) out.push(hypothesis);
  }
  return out;
}

/**
 * Whether a decoded payload really carries what the hypothesis asserted.
 *
 * Pinning is supposed to make this impossible to fail. It is checked anyway because the
 * consequence of it ever becoming possible - a decoder change, a mask off by one field - is a
 * frame shown to the operator and written to the log under a callsign that was assumed rather
 * than received.
 */
export function hypothesisHolds(infoBits: number[], hypothesis: ApHypothesis): boolean {
  if (infoBits.length < PAYLOAD_BITS) return false;
  for (let i = 0; i < PAYLOAD_BITS; i++) {
    if (hypothesis.mask[i] && (infoBits[i] & 1) !== hypothesis.bits[i]) return false;
  }
  return true;
}

/**
 * An ordinary decode, and then - only if it failed - each hypothesis in turn.
 *
 * The ordering is the whole safety argument. A frame that decodes on its own is returned by the
 * same code path it always was, with `apType: 0`, having been through no AP machinery at all; AP
 * can therefore add decodes but cannot change or lose one. That is WSJT-X's structure too, where
 * AP occupies passes 4 onwards and passes 1-3 are the ordinary ones.
 */
export function decodeWithAp(
  llrChannel: Float32Array | number[],
  hypotheses: readonly ApHypothesis[] = [],
  maxIterations: number = LDPC_MAX_ITERATIONS
): ApDecodeOutcome {
  const plain = ldpcCodec.decodeMinSum(llrChannel, maxIterations);
  if (plain.success && plain.crcValid) {
    return { result: plain, apType: 0, apLabel: '', hypothesesTried: 0 };
  }

  let totalIterations = plain.iterations;
  for (let i = 0; i < hypotheses.length; i++) {
    const hypothesis = hypotheses[i];
    const apLlrs = applyApHypothesis(llrChannel, hypothesis.mask, hypothesis.bits);
    const attempt = ldpcCodec.decodeMinSum(apLlrs, maxIterations, hypothesis.mask);
    totalIterations += attempt.iterations;
    if (attempt.success && attempt.crcValid && hypothesisHolds(attempt.infoBits, hypothesis)) {
      return {
        result: { ...attempt, iterations: totalIterations },
        apType: hypothesis.apType,
        apLabel: hypothesis.label,
        hypothesesTried: i + 1,
      };
    }
  }

  return {
    result: { ...plain, iterations: totalIterations },
    apType: 0,
    apLabel: '',
    hypothesesTried: hypotheses.length,
  };
}

/**
 * A short operator-facing tag for a decode, or the empty string for an ordinary one.
 *
 * WSJT-X prints `iaptype` next to each decode for a reason: a frame recovered by assuming your
 * own callsign was in it is a weaker claim than one decoded from the air alone, and an operator
 * logging a contact is entitled to know which they are looking at.
 */
export function describeApDecode(outcome: ApDecodeOutcome): string {
  if (!outcome.result.success || outcome.apType === 0) return '';
  return `a${outcome.apType}`;
}
