/**
 * Regression guards for closed-loop rig state - the WSJT-X readback model.
 *
 * The defect these defend is the one AGENTS.md section 4 exists for and that no test could see
 * before: the transmit gate validating a band segment against a dial the RADIO IS NOT ON. Every
 * check in canTransmit() reasoned about `currentFreqHz`, which setFreqHz() assigns from its own
 * argument before anything reaches the wire and never revises - so a refused `set_freq`, a rig
 * switched off mid-session, or an operator turning the VFO by hand left the gate approving a
 * frequency that had stopped being true, and then keying the transmitter on it.
 *
 * Ported from WSJT-X's Transceiver/PollingTransceiver.cpp and TransceiverBase.cpp. Each group
 * below names the behaviour it is holding to, because two of them look like bugs if you do not
 * know why they are there: the tracker must NOT refuse on an unverified rig, and it must NOT
 * refuse over a difference the rig's own tuning resolution accounts for.
 *
 * Run with:  npx tsx tests/rigReadback.test.mjs
 */

import {
  RigStateTracker,
  POLLS_TO_STABILIZE,
  PTT_SETTLE_MS,
  READING_STALE_AFTER_MS,
  dialAgrees,
  describeRigResolution,
  resolutionErrorBoundsHz,
  resolutionStepHz,
} from '../src/dsp/rigStateTracker.ts';
import { CatController } from '../src/dsp/catController.ts';
import { DEFAULT_STATION_CONFIG } from '../src/dsp/z30Constants.ts';

let failures = 0;
let section = '';

function group(name) {
  section = name;
  console.log(name);
}

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok  ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${section} / ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

/** A configured, licensed station on 20 m - everything the gate wants except a verified dial. */
const STATION = {
  ...DEFAULT_STATION_CONFIG,
  myCall: 'K1ABC',
  regulatoryRegion: 'US',
  licenseClass: 'US_EXTRA',
};

const T0 = 1_700_000_000_000; // a fixed epoch, so nothing here depends on the wall clock

// ------------------------------------------------------- R1: a settled rig that disagrees

group('A rig that reports a different dial blocks transmit');

{
  const t = new RigStateTracker();
  t.noteRequestedDial(14_076_000);
  // The rig is on 40 m; the app thinks it is on 20 m. Give it every retry it is owed.
  for (let i = 0; i < POLLS_TO_STABILIZE; i += 1) {
    t.observe({ dialHz: 7_074_000 }, T0 + i * 1000);
  }
  const now = T0 + POLLS_TO_STABILIZE * 1000;
  check('the tracker settles after its retries are spent', t.isStable());
  const mismatch = t.dialDisagreement(14_076_000, now);
  check('a settled disagreement is reported', mismatch !== null);
  check('...with the frequency the radio actually reported', mismatch && mismatch.reportedHz === 7_074_000);
  check('...and the size of the error', mismatch && mismatch.errorHz === 7_074_000 - 14_076_000);
  check(
    'the verified dial is the RIG\'s, never the commanded one',
    t.verifiedDialHz(now) === 7_074_000
  );
}

// ------------------------------------------- R2: no readback is "unverified", not "wrong"

group('An unverifiable rig is not a refusal');

{
  // The common case by a wide margin: Direct Serial (no response parser in this app), a
  // VOX-keyed station with no CAT link, or a page with no native server behind it. A gate that
  // refused all of these would be switched off by the first operator who met it.
  const t = new RigStateTracker();
  t.noteRequestedDial(14_076_000);
  check('a tracker that has never heard from a rig reports no disagreement', t.dialDisagreement(14_076_000, T0) === null);
  check('...and offers no verified dial', t.verifiedDialHz(T0) === null);
  check('...and is not online', t.isOnline() === false);
}

{
  // A rig that WAS heard from and then went quiet must stop vouching for itself.
  const t = new RigStateTracker();
  t.noteRequestedDial(14_076_000);
  t.observe({ dialHz: 14_076_000 }, T0);
  check('a fresh reading is fresh', t.hasFreshReading(T0 + 1000));
  check(
    'a reading older than the staleness limit is not evidence',
    t.hasFreshReading(T0 + READING_STALE_AFTER_MS + 1) === false
  );
  check(
    'a stale reading yields no verified dial',
    t.verifiedDialHz(T0 + READING_STALE_AFTER_MS + 1) === null
  );
  check(
    'a stale reading raises no disagreement either',
    t.dialDisagreement(7_074_000, T0 + READING_STALE_AFTER_MS + 1) === null
  );
}

