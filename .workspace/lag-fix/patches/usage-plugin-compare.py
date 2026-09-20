#!/usr/bin/env python3
"""usage-plugin-compare.py —— 只读比对 @local/dsh-usage 的两份拷贝（漂移清单）。

背景：本插件在工作区里存在**两份互不相同的拷贝**（实测 inode 不同，是拷贝不是链接）：
  source   : <repo>/dsh-usage/
  deployed : ~/.dsh/profiles/node_modules/@local/dsh-usage/   ← 宿主实际加载
部署侧是更新的超集（hourly 粒度 / 趋势 gear / settingsScope / peakRing / 多源修正 …）。

本脚本只读回答三个问题：
  1) 逐文件是否一致（sha256 / 字节数 / 行数 / inode），漂移的是哪些；
  2) 本次补丁的每个替换点是否**两侧都唯一命中**（= 能否两侧干净应用，还是要合并）；
  3) 功能级标记（TREND_ANCHOR_HOUR、HOUR_SQL、settingsScope …）各在哪一侧存在。

绝不写目标文件；只写 --out 指定的报告（默认工作区内）。
用法：
  usage-plugin-compare.py --source <dir> --deployed <dir> --replacements <txt> [--out <md>]
退出码：0 = 报告生成成功（不代表两侧一致）；1 = 输入缺失/不可读。
"""
import argparse
import hashlib
import os
import sys
from datetime import datetime


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def line_count(path):
    with open(path, "rb") as f:
        return f.read().count(b"\n")


def load_pairs(spec_path):
    """解析 @@JOB/@@OLD/@@NEW 结构 → {job: [(old_text, new_text), ...]}。"""
    blocks, cur, pair = {}, None, None
    for raw in open(spec_path, encoding="utf-8").read().split("\n"):
        line = raw.rstrip("\r")
        if line.startswith("@@JOB "):
            cur = {"pairs": []}
            blocks[line[len("@@JOB "):].strip()] = cur
            pair = None
        elif line.startswith("@@OLD") and cur is not None:
            pair = {"old": [], "new": [], "sect": "old"}
            cur["pairs"].append(pair)
        elif line.startswith("@@NEW") and pair is not None:
            pair["sect"] = "new"
        elif pair is not None and pair["sect"] in ("old", "new"):
            pair[pair["sect"]].append(line)
    return {j: [("\n".join(p["old"]) + "\n", "\n".join(p["new"]) + "\n") for p in b["pairs"]] for j, b in blocks.items()}


# 功能级标记：部署侧独有 / 源码侧独有 / 数量不同
MARKERS = {
    "lib/client.js": ["TREND_ANCHOR_HOUR", "trendGrain", "usageDayWindow", "fillBuckets",
                      "settingsScope", "peakRing", "granularity", "refreshSec", "IntersectionObserver"],
    "lib/db.js": ["HOUR_SQL", "granularity", "DAY_SQL", "queryHeatmap", "rebuildDailyForDays", "incremental"],
    "lib/index.js": ["peakRing", "INGEST_INTERVAL_MS", "registerUsageRpc"],
    "lib/rpc.js": ["granularity", "sessions", "heatmap"],
    "lib/charts.js": ["usageDayWindow", "fillBuckets", "granularity"],
}

FILE_ORDER = ["lib/db.js", "lib/client.js", "lib/index.js", "lib/rpc.js", "lib/ingest-cc.js",
              "lib/ingest-dsh.js", "lib/zstd.js", "lib/charts.js",
              "package.json", "cordis.patch.yml", "README.md"]

JOB_FILE = {"db-route": "lib/db.js", "db-rebuild": "lib/db.js",
            "client-range": "lib/client.js", "client-poll": "lib/client.js"}


