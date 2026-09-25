#!/bin/bash
# Exercises the RELEASE BINARIES themselves (not cargo test), in a throw-away Z30_HOME so no
# personal configuration or logbook is read or written. Every command and its output is logged;
# each check prints PASS or FAIL with the reason. No hardware is used: the container has no
# sound card, so anything that would need one is expected to fail to open it, and that failure
# is recorded as what it is.
#
# usage: release_artifact_checks.sh <dir with z30 and z30-gui> <repo root> <out log>
set -u
B=$1; R=$2; OUT=$3
T=$(mktemp -d); export Z30_HOME=$T/home; mkdir -p $Z30_HOME
pass=0; fail=0
say() { echo "$*" | tee -a $OUT; }
check() { if [ "$1" = 0 ]; then pass=$((pass+1)); say "PASS  $2"; else fail=$((fail+1)); say "FAIL  $2"; fi; }
run() { say "\$ $*"; "$@" > $T/o 2>&1; rc=$?; sed 's/^/    /' $T/o | tee -a $OUT > /dev/null; say "    (exit $rc)"; return $rc; }
: > $OUT
say "binaries: $B   repo: $R   commit: $(git -C $R rev-parse --short=12 HEAD)   Z30_HOME: $Z30_HOME"
say "sha256: $(sha256sum $B/z30 | cut -c1-64) z30; $(sha256sum $B/z30-gui | cut -c1-64) z30-gui"

# 1. Identity and provenance.
head=$(git -C $R rev-parse --short=12 HEAD)
run $B/z30 --version; v=$(cat $T/o)
[[ "$v" == *"commit:       $head"* && "$v" != *dirty* ]]; check $? "z30 --version names the clean commit $head"
[[ "$v" == *"features:     cm108"* ]]; check $? "z30 is built with CM108 PTT (the release configuration)"
[[ "$v" == *"with rustc "* && "$v" == *"runtime:      native; no Python, Node or browser component"* ]]; check $? "z30 --version names the compiler and runtime"
run $B/z30-gui --version; g=$(cat $T/o)
[[ "$g" == *"commit:       $head"* && "$g" == *"with rustc "* && "$g" == *"runtime:      native"* ]]; check $? "z30-gui --version has commit, compiler and runtime lines (N-14)"

# 2. What the binaries contain and link.
for f in z30 z30-gui; do
  n=$(strings $B/$f | grep -cw W1AW); [ "$n" = 0 ]; check $? "$f contains no W1AW ($n)"
  n=$(strings $B/$f | grep -c "web_dist\|index-DVWV6qtv\|node_modules\|web_server.py\|rf_time_sync"); [ "$n" = 0 ]; check $? "$f contains no retired browser/Python runtime strings ($n)"
  n=$(strings $B/$f | grep -ciE "libpython|PyInit_"); [ "$n" = 0 ]; check $? "$f has no Python runtime ($n)"
  run ldd $B/$f
  ! grep -qiE "python|node" $T/o; check $? "$f links no Python or Node library"
done
n=$(strings $B/z30 | grep -c "SYNC OK\|confidence: 99\|STABLE"); [ "$n" = 0 ]; check $? "no legacy fabricated status strings in z30 ($n)"

# 3. Receive/decode path and the TX-side verification.
run $B/z30 --encode "CQ K1ABC FN31" --wav $T/cq.wav --rate 44100 --f0 1400; check $? "--encode writes a verified frame"
run $B/z30 --decode $T/cq.wav; grep -q "CQ K1ABC FN31" $T/o; check $? "--decode reads it back through decode_slot"
grep -q "UTC unknown" $T/o && ! grep -q "19700101" $T/o; check $? "a recording with no start time is labelled 'UTC unknown', not 1970"
# 1790000010 = 59666667 x 30 is itself a slot boundary (2026-09-21 14:13:30 UTC), so the frame at
# the file's first sample is that slot. (Run 1 of this script expected 14:14:00: a script error.)
run $B/z30 --decode $T/cq.wav --start-utc 1790000010; grep -q "20260921 141330" $T/o; check $? "--start-utc gives the slot's real UTC"
for bad in "CQ K1ABC FN42" "ZY2ABC K1ABC -10" "K1ABC G4XYZ R-12" "CQ NOCAL FN31"; do
  run $B/z30 --encode "$bad" --wav $T/bad.wav; [ $? != 0 ] && [ ! -s $T/bad.wav ]; check $? "--encode refuses \"$bad\" and writes nothing"; rm -f $T/bad.wav
done