{
  // goOffline is WSJT-X's offline(): the readings it discards must not survive it.
  const t = new RigStateTracker();
  t.noteRequestedDial(14_076_000);
  t.observe({ dialHz: 7_074_000 }, T0);
  t.goOffline('relay unreachable');
  check('going offline discards the last reading', t.verifiedDialHz(T0) === null);
  check('...so it cannot go on contradicting the commanded dial', t.dialDisagreement(14_076_000, T0) === null);
  check('...and the reason is kept for the log', t.snapshot().offlineReason === 'relay unreachable');
}

// --------------------------------------------------- R3: polls_to_stabilize (WSJT-X's rule)

group('A QSY in flight is not a disagreement');

{
  // PollingTransceiver.hpp: some rigs do not update immediately after a state change, and a
  // poll taken during one returns the wrong frequency. Refusing on that reading would refuse
  // the very slot the QSY was made for.
  const t = new RigStateTracker();
  t.observe({ dialHz: 7_074_000 }, T0);
  t.noteRequestedDial(14_076_000); // operator changes band
  t.observe({ dialHz: 7_074_000 }, T0 + 1000); // poll crossed with the command
  check('the rig is not yet settled', t.isStable() === false);
  check(
    'an unsettled rig raises no disagreement, however far off it reads',
    t.dialDisagreement(14_076_000, T0 + 1000) === null
  );

  t.observe({ dialHz: 14_076_000 }, T0 + 2000); // the QSY lands
  check('arriving at the requested dial settles the rig immediately', t.isStable());
  check('...with no disagreement', t.dialDisagreement(14_076_000, T0 + 2000) === null);
}

{
  // ...but the grace is finite. A rig that never gets there is a rig that is somewhere else.
  const t = new RigStateTracker();
  t.noteRequestedDial(14_076_000);
  for (let i = 0; i < POLLS_TO_STABILIZE; i += 1) {
    t.observe({ dialHz: 7_074_000 }, T0 + i * 1000);
  }
  check(
    `the grace runs out after ${POLLS_TO_STABILIZE} polls, not forever`,
    t.dialDisagreement(14_076_000, T0 + POLLS_TO_STABILIZE * 1000) !== null
  );
}

// ------------------------------------------------------- R4: measured tuning resolution

group('Rig tuning resolution is honoured, not assumed');

{
  check('1 Hz is the strict default', resolutionStepHz(0) === 1 && describeRigResolution(0) === '1 Hz');
  check('WSJT-X code 1 is 10 Hz rounded', resolutionStepHz(1) === 10 && describeRigResolution(1) === '10 Hz rounded');
  check('WSJT-X code -1 is 10 Hz truncated', describeRigResolution(-1) === '10 Hz truncated');
  check('WSJT-X code -2 is 20 Hz truncated', resolutionStepHz(-2) === 20 && describeRigResolution(-2) === '20 Hz truncated');
  check('WSJT-X code -3 is 100 Hz truncated', resolutionStepHz(-3) === 100 && describeRigResolution(-3) === '100 Hz truncated');

  // Truncation is one-sided: a rig that drops the remainder only ever lands LOW. Granting the
  // same slack upwards would widen the band-edge check for nothing.
  const truncated = resolutionErrorBoundsHz(-3);
  check('a truncating rig is allowed to land low only', truncated.belowHz === 99 && truncated.aboveHz === 0);
  const rounded = resolutionErrorBoundsHz(3);
  check('a rounding rig is allowed half a step either way', rounded.belowHz === 50 && rounded.aboveHz === 50);
}

{
  const t = new RigStateTracker();
  t.setResolution(-1); // 10 Hz truncated - an ordinary rig, behaving exactly as designed
  t.noteRequestedDial(14_076_005);
  t.observe({ dialHz: 14_076_000 }, T0);
  check(
    'a 10 Hz rig truncating 5 Hz off the commanded dial is NOT a disagreement',
    t.dialDisagreement(14_076_005, T0) === null
  );
  check('...and the rig counts as settled, because it obeyed', t.isStable());
}

{
  const t = new RigStateTracker();
  t.setResolution(-1);
  t.noteRequestedDial(14_076_000);
  for (let i = 0; i < POLLS_TO_STABILIZE; i += 1) t.observe({ dialHz: 14_078_000 }, T0 + i * 1000);
  check(
    'a 2 kHz error is still a disagreement on a 10 Hz rig',
    t.dialDisagreement(14_076_000, T0 + 3000) !== null
  );
  check(
    'exact agreement passes at 1 Hz resolution',
    dialAgrees(14_076_000, 14_076_000, 0) === true
  );
  check(
    'a 55 Hz error does not pass at 1 Hz resolution',
    dialAgrees(14_076_000, 14_075_945, 0) === false
  );
}

// ------------------------------------------------ R5: the Tx/Rx settle window

group('CAT traffic is held off across a PTT transition');

