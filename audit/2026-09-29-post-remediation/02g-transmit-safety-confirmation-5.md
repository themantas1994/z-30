# Fifth transmit-safety confirmation of F-08 (PR #46, reviewed at 39bfac2 = 6003522 plus its build.rs fix)

**Verdict: FINDINGS. F-08 is VERIFIED, with Medium findings against the new clippy layer.** I tried to reach a transmitter from `src/loopback.rs` in every way you listed, and every attempt was rejected by at least one CI-enforced layer. No mutant got past both. But the clippy layer is not a self-standing guarantee, and the test does not catch three of the ways to switch it off. The syn allowlist is still essential, not a "second layer".

Validation state is unchanged: **hardware not validated; on-air not validated.**

## How I ran it
- **Read-only on `/home/user/z-30`.** I made a new detached worktree at `/tmp/claude-0/mut-v10` from 6003522 and used `CARGO_TARGET_DIR=/tmp/claude-0/mut-v3-target` (no new target directory).
- **6003522 does not pass clippy as committed.** At that commit, clippy on 1.95 fails on `build_support.rs` with 8 disallowed-method/type errors, because `clippy.toml` also applies to the build script. CI would have been red. Following your note, I moved the worktree to 39bfac2, whose only change is the allow in `build.rs`. `loopback.rs`, `clippy.toml` and the guard are byte-identical to 6003522.
- **Each mutant:**
  - I touched the crate's sources, then ran `cargo +1.95 clippy --locked -p z30-cli --bin z30 -- -D warnings` and the same with `--all-targets`.
  - I ran the `loopback_isolation` test binary, built once from the clean tree. It reads the source at run time, so its verdict does not depend on whether the mutant compiles.
  - Restore after every mutant: `git status --porcelain` was empty after each run.
  - The worktree has been removed. I left the `scratchpad/mutwt` worktree (not mine) alone.
- **Nothing touched hardware.**
  - Clippy only type-checks, and the syn test only parses text. No mutant binary was run.
  - Payloads sit in `if runs.len() == usize::MAX { .. }` and name `192.0.2.1:9` or `/dev/null`.
- **Unmutated 39bfac2 is clean:** clippy `--bin`, `--all-targets` and `--all-targets --features cm108`. `loopback_isolation` 5/5 and `loopback_report_target` 3/3 pass.
- The harness and raw results are in `/tmp/claude-0/-home-user-z-30/8be4e4af-6756-5b1c-8cec-77eee1f12891/scratchpad/v10/` (`mut_v10.py`, `run.json`, `run2.json`, `run3.json` and the `.out` files).

## (a) Is the clippy layer working? Mutants that bypass syntax-level checks

Each cell says whether that check rejected or accepted the mutant. "syn" is `the_software_loopback_reaches_only_an_allowlist_of_crates_and_items`; where marked "+deny" the deny-list test failed too.

| Mutant | clippy `--bin` / `--all-targets` | syn guard |
|---|---|---|
| C0 control: `std::fs::File::create` | rejected (`std::fs::File`) | rejected |
| A1 `use std::fs::OpenOptions as Opts` in a block | rejected | rejected |
| A2 `use std::net::*` in a block, then `TcpStream::connect` | rejected | rejected |
| A3 `type Wire = std::net::TcpStream` | rejected | rejected |
| A4 `macro_rules!` builds `std::$a::$b::connect` from metavariables | rejected | rejected |
| A5 `json!({"x": std::process::Command::new(..)..})` | rejected | rejected |
| A6 `write!(std::fs::File::create(..).unwrap(), ..)` | rejected | rejected |
| A7 `matches!(std::net::UdpSocket::bind(..), Ok(_))` | rejected | rejected |
| A8 nested `format!(vec![json!(std::fs::read_to_string(..))])` | rejected | rejected |
| A9 generic `fn<A: ToSocketAddrs>`, calling the trait method | rejected (`to_socket_addrs`) | rejected |
| A10 function pointer `let f: fn(..) = std::fs::write` | rejected | rejected |
| A11 closure around `Command::new` | rejected | rejected |
| A12 `impl Display for Sink` that opens a `File`, called through `to_string()` | rejected | rejected |
| A13 generic fn given the path value `std::fs::read` | rejected | rejected |
| A14 `<z30_engine::ptt::PttController>::new(Box::new(VoxPtt), ..).key()` | rejected | rejected +deny |
| A15 `use z30_io::audio as a; a::CpalOutput::open(None)` | rejected | rejected +deny |
| A16 `let _s = z30_engine::runtime::start;` | rejected | rejected +deny |
| **B1 `crate::audio_loopback::run(&Default::default(), true, None)`** (LOOP-e) | **accepted** | rejected +deny |
| **B2 `z30_io::wav::write_mono(Path::new("/dev/null"), ..)`** | **accepted** | rejected +deny |
| **B3 `extern "C" { fn open(..) }` plus `unsafe { open(c"/dev/null".as_ptr(), 1) }`** | **accepted** | rejected |

