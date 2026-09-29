"""compare_results.py fails closed on anything that makes two results incomparable."""

import json
import os

from conftest import BENCHMARKS, REPO, minimal, run, write_dir


def pair(tmp_path, base=None, cand=None, drop=()):
    """Baseline and candidate directories of all ten benchmarks; `base`/`cand` mutate a doc."""
    a = {n: minimal(n) for n in BENCHMARKS}
    b = {n: minimal(n) for n in BENCHMARKS if n not in drop}
    for docs, f in ((a, base), (b, cand)):
        if f:
            for d in docs.values():
                f(d)
    return write_dir(tmp_path / "a", a), write_dir(tmp_path / "b", b)


def test_identical_results_compare_identical(tmp_path):
    code, out, err = run("compare_results.py", *pair(tmp_path))
    assert code == 0, err
    assert out.count("IDENTICAL") == 10


def test_a_benchmark_missing_from_the_candidate_is_refused(tmp_path):
    # The old script iterated only the candidate's files: a missing fading passed silently.
    code, out, err = run("compare_results.py", *pair(tmp_path, drop=("fading",)))
    assert code == 2 and "fading: missing" in err and "IDENTICAL" not in out


def test_a_different_seed_replicate_size_status_or_profile_is_refused(tmp_path):
    for what, f in [
        ("suite seed", lambda d: d["seed"].update(suite_seed=1)),
        ("replicate", lambda d: d["seed"].update(replicate=2)),
        ("frames per point", lambda d: d.update({k: 999 for k in ("frames_per_point", "slots_per_point", "trials_per_cell") if k in d})),
        ("status", lambda d: d.update(status="exploratory")),
        ("build profile", lambda d: d["provenance"].update(build_profile="debug")),
    ]:
        sub = tmp_path / what.replace(" ", "_")
        sub.mkdir()
        code, _, err = run("compare_results.py", *pair(sub, cand=f))
        assert code == 2 and what in err, (what, err)


def test_a_different_instrument_is_refused_and_names_what_changed(tmp_path):
    def other(d):
        d["provenance"]["instrument"] = {"sha256": "b" * 64, "files": {"crates/z30-cli/src/suite.rs": "b" * 64}}
    code, _, err = run("compare_results.py", *pair(tmp_path, cand=other))
    assert code == 2 and "instrument differs" in err and "suite.rs" in err


def test_legacy_results_need_an_explicit_flag_and_say_what_was_not_checked(tmp_path):
    strip = lambda d: d["provenance"].pop("instrument")  # noqa: E731
    a, b = pair(tmp_path, base=strip)
    code, _, err = run("compare_results.py", a, b)
    assert code == 2 and "--legacy-provenance" in err
    code, out, _ = run("compare_results.py", a, b, "--legacy-provenance")
    assert code == 0 and "INSTRUMENT NOT CHECKED" in out


def test_a_changed_measurement_is_different_and_a_relabel_is_a_note(tmp_path):
    code, out, _ = run("compare_results.py", *pair(tmp_path, cand=lambda d: d["points"][0].update(decoded=6)))
    assert code == 1 and "DIFFERENT" in out and "decoded: 5 != 6" in out
    sub = tmp_path / "relabel"
    sub.mkdir()
    code, out, _ = run("compare_results.py", *pair(sub, cand=lambda d: d["points"][0].update(label="p0, -3 dB", upper95_per_slot=0.1)))
    assert code == 0 and out.count("IDENTICAL") == 10 and "label 'p0' -> 'p0, -3 dB'" in out and "added in the candidate" in out
    sub = tmp_path / "lost"
    sub.mkdir()
    code, out, _ = run("compare_results.py", *pair(sub, cand=lambda d: d["points"][0].pop("decoded")))
    assert code == 1 and "missing from the candidate" in out


def test_a_named_subset_is_announced(tmp_path):
    code, out, _ = run("compare_results.py", *pair(tmp_path, drop=("fading",)), "awgn", "snr")
    assert code == 0 and out.startswith("SUBSET: only awgn, snr")


def test_the_published_directories_still_compare_as_the_audit_found():
    # d8983ee -> 672cef9: nine IDENTICAL, fading DIFFERENT (its channel model was corrected).
    r = os.path.join(REPO, "research", "results")
    code, out, _ = run("compare_results.py", os.path.join(r, "d8983eeef66e"), os.path.join(r, "672cef9b3cdb"), "--legacy-provenance")
    assert code == 1
    lines = {l.split(":")[0]: l for l in out.splitlines() if not l.startswith(" ")}
    assert all("IDENTICAL" in lines[n] for n in BENCHMARKS if n != "fading")
    assert "DIFFERENT, 65 fields" in lines["fading"]


def test_a_wrong_benchmark_in_a_file_is_refused(tmp_path):
    a, b = pair(tmp_path)
    with open(os.path.join(b, "snr.json"), "w") as h:
        json.dump(minimal("awgn"), h)
    code, _, err = run("compare_results.py", a, b)
    assert code == 2 and "not 'snr'" in err


def test_a_reproduction_of_the_published_run_can_be_certified(tmp_path):
    # QA reruns with --out, so its files say not_the_published_run; plain comparison refuses
    # that status, --reproduction accepts exactly that pair and still compares everything.
    a, b = pair(tmp_path, base=lambda d: d.update(status="published"), cand=lambda d: d.update(status="not_the_published_run"))
    code, _, err = run("compare_results.py", a, b)
    assert code == 2 and "status differs" in err
    code, out, err = run("compare_results.py", a, b, "--reproduction")
    assert code == 0, err
    assert out.count("IDENTICAL") == 10 and "REPRODUCTION" in out


def test_reproduction_mode_still_refuses_every_other_status_and_still_finds_differences(tmp_path):
    for i, (sa, sb) in enumerate([("published", "exploratory"), ("published", "dirty"), ("replicate", "not_the_published_run"),
                                  ("not_the_published_run", "published"), ("published", "published")]):
        sub = tmp_path / str(i)
        sub.mkdir()
        a, b = pair(sub, base=lambda d, s=sa: d.update(status=s), cand=lambda d, s=sb: d.update(status=s))
        code, _, err = run("compare_results.py", a, b, "--reproduction")
        assert code == 2 and "--reproduction" in err, (sa, sb, err)
    sub = tmp_path / "diff"
    sub.mkdir()
    a, b = pair(sub, base=lambda d: d.update(status="published"),
                cand=lambda d: (d.update(status="not_the_published_run"), d["points"][0].update(decoded=6)))
    code, out, err = run("compare_results.py", a, b, "--reproduction")
    assert code == 1 and out.count("DIFFERENT") == 10, (out, err)
