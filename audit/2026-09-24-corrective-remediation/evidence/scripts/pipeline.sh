#!/bin/bash
# Post-fix pipeline on the clean code commit, in the main checkout.
set -u
S=/tmp/claude-0/-home-user-z-30/83055b07-507e-5352-8715-06f89f3f934c/scratchpad
R=/home/user/z-30
E=$R/audit/2026-09-24-corrective-remediation/evidence
C=$(git -C $R rev-parse --short=12 HEAD)
log() { echo "$(date -u +%FT%TZ) $*" >> $E/pipeline.log; }
mkdir -p $E
log "pipeline start at $C"
$S/gates.sh stable /home/user/tgt-stable $E/gates-final-1.98.1; log "stable gates done: $(tr '\n' ' ' < $E/gates-final-1.98.1/summary.txt)"
mkdir -p /home/user/bin-$C && cp /home/user/tgt-stable/release/z30 /home/user/tgt-stable/release/z30-gui /home/user/bin-$C/
/home/user/bin-$C/z30 --version > $E/suite_binary_version.txt
cd $R && /home/user/bin-$C/z30 --benchmark suite > $E/suite_run.log 2>&1; log "suite exit $?"
for s in 1 2 3 4 5 6 7 8 9 10; do
  cd $R && /home/user/bin-$C/z30 --benchmark awgn --seed $s --out research/results/$C/awgn_replicates/seed-$s > $E/awgn_seed_$s.log 2>&1; log "awgn seed $s exit $?"
done
$S/gates.sh 1.95.0 /home/user/tgt-195 $E/gates-final-1.95.0; log "1.95 gates done: $(tr '\n' ' ' < $E/gates-final-1.95.0/summary.txt)"
log "pipeline end"
