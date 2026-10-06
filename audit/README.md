# Audit records

Everything under `audit/` is **historical**: reports and evidence from past reviews, kept for
provenance and so that published figures can be reproduced. Each report describes the repository
as it was when the audit ran, including code and files that have since been removed. None of it
is current guidance or a current project instruction. How the project works today is described in
[`SPEC.md`](../SPEC.md), [`docs/`](../docs/README.md) and [`wiki/`](../wiki/Home.md); where they
disagree with an audit, they are right.

**Finding identifiers.** Identifiers such as `F-01`, `C-01` and `N-01` in code comments and
documentation refer to findings in these reports. The 2026-09-28 list is in
[`2026-09-28-agent-team-review/07-board-packet.md`](2026-09-28-agent-team-review/07-board-packet.md).
Current pages that cite one explain the rule in their own words, so a reader does not need to
open the report.

**Removed files.** Older reports link to files that no longer exist in the working tree,
including the two status ledgers `ACTIVE_DEFECT_LEDGER.md` and `ACTIVE_REMEDIATION_HISTORY.md`,
the retired Python and browser implementations, and their tests. Those links no longer resolve.
The files remain available through Git history (for example `git log --diff-filter=D --
<path>`, then `git show <commit>^:<path>`). Reports are not rewritten to hide this, and nothing
has been invented to replace what they cite.

The evidence rules are in [`EVIDENCE_POLICY.md`](EVIDENCE_POLICY.md).
