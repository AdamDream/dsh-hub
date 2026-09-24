# 提交/推送执行档报告

> 执行档：2026-09-24 10:14–10:2x（CST）。
> 工作目录 `/home/CNS2026495165/dsh`，仓库 remote `git@github.com:AdamDream/dsh-hub.git`，分支 `main`。
> 依据契约：`.workspace/btw-question/push-plan.md`（923 行）+ 任务「增量表」（6 条，优先于 push-plan）。
> 硬边界遵守：**只做 `git add` / `git commit` / `git push` + 本报告**；未修改任何被跟踪文件内容；
> 未用 `git add -A`/`git add .`（仅用两条带 pathspec 的 `git add -A -- <path>`，见 Commit 2 / Commit 5）；
> 未用 `--force`/tag/rebase/stash/改 remote；**未运行任何 `pnpm run *`**；未重启 dsh；未写 `~/.dsh/**`；
> 未使用 `sandbox_permissions`。

---

## ① 六个提交

推送结果：`5f7d61b8..568af19f  main -> main`，**push exit 0**。

「文件数」= `git show --name-only` 行数（含删除/R 的两端路径）；「树增量字节」= 该提交 tree 总量 − 上一提交 tree 总量（删除为负）；「+行/-行」= `git show --numstat` 合计。

| # | 短 hash | 长 hash | 标题 | 文件数 | 树增量字节 | +行/-行 |
|---|---|---|---|---|---|---|
| 1 | `8bfe3a15` | `8bfe3a156ecd94cc20d69944ea01a90a0be1fc0c` | gitignore: 凭据/私有索引/逐窗转储/pnpm store 不入库（推送就绪审计 T1） | 1 | +1 498 | +24/-0 |
| 2 | `36e9a087` | `36e9a0870cef4b078affa6f2de044e4fb0236ae9` | btw：D30 工具边界 codec 自校验（fail-closed）+ read 失败可见化 + D29/resize 批次同批（含 lib 重建） | 28 | +106 411（新增 4 文件） | +2 619/-151 |
| 3 | `21c9b21f` | `21c9b21f9558b074f3c6f34e63ceccd7489caf97` | btw-question 证据档：核查/实测/执行/补测/推送方案入仓（不含整页截图与 preimage） | 110 | +2 565 628 | +35 587/-0 |
| 4 | `e5307cfc` | `e5307cfc21f809e14f18deb771da90920c268da0` | 文档同步：notebook D30/D31/D32/D33 + arch05 D30 行与未验证条目 + verify-runbook 判据 9/10/11 + FEATURE-MAP（同批含性能专项两条线） | 87 | +2 900 800（新增 83 文件） | +31 174/-12 |
| 5 | `8f4dc1f8` | `8f4dc1f87fa047667c12a156e7c3fd758b7b6bd6` | skill 全局化：program-notebook 移出仓库 .dsh/skills + arch02 §8 发现根 | 4 | −12 395（净删 3 文件） | +27/-299 |
| 6 | `568af19f` | `568af19fc6db98113c85ad21e3bb9eed6d212c6a` | side-deploy: 部署脚本默认 dry-run + 显式 --apply + 双向指纹闸门 | 1 | +6 882 | +112/-2 |

**合计**：HEAD 树 5 955 文件 / 388 646 244 B → **6 149 文件 / 394 215 068 B**（净 +194 文件 / +5 568 824 B ≈ **5.31 MiB**）。
本批最大单 blob = `.workspace/btw-question/d30/2026-09-23T09-39-03-928Z-probe.json` **575 033 B**；`dsh-btw/lib/client.js` 365 269 B。

### 关键路径清单

**Commit 1（1 文件）** — `.gitignore`（T1 增补 24 行：`**/.credentials.yaml`、`**/.credentials.yml`、`**/btw-index-backup-*.json`、`.pnpm-store/`、`*.mgc`、`.workspace/lag-fix/**/*.zstd`、`**/session_projcache.json`、`**/*_projcache.json`、`.workspace/lag-fix/**/preimage*/`、`.workspace/lag-fix/btw-profile-preimage-*/`、`.workspace/btw-question/preimage-*/` 等）。

