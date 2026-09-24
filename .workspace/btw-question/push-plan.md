# btw 问答卡片批 — 推送就绪审计与提交/推送方案

> 审计档：2026-09-23。**只读审计 + 本文件**；本轮未执行任何 git 写操作（无 add/commit/push/stash/checkout/restore），
> 未改动除本文件以外的任何仓库文件。所有数字均为本轮实测（命令附于各节）。
> 审计时点工作区状态指纹：`git status --porcelain | md5sum` = `0ad7cff903f1ea0e34c51a6fe5b6eb61`（112 行）。

---

## 推送前状态

| 项 | 实测值 | 取证命令 |
| --- | --- | --- |
| 本地 HEAD | `5f7d61b8bd52a5ce15c26f3b59b6538ff1cba476`（`incident2 收口：14 条线交叉对抗定位用户可感卡顿…`） | `git rev-parse HEAD` |
| 当前分支 | `main` | `git rev-parse --abbrev-ref HEAD` |
| `origin/main` | `5f7d61b8bd52a5ce15c26f3b59b6538ff1cba476` —— **与本地 HEAD 逐字节相同，无并发推进** | `git ls-remote origin refs/heads/main` |
| 远端分支总数 | 1（只有 `refs/heads/main`） | `git ls-remote --heads origin \| wc -l` |
| 工作区改动总行数 | **112**（`M 26` / `D 3` / `?? 83`） | `git status --porcelain \| wc -l`；`awk '{print $1}' \| sort \| uniq -c` |
| 已跟踪修改体积 | 29 文件，`+3411 / -803` 行（含 3 个 D） | `git diff --stat` |
| 未跟踪**文件**总数 | **13808** 个（`--exclude-standard`，即全部可入库候选） | `git ls-files --others --exclude-standard \| wc -l` |
| 未跟踪总体积 | **5599.9 MiB（≈5.47 GiB）** | `git ls-files --others --exclude-standard -z \| xargs -0 stat -c%s \| awk` |
| 其中 >1 MB 的文件 | **761** 个 | 同上 + `awk '$1>1048576' \| wc -l` |
| 未跟踪最大单文件 | **22 808 279 B ≈ 21.75 MiB**（`.workspace/lag-fix/program/w03-persistence/sa1-scan/amp/amp-4/--tmp-sa1amp4-p75--/amp-4-75-35-004835/session.jsonl.zstd`） | `... \| sort -rn \| head -1` |
| **本方案拟入库批次体积** | **≈4.42 MB**（Commit 1 `0.53 MB` + Commit 2 `0.93 MB` + Commit 3 `2.95 MB` + Commit 4 `0.01 MB`）；最大单文件 363 814 B（`dsh-btw/lib/client.js`） | 见「提交切分方案」的逐提交实测字节数 |
| 阻断性 hook | **无**。`.git/hooks/` 只有 14 个 `*.sample`，无 `core.hooksPath` 覆盖 | `ls .git/hooks/`；`git config --get core.hooksPath` |
| CI 阻断 | **无**。仓库无 `.github/`、无根 `package.json`（无 husky/lint-staged） | `ls .github/`；`ls package.json` |
| SSH 只读连通 | **可用**（`git ls-remote` 成功返回） | 见上 |
| **HEAD 已跟踪树体积** | **370.6 MiB / 5955 文件** | `git ls-tree -r -l HEAD \| awk '{s+=$4} END{…}'` |
| **HEAD 中已存在的 >10 MB 跟踪 blob** | **4 个**：`.workspace/tmp-ppt-research/raw/mgr.tgz` **51.1 MB**、`incident2/user-capture/fixtures/real-settings-trace-2.json` 37.3 MB、`real-settings-trace.json` 24.9 MB、`incident2/firefox-telemetry/subagent-units/gecko-tree.json` 18.6 MB | `git rev-list HEAD --objects \| git cat-file --batch-check=… \| awk '$1=="blob" && $3>10485760'` |

**结论（推送可行性）**：`git push` 本身不会撞 GitHub 的硬约束——最大单文件 21.75 MiB 远低于 100 MiB 单文件硬上限，
也没有需要 LFS 的对象。**但「把全部 13808 文件一起推」不可行**：≈5.47 GiB 传输量、761 个 >1 MB 文件，
必然在 push 阶段超时/被仓库体积策略劝退，且会把 3 GB 级别的可重生中间产物永久写进历史。
⇒ **必须按本方案的显式路径清单分提交，逐条 `git add -- <paths>`，严禁 `git add -A` / `git add .`。**

另外必须知道的事实：**HEAD 已跟踪树已是 370.6 MiB / 5955 文件，内含 4 个 >10 MB 的 blob（最大 51.1 MB）**——
这些是**已推送的历史**，本批不引入新的巨型对象（本批最大 363 814 B），但仓库体积治理已属独立议题（见 R10）。

---

## 逐路径分类表

判定口径：**入库**＝本批提交；**忽略**＝不入库并建议加 `.gitignore`；**待裁决**＝本批不便处理，需用户裁定归属批次。

### A. 未跟踪顶层路径（逐一实测）

| 路径 | 文件数 | 可入库体积 | 判定 | 依据 |
| --- | --- | --- | --- | --- |
| `.pnpm-store/` | 553 | 18.93 MB | **忽略** | pnpm 内容寻址存储（`v11/files/*` + `v11/links/@/pnpm/11.7.0/…/pnpm.mjs` 12.6 MB）。机器本地派生、可由 `pnpm install` 完整重建；含 12 565 169 B 单文件。**严禁入库** |
| `.workspace/btw-question/` | 111 | 21.53 MB | **部分入库**（0.96 MB） | 本批主题证据档。见 A2 细分 |
| `.workspace/lag-fix/program/` | 9828 | **4845.92 MB** | **忽略（仅取 78 个 .md / 3.13 MB）** | 8512 个 `*.zstd` 逐窗会话转储（单文件 21.75 MiB ×多次）+ 527 json（**289 MB**，含 11.5 MB `*_projcache.json` / `rpc-session.history-*.json`）。结论正文在 `program/w*/audit.md`。**体积排序第 1 名（4.7 GiB），必须排除** |
| `.workspace/lag-fix/exec-projcache/` | 291 | **362.70 MB** | **忽略** | 逐窗 projectList 缓存快照（含 `full.json` 11.5 MB、`session_projcache.json` 11.5 MB ×多份）。可脚本重生 |
| `.workspace/lag-fix/exec-blurfix/` | 136 | 74.53 MB | **忽略（仅取 report.md 41 KB + DEPLOY.md）** | 模糊方案候选 + 前后截图 |
| `.workspace/lag-fix/exec-boot2/` | 116 | 65.12 MB | **忽略（仅 report.md 29 KB + DEPLOY.md）** | 冷启动批次 raw + 截图 |
| `.workspace/lag-fix/exec-btwclose/` | 282 | 58.38 MB | **忽略（仅 report.md 34 KB）** | btw 关闭批次逐窗 dump |
| `.workspace/lag-fix/exec-mask/shots/` | 21 | 41.79 MB | **忽略** | 逐窗全页截图（≈2 MB/张），可重生 |
| `.workspace/lag-fix/exec-btw-resize/` | 303 | 21.52 MB | **忽略（仅 report.md 55 KB + DEPLOY.md 14 KB）** | 抽屉 resize 批次证据。含 `preimage*/`、`phase*/`、`shots/`、`raw/`——**注意其对应源码在本批 Commit 1**，但原始 dump 不入库 |
| `.workspace/lag-fix/exec-masklook/` | 80 | 21.04 MB | **忽略（仅 report.md 32 KB）** | 星标方案候选 + 截图 |
| `.workspace/lag-fix/exec-mask/raw/` | 609 | 12.92 MB | **忽略** | 含 `adversarial/c3-token-census.txt` 等原始探测产物 |
| `.workspace/lag-fix/exec-countfix/` | 76 | 9.80 MB | **忽略（仅 report.md 30 KB + DEPLOY.md）** | 含 `preimage/*.pre` 与 4 份 `session-list-*.json` |
| `.workspace/lag-fix/exec-hmr/` | 120 | 7.20 MB | **忽略（仅 report.md 35 KB + DEPLOY.md）** | HMR 批次 raw |
| `.workspace/lag-fix/exec-bashconc/` | 208 | 5.48 MB | **忽略（仅 report.md 72 KB + DEPLOY.md 28 KB）** | bash 并发批次候选 + raw |
| `.workspace/lag-fix/exec-boot/` | 102 | 5.17 MB | **忽略（仅 report.md 35 KB + DEPLOY.md）** | 同上 |
| `.workspace/lag-fix/exec-a11y/` | 121 | 3.98 MB | **忽略（仅 report.md 83 KB）** | a11y 批次 |
| `.workspace/lag-fix/exec-virtual/` | 28 | 3.67 MB | **忽略（仅 report.md 21 KB）** | 虚拟滚动批次 |
| `.workspace/lag-fix/exec-keepalive/` | 62 | 3.49 MB | **忽略（仅 report.md 82 KB）** | keepalive 批次 |
| `.workspace/lag-fix/exec-shellfix/` | 57 | 3.16 MB | **忽略（仅 report.md 37 KB + DEPLOY.md）** | shell 手柄批次 |
| `.workspace/lag-fix/exec-cold-batch/` | 297 | 3.12 MB | **忽略（仅 report.md 24 KB + DEPLOY.md 11 KB）** | 冷批；内含 `_smoke/node_modules_pkg/`（ssh2 测试私钥 fixture 落在这里） |
| `.workspace/lag-fix/exec-hostrpc/` | 163 | 2.99 MB | **忽略（仅 report.md 45 KB + DEPLOY.md 14 KB）** | host RPC 批次 |
| `.workspace/lag-fix/exec-logdrift/` | 126 | 2.27 MB | **忽略（仅 report.md 36 KB + DEPLOY.md 11 KB + `candidates/` 60 KB）** | **⚠ 内含 P0 凭据文件**，见「敏感信息扫描结果」 |
| `.workspace/lag-fix/exec-proj/` | 24 | 1.46 MB | **忽略（仅 report.md 41 KB）** | 投影批次 |
| `.workspace/lag-fix/exec-usage9/` | 21 | 0.39 MB | **忽略（仅 report.md 23 KB）** | usage 9 路批次 |
| `.workspace/lag-fix/exec-mask/tools/` + `tools-mine/` | 13+6 | 0.30 MB | **忽略** | 探针工具（`panel-compare.mjs` 等）；被 report.md 引用但属工具面，可单列 |
| `.workspace/lag-fix/exec-mask/` 其余单文件（`DEPLOY.md`/`report.md`/`apply-Mask-v1.mjs`/`candidate/`/`logs/`） | 4 | 0.17 MB | **入库（report.md/DEPLOY.md）** | 证据正文 |
| `.workspace/lag-fix/hmr-probe-backup/` | 1 | 0.43 MB | **忽略** | client bundle 备份，与 git 历史重复 |
| `.workspace/lag-fix/btw-profile-preimage-100226/` | 1 | 0.32 MB | **忽略** | `client.js` 336 KB 修复前镜像；**与 git 历史完全重复**（可由 `git show HEAD:dsh-btw/lib/client.js` 取回） |
| `.workspace/lag-fix/btw-index-backup-20260922-182906.json` | 1 | 0.01 MB | **忽略（隐私）** | `~/.dsh/btw/index.json` 备份，含 **真实 `parentTitle`（会话标题）+ `parentCwd`（含用户名绝对路径）** |
| `.workspace/lag-fix/lib/` | 1 | 0.01 MB | **入库** | `probe-lock.mjs` 8.7 KB，被 notebook §6 引用 |
| `.workspace/lag-fix/COLD-RESTART-RUNBOOK.md` | 1 | 0.01 MB | **入库** | 12 KB，被 notebook §5.3/§6 引用 |
| `.workspace/lag-fix/incident2/firefox-a11y/…`（16 个单文件 + `logs/`） | 21 | 0.36 MB | **待裁决** | incident2 后续证据（`real-a11y-ON/OFF-r*.json`、`page/*.html`、`longtask-control.*`）。属 **incident2 批次**，非本批 |
| `.workspace/lag-fix/incident2/instrument-tiebreak/…` | 12 | 2.33 MB | **待裁决** | 含 `raw/chrome153.json` **1.26 MB**、`analysis.json` 0.48 MB、`dryrun1.json` 0.47 MB。属 incident2 批次 |
| `.workspace/lag-fix/incident2/glean-ab/` | 3 | 0.41 MB | **待裁决** | 含 `snap/B-143637.bin` 0.39 MB |
| `distributions.json` / `distributions-skipped.json` | 2 | 0.04 MB | **待裁决（位置错误）** | Firefox Glean 遥测解码产物；`incident2/firefox-telemetry/audit.md:26,31,32,574` 明确其归属该目录，但**实际落在仓库根**（当时 cwd=仓库根）。建议随 incident2 批次 `git mv` 归位，而非本批 |
| `null.mgc` | 1 | 376 B | **忽略** | `file(1)` 编译 magic 库。`exec-bashconc/report.md:444` 记录红队探针 `file -bC -m <magic>` 会写 `<magic>.mgc` —— 这是该探针在 cwd 留下的副作用产物。建议 `*.mgc` 入 `.gitignore` |
| `gpu_busy_sample.txt` | 1 | 654 B | **待裁决（位置错误）** | `incident2/cross-app/audit.md:342` 引用为「第一个（受污染的）iGPU 样本」，应从仓库根移入该目录。属 incident2 批次 |

