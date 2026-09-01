# 13. Operating Safety, Compliance & Local Security

This application keys real transmitters over serial, CM108, GPIO and audio VOX, and it exposes
a local HTTP API to do it. The behaviours on this page are deliberate, they are covered by
tests, and they are not configurable away casually. If you are changing code that touches
transmit, the local API or the system clock, read this page first — every rule here exists
because the failure it prevents is expensive on the air.

---

## 🚦 Before z-30 will transmit at all

Every transmit entry point — the automatic QSO sequencer, the manual TX button, the tune
carrier, and the raw rigctl console's `T 1` / `\set_ptt 1` — passes through a single gate
(`canTransmit()` in `src/dsp/catController.ts`). It **fails closed**, and any refusal names the
exact condition that failed:

| Condition | Why |
| :--- | :--- |
| A syntactically valid callsign that is not the shipped `W1AW` placeholder | An unidentified transmission, or one under someone else's call, is a licence problem |
| A configured regulatory region and licence class | Band edges and sub-band privileges differ by country and by class; there is no safe way to guess either |
| Dial frequency **plus audio offset** inside a data-mode segment your class holds | The radiated frequency is not the dial frequency, and this is what puts a station out of band |

The band plan lives in `src/dsp/bandPlan.ts` and covers IARU Regions 1–3 plus the FCC Part 97
sub-band structure, with the date each entry was last checked. National rules vary and change:
the gate catches a mistuned VFO or a wrong band button, it does not replace knowing your own
licence conditions.

The console reaches the gate through a transmit context its caller supplies; with none supplied
it refuses to key at all rather than defaulting to permitting. Unkeying is never gated — refusing
to stop transmitting is not a safety property.

**The two wiring tests are the deliberate exception.** The browser's "PTT Key Test" and the
`z30 --wizard` PTT test key the radio without running `canTransmit()`: they assert the line for a
few seconds with no modulation, after an explicit confirmation, and release it in a `finally`.
They exist to prove a cable before a callsign or a band plan has been configured, which is
precisely when the gate would refuse. Point the rig at a dummy load or a frequency you hold
before you run either — nothing else is checking.

---

## ⏱️ Stuck-transmitter protection

Three independent layers, because the failure being defended against is "the software stopped
running":

1. **Browser-side maximum-transmission timer.** A frame is 24 s; `MAX_TX_SECONDS` is 40 s.
   Past that, PTT is force-released across every keying path.
2. **Server-side dead-man switch on the GPIO PTT line.** The browser must re-assert PTT every
   ~500 ms; if it stops, `z30_dsp/web_server.py` drops the pin within about two seconds. A
   crashed tab, a killed renderer or a sleeping machine cannot send a keepalive — and cannot
   run a browser-side timer either, which is why this layer has to exist separately. A hard
   40 s ceiling applies even if keepalives keep arriving.

   The browser sends this layer the **intent** (`keyed`) plus the wiring (`active_low`), and the
   server derives the pin level from the two. It used to be sent the level alone and recorded
   that as the keyed state, which is the opposite of the truth on an active-low interface: such
   a station registered no countdown when it keyed — so its own keepalives came back rejected
   and the browser force-unkeyed it about half a second into every frame — and registered one
   when it *stopped*, after which the watchdog "released" the line by driving it low, keying the
   transmitter with nobody watching. A defence that can produce the failure it defends against
   is worse than no defence, because it is trusted.
3. **`atexit` and `SIGTERM`/`SIGINT` handlers** that release every claimed GPIO pin, so killing
   the server does not leave a radio keyed.

---

## 🔐 The local API is authenticated

`z30_dsp/web_server.py` binds `127.0.0.1` only, but **loopback is not an authentication
boundary**: any page in any browser tab can `fetch()` a loopback URL, and a `text/plain` POST
is a CORS simple request that is sent with no preflight. Every `/api/` request must therefore
satisfy all three of:

- a bearer token (`X-Z30-Token`) minted fresh at each server start and injected only into the
  `index.html` that this process serves;
- an `Origin` header that is absent or exactly this server's own origin;
- a `Host` header naming this server's own loopback address and port, which blocks DNS
  rebinding.

No wildcard `Access-Control-Allow-Origin` header is sent anywhere, only the single configured
BCM pin can be driven, and the rigctld relay will only talk to loopback daemons.

`tests/test_web_server_api.py` asserts every one of these. A change that makes any of them pass
without the token, from a foreign `Origin`, or against an arbitrary GPIO pin is a regression,
not a convenience.

---

## 🕐 The system clock

z-30 keeps its clock correction to itself as `app_time_offset_ms`, which is all its slot timing
needs. A time station is an unauthenticated broadcast; a marginal decode — or a deliberately
transmitted spoof — would otherwise move the host clock arbitrarily, taking TLS validity, log
timestamps and cron with it.

Stepping the machine's clock from a decoded time station is therefore:

- **opt-in** (`"allow_set_system_clock": true` in `~/.z30/config.json`, or
  `Z30_ALLOW_SET_SYSTEM_CLOCK=1`),
- **confirmed** interactively,
- **bounded to 5 minutes**, and
- **refused** when an NTP daemon already owns the clock.

`tests/test_time_sync_guards.py` guards the default and the bound. See
[07. RF Time Synchronization Engine](07-RF-Time-Synchronization-Engine.md).

---

## 📓 Your logbook is a file

Contacts are mirrored to `~/.z30/logbook.json` with an ADIF export written beside them
(`XDG_CONFIG_HOME` is honoured; see `z30_dsp/paths.py` for the full resolution order). The
browser copy is a cache. Clearing browsing data, a private window, a different browser or a
different port number all lose `localStorage`; none of them touch the file. A failed save is
shown in the UI rather than logged to a console nobody reads.

---

## ⚠️ What is still on you

Rendering a clean waveform in software is necessary, not sufficient.

**Capture your transmitter's actual output and check the occupied bandwidth on a spectrum
analyser before using this on the air** — sound-card clipping and rig ALC will re-broaden a
clean signal, and no amount of correct DSP upstream prevents that.

z-30 is an experimental mode. It is not coordinated with any band plan authority, it has no
established calling-frequency convention beyond the defaults shipped in the Band Manager, and
you remain responsible for your licence conditions, your ALC levels, and everything your
station radiates.