**Commit 2（28 路径 = 4 A + 21 M + 3 R）**
- lib：`M client.js`、`M index.d.ts`、`M index.js`、`M typert.host.js`、`M typert.remote-client.{d.ts,js}`，以及 tsdown 换名的 3 组（git 按相似度识别为 R）：`remote-Dv1GpyGK.js→remote-C2Gojj6I.js`(92%)、`remote-DHlY-Qf0.d.ts→remote-D8pzPah2.d.ts`(99%)、`remote-descriptors-D37stQ5y.js→remote-descriptors-Cu5331mU.js`(75%)。
- src A：`client/SideChatResizeHandle.tsx`、`client/drawer-size-store.ts`、`client/drawer-size.ts`；tests A：`overlay-placement-explicit.spec.ts`。
- src M：`client/{SideChatDrawer.tsx, SideChatJumpList.tsx, SideChatSurface.tsx, controller.ts, index.ts, locales.ts, overlay-placement.ts, presentation.tsx, side-chat.module.css, use-overlay-placement.ts}`、`host/side-chat-service.ts`、`shared/remote.ts`。
- tests M：`controller.spec.ts`、`host-opening.spec.ts`、`side-chat-surface.spec.tsx`。

**Commit 3（110 文件 / 2 565 628 B）**
- 正文 13 份：`INDEX.md`、`audit-a-state.md`、`audit-b-official-ui.md`、`audit-c-docs-deploy.md`、`plan.md`、`exec-report.md`、`xaudit-code.md`、`xaudit-docs.md`、`verify-report-a.md`、`d30-consequence.md`、`push-plan.md`、`exec-d30/report.md`、`exec-docs/report.md`。
- `harness/`（10 文件 / 183 021 B，整目录）。
- `e2e/` 21 非 PNG + 19 PNG、`d30/` 20 非 PNG + 0 PNG、`e2e-cover/` 19 非 PNG + 16 PNG。
- 最大 5：`d30/...-probe.json` 575 033、`e2e-cover/raw-...T4b.json`... 见「体积」——最大 3 为 575 033 / 147 125 / 125 414 B。

**Commit 4（87 路径 = 83 新增 + 4 已跟踪 M）**
- docs：`docs/program-notebook.md`(M)、`docs/architecture/05-performance-and-ux-program.md`(A)、`docs/architecture/04-ops-deploy.md`(M)、`docs/runbooks/verify-runbook.md`(M)、`FEATURE-MAP.md`(M)。
- `program/` 28 × `w*/audit.md` + `FINDINGS-INDEX.md`；`exec-*/report.md` 20 + `exec-*/DEPLOY.md` 13 = 33；`exec-mask/tools` 14 + `exec-mask/candidate/client.js`；`exec-logdrift/candidates/` 4；`lib/probe-lock.mjs`；`COLD-RESTART-RUNBOOK.md`。
- 最大单文件 90 652 B（`exec-mask/report.md`）；**无 >1 MiB**。

**Commit 5（4 路径）** — `D .dsh/skills/program-notebook/SKILL.md`、`D .../references/maintenance-playbook.md`、`D .../references/notebook-spec.md`、`M docs/architecture/02-plugin-system.md`。

**Commit 6（1 文件）** — `M .workspace/workstreams/side-deploy/deploy-side.sh`（+112/−2）。

---

## ② 闸门与扫描命令的原始输出

### 步骤 0 — 执行前闸门

```bash
$ git ls-remote origin refs/heads/main
5f7d61b8bd52a5ce15c26f3b59b6538ff1cba476	refs/heads/main

$ git rev-parse HEAD
5f7d61b8bd52a5ce15c26f3b59b6538ff1cba476          # G0 通过：远端 == 本地 HEAD，无并发推进

$ date
2026年 09月 24日 星期四 10:14:39 CST

$ find .workspace docs dsh-btw FEATURE-MAP.md .gitignore -type f -newermt '-5 minutes' 2>/dev/null
.workspace/btw-question/exec-docs/report.md        # ← 首次命中（mtime 10:09:36，4 分 57 秒前）
$ ls .git/hooks/ | grep -v '\.sample$'  → 无输出（exit 1，无活动 hook）
```