> 注：`.workspace/lag-fix/program/`、`exec-projcache/` 等目录的 `du -sh` 原始值（987M / 365M）包含被 `.gitignore`
> 命中的文件；上表「可入库体积」列取自 `git ls-files --others --exclude-standard`，是**真正会被 `git add` 收进去的字节数**，
> 两者不可混用。

### A2. `.workspace/btw-question/`（111 文件 / 21.53 MB）细分

| 子路径 | 文件数 | 体积 | 判定 | 依据 |
| --- | --- | --- | --- | --- |
| `INDEX.md`（8.8 K）、`audit-a-state.md`、`audit-b-official-ui.md`、`audit-c-docs-deploy.md`、`plan.md`、`exec-report.md`、`xaudit-code.md`、`xaudit-docs.md` | 8 | ≈210 KB | **入库** | 本批审计/执行/交叉审计正文，`FEATURE-MAP.md` 新增引用 `exec-report.md` |
| `harness/`（4 PNG + `harness.json` + `classmap.json` + `before/after.html` + 2 `.mjs`） | 10 | ≈200 KB | **入库** | 合成对照 harness（自建 HTML，非真实 GUI 截图）；PNG 单张 15–18 KB，**不含任何真实会话标题**（已逐图核验） |
| `e2e/*.json` + `e2e/*.mjs` | 21 | ≈0.19 MB | **入库** | 判定证据的单一事实源（含 `verify-skill-scope.mjs` / `skill-scope-{dsh,dex}.json` 等 skill 作用域探针）。**已实测：JSON 内无 `title`/`parentTitle`/`sessionId`/`parentCwd` 字段**（`grep -ohE '"(title\|parentTitle\|sessionId\|parentCwd)":'` 零命中） |
| `e2e/*-opt1-*.png` / `*-opt2-*.png` / `*-u8-*.png` / `*-drawer-after.png` | 19 | 0.40 MB | **入库** | 元素级裁切图（选项行 1.5–2 KB；抽屉局部 94–104 KB）。逐图核验：仅含通用 UI 文案（`1 继续` / `btw 侧聊` / 测试用 `btw_ask_user` 提示词），**左侧工作区树不在框内 ⇒ 无真实会话标题** |
| `e2e/` 其余 **31 张全页截图**（`*-before-*` / `*-after-*` / `*-main-ref*` / `skill-scope-*.png` / `ws-probe-*.png`） | 31 | **18.58 MB** | **忽略（P0 隐私 + 体积）** | 逐图核验（多模态读图）：全页截图**含真实会话标题与工作区名**（`硬件在环`、`测试只回复两个字好的`、`触觉产品资料`、`面试`、`MCU`、`作业`、`math`、`university`、`Dexterous_Hand_23Dof`、`robocon`、`RS`、`dsh`、`openarm`）及一段真实对话正文。**单张 630–758 KB，合计 18.58 MB** |
| `preimage-lib-20260923-113216/` | 11 | 512 KB | **忽略** | 修复前 `lib/` 整目录镜像（`client.js` 361 702 B）。**与 git 历史重复**（`git show HEAD:dsh-btw/lib/client.js` 即得）。内含 `index.js:212 apiKeyEnv: "OPENCODE_GO_API_KEY"` —— 是**环境变量名，非密钥**，但无需入库 |
| **`d30/`（⚠ 审计期间由并发档实时写入）** | 27（**持续增长**） | **7.2 MB**（持续增长） | **本批暂不入库 → 见 R12** | 审计开始时该目录**为空**（`ls -la … → 总计 8`，仅 `.`/`..`）；至 `17:51:19` 已出现 **27 个文件 / 7.2 MB**，最新文件写入时间为 **8 秒前**（`2026-09-23T09-50-56-764Z-probe4-1-baseline.png`，mtime `17:51:11`）。内容是 D30（`btw_ask_user` 题目项 schema 与 read 结果 codec 宽度不一致）的探针与 E2E。**属在飞批次，文件集是移动靶** |
| `preimage-U8/` | 1 | 336 KB | **忽略** | 同上 |
| `.preimage-path`（53 B）、`d30/`（空目录） | — | — | **忽略** | `.preimage-path` 指向上面已忽略的 preimage；`d30/` 为空目录（git 不跟踪空目录） |

### B. 已跟踪但被本批波及的重点（逐类判定）

