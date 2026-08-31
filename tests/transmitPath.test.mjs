/**
 * Regression guards for the transmit path.
 *
 * Everything here defends a defect that is INVISIBLE without hardware attached: a release that
 * drops the wrong pin, a wiring test that reports success without sending anything, and a
 * diagnostic console that keys a radio without running the compliance gate. Each one would have
 * shown up first as an unattended transmission on somebody's licence, which is exactly the
 * class of failure AGENTS.md §4 exists to prevent.
 *
 * The controller is DOM-free enough to construct under node; the hardware helpers are private
 * in TypeScript but plain properties at runtime, so each test replaces them with a recorder and
 * asserts on what the controller actually tried to drive.
 *
 * Run with:  npx tsx tests/transmitPath.test.mjs
 */

import { CatController, MAX_TX_SECONDS } from '../src/dsp/catController.ts';

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

/**
 * A controller whose hardware helpers record instead of driving anything.
 * `ok` decides whether the fake hardware accepts the command.
 */
function makeRecordingController({ ok = true } = {}) {
  const rig = new CatController();
  const calls = [];
  rig.setCm108Gpio = async (pin, active) => {
    calls.push({ method: 'CM108', pin, active });
    return ok;
  };
  rig.setRpiGpio = async (pin, tx, polarity) => {
    calls.push({ method: 'RPI', pin, active: tx, polarity });
    return ok;
  };
  rig.sendTciPtt = async (host, port, tx) => {
    calls.push({ method: 'TCI', host, port, active: tx });
    return ok;
  };
  rig.setWinkeyerPtt = async (tx) => {
    calls.push({ method: 'WINKEYER', active: tx });
    return ok;
  };
  rig.sendRigPtt = (tx) => {
    calls.push({ method: 'CAT', active: tx });
  };
  return { rig, calls };
}

// ------------------------------------------------- Z1: release drives what the key drove

group('PTT release addresses the hardware the key addressed');

{
  // A station keyed on CM108 GPIO 4 that is released on GPIO 3 stays transmitting, and CM108
  // has no server-side dead-man switch behind it to catch that.
  const { rig, calls } = makeRecordingController();
  await rig.setPtt(true, 'CM108_GPIO', 'ACTIVE_HIGH', { cm108GpioPin: 4 });
  await rig.setPtt(false, 'CM108_GPIO', 'ACTIVE_HIGH'); // caller omits the options
  const released = calls.filter((c) => c.method === 'CM108' && c.active === false);
  check(
    'unkeying with no options releases the CM108 pin that was keyed (4, not the default 3)',
    released.length === 1 && released[0].pin === 4,
    JSON.stringify(calls)
  );
}

{
  const { rig, calls } = makeRecordingController();
  await rig.setPtt(true, 'RASPBERRY_PI_GPIO', 'ACTIVE_HIGH', { rpiGpioPin: 27 });
  await rig.setPtt(false, 'RASPBERRY_PI_GPIO', 'ACTIVE_HIGH');
  const released = calls.filter((c) => c.method === 'RPI' && c.active === false);
  check(
    'unkeying with no options releases BCM 27, not the default 17',
    released.length === 1 && released[0].pin === 27,
    JSON.stringify(calls)
  );
}

{
  const { rig, calls } = makeRecordingController();
  await rig.setPtt(true, 'TCI_NETWORK', 'ACTIVE_HIGH', { tciHost: '192.168.1.50', tciPort: 40002 });
  await rig.setPtt(false, 'TCI_NETWORK', 'ACTIVE_HIGH');
  const released = calls.filter((c) => c.method === 'TCI' && c.active === false);
  check(
    'unkeying with no options tells the REMOTE TCI host to stop, not 127.0.0.1',
    released.length === 1 && released[0].host === '192.168.1.50' && released[0].port === 40002,
    JSON.stringify(calls)
  );
}

{
  // An explicit options object must still win over the remembered context.
  const { rig, calls } = makeRecordingController();
  await rig.setPtt(true, 'CM108_GPIO', 'ACTIVE_HIGH', { cm108GpioPin: 4 });
  await rig.setPtt(false, 'CM108_GPIO', 'ACTIVE_HIGH', { cm108GpioPin: 5 });
  const released = calls.filter((c) => c.method === 'CM108' && c.active === false);
  check(
    'an explicit release option overrides the remembered keying context',
    released.length === 1 && released[0].pin === 5,
    JSON.stringify(calls)
  );
}