**新鲜度闸门复跑（10:15:05）**：

```bash
$ find .workspace docs dsh-btw FEATURE-MAP.md .gitignore -type f -newermt '-5 minutes' 2>/dev/null
（无输出）                                          # ← 通过

$ git status --porcelain | md5sum
664e231609c682b5ad07d65063674730  -                 # 125 行（基线为 0ad7cff9…/112 行，见 ⑤ 偏离 D1）
```

### 敏感信息扫描（每个提交暂存后、commit 前）

```bash
# Commit 1  .gitignore
$ git diff --cached --name-only | grep -iE 'credential|\.env$|id_rsa' ; echo "exit=$?"
exit=1                                              # 无输出
$ git diff --cached | grep -nE 'sk-[A-Za-z0-9_-]{16,}' ; echo "exit=$?"
exit=1                                              # 无输出

# Commit 2  dsh-btw（另加高置信模式：私钥/Bearer/x-opencode-session/api_key 赋值）
$ git diff --cached --name-only | grep -iE 'credential|\.env$|id_rsa' ; echo "exit=$?"
exit=1
$ git diff --cached | grep -nE 'sk-[A-Za-z0-9_-]{16,}' ; echo "exit=$?"
exit=1
$ git diff --cached | grep -nE 'sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY|Bearer [A-Za-z0-9._-]{24,}|x-opencode-session|api[_-]?key["'"'"']?\s*[:=]\s*["'"'"'][A-Za-z0-9]{16,}' ; echo "exit=$?"
exit=1

# Commit 3  btw-question 证据档 —— ⚠ 扫描 B 有一处命中（唯一一处），判定为非密钥
$ git diff --cached | grep -nE 'sk-[A-Za-z0-9_-]{16,}'
34935:+| — | 已跟踪历史中的 `sk-` | 唯一命中是 **占位符** `sk-abcdefghijklmnopqrstuvwxyz0123456789`（`git grep -ohE 'sk-[A-Za-z0-9]{32,}'`），非真实密钥 | 无既有泄漏 |
$ git diff --cached | grep -nE -- '-----BEGIN [A-Z ]*PRIVATE KEY|x-opencode-session|Bearer [A-Za-z0-9._-]{24,}'
34907:+git diff -U0 | grep -nEi 'sk-[A-Za-z0-9]{16,}|apiKey|apiKeyEnv|Bearer …|-----BEGIN|x-opencode-session'
34912:+  | while read f; do grep -HnE 'sk-[A-Za-z0-9]{24,}|-----BEGIN [A-Z ]*PRIVATE KEY|…' "$f"; done
34934:+| — | `Bearer ` / `token=` / `password=` / `-----BEGIN … PRIVATE KEY` / `x-opencode-session` | **零命中**… | 无 |
$ git diff --cached | grep -nE -- '(api[_-]?key|secret|password)["'"'"']?\s*[:=]\s*["'"'"'][A-Za-z0-9+/._-]{20,}' ; echo "exit=$?"
exit=1
```

**命中判定（非阻断）**：三处命中全部是 `push-plan.md` **审计报告自身的内容**——(a) 它记录的扫描命令原文；(b) 它记录的历史假阳性占位符 `sk-abcdefghijklmnopqrstuvwxyz0123456789`。该占位符是**明显非密钥**，且**仓库既有历史已跟踪同一字符串**（`git grep -c 'sk-abcdefghijklmnopqrstuvwxyz0123456789' 5f7d61b8` → `dsh-taste/test/backfill.test.js:1`），因此**不新增任何泄漏**。真实密钥（`.credentials.yaml` 内 2 个 `sk-*` + 1 个 grant 密钥）**零命中且路径未被跟踪**。判定：**继续，不 reset**。