| 路径类 | 状态 | 体积/规模 | 该不该进本批 | 依据 |
| --- | --- | --- | --- | --- |
| `dsh-btw/src/**` | M 9 + ?? 3 | 见下 | **必须进（Commit 1）** | 本批主题源码。**两条线混在同一批未提交状态**，见下「归属实测」 |
| `dsh-btw/lib/**` | M `client.js` | 363 814 B | **必须同批（Commit 1）** | **仓库确实跟踪 `lib/`**（`git ls-files dsh-btw/lib` 返回 10 个文件：`client.js`、`index.js`、`index.d.ts`、`remote-*.js/.d.ts`、`typert.*`）⇒ 改了源码不提交 lib，仓库里就是「源码 ≠ 构建产物」。当前 `dsh-btw/lib/client.js` md5 = **`88de97e6c22fc6de9ebd61cb27e5779f`**，与部署位 `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js` **md5 完全相同** ⇒ 提交的就是线上在跑的那份字节 |
| `dsh-btw/tests/**` | M 1 + ?? 1 | 34.7 KB + 新文件 | **必须进（Commit 1）** | 回归锁（C1–C5）。`docs/architecture/04-ops-deploy.md` 的测试面数字（24 → **25 files**）就来自新增的 `overlay-placement-explicit.spec.ts`，文档与测试必须同批 |
| `docs/program-notebook.md` | M | +60/−? 行 | **必须进（Commit 3）** | **同一文件里混了「性能专项收尾（D18–D28 + §5.3）」与「btw 问答卡片（D29/D30 + skill 全局化 §6 行）」两条线的 diff**，无法按文件切分 ⇒ 见「风险与待裁决点」R2 |
| `docs/architecture/05-performance-and-ux-program.md` | ?? 新增 | 19 952 B | **必须进（Commit 3）** | 被 notebook §2 导航表 / §5.3 / §6 索引三处引用；D12/D17/D18–D23 各行的「完整内容」指向 |
| `docs/architecture/02-plugin-system.md` | M | +27 行（新增 §8） | **进 Commit 4（随 skill 全局化）** | §8「skill 发现根与优先级」直接记录 `~/.dsh/skills/program-notebook` 移入与 `.dsh/skills/` 删除，与 D 删除**强耦合** |
| `docs/architecture/04-ops-deploy.md` | M | 1 行 | **进 Commit 3** | 仅改 dsh-btw 测试面 24 → **25 files / 250 passed / 2 skipped**，是 Commit 1 的直接文档面 |
| `docs/runbooks/verify-runbook.md` | M | +16 行 | **进 Commit 3** | btw 第 5 步新增判据 ①–⑤ + 50 ms×3 s 采样协议 + 部署字节校验命令（`88de97e6…`）。**与 Commit 1 的代码修复强绑定** |
| `FEATURE-MAP.md` | M | 1 行（超长单行） | **进 Commit 3** | dsh-btw 行补 D29 修复 + 部署/真机验收事实，并新增引用 `.workspace/btw-question/exec-report.md`（⇒ 该文件必须同批或紧随） |
| `.dsh/skills/program-notebook/**` | **D 3 文件** | 299 行删除 | **进 Commit 4（有意为之）** | 已实测确认是有意删除且已迁移：`~/.dsh/skills/program-notebook/{SKILL.md,references/notebook-spec.md,references/maintenance-playbook.md}` 三个文件 sha256 与 `git show HEAD:<path>` **逐一相同**（`d72bf81a…` / `0ec83989…` / `a2148bc9…`）。arch02 §8 明文写「仓库内原副本已删除，避免第 1 条的遮蔽陷阱」 |
| `.workspace/lag-fix/**`（M 12 文件） | M | 见下 | **不进本批（待裁决）** | 见「风险与待裁决点」R3 |
| `.workspace/workstreams/side-deploy/deploy-side.sh` | M | +114 行 | **待裁决（建议单列 Commit 5）** | 内容是**安全加固**：默认 `DRY_RUN=true`、必须显式 `--apply`、未知参数 `exit 2`、5 秒红字警告、覆盖前指纹闸门 + 覆盖后复核。属 09-22 `exec-cold-batch (U-CB3)` 批次，非 btw 线，但**未提交即有丢失风险** |

**归属实测（把两条线程分开的关键证据 —— mtime）**

| 文件 | mtime | 归属 |
| --- | --- | --- |
| `dsh-btw/src/client/drawer-size.ts` | 09-22 15:12 | 抽屉 resize 批次 |
| `dsh-btw/src/client/overlay-placement.ts` | 09-22 15:17 | 抽屉 resize 批次 |
| `dsh-btw/src/client/use-overlay-placement.ts` | 09-22 15:24 | 抽屉 resize 批次 |
| `dsh-btw/src/client/SideChatDrawer.tsx` | 09-22 15:40 | 抽屉 resize 批次 |
| `dsh-btw/src/client/SideChatResizeHandle.tsx`（??） | 09-22 16:21 | 抽屉 resize 批次 |
| `dsh-btw/src/client/index.ts` | 09-22 16:55 | 抽屉 resize 批次（注册手柄） |
| `dsh-btw/src/client/SideChatSurface.tsx` | 09-23 11:34 | **D29 问答卡片** |
| `dsh-btw/tests/side-chat-surface.spec.tsx` | 09-23 11:34 | **D29** |
| `dsh-btw/lib/client.js` | 09-23 16:03 | **两批的合并构建产物（单文件，不可再切）** |
| `docs/program-notebook.md` / `verify-runbook.md` / `FEATURE-MAP.md` / `arch05` | 09-23 16:04–16:05 | 文档同步收尾 |

---

## 敏感信息扫描结果

### 扫描范围与命令（全部为本轮实测）

```bash
# ① 已跟踪修改的差异（全部 29 个 M/D 文件的 diff）
git diff -U0 | grep -nEi 'sk-[A-Za-z0-9]{16,}|apiKey|apiKeyEnv|Bearer [A-Za-z0-9._-]{12,}|token=|password|-----BEGIN|x-opencode-session'

# ② 拟入库的未跟踪文件（.workspace/btw-question、docs、dsh-btw、.dsh），逐文件
git ls-files --others --exclude-standard -- .workspace/btw-question docs dsh-btw .dsh \
  | grep -vE '\.png$' \
  | while read f; do grep -HnE 'sk-[A-Za-z0-9]{24,}|-----BEGIN [A-Z ]*PRIVATE KEY|Bearer [A-Za-z0-9._-]{24,}|x-opencode-session|password\s*[:=]\s*[^ ]|token=[A-Za-z0-9._-]{20,}' "$f"; done

# ③ 全量未跟踪（排除 .pnpm-store 与二进制）——用于兜底发现
grep -rlE 'sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY|Bearer [A-Za-z0-9._-]{20,}|api[_-]?key["'\'']?\s*[:=]\s*["'\''][A-Za-z0-9]{16,}' $(git ls-files --others --exclude-standard | grep -v '^\.pnpm-store/' | grep -vE '\.png$')

# ④ 凭据类文件名兜底
git ls-files --others --exclude-standard | grep -iE 'credential|\.env|secret|token|\.pem|id_rsa'

# ⑤ 已跟踪历史是否已有真实密钥（假阴性排除）
git grep -n "OPENCODE_GO_API_KEY" --
git grep -ohE 'sk-[A-Za-z0-9]{32,}' --
```

### 命中与判定

| # | 文件:行 | 命中内容 | 判定 |
| --- | --- | --- | --- |
| **P0-1** | `.workspace/lag-fix/exec-logdrift/iso/home/.credentials.yaml`（398 B，权限 `-rw-------`） | 真实凭据全文：`DEEPSEEK_API_KEY: sk-YWnPTt…`、`OPENCODE_GO_API_KEY: sk-UgTIfp…`、`ADAM_API_KEY: sk-YWnPTt…`，以及 `records.client-connection/browser-session.payload.secret: 5Z0mtPe5jbs8DoTxZKALu5A_05RmMXph0DWgB83zc_c` | **必须剔除（绝对不入库）**。这是 `~/.dsh` 隔离实例的**真实密钥文件快照**，含 2 个不同的真实 API key + 1 个 browser-session grant 密钥。**本方案已将其排除；同时强烈建议加 `.gitignore`（见下节）** |
| P1-2 | `.workspace/lag-fix/exec-logdrift/iso/home/settings.yaml`（6 258 B） | `apiKeyEnv: OPENCODE_GO_API_KEY` 等 | **可入库（非密钥）** —— 这是任务说明中提到的**故意** settings 快照：`apiKeyEnv` 只是**环境变量名**。取证：同样的变量名在**已入库**文件中已出现多次（`git grep -c apiKeyEnv` 命中 `.workspace/lag-fix/incident2/first-open-profile/sub-host/aggregate.py:40`、`.../host-rpc-latency.json`、`.workspace/probes/acceptance/preflight.md` 等 20+ 处）。**本方案未把它列入任何提交路径（属 exec-logdrift 目录整体忽略），故无实际影响** |
| P1-3 | `.workspace/btw-question/preimage-lib-20260923-113216/index.js:212` | `apiKeyEnv: "OPENCODE_GO_API_KEY"` | **可入库但本方案已剔除** —— 同上，**环境变量名而非密钥**。该文件因「与 git 历史重复」被排除，与敏感信息无关 |
| P1-4 | `.workspace/lag-fix/btw-index-backup-20260922-182906.json` | `"parentTitle": "/grill-me # 交接提示词 —— 直"`、`"parentCwd": "/home/CNS20264951…"` | **必须剔除（隐私）** —— 真实会话标题 + 含用户名的绝对路径。已排除 |
| P2-5 | `.workspace/btw-question/e2e/` 31 张全页 PNG | 真实工作区树 + 会话标题 + 一段真实对话正文（多模态读图逐图核验） | **必须剔除（隐私 + 体积 18.58 MB）**。已排除。**注意：部分标题已在跟踪历史中**（`git grep -l` 命中数：`Dexterous_Hand_23Dof` 74、`openarm` 36、`robocon` 33、`触觉产品资料` 24、`硬件在环` 1），故泄漏增量有限，但 **`测试只回复两个字好的` 在已跟踪历史中 0 命中**（新泄漏），且无必要为 18.58 MB 的截图承担此风险 |
| — | `Bearer ` / `token=` / `password=` / `-----BEGIN … PRIVATE KEY` / `x-opencode-session` | **零命中**（扫描 ①②③ 全部无输出） | 无 |
| — | 已跟踪历史中的 `sk-` | 唯一命中是 **占位符** `sk-abcdefghijklmnopqrstuvwxyz0123456789`（`git grep -ohE 'sk-[A-Za-z0-9]{32,}'`），非真实密钥 | 无既有泄漏 |