# 4. Loopback safety.
run $B/z30 --loopback-test --out $T/lb.json; rc=$?
[ $rc = 0 ] && grep -q '"source": "software-loopback"' $T/lb.json && grep -q '"pass": true' $T/lb.json; check $? "--loopback-test runs in software, needs no confirmation, and passes"
# ALSA prints its diagnostics when any device is opened on this card-less host; the JSON's own
# text mentions "no audio device", which run 1 of this script wrongly matched.
! grep -q "ALSA lib" $T/o; check $? "--loopback-test opened no audio device (no ALSA device-open diagnostics)"
printf '[ptt]\nmethod = "vox"\n' > $T/vox.toml
run $B/z30 --config $T/vox.toml --audio-loopback-test --confirm-no-transmitter; rc=$?
[ $rc != 0 ] && grep -q "refuses to play audio with this configuration" $T/o && ! grep -qi "ALSA" $T/o; check $? "--audio-loopback-test refuses a VOX configuration before opening a device (N-04)"
printf '[rig]\nrigctld_host = "localhost"\n' > $T/rig.toml
run $B/z30 --config $T/rig.toml --audio-loopback-test --confirm-no-transmitter; [ $? != 0 ] && grep -q "rig control is configured" $T/o; check $? "--audio-loopback-test refuses a rig-control configuration"
run $B/z30 --config $T/none.toml --audio-loopback-test; [ $? != 0 ] && grep -q "confirm-no-transmitter" $T/o; check $? "--audio-loopback-test needs --confirm-no-transmitter"
run $B/z30 --config $T/none.toml --audio-loopback-test --confirm-no-transmitter; say "    (with a PTT-less configuration it gets as far as opening the sound card, which this container does not have: exit $?)"

# 5. A fresh installation cannot transmit, and says why.
run $B/z30 --config $T/none.toml --diagnostics
for why in "No callsign" "regulatory region" "licence class" "PTT method" "no dial frequency is set" "transmit audio level is 0"; do
  grep -qi "$why" $T/o; check $? "fresh install: the gate refuses ($why)"
done

# 6. Logbook: a legacy z-30 ADIF export imports without its defaults; export carries provenance.
cat > $T/legacy.adi <<'ADI'
z-30 export
<ADIF_VER:5>3.1.4 <PROGRAMID:4>z-30 <EOH>
<CALL:5>K1ABC <QSO_DATE:8>20260920 <TIME_ON:6>101000 <GRIDSQUARE:4>FN31 <RST_SENT:3>-15 <RST_RCVD:3>-15 <FREQ:9>14.076000 <EOR>
<CALL:5>K2ABC <QSO_DATE:8>20260920 <TIME_ON:6>102000 <RST_SENT:3>-07 <FREQ:9>14.078600 <EOR>
ADI
run $B/z30 --import-adif $T/legacy.adi; grep -q "legacy ADIF importer's default" $T/o; check $? "legacy z-30 ADIF: the importer's -15 / 14.076 MHz defaults are dropped and reported"
run $B/z30 --export-adif $T/out.adi; cat $T/out.adi >> $OUT
grep -A0 "K1ABC" $T/out.adi | grep -qv "<FREQ:"; check $? "exported K1ABC has no fabricated FREQ"
grep "K2ABC" $T/out.adi | grep -q "FREQ=legacy_import"; check $? "exported K2ABC keeps its frequency, labelled legacy_import"

# 7. Benchmark entry points run the production receiver and record provenance.
run $B/z30 --benchmark perf --frames 2; check $? "--benchmark perf runs"
run $B/z30 --benchmark awgn --frames 3 --out $T/bench; rc=$?
[ $rc = 0 ] && python3 - "$T/bench/awgn.json" "$head" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); p = d["provenance"]
assert p["git_commit"] == sys.argv[2], p["git_commit"]
assert "decode_slot" in p["receiver"] and p["hardware_involved"] is False
assert d["seed"]["suite_seed"] == 20260830 and d["seed"]["published_seed"] is True
assert d.get("exploratory")
PY
check $? "--benchmark awgn records commit, decode_slot, no hardware, the published seed, exploratory size"
run $B/z30 --benchmark fading --frames 2 --out $T/bench; python3 -c "import json,sys; d=json.load(open('$T/bench/fading.json')); assert '2 sigma_D' in d['doppler_definition'] or 'sigma_D' in d['doppler_definition']; assert 'N-01' in d['doppler_fix']"; check $? "--benchmark fading states the Doppler definition and the withdrawn model"

say ""
say "RESULT: $pass passed, $fail failed"
rm -rf $T
[ $fail = 0 ]
