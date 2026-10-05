"""paired_mcnemar.py: exact p-values, Holm, the paired bootstrap, and refusal to pair frame sets
that differ."""

import json

import pytest

from conftest import run
from paired_mcnemar import holm, mcnemar_exact

SEED = 20260830


def header(**kw):
    h = {"kind": "header", "benchmark": "awgn", "status": "published", "git_commit": "0123456789ab",
         "instrument_sha256": "a" * 64, "suite_seed": SEED, "replicate": 0, "frames_per_point": 4}
    h.update(kw)
    return h


def frames(outcomes, xs=(-24.0, -23.0, -22.0)):
    """outcomes[p][i] -> correct; seeds as the suite derives them."""
    out = []
    for p, row in enumerate(outcomes):
        for i, ok in enumerate(row):
            out.append({"kind": "frame", "benchmark": "awgn", "point": p, "frame": i, "seed": SEED ^ (1 << 40) ^ (p << 20) ^ i,
                        "condition": f"AWGN {xs[p]:+.1f} dB", "x": xs[p], "curve": None, "decoded": ok, "correct": ok, "false_decodes": 0})
    return out


def write(path, records):
    path.write_text("".join(json.dumps(r) + "\n" for r in records))
    return str(path)


BASE = [[False] * 4, [True, False, True, False], [True] * 4]
CAND = [[False, True, False, False], [True, True, True, False], [True] * 4]


def test_exact_mcnemar_matches_known_values():
    assert mcnemar_exact(100, 0) == pytest.approx(1.578e-30, rel=1e-3)   # 2^-99, the suite's test
    assert mcnemar_exact(0, 0) == 1.0 and mcnemar_exact(5, 5) == 1.0
    assert mcnemar_exact(34, 17) == pytest.approx(0.0244, abs=5e-4)      # awgn_paired_200's pooled discordance
    assert mcnemar_exact(1, 0) == 1.0


def test_holm_is_step_down_and_monotone():
    assert holm([0.01, 0.04, 0.03]) == pytest.approx([0.03, 0.06, 0.06])
    assert holm([0.5]) == [0.5]


def test_a_pairing_reports_per_point_and_pooled_discordance(tmp_path):
    a = write(tmp_path / "a.jsonl", [header()] + frames(BASE))
    b = write(tmp_path / "b.jsonl", [header(git_commit="fedcba987654")] + frames(CAND))
    code, out, err = run("paired_mcnemar.py", a, b, "--json", tmp_path / "r.json")
    assert code == 0, err
    r = json.loads((tmp_path / "r.json").read_text())
    assert r["points"]["0"]["c_candidate_only"] == 1 and r["points"]["1"]["c_candidate_only"] == 1
    assert r["pooled"]["b_baseline_only"] == 0 and r["pooled"]["c_candidate_only"] == 2
    assert r["pooled"]["mcnemar_exact_p"] == 0.5
    assert "pooled: n 12, b 0 : c 2" in out


def test_self_pairing_has_no_discordance(tmp_path):
    a = write(tmp_path / "a.jsonl", [header()] + frames(BASE))
    code, out, _ = run("paired_mcnemar.py", a, a)
    assert code == 0 and "b 0 : c 0, exact two-sided p = 1" in out


@pytest.mark.parametrize("field,value", [("suite_seed", 1), ("replicate", 3), ("frames_per_point", 5), ("instrument_sha256", "b" * 64), ("benchmark", "fading")])
def test_headers_that_differ_are_refused(tmp_path, field, value):
    a = write(tmp_path / "a.jsonl", [header()] + frames(BASE))
    b = write(tmp_path / "b.jsonl", [header(**{field: value})] + frames(CAND))
    code, _, err = run("paired_mcnemar.py", a, b)
    assert code == 2 and field in err