**关于「命中的 ssh2 私钥 fixture」**：扫描 ③ 在
`.workspace/lag-fix/exec-cold-batch/subagent-verify/_smoke/node_modules_pkg/.../ssh2/test/fixtures/{id_rsa,https_key.pem,…}`
命中 `-----BEGIN … PRIVATE KEY`。判定 **可入库但不入本批**：这是 npm 包 `ssh2` 自带的**测试夹具私钥**（公开分发包内容），
不是本仓库的密钥；且该目录已被列入「忽略」（`node_modules` 语义的 smoke 依赖树）。**不构成阻断项。**

**拟入库批次结论：敏感信息 0 命中。** 扫描 ②（逐文件、限拟入库路径）与 `git diff` 差异扫描均**零输出**。

---

## 建议 `.gitignore` 增补

> 本节只是**建议**（本轮未改动 `.gitignore`）。分两档：T1 直接支撑本轮推送安全性，建议随本批落地；
> T2 属仓卫生，涉及既有跟踪文件，需单列批次。

### T1 — 建议本批加入（逐行 + 理由）

```gitignore
# ── 2026-09-23 推送就绪审计增补（T1）────────────────────────────────
# 凭据与私有索引：真实 API key / browser-session grant / 会话标题+用户名绝对路径
# 依据：.workspace/lag-fix/exec-logdrift/iso/home/.credentials.yaml（本轮实测含 3 个真实密钥）
#       .workspace/lag-fix/btw-index-backup-20260922-182906.json（含 parentTitle / parentCwd）
**/.credentials.yaml
**/.credentials.yml
**/btw-index-backup-*.json

# pnpm 内容寻址存储：机器本地派生，553 文件 / 18.93 MB，可由 `pnpm install` 完整重建
# 依据：.pnpm-store/v11/files/… 单文件 12 565 169 B；v11/links/@/pnpm/11.7.0/…/pnpm.mjs 12 565 169 B
.pnpm-store/

# file(1) 编译 magic 库：`file -bC -m <magic>` / `--comp` 会在 cwd 留下 <magic>.mgc
# 依据：仓库根 null.mgc（376 B）；exec-bashconc/report.md:444 记录该探针行为
*.mgc

# 逐窗原始会话转储（可脚本重生；结论已入 w*/audit.md）
# 依据：program/ 内 8512 个 *.zstd，单文件 22 808 279 B；合计 4.7 GiB
.workspace/lag-fix/**/*.zstd

# 逐窗 projectList 缓存快照（单份 11.5 MB，多份重复）
.workspace/lag-fix/**/session_projcache.json
.workspace/lag-fix/**/*_projcache.json

# 修复前 lib/ 镜像：与 git 历史逐字节重复，可由 `git show HEAD:<path>` 取回
# 依据：preimage-lib-20260923-113216/client.js = 361 702 B = 更早的 HEAD 版本
.workspace/btw-question/preimage-*/
.workspace/lag-fix/**/preimage*/
```

**入本批的理由**：本批提交后开发者的日常 `git status` 将从 112 行 / 13808 文件降到个位数级别；
更关键的是**消除「一次 `git add -A` 就把 3 个真实密钥 + 4.7 GiB 转储写进历史」的尾部风险**。
`**/.credentials.yaml` 这一条本身就是本轮审计最重要的产出。

### T2 — 建议**不**在本批加（需单列仓卫生批次）

```gitignore
# ⚠ 以下条目不会让已跟踪文件停止跟踪，必须配合 `git rm -r --cached` —— 属独立批次
.workspace/workstreams/deploy/deploy-slots/backup-*/
.workspace/workstreams/deploy/deploy-015/
```

理由：这正是 notebook **D3** 登记的历史欠账（`.gitignore:22-23` 只覆盖 `.workspace/backups/` 与
`.workspace/workstreams/deploy/deploy-lag/backup-*/`）。实测现状：

- `.workspace/workstreams/deploy/deploy-slots/backup-20260915-162522/` —— **2 个文件已被 git 跟踪**（148 KB）
- `.workspace/workstreams/deploy/deploy-015/` —— **447 个文件已被 git 跟踪**（13 MB）

加 `.gitignore` 行**不会**让它们脱离跟踪，需要 `git rm -r --cached` + 一次独立提交（且会改变 HEAD 内容体积）。
**本批只做 btw，不宜夹带** ⇒ 见 R5。

### 明确建议**不**加

- 不加 `.workspace/lag-fix/exec-*/`（整个目录）——本方案要从其中取 `report.md` / `DEPLOY.md` / `candidates/`，
  整目录忽略会连带挡掉证据正文。**保持逐文件 `git add`**。
- 不加 `*.png`（全局）——`dsh-btw`/`harness/`/`e2e/` 的元素级裁切图是有效证据，需要入库。
- 不加 `.workspace/lag-fix/program/`（整目录）——同样会挡掉 `w*/audit.md` 与 `FINDINGS-INDEX.md`。
  若嫌噪音大，建议改用白名单式例外（`program/**` + `!program/*/audit.md` + `!program/FINDINGS-INDEX.md`），
  但这属 T2，本批不必。

---

## 提交切分方案

**切分的硬约束（先说清，因为它决定了下面为什么只有 1 个代码提交）**

`dsh-btw/lib/client.js` 是 **tsdown 整包构建的单一产物**，而它**同时**含「抽屉 resize 批次（09-22）」
与「D29 问答卡片修复（09-23）」两批源码改动（mtime 09-23 16:03，晚于两批源码）。
因此：

- 若把 resize 与 D29 拆成两个提交，**中间那个提交必然是「lib 领先/落后于 src」的不自洽态**——
  例如 Commit A 只提 resize 源码不提 lib，则 `lib/client.js` 仍是 HEAD 版本（不含 resize）；
  若 Commit A 连 lib 一起提，则 lib 含 D29 而 src 不含 D29。
- 任务要求明列「提交后 `dsh-btw/lib/client.js` 与 `dsh-btw/src/**` 自洽（同批）」。
  **⇒ 唯一同时满足「自洽」与「可独立回滚」的切法，是把 dsh-btw 的源码 + lib + tests 作为 1 个提交**，
  并在提交信息正文里说清它含两条线。**（拒绝方案见 R1。）**

共 **5 个必需提交**（+1 个可选、1 个待裁决），顺序即执行顺序。

---

### Commit 1 — btw 代码（resize 批次 + D29 问答卡片修复 + lib 重建 + 回归锁）

```
btw 问答卡片：点选持久化修复（D29）+ 抽屉 resize 批次 + lib 重建与回归锁同批
```

正文要点（建议）：

```
- D29 根因：QuestionCard 重置 useEffect 依赖 pendingQuestion.questions，而该数组
  每次 sideChat/read 都换身份 ⇒ 提问挂起期（轮询 220ms）点选状态被反复抹掉。
  改法与官方 dsh-client-ui-user-questions 卡片同款：删除该 effect + 调用点
  key={questionId} 重挂（官方卡片零 useEffect）。
- 选项行语义/观感向主会话对齐：role=radio|checkbox + aria-checked 取代非法的
  aria-pressed；单选项序号徽标 / 多选方框勾；去掉选项行硬编码绿 #b7e85b；
  选中底/边改用官方实测 token；基态文字补成主色 rgb(15,17,21)。
  按用户裁决 .questionCard 绿壳保留（btw 品牌身份）。
- 同批含 09-22 抽屉 resize 批次（overlay-placement / use-overlay-placement /
  SideChatDrawer / SideChatResizeHandle / drawer-size(-store) / index 注册）。
- lib/client.js 是整包构建产物，单文件同含上述两批 ⇒ 与 src 同批提交。
  实测 md5 88de97e6c22fc6de9ebd61cb27e5779f / 363814 B，
  与部署位 ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js 逐字节相同。
- tests：新增 overlay-placement-explicit.spec.ts（第 25 个 spec 文件）；
  side-chat-surface.spec.tsx 补 C1–C5 回归锁。
```

```
git add -- dsh-btw/src \
           dsh-btw/lib/client.js \
           dsh-btw/tests
```

**为何这样切**：这是本批**唯一不可再分**的最小单元。它单独 `git revert` 即可完整回到
「修复前 btw」（源码、构建产物、测试三者同时回退），且回退后 `lib` 与 `src` 仍自洽。
**精确路径清单**（共 **15** 个新增/修改路径，实测 `git status --porcelain -- dsh-btw` = 15 行：11 M + 4 ??）：

- M `dsh-btw/src/client/{index.ts, locales.ts, overlay-placement.ts, presentation.tsx, SideChatDrawer.tsx, SideChatJumpList.tsx, side-chat.module.css, SideChatSurface.tsx, use-overlay-placement.ts}`
- ?? `dsh-btw/src/client/{drawer-size-store.ts, drawer-size.ts, SideChatResizeHandle.tsx}`
- M `dsh-btw/lib/client.js`
- M `dsh-btw/tests/side-chat-surface.spec.tsx`
- ?? `dsh-btw/tests/overlay-placement-explicit.spec.ts`

> `git add -- dsh-btw/src` 是目录级 add，但**局限在 `dsh-btw/src` 子树内**，不会外溢；
> 若想逐文件也可，路径已在上方列全。