{
  const { rig, calls } = makeRecordingController();
  // The emergency release only drives CM108 pins when a HID device is actually paired - there
  // is nothing to drop otherwise - so the test has to present one.
  rig.hidDevice = { opened: true };
  await rig.setPtt(true, 'CM108_GPIO', 'ACTIVE_HIGH', { cm108GpioPin: 4 });
  rig.releasePttEmergency();
  const dropped = calls.filter((c) => c.method === 'CM108' && c.active === false).map((c) => c.pin);
  check(
    'the emergency release drops the configured CM108 pin as well as the common 3 and 4',
    dropped.includes(4) && dropped.includes(3),
    JSON.stringify(dropped)
  );
  check('the emergency release leaves PTT de-asserted', rig.getPtt() === false);
}

// --------------------------------------- Z2: a PTT test that reports what actually happened

group('Test PTT reports real hardware outcomes');

for (const [method, options] of [
  ['CM108_GPIO', { cm108GpioPin: 3 }],
  ['RASPBERRY_PI_GPIO', { rpiGpioPin: 17 }],
  ['TCI_NETWORK', { tciHost: '127.0.0.1', tciPort: 40001 }],
  ['WINKEYER', { winkeyerPort: 'COM1' }],
]) {
  // These four used to write a log line describing bytes they never sent and return
  // "verified" regardless. An operator wiring a DRA, a DigiPi, a SunSDR2 or a WinKeyer got a
  // green tick from hardware that was never addressed.
  const { rig, calls } = makeRecordingController({ ok: false });
  const result = await rig.testPttKey(method, 'ACTIVE_HIGH', 5, undefined, options);
  check(
    `${method}: an unreachable device fails the test instead of reporting success`,
    result.success === false,
    result.message
  );
  check(
    `${method}: the test actually tried to drive the hardware`,
    calls.some((c) => c.active === true),
    JSON.stringify(calls)
  );
  check(`${method}: a failed test leaves PTT de-asserted`, rig.getPtt() === false);
}

for (const [method, options] of [
  ['CM108_GPIO', { cm108GpioPin: 4 }],
  ['RASPBERRY_PI_GPIO', { rpiGpioPin: 27 }],
  ['TCI_NETWORK', { tciHost: '10.0.0.9', tciPort: 40002 }],
  ['WINKEYER', { winkeyerPort: 'COM7' }],
]) {
  const { rig, calls } = makeRecordingController({ ok: true });
  const result = await rig.testPttKey(method, 'ACTIVE_HIGH', 5, undefined, options);
  check(
    `${method}: a passing test asserted AND released the line`,
    result.success === true &&
      calls.some((c) => c.active === true) &&
      calls.some((c) => c.active === false),
    JSON.stringify(calls)
  );
  check(`${method}: the test leaves PTT de-asserted`, rig.getPtt() === false);
}

{
  const { rig, calls } = makeRecordingController({ ok: true });
  await rig.testPttKey('CM108_GPIO', 'ACTIVE_HIGH', 5, undefined, { cm108GpioPin: 4 });
  check(
    'the test drives the CONFIGURED pin, not a hardcoded default',
    calls.every((c) => c.pin === 4),
    JSON.stringify(calls)
  );
}

// ------------------------------------------------ Z3/Z8: the raw console is not a back door

group('Raw rigctl console');

{
  const { rig, calls } = makeRecordingController();
  const resp = rig.executeRawCommand('\\set_ptt 1');
  check(
    '\\set_ptt 1 with no gate wired is REFUSED',
    resp.startsWith('RPRT -1'),
    resp
  );
  check('...and nothing was keyed', !calls.some((c) => c.active === true), JSON.stringify(calls));
}

{
  const { rig, calls } = makeRecordingController();
  const resp = rig.executeRawCommand('T 1', {
    assertCanTransmit: () => false, // the gate refuses: placeholder callsign, no licence class...
    txAudioOffsetHz: 1500,
    pttMethod: 'CM108_GPIO',
    pttPolarity: 'ACTIVE_HIGH',
  });
  check('T 1 is refused when the transmit gate says no', resp.startsWith('RPRT -1'), resp);
  check('...and nothing was keyed', !calls.some((c) => c.active === true), JSON.stringify(calls));
}