```bash
# Commit 4  文档 + 引用证据
$ git diff --cached --name-only | grep -iE 'credential|\.env$|id_rsa' ; echo "exit=$?"
exit=1
$ git diff --cached | grep -nE 'sk-[A-Za-z0-9_-]{16,}' ; echo "exit=$?"
exit=1
$ git diff --cached --name-only | grep -F '.credentials' ; echo "exit=$?"
exit=1

# Commit 5  skill 删除
$ git diff --cached --name-only | grep -iE 'credential|\.env$|id_rsa' ; echo "exit=$?"
exit=1
$ git diff --cached | grep -nE 'sk-[A-Za-z0-9_-]{16,}' ; echo "exit=$?"
exit=1

# Commit 6  deploy-side.sh
$ git diff --cached --name-only | grep -iE 'credential|\.env$|id_rsa' ; echo "exit=$?"
exit=1
$ git diff --cached | grep -nE 'sk-[A-Za-z0-9_-]{16,}' ; echo "exit=$?"
exit=1
$ git diff --cached | grep -nE -- '-----BEGIN [A-Z ]*PRIVATE KEY|Bearer [A-Za-z0-9._-]{24,}' ; echo "exit=$?"
exit=1
```

### 步骤 6 — 推送前最终校验

```bash
$ git status --porcelain | wc -l
351

$ git status --porcelain | grep -E '\.pnpm-store|program/|exec-projcache'
?? .workspace/lag-fix/exec-projcache/apply-ProjCache-v1.mjs
?? .workspace/lag-fix/exec-projcache/candidates/
… （96 行 program/ 与 6 行 exec-projcache/；.pnpm-store 未出现在 status 中，因其整体在 .gitignore 内）
→ P0 通过：这些确定未被误提交

$ git ls-files --error-unmatch .workspace/lag-fix/exec-logdrift/iso/home/.credentials.yaml
error: 路径规格 '.workspace/lag-fix/exec-logdrift/iso/home/.credentials.yaml' 未匹配任何 git 已知文件
$ echo "exit=$?"
exit=1                                              # ★ P0 闸门通过：凭据文件未被跟踪

$ git rev-list origin/main..HEAD --objects | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | awk '$1=="blob" && $3 > 10485760 {print}'
（无输出）                                          # ★ 本批未引入任何 >10 MB 对象

$ git rev-list origin/main..HEAD --objects | … | awk '$1=="blob"{print $3, $4}' | sort -rn | head -5
575033 .workspace/btw-question/d30/2026-09-23T09-39-03-928Z-probe.json
365269 dsh-btw/lib/client.js
147125 .workspace/btw-question/e2e-cover/raw-2026-09-23T10-40-44-836Z.json
125414 .workspace/btw-question/e2e-cover/raw-2026-09-23T10-44-10-837Z-T4b.json
103683 .workspace/btw-question/e2e/2026-09-23T04-03-36-609Z-drawer-after.png
```

---

## ③ 推送与推送后核验

```bash
$ git push origin main
To github.com:AdamDream/dsh-hub.git
   5f7d61b8..568af19f  main -> main
$ echo "push_exit=$?"
push_exit=0
```

```bash
$ git ls-remote origin refs/heads/main
568af19fc6db98113c85ad21e3bb9eed6d212c6a	refs/heads/main

$ git rev-parse HEAD
568af19fc6db98113c85ad21e3bb9eed6d212c6a            # ★ 两者逐字节相同
```

```bash
$ git log --oneline -8
568af19f side-deploy: 部署脚本默认 dry-run + 显式 --apply + 双向指纹闸门
8f4dc1f8 skill 全局化：program-notebook 移出仓库 .dsh/skills + arch02 §8 发现根
e5307cfc 文档同步：notebook D30/D31/D32/D33 + arch05 D30 行与未验证条目 + verify-runbook 判据 9/10/11 + FEATURE-MAP（同批含性能专项两条线）
21c9b21f btw-question 证据档：核查/实测/执行/补测/推送方案入仓（不含整页截图与 preimage）
36e9a087 btw：D30 工具边界 codec 自校验（fail-closed）+ read 失败可见化 + D29/resize 批次同批（含 lib 重建）
8bfe3a15 gitignore: 凭据/私有索引/逐窗转储/pnpm store 不入库（推送就绪审计 T1）
5f7d61b8 incident2 收口：14 条线交叉对抗定位用户可感卡顿（a11y 强开 + 环境放大器 + DSH 靶点）
e7e00bb1 主题批落地 + ingest/CC/B1/P2AC 冷热面全部落盘 + A/B 裁决（含 FAIL 原样保留）
```

