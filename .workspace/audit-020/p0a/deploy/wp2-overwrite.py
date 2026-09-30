#!/usr/bin/env python3
"""WP2 round 2 — overwrite ONLY the 2508 converted logs registered in round-1 manifest.

Boundary: writes only under $A/home/sessions/** (target files) and $P/deploy/** (evidence).
Uses temp-file + os.replace so a concurrent 0.2.0 reader never sees a torn log.
Runtime products written by the 3098 host (session.v4.jsonl.zstd / runtime session.lock /
new session dirs) are NOT touched.
"""
import hashlib, json, os, shutil, tempfile, time

A = "/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/home"
P = "/home/CNS2026495165/dsh/.workspace/audit-020/p0a"
D = os.path.join(P, "deploy")
NEW = os.path.join(P, "converted", "sessions")
TGT = os.path.join(A, "sessions")


def rels(b):
    return sorted(os.path.relpath(os.path.join(r, f), b) for r, _d, fs in os.walk(b) for f in fs)


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for c in iter(lambda: fh.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


# ---- load round-1 manifest (the authoritative registration of what I deposited) ----
m1 = {}
for line in open(os.path.join(D, "manifest.jsonl"), encoding="utf-8"):
    o = json.loads(line)
    m1[(o["root"], o["rel"])] = o
reg = {rel: o for (root, rel), o in m1.items() if root == "home/sessions"}

new_set = set(rels(NEW))                       # 2508 .zstd + 3 lock
# strictly: registered paths that exist in the NEW converted corpus AND are logs (.zstd)
targets = sorted(r for r in new_set if r in reg and r.endswith(".zstd"))
skipped_locks = sorted(r for r in new_set if r in reg and r.endswith("session.lock"))
print(f"registered(home/sessions)={len(reg)}  new_corpus={len(new_set)}  overwrite_targets={len(targets)}  "
      f"locks_left_untouched={len(skipped_locks)}")

# boundary realpath self-check before writing (recorded in report)
print("realpath target root:", os.path.realpath(TGT))
print("realpath new source :", os.path.realpath(NEW))
assert os.path.realpath(TGT) == TGT and os.path.realpath(NEW) == NEW

started = time.strftime("%Y-%m-%d %H:%M:%S")
rows = []
missing = []
for i, rel in enumerate(targets, 1):
    src = os.path.join(NEW, rel)
    dst = os.path.join(TGT, rel)
    if not os.path.exists(dst):
        missing.append(rel)
        continue
    old_sha, old_bytes = reg[rel]["sha256"], reg[rel]["bytes"]
    d = os.path.dirname(dst)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".wp2tmp-")
    os.close(fd)
    try:
        shutil.copyfile(src, tmp)
        os.chmod(tmp, 0o600)
        os.replace(tmp, dst)                    # atomic within same dir/fs
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    new_sha, new_bytes = sha(dst), os.path.getsize(dst)
    rows.append({"rel": rel, "old_bytes": old_bytes, "old_sha256": old_sha,
                 "new_bytes": new_bytes, "new_sha256": new_sha,
                 "src_bytes": os.path.getsize(src), "src_sha256": sha(src),
                 "changed": old_sha != new_sha})
    if i % 500 == 0:
        print("  ...%d/%d" % (i, len(targets)), flush=True)

changed = sum(1 for r in rows if r["changed"])
bad_src = [r["rel"] for r in rows if r["src_sha256"] != r["new_sha256"]]
out = {"started": started, "finished": time.strftime("%Y-%m-%d %H:%M:%S"),
       "overwrite_targets": len(targets), "overwritten": len(rows),
       "missing_in_target": missing, "old_vs_new_sha_diff_count": changed,
       "post_copy_mismatch": bad_src,
       "skipped_locks": skipped_locks,
       "sizes_before": sum(r["old_bytes"] for r in rows),
       "sizes_after": sum(r["new_bytes"] for r in rows)}
json.dump(out, open(os.path.join(D, "wp2-overwrite.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
json.dump(rows, open(os.path.join(D, "wp2-overwrite-map.json"), "w", encoding="utf-8"),
          ensure_ascii=False)
print(json.dumps({k: v for k, v in out.items() if k not in ("skipped_locks",)}, ensure_ascii=False))