---

### Commit 2 — btw-question 证据档（审计 / 执行 / 交叉审计 / harness / E2E 判定证据）

```
btw 问答卡片：审计 A/B/C + 执行档 + 交叉审计（代码面/文档面）+ E2E 判定证据入仓
```

正文要点：

```
- 八份正文：INDEX.md（协调者索引/事实基线）、audit-a-state.md、audit-b-official-ui.md、
  audit-c-docs-deploy.md、plan.md（U1–U7 交付单元）、exec-report.md、xaudit-code.md、xaudit-docs.md。
- harness/：自建合成对照（before/after.html + classmap + 4 张对照 PNG），不含真实会话内容。
- e2e/：判定 JSON（before=REVERTED 166→270ms 2/56 ⇒ final=PERSISTED 185ms 55/55）
  与元素级裁切 PNG（选项行 1.5–2KB / 抽屉局部 94–104KB）。
- 明确不含：31 张全页截图（18.58MB，左侧栏含真实会话标题与工作区名，隐私剔除）；
  preimage-* （与 git 历史重复）。
```

```
git add -- .workspace/btw-question/INDEX.md \
           .workspace/btw-question/audit-a-state.md \
           .workspace/btw-question/audit-b-official-ui.md \
           .workspace/btw-question/audit-c-docs-deploy.md \
           .workspace/btw-question/plan.md \
           .workspace/btw-question/exec-report.md \
           .workspace/btw-question/xaudit-code.md \
           .workspace/btw-question/xaudit-docs.md \
           .workspace/btw-question/harness \
           .workspace/btw-question/e2e/*.json \
           .workspace/btw-question/e2e/*.mjs \
           .workspace/btw-question/e2e/*-opt1-*.png \
           .workspace/btw-question/e2e/*-opt2-*.png \
           .workspace/btw-question/e2e/*-u8-*.png \
           .workspace/btw-question/e2e/*-drawer-after.png
```

**为何这样切**：`FEATURE-MAP.md`（Commit 3）新增引用 `.workspace/btw-question/exec-report.md`，
`verify-runbook.md`（Commit 3）引用 `e2e/repro-btw-question.mjs`。把证据档单列成一个提交，
使它成为**可独立回滚的「文档证据层」**——回滚它不动任何代码与线上字节。
共 **58 个文件 / 973 824 B（0.93 MB）**（实测：`md 8 + harness 10 + e2e json&mjs 21 + 元素级 PNG 19`）。

---

### Commit 3 — 文档同步（notebook / arch05 / arch04 / verify-runbook / FEATURE-MAP）+ 其引用的性能专项小体积证据

```
notebook/arch05 同步：性能专项收尾（D18–D28、§5.3）与 btw 问答卡片（D29/D30）+ 索引与引用证据入仓
```

正文要点：

```
- notebook：§2 导航表与 §6 索引接入 arch05；§5.3 性能与操作体验专项摘要；
  §7 缺陷表 D12/D13/D17 更新 + D18–D28 新增 + D29/D30 新增；§6 的 skill 根路径行改指全局。
- arch05（新增）docs/architecture/05-performance-and-ux-program.md。
- arch04：dsh-btw 测试面 24 → 25 files / 250 passed / 2 skipped。
- verify-runbook：btw 第 5 步新增判据 ①–⑤ + 50ms×3s 采样协议 + 部署字节校验。
- FEATURE-MAP：dsh-btw 行补 D29 与部署/真机验收事实。
- 同时入仓 notebook 新引用的小体积证据（FINDINGS-INDEX / COLD-RESTART-RUNBOOK /
  probe-lock.mjs / exec-*/report.md+DEPLOY.md / program/*/audit.md），避免文档指向不存在的路径。
```

```
git add -- docs/program-notebook.md \
           docs/architecture/05-performance-and-ux-program.md \
           docs/architecture/04-ops-deploy.md \
           docs/runbooks/verify-runbook.md \
           FEATURE-MAP.md \
           .workspace/lag-fix/COLD-RESTART-RUNBOOK.md \
           .workspace/lag-fix/program/FINDINGS-INDEX.md \
           .workspace/lag-fix/program/*/audit.md \
           .workspace/lag-fix/lib/probe-lock.mjs \
           .workspace/lag-fix/exec-*/report.md \
           .workspace/lag-fix/exec-*/DEPLOY.md \
           .workspace/lag-fix/exec-mask/tools \
           .workspace/lag-fix/exec-mask/candidate \
           .workspace/lag-fix/exec-logdrift/candidates
```

**为何这样切**：Commit 1 的代码修复若不同步文档，`verify-runbook` 的判据与 `FEATURE-MAP` 的
「已部署/已验收」声明就会落后于代码；而 notebook 的这批 diff **物理上无法按线切分**（一个文件里
D18–D28 与 D29/D30 混排），所以必须一次性落地，并在提交信息里如实说明它同时含两条线。
**追加证据档的理由**：notebook §5.3/§6 新增引用了 `program/FINDINGS-INDEX.md`、`COLD-RESTART-RUNBOOK.md`、
`lib/probe-lock.mjs`、`exec-*/report.md`、`program/w01..w29/`——若只提 docs 不提它们，仓库里会立刻多出
**指向不存在路径的悬空引用**。实测本提交合计 **3 090 645 B（2.95 MB）**，构成为
`exec-*/report.md`+`DEPLOY.md` 34 文件 1.04 MB、`program/*/audit.md` 30 文件 ≈1.4 MB、
`exec-mask/tools` 248 KB、三份单文件（`FINDINGS-INDEX.md` 40 KB / `COLD-RESTART-RUNBOOK.md` 12 KB /
`probe-lock.mjs` 8.7 KB）、`exec-logdrift/candidates` 60 KB。**均 <300 KB/文件，无 >1 MB 项。**
> ⚠ 若你**只想推 btw 线**、不愿夹带性能专项证据，则退化为「可接受悬空引用」——
> 见 R2 的替代方案 (b)。

---

### Commit 4 — skill 全局化（仓库内副本删除 + arch02 §8）

```
skill 全局化：program-notebook 移出仓库 .dsh/skills（改由 ~/.dsh/skills 对所有工作区生效）+ arch02 §8 发现根
```

正文要点：

```
- 仓库内 .dsh/skills/program-notebook/{SKILL.md, references/notebook-spec.md,
  references/maintenance-playbook.md} 三个文件删除；同名副本已迁至 ~/.dsh/skills/program-notebook/
  （实测 sha256 逐一相同：d72bf81a… / 0ec83989… / a2148bc9…）。
- 动机（arch02 §8）：rank 数字越小越优先，项目根(100) > 用户根(400) ⇒ 两处放同名 skill
  会让较高优先级那份静默遮蔽全局那份（dsh-skill/lib/index.js:319-323 只打一条 warn）。
  删仓库副本正是为消除这个遮蔽陷阱。
- arch02 新增 §8「skill 发现根与优先级」：三类根 + rank 表 + 三条硬事实
  （同名遮蔽 / 软链被跳过 / disable-model-invocation 不进模型可见目录）。
- notebook §6 索引行同步改指 ~/.dsh/skills/program-notebook/。
```

```
git add -A -- .dsh/skills/program-notebook \
              docs/architecture/02-plugin-system.md
```

**为何这样切**：`D`（删除）与 arch02 §8 的说明是**同一决策的两个面**——只提交删除会让读者不知为何删，
只提交文档会让仓库留下「文档说已删、文件还在」的假象。用 `git add -A -- <pathspec>`
（而非 `git add --`）是**必要**的：`git add -- <path>` 对「已删除且不在索引中」的路径在当前 git
版本虽也会暂存删除，但 `-A` 带 pathspec 语义明确、无歧义。
**这一提交可独立回滚**：`git revert` 会把 3 个技能文件恢复回仓库（此后全局那份会被项目根遮蔽，
需要另行处理，属回滚代价，见 R4）。

---

### Commit 5 — 建议单列的安全加固（待裁决，见 R3）

```
side-deploy: 部署脚本改为默认 dry-run + 显式 --apply + 覆盖前后双向指纹闸门
```

```
git add -- .workspace/workstreams/side-deploy/deploy-side.sh
```

**为何单列**：内容是 `exec-cold-batch (U-CB3)` 的安全加固（默认不写盘、必须 `--apply`、5 秒红字警告、
覆盖前证明 SRC 是旧快照 + 覆盖后复核 deployed == SRC）。**与 btw 线无关**，但它是**未提交即可能丢失的风险控制**。
建议单列一个小提交，不必与 btw 混在一起。**需用户裁决是否本轮带出。**

---

### Commit 6 — 可选：`.gitignore` T1 增补（需用户先落盘 T1 各行）

```
gitignore: 凭据/私有索引/逐窗转储/pnpm store 不入库（推送就绪审计 T1）
```

```
git add -- .gitignore
```

⚠ **本轮未改动 `.gitignore`**（审计档只写本文件）。若决定采纳 T1，需先把「建议 .gitignore 增补」
一节的 T1 行追加进 `.gitignore`，再执行上面的 `git add`。**建议 T1 与 Commit 2 同批或紧随**
（T1 的 `**/.credentials.yaml` 是 P0 防线）。

---

## 推送命令与前置检查