On the first runs, A10 and A13 failed to compile (lifetime typing), so they proved nothing. I fixed them with `'static` and re-ran them, and the table shows the valid results.

Every listed item is caught, whatever the macro, alias, glob, trait, closure, function pointer, impl or generic form. A14–A16 show that the `z30_engine`/`z30_io` paths in `clippy.toml` resolve, and no run printed a config warning about an unresolved path.

## (b) Hazards `clippy.toml` does not list

Clippy only checks calls made inside the file that forbids the lints. Anything those calls reach inside another module or crate is invisible to it.

1. **Functions defined in this crate (B1). This matters for keying.** `audio_loopback::run` with a PTT-less default config and `confirmed = true` would play the frame through the sound card: exactly N-04, the VOX case. Clippy accepts it. The syn allowlist (only `crate::version_text`) and the deny-list are the only things that catch it.
2. **`z30_io` functions that open a path the caller supplies (B2). This matters: opening a tty asserts DTR/RTS.**
   - `z30_io::wav::write_mono` and `read_mono` (`crates/z30-io/src/wav.rs:10,25`)
   - `paths::load_config` and `save_config` (`paths.rs:36,45`)
   - `logbook::Logbook::open` (`logbook.rs:108`)
   - `migrate::migrate_config` and `migrate_logbook`

   None of them is listed. Only syn's wholesale ban on `z30_io` stops them.
3. **FFI and `unsafe` (B3). This matters: a raw `open(2)` on `/dev/ttyUSB0` keys a serial-PTT radio.** `loopback.rs` has no `forbid(unsafe_code)`, and `z30-cli` does use `unsafe` (the counting allocator in `main.rs:36-42`). Only syn's refusal of `extern` blocks and unlisted macros (`asm!`) stops this.
4. **Not a keying hazard:**
   - `std::fs::exists`, `soft_link` and the `Path::*` stat and read_dir methods do not open a device (`O_DIRECTORY` fails before the driver opens).
   - `z30_io::wallclock` runs `timedatectl`; `audio::list_devices` only enumerates.
   - `z30_engine::ptt::refuse_further_keys` and `install_panic_release` cannot key.
   - The crates syn allows (`z30_dsp`, `z30_protocol`, `z30_channel`, `rand`, `rustfft`, `serde_json`, and the allowed `z30_engine` modules) have no file, network or process I/O (checked with grep).
   - Method names are not checked by syn, but no value syn admits has a method that opens anything.

## (c) Can the forbid be lifted, and is removal caught?