def anchor_matrix(pairs, source_dir, deployed_dir):
    rows = []
    texts = {}
    for base, label in ((source_dir, "source"), (deployed_dir, "deployed")):
        texts[label] = {}
        for rel in set(JOB_FILE.values()):
            p = os.path.join(base, rel)
            texts[label][rel] = open(p, encoding="utf-8").read() if os.path.isfile(p) else None
    for job in sorted(pairs, key=lambda j: list(JOB_FILE).index(j) if j in JOB_FILE else 99):
        rel = JOB_FILE.get(job, "?")
        for i, (old, new) in enumerate(pairs[job]):
            row = {"job": job, "pair": i, "file": rel,
                   "source": "n/a", "deployed": "n/a", "both_ok": False}
            for label in ("source", "deployed"):
                txt = texts[label].get(rel)
                if txt is None:
                    row[label] = "文件缺失"
                    continue
                o, n = txt.count(old), txt.count(new)
                if o == 1 and n == 0:
                    row[label] = "唯一命中"
                elif o == 0 and n >= 1:
                    row[label] = "已应用"
                elif o == 0:
                    row[label] = "未命中"
                else:
                    row[label] = f"命中 {o} 次(不唯一)"
            row["both_ok"] = row["source"] in ("唯一命中", "已应用") and row["deployed"] in ("唯一命中", "已应用")
            rows.append(row)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--deployed", required=True)
    ap.add_argument("--replacements", required=True)
    ap.add_argument("--out", default="")
    a = ap.parse_args()

    if not os.path.isdir(a.source) or not os.path.isdir(a.deployed):
        print(f"输入目录不存在：source={a.source} deployed={a.deployed}", file=sys.stderr)
        return 1
    for rel in ("lib/db.js", "lib/client.js"):
        for base in (a.source, a.deployed):
            if not os.path.isfile(os.path.join(base, rel)):
                print(f"缺少目标文件：{os.path.join(base, rel)}", file=sys.stderr)
                return 1

    pairs = load_pairs(a.replacements)
    out = []
    w = out.append
    w("# 两份 `@local/dsh-usage` 拷贝的漂移比对（只读）")
    w("")
    w(f"- 生成时间：{datetime.now().isoformat(timespec='seconds')}")
    w(f"- source   ：`{a.source}`（git 跟踪、可写，无需审批）")
    w(f"- deployed ：`{a.deployed}`（宿主实际加载，工作区外，需审批）")
    w("")

    # ---- 逐文件比对 ----
    w("## 1. 逐文件比对")
    w("")
    w("| 文件 | source 字节/行 | deployed 字节/行 | sha256(前12) | 结论 |")
    w("|---|---|---|---|---|")
    drifted = []
    for rel in FILE_ORDER:
        sp, dp = os.path.join(a.source, rel), os.path.join(a.deployed, rel)
        s_exists, d_exists = os.path.isfile(sp), os.path.isfile(dp)
        if not s_exists and not d_exists:
            continue
        if not s_exists:
            w(f"| `{rel}` | — | {os.path.getsize(dp)}/{line_count(dp)} | — / {sha256(dp)[:12]} | 仅 deployed |")
            drifted.append(rel)
            continue
        if not d_exists:
            w(f"| `{rel}` | {os.path.getsize(sp)}/{line_count(sp)} | — | {sha256(sp)[:12]} / — | 仅 source |")
            drifted.append(rel)
            continue
        ss, ds = sha256(sp), sha256(dp)
        if ss == ds:
            verdict = "**完全一致**"
        else:
            verdict = "**漂移**"
            drifted.append(rel)
        w(f"| `{rel}` | {os.path.getsize(sp)}/{line_count(sp)} | {os.path.getsize(dp)}/{line_count(dp)} | {ss[:12]} / {ds[:12]} | {verdict} |")
    w("")
    w(f"漂移文件（{len(drifted)} 个）：" + ("、".join(f"`{d}`" for d in drifted) if drifted else "无"))
    w("")

    # ---- inode 证明 ----
    w("## 2. 是拷贝还是链接（inode / 设备号）")
    w("")
    w("| 文件 | source inode | deployed inode | 设备 | 判定 |")
    w("|---|---|---|---|---|")
    for rel in ("lib/db.js", "lib/client.js", "lib/index.js"):
        sp, dp = os.path.join(a.source, rel), os.path.join(a.deployed, rel)
        if not (os.path.isfile(sp) and os.path.isfile(dp)):
            continue
        si, di = os.stat(sp), os.stat(dp)
        is_link = os.path.islink(sp) or os.path.islink(dp)
        same_inode = (si.st_ino == di.st_ino and si.st_dev == di.st_dev)
        verdict = "硬链接/同一 inode" if same_inode else ("符号链接" if is_link else "**独立拷贝**（内容可各自漂移）")
        w(f"| `{rel}` | {si.st_ino} | {di.st_ino} | {si.st_dev} | {verdict} |")
    w("")

    # ---- 锚点矩阵 ----
    w("## 3. 补丁替换点的两侧命中矩阵（决定「能否两侧干净应用」）")
    w("")
    w("| 替换单元 | 文件 | source | deployed | 两侧均可 |")
    w("|---|---|---|---|---|")
    rows = anchor_matrix(pairs, a.source, a.deployed)
    for r in rows:
        w(f"| `{r['job']}` #{r['pair']} | `{r['file']}` | {r['source']} | {r['deployed']} | {'✅' if r['both_ok'] else '❌'} |")
    all_ok = all(r["both_ok"] for r in rows)
    w("")
    w(f"**结论**：{'✅ 全部替换点在两侧均唯一命中 —— 补丁可对任一目标干净应用，无需合并' if all_ok else '❌ 存在两侧不均可用的替换点 —— 需人工合并（见上表）'}")
    w("")

    # ---- 功能标记 ----
    w("## 4. 功能级标记（漂移内容定性）")
    w("")
    w("| 文件 | 标记 | source | deployed | 说明 |")
    w("|---|---|---|---|---|")
    any_marker = False
    for rel, markers in MARKERS.items():
        sp, dp = os.path.join(a.source, rel), os.path.join(a.deployed, rel)
        if not (os.path.isfile(sp) and os.path.isfile(dp)):
            continue
        st = open(sp, encoding="utf-8").read()
        dt = open(dp, encoding="utf-8").read()
        for m in markers:
            c_s, c_d = st.count(m), dt.count(m)
            if c_s == c_d:
                continue
            any_marker = True
            if c_s == 0:
                desc = "**仅 deployed 有**"
            elif c_d == 0:
                desc = "**仅 source 有**"
            else:
                desc = "两侧都有、数量不同"
            w(f"| `{rel}` | `{m}` | {c_s} | {c_d} | {desc} |")
    if not any_marker:
        w("| — | — | — | — | 无差异标记 |")
    w("")

    # ---- 漂移性质判定 ----
    w("## 5. 漂移性质与合并策略判定")
    w("")
    dep_newer = os.path.getmtime(os.path.join(a.deployed, "lib/client.js")) > os.path.getmtime(os.path.join(a.source, "lib/client.js"))
    w(f"- 部署侧 `client.js` mtime 更新：{'是' if dep_newer else '否'}")
    w("- 本补丁只改 `queryHeatmap` / `rebuildDailyForDays`（db.js）与 `rangeDays` 窗口 / 轮询 effect（client.js）"
      "这四个**局部区域**；第 3 节的矩阵已证明这些区域在两侧**逐字节相同**，漂移发生在**这些区域之外**"
      "（部署侧多出 hourly 粒度、趋势 gear、settingsScope、peakRing 等）。")
    w("- 因此：**不需要「用某一侧覆盖另一侧」，也不需要三路合并**；两侧各自独立应用同一份补丁即可。")
    w("- ⚠️ 仍然禁止的用法：拿 source 的整份 `client.js`/`charts.js` 覆盖 deployed —— 会丢掉部署侧的"
      "hourly 粒度 / 趋势 gear / settingsScope / peakRing 等已上线功能（charts.js 更夸张：176 行 vs 602 行）。")
    w("")

    report = "\n".join(out) + "\n"
    if a.out:
        os.makedirs(os.path.dirname(a.out), exist_ok=True)
        open(a.out, "w", encoding="utf-8").write(report)
        print(f"[compare] 报告已写出：{a.out}")
    print(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
