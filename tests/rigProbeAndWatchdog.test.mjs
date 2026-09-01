/**
 * Regression guards for the parts of the CAT layer that only misbehave when something else is
 * happening at the same time - and for the two timers that are supposed to fire on their own.
 *
 * These are the gaps an audit of this subsystem found: the WSJT-X-ported tuning-resolution
 * probe had no test at all, the readback poller was only ever driven by calling
 * `rigState.observe()` directly rather than through `pollRigOnce()`, and `MAX_TX_SECONDS` was
 * asserted as a number without anything ever letting the watchdog it configures actually run.
 *
 * Everything here drives the real CatController against a fake rigctld built on a stubbed
 * `fetch`, so the paths under test are the ones that ship.
 *
 * Run with:  npx tsx tests/rigProbeAndWatchdog.test.mjs
 */

import { CatController, MAX_TX_SECONDS } from '../src/dsp/catController.ts';
import { POLLS_TO_STABILIZE } from '../src/dsp/rigStateTracker.ts';
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

const STATION = {
  ...DEFAULT_STATION_CONFIG,
  myCall: 'K1ABC',
  regulatoryRegion: 'US',
  licenseClass: 'US_EXTRA',
};

// ---------------------------------------------------------------- fake rigctld over fetch
//
// localServerApi.call() reads its token off `window` and then fetches /api/rigctl, so a stub at
// that seam exercises everything above it - relayRigctl, the CAT queue, the probe and the
// poller - without a radio, a daemon or a server.

globalThis.window = globalThis.window || globalThis;
globalThis.window.__Z30_API_TOKEN__ = 'test-token';

/**
 * A rig that quantises its dial, so the probe has something real to classify.
 *
 * `quantise` is the rig's behaviour, given as a function of the commanded frequency; that is
 * the whole of the model. Every readback below is computed by running it, never asserted as a
 * literal, so these tests measure the classifier rather than restating its answer.
 */
function makeFakeRig({ quantise = (hz) => hz, onCommand = () => {} } = {}) {
  const rig = {
    dialHz: 14_076_000,
    ptt: false,
    log: [],
    failNext: 0,
    offline: false,
  };
  rig.quantise = quantise;

  globalThis.fetch = async (path, init) => {
    const body = JSON.parse(init.body);
    const command = String(body.command || '');
    rig.log.push(command);
    onCommand(command, rig);

    if (rig.offline) throw new Error('relay unreachable');
    if (rig.failNext > 0) {
      rig.failNext -= 1;
      return jsonResponse({ success: true, response: 'RPRT -1' });
    }

    if (command === 'f') return jsonResponse({ success: true, response: String(rig.dialHz) });
    if (command === 't') return jsonResponse({ success: true, response: rig.ptt ? '1' : '0' });
    const setFreq = /^F\s+(\d+)$/.exec(command);
    if (setFreq) {
      rig.dialHz = rig.quantise(Number.parseInt(setFreq[1], 10));
      return jsonResponse({ success: true, response: 'RPRT 0' });
    }
    const setPtt = /^T\s+([01])$/.exec(command);
    if (setPtt) {
      rig.ptt = setPtt[1] === '1';
      return jsonResponse({ success: true, response: 'RPRT 0' });
    }
    return jsonResponse({ success: true, response: 'RPRT 0' });
  };
  return rig;
}

