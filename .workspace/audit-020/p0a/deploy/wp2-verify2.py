#!/usr/bin/env python3
"""WP2 verification (authoritative). Writes summary JSON + text; stdout stays tiny."""
import hashlib, json, os, random, re, subprocess
from concurrent.futures import ThreadPoolExecutor

A = "/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/home"
P = "/home/CNS2026495165/dsh/.workspace/audit-020/p0a"
D = os.path.join(P, "deploy")
CONV_SESS = os.path.join(P, "converted", "sessions")
CORP_ATT = os.path.join(P, "corpus", "attachments", "v1")
ORIG_SESS = "/home/CNS2026495165/.dsh/sessions"
ORIG_ATT = "/home/CNS2026495165/.dsh/attachments/v1"
TGT_SESS = os.path.join(A, "sessions")
TGT_ATT = os.path.join(A, "attachments")


def rels(b):
    out = []
    for r, _d, fs in os.walk(b):
        for f in fs:
            out.append(os.path.relpath(os.path.join(r, f), b))
    return sorted(out)


def reldirs(b):
    out = []
    for r, ds, _f in os.walk(b):
        for d in ds:
            out.append(os.path.relpath(os.path.join(r, d), b))
    return sorted(out)


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for c in iter(lambda: fh.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


def hashes(root, rel_list):
    with ThreadPoolExecutor(16) as ex:
        return list(ex.map(lambda r: sha(os.path.join(root, r)), rel_list))


def tot(b):
    return sum(os.path.getsize(os.path.join(r, f)) for r, _d, fs in os.walk(b) for f in fs)


def cmp(src_root, tgt_root, label):
    s, t = set(rels(src_root)), set(rels(tgt_root))
    common = sorted(s & t)
    hs = hashes(src_root, common)
    ht = hashes(tgt_root, common)
    diff = [r for r, a, b in zip(common, hs, ht) if a != b]
    return {
        "label": label,
        "src_files": len(s), "tgt_files": len(t),
        "common": len(common), "sha256_diffs": len(diff), "diff_list": diff[:20],
        "only_in_target": sorted(t - s)[:40], "only_in_target_count": len(t - s),
        "only_in_source": sorted(s - t)[:40], "only_in_source_count": len(s - t),
    }


R = {}
R["v1"] = {
    "converted_sessions_files": len(rels(CONV_SESS)),
    "converted_sessions_zstd": sum(1 for r in rels(CONV_SESS) if r.endswith(".zstd")),
    "converted_sessions_lock": sum(1 for r in rels(CONV_SESS) if r.endswith("session.lock")),
    "converted_sessions_other": [r for r in rels(CONV_SESS)
                                 if not (r.endswith(".zstd") or r.endswith("session.lock"))],
    "converted_sessions_dirs": len(reldirs(CONV_SESS)),
    "source_attachment_objects": len(rels(os.path.join(ORIG_ATT, "objects"))),
    "source_attachment_object_dirs": len(reldirs(os.path.join(ORIG_ATT, "objects"))),
    "source_attachment_request_images": len(rels(os.path.join(ORIG_ATT, "request-images"))),
    "source_attachment_v1_all_files": len(rels(ORIG_ATT)),
}
R["v2_sessions"] = cmp(CONV_SESS, TGT_SESS, "converted-sessions")
# target attachments root is home/attachments; its v1/ subdir corresponds to the source root
R["v2_attachments"] = cmp(CORP_ATT, os.path.join(TGT_ATT, "v1"), "corpus-v1-attachments")

tgt_s = rels(TGT_SESS)
R["v4"] = {
    "target_sessions_files": len(tgt_s),
    "bad_form": [r for r in tgt_s
                 if not (re.match(r"^session(\.v\d+)?\.jsonl\.zstd$", os.path.basename(r))
                         or os.path.basename(r) == "session.lock")],
    "basename_hist": {},
    "ext_hist": {},
}
for r in tgt_s:
    b = os.path.basename(r)
    R["v4"]["basename_hist"][b] = R["v4"]["basename_hist"].get(b, 0) + 1
    e = "." + b.split(".", 1)[1] if "." in b else "(none)"
    R["v4"]["ext_hist"][e] = R["v4"]["ext_hist"].get(e, 0) + 1
R["v4"]["bad_form_count"] = len(R["v4"]["bad_form"])

# V3: sample >=30 logs, zstd -dc first line
rng = random.Random(20260930)
logs = [r for r in rels(CONV_SESS) if r.endswith(".zstd")]
samp = rng.sample(logs, 40)
checks = []
for rel in samp:
    t = os.path.join(TGT_SESS, rel)
    cp = subprocess.run(["zstd", "-dc", t], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    cp2 = subprocess.run(["zstd", "-dc", os.path.join(CONV_SESS, rel)],
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    c = {"rel": rel, "zstd_rc": cp.returncode, "src_rc": cp2.returncode,
         "tgt_sha256": sha(t), "src_sha256": sha(os.path.join(CONV_SESS, rel))}
    if cp.returncode == 0:
        try:
            j = json.loads(cp.stdout.split(b"\n", 1)[0])
            c["type"] = j.get("type"); c["version"] = j.get("version")
        except Exception as e:
            c["parse_error"] = str(e)
    if cp2.returncode == 0:
        try:
            j2 = json.loads(cp2.stdout.split(b"\n", 1)[0])
            c["src_type"] = j2.get("type"); c["src_version"] = j2.get("version")
        except Exception as e:
            c["src_parse_error"] = str(e)
    c["ok"] = (c["zstd_rc"] == 0 and c.get("type") == "session"
               and c.get("version") == c.get("src_version")
               and c["tgt_sha256"] == c["src_sha256"])
    checks.append(c)
R["v3"] = {"sampled": len(checks), "passed": sum(1 for c in checks if c["ok"]),
           "fails": [c for c in checks if not c["ok"]], "checks": checks}


def head_hist(base, k, seed):
    rr = random.Random(seed)
    fs = [x for x in rels(base) if x.endswith(".zstd")]
    pick = rr.sample(fs, min(k, len(fs)))
    hist = {}
    for rel in pick:
        cp = subprocess.run(["zstd", "-dc", os.path.join(base, rel)],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if cp.returncode != 0:
            v = "ERROR"
        else:
            try:
                v = str(json.loads(cp.stdout.split(b"\n", 1)[0]).get("version"))
            except Exception:
                v = "unparsed"
        hist[v] = hist.get(v, 0) + 1
    return {"sampled": len(pick), "version_hist": hist}


R["v5"] = {
    "orig": {"files": len(rels(ORIG_SESS)), "dirs": len(reldirs(ORIG_SESS)),
             "zstd": sum(1 for r in rels(ORIG_SESS) if r.endswith(".zstd")),
             "lock": sum(1 for r in rels(ORIG_SESS) if r.endswith("session.lock")),
             "bytes": tot(ORIG_SESS)},
    "converted": {"files": len(rels(CONV_SESS)), "dirs": len(reldirs(CONV_SESS)),
                  "zstd": len(logs), "lock": R["v1"]["converted_sessions_lock"],
                  "bytes": tot(CONV_SESS)},
    "target": {"files": len(tgt_s), "dirs": len(reldirs(TGT_SESS)),
               "zstd": sum(1 for r in tgt_s if r.endswith(".zstd")),
               "lock": sum(1 for r in tgt_s if r.endswith("session.lock")),
               "bytes": tot(TGT_SESS)},
    "orig_head_hist": head_hist(ORIG_SESS, 200, 20260930),
    "converted_head_hist": head_hist(CONV_SESS, 200, 20260930),
    "target_extra_files": sorted(set(tgt_s) - set(rels(CONV_SESS))),
}

with open(os.path.join(D, "wp2-verify2.json"), "w", encoding="utf-8") as fh:
    json.dump(R, fh, ensure_ascii=False, indent=1)

lines = []
lines.append("V1 converted_sessions=%d zstd=%d lock=%d other=%d dirs=%d" % (
    R["v1"]["converted_sessions_files"], R["v1"]["converted_sessions_zstd"],
    R["v1"]["converted_sessions_lock"], len(R["v1"]["converted_sessions_other"]),
    R["v1"]["converted_sessions_dirs"]))
lines.append("V1 orig_attachment_objects=%d object_dirs=%d request_images=%d v1_all=%d" % (
    R["v1"]["source_attachment_objects"], R["v1"]["source_attachment_object_dirs"],
    R["v1"]["source_attachment_request_images"], R["v1"]["source_attachment_v1_all_files"]))
for k in ("v2_sessions", "v2_attachments"):
    v = R[k]
    lines.append("V2 %s: src=%d tgt=%d common=%d sha256_diffs=%d only_tgt=%d only_src=%d" % (
        v["label"], v["src_files"], v["tgt_files"], v["common"], v["sha256_diffs"],
        v["only_in_target_count"], v["only_in_source_count"]))
    if v["diff_list"]:
        lines.append("   DIFFS: %s" % v["diff_list"])
lines.append("V4 target_sessions_files=%d bad_form=%d" % (
    R["v4"]["target_sessions_files"], R["v4"]["bad_form_count"]))
lines.append("V4 basename_hist=%s" % json.dumps(R["v4"]["basename_hist"], ensure_ascii=False))
lines.append("V4 ext_hist=%s" % json.dumps(R["v4"]["ext_hist"], ensure_ascii=False))
lines.append("V3 sampled=%d passed=%d fails=%d" % (
    R["v3"]["sampled"], R["v3"]["passed"], len(R["v3"]["fails"])))
lines.append("V3 sample detail: " + ", ".join(
    "%s v=%s/%s type=%s/%s ok=%s" % (c["rel"].split("/")[-2][:8], c.get("version"),
                                     c.get("src_version"), c.get("type"), c.get("src_type"),
                                     c["ok"]) for c in R["v3"]["checks"][:12]))
lines.append("V5 %s" % json.dumps(R["v5"], ensure_ascii=False))
with open(os.path.join(D, "wp2-verify-summary.txt"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines) + "\n")
print("WROTE", os.path.join(D, "wp2-verify2.json"))
