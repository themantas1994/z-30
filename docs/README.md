# z-30 vNext documentation

The native Rust implementation of z-30: the protocol, the receiver, the station engine, the
hardware adapters, the CLI and the desktop GUI. These pages describe the code in `crates/` as
it is; every figure they quote names the file in `research/results/` it came from.

`wiki/` remains the operator documentation for the legacy browser/Python runtime until that
runtime is retired (an operator decision, see `VNEXT_IMPLEMENTATION_PLAN.md` section 8).
`SPEC.md` at the repository root is the normative protocol specification; `protocol-v1.md` here
is its guided tour.

| Page | What it covers |
| :--- | :--- |
| [architecture.md](architecture.md) | Crates, dependency direction, threads, the command/snapshot API |
| [protocol-v1.md](protocol-v1.md) | The frame, the codec and its refusal rule, what v1 cannot carry |
| [receiver.md](receiver.md) | `decode_slot` end to end, its configuration and report |
| [synchronization.md](synchronization.md) | Coarse Costas search, fine dt/f/drift search, the slot clock |
| [demodulation.md](demodulation.md) | Baseband extraction, symbol spectra, the Log-MAP metric, whitening |
| [ldpc.md](ldpc.md) | The four-schedule cascade, bit-exactness, the corrected OSD, AP |
| [sic.md](sic.md) | Least-squares interference cancellation and its measured suppression |
| [audio.md](audio.md) | cpal capture/playback, the SPSC ring, resampling, the sample clock |
| [hardware.md](hardware.md) | rigctld, serial RTS/DTR, CM108, VOX; what each can and cannot guarantee |
| [safety.md](safety.md) | The transmit gate, PTT defences, and the tests behind each rule |
| [benchmarking.md](benchmarking.md) | Every measured figure, how it was measured, and what is not measured |
| [development.md](development.md) | Building, testing, golden vectors, CI, house rules for this workspace |
| [troubleshooting.md](troubleshooting.md) | Symptoms, what they usually mean, and what to check |
