#!/usr/bin/env python3
"""WP2 round 2 verification (V1-V6). Official frame gate used verbatim for the split:
hardlink trees under deploy/ (my boundary) are fed to p0a/framecheck.mjs so the
coordinator's own gate classifies 'my 2508' vs '3098 runtime products'."""
import hashlib, json, os, random, re, shutil, subprocess
from concurrent.futures import ThreadPoolExecutor

A = "/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/home"
P = "/home/CNS2026495165/dsh/.workspace/audit-020/p0a"
D = os.path.join(P, "deploy")
CONV = os.path.join(P, "converted", "sessions")
CORP_ATT = os.path.join(P, "corpus", "attachments", "v1")
ORIG_SESS = "/home/CNS2026495165/.dsh/sessions"
ORIG_ATT = "/home/CNS2026495165/.dsh/attachments/v1"
TGT = os.path.join(A, "sessions")
TGT_ATT = os.path.join(A, "attachments")
FRAMECHECK = os.path.join(P, "framecheck.mjs")


def rels(b):
    return sorted(os.path.relpath(os.path.join(r, f), b) for r, _d, fs in os.walk(b) for f in fs)


def reldirs(b):
    return sorted(os.path.relpath(os.path.join(r, d), b) for r, ds, _f in os.walk(b) for d in ds)


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for c in iter(lambda: fh.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


def many(root, rl):
    with ThreadPoolExecutor(16) as ex:
        return list(ex.map(lambda r: sha(os.path.join(root, r)), rl))


def tot(b):
    return sum(os.path.getsize(os.path.join(r, f)) for r, _d, fs in os.walk(b) for f in fs)


R = {}
conv = rels(CONV)
tgt = rels(TGT)
conv_z = [r for r in conv if r.endswith(".zstd")]
conv_l = [r for r in conv if r.endswith("session.lock")]
tgt_z = [r for r in tgt if r.endswith(".zstd")]
tgt_l = [r for r in tgt if r.endswith("session.lock")]
registered = set()
for line in open(os.path.join(D, "manifest-round1.jsonl"), encoding="utf-8"):
    o = json.loads(line)
    if o["root"] == "home/sessions":
        registered.add(o["rel"])
conv_set = set(conv)
# "mine" = paths I registered in round 1 AND that exist in the new converted corpus
# (round-1 manifest also registered the 3098 runtime products, which is why conv_set is required)
mine = sorted(r for r in tgt_z if r in registered and r in conv_set)   # the 2508 I deposited
runtime = sorted(r for r in tgt_z if r not in mine)                    # 3098 products
assert len(mine) == 2508, len(mine)

R["v1"] = {
    "converted_files": len(conv), "converted_zstd": len(conv_z), "converted_lock": len(conv_l),
    "converted_other": [r for r in conv if not (r.endswith(".zstd") or r.endswith("session.lock"))],
    "converted_dirs": len(reldirs(CONV)),
    "source_attachment_objects": len(rels(os.path.join(ORIG_ATT, "objects"))),
    "source_attachment_object_dirs": len(reldirs(os.path.join(ORIG_ATT, "objects"))),
    "source_attachment_request_images": len(rels(os.path.join(ORIG_ATT, "request-images"))),
    "source_attachment_v1_all": len(rels(ORIG_ATT)),
}

# ---- V2: new converted source vs target, over the registered 2508 paths ----
hs = many(CONV, mine)
ht = many(TGT, mine)
diff = [r for r, a, b in zip(mine, hs, ht) if a != b]
R["v2"] = {"compared": len(mine), "sha256_diffs": len(diff), "diff_list": diff[:20],
           "src_sha256": hs, "tgt_sha256": ht}
# attachments unchanged -> re-verify against corpus
att_s, att_t = set(rels(CORP_ATT)), set(rels(os.path.join(TGT_ATT, "v1")))
common = sorted(att_s & att_t)
ha, hb = many(CORP_ATT, common), many(os.path.join(TGT_ATT, "v1"), common)
adiff = [r for r, a, b in zip(common, ha, hb) if a != b]
R["v2_attachments"] = {"src_files": len(att_s), "tgt_files": len(att_t), "common": len(common),
                       "sha256_diffs": len(adiff), "diff_list": adiff[:20],
                       "only_in_target": sorted(att_t - att_s), "only_in_source": sorted(att_s - att_t)}

# ---- upgrade proof: old vs new sha for the same path (round-1 manifest) ----
ov = json.load(open(os.path.join(D, "wp2-overwrite.json"), encoding="utf-8"))
R["upgrade"] = {"old_vs_new_sha_diff_count": ov["old_vs_new_sha_diff_count"],
                "overwritten": ov["overwritten"], "post_copy_mismatch": ov["post_copy_mismatch"],
                "sizes_before": ov["sizes_before"], "sizes_after": ov["sizes_after"]}

# ---- V3: sample >=30 logs by zstd -dc first line ----
rng = random.Random(20260930)
samp = rng.sample(conv_z, 40)
checks = []
for rel in samp:
    t = os.path.join(TGT, rel)
    c1 = subprocess.run(["zstd", "-dc", t], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    c2 = subprocess.run(["zstd", "-dc", os.path.join(CONV, rel)], stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE)
    e = {"rel": rel, "rc": c1.returncode, "src_rc": c2.returncode,
         "tgt_sha256": sha(t), "src_sha256": sha(os.path.join(CONV, rel))}
    if c1.returncode == 0:
        try:
            j = json.loads(c1.stdout.split(b"\n", 1)[0])
            e["type"], e["version"] = j.get("type"), j.get("version")
        except Exception as ex:
            e["parse_error"] = str(ex)
    if c2.returncode == 0:
        try:
            j2 = json.loads(c2.stdout.split(b"\n", 1)[0])
            e["src_type"], e["src_version"] = j2.get("type"), j2.get("version")
        except Exception as ex:
            e["src_parse_error"] = str(ex)
    e["ok"] = (e["rc"] == 0 and e.get("type") == "session" and e.get("version") == e.get("src_version")
               and e["tgt_sha256"] == e["src_sha256"])
    checks.append(e)
R["v3"] = {"sampled": len(checks), "passed": sum(1 for c in checks if c["ok"]),
           "fails": [c for c in checks if not c["ok"]], "checks": checks}

# ---- V4: file-form scan ----
R["v4"] = {
    "target_sessions_files": len(tgt), "target_zstd": len(tgt_z), "target_lock": len(tgt_l),
    "bad_form": [r for r in tgt if not (re.match(r"^session(\.v\d+)?\.jsonl\.zstd$", os.path.basename(r))
                                        or os.path.basename(r) == "session.lock")],
    "plain_jsonl": [r for r in tgt if os.path.basename(r).endswith((".jsonl", ".jsonl.gz", ".jsonl.zst"))],
    "basename_hist": {},
}
for r in tgt:
    b = os.path.basename(r)
    R["v4"]["basename_hist"][b] = R["v4"]["basename_hist"].get(b, 0) + 1
R["v4"]["bad_form_count"] = len(R["v4"]["bad_form"])
R["v4"]["plain_jsonl_count"] = len(R["v4"]["plain_jsonl"])


# ---- V6: official framecheck, whole root + split via hardlink trees ----
def run_framecheck(root):
    cp = subprocess.run(["node", FRAMECHECK, root], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return json.loads(cp.stdout.decode())


def hardlink_tree(rel_list, name):
    base = os.path.join(D, name)
    if os.path.isdir(base):
        shutil.rmtree(base)
    for rel in rel_list:
        p = os.path.join(base, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        os.link(os.path.join(TGT, rel), p)
    return base


fc_root = run_framecheck(TGT)
mine_tree = hardlink_tree(mine, "_framecheck-mine")
rt_tree = hardlink_tree(runtime, "_framecheck-runtime")
fc_mine = run_framecheck(mine_tree)
fc_rt = run_framecheck(rt_tree)
shutil.rmtree(mine_tree)
shutil.rmtree(rt_tree)
R["v6"] = {
    "official_cmd_root": "node p0a/framecheck.mjs $A/home/sessions",
    "whole_root": fc_root,
    "mine_sample": {"label": "registered 2508 converted logs", **{k: fc_mine[k] for k in
                    ("files", "ok", "bad", "frameCounts", "badExamples")}},
    "runtime_sample": {"label": "3098 runtime products (not mine)", **{k: fc_rt[k] for k in
                       ("files", "ok", "bad", "frameCounts", "badExamples")}},
    "mine_files": len(mine), "runtime_files": len(runtime),
    "consistency": {
        "mine+runtime == whole": fc_mine["files"] + fc_rt["files"] == fc_root["files"],
        "ok_mine+runtime == ok_whole": fc_mine["ok"] + fc_rt["ok"] == fc_root["ok"],
        "bad_mine+runtime == bad_whole": fc_mine["bad"] + fc_rt["bad"] == fc_root["bad"],
    },
    "runtime_classification": {
        "v4_logs": sum(1 for r in runtime if r.endswith(".v4.jsonl.zstd")),
        "other_zstd": sum(1 for r in runtime if not r.endswith(".v4.jsonl.zstd")),
        "runtime_locks_ignored_by_gate": len([r for r in tgt_l if r not in registered]),
    },
}

# ---- V5: three-way table ----
def head_hist(base, k, seed):
    rr = random.Random(seed)
    fs = [x for x in rels(base) if x.endswith(".zstd")]
    hist = {}
    for rel in rr.sample(fs, min(k, len(fs))):
        cp = subprocess.run(["zstd", "-dc", os.path.join(base, rel)], stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE)
        v = "ERROR"
        if cp.returncode == 0:
            try:
                v = str(json.loads(cp.stdout.split(b"\n", 1)[0]).get("version"))
            except Exception:
                v = "unparsed"
        hist[v] = hist.get(v, 0) + 1
    return {"sampled": min(k, len(fs)), "version_hist": hist}


R["v5"] = {
    "orig": {"files": len(rels(ORIG_SESS)), "dirs": len(reldirs(ORIG_SESS)),
             "zstd": sum(1 for r in rels(ORIG_SESS) if r.endswith(".zstd")),
             "lock": sum(1 for r in rels(ORIG_SESS) if r.endswith("session.lock")),
             "bytes": tot(ORIG_SESS)},
    "converted": {"files": len(conv), "dirs": len(reldirs(CONV)), "zstd": len(conv_z),
                  "lock": len(conv_l), "bytes": tot(CONV)},
    "target": {"files": len(tgt), "dirs": len(reldirs(TGT)), "zstd": len(tgt_z),
               "lock": len(tgt_l), "bytes": tot(TGT)},
    "orig_head_hist": head_hist(ORIG_SESS, 200, 20260930),
    "converted_head_hist": head_hist(CONV, 200, 20260930),
}

json.dump(R, open(os.path.join(D, "wp2-verify3.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)

L = []
L.append("V1 converted=%d zstd=%d lock=%d other=%d dirs=%d | orig_objects=%d obj_dirs=%d req_imgs=%d v1_all=%d" % (
    R["v1"]["converted_files"], R["v1"]["converted_zstd"], R["v1"]["converted_lock"],
    len(R["v1"]["converted_other"]), R["v1"]["converted_dirs"], R["v1"]["source_attachment_objects"],
    R["v1"]["source_attachment_object_dirs"], R["v1"]["source_attachment_request_images"],
    R["v1"]["source_attachment_v1_all"]))
L.append("V2 new-converted -> target: compared=%d sha256_diffs=%d" % (R["v2"]["compared"], R["v2"]["sha256_diffs"]))
L.append("V2 attachments: src=%d tgt=%d common=%d sha256_diffs=%d only_tgt=%d only_src=%d" % (
    R["v2_attachments"]["src_files"], R["v2_attachments"]["tgt_files"], R["v2_attachments"]["common"],
    R["v2_attachments"]["sha256_diffs"], len(R["v2_attachments"]["only_in_target"]),
    len(R["v2_attachments"]["only_in_source"])))
L.append("UPGRADE old-vs-new sha diff=%d overwritten=%d post_copy_mismatch=%d sizes %d -> %d" % (
    R["upgrade"]["old_vs_new_sha_diff_count"], R["upgrade"]["overwritten"],
    len(R["upgrade"]["post_copy_mismatch"]), R["upgrade"]["sizes_before"], R["upgrade"]["sizes_after"]))
L.append("V3 sampled=%d passed=%d fails=%d" % (R["v3"]["sampled"], R["v3"]["passed"], len(R["v3"]["fails"])))
L.append("V3 detail: " + ", ".join("v=%s/%s type=%s/%s ok=%s" % (c.get("version"), c.get("src_version"),
    c.get("type"), c.get("src_type"), c["ok"]) for c in R["v3"]["checks"][:10]))
L.append("V4 files=%d zstd=%d lock=%d bad_form=%d plain_jsonl=%d" % (
    R["v4"]["target_sessions_files"], R["v4"]["target_zstd"], R["v4"]["target_lock"],
    R["v4"]["bad_form_count"], R["v4"]["plain_jsonl_count"]))
L.append("V4 basename_hist=%s" % json.dumps(R["v4"]["basename_hist"], ensure_ascii=False))
L.append("V6 whole_root: files=%d ok=%d bad=%d" % (fc_root["files"], fc_root["ok"], fc_root["bad"]))
L.append("V6 mine(2508): files=%d ok=%d bad=%d frameCounts=%s" % (
    fc_mine["files"], fc_mine["ok"], fc_mine["bad"], json.dumps(fc_mine["frameCounts"])))
L.append("V6 runtime: files=%d ok=%d bad=%d frameCounts=%s" % (
    fc_rt["files"], fc_rt["ok"], fc_rt["bad"], json.dumps(fc_rt["frameCounts"])))
L.append("V6 consistency=%s runtime_class=%s" % (json.dumps(R["v6"]["consistency"]),
          json.dumps(R["v6"]["runtime_classification"])))
L.append("V5 %s" % json.dumps(R["v5"], ensure_ascii=False))
open(os.path.join(D, "wp2-verify3-summary.txt"), "w", encoding="utf-8").write("\n".join(L) + "\n")
print("OK")