function jsonResponse(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

/**
 * A controller wired to the relay, which is the only path the probe and poller run on.
 *
 * configureHamlibEndpoint() starts the repeating readback poll and fires one immediately, so
 * the timer is stopped and that first poll is drained before the controller is handed back -
 * otherwise `rigPollInFlight` from the automatic poll silently swallows the first poll a test
 * makes, and the test reads that as the rig never coming online.
 */
async function relayController() {
  const rig = new CatController();
  rig.configureHamlibEndpoint('127.0.0.1', 4532, true);
  rig.stopRigPolling();
  await new Promise((resolve) => setTimeout(resolve, 5));
  rig.stopRigPolling();
  return rig;
}

// ------------------------------------------------- P1: the resolution classification table

group('probeRigResolution classifies what the rig actually did (A6)');

{
  // WSJT-X's cases, each expressed as the rig behaviour that produces it rather than as the
  // readback arithmetic, so the test cannot drift into asserting the implementation back.
  const cases = [
    ['1 Hz - lands exactly where told', (hz) => hz, 0],
    ['10 Hz truncated', (hz) => Math.floor(hz / 10) * 10, -1],
    ['10 Hz rounded', (hz) => Math.round(hz / 10) * 10, 1],
    ['20 Hz truncated', (hz) => Math.floor(hz / 20) * 20, -2],
    ['20 Hz rounded', (hz) => Math.round(hz / 20) * 20, 2],
    ['100 Hz truncated', (hz) => Math.floor(hz / 100) * 100, -3],
    ['100 Hz rounded', (hz) => Math.round(hz / 100) * 100, 3],
  ];

  for (const [label, quantise, expected] of cases) {
    const rig = makeFakeRig({ quantise });
    rig.dialHz = 14_076_000; // a multiple of 10, so the probe runs rather than short-circuiting
    const cat = await relayController();
    const measured = await cat.probeRigResolution();
    check(`${label} -> code ${expected}`, measured === expected, `got ${measured}`);
    check(
      `${label}: the rig is left where it started`,
      rig.dialHz === quantise(14_076_000),
      `rig ended on ${rig.dialHz}`
    );
  }
}

{
  // A rig sitting on an odd Hz has already demonstrated 1 Hz tuning; WSJT-X skips the probe and
  // so must this, without writing anything to the rig.
  const rig = makeFakeRig();
  rig.dialHz = 14_076_003;
  const cat = await relayController();
  const measured = await cat.probeRigResolution();
  check('a dial that is not a multiple of 10 short-circuits to 1 Hz', measured === 0);
  check(
    '...and the probe writes no frequency to do it',
    rig.log.every((c) => !c.startsWith('F ')),
    rig.log.join(' | ')
  );
}

// ------------------------------------------ P2: a QSY landing mid-probe (A1) and no false alarm (A2)

group('a QSY during the probe is not undone (A1)');

{
  // The defect: the probe captured the dial at entry and restored it unconditionally in a
  // `finally`. A QSY landing mid-probe was therefore reverted on the wire while
  // `currentFreqHz` had already moved, and the tracker was told the OLD dial was commanded -
  // so the readback check compared the old dial against a rig on the old dial, called them
  // agreed, and the band-plan check went on validating the new one. The gate approved a
  // frequency the transmitter was not on, which is the exact failure the readback model exists
  // to close.
  // The QSY is fired from inside the probe's own test-frequency write, so it is guaranteed to
  // land while the probe holds the dial rather than depending on timer luck. Without that the
  // probe simply finishes first and the race under test never happens.
  const holder = {};
  let qsyStarted = null;
  const rig = makeFakeRig({
    onCommand: (command) => {
      if (!qsyStarted && /^F\s+\d+55$/.test(command) && holder.cat) {
        qsyStarted = holder.cat.setFreqHz(7_074_000);
      }
    },
  });
  rig.dialHz = 14_076_000;

  const cat = await relayController();
  holder.cat = cat;
  await cat.probeRigResolution();
  await qsyStarted;

  check('the app is on the new dial', cat.getFreqHz() === 7_074_000, String(cat.getFreqHz()));
  check(
    'the rig was left on the new dial, not restored to the pre-probe one',
    rig.dialHz === 7_074_000,
    `rig ended on ${rig.dialHz}`
  );
  check(
    'the tracker was told the new dial, so the readback check compares the right pair',
    cat.getRigStateSnapshot().commandedDialHz === 7_074_000,
    String(cat.getRigStateSnapshot().commandedDialHz)
  );

  // The gate must now agree with the radio rather than being blinded by a stale commanded dial.
  for (let i = 0; i < POLLS_TO_STABILIZE + 1; i += 1) cat.rigState.observe({ dialHz: rig.dialHz });
  const permission = cat.canTransmit(STATION, 1500, cat.getFreqHz());
  check(
    'the gate agrees with the radio afterwards',
    permission.allowed === true,
    JSON.stringify(permission.violations)
  );
}

group('the probe cannot be read as a dial mismatch (A2)');

{
  // The probe's writes are real writes. A poll landing between them used to read the throwaway
  // test frequency and report a settled disagreement. The CAT queue now serialises the two, and
  // the probe tells the tracker what it asked for, so neither half can misread the other.
  const rig = makeFakeRig({ quantise: (hz) => Math.floor(hz / 100) * 100 });
  rig.dialHz = 14_076_000;
  const cat = await relayController();

  const probe = cat.probeRigResolution();
  const polls = [cat.pollRigOnce(), cat.pollRigOnce(), cat.pollRigOnce()];
  await Promise.all([probe, ...polls]);

  const mismatchLines = cat
    .getCommandLogs()
    .filter((entry) => String(entry.response || '').includes('Transmit is blocked until they agree'));
  check('no spurious mismatch was logged during the probe', mismatchLines.length === 0, JSON.stringify(mismatchLines));
}

// --------------------------------------------------- P3: the poller, driven for real (A7)

group('pollRigOnce, exercised through the controller (A7)');

{
  const rig = makeFakeRig();
  rig.dialHz = 14_076_000;
  const cat = await relayController();

  await cat.pollRigOnce();
  check('a first poll brings the rig online', cat.getRigStateSnapshot().online === true);
  check('...and the reported dial is what the rig answered', cat.getVerifiedDialHz() === 14_076_000);

  const establishedLines = () =>
    cat.getCommandLogs().filter((e) => String(e.response || '').includes('rig readback established')).length;
  const afterFirst = establishedLines();
  await cat.pollRigOnce();
  check('a second successful poll logs nothing more', establishedLines() === afterFirst, String(establishedLines()));

  // Contact lost, logged exactly once however many polls fail.
  rig.offline = true;
  await cat.pollRigOnce();
  await cat.pollRigOnce();
  await cat.pollRigOnce();
  const lostLines = cat.getCommandLogs().filter((e) => String(e.response || '').includes('rig readback lost')).length;
  check('losing contact is logged once, not once per poll', lostLines === 1, String(lostLines));
  check('...and the dial is unverified while offline', cat.getVerifiedDialHz() === null);

  // Contact regained.
  rig.offline = false;
  await cat.pollRigOnce();
  check('contact is re-established', cat.getRigStateSnapshot().online === true);
}

{
  // A settled mismatch is logged once per distinct frequency, not once a second.
  //
  // The rig starts in agreement with the app's dial so the controller reaches a settled,
  // quiet state first; the mismatch under test is then introduced by the operator turning the
  // VFO, which is the case the dedup exists for.
  const rig = makeFakeRig();
  rig.dialHz = 14_076_000;
  const cat = await relayController();
  await cat.setFreqHz(14_076_000);
  await cat.pollRigOnce();
  const quiet = cat
    .getCommandLogs()
    .filter((e) => String(e.response || '').includes('Transmit is blocked until they agree')).length;
  check('an agreeing rig logs no mismatch at all', quiet === 0, String(quiet));

  rig.dialHz = 7_074_000; // the operator turned the VFO by hand

  for (let i = 0; i < POLLS_TO_STABILIZE + 3; i += 1) await cat.pollRigOnce();
  const mismatchLines = cat
    .getCommandLogs()
    .filter((e) => String(e.response || '').includes('Transmit is blocked until they agree'));
  check('a persistent mismatch is logged once, not once per poll', mismatchLines.length === 1, String(mismatchLines.length));
  check(
    '...and the gate refuses while it stands',
    cat.canTransmit(STATION, 1500, 14_076_000).allowed === false
  );
}

{
  // A poll fired inside the PTT settle window is CAT traffic aimed at a rig that may not be
  // able to answer it, which is why TransceiverBase sleeps there. It must be skipped.
  const rig = makeFakeRig();
  const cat = await relayController();
  cat.rigState.noteRequestedPtt(true);
  const before = rig.log.length;
  await cat.pollRigOnce();
  check('a poll inside the PTT settle window addresses the rig not at all', rig.log.length === before, String(rig.log.length - before));
}

// ------------------------------------------------- P4: the timers actually firing (A8)

group('the transmit watchdog and dead-man switch really fire (A8)');

{
  // MAX_TX_SECONDS was only ever compared as a number. This lets the timer it configures run.
  const rig = makeFakeRig();
  const cat = await relayController();

  const realSetTimeout = globalThis.setTimeout;
  let watchdogFn = null;
  let watchdogDelay = null;
  globalThis.setTimeout = (fn, delay, ...rest) => {
    if (delay === MAX_TX_SECONDS * 1000) {
      watchdogFn = fn;
      watchdogDelay = delay;
      return { __fake: true };
    }
    return realSetTimeout(fn, delay, ...rest);
  };

  await cat.setPtt(true, 'CAT', 'ACTIVE_HIGH');
  globalThis.setTimeout = realSetTimeout;

  check('keying arms a watchdog', typeof watchdogFn === 'function');
  check(
    '...at the documented deadline, not some other number',
    watchdogDelay === MAX_TX_SECONDS * 1000,
    String(watchdogDelay)
  );
  check('the transmitter is keyed before the deadline', cat.getPtt() === true && rig.ptt === true);

  // Let the deadline pass.
  watchdogFn();
  await new Promise((resolve) => realSetTimeout(resolve, 10));

  check('the watchdog unkeys the transmitter', cat.getPtt() === false, 'app still believes it is keyed');
  check('...at the hardware, not only in the app', rig.ptt === false, 'the rig is still keyed');
  check(
    '...and says why in the rig log',
    cat.getCommandLogs().some((e) => String(e.command || '').includes('PTT_WATCHDOG_RELEASE')),
    'no watchdog line logged'
  );
}

{
  // A frame is 24 s and the watchdog is 40 s, so a normal transmission must never reach it.
  // Asserted as a relationship between the two constants, not as two literals.
  const FRAME_SEC = 24.0;
  check(
    'the watchdog deadline sits beyond a full frame',
    MAX_TX_SECONDS > FRAME_SEC,
    `${MAX_TX_SECONDS}s vs a ${FRAME_SEC}s frame`
  );
  check(
    '...with margin for lead-in and hang time, but not so much that a stuck key runs long',
    MAX_TX_SECONDS - FRAME_SEC > 5 && MAX_TX_SECONDS < 2 * FRAME_SEC,
    `${MAX_TX_SECONDS}s`
  );
}

{
  // The unkey path itself: a release must reach the hardware even when the app got there by
  // way of forceUnkey rather than a normal sequence end.
  const rig = makeFakeRig();
  const cat = await relayController();
  await cat.setPtt(true, 'CAT', 'ACTIVE_HIGH');
  check('keyed', rig.ptt === true);
  await cat.forceUnkey();
  check('forceUnkey drops the line at the rig', rig.ptt === false);
  check('...and in the app', cat.getPtt() === false);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll rig-probe and watchdog checks passed.');