| Mutation | clippy | syn test | Result |
|---|---|---|---|
| L1 inner `#[allow(clippy::disallowed_methods)]` on a fn | rejected, E0453 | rejected | cannot be lifted. **But E0453 appears only under clippy:** plain `cargo +1.95 check` accepts the allow with only a dead-code warning. |
| L2 forbid line removed (+C0) | **accepted** (`main.rs`'s crate-level allow applies) | rejected (forbid check) | KILLED by the test |
| L3 `forbid` changed to `deny`, plus an inner allow | **accepted** | rejected | KILLED |
| **L6 `#![allow(unknown_lints)]` + `#![forbid(clippy::disallowed_methods_x, clippy::disallowed_types_x)]`, file otherwise unchanged** | accepted | **passes** | **SURVIVED.** `loopback_isolation.rs:392` uses substring `contains`. |
| L6c the same with the C0 payload | **accepted** | rejected (the payload) | syn holds |
| **L4b `clippy.toml` loses `PttController`** | accepted | **passes** | **SURVIVED.** `:397-406` checks only 7 of the 40 entries. |
| L4 loses `UdpSocket` and `PttController`, plus a `UdpSocket::bind` payload | **accepted** | rejected (the payload) | syn holds |
| **L5b an empty `crates/z30-cli/.clippy.toml`** | accepted; it prints "using config file `.clippy.toml`, `clippy.toml` will be ignored", which `-D warnings` does not turn into an error | **passes** | **SURVIVED.** The test reads only `clippy.toml`. |
| L5 the same with the C0 payload | **accepted** (exit 0) | rejected | syn holds |

## Findings (most severe first)

1. **Medium: three ways to switch off the clippy layer pass every test (L6, L4b, L5b).**
   - **Where:** `crates/z30-cli/tests/loopback_isolation.rs:389-406`.
   - **Sequence:** add an empty `.clippy.toml`, or rename the forbidden lints and allow `unknown_lints`, or drop any of the 33 entries the test does not pin. CI clippy then passes with no clippy protection on `loopback.rs`.
   - **Effect today:** none on the air, because the syn allowlist still refuses every payload. The 02f-requested claim that "removing it or the list is caught by a test" holds only for removing the forbid line, a `deny` downgrade, and the 7 pinned entries.
   - **Fix:**
     - Parse the forbid's lint paths and compare them exactly, and refuse any other lint attribute in `loopback.rs` (`allow`, `expect`, `warn`).
     - Assert that neither `.clippy.toml` nor a parent `clippy.toml`/`.clippy.toml` exists, and that CI does not set `CLIPPY_CONF_DIR`.
     - Parse `clippy.toml` (`toml` is already in the lockfile) and assert the complete expected set of entries.
2. **Medium: the docs overstate the clippy layer, and it does not cover crate-local calls, unlisted `z30_io` path openers, or FFI (B1–B3).**
   - **Where:** `docs/safety.md:117-123`, `AGENTS.md` §4, `clippy.toml` header, `loopback.rs:28-30`.
   - **Problem:** they present clippy as the guarantee and syn as a second layer. For LOOP-e (the original F-08 mutation), `wav::write_mono` on a tty, and a raw `open(2)`, syn is the only layer.
   - **Fix:**
     - (i) Add `#![forbid(unsafe_code)]` to `loopback.rs`. Rustc enforces it, without depending on clippy. Assert it in the test.
     - (ii) List `z30_io::wav::{read_mono, write_mono}`, `z30_io::paths::{load_config, save_config}`, `z30_io::logbook::Logbook`, `z30_io::migrate::{migrate_config, migrate_logbook}`, and the crate's own `audio_loopback::run` and `write_report_file`, if clippy 1.95 accepts local paths for a bin crate. Or better, as 02f recommended: move the software loopback into its own library crate with no `z30-io`/`cpal` dependency and guard its `Cargo.toml`.
     - (iii) Reword the docs so the syn allowlist is described as required, not as a backup.
3. **Low (process): 6003522 failed CI clippy on the build script.** Locally reused clippy results hid it. 39bfac2 fixes it. Anyone confirming a lint-config change should touch the crate's sources before running clippy, so it re-lints.

## Mutation table

- **(a) bypass mutants:** 20 valid.
  - 17 rejected by both clippy and syn (A1–A16, C0).
  - 3 rejected by syn only (B1–B3).
  - **0 accepted by both.**
- **(c) lift and removal mutants:**
  - Killed by the test: L1 (also E0453 under clippy), L2, L3.
  - **Survived** (clippy layer disabled, the test does not notice): L4b, L5b, L6.
  - With a hazardous payload on top (L4, L5, L6c), syn always rejected it.

## Verdict table

| Ledger item | Verdict | Evidence |
|---|---|---|
| **F-08** (the loopback cannot reach a transmitter) | **VERIFIED** (both layers together; findings 1–2 open) | I carried out the fresh bypass search across every form you listed. Nothing got past both layers. The syn and deny-list tests pass on 39bfac2, and CI runs clippy `-D warnings` on Linux, Windows, macOS and 1.95. Findings 1–2 should be fixed before anyone relies on the clippy layer alone or treats syn as optional. |

## Files
- `/home/user/z-30/crates/z30-cli/src/loopback.rs` (forbid at line 31)
- `/home/user/z-30/crates/z30-cli/clippy.toml`
- `/home/user/z-30/crates/z30-cli/tests/loopback_isolation.rs` (lines 389-406)
- `/home/user/z-30/crates/z30-cli/build.rs` (the allow added in 39bfac2)
- `/home/user/z-30/crates/z30-io/src/wav.rs` (lines 10, 25), `paths.rs` (36, 45), `logbook.rs` (108)
- `/home/user/z-30/docs/safety.md` (lines 117-123)
- Evidence: `/tmp/claude-0/-home-user-z-30/8be4e4af-6756-5b1c-8cec-77eee1f12891/scratchpad/v10/`

I wrote no report file into the repository; filing this as `02g` is up to you.
