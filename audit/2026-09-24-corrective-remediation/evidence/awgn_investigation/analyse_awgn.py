#!/usr/bin/env python3
"""The AWGN 50%/90% crossing: how much it moves between independent 200-frame runs, and whether
the post-remediation audit's -22.94 dB differs from the suite's -23.03 dB by more than that.

Inputs (all produced by the z30 binary or the audit's harness, never edited):
  research/results/<commit>/awgn.json                             the suite, published seed 20260830
  research/results/<rep commit>/awgn.json                         replicate 0 = the published seed again,
                                                                  from the binary that ran the replicates
  research/results/<rep commit>/awgn_replicates/replicate-N/awgn.json   replicates 1..10
  audit/2026-09-24-post-remediation/evidence/results/audit_awgn.json  the audit's independent harness
  (optional) a re-run of that harness at the corrected commit

The crossing method is the suite's own (linear interpolation of the rate and of its Wilson 95%
bounds between adjacent points), re-implemented here and checked against the suite's value for
the published run. Usage: python3 analyse_awgn.py <repo> <commit> <rep commit> > out.json
"""
import json, math, os, sys
from statistics import mean, stdev

Z = 1.959963984540054


def wilson(k, n):
    p = k / n
    den = 1 + Z * Z / n
    c = (p + Z * Z / (2 * n)) / den
    h = Z * math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / den
    return 100 * max(c - h, 0), 100 * min(c + h, 1)


def crossing(points, target, f):
    for (x0, k0, n0), (x1, k1, n1) in zip(points, points[1:]):
        y0, y1 = f(k0, n0), f(k1, n1)
        if (y0 - target) * (y1 - target) <= 0 and y0 != y1:
            return x0 + (target - y0) * (x1 - x0) / (y1 - y0)
    return None


def crossings(points):
    rate = lambda k, n: 100 * k / n
    out = {}
    for t in (50, 90):
        out[t] = {"at": crossing(points, t, rate), "interval": [crossing(points, t, lambda k, n: wilson(k, n)[1]),
                                                               crossing(points, t, lambda k, n: wilson(k, n)[0])]}
    return out


def suite_points(path):
    d = json.load(open(path))
    return [(p["param"], p["decoded"], p["frames"]) for p in d["points"]], d


def fisher_two_sided(a, b, c, d):
    """Exact two-sided Fisher test for [[a, b], [c, d]] (sum of tables at most as likely)."""
    n1, n2, m1 = a + b, c + d, a + c
    lf = lambda x: math.lgamma(x + 1)
    def lp(x):
        return lf(n1) + lf(n2) + lf(m1) + lf(n1 + n2 - m1) - lf(x) - lf(n1 - x) - lf(m1 - x) - lf(n2 - m1 + x) - lf(n1 + n2)
    p0 = lp(a)
    lo, hi = max(0, m1 - n2), min(n1, m1)
    return min(1.0, sum(math.exp(lp(x)) for x in range(lo, hi + 1) if lp(x) <= p0 + 1e-9))


def main():
    repo, commit, rep_commit = sys.argv[1], sys.argv[2], sys.argv[3]
    base = os.path.join(repo, "research", "results", commit)
    rep_base = os.path.join(repo, "research", "results", rep_commit)
    pub, pub_doc = suite_points(os.path.join(base, "awgn.json"))
    rep0, rep0_doc = suite_points(os.path.join(rep_base, "awgn.json"))
    runs = {"replicate 0 = seed 20260830 (published)": pub}
    rep_dir = os.path.join(rep_base, "awgn_replicates")
    for s in sorted(os.listdir(rep_dir), key=lambda x: int(x.split("-")[1])):
        doc = json.load(open(os.path.join(rep_dir, s, "awgn.json")))
        assert doc["seed"]["replicate"] == int(s.split("-")[1]) and not doc["seed"]["published_seed"]
        runs[f"replicate {s.split('-')[1]} (suite seed {doc['seed']['suite_seed']})"] = suite_points(os.path.join(rep_dir, s, "awgn.json"))[0]
    table = {name: crossings(pts) for name, pts in runs.items()}
    # Our re-implementation reproduces the suite's own crossing for the published run.
    assert abs(table["replicate 0 = seed 20260830 (published)"][50]["at"] - pub_doc["crossing_50pct_db"]["at"]) < 1e-9
    # No two runs may share a frame: identical per-point counts in two runs would be the first sign.
    counts = [tuple(k for _, k, _ in pts) for pts in runs.values()]
    assert len(set(counts)) == len(counts), "two runs have identical per-point counts: not independent"
    c50 = [v[50]["at"] for v in table.values()]
    c90 = [v[90]["at"] for v in table.values()]
    snrs = [p[0] for p in pub]
    pooled = [(x, sum(r[i][1] for r in runs.values()), sum(r[i][2] for r in runs.values())) for i, x in enumerate(snrs)]
    audit = json.load(open(os.path.join(repo, "audit/2026-09-24-post-remediation/evidence/results/audit_awgn.json")))["result"]
    audit_pts = [(p["snr_db"], p["decoded"], p["frames"]) for p in audit["points"]]
    out = {
        "what": "AWGN 50%/90% crossing across independent 200-frame runs of z30 --benchmark awgn (same binary, same conditions, different suite seeds)",
        "commit": commit,
        "replicate_commit": rep_commit,
        "replicate_0_identical_to_published": rep0 == pub,
        "per_run": {k: {"c50": v[50]["at"], "c50_interval": v[50]["interval"], "c90": v[90]["at"]} for k, v in table.items()},
        "c50": {"n_runs": len(c50), "mean": mean(c50), "sd": stdev(c50), "min": min(c50), "max": max(c50)},
        "c90": {"n_runs": len(c90), "mean": mean(c90), "sd": stdev(c90), "min": min(c90), "max": max(c90)},
        "pooled": {"frames_per_point": pooled[0][2], "points": [{"snr_db": x, "decoded": k, "frames": n, "percent": 100 * k / n,
                                                                    "wilson95": wilson(k, n)} for x, k, n in pooled],
                   "crossings": crossings(pooled)},
        "audit_harness": {"source": "audit/2026-09-24-post-remediation/evidence/results/audit_awgn.json", "crossings": crossings(audit_pts),
                          "c50_z_against_run_to_run_sd": (crossings(audit_pts)[50]["at"] - mean(c50)) / stdev(c50)},
        "published_z_against_run_to_run_sd": (table["replicate 0 = seed 20260830 (published)"][50]["at"] - mean(c50)) / stdev(c50),
    }
    # Per-point comparison with the audit where both measured the same SNR: exact Fisher tests.
    same = []
    for x, k, n in pub:
        for ax, ak, an in audit_pts:
            if abs(ax - x) < 1e-9:
                pooled_k = [p for p in pooled if abs(p[0] - x) < 1e-9][0]
                same.append({"snr_db": x, "published": f"{k}/{n}", "audit": f"{ak}/{an}", "fisher_p_published_vs_audit": fisher_two_sided(k, n - k, ak, an - ak),
                             "pooled_suite": f"{pooled_k[1]}/{pooled_k[2]}", "fisher_p_pooled_vs_audit": fisher_two_sided(pooled_k[1], pooled_k[2] - pooled_k[1], ak, an - ak)})
    out["per_point_vs_audit"] = same
    json.dump(out, sys.stdout, indent=2)


if __name__ == "__main__":
    main()