{
  const { rig, calls } = makeRecordingController();
  let gateSawOffset = null;
  const resp = rig.executeRawCommand('T 1', {
    assertCanTransmit: (offset) => {
      gateSawOffset = offset;
      return true;
    },
    txAudioOffsetHz: 1500,
    pttMethod: 'CM108_GPIO',
    pttPolarity: 'ACTIVE_LOW',
    pttOptions: { cm108GpioPin: 4 },
  });
  check('T 1 is permitted when the gate allows it', resp === 'RPRT 0', resp);
  check('the gate was given the audio offset, not just the dial', gateSawOffset === 1500);
  check(
    'the console keys through the CONFIGURED method, not a CAT default',
    calls.some((c) => c.method === 'CM108' && c.active === true && c.pin === 4),
    JSON.stringify(calls)
  );
  check(
    'no CAT PTT bytes were sent to a station that is not keyed over CAT',
    !calls.some((c) => c.method === 'CAT' && c.active === true),
    JSON.stringify(calls)
  );
}

{
  // Refusing to STOP transmitting is not a safety property.
  const { rig, calls } = makeRecordingController();
  await rig.setPtt(true, 'CM108_GPIO', 'ACTIVE_HIGH', { cm108GpioPin: 4 });
  const resp = rig.executeRawCommand('T 0');
  check('T 0 unkeys without needing the gate', resp === 'RPRT 0', resp);
  check(
    '...and releases the pin that was keyed',
    calls.some((c) => c.method === 'CM108' && c.active === false && c.pin === 4),
    JSON.stringify(calls)
  );
}

group('Raw rigctl console verb table');

{
  const { rig } = makeRecordingController();
  rig.setFreqHz(14076000);

  check('lower-case f READS the frequency', rig.executeRawCommand('f') === '14076000');
  check('upper-case F SETS the frequency', rig.executeRawCommand('F 14074000') === 'RPRT 0');
  check('...and the set actually took effect', rig.executeRawCommand('f') === '14074000');
  check('F with a nonsense argument is an error', rig.executeRawCommand('F 12').startsWith('RPRT -1'));

  check('lower-case m READS the mode', rig.executeRawCommand('m').startsWith('PKTUSB'));
  check('upper-case M SETS the mode', rig.executeRawCommand('M USB') === 'RPRT 0');
  check('...and the set actually took effect', rig.executeRawCommand('m').startsWith('USB'));
  check('M with no argument is an error', rig.executeRawCommand('M').startsWith('RPRT -1'));

  check('lower-case t READS the PTT state', rig.executeRawCommand('t') === '0');

  check('v returns the VFO', rig.executeRawCommand('v') === 'VFOA');
  check(
    'version returns the Hamlib version string, and is no longer shadowed by v',
    rig.executeRawCommand('version').startsWith('Hamlib'),
    rig.executeRawCommand('version')
  );
  check('\\version works too', rig.executeRawCommand('\\version').startsWith('Hamlib'));
  check('the long \\get_freq form still works', rig.executeRawCommand('\\get_freq') === '14074000');
  check('\\set_freq still works', rig.executeRawCommand('\\set_freq 14076000') === 'RPRT 0');
  check('help lists the commands', rig.executeRawCommand('help').includes('\\get_freq'));

  // An unknown verb answering "RPRT 0" makes a typo indistinguishable from a command that ran.
  check('an unknown verb returns a non-zero RPRT', rig.executeRawCommand('qwerty').startsWith('RPRT -1'));
  const log = rig.getCommandLogs().find((l) => l.command === 'qwerty');
  check('...and is logged as an ERROR', log && log.status === 'ERROR', JSON.stringify(log));
}

// ------------------------------------------------------------------ layered safety net

group('Layered unkey defences are still three separate layers');

{
  check('the browser-side maximum transmit time is unchanged', MAX_TX_SECONDS === 40);
  const { rig } = makeRecordingController();
  check('a frame (24 s) fits comfortably inside it', MAX_TX_SECONDS > 24);
  check('the tune auto-cutoff (15 s) is well inside it', MAX_TX_SECONDS > 15);
  // forceUnkey must work off the remembered context, not off a caller re-supplying it.
  await rig.setPtt(true, 'CM108_GPIO', 'ACTIVE_HIGH', { cm108GpioPin: 4 });
  await rig.forceUnkey();
  check('forceUnkey leaves PTT de-asserted', rig.getPtt() === false);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll transmit-path checks passed.');