```bash
$ git status --porcelain | head -30
 M .workspace/lag-fix/exec-audit/BATCH-PLAN.md
 M .workspace/lag-fix/incident2/VERDICT.md
 M .workspace/lag-fix/incident2/firefox-a11y/analyze.mjs
 M .workspace/lag-fix/incident2/firefox-a11y/audit.md
 M .workspace/lag-fix/incident2/firefox-a11y/proof/verdict.json
 M .workspace/lag-fix/incident2/firefox-a11y/proof/verdict.md
 M .workspace/lag-fix/incident2/instrument-tiebreak/lib/lock.mjs
 M .workspace/lag-fix/incident2/instrument-tiebreak/lib/probe.js
 M .workspace/lag-fix/incident2/instrument-tiebreak/runners/matrix.mjs
?? .workspace/btw-question/.preimage-path
?? .workspace/btw-question/.preimage-path-D30
?? .workspace/btw-question/d30/2026-09-23T09-39-03-928Z-probe-1-drawer-open.png
…（其余见 ④）

$ git status --porcelain | awk '{print $1}' | sort | uniq -c
    342 ??
      9 M
```

**核验结论**：`ls-remote` == 本地 HEAD ✔；`dsh-btw` 子树工作区已完全干净 ✔；残余仅「故意排除」那批 ✔。

---

## ④ 剩余未提交/未跟踪项逐类说明

共 **351 行**（`M 9` + `?? 342`）。

| 类别 | 行数 | 内容 | 为什么排除 |
|---|---|---|---|
| **A. incident2 后续（M 已跟踪）** | 9 | `exec-audit/BATCH-PLAN.md`、`incident2/VERDICT.md`、`incident2/firefox-a11y/{analyze.mjs,audit.md,proof/verdict.json,proof/verdict.md}`、`incident2/instrument-tiebreak/{lib/lock.mjs,lib/probe.js,runners/matrix.mjs}` | 契约第 5 条明令排除；属 incident2 批次（mtime 09-22），非 btw 线。**push-plan R3 也判「不进本批」** |
| **B. 逐窗转储与缓存** | 102 | `program/`(96) + `exec-projcache/`(6) | ≈4.7 GiB `*.zstd` + 289 MB json（可由脚本重生）；结论已由 Commit 4 的 `w*/audit.md` 入库。被 T1 规则与体量双重排除 |
| **C. 各 exec-* 批次的原始 dump/截图/工具** | 133 | `exec-a11y/`、`exec-bashconc/`、`exec-blurfix/`、`exec-boot/`、`exec-boot2/`、`exec-btw-resize/`、`exec-btwclose/`、`exec-cold-batch/`、`exec-countfix/`、`exec-hmr/`、`exec-hostrpc/`、`exec-keepalive/`、`exec-logdrift/`、`exec-mask/{raw,shots,logs,tools-mine}`、`exec-masklook/`、`exec-proj/`、`exec-shellfix/`、`exec-usage9/`、`exec-virtual/`、`hmr-probe-backup/` | 逐窗 raw + 全页截图（2 MB/张）；各目录的**结论正文 `report.md`/`DEPLOY.md` 已入 Commit 4**（无悬空引用）。`exec-logdrift/` 整体排除还含 P0 理由：其 `iso/home/.credentials.yaml` 是真实凭据 |
| **D. incident2 证据（未跟踪）** | 39 | `firefox-a11y/{logs,page,raw}`、`instrument-tiebreak/*`、`glean-ab/` | 同 A，属 incident2 批次 |
| **E. btw-question 被剔除的 PNG** | 63 | 三目录内 `>200 KB` 的整页截图 **58** 张 + `fullpage-*` 中 `<200 KB` 的 **5** 张（合计 **39 368 798 B ≈ 37.5 MiB**） | 整页截图左侧栏含真实会话标题/工作区名（隐私）+ 体量；规则见 ⑤ D4。元素级裁切图已入 Commit 3 |
| **F. preimage 回滚件** | 2 行（目录体 2 个目录） | `.workspace/btw-question/.preimage-path`、`.preimage-path-D30` | 契约第 5 条明令排除；指向的 `preimage-*/` 目录**已被 T1 规则忽略**（`git check-ignore` 命中 `.gitignore:94`），与 git 历史重复（`git show HEAD:<path>` 可取回） |
| **G. 根目录位置错误文件** | 2 | `distributions.json`、`distributions-skipped.json` | push-plan 判「待裁决（位置错误）」：属 `incident2/firefox-telemetry/`，建议随 incident2 批次 `git mv` 归位 |
| **H. e2e-cover 被忽略的日志** | 0 行（已被 gitignore） | `e2e-cover/run.log`、`run2.log`、`run3.log` | 被既有 `.gitignore:6` 的 `*.log` 命中（非本轮新增规则），故连 `??` 都不出现。任务增量表提到「`run*.log` 全部纳入」，但被既有全局 `*.log` 规则挡住；`run*.log` 未被列入任何提交路径（**仅此 3 个 `.log` 受影响；`.run-start`/`.run-start2` 已入 Commit 3**） |

