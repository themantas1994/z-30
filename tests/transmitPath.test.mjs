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
import { DEFAULT_STATION_CONFIG, PLACEHOLDER_CALLSIGN } from '../src/dsp/z30Constants.ts';
import { isValidCallsign } from '../src/dsp/bandPlan.ts';

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
  rig.sendRigPtt = async (tx) => {
    calls.push({ method: 'CAT', active: tx });
    return ok;
  };
  return { rig, calls };
}

/**
 * A controller whose CAT transport is recorded at the level BELOW sendRigPtt(), so the CAT
 * keying branch itself is under test: which protocol it speaks, and what it does when the
 * transport reports that nothing was written.
 */
function makeCatController({ family = 'CIV', writeOk = true } = {}) {
  const rig = new CatController();
  const wire = [];
  rig.activeProtocolFamily = family;
  rig.activeCivAddr = 0x94;
  rig.sendHardwareBytes = async (bytes) => {
    wire.push(Array.from(bytes));
    return writeOk;
  };
  rig.sendHardwareText = async (text) => {
    wire.push(text);
    return writeOk;
  };
  return { rig, wire };
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
  const resp = await rig.executeRawCommand('\\set_ptt 1');
  check(
    '\\set_ptt 1 with no gate wired is REFUSED',
    resp.startsWith('RPRT -1'),
    resp
  );
  check('...and nothing was keyed', !calls.some((c) => c.active === true), JSON.stringify(calls));
}

