# Pre-test checklist — before any dummy-load test (docs/hardware-validation.md §R)

**Status: NOT READY. No hardware test may be scheduled on the basis of this file yet.** It lists
what the software team must be able to show before the licensed operator (the board) decides
whether a dummy-load test may proceed. Filling it in is not permission: the board's explicit
decision, recorded on a pull request, is (board packet 2026-09-28, blocker B14).

**Validation state: protocol validated; software simulation validated; hardware not validated;
on-air not validated.** Everything below marked "software" was shown with fake PTT lines, fake
audio devices and virtual clocks. Nothing was keyed.

Candidate commit: the head of the remediation pull request (branch
`claude/nice-archimedes-epwg4o`). Any later push invalidates the review items for the changed part.

| # | Item | State | Evidence | Still needed |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Transmit-safety findings closed (F-01…F-09, F-15…F-19, F-21, F-22, F-43…F-46; board blockers B1–B11) | **FIXED, PENDING REVIEW** | `audit/ACTIVE_DEFECT_LEDGER.md` rows; tests named there | `tx-safety-auditor` and `cto-code-reviewer` on the candidate commit; rows set to `VERIFIED` by them, not by the implementer |
| 2 | CI green on the candidate commit, including the paired production-decoder harness (B12) | **PENDING** | local: fmt, clippy (both feature sets), 218+ tests pass on rustc 1.95; paired harness smoke run passes locally with the PEP 440 version fix | GitHub CI on the pull request (Linux/Windows/macOS, MSRV, paired harness, golden, research tests) |
| 3 | Mutation tests reviewed | **RUN, PENDING REVIEW** | `audit/2026-09-28-remediation/evidence/tx-mutation/` (82 mutants: the audit's set re-targeted plus one per new guarantee) | the auditor's independent re-run and review; any survivor is a defect |
| 4 | Dummy-load procedure reviewed | **PENDING** | `docs/hardware-validation.md` §R | add, and have the board accept, the tests the remediation made possible (below) |
| 5 | Band plan reviewed | **BOARD DECISION** | F-02: US 6 m/2 m from 50.1/144.1 MHz, 60 m as five channels with the emission centred ±50 Hz; tests `bandplan::f02_*`, `gate_contract::f02_*` | the licensed operator confirms the reading of 47 CFR 97.305(c) and 97.303(h) against the current CFR; the IARU tables are whole-band allocations and the data sub-band is the operator's responsibility there |
| 6 | PTT failure recovery tested | **SOFTWARE ONLY** | `ptt_release.rs`, `ptt_panic.rs`, `tx_runtime::rt_an_unconfirmed_release_*` | R11 below, on hardware |
| 7 | HALT tested | **SOFTWARE ONLY** | `tx_runtime::rt_halt_*` (before key, while keyed, behind a blocked control thread, while the output is stuck; queued halts) | R9 below, on hardware |
| 8 | Output failure tested | **SOFTWARE ONLY** | `tx_runtime::rt_an_output_failure_*`, `rt_a_failed_play_*`, `audio::tests::f19_*` | R10 below, on hardware |
| 9 | Logging verified | **SOFTWARE ONLY** | `gate_contract::f17_*`, `f09_*`; `dial_provenance.rs`; `qso_logging.rs`; GUI shows "Logged" only after the logbook wrote it (by inspection; the GUI has no test harness) | a contact on the dummy load is logged with the right provenance (dial `reported_by_rig` with CAT; power `configured`) |
| 10 | Diagnostics verified | **SOFTWARE ONLY** | `z30 --diagnostics` prints the gate's refusals, the PTT line description, the rig answer and the audio device each direction would use | on the test station: the output names the intended interface, and no ambiguous device name is accepted |
| 11 | M-08 accepted or mitigated | **BOARD DECISION** | PTT stays keyed after SIGKILL or power loss for CAT and CM108 (hardware.md) | the board decides whether the radio's own time-out timer is acceptable as the last layer, and requires it enabled |
| 12 | Serial DTR/RTS at port open | **NOT MEASURED** | opening a serial port normally asserts DTR/RTS until `SerialPtt::open` drives the line released (F-43) | R8 in `docs/hardware-validation.md` (added by the documentation pass): measured on the dummy load with a meter or scope on the line — does the radio key briefly at GUI start, on a station restart or during `--diagnostics`? |

## Tests the remediation makes possible (proposed additions to docs/hardware-validation.md §R, after its R8)

Proposed, not yet accepted procedure. Dummy load only.

| ID | Test | How | Pass criterion |
| :--- | :--- | :--- | :--- |
| R9 | HALT | During a Tune or a frame, press HALT in `z30-gui` | RF stops within 200 ms; GUI shows the transmission `Aborted`; nothing is keyed in the next slot |
| R10 | Output failure while keyed | Unplug the USB audio interface mid-frame (per PTT method except VOX) | PTT released; GUI shows `TX fault: audio output failed…` and the gate refuses until the device is back; after replugging it reopens (≤ 5 s idle) or asks for a restart |
| R11 | Release not confirmed | With CAT PTT, stop `rigctld` mid-frame | GUI shows "PTT release NOT confirmed"; transmission refused; z-30 keeps retrying; when rigctld is restarted the release is confirmed and reported. Record whether the radio stayed keyed in between (its time-out timer is the only hardware layer) |
| R12 | Late key | With CAT PTT over a slow link, check the frame's audio duration on the SDR recording | 24.0 s of audio or the slot abandoned (`Aborted`), never a shortened frame reported complete |

## Sign-off

| Role | Name | Date | Decision |
| :--- | :--- | :--- | :--- |
| tx-safety-auditor (evidence) | | | |
| cto-code-reviewer (evidence) | | | |
| Board (licensed operator) | | | **Only this row authorises a dummy-load test** |
