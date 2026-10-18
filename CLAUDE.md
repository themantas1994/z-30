# CLAUDE.md: z-30

AGENTS.md is the operating guide and is authoritative; this file imports it so Claude Code
loads it, and adds only model routing. Commands, invariants and what to run for each kind of
change are in AGENTS.md sections 4, 7 and 8.

@AGENTS.md

## Model routing
- Opus: `z30-dsp` receiver/decoder, LDPC/OSD/SIC, protocol constants, and anything in
  `txgate`, `ptt`, `runtime` or rig/PTT I/O (it keys real transmitters).
- Sonnet: GUI, CLI, config, logbook, tests, docs.
- Haiku (`explorer`): finding code, summarizing `research/results/` files, reading CI logs.
- The ~1 h `z30 --benchmark suite` runs only for publishing figures, following
  `docs/research-process.md`; don't start it unasked.
