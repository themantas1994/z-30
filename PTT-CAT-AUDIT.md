# PTT & CAT audit — 2026-08-31

Scope: every path in this repository that can key a transmitter or send a CAT command —
`src/dsp/catController.ts`, `src/dsp/ratProtocols.ts`, `src/dsp/localServerApi.ts`, `src/App.tsx`,
the two settings modals, `z30_dsp/web_server.py`, `z30_dsp/config_wizard.py`,
`z30_dsp/gui_tkinter.py`, `z30_dsp/band_manager.py` and `z30_dsp/main.py`.

Trigger: an operator reports that z-30 connects to the radio successfully and then sends nothing —
no PTT during the transmit cycle.

**This is a review document, not a fix.** Nothing in the transmit path was changed. Every finding
below was reproduced by running the real code; the commands and their actual output are quoted.
`wiki/06` and `wiki/13` were read first and are treated as the specification; where code and wiki
disagree, the wiki is taken as correct and the code is the defect.

The existing guard suite (`tests/transmitPath.test.mjs`) **passes** with all of this present —
see finding 15.

---

## Summary

| # | Severity | Finding |
| :-- | :--- | :--- |
| 1 | Critical | The `CAT` keying method reports success without sending anything |
| 2 | Critical | The server's GPIO dead-man switch is polarity-blind: an `ACTIVE_LOW` station is cut off mid-frame, then re-keyed 2 s after it stops |
| 3 | High | All 30 Yaesu rigs in the catalog are sent commands that cannot key them |
| 4 | High | CM108/CM119 keying ignores `pttPolarity` — inverted keying on active-low wiring |
| 5 | High | The Tk setup wizard's "PTT Key Test" keys nothing and reports success |
| 6 | High | `z30 --tkinter` (and the automatic fallback in `main.py`) simulates transmitting |
| 7 | High | Serial pairing reports "✓ Real Serial Hardware Paired" when the port failed to open |
| 8 | Medium | `App.tsx` discards `setPtt()`'s return value — audio is transmitted into a radio still in RX |
| 9 | Medium | A `rigctld` error reply (`RPRT -1`) is logged as `OK`, and `setPtt` returns before the daemon answers |
| 10 | Medium | "Test CAT Connection" routes on `config.serialPort`, so it can test a different path than the one that transmits |
| 11 | Medium | A band change sends two different frequencies; a custom dial is overwritten by the stock one |
| 12 | Medium | The Tk wizard's CAT test fabricates a VFO reading when `rigctld` returns an error |
| 13 | Low | `pttPort` and `winkeyerPort` are never used; RTS/DTR/WinKeyer drive whatever single port is paired |
| 14 | Low | `dataBits`, `stopBits` and `handshake` are collected in the UI and never reach `port.open()` |
| 15 | Low | The guard suite covers CM108/RPi/TCI/WinKeyer but not `CAT`, `RTS` or `DTR` |
| 16 | Low | `HamlibCatClient.set_ptt()` is a second keying implementation with no gate (currently unreferenced) |

Findings 1, 3, 5, 6, 7 and 10 each independently produce exactly the reported symptom: a green
connection tick followed by a transmit cycle in which the radio never keys.

---

## 1. Critical — the `CAT` keying method reports success without sending anything

`src/dsp/catController.ts:652-655`

```ts
if (method === 'CAT') {
  this.sendRigPtt(tx);
  hardwareDetail = `CAT command (${this.hardwareCommandStatusNote()})`;
  this.logCommand(`set_ptt ${tx ? '1' : '0'}`, this.hardwareCommandStatusNote(), 'OK');
}
```

`sendRigPtt()` (`:490`) has three ways of doing nothing at all, none of which is reported:

- `useHamlibRelay()` (`:352`) is false — the relay is off, a serial port is paired, or the page is
  not served by the native server — **and** `activeProtocolFamily === 'NONE'`, so neither branch runs;