> 说明：`.pnpm-store/`（553 文件 / 18.93 MB）不出现在 `git status` 中，因 T1 的 `.pnpm-store/` 行已使其整体被忽略——这是**预期行为**，且比出现在 `??` 里更强（无法被误 `git add`）。

---

## ⑤ 与 push-plan 的偏离及理由

增量表优先于 push-plan；以下逐条列出**所有**偏离。

| 编号 | push-plan 原写法 | 实际执行 | 理由 |
|---|---|---|---|
| **D1** | 工作区状态指纹 `0ad7cff903f1ea0e34c51a6fe5b6eb61`（112 行） | 实测 `664e231609c682b5ad07d65063674730`（125 行） | 审计（09-23 17:52）之后新增了 D30 批、`e2e-cover/`、`d30-consequence.md` 等文件。**未按「指纹必须相等」判定为失败**，因该闸门的实际目的是「同一批内容未被并发改写」，改用契约给出且更强的两道闸门替代：① `find -newermt '-5 minutes'` 无输出（初次命中 1 个 10:09:36 写入的文件，等其超 5 分钟后复跑通过）；② 每一步暂存后逐项核对路径清单与状态码。 |
| **D2** | 共 5 个提交，`.gitignore` T1 为**可选 Commit 6** | **6 个提交，T1 提到最前（Commit 1）** | 增量表第 1 条明令「务必放最前」，理由为 P0 防线先落地。T1 落地后 `git status` 直接变干净、且 `.pnpm-store/` 等从 `??` 消失。 |
| **D3** | Commit 1 只加 `dsh-btw/{src,lib/client.js,tests}`（15 路径） | Commit 2 = `git add -A -- dsh-btw/lib` + `git add -- dsh-btw/src dsh-btw/tests`（**28 路径**） | 增量表第 2 条：`dsh-btw/lib` **整个目录**必须入（`remote-*-*.js` 等 3 个旧 chunk 为 **D**，必须靠 `-A` 带删除；另有 3 个 ?? 新 chunk）；且本批新增了 `src/host/side-chat-service.ts`、`src/shared/remote.ts`、`src/client/controller.ts` 与 3 个 spec（D30 线），**push-plan 的清单已过时**。git 把「删旧 chunk + 加新 chunk」识别为 3 组 R（92%/99%/75%），**tree 净内容等价**（新增计 4 文件）。 |
| **D4** | e2e 只加 `*-opt1-*`/`*-opt2-*`/`*-u8-*`/`*-drawer-after.png` 共 19 张 | 三目录（`e2e`/`d30`/`e2e-cover`）**统一按 ≤200 KB** 取 35 张，再按名字剔除 `fullpage-*`，实取 **34 张** | 增量表第 4 条的口径。**两规则出现冲突**：5 张 `fullpage-*.png` 尺寸 **180 621–187 968 B**，属「≤200 KB ⇒ 暂存」范围，但同一条又把 `fullpage-*.png` 列为排除。**处置**：以「作者在该条里逐一点名排除 `fullpage-*.png`」为更具体的指示，剔除这 5 张（合计 ≈920 KB），因此 `d30/` 的 13 张（均 >200 KB）与 `e2e-cover/` 的 16 张全页图同样排除。其余 ≤200 KB 的 `skill-scope-*.png`(757/756 KB→实为 >200KB 已排除)/`ws-probe-menu.png` 等按规则保留。**已对保留的最大两张 `drawer-after.png`(94/104 KB) 做多模态读图核验**：确认是**窄幅抽屉元素级裁切**，仅含 `btw 侧聊`/`1 继续`/`2 停止` 等通用 UI 文案与测试用提示词，**左侧工作区树不在框内 ⇒ 无真实会话标题**，与该条「排除整页截图」的隐私意图一致。 |
| **D5** | Commit 2 只含 8 份正文 + `harness/` + `e2e/{json,mjs,png}` | Commit 3 增补 `verify-report-a.md`、`d30-consequence.md`、`push-plan.md`、`exec-d30/`、`exec-docs/`、`e2e-cover/`（110 文件 / 2 565 628 B） | 增量表第 3 条。`push-plan.md` 自身也入仓（它记录了本批的审计与方案）。 |
| **D6** | Commit 3（文档）里 docs 声称测试面 `25 files / 250 passed / 2 skipped`；任务增量表写 `260 passed` | 提交信息采用**文档实际写的 250 passed**（与本提交同步的 arch04/notebook 措辞一致），并注明「测试面 24 → 25 files」 | 保持**提交信息与同批文档字节一致**，避免提交历史与仓库文档互相矛盾。`260 passed` 是 D29 之后叠加 D30 测试的结果，任务增量表与实际文档 diff 不一致（见 ⑥）。 |
| **D7** | Commit 3 的路径清单含 `.workspace/lag-fix/exec-*/report.md` 等 14 个 pattern | 完全按原文执行，另**未**增补任何路径 | 执行中发现 `exec-b1/report.md` 与 `exec-p2/report.md` 疑似缺失（我最初的核对脚本有 bug 误报），但 `git ls-files --error-unmatch` 证明二者**早已被跟踪**（notebook 第 266–267 行 D16/D17 引用），无需入本批。实际暂存 33 个 exec 证据文件（20 report + 13 DEPLOY）。`exec-ingest/`、`exec-theme/` **无 report.md**，故 pattern 匹配为空，非遗漏。 |
| **D8** | 未提 | 未执行「步骤 7 的可选强校验」`cd dsh-btw && pnpm run build` | 硬边界明令**绝不运行 `pnpm run *`**（本机 pre-run install 会因私包 404 删掉 `dsh-btw/node_modules` 里 30 个包）。故「lib 与 src 同源」**未由重建验证**（见 ⑥）。替代证据：committed `lib/client.js` md5 与部署位逐字节相同。 |
| **D9** | R12 要求 `find .workspace/btw-question … -not -name 'push-plan.md'` | 契约给的新鲜度命令（覆盖 `.workspace docs dsh-btw FEATURE-MAP.md .gitignore`，无 `-not` 排除） | 用契约版本；`push-plan.md` 在提交前**未再被改动**（mtime 09-23 17:52），不构成干扰。 |