> 以下命令**逐条可直接复制执行**。**续行符 `\` 之后没有空格**（已逐行核对）。
> 每步都有校验闸门；**任一闸门不通过就停下**，不要继续往下推。

### 步骤 0 — 前置检查（只读，必须先做）

```bash
cd /home/CNS2026495165/dsh
```

```bash
# 0.1 确认远端 main 仍等于本地 HEAD（防并发推进）
git ls-remote origin refs/heads/main
```

```bash
# 0.2 本地 HEAD 期望值比对（应输出 5f7d61b8bd52a5ce15c26f3b59b6538ff1cba476）
git rev-parse HEAD
```

```bash
# 0.3 确认工作区状态指纹未变（应输出 0ad7cff903f1ea0e34c51a6fe5b6eb61）
git status --porcelain | md5sum
```

```bash
# 0.4 确认无活动 hook（应无输出）
ls .git/hooks/ | grep -v '\.sample$'
```

```bash
# 0.5 确认关键文件仍在盘上且 lib 与部署位一致
#     期望：88de97e6c22fc6de9ebd61cb27e5779f  dsh-btw/lib/client.js
#          88de97e6c22fc6de9ebd61cb27e5779f  /home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js
md5sum dsh-btw/lib/client.js \
        /home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js
```

```bash
# 0.6 确认拟入库路径均未被 .gitignore 命中（应全部输出 ok）
for p in dsh-btw/src dsh-btw/lib dsh-btw/tests .workspace/btw-question/harness \
         .workspace/lag-fix/program/FINDINGS-INDEX.md \
         .workspace/lag-fix/exec-hmr/report.md \
         .workspace/lag-fix/lib/probe-lock.mjs; do
  if git check-ignore -q "$p"; then echo "IGNORED $p"; else echo "ok $p"; fi
done
```

```bash
# 0.7 确认 P0 凭据文件确实不在任何拟入库路径内（应无输出）
git ls-files --others --exclude-standard | grep -F 'exec-logdrift/iso/home/.credentials.yaml'
```

**闸门 G0**：0.1 与 0.2 输出**必须完全相同**。若不同（远端已被推进）⇒ 执行 0.8 后再重做 0.1：

```bash
# 0.8 仅在 0.1 != 0.2 时执行：拉取并只做 rebase（本批工作区脏，rebase 前先看冲突面）
git fetch origin
```

```bash
git log --oneline HEAD..origin/main
```

```bash
# 若上面为空 ⇒ 本地领先，无需 rebase；若非空 ⇒ 远端有新提交，
# 由于工作区有 112 项未提交改动，rebase 会被拒 ⇒ 必须先按 Commit 1..4 提交完再 rebase：
#   git stash push -u  (不推荐，本批有 13808 未跟踪文件，stash -u 极慢)
# 或者：先完成 1..4 的提交，再 git pull --rebase origin main
```

### 步骤 1 — Commit 1（btw 代码）

```bash
git add -- dsh-btw/src \
           dsh-btw/lib/client.js \
           dsh-btw/tests
```

```bash
# 校验：应恰好 15 行（11 M + 4 ??）；若 df 行数不符则停下排查
git status --porcelain -- dsh-btw | wc -l
```

```bash
git status --porcelain -- dsh-btw
```

```bash
git diff --cached --stat
```

```bash
git commit -F - <<'MSG'
btw 问答卡片：点选持久化修复（D29）+ 抽屉 resize 批次 + lib 重建与回归锁同批

- D29 根因：QuestionCard 重置 useEffect 依赖 pendingQuestion.questions，而该数组
  每次 sideChat/read 都换身份 ⇒ 提问挂起期（轮询 220ms）点选状态被反复抹掉。
  改法与官方卡片同款：删除该 effect + 调用点 key={questionId} 重挂（官方零 useEffect）。
- 选项行语义/观感向主会话对齐：role=radio|checkbox + aria-checked 取代非法的
  aria-pressed；单选项序号徽标 / 多选方框勾；去掉选项行硬编码绿 #b7e85b；
  选中底/边改用官方实测 token；基态文字补成主色 rgb(15,17,21)。绿壳按裁决保留。
- 同批含 09-22 抽屉 resize 批次（overlay-placement / use-overlay-placement /
  SideChatDrawer / SideChatResizeHandle / drawer-size(-store) / index 注册）。
- lib/client.js 是整包构建产物，单文件同含两批 ⇒ 与 src 同批。
  md5 88de97e6c22fc6de9ebd61cb27e5779f / 363814 B，与部署位逐字节相同。
- tests：新增 overlay-placement-explicit.spec.ts（第 25 个 spec 文件）；
  side-chat-surface.spec.tsx 补 C1–C5 回归锁。
MSG
```

```bash
git log --oneline -1
```

### 步骤 2 — Commit 2（btw-question 证据档）

> ⚠ **本清单刻意不含 `.workspace/btw-question/d30/`** —— 该目录在审计期间由并发档实时写入（见 **R12**），
> 文件集是移动靶。待 D30 线收口并过「提交前新鲜度闸门」后，再按 R12 选项 (a) 追加其**确定性产物**
> （`*.md` / `exp*-output.txt` / `*.mjs` / 小 JSON；**全页 PNG 按 R8 同口径剔除**）。

```bash
git add -- .workspace/btw-question/INDEX.md \
           .workspace/btw-question/audit-a-state.md \
           .workspace/btw-question/audit-b-official-ui.md \
           .workspace/btw-question/audit-c-docs-deploy.md \
           .workspace/btw-question/plan.md \
           .workspace/btw-question/exec-report.md \
           .workspace/btw-question/xaudit-code.md \
           .workspace/btw-question/xaudit-docs.md \
           .workspace/btw-question/harness \
           .workspace/btw-question/e2e/*.json \
           .workspace/btw-question/e2e/*.mjs \
           .workspace/btw-question/e2e/*-opt1-*.png \
           .workspace/btw-question/e2e/*-opt2-*.png \
           .workspace/btw-question/e2e/*-u8-*.png \
           .workspace/btw-question/e2e/*-drawer-after.png
```

```bash
# 校验：应恰好 58 行；且必须【不含】任何全页截图
git status --porcelain -- .workspace/btw-question | wc -l
```

```bash
# 上面必须输出 58。以下必须【无输出】——只查 PNG 面（json/mjs 允许含 main-ref/skill-scope 字样）
git status --porcelain -- .workspace/btw-question \
  | grep -E '\.png$' \
  | grep -E 'before-|after-[123]|main-ref|skill-scope|ws-probe'
```

```bash
# 上面必须【无输出】。以下【必须】输出 19（元素级裁切图 = 19 张，即入库的那批）
git status --porcelain -- .workspace/btw-question | grep -cE '\.png$'
```

```bash
# 校验：preimage-* 与 .preimage-path 都不得出现（必须【无输出】）
git status --porcelain -- .workspace/btw-question | grep -E 'preimage'
```

```bash
git diff --cached --stat | tail -3
```

```bash
git commit -F - <<'MSG'
btw 问答卡片：审计 A/B/C + 执行档 + 交叉审计（代码面/文档面）+ E2E 判定证据入仓

- 八份正文：INDEX.md（协调者索引/事实基线）、audit-a-state.md、audit-b-official-ui.md、
  audit-c-docs-deploy.md、plan.md（U1–U7 交付单元）、exec-report.md、xaudit-code.md、xaudit-docs.md。
- harness/：自建合成对照（before/after.html + classmap + 4 张对照 PNG），不含真实会话内容。
- e2e/：判定 JSON（before REVERTED 166→270ms 2/56 ⇒ final PERSISTED 185ms 55/55）
  与元素级裁切 PNG（选项行 1.5–2KB / 抽屉局部 94–104KB）。
- 明确不含：31 张全页截图（18.58MB，左侧栏含真实会话标题与工作区名，隐私剔除）；
  preimage-*（与 git 历史重复，可由 git show HEAD: 取回）。
MSG
```

### 步骤 3 — Commit 3（文档同步 + 引用的证据档）

```bash
git add -- docs/program-notebook.md \
           docs/architecture/05-performance-and-ux-program.md \
           docs/architecture/04-ops-deploy.md \
           docs/runbooks/verify-runbook.md \
           FEATURE-MAP.md \
           .workspace/lag-fix/COLD-RESTART-RUNBOOK.md \
           .workspace/lag-fix/program/FINDINGS-INDEX.md \
           .workspace/lag-fix/program/*/audit.md \
           .workspace/lag-fix/lib/probe-lock.mjs \
           .workspace/lag-fix/exec-*/report.md \
           .workspace/lag-fix/exec-*/DEPLOY.md \
           .workspace/lag-fix/exec-mask/tools \
           .workspace/lag-fix/exec-mask/candidate \
           .workspace/lag-fix/exec-logdrift/candidates
```

```bash
# 校验：不得包含 05 之外的任何 docs/architecture/02-plugin-system.md（它属 Commit 4）
git diff --cached --name-only -- docs/architecture/02-plugin-system.md
```

```bash
# 上面必须【无输出】。若命中 ⇒ git restore --staged -- docs/architecture/02-plugin-system.md
# 校验：不得包含任何巨型 raw（>1 MiB 一律可疑；本提交实测最大 248 KB）
git diff --cached --name-only -z | xargs -0 -r stat -c '%s %n' | awk '$1 > 1048576'
```

```bash
# 上面必须【无输出】且 exit 0
git diff --cached --stat | tail -3
```

```bash
git commit -F - <<'MSG'
notebook/arch05 同步：性能专项收尾与 btw 问答卡片（D29/D30）+ 索引引用证据入仓