- the family is `CIV`/`KENWOOD` but `sendHardwareBytes()` (`:1357`) returns immediately because
  `this.serialPort` is null or `writable` is null (`if (!this.serialPort || !this.serialPort.writable) return;`);
- `sendHardwareBytes()` catches a write error and only `console.warn`s it.

`hardwareOk` stays `true` through all of them, the log line is written with status `OK`, and
`setPtt()` returns `true`. Observed:

```
$ npx tsx probe.mjs
A) setPtt(true,"CAT") with no protocol/no port returned: true
   getPtt(): true
   log: {"command":"set_ptt 1","response":"no rig protocol configured (state tracked locally only)","status":"OK"}
B) testPttKey("CAT") success: true | ✓ CAT PTT verified: CAT command (no rig protocol configured
   (state tracked locally only)) was asserted and released after the 0s safety cutoff.
C) CI-V configured, no serial port open -> testPttKey success: true | ✓ CAT PTT verified:
   CAT command (CI-V 0x94) was asserted and released after the 0s safety cutoff.
```

Case C is the operator's situation: a correctly selected IC-7300, no open port, and a green
**"✓ CAT PTT verified"**.

This is the same defect AGENTS.md §4 records as already removed once — "four of nine methods in the
old parallel implementation only wrote to the command log and returned 'verified' for hardware they
never addressed". It was removed from `testPttKey()` but survives one level down, in `setPtt()`
itself, for the method that ships as the default (`DEFAULT_STATION_CONFIG.pttMethod = 'CAT'`).

It also breaks the invariant stated in the same section: `setPtt()` "returns whether the hardware
actually accepted the command". For `CAT` it returns whether the function was called.

Suggested direction: give `sendRigPtt()` (and `sendRigFrequency`/`sendRigMode`) a boolean return —
false when no protocol is configured, when there is no writable port, and when the write throws —
and have the `CAT` branch set `hardwareOk`/`failureNote` from it and log `ERROR`. The status note
already contains the right words ("no rig protocol configured (state tracked locally only)"); it is
only the status that lies.

## 2. Critical — the GPIO dead-man switch is polarity-blind

`z30_dsp/web_server.py:205-262` and `src/dsp/catController.ts:1441`

`setRpiGpio()` sends the *electrical level* to the server:

```ts
const activeLevel = polarity === 'ACTIVE_HIGH' ? tx : !tx;
const result = await setGpioPin(bcmPin, activeLevel);
```

`_write_pin()` treats that level as *keyed/unkeyed*: `active` true registers the dead-man
countdown, false clears it. For an `ACTIVE_LOW` interface the two are inverted. Observed against
the real `GpioBridge` with a stubbed `gpiozero`:

```
key  (ACTIVE_LOW ->  value=False): {'success': True, 'pin': 17, 'value': False, ...}
  dead-man registered?  False
  keepalive 500 ms later: {'success': False, 'error': 'BCM pin 17 is not keyed.', 'keyed': False}
unkey(ACTIVE_LOW ->  value=True): {'success': True, 'pin': 17, 'value': True, ...}
  dead-man registered after UNKEY?  True
```

Three consequences, in order of severity:

1. **After the operator releases PTT, the watchdog keys the transmitter.** The release registers a
   countdown; two seconds later the watchdog "releases" the pin by writing low — which on an
   active-low interface *is* PTT asserted, with nobody watching:

   ```
   line level right after unkey : True  (high = RX on an active-low interface)
   [z-30 WebUI] PTT watchdog released BCM pin 17: keepalive timeout - browser stopped asserting PTT
   line level 2.6 s later       : False (low  = PTT ASSERTED on an active-low interface)
   ```

   The layer that exists to prevent a stuck transmitter creates one.

2. **Every transmission is cut off ~500 ms in.** The keepalive (`catController.ts:792-800`) gets
   `success: false`, concludes the server already dropped the line, logs `PTT_DEADMAN_EXPIRED` and
   calls `forceUnkey()`. An `ACTIVE_LOW` Pi station cannot complete a 24 s frame. This is the
   reported symptom in a different shape: it keys, then instantly stops.