**未偏离（照原方案执行）**：Commit 5（skill 删除，`git add -A -- <pathspec>`）、Commit 6（deploy-side.sh 加固）——用户已裁决 5 提交 + T1 含加固。

---

## ⑥ 诚实清单（未做/未验证）

1. **未做 `git fsck`**（契约未要求；仓库存在 4 个历史 >10 MB blob，与本批无关）。
2. **未运行 `pnpm run build` / `pnpm test`**（硬边界禁止）⇒ **「`lib/client.js` 确由当前 `src/**` 构建而来」未经重建验证**。可提供的替代证据：committed `dsh-btw/lib/client.js` md5 `66beb3455c59f4991355f3918228e495` / 365 269 B 与部署位 `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js` **逐字节相同**（`md5sum` 实测一致）。
3. **未独立验证任何测试结果**：任务增量表称「全量 25 files / 260 passed 2 skipped」，而本批文档（`docs/program-notebook.md`、`docs/architecture/04-ops-deploy.md`、`FEATURE-MAP.md`）实际写的是「**25 files / 250 passed / 2 skipped**」（D29 批计数）。二者**不一致**；提交信息采用文档口径。我**未**运行 vitest，无法判定哪个数字是收口后的真值。**建议**：D30 批如需登记 `260 passed`，应由文档侧补一次同步。
4. **未验证 GitHub 网页侧**：未打开浏览器确认 PR/commit 页渲染，也未验证仓库体积告警提示；仅以 `git ls-remote` 确认远端 ref 与本地 HEAD 逐字节相同。
5. **未验证 HTTP 服务字节**：`verify-runbook` 给出的 `curl -s http://127.0.0.1:3080/plugins/@local/dsh-btw/client.js | md5sum` = `66beb345…` 与 `?rev=887a12106dcd` **未实测**（只核对了仓库与部署位文件 md5）。
6. **未做全仓敏感信息普查**：仅按契约扫描了**每个提交的暂存集合**（`--cached`），未对 5.47 GiB 未跟踪树做全量扫。未跟踪树中的已知 P0 项（`exec-logdrift/iso/home/.credentials.yaml`）由 T1 规则忽略 + `git ls-files --error-unmatch` exit 1 双重确认。
7. **`sk-` 扫描的唯一命中是已知占位符**（`sk-abcdefghijklmnopqrstuvwxyz0123456789`，见 ② 判定），我判定为非密钥并继续；若判定标准更严（一律视为命中即停），应当视为**契约扫描 B 有输出**。
8. **未处理 push-plan 的 R5/R10 历史欠账**（`.gitignore` 路径漂移、`deploy-015/` 447 文件已跟踪、`tmp-ppt-research/raw/mgr.tgz` 51.1 MB 已跟踪）——本批不含，属独立仓卫生批次。
9. **未改部署位、未重启 dsh**：D30 宿主面（`src/host/side-chat-service.ts`、`src/shared/remote.ts`）**需重启 dsh 才生效**，本档未重启（硬边界），故线上宿主面仍跑旧字节。