{
  const { rig, calls } = makeRecordingController();
  const resp = await rig.executeRawCommand('T 1', {
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
  const resp = await rig.executeRawCommand('T 1', {
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
    calls.some((c) => c.method === 'CM108' && c.pin === 4),
    JSON.stringify(calls)
  );
  check(
    // This context is ACTIVE_LOW, so the keyed level is LOW. The check used to require a high
    // level here, which passed only because setPtt dropped the polarity on the way to the
    // CM108 helper - the assertion had the old defect written into it.
    '...at the keyed level for its ACTIVE_LOW polarity',
    calls.some((c) => c.method === 'CM108' && c.pin === 4 && c.active === false),
    JSON.stringify(calls)
  );
  check('...and the transmitter is keyed', rig.getPtt() === true);
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
  const resp = await rig.executeRawCommand('T 0');
  check('T 0 unkeys without needing the gate', resp === 'RPRT 0', resp);
  check(
    '...and releases the pin that was keyed',
    calls.some((c) => c.method === 'CM108' && c.active === false && c.pin === 4),
    JSON.stringify(calls)
  );
}

group('Raw rigctl console verb table');

{
  // A rig WITH a working CAT transport, so the verb table (lower = get, upper = set) is what
  // is under test here rather than the transport. The honesty of RPRT when there is no
  // transport is asserted in the next group.
  const { rig } = makeRecordingController();
  const sent = [];
  rig.sendRigFrequency = async (hz) => {
    sent.push({ kind: 'freq', hz });
    return true;
  };
  rig.sendRigMode = async (mode) => {
    sent.push({ kind: 'mode', mode });
    return true;
  };
  await rig.setFreqHz(14076000);

  check('lower-case f READS the frequency', (await rig.executeRawCommand('f')) === '14076000');
  check('upper-case F SETS the frequency', (await rig.executeRawCommand('F 14074000')) === 'RPRT 0');
  check('...and the set actually took effect', (await rig.executeRawCommand('f')) === '14074000');
  check(
    '...and the frequency reached the radio',
    sent.some((c) => c.kind === 'freq' && c.hz === 14074000),
    JSON.stringify(sent)
  );
  check('F with a nonsense argument is an error', (await rig.executeRawCommand('F 12')).startsWith('RPRT -1'));

  check('lower-case m READS the mode', (await rig.executeRawCommand('m')).startsWith('PKTUSB'));
  check('upper-case M SETS the mode', (await rig.executeRawCommand('M USB')) === 'RPRT 0');
  check('...and the set actually took effect', (await rig.executeRawCommand('m')).startsWith('USB'));
  check('M with no argument is an error', (await rig.executeRawCommand('M')).startsWith('RPRT -1'));

  check('lower-case t READS the PTT state', (await rig.executeRawCommand('t')) === '0');

  check('v returns the VFO', (await rig.executeRawCommand('v')) === 'VFOA');
  check(
    'version returns the Hamlib version string, and is no longer shadowed by v',
    (await rig.executeRawCommand('version')).startsWith('Hamlib'),
    await rig.executeRawCommand('version')
  );
  check('\\version works too', (await rig.executeRawCommand('\\version')).startsWith('Hamlib'));
  check('the long \\get_freq form still works', (await rig.executeRawCommand('\\get_freq')) === '14074000');
  check('\\set_freq still works', (await rig.executeRawCommand('\\set_freq 14076000')) === 'RPRT 0');
  check('help lists the commands', (await rig.executeRawCommand('help')).includes('\\get_freq'));

  // An unknown verb answering "RPRT 0" makes a typo indistinguishable from a command that ran.
  check('an unknown verb returns a non-zero RPRT', (await rig.executeRawCommand('qwerty')).startsWith('RPRT -1'));
  const log = rig.getCommandLogs().find((l) => l.command === 'qwerty');
  check('...and is logged as an ERROR', log && log.status === 'ERROR', JSON.stringify(log));
}

// ------------------------- Z9: a CAT command that was never sent must not report success

group('CAT commands report what the hardware did');

{
  // No rig protocol and no relay: every CAT command is a no-op. These used to answer "RPRT 0"
  // and log OK, so the console, the rig log and the app's VFO readout all agreed on a
  // frequency the radio had never been told about.
  const { rig } = makeCatController({ family: 'NONE' });
  const freqResp = await rig.executeRawCommand('F 14074000');
  check('F with no CAT transport returns a non-zero RPRT', freqResp.startsWith('RPRT -1'), freqResp);
  check('...and names what is missing', /Direct Serial CAT protocol|rigctld relay|serial port/.test(freqResp), freqResp);

  const modeResp = await rig.executeRawCommand('M USB');
  check('M with no CAT transport returns a non-zero RPRT', modeResp.startsWith('RPRT -1'), modeResp);

  const log = rig.getCommandLogs().find((l) => l.command.startsWith('set_freq'));
  check('...and the rig log records it as an ERROR, not OK', log && log.status === 'ERROR', JSON.stringify(log));
}

{
  // The defect an operator reported: a green "PTT verified" from a radio never addressed.
  // setPtt()'s CAT branch reported success whether or not sendRigPtt() wrote anything, on all
  // three of its silent no-op paths.
  const { rig } = makeCatController({ family: 'NONE' });
  const keyed = await rig.setPtt(true, 'CAT', 'ACTIVE_HIGH');
  check('CAT keying with no protocol and no port FAILS', keyed === false);
  check('...and leaves PTT de-asserted', rig.getPtt() === false);
  check('...and explains why', (rig.getLastPttFailure() || '').length > 0, String(rig.getLastPttFailure()));

  const result = await rig.testPttKey('CAT', 'ACTIVE_HIGH', 5);
  check('...so the wiring test reports a failure, not "✓ CAT PTT verified"', result.success === false, result.message);
}

{
  // A configured rig whose serial port cannot be written to is the same class of failure.
  const { rig } = makeCatController({ family: 'CIV', writeOk: false });
  check('CAT keying fails when the serial write fails', (await rig.setPtt(true, 'CAT', 'ACTIVE_HIGH')) === false);
  const result = await rig.testPttKey('CAT', 'ACTIVE_HIGH', 5);
  check('...and the wiring test fails with it', result.success === false, result.message);
}

{
  const { rig, wire } = makeCatController({ family: 'CIV' });
  check('CAT keying succeeds when the write succeeds', (await rig.setPtt(true, 'CAT', 'ACTIVE_HIGH')) === true);
  check(
    'an Icom station is keyed with CI-V 1C 00 01 at the configured address',
    JSON.stringify(wire[0]) === JSON.stringify([0xfe, 0xfe, 0x94, 0xe0, 0x1c, 0x00, 0x01, 0xfd]),
    JSON.stringify(wire)
  );
  await rig.setPtt(false, 'CAT', 'ACTIVE_HIGH');
  check(
    '...and released with the same command carrying 00',
    JSON.stringify(wire[1]) === JSON.stringify([0xfe, 0xfe, 0x94, 0xe0, 0x1c, 0x00, 0x00, 0xfd]),
    JSON.stringify(wire)
  );
}

{
  // Yaesu was routed through the Kenwood builders, so every Yaesu station was sent `TX;` - the
  // READ form - and stayed in receive.
  const { rig, wire } = makeCatController({ family: 'YAESU' });
  await rig.setPtt(true, 'CAT', 'ACTIVE_HIGH');
  await rig.setPtt(false, 'CAT', 'ACTIVE_HIGH');
  check('a Yaesu station is keyed with TX1; and released with TX0;', wire[0] === 'TX1;' && wire[1] === 'TX0;', JSON.stringify(wire));
  check('...and never with the Kenwood TX;/RX; pair', !wire.includes('TX;') && !wire.includes('RX;'), JSON.stringify(wire));
}

{
  const { rig, wire } = makeCatController({ family: 'KENWOOD' });
  await rig.setPtt(true, 'CAT', 'ACTIVE_HIGH');
  check('a Kenwood/Elecraft station is still keyed with TX;', wire[0] === 'TX;', JSON.stringify(wire));
}

// ------------------------------- Z10: RTS/DTR keying reaches a port, or admits it did not

group('RTS and DTR keying');

{
  // No port paired is not a no-op: nothing was keyed, and saying otherwise is how an operator
  // ends up calling CQ into a radio in receive.
  const rig = new CatController();
  const keyed = await rig.setPtt(true, 'RTS', 'ACTIVE_HIGH', { pttPort: '/dev/ttyUSB1' });
  check('RTS keying with no open port FAILS', keyed === false);
  check('...and leaves PTT de-asserted', rig.getPtt() === false);
  const result = await rig.testPttKey('DTR', 'ACTIVE_HIGH', 5);
  check('...and the DTR wiring test reports the failure', result.success === false, result.message);
}

{
  const rig = new CatController();
  const signals = [];
  rig.serialPort = { setSignals: async (s) => { signals.push(s); }, writable: {}, readable: {} };
  await rig.setPtt(true, 'RTS', 'ACTIVE_HIGH');
  await rig.setPtt(false, 'RTS', 'ACTIVE_HIGH');
  check('ACTIVE_HIGH RTS keying raises RTS and then lowers it', signals[0].requestToSend === true && signals[1].requestToSend === false, JSON.stringify(signals));
  check('...and never touches DTR', signals.every((s) => s.dataTerminalReady === undefined), JSON.stringify(signals));
}

{
  const rig = new CatController();
  const signals = [];
  rig.serialPort = { setSignals: async (s) => { signals.push(s); }, writable: {}, readable: {} };
  await rig.setPtt(true, 'DTR', 'ACTIVE_LOW');
  await rig.setPtt(false, 'DTR', 'ACTIVE_LOW');
  check('ACTIVE_LOW DTR keying LOWERS the line to transmit', signals[0].dataTerminalReady === false, JSON.stringify(signals));
  check('...and raises it to return to receive', signals[1].dataTerminalReady === true, JSON.stringify(signals));
}

{
  // A station whose PTT is on its own cable must be keyed on THAT port. `pttPort` was
  // collected, printed in the keying message, and then ignored.
  const rig = new CatController();
  const catSignals = [];
  const pttSignals = [];
  rig.serialPort = { setSignals: async (s) => { catSignals.push(s); }, writable: {}, readable: {} };
  rig.pttSerialPort = { setSignals: async (s) => { pttSignals.push(s); }, writable: {}, readable: {} };
  rig.pttSerialPortLabel = 'the second FTDI';
  await rig.setPtt(true, 'RTS', 'ACTIVE_HIGH');
  check('a paired PTT port is the one keyed', pttSignals.length === 1 && pttSignals[0].requestToSend === true, JSON.stringify({ catSignals, pttSignals }));
  check('...and the CAT port is left alone', catSignals.length === 0, JSON.stringify(catSignals));

  rig.releasePttEmergency();
  check('the emergency release drops BOTH ports', catSignals.length === 1 && pttSignals.length === 2, JSON.stringify({ catSignals, pttSignals }));
}

// -------------------------------------- Z11: keying polarity is applied, not just displayed

group('Keying polarity reaches the hardware');

{
  // An active-low DRA/URI interface was driven backwards: no carrier while transmitting, PTT
  // asserted while receiving - and the wiring test still printed "Active Low" and passed.
  const { rig, calls } = makeRecordingController();
  await rig.setPtt(true, 'CM108_GPIO', 'ACTIVE_LOW', { cm108GpioPin: 3 });
  await rig.setPtt(false, 'CM108_GPIO', 'ACTIVE_LOW', { cm108GpioPin: 3 });
  const levels = calls.filter((c) => c.method === 'CM108').map((c) => c.active);
  check('ACTIVE_LOW CM108 keying drives the pin LOW to transmit', levels[0] === false, JSON.stringify(calls));
  check('...and HIGH to return to receive', levels[1] === true, JSON.stringify(calls));
}

{
  const { rig, calls } = makeRecordingController();
  await rig.setPtt(true, 'CM108_GPIO', 'ACTIVE_HIGH', { cm108GpioPin: 3 });
  check('ACTIVE_HIGH CM108 keying still drives the pin high', calls[0].active === true, JSON.stringify(calls));
}

{
  // The emergency release must drive the RELEASED level for this station's wiring; a
  // hardcoded low released an active-high interface and keyed an active-low one.
  const { rig, calls } = makeRecordingController();
  rig.hidDevice = { opened: true };
  await rig.setPtt(true, 'CM108_GPIO', 'ACTIVE_LOW', { cm108GpioPin: 4 });
  rig.releasePttEmergency();
  const emergency = calls.filter((c) => c.method === 'CM108').slice(1);
  check(
    'the emergency release drives CM108 HIGH on an active-low station',
    emergency.length > 0 && emergency.every((c) => c.active === true),
    JSON.stringify(calls)
  );
}

{
  // The Pi bridge is told the INTENT plus the polarity, so the server can keep its dead-man
  // bookkeeping in step with the transmitter rather than with the pin's voltage.
  const { rig, calls } = makeRecordingController();
  await rig.setPtt(true, 'RASPBERRY_PI_GPIO', 'ACTIVE_LOW', { rpiGpioPin: 17 });
  check(
    'the GPIO bridge receives tx=true with the ACTIVE_LOW polarity, not a bare level',
    calls[0].active === true && calls[0].polarity === 'ACTIVE_LOW',
    JSON.stringify(calls)
  );
}

// -------------------- Z12: opening a port must not key, on either wiring polarity

group('Opening a serial port leaves the keying line released');

{
  // Chromium raises DTR and RTS when a port opens, which on an active-high keyed station is a
  // transmit command - the radio keyed on "Connect Serial Port", before any check had run.
  const rig = new CatController();
  const signals = [];
  const port = { setSignals: async (s) => { signals.push(s); }, writable: {}, readable: {} };
  rig.configureKeying('ACTIVE_HIGH');
  await rig.deassertKeyingLines(port);
  check(
    'an ACTIVE_HIGH station has both lines driven low on open',
    signals.length === 1 && signals[0].requestToSend === false && signals[0].dataTerminalReady === false,
    JSON.stringify(signals)
  );
}

{
  // ...but "both low" is the KEYED state on an inverting optocoupler, so a blanket de-assert
  // would key exactly the stations it is meant to protect.
  const rig = new CatController();
  const signals = [];
  const port = { setSignals: async (s) => { signals.push(s); }, writable: {}, readable: {} };
  rig.configureKeying('ACTIVE_LOW');
  await rig.deassertKeyingLines(port);
  check(
    'an ACTIVE_LOW station has both lines driven high on open',
    signals.length === 1 && signals[0].requestToSend === true && signals[0].dataTerminalReady === true,
    JSON.stringify(signals)
  );
  check(
    'which is the same level its own release drives',
    await (async () => {
      const r2 = new CatController();
      const s2 = [];
      r2.serialPort = { setSignals: async (x) => { s2.push(x); }, writable: {}, readable: {} };
      await r2.setPtt(false, 'RTS', 'ACTIVE_LOW');
      return s2[0].requestToSend === true;
    })()
  );
}

// ----------------- Z13: a keying method that rides on audio fails when the audio does not

group('Audio-keyed methods need their carrier');

{
  // VOX and the right-channel tone key the radio WITH audio. A test that could not start the
  // carrier has keyed nothing, and must not report otherwise.
  const rig = new CatController();
  const { audioEngine } = await import('../src/dsp/audioEngine.ts');
  const realStart = audioEngine.startTuneTone;
  const realStop = audioEngine.stopTransmission;
  audioEngine.startTuneTone = () => false;
  audioEngine.stopTransmission = () => {};
  const result = await rig.testPttKey('VOX', 'ACTIVE_HIGH', 5);
  audioEngine.startTuneTone = realStart;
  audioEngine.stopTransmission = realStop;

  check('a VOX test with no audio carrier FAILS', result.success === false, result.message);
  check('...and leaves PTT de-asserted', rig.getPtt() === false);
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

// ------------------------------------------- the shipped identity is nobody's real station

group('The shipped placeholder callsign cannot be transmitted under');

{
  // The default used to be W1AW - a real, active station licensed to a national amateur radio
  // society. A placeholder that is somebody's licence is only ever kept off the air by an exact
  // equality check, and every fallback that stands in for an unset operator callsign (ADIF and
  // Cabrillo exports, QSO macros, injected test frames) reached for that same string. These
  // checks are computed from the constant itself, so re-pointing PLACEHOLDER_CALLSIGN at a real
  // callsign fails here rather than on the air.
  const rig = new CatController();

  check(
    'the shipped default config uses the placeholder constant',
    DEFAULT_STATION_CONFIG.myCall === PLACEHOLDER_CALLSIGN,
    `${DEFAULT_STATION_CONFIG.myCall} !== ${PLACEHOLDER_CALLSIGN}`
  );
  check(
    'the placeholder is not an assignable callsign in the first place',
    isValidCallsign(PLACEHOLDER_CALLSIGN) === false,
    `${PLACEHOLDER_CALLSIGN} passed isValidCallsign()`
  );

  // A station that is otherwise complete - region, licence class, a legal 20 m data frequency -
  // so the only thing left for the gate to object to is the callsign.
  const licensed = { regulatoryRegion: 'US', licenseClass: 'US_EXTRA' };
  const shipped = rig.canTransmit({ ...DEFAULT_STATION_CONFIG, ...licensed }, 1500, 14_076_000);
  check(
    'the gate refuses the shipped default',
    shipped.allowed === false,
    JSON.stringify(shipped.violations)
  );
  check(
    '...naming the placeholder, not just calling the callsign malformed',
    shipped.violations.some((v) => v.includes('placeholder') && v.includes(PLACEHOLDER_CALLSIGN)),
    JSON.stringify(shipped.violations)
  );

  // The placeholder rule runs before the syntax rule, and neither may cost a real station its
  // transmit: an operator who has configured the radio is exactly as free as before.
  const configured = rig.canTransmit(
    { ...DEFAULT_STATION_CONFIG, ...licensed, myCall: 'K1ABC' },
    1500,
    14_076_000
  );
  check(
    'a configured station on 20 m is still allowed',
    configured.allowed === true,
    JSON.stringify(configured.violations)
  );

  // ...and a callsign that is merely malformed still gets told so, rather than being mistaken
  // for the placeholder.
  const malformed = rig.canTransmit(
    { ...DEFAULT_STATION_CONFIG, ...licensed, myCall: 'HELLO' },
    1500,
    14_076_000
  );
  check(
    'a malformed callsign is refused on the syntax rule',
    malformed.allowed === false &&
      malformed.violations.some((v) => v.includes('syntactically valid')),
    JSON.stringify(malformed.violations)
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll transmit-path checks passed.');
