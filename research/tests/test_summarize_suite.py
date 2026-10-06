"""summarize_suite.py: published output unchanged; everything else refused or bannered."""

import os

from conftest import REPO, published_copy, run


def test_the_published_summary_regenerates_byte_for_byte():
    d = os.path.join(REPO, "research", "results", "672cef9b3cdb")
    code, out, err = run("summarize_suite.py", d)
    assert code == 0, err
    with open(os.path.join(d, "SUMMARY.md"), encoding="utf-8") as h:
        assert out == h.read(), "the summariser changed what it prints for a published run"


def test_a_missing_benchmark_is_refused(tmp_path):
    docs, write = published_copy(tmp_path)
    del docs["fading"]
    d = write(docs)
    code, out, err = run("summarize_suite.py", d)
    assert code == 2 and "missing fading" in err and out == ""
    code, out, _ = run("summarize_suite.py", d, "--partial")
    assert code == 0 and "PARTIAL: fading" in out and "NOT THE PUBLISHED RUN" in out


def test_a_directory_mixing_runs_is_refused(tmp_path):
    # The overwrite of RES-04: one replicate file among published ones.
    docs, write = published_copy(tmp_path)
    docs["awgn"]["seed"] = {"suite_seed": 281474996971486, "replicate": 1, "published_seed": False}
    docs["awgn"]["not_the_published_run"] = "replicate 1"
    code, _, err = run("summarize_suite.py", write(docs))
    assert code == 2 and "not from one run" in err


def test_every_non_published_status_gets_a_banner(tmp_path):
    docs, write = published_copy(tmp_path)
    cases = {
        "replicate": lambda d: (d["seed"].update(suite_seed=281474996971486, replicate=1), d.update(not_the_published_run="replicate 1")),
        "dirty": lambda d: d["provenance"].update(git_commit="672cef9b3cdb-dirty"),
        # An old-schema awgn at 150 frames carried no marker; it is exploratory by the 200 rule.
        "exploratory": lambda d: d.update(frames_per_point=150) if d["benchmark"] == "awgn" else None,
        "not_the_published_run": lambda d: d.update(status="not_the_published_run"),
    }
    for status, mutate in cases.items():
        mixed = {}
        for n, doc in docs.items():
            doc = dict(doc, provenance=dict(doc["provenance"]), seed=dict(doc["seed"]))
            mutate(doc)
            mixed[n] = doc
        if status == "exploratory":
            # Status must agree across a directory, so summarise the awgn file on its own.
            mixed = {"awgn": mixed["awgn"]}
        args = ["--partial"] if status == "exploratory" else []
        code, out, err = run("summarize_suite.py", write(mixed, status), *args)
        assert code == 0, (status, err)
        assert "NOT THE PUBLISHED RUN" in out and status.upper() in out, (status, out[:600])


def test_new_provenance_is_shown(tmp_path):
    docs, write = published_copy(tmp_path)
    for doc in docs.values():
        doc["status"] = "published"
        doc["provenance"]["instrument"] = {"sha256": "f" * 64}
        doc["provenance"]["cargo_lock_sha256"] = "e" * 64
        doc["provenance"]["isa_features_detected"] = {"avx2": True, "avx512f": False}
    code, out, err = run("summarize_suite.py", write(docs))
    assert code == 0, err
    assert "instrument sha256 `ffffffffffff`" in out and "avx2" in out and "avx512f" not in out
    assert "NOT THE PUBLISHED RUN" not in out