{
  // TransceiverBase::set sleeps 100 ms after every PTT change: "some rigs cannot process CAT
  // commands while switching from Tx to Rx". A readback poll is CAT traffic like any other.
  const t = new RigStateTracker();
  check('no window before anything has been keyed', t.inPttSettleWindow(T0) === false);
  t.noteRequestedPtt(true, T0);
  check('keying opens the window', t.inPttSettleWindow(T0 + 1));
  check('...for the documented duration', t.pttSettleRemainingMs(T0 + 1) === PTT_SETTLE_MS - 1);
  check('...and it closes', t.inPttSettleWindow(T0 + PTT_SETTLE_MS) === false);
  t.noteRequestedPtt(false, T0 + 5000);
  check('unkeying opens it again - the Tx-to-Rx direction is the one the comment names', t.inPttSettleWindow(T0 + 5001));
}

// -------------------------------------------- R6: the gate itself, end to end

group('canTransmit refuses a dial the radio contradicts');

{
  const rig = new CatController();
  const baseline = rig.canTransmit(STATION, 1500, 14_076_000);
  check('a configured station on 20 m may transmit', baseline.allowed === true, JSON.stringify(baseline.violations));

  // Now let the radio say otherwise, with every retry spent.
  for (let i = 0; i < POLLS_TO_STABILIZE + 1; i += 1) {
    rig.rigState.observe({ dialHz: 7_074_000 });
  }
  const refused = rig.canTransmit(STATION, 1500, 14_076_000);
  check('the same station is refused once the rig reports a different dial', refused.allowed === false);
  check(
    '...and the refusal names both frequencies',
    refused.violations.some((v) => v.includes('7.074000') && v.includes('14.076000')),
    JSON.stringify(refused.violations)
  );
}

{
  // The safety property that matters most here is that this check ADDS refusals and removes
  // none: an unverifiable station must be exactly as free to transmit as it was before.
  const rig = new CatController();
  const permission = rig.canTransmit(STATION, 1500, 14_076_000);
  check(
    'a station with no readback at all is unaffected by the new check',
    permission.allowed === true,
    JSON.stringify(permission.violations)
  );
  check('...and the controller reports no verified dial', rig.getVerifiedDialHz() === null);
}

{
  // A refusal must not be reachable by the app simply losing contact: that would ground a
  // station every time the local relay hiccupped.
  const rig = new CatController();
  for (let i = 0; i < POLLS_TO_STABILIZE + 1; i += 1) rig.rigState.observe({ dialHz: 7_074_000 });
  check('contact established, and contradicting', rig.canTransmit(STATION, 1500, 14_076_000).allowed === false);
  rig.rigState.goOffline('relay unreachable');
  check(
    'losing contact returns the station to unverified, not blocked',
    rig.canTransmit(STATION, 1500, 14_076_000).allowed === true
  );
}

{
  // The gate's own reason for existing is unchanged: the readback check is an addition to the
  // callsign, licence and band-plan checks, not a replacement for any of them.
  const rig = new CatController();
  rig.rigState.observe({ dialHz: 14_076_000 });
  const unlicensed = rig.canTransmit({ ...STATION, myCall: '' }, 1500, 14_076_000);
  check('a verified dial does not excuse a missing callsign', unlicensed.allowed === false);
  const outOfBand = rig.canTransmit(STATION, 1500, 14_200_000);
  check('a verified dial does not excuse an out-of-segment frequency', outOfBand.allowed === false);
}

// ------------------------------------------- R7: measured resolution survives the poll starting

group('A measured tuning resolution is not thrown away');

{
  // testCatConnection() probes the rig and then starts polling. When starting the poll reset the
  // tracker, the measurement was discarded the instant it was made - and a 10 Hz rig then
  // reported a disagreement on every poll, from hardware behaving exactly as designed. That is
  // the shape of failure that gets a safety check switched off by its operator.
  const rig = new CatController();
  rig.rigState.setResolution(-3); // 100 Hz truncated, as measured
  rig.startRigPolling();
  check(
    'starting the readback poll keeps the measured resolution',
    rig.rigState.getResolution() === -3
  );
  rig.stopRigPolling();
  check(
    'stopping it discards tracked state, resolution included',
    rig.rigState.getResolution() === 0
  );

  // ...and the tolerance really is applied to the gate, not merely stored.
  const keyed = new CatController();
  keyed.rigState.setResolution(-3);
  keyed.rigState.noteRequestedDial(14_076_055);
  keyed.rigState.observe({ dialHz: 14_076_000 });
  check(
    'a 100 Hz rig landing 55 Hz low of the commanded dial still transmits',
    keyed.canTransmit(STATION, 1500, 14_076_055).allowed === true,
    JSON.stringify(keyed.canTransmit(STATION, 1500, 14_076_055).violations)
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll rig-readback checks passed.');