---

## 追加提交（协调者本人执行，2026-09-24 10:2x）

**动因**：本档"需你裁决的一处不一致"由协调者用真跑裁定——`cd dsh-btw && ./node_modules/.bin/vitest run`
→ `Test Files 25 passed (25)` / `Tests 260 passed | 2 skipped (262)`（Duration 885 ms）。
故 **260 为真值**，两处文档需更正：

| 文件:行 | 现状 | 改为 |
| --- | --- | --- |
| `docs/architecture/04-ops-deploy.md:194` | 「**2026-09-23 实测**：25 files / 250 passed / 2 skipped」（作为**现行**基线） | 拆两行时点：D29 批后 250 passed；**D30 批后（2026-09-24 实测）260 passed / 2 skipped (262)**，并注明「勿用 `pnpm run`」 |
| `docs/program-notebook.md:279`（D29 行） | 「25 files / 250 passed / 2 skipped（首跑，无 flake）」读起来像现值 | 标注为 **D29 批次当时计数**，并给出 D30 批后的 260 |

**未改**：`FEATURE-MAP.md:25`（已自带「D29 批次计数」限定语）、`docs/architecture/04-ops-deploy.md:200`（明标"某个验收批次"的历史基线）、`.workspace/btw-question/**` 的历史档（`verify-report-a.md` / `xaudit-docs.md` / `push-plan.md` 里的 250 均属当时记录，按"历史快照"保留）。