3. `any_pin_keyed()` (`:272`) is inverted too, so `/api/update/apply` believes the station is idle
   while it is transmitting, and idle-looking while it is not.

Suggested direction: the polarity belongs on the server, next to the pin it applies to. Send
`{pin, keyed}` (intent) rather than `{pin, value}` (level), configure the polarity where the pin is
configured (`--gpio-pin`, alongside a `--gpio-active-low`), and let `_write_pin` derive the level.
`wiki/13`'s three-layer description stays true only if the layers agree on what "keyed" means.

## 3. High — 30 Yaesu rigs are sent commands that cannot key them

`src/dsp/ratProtocols.ts:112-155`

`getProtocolFamilyForMfg()` maps `yaesu` to `KENWOOD`, and the Kenwood builders emit:

```
kenwoodSetPtt(true)  -> "TX;"
kenwoodSetPtt(false) -> "RX;"
kenwoodSetFrequency  -> "FA00014074000;"   (11 digits)
kenwoodSetMode('USB')-> "MD2;"
```

These are correct for Kenwood and Elecraft. On modern Yaesu CAT they are not:

- `TX;` is the **read** form; the setter is `TX1;` (CAT transmit) — `TX;` returns a status string
  and keys nothing;
- there is no `RX;` command; releasing is `TX0;`;
- `FA` takes **9** digits (`FA014074000;`), not 11;
- mode is `MD0x;` (a P1 channel digit first), not `MDx;`.

So a Yaesu operator gets a CAT link that answers `FA;` (which is why "Test CAT Connection" passes —
see finding 10), a dial that never moves, and a PTT that never asserts. `wiki/06` lists the FT-710
and FT-991A as CAT-keyable, and the catalog carries 30 `mfg: 'Yaesu'` entries marked `STABLE` with
`'CAT'` in `supportedPtt`, so the wiki and the catalog both promise what the wire does not deliver.