- notebook：§2 导航表与 §6 索引接入 arch05；新增 §5.3 性能与操作体验专项摘要；
  §7 缺陷表 D12/D13/D17 更新 + D18–D28 新增 + D29/D30 新增。
- arch05（新增）docs/architecture/05-performance-and-ux-program.md。
- arch04：dsh-btw 测试面 24 → 25 files / 250 passed / 2 skipped（对应新增 spec）。
- verify-runbook：btw 第 5 步新增判据 ①–⑤ + 50ms×3s 采样协议 + 部署字节校验
  （应 88de97e6c22fc6de9ebd61cb27e5779f / 363814 B / ?rev=3980d1322992）。
- FEATURE-MAP：dsh-btw 行补 D29 修复与部署/真机验收事实。
- 同时入仓 notebook 新引用的小体积证据（FINDINGS-INDEX / COLD-RESTART-RUNBOOK /
  probe-lock.mjs / exec-*/report.md+DEPLOY.md / program/*/audit.md），避免悬空引用。
- 说明：本提交的 notebook diff 同时含性能专项收尾与 btw 问答卡片两条线
  （同一文件内 D18–D28 与 D29/D30 混排，无法按文件切分），故合批落地并在本正文如实声明。
MSG
```

### 步骤 4 — Commit 4（skill 全局化）

```bash
git add -A -- .dsh/skills/program-notebook \
              docs/architecture/02-plugin-system.md
```

```bash
# 校验：应恰好 4 行，其中 3 行以 "D " 开头
git status --porcelain -- .dsh/skills docs/architecture/02-plugin-system.md
```

```bash
git diff --cached --diff-filter=D --name-only
```

```bash
git commit -F - <<'MSG'
skill 全局化：program-notebook 移出仓库 .dsh/skills + arch02 §8 skill 发现根

- 删除仓库内 .dsh/skills/program-notebook/{SKILL.md, references/notebook-spec.md,
  references/maintenance-playbook.md}；同名副本已迁至 ~/.dsh/skills/program-notebook/
  （实测 sha256 逐一相同：d72bf81a… / 0ec83989… / a2148bc9…）。
- 动机（arch02 §8）：rank 越小越优先，项目根(100) 高于用户根(400) ⇒ 两处放同名 skill
  会让较高优先级那份静默遮蔽全局那份（dsh-skill/lib/index.js:319-323 只打一条 warn）。
  删仓库副本正是为消除该遮蔽陷阱。
- arch02 新增 §8：三类发现根 + rank 表 + 三条硬事实（同名遮蔽 / 软链被跳过 /
  disable-model-invocation 不进模型可见目录）+ 与既有条目的关系。
- notebook §6 索引行同步改指 ~/.dsh/skills/program-notebook/。
MSG
```

### 步骤 5 — 可选 Commit 5（deploy-side.sh 安全加固，需 R3 裁决同意）

```bash
git add -- .workspace/workstreams/side-deploy/deploy-side.sh
```

```bash
git status --porcelain -- .workspace/workstreams/side-deploy/
```

```bash
git commit -F - <<'MSG'
side-deploy: 部署脚本改为默认 dry-run + 显式 --apply + 覆盖前后双向指纹闸门

- 承 exec-cold-batch(U-CB3)：DST 指向在产 deployed 位，而 SRC 是旧快照 ——
  旧默认 DRY_RUN=false ⇒ 一次误执行会静默整包回滚 U-IG1/U-IG3/U-CC1/P0-b/U-CB1/U-CB2。
- 现改为默认 dry-run，必须显式 --apply；未知参数 exit 2；apply 前 5 秒红字警告。
- 新增前置闸门（证明 SRC 确为旧快照 + 证明 deployed 已备份）与覆盖后复核
  （证明 deployed == SRC，即整包回滚真的发生）+ 红字恢复指引。
MSG
```

### 步骤 6 — 推送前最终校验

```bash
git status --porcelain | wc -l
```

```bash
# 校验：未跟踪/未提交残余里【必须】仍包含 .pnpm-store/、program/、exec-projcache/、
#       以及 .credentials.yaml —— 证明它们确实没被误提交
git status --porcelain | grep -E '\.pnpm-store|program/|exec-projcache'
```

```bash
git ls-files --error-unmatch .workspace/lag-fix/exec-logdrift/iso/home/.credentials.yaml
```

```bash
# 上面这条【必须失败】（exit 1 / "did not match any file(s) known to git"）——这是 P0 闸门
```

```bash
# 校验：本批未引入任何 >10MB 的新对象
git diff --cached --stat 2>/dev/null | tail -1
git log --oneline -6
```

```bash
# 校验：将要推送的提交集合正确（应列出 Commit 1..N）
git log --oneline origin/main..HEAD
```

```bash
# 校验：本地历史里没有意外的大对象混入（对每个新提交查最大 blob）
git rev-list origin/main..HEAD --objects \
  | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' \
  | awk '$1=="blob" && $3 > 10485760 {print}' 
```

```bash
# 上面必须【无输出】。若有输出 ⇒ 停下来处理（说明有 >10MB 的 blob 进了历史）
```

### 步骤 7 — 推送

```bash
git push origin main
```

```bash
# 校验：推送后本地与远端一致
git ls-remote origin refs/heads/main
```

```bash
git rev-parse HEAD
```

```bash
# 上面两条必须相同
```

**可选强校验（推荐，成本低、收益高）**：重建 lib 并确认与已提交的字节一致，
以证明「`lib/client.js` 确实由当前 `src/**` 构建而来」：

```bash
cd /home/CNS2026495165/dsh/dsh-btw
```

```bash
pnpm run build
```

```bash
cd /home/CNS2026495165/dsh
```

```bash
git status --porcelain -- dsh-btw/lib
```

```bash
# 期望【无输出】。若有输出 ⇒ 说明已提交的 lib 与当前源码不完全同源，
# 应把重建后的 lib 追加为一次 "btw: 重建 lib(与 src 对齐)" 提交后再 push。
```

> ⚠ 该步骤会**改动工作区**（重写 `dsh-btw/lib/**`）并可能改变 `lib/client.js` 的字节与 md5。
> 若执行，请**先**完成 Commit 1，**再**在 push 前做此校验；且若重建后字节变了，
> 意味着**部署位需要重新 `cp -a`**，否则线上不再是仓库那份（见 R6）。

---

## 风险与待用户裁决点

| 编号 | 风险 / 裁决点 | 现状证据 | 建议 | 影响面 |
| --- | --- | --- | --- | --- |
| **R1** | **能否把「抽屉 resize」与「D29 问答卡片」拆成两个提交？** | `dsh-btw/lib/client.js` 是 tsdown 整包产物（mtime 09-23 16:03），单文件同时含两批源码。任何拆分都会产生「lib 与 src 不自洽」的中间提交 | **裁决：不拆。** 合并为 Commit 1，在提交信息正文里声明含两条线。若坚持要拆，唯一自洽的拆法是「先提交 resize 的 src+lib（用 resize 版重建的 lib），再提交 D29 的 src+lib（再重建一次）」——需要两次构建 + 两次 `git add` 中间态，成本远大于收益，**不推荐** | 中：影响回滚粒度（回滚 Commit 1 会同时回退 resize） |
| **R2** | **`docs/program-notebook.md` 一个文件里混了「性能专项收尾（D18–D28 + §5.3）」与「btw 问答卡片（D29/D30 + skill 全局化索引行）」两条线** | `git diff docs/program-notebook.md` 的 hunk 覆盖两批内容；D18–D23 行与 D29/D30 行在同一 diff 里 | **裁决三选一**：(a) 推荐——按 Commit 3 合批落地并在提交信息如实声明；(b) 只推 btw 线——需 `git add -p docs/program-notebook.md` 逐 hunk 拆分，**风险高**（同一 hunk 内可能混排），且会让 notebook 停在半同步态；(c) 先补一个纯性能专项提交——同样需要 hunk 级拆分。**倾向 (a)** | 高：决定本批范围是否包含性能专项 |
| **R3** | **`.workspace/lag-fix/**` 的 12 个已跟踪 M 文件（incident2 后续）是否进本批？** | mtime 全部为 09-22 12:07–15:04（`incident2/VERDICT.md`、`firefox-a11y/{analyze.mjs,audit.md,proof/verdict.json,proof/verdict.md}`、`instrument-tiebreak/{lib/lock.mjs,lib/probe.mjs,runners/matrix.mjs}`、`exec-audit/BATCH-PLAN.md`）。**属 incident2 批次，非 btw 线** | **裁决：不进本批。** 单列「incident2 收尾」批次。同时 `.workspace/workstreams/side-deploy/deploy-side.sh`（安全加固）**建议带出**（Commit 5），因为它是风险控制、不提交即有丢失风险 | 中 |
| **R4** | **Commit 4（skill 删除）的回滚代价** | 仓库副本删除后，若 `git revert` 恢复 3 个文件，则项目根（rank 100）会**重新遮蔽** `~/.dsh/skills/`（rank 400）那份——即「回滚后改了全局 skill 但不生效」 | **裁决：接受**。回滚时需**同时**删除或改名 `~/.dsh/skills/program-notebook/`，否则会踩 arch02 §8 事实 1 的遮蔽陷阱。**建议在提交信息里补一条回滚注意事项** | 低（但会造成难查的静默失效） |
| **R5** | **D3 欠账：`.gitignore:22-23` 未覆盖 `deploy-slots/backup-*` 与 `deploy-015/`** | 实测：`deploy-slots/backup-20260915-162522/` **2 个文件已被跟踪**（148 KB）；`deploy-015/` **447 个文件已被跟踪**（13 MB）。加 `.gitignore` 行**不会**使其脱离跟踪 | **裁决：本批不处理，单列「仓卫生」批次**，含 `git rm -r --cached` + `.gitignore` 增补 + 提交。**注意该提交会从 HEAD 移出 13 MB 内容，需独立验收**。同类问题**不止这两处**（见 **R10**：`.workspace/tmp-ppt-research/raw/mgr.tgz` 51.1 MB 仍在跟踪，而 `.gitignore:16` 只指向重构后的新路径）⇒ 建议把 D3 与 R10 合并成**一次「.gitignore 路径漂移普查 + 止血清跟踪」批次** | 中：属历史欠账，不宜夹进 btw 批 |
| **R6** | **`dsh-btw/lib/client.js` 与线上部署位的字节耦合** | 当前仓库 `lib/client.js` md5 = `88de97e6c22fc6de9ebd61cb27e5779f` = 部署位 `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js`（热面，无需重启） | **裁决：本批不改部署位。** 但若执行「步骤 7 的可选强校验」（`pnpm run build`）且重建后字节变化，则**必须重新 `cp -a dsh-btw/lib/. ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/`** 并在页面刷新后核验，否则线上与仓库脱钩 | 中：影响「仓库 = 线上」的可追溯性 |
| **R7** | **推送量大 / 历史膨胀** | 未跟踪 13808 文件 / 5599.9 MiB；761 个 >1 MB 文件；最大 21.75 MiB。本方案把入库量压到 **≈3.2 MB** | **裁决：按本方案执行，并在 Commit 6/后续批次处理 T2**。若有人误用 `git add -A`，将一次性写入 3 个真实密钥 + 4.7 GiB 转储；**加 T1 `.gitignore` 是唯一的结构性防线** | 高：一旦写入历史，清除需 `filter-repo` + 强推 |
| **R8** | **31 张全页截图的隐私判定是否过严？** | 其中多数工作区名（`Dexterous_Hand_23Dof` 74 命中 / `openarm` 36 / `robocon` 33 / `触觉产品资料` 24 / `硬件在环` 1）**已在跟踪历史中**；仅 `测试只回复两个字好的` 是新的 | **裁决：仍建议剔除**——新增泄漏增量虽小，但 18.58 MB 全页截图对仓库的边际证据价值低于其体积与隐私成本；元素级裁切图 + JSON 已足够复现判定。若用户认为需要留档，可改为**剔除左侧栏后重新裁切**再入仓（属额外工作量） | 低-中 |
| **R9** | **`.workspace/lag-fix/exec-logdrift/iso/home/settings.yaml`（`apiKeyEnv` 快照）** | 任务说明确认这是**故意**的 settings 快照，`apiKeyEnv` 只是环境变量名（同名字符串在已入库文件中已有 20+ 处） | **裁决：可入库**。但**本方案未将它列入任何提交**（它整体落在被忽略的 `exec-logdrift/` 内），**故实际无影响**。若日后要给 logdrift 建证据批次，须**逐文件** add 并**显式排除同目录的 `.credentials.yaml`** | 低 |
| **R10** | **仓库体积历史欠账（新发现，非本批引入）** | HEAD 已跟踪树 **370.6 MiB / 5955 文件**；4 个 >10 MB 跟踪 blob，最大 `.workspace/tmp-ppt-research/raw/mgr.tgz` **51.1 MB**——而 `.gitignore:16` 只忽略**新路径** `.workspace/workstreams/research/tmp-ppt-research/`，**旧路径的文件仍在跟踪**（与 D3 同型的「改了路径没清跟踪」）。另有 `incident2/user-capture/fixtures/real-settings-trace*.json`（37.3 + 24.9 MB）与 `gecko-tree.json` 18.6 MB | **裁决：本批不处理。** 属独立「仓体积治理」议题，选项：(a) 仅 `git rm --cached` + 加 `.gitignore`（**历史仍保留**，只止血）；(b) `git filter-repo` 重写历史 + 强推（**破坏所有协作者 clone**，须用户明确授权）。**注意 51.1 MB 已接近 GitHub 的 50 MB 告警线，但未达 100 MB 硬上限 ⇒ 不阻断本批推送** | 高（长期），本批无影响 |
| **R11** | **本批的最大单文件** | `dsh-btw/lib/client.js` 363 814 B | **裁决：无风险**。远低于任何体积线；但需注意它是**构建产物**，每次重构建都会产生新 blob ⇒ 长期看 lib 会累积历史体积（可选：未来改为不跟踪 `lib/`，属破坏性变更，**本批不动**） | 低 |
| **R12** | **⚠ 审计期间发现并发写入：`.workspace/btw-question/d30/` 正被另一档实时生产** | 审计开始时（~17:33）该目录**为空**；至 **17:51:19** 已有 **27 文件 / 7.2 MB**，最新文件 mtime = **17:51:11（8 秒前）**。内容是 notebook **D30**（`btw_ask_user` 题目项 schema 与 read 结果 codec 宽度不一致）的探针脚本（`repro-strict-codec.mjs`、`exp1..exp7-*.mjs`、`e2e-d30{a,b,c,d}.mjs`）+ 12 张全页 PNG（单张 575–735 KB）。**而 notebook 的 D30 行已在本批 `docs/program-notebook.md` 的 diff 内** | **裁决：必须由用户/主代理明确决定，不能默认**。三个选项：(a) **推荐——等 D30 线收口再推**：提交前重跑 §步骤 0 的新鲜度闸门，把 `d30/` 的「确定性产物」（`*.md` / `exp*-output.txt` / `*.mjs` / 小 JSON）纳入 Commit 2，**全页 PNG 按 R8 同口径剔除**；(b) D30 未完成 ⇒ 本批**只推 D29**，但需注意 notebook 已含 D30 行 ⇒ 与 R2 叠加，可能需 hunk 级拆分；(c) 强行现在推 ⇒ **会提交半成品/不一致的 D30 证据**，**不推荐**。**另注**：`d30/` 的 12 张全页 PNG 与 e2e 那 31 张同型（≈7 MB、含真实会话标题），按 R8 应剔除 | **高：这是当前唯一会让「现在开跑」产生错误结果的活变量** |

### 提交前新鲜度闸门（因 R12 而必须执行）

在 §步骤 0 之后、§步骤 1 之前，**必须**再跑一次：

```bash
cd /home/CNS2026495165/dsh
```

```bash
# 检查 btw-question 下是否有文件在最近 5 分钟内被写入（应【无输出】）
find .workspace/btw-question -type f -newermt '-5 minutes' -not -name 'push-plan.md'
```

```bash
# 检查全仓库是否有其它档在并发写入（应【无输出】）
find .workspace docs dsh-btw -type f -newermt '-5 minutes' 2>/dev/null
```

```bash
# 上面两条都必须【无输出】。若有输出 ⇒ 说明仍有档在写盘，
# 此刻 commit 会固化的是一份「正在被改写的中间态」⇒ 等其收口后重跑本闸门。
```

```bash
# 且工作区状态指纹必须仍等于审计基线（应输出 0ad7cff903f1ea0e34c51a6fe5b6eb61）
git status --porcelain | md5sum
```

> ⚠ 注意：`git status --porcelain | md5sum` **对 `.workspace/btw-question/` 内的新增/变化文件不敏感**
> （整个未跟踪目录折叠成一行 `?? .workspace/btw-question/`）⇒ **指纹相同不代表证据档没变**。
> 因此 `find -newermt` 闸门是**不可省略**的补充。

### 阻塞推送的问题（结论）

**无阻塞项。** 具体地：

1. `git ls-remote origin refs/heads/main` = 本地 HEAD = `5f7d61b8bd52a5ce15c26f3b59b6538ff1cba476` ⇒ **无并发推进，不需要 rebase**；
2. SSH 只读连通正常（`git ls-remote` 成功返回）；
3. **无任何活动 git hook、无 CI 配置**（`.github/` 不存在、根无 `package.json`），`git commit` / `git push` 不会被拦；
4. 拟入库批次**敏感信息 0 命中**——P0 凭据文件 `.workspace/lag-fix/exec-logdrift/iso/home/.credentials.yaml`
   已确认**未被跟踪**（`git ls-files --error-unmatch` 按预期以 exit 1 失败），且本方案未把它列入任何提交路径；
5. 拟入库批次**体积 4.42 MB、最大单文件 363 814 B**，远低于 GitHub 单文件 100 MB 硬上限与 50 MB 告警线；
6. 已存在的 4 个 >10 MB 跟踪 blob（最大 51.1 MB）**是历史，不由本批引入**，不阻断推送（R10）。

**唯一需要用户先裁决才能开跑的是 R2**（notebook 两条线是否合批落地）、**R3**（是否本轮带出 `deploy-side.sh` 安全加固）
与 **R12**（D30 并发线是否已收口、其证据是否并入本批）；
R1 / R5 / R6 / R8 / R10 / R11 的默认选择已在本方案中固化为可直接执行的路径，无需额外确认即可开跑。

**⚠ 唯一会「让现在开跑产生错误结果」的活变量是 R12**：`.workspace/btw-question/d30/` 在本次审计期间
（17:33 → 17:51）由**另一档实时写入**并持续增长。**开跑前必须先过「提交前新鲜度闸门」**（见 R12 节），
并在 `find -newermt '-5 minutes'` 无输出后才进入 §步骤 1。
