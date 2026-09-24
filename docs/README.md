# z-30 vNext documentation

z-30's application: the protocol, the receiver, the station engine, the hardware adapters, the
command-line station and the desktop GUI, all in the Rust workspace in `crates/`. These pages
describe that code as it is; every figure they quote names the file in `research/results/` it
came from, and says whether it was measured in simulation or on hardware (so far: always
simulation).

`SPEC.md` at the repository root is the normative protocol specification; `protocol-v1.md` here
is its guided tour. `wiki/` is the operator documentation and must agree with these pages; a
contradiction is a bug. The retired browser/Python runtime is documented only in
[`legacy/`](../legacy/README.md).

| Page | What it covers |
| :--- | :--- |
| [install.md](install.md) | Release archives, building from source, first run, migrating from the retired app |
| [architecture.md](architecture.md) | Crates, dependency direction, threads, the command/snapshot API |
| [protocol-v1.md](protocol-v1.md) | The frame, the codec and its refusal rule, what v1 cannot carry |
| [receiver.md](receiver.md) | `decode_slot` end to end, its configuration and report |
| [synchronization.md](synchronization.md) | Coarse Costas search, fine dt/f/drift search, the slot clock |
| [demodulation.md](demodulation.md) | Baseband extraction, symbol spectra, the Log-MAP metric, whitening |
| [ldpc.md](ldpc.md) | The four-schedule cascade, bit-exactness, the corrected OSD, AP |
| [sic.md](sic.md) | Least-squares interference cancellation and its measured suppression |
| [audio.md](audio.md) | cpal capture/playback, the SPSC ring, resampling, the sample clock |
| [hardware.md](hardware.md) | rigctld, serial RTS/DTR, CM108, VOX; what each can and cannot guarantee |
| [hardware-validation.md](hardware-validation.md) | The procedure for validating on real equipment (none performed yet) |
| [safety.md](safety.md) | The transmit gate, PTT defences, and the tests behind each rule |
| [benchmarking.md](benchmarking.md) | Every measured figure, how it was measured, and what is not measured |
| [development.md](development.md) | Building, testing, golden vectors, CI, house rules for this workspace |
| [troubleshooting.md](troubleshooting.md) | Symptoms, what they usually mean, and what to check |