def test_frame_sets_that_differ_are_refused(tmp_path):
    a = write(tmp_path / "a.jsonl", [header()] + frames(BASE))
    missing = frames(CAND)[:-1]
    code, _, err = run("paired_mcnemar.py", a, write(tmp_path / "b.jsonl", [header()] + missing))
    assert code == 2 and "frame sets differ" in err
    reseeded = frames(CAND)
    reseeded[0]["seed"] += 1
    code, _, err = run("paired_mcnemar.py", a, write(tmp_path / "c.jsonl", [header()] + reseeded))
    assert code == 2 and "frame sets differ" in err
    twice = frames(CAND) + frames(CAND)[:1]
    code, _, err = run("paired_mcnemar.py", a, write(tmp_path / "d.jsonl", [header()] + twice))
    assert code == 2 and "recorded twice" in err
    relabelled = frames(CAND)
    relabelled[0]["condition"] = "AWGN -30.0 dB"
    code, _, err = run("paired_mcnemar.py", a, write(tmp_path / "e.jsonl", [header()] + relabelled))
    assert code == 2 and "condition differs" in err
    code, _, err = run("paired_mcnemar.py", a, write(tmp_path / "f.jsonl", frames(CAND)))
    assert code == 2 and "no header" in err


def test_a_dirty_side_needs_an_explicit_flag(tmp_path):
    a = write(tmp_path / "a.jsonl", [header()] + frames(BASE))
    b = write(tmp_path / "b.jsonl", [header(status="dirty", git_commit="0123456789ab-dirty")] + frames(CAND))
    code, _, err = run("paired_mcnemar.py", a, b)
    assert code == 2 and "dirty" in err
    code, out, _ = run("paired_mcnemar.py", a, b, "--allow-dirty")
    assert code == 0 and "candidate is DIRTY" in out


def test_the_crossing_bootstrap_is_paired_seeded_and_reproducible(tmp_path):
    a = write(tmp_path / "a.jsonl", [header()] + frames(BASE))
    b = write(tmp_path / "b.jsonl", [header()] + frames(CAND))
    code, _, err = run("paired_mcnemar.py", a, b, "--bootstrap", "200")
    assert code == 2 and "--bootstrap-seed" in err
    results = []
    for i in range(2):
        code, _, err = run("paired_mcnemar.py", a, b, "--bootstrap", "200", "--bootstrap-seed", "7", "--json", tmp_path / f"r{i}.json")
        assert code == 0, err
        results.append(json.loads((tmp_path / f"r{i}.json").read_text())["crossing_bootstrap"]["awgn"])
    assert results[0] == results[1]
    r = results[0]
    # Baseline crosses 50% at -23.0 dB (2/4); the candidate at 3/4 there crosses at -23.5 dB.
    assert r["baseline_crossing_50"] == pytest.approx(-23.0) and r["candidate_crossing_50"] == pytest.approx(-23.5)
    assert r["delta"] == pytest.approx(-0.5) and r["seed"] == 7


def test_malformed_input_is_refused_not_miscounted(tmp_path):
    # Research-engineer review finding 6: "correct": "false" counted as a success, a missing
    # field was a traceback, a truncated file paired, and unknown flags were ignored.
    good = write(tmp_path / "a.jsonl", [header()] + frames(BASE))
    for name, mutate in [("string", lambda r: r.update(correct="false")), ("missing", lambda r: r.pop("correct"))]:
        recs = frames(CAND)
        mutate(recs[0])
        bad = write(tmp_path / f"{name}.jsonl", [header()] + recs)
        code, _, err = run("paired_mcnemar.py", good, bad)
        assert code == 2 and "boolean 'correct'" in err, (name, err)
    short = write(tmp_path / "short.jsonl", [header()] + frames(CAND)[:-1])
    code, _, err = run("paired_mcnemar.py", short, short)
    assert code == 2 and "frames per point" in err, err
    b = write(tmp_path / "b.jsonl", [header()] + frames(CAND))
    for argv in (["--bootstrap=2000"], ["--json", "--allow-dirty"]):
        code, _, err = run("paired_mcnemar.py", good, b, *argv)
        assert code == 2, (argv, err)