Suggested direction: a third family (`YAESU`) with its own three builders, or an explicit refusal
for Yaesu in Direct Serial mode with a message pointing at `rigctld`. The comment block at the top
of `ratProtocols.ts` already sets the precedent for the second option ("old CAT ... intentionally
left as a known gap rather than guessed at") — a known gap is honest, a wrong command is not.

## 4. High — CM108/CM119 keying ignores `pttPolarity`

`src/dsp/catController.ts:685-700`, `:1388`

```ts
hardwareOk = await this.setCm108Gpio(pin, tx);   // polarity never passed
```

`setRpiGpio` takes the polarity; `setCm108Gpio` does not exist in a polarity-aware form. Observed:

```
CM108 ACTIVE_LOW key/unkey drove: [{"pin":3,"active":true},{"pin":3,"active":false}]
RPi   ACTIVE_LOW key            : [{"pin":17,"tx":true,"polarity":"ACTIVE_LOW"}]
```

An operator with active-low DRA/URI wiring who sets `ACTIVE_LOW` gets the line driven the wrong way
in both directions: no carrier when transmitting, PTT asserted while receiving. `testPttKey()`
still reports `pinState: 'Negative / Pull-to-GND (Active Low)'` and `success: true`, because the
string is built from the argument, not from what was driven. Hamlib's own `cm108` backend supports
an inverted PTT for exactly this wiring.

## 5. High — the Tk setup wizard's PTT test keys nothing

`z30_dsp/config_wizard.py:784-806`

```python
def _key_ptt(self) -> None:
    self.is_ptt_keyed = True
    ...
    self.test_result_label.config(text=f"● TRANSMITTING via {method} [Pin: {pin_state}]...")
    self.after(3000, lambda: self._release_ptt() if self.is_ptt_keyed else None)

def _release_ptt(self) -> None:
    ...
    self.test_result_label.config(text="✓ PTT Released (Transmitter in RX Standby)")
```

No serial port, no GPIO, no `rigctld` — two label updates and a timer. An operator who configures
z-30 with `z30 --wizard` is shown "● TRANSMITTING via CAT Command [Pin: 1 (HIGH)]" followed by
"✓ PTT Released (Transmitter in RX Standby)" by code that has never addressed any hardware, and
concludes the wiring is good. This is the defect AGENTS.md §4 describes as removed from the
browser's `testPttKey()`, still live in the Python wizard.

## 6. High — `z30 --tkinter` simulates transmitting, and `main.py` falls back to it silently

`z30_dsp/gui_tkinter.py:305-357`, `z30_dsp/main.py:23-38`

`_start_tx()` sets `is_transmitting = True`, turns the button red and shows a modal reading
*"Starting 16-MFSK physical transmission at 1250 Hz"*. Nothing is keyed, no audio is synthesized,
and there is no `canTransmit()` equivalent anywhere in the file — no callsign check, no region or
licence check, no band-plan check. `_stop_tx()` announces "Rig returned to RX standby mode" the same
way. The 0.5 s clock thread flips the same flag at slot start.

`main.py` makes this reachable without asking for it:

```python
try:
    from z30_dsp.web_server import main as web_main
    web_main()
except Exception as e:
    print(f"[z-30] Web application launch notice: {e}. Falling back to Tkinter...")
```

A bare `z30` whose web server fails to start (port in use, missing `web_dist`, any exception) lands
the operator in the simulated GUI with one line of console output. If the reporter is running the Tk
GUI, that alone is the whole bug report: it can never key a radio.

Suggested direction: either wire this GUI to `HamlibCatClient` and a real gate, or label it what it
is (a receive/waterfall viewer) and remove the transmit controls. The silent fallback in `main.py`
should not substitute a UI with different transmit behaviour for the one the operator asked for.

## 7. High — serial pairing reports success when the port did not open

`src/dsp/catController.ts:973-1032`

```ts
try {
  await port.open({ baudRate });
  this.isSerialConnected = true;
  this.isConnected = true;
} catch (openErr: any) {
  if (String(openErr?.message).includes('already open')) { ... }
  else { console.warn('Could not open serial port immediately:', openErr); }
}
...
return { success: true, portInfo: matched, message: `✓ Real Serial Hardware Paired: ...` };
```

The return is unconditional. The most common real failure — the port is held by `rigctld`, WSJT-X or
a stale process — produces a console warning nobody reads and a green "✓ Real Serial Hardware
Paired" in the modal, with `serialPort` set to a port that is not open. Every later
`sendHardwareBytes()` then hits `!this.serialPort.writable` and returns silently (finding 1).

## 8. Medium — `App.tsx` discards `setPtt()`'s return value

`src/App.tsx:305`, `:317`, `:425`, `:450`, `:469`

```ts
rigctl.setPtt(true, config.pttMethod, config.pttPolarity, pttOptions);
setFwdWatts(config.txPowerWatts);
audioEngine.play16MfskSequence(...);
```

`setPtt` is `async` and its boolean is the only signal that the hardware accepted the command.
Nothing awaits it and nothing checks it, so when keying fails for a reason the controller *does*
detect (no paired port for RTS/DTR, unpaired CM108, unreachable TCI, GPIO bridge down), the app
still starts the 24 s carrier, still shows TX, and still reports forward watts. The controller sets
`pttState = false` on a failed key; the React `isTransmitting` state does not follow.

Two related things in the same call path:

- `setPtt` is not awaited before audio starts. For the relay this is an HTTP round trip to
  `rigctld`, which will not have completed within the 20 ms `pttLeadInMs` of silence that
  `audioEngine` inserts, so the first symbols can be radiated before the rig is in TX.
- `play16MfskSequence` has three early returns (`!this.ctx || !this.txGain`, an empty symbol list, a
  synthesis error — `audioEngine.ts:757-777`) that never invoke `onComplete`. PTT was already
  asserted by then, so the transmitter stays keyed until the 40 s watchdog, and `isTransmitting`
  stays `true` forever, which blocks every later cycle (`startActiveTransmission` returns early).

## 9. Medium — `rigctld` error replies are logged as `OK`

`src/dsp/catController.ts:360-370`, `z30_dsp/web_server.py:759-772`

```ts
void sendRigctlCommand(command, this.hamlibHost, this.hamlibPort).then((result) => {
  if (result.success) {
    this.logCommand(command, (result.data?.response || '').trim() || 'OK', 'OK');
```

`result.success` means the relay reached the daemon, not that the daemon did the thing.
`RigctlRelay.send()` returns `success: True` for any completed exchange, so `T 1` answered with
`RPRT -1` — which is what a daemon started with `-P NONE`, or against a rig whose PTT is not on the
CAT link, returns — is logged green. The rig control log is the operator's only diagnostic surface
here, and it says the command worked.

`relayRigctl` is also fire-and-forget by design ("the transmit path cannot block on a network round
trip"), so `setPtt()` has already returned `true` before the reply arrives. Parsing `RPRT <n>` and
logging non-zero as `ERROR` would at least make the failure visible; `testCatConnection` (`:1174`)
already does exactly this parse for `f`.

## 10. Medium — "Test CAT Connection" can test a different path than the one that transmits

`src/dsp/catController.ts:1085`

```ts
if (catMethod === 'Direct Serial' || (catMethod === 'Hamlib' && config.serialPort && !config.serialPort.startsWith('127.0.0.1'))) {
```

The routing is by `config.serialPort`, but the transmit path routes by `useHamlibRelay()` (`:352`),
which is `hamlibRelayEnabled && !isSerialConnected && isLocalServerAvailable()`. They disagree in
ordinary configurations:

- `DEFAULT_STATION_CONFIG.serialPort` is `'/dev/ttyUSB0 (COM3)'` — non-empty and not loopback — so a
  Hamlib user who never edits it gets the *Direct Serial* branch of the test while frequency, mode
  and PTT go through the *relay*, or vice versa.
- Pairing a Web Serial port for RTS keying sets `isSerialConnected`, which silently switches CAT
  from the relay to raw CI-V/Kenwood bytes on that port — with no UI indication that the CAT
  transport just changed.

Second half of the same finding: in Direct Serial mode a pass means **bytes were written**, not that
the rig answered. The message says so honestly ("response not parsed - this confirms the write
succeeded, not that the rig replied"), but it is rendered as a green ✓ next to the rig name, and
`serialReader` (`:273`) is only ever cancelled, never assigned — there is no read loop anywhere in
the controller, so no Direct Serial CAT operation can be verified even in principle. For a Yaesu
(finding 3) this is precisely how a rig that ignores every subsequent command still passes the test:
`FA;` is a valid Yaesu read, and writing it succeeds.

## 11. Medium — a band change sends two frequencies and discards the custom dial

`src/App.tsx:196-205`, `src/dsp/catController.ts:416`, `:427`

```ts
const targetHz = config.customBands?.[bandName] || band.dialFreqHz;
setDialFreqHz(targetHz);
rigctl.setFreqHz(targetHz);
rigctl.setBandByName(bandName);   // sends band.dialFreqHz again
```

`setBandByName()` re-sends the stock dial for the band. Observed:

```
frequencies actually sent to the rig for one band change: [14078000,14076000]
controller now believes the dial is: 14076000
```

The radio ends on the stock frequency while the app's `dialFreqHz` — the value handed to
`canTransmit()` as the dial — is the operator's custom one. The compliance gate then validates a
frequency the radio is not tuned to, which is the failure mode `wiki/13`'s dial-plus-offset rule
exists to prevent, arriving from the other direction. Custom band presets are a `wiki/14` feature,
so this is not a hypothetical configuration.

## 12. Medium — the Tk wizard's CAT test fabricates a VFO reading

`z30_dsp/config_wizard.py:747`

```python
freq_mhz = f"{int(resp)/1e6:.6f} MHz" if resp.isdigit() else "14.074000 MHz"
```

A `rigctld` that answers `RPRT -1` is reported as
`✓ Hamlib rigctld OK: <rig> on 127.0.0.1:4532 (VFO: 14.074000 MHz)` — a number invented by the
`else` branch, presented as the radio's. The same function also ignores the configured CAT method
entirely and branches on whether the port string contains a colon, so a Hamlib user on
`/dev/ttyUSB0` gets the serial branch, which merely opens and closes the port without sending a
single CAT byte and reports `✓ Serial Port OK`.

## 13. Low — `pttPort` and `winkeyerPort` are collected but never used

`src/dsp/catController.ts:656-670`, `:1461`

The RTS/DTR branch drives `this.serialPort` — the single paired Web Serial port — while reporting
`${method} pin on ${effectiveOptions?.pttPort || 'the paired serial port'}`. A station with CAT on
one port and PTT on a second (a Digirig or an FTDI cable alongside a CAT link, the wiring
`wiki/06` §2 describes) has no way to say so: the configured `pttPort` is displayed but ignored.
`setWinkeyerPtt()` likewise uses the CAT port and ignores `winkeyerPort`, and returns `true`
whenever `writable` exists, because `sendHardwareBytes()` swallows write errors (finding 1).

## 14. Low — `dataBits`, `stopBits` and `handshake` never reach the port

`src/dsp/catController.ts:996`

`port.open({ baudRate })` passes baud only, although `WebSerialPortLike.open` declares
`dataBits`, `stopBits`, `parity` and `flowControl`, the config carries all three, and both modals
collect them. The port always opens 8-N-1 with no flow control. Rigs configured for 2 stop bits or
hardware handshake will see framing errors rather than commands — another way to reach "connected,
but nothing happens".

## 15. Low — the guard suite does not cover `CAT`, `RTS` or `DTR`

`tests/transmitPath.test.mjs:140-180`

The "Test PTT reports real hardware outcomes" loops cover `CM108_GPIO`, `RASPBERRY_PI_GPIO`,
`TCI_NETWORK` and `WINKEYER` — the four methods that were fixed. The recording controller stubs
`sendRigPtt`, so the `CAT` branch is never exercised against a failing transport, and `RTS`/`DTR`
are absent. `CAT` is the default method and `RTS` is the most common hardware method, which is why
finding 1 has been invisible: the suite passes in full while it is live.

```
$ npx tsx tests/transmitPath.test.mjs
...
All transmit-path checks passed.
```

There is also no test anywhere asserting what the GPIO bridge does with an active-low station
(finding 2): `tests/test_web_server_api.py` covers the auth rules, not the keying semantics.

## 16. Low — a second, ungated keying implementation in Python

`z30_dsp/band_manager.py:141`

```python
def set_ptt(self, tx: bool) -> bool:
    resp = self.send_command(f"T {1 if tx else 0}")
    return resp.startswith("RPRT 0") or resp == "0" or resp == ""
```

Nothing calls it today (`grep` finds only `set_frequency`, `set_mode` and `get_frequency` in use),
so it is dead code rather than a live bypass — but it is a keying path with no compliance gate in
front of it, and it treats an empty reply (a timed-out read) as success. Worth deleting, or routing
through the same checks, before something calls it.

---

## What to fix first

The reporter's symptom is most likely finding 1 in combination with 3, 6, 7 or 10, depending on
their setup. Ordered by what makes the failure visible soonest:

1. **Finding 1** — make `sendRigPtt`/`sendRigFrequency`/`sendRigMode` report whether they wrote
   anything, and let `setPtt` fail on it. Nothing else in this list can be diagnosed by an operator
   while the app answers "✓ verified" to a command it never sent.
2. **Finding 2** — the dead-man switch currently manufactures the stuck transmitter it exists to
   prevent, on any active-low SBC station.
3. **Findings 5, 6 and 12** — the Python surfaces that report on hardware they never address.
4. **Findings 3 and 4** — wrong bytes and wrong levels for hardware the wiki says is supported.
5. **Finding 15** — extend the guard suite to `CAT`/`RTS`/`DTR` and to the server's keying
   semantics, so none of the above can come back quietly.
