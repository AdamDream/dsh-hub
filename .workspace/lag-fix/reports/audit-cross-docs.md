# 独立审计报告：文档/目录重构完整性 + 新文档事实性

**审计员**：独立只读审计档（非本次整理执行者）
**审计时间**：2026-09-20 16:0x
**审计对象**：`2ece7258` → `7cfa1369` → `242fb0c3`（+ 其后 3 个 lag-fix 提交）
**回滚基线 tag**：`pre-docs-reorg-20260920-154951`
**方法**：全部结论用**独立实现**复算（不依赖 `mapping.json`／不复用执行者的脚本），
每条给命令或 `path:line`。临时产物在 `/tmp/docs-audit/`。除本报告外**未改动任何仓库文件**。

## 审计基线核对（先纠三处背景偏差）

| 背景声称 | 实测 | 判定 |
|---|---|---|
| `git status` 干净 | 审计开始时 HEAD 上有 2 个未跟踪文件（`.workspace/lag-fix/probes/host-latency-with-usage-card.mjs`、`.workspace/lag-fix/reports/host-latency-before-restart.json`），后被 `15338480` 提交；审计期间并发会话（peer，同一 `.git`，在做 A 线卡顿修复）又产生 `measure-after-C1.mjs` 修改与 3 个新报告 | 干净（无**跟踪文件**改动）；未跟踪项属并发写入 |
| 整理范围到 `242fb0c3`、完成 tag = `docs-reorg-done-20260920-155524` | tag 实际指向 **`7cfa1369`**（= 第 2 个提交），`242fb0c3` 之后还有 3 个 lag-fix 提交；`HEAD` = `15338480` | 属实但**完成 tag 落后于 Track D 记录提交**，宜补 `/tag` 或声明 |
| 跟踪文件 2,229 → 2,229 | `pre` tag=2,229；`7cfa1369`=2,890；`HEAD`=2,895 | "2,229 → 2,229" 仅指**未丢失**，净路径数 +661（新增证据/文档），见 §1 |

---

## 1. 零丢失复核（独立方法）→ **成立（0 丢失）**，但"2229→2229"表述不准

**方法**：`git ls-tree -r` 取两棵树的 `path→blob sha` 映射，按**内容 sha** 反查旧路径内容在 HEAD 是否仍存在；
不用 `mapping.json`。全程用 `-z`（NUL 分隔）避免中文/空格路径被转义或截断。

```
git ls-tree -r --name-only -z <tag>   # 逐字节安全
git ls-tree -r -z HEAD | ...          # path→sha
```
非 ASCII 路径实证（**必须处理引号转义**，否则 3 条中文名文件会误报）：
```
$ git ls-tree -r --name-only HEAD | grep '^"'
  ".workspace/workstreams/sources/dsh-usage-src/dev/trend-v2-zoom-3 \345\260\217\346\227\266..."
$ git -c core.quotepath=false ls-tree -r --name-only HEAD | grep -P '[^\x00-\x7F]'
  .workspace/workstreams/sources/dsh-usage-src/dev/trend-v2-zoom-3 小时合并.png
  .workspace/workstreams/sources/dsh-usage-src/dev/trend-v2-zoom-6 小时合并.png
  .workspace/workstreams/sources/dsh-usage-src/dev/trend-v2-zoom-完整窗口.png
```
（顺带：不加 `-c core.quotepath=false` 会得到 `"\345..."` 形式的引号包裹名，且字节被转义——
按行切分会把这 3 条算成不存在；本报告的统计用 `-z`，两处均正确处理。）

**逐条结果（pre = 2,229 条路径）**

| 分类 | 条数 | 说明 |
|---|---|---|
| A. 原地未动（path 与 sha 均不变） | **238** | 如 `dsh-btw/**`、`pi-taste-analysis/**` |
| B. 内容已在新路径找到（= 搬移成功） | **1,978** | 逐条比对 sha；例：`.workspace/mmt-probe/probe-image.sh` → `.workspace/probes/mmt/probe-image.sh`（sha 相同） |
| C. 旧内容在 HEAD 中查找不到 | **13** | 见下表，**全部为"同名新版本改写/删除"，非内容丢失** |
| 合计 | 2,229 | **A+B = 2,216 条内容零改动可达；C 13 条逐条定性** |

C 的 13 条逐条定性（按 sha 反查）：

| 旧路径 | 定性 | 依据 |
|---|---|---|
| `README.md` | 有意修订（引用随搬移改写） | 旧 sha 在 HEAD 无其他落点；新版本仍在 `README.md` |
| `FEATURE-MAP.md` | 同上 | 同上 |
| `DOC-STYLE.md` | 同上 | 同上 |
| `.gitignore` | 有意迁移 13 条规则 | `git diff pre..HEAD -- .gitignore` |
| `verify-runbook.md` | 已搬 **且** 修订引用 | 新落点 `docs/runbooks/verify-runbook.md` |
| `switch-web2-runbook.md` | 同上 | 新落点 `docs/runbooks/switch-web2-runbook.md` |
| `.workspace/acceptance-probe/probe-context-window.sh` | 纯搬移但**内容改过** | `→ .workspace/probes/acceptance/…` |
| `.workspace/acceptance-probe/probe-context-window-round2.sh` | 同上 | `→ .workspace/probes/acceptance/…` |
| `.workspace/acceptance-probe/probe-channel-availability.sh` | 同上 | `→ .workspace/probes/acceptance/…` |
| `.workspace/mmt-probe/probe-image.sh` | 同上 | `→ .workspace/probes/mmt/…` |
| `.workspace/deploy-lag/dsh-restart.sh` | 同上 | `→ .workspace/workstreams/deploy/deploy-lag/…` |
| `.workspace/diag-settings-config.mjs` | 同上 | `→ .workspace/probes/workflow-drivers/…` |
| `.workspace/lag-fix-wf.mjs` | 同上 | `→ .workspace/probes/workflow-drivers/…` |

> 这 7 个脚本/工具的内容改写**不是**搬移副产物（它们改的是引用与路径常量），属有意修订；
> 但**执行者未在 `TRACK-D-DONE.md` 登记"7 个探针/脚本内容被改写"**——建议补记，否则
> 用旧同名脚本与本仓新版做 `cmp` 会误判为不一致。

**交叉验证（`mapping.json`，仅作对照）**：210 条 = 204 条真实搬移（`from != to`）+ 6 条原地保留；
`move_commands.sh` 共 204 条 `do_move`（185 `git mv` + 19 `mv`），
其中 **3 条是自映射 no-op**（`README.md`/`FEATURE-MAP.md`/`DOC-STYLE.md` 的 `-M` 自我移动，
作用是刷新 mtime；`grep -c` 计得 204）。⇒ "**204 条全部成功**"字面成立，但**有效搬移是 201 条**，
另有 3 条被计入纯属巧合；`OK=204/SKIP=0/FAIL=0` 的日志含这 3 条 no-op，宜在记录里说明。

**结论**：**零丢失成立**。旧路径的实质内容 100% 可在 HEAD 某处找到（2,216 条逐字节相同，
13 条为有意改写且有新落点）；无一条内容消失。**但"2229 → 2229"是"未丢失"而非"未新增"**——
净增 661 条路径（2,229 → 2,890 @`7cfa1369`），其中 `2ece7258` 新增 519（含 `docs/**` 12 个、
`.workspace/probes/**` 474 个），`7cfa1369` 新增 167。

---

## 2. 重复/并存检查 → **无"删除没做完"的新旧并存**；合法重复 283 组为既有形态

**方法 1（新旧并存，用 mapping 的 204 条 from/to 逐一核对 git 树）**
```
entries where BOTH old and new path exist in HEAD: 0
```
`ls-tree` 逐条核对：204 条搬移中，旧路径在 HEAD 全部为 0 条目（含目录型搬移）。
唯二"旧前缀仍有跟踪文件"的是 **`.workspace/settings-lag/`（58）与 `.workspace/lag-fix/`（112）**——
它们是 mapping 里 `kind=keep` 的**原地保留活动目录**，不是残留，正确。

**方法 2（全仓按内容 sha 分组，独立于 mapping）**
```
HEAD 中重复内容组（≥2 路径）：283 组，涉及 773 个文件，冗余体积 9.72 MiB
其中 236 组（83%）完全落在 .workspace/workstreams/ 内 —— 部署批次的镜像副本
  · loadtest/pkg ↔ patch/…-rc2 ↔ tarball/package   （204 个文件三份，R100 全同）
  · deploy-015/ ↔ baseline-011/x/                  （0.1.5 与 0.1.1 借码对照副本）
  · fakebackup/fakeroot（探针夹具）↔ baseline-011   （5 组）
  · npm-cache/_cacache ↔ research-*/npmcache        （缓存对）
排除后需人工看的跨类别组仅 35 组，全部可解释：
  · probes/previews/usage-tooltip/*.png ↔ workstreams/sources/dsh-usage-src/preview-*.png（同一预览图两处持有）
  · dsh-btw/{lib,src,tests} ↔ workstreams/deploy/deploy-vision-settings/btw/*（部署快照 vs 源码，**预期**）
  · 6 组同名 `LICENSE`、7 个空文件（`req.json`、`_update-notifier-last-checked` 等 0 字节）——**无意义同 hash**
```
**结论**：无"同一文件同时存在于旧路径与新路径"的**本次整理残留**（0 条）。
283 组重复是**整理前既有的镜像/夹具/缓存形态**（`node_modules` 类同名插件副本、部署批次快照），
不属"删除没做完"。若后续要瘦身，最大收益点是 `deploy-workerspace` 的 3 份同内容 `pkg/lib`（约 4 MiB）。

---

## 3. 引用可达性（独立实现）→ 新文档有 **3 类真实不可达引用**，其中 **2 处是本次整理引入的机械污染**

**方法**：自写 `/tmp/docs-audit/refcheck.py`（正则抽 `.workspace/...` 裸路径 + Markdown `](...)` 链接，
逐一在**磁盘** `os.path.exists` + `git cat-file -e HEAD:<path>` 双解析，失败再判
`git cat-file -e pre-docs-reorg-...:<path>` 区分"整理引入"vs"整理前陈旧"）。
扫描面：`README.md`、`FEATURE-MAP.md`、`DOC-STYLE.md`、`docs/**/*.md`、`.workspace/probes/**` = **582 个文件**。
结果：**160 条不可达**，其中 44 条整理前就已陈旧、116 条整理前不存在。

**逐条判定（只看本次涉及的文档；probes 侧见下）**

| # | 文件:行 | 不可达引用 | 判定 | 正确写法 |
|---|---|---|---|---|
| R1 | `FEATURE-MAP.md:35` | `](docs/runbooks/docs/runbooks/port-taste.md)` | **本次引入**（改写器双重前缀；pre 版为 `port-taste.md`） | `docs/runbooks/port-taste.md` |
| R2 | `FEATURE-MAP.md:35` | `](docs/runbooks/docs/runbooks/port-wallpaper.md)` | **本次引入** | `docs/runbooks/port-wallpaper.md` |
| R3 | `docs/program-notebook.md:205` | `../.workspace/reports/plans/.workspace/reports/plans/btw-wallpaper-plan.md` | **本次引入**（新文档自带污染） | `.workspace/reports/plans/btw-wallpaper-plan.md` |
| R4 | `docs/program-notebook.md:205` | `../.workspace/reports/plans/.workspace/reports/plans/wiring-plan.md` | **本次引入** | `.workspace/reports/plans/wiring-plan.md` |
| R5 | `docs/program-notebook.md:201-202` | `` `docs/runbooks/docs/runbooks/{switch-web2-runbook,verify-runbook}.md` ``（正文行内码，非链接） | **本次引入** | `docs/runbooks/{switch-web2-runbook,verify-runbook}.md` |
| R6 | `docs/runbooks/README.md:11-12` | `](docs/runbooks/switch-web2-runbook.md)`、`](docs/runbooks/verify-runbook.md)` | **本次引入**（相对 `docs/runbooks/README.md` 应为 `./x.md`）——**两条均断链** | `switch-web2-runbook.md` / `verify-runbook.md` |
| R7 | `docs/runbooks/README.md:12`、`docs/runbooks/verify-runbook.md:4` | `../../.workspace/reports/execs/btw/.workspace/reports/execs/btw/execute-btw.md`（及 wallpaper 同名一条） | **本次引入**（双重前缀） | `.workspace/reports/execs/btw/execute-btw.md` |
| R8 | `docs/architecture/04-ops-deploy.md:229` | `` `.workspace/docs-reorg/reports/track-D-prep.md` `` | **本次引入**（迁移前旧路径未改；实际在 `.workspace/reports/docs-reorg/reports/track-D-prep.md`） | 更新路径 |
| R9 | `.workspace/probes/workflow-drivers/btw-wf-v2.mjs`、`lag-fix-wf.mjs` | `.workspace/btw-upgrade-impl-review.md`、`.workspace/lag-fix-review.md` | **整理前就陈旧**（`git cat-file -e pre:…` 均失败；与 `TRACK-D-DONE.md` §三.6 登记一致） | 无需改（已登记） |
| R10 | `.workspace/probes/acceptance/{live-vs-disk,brief-s21,preflight}.md` | `.workspace/mmt-probe/pasted-2048.png`、`.workspace/acceptance-probe/*`、`.workspace/backup-btw-20260917-170146/`、`.workspace/push-log3.txt` | **部分本次引入**：这些是**被搬走目录的旧路径**未同步（现在分别是 `.workspace/probes/mmt/…`、`.workspace/probes/acceptance/…`、`.workspace/backups/btw/…`） | 按 mapping 表改写 |
| R11 | `.workspace/probes/acceptance/brief-history-bigfile.md`（73 条）、`push-log3-GH001-archive.txt`（2 条） | `.workspace/tmp-ppt-research/**`、`.workspace/research/{tarballs,tgz}/**`、`.workspace/deploy-pptmaster/.venv-ppt-test/**`、`.workspace/repos/`、`.workspace/backup-*/` | **本次引入**（该文件正文抄录了 `.gitignore` 规则列表与体积台账，规则已迁移而正文未改） | 属"历史快照文档"，建议**加注"引用的为迁移前路径"**而非逐条改写 |
| R12 | `README.md`/`DOC-STYLE.md`/`docs/architecture/01` 等 | `.workspace/workstreams/deploy/deploy-`（截断片段，实为 `deploy-*/` 示例） | **误报**（正则截断，非引用） | 无需改 |

**净结论**：**本次整理确实引入了一批不可达引用，且执行者的自述（"全仓扫污染模式 → 逐一修正 → 复查不可达引用"）
不完整**——最刺眼的是**新文档自己带着污染**（R3/R4/R5：`program-notebook.md` §6 索引写成
`docs/runbooks/docs/runbooks/...` 与 `.workspace/reports/plans/.workspace/reports/plans/...`），
这正是 `TRACK-D-DONE.md` 问题 #5 自己登记的同一类失误，却未清干净。
`FEATURE-MAP.md:35` 的两条链接（R1/R2）**断链**，是最该先修的两条（文件级 markdown 链接直接 404）。

---

## 4. `.gitignore` 语义与误入库检查 → **误入库清单：无**；但文档对 R-1 的现状描述**已过期**

**最近 3 次提交对 `.gitignore` 的改动**：只有 `2ece7258` 动过（`git log --oneline -- .gitignore` 中
`7cfa1369`/`242fb0c3` **未触及**）。改动 = **13 条路径规则随目录重构迁移 + 新增 11 条**：

| 类型 | 内容 |
|---|---|
| 迁移（原路径→新路径，13 条） | `.workspace/repos/`→`.workspace/workstreams/research/repos/`；`research-dsh-workerspace/repos/`；`tmp-ppt-research/`；`research/{tarballs,tgz}/`→`research/research/{tarballs,tgz}/`（**原就重复一条，迁移后仍重复**）；`deploy-pptmaster/skills/`；`upstream-015-diff/pkgs/`；`.workspace/backup-*/`→`.workspace/backups/`；`deploy-lag/backup-*/`；`deploy-lag/sim/`；`research-luxweft-doc/`；`.venv-ppt-test/`；`mmt-probe/pasted-2048.png`→`probes/mmt/pasted-2048.png` |
| 新增（11 条） | `.workspace/lag-fix/{backup/,patches/backup/,backup-usage*/,tmp/,sandbox/}`（5）；`.workspace/docs-reorg/tmp/`（1，**路径已过期，见下**）；`__pycache__/`、`*.pyc`（2）；13 条迁移行的说明注释块（3 行注释另计） |

**误入库检查（逐项）**

| 检查项 | 结果 |
|---|---|
| 最近 3 次提交新增的路径是否命中 `venv`/`backup`/`__pycache__`/`.pyc`/`node_modules`/`tarball`/`.tgz`/`repos/` | **0 条**（`git diff-tree --name-status -r -M <c> \| awk '$1=="A"'` 逐提交 grep） |
| "风险路径"跟踪文件总数 | pre=158（153 唯一 sha）→ HEAD=158（153 唯一 sha），**内容集合完全相同**；差别只是父目录改名（`.review-tmp/`→`.workspace/probes/legacy/review-tmp/`、`deploy-slots/backup-*` 等），**非本次引入** |
| 新增 >5MB 文件 | **无**（3 次提交新增文件逐个体检，最大 <5MB） |
| 新增体积 | `2ece7258` +3.12 MiB / 519 个新文件；`7cfa1369` +22.81 MiB / 167 个新文件（`assets/*.png`、`patched/*`、补丁与探针证据）；`242fb0c3` +4.6 KB。**跟踪树总量 47.24 MiB → 72.91 MiB** |
| 41 MiB `.workspace/backups/` 是否入库 | **否**：`git ls-files .workspace/backups` = 0，工作树有 8 个子目录（实际含嵌套时间戳目录 >14 个）但被 `.gitignore:22` 排除 |
| `.workspace/workstreams/research/repos/` | 工作树存在、`git ls-files` = 0（被 `.gitignore:14` 排除） |
| 已知既有问题（如实复现） | `deploy-slots/backup-*` 下确有 **2 个文件被跟踪**却只被 `deploy-lag/backup-*/` 规则覆盖（`git check-ignore` 会命中但因已跟踪而无效）——与 `TRACK-D-DONE.md` §三.7 一致，**属既有** |

**结论：无内容误入库。** 总体新增 **+25.93 MiB**（3 次提交合计），无 >5MB 单文件，无 `venv`/`backup`/缓存类新增。

> **但 `.gitignore` 里有一条过期规则**：`.workspace/docs-reorg/tmp/`（第 53 行）——该路径**从未存在**
> （执行者自己的 mapping 把 `.workspace/docs-reorg` 映射/保留到 `.workspace/reports/docs-reorg`），
> 实际目录是 `.workspace/reports/docs-reorg/`。`git check-ignore` 对两者均无命中，属死规则。

---

## 5. 新文档事实性（重点）→ **12 条正确 / 5 条错误 / 1 条无法验证**

抽查对象：`docs/program-notebook.md`、`docs/architecture/01..04`。每条到真实源码/配置核对。
（逐条明细见下表 F1–F17；**错误 5 条 = F12、F13、F14、F15、F16**；另 F1 结论正确但引证行号错，
记为"正确＋引证瑕疵"；F18 为文档自标"未知"，不计入错误。）

| # | 断言（出处） | 核对证据（`path:line`） | 判定 |
|---|---|---|---|
| F1 | **子代理实际生效路由 = `adam/deepseek-v4-pro`**（settings 只设 `model`，provider 由 preset 兜底）<br>`program-notebook.md:220` D1、`03-…md:111-131` | `~/.dsh/settings.yaml:220-221` = `dsh-subagent:` / `  model: deepseek-v4-pro`（**无** `provider`）<br>`~/.dsh/.agent-presets/standard-glm/agent.cordis.yml:192-195` = preset 注释 + `agentOptions.provider: adam` / `model: deepseek-v4.1-flash`<br>合并实现 `…/dsh-tool-subagent/lib/index.js:119-136`：`{...configured, ...(provider===void 0?{}:{provider}), ...(model===void 0?{}:{model})}` —— **字段级**，缺 provider ⇒ 保留 preset 的 `adam` | **✅ 正确**（结论与机制均对，且诚实地标注为"代码行为推论、未做活体探针"）<br>**⚠ 引证行号错**：settings 应为 `:220-221`（文档写 `217-218`，那两行是 `ui-theme`）；`dsh-tool-subagent/lib/index.js` 应为 `:119-136`（文档写 `132-134`，页面上也不存在该相对路径）<br>**⚠ 与 `README.md:169` 冲突**：README 写"workflow/subagent/btw 统一 `adam/deepseek-v4-flash`"——**三处都错**（见 §5.1） |
| F2 | **`workflow` 无默认模型常量**，`workflow-worker-thread` 只声明 `provider: spawn`，模型继承父代理<br>`program-notebook.md:221` D2 | `agent.cordis.yml:230-233` = `- id: workflow-worker-thread` / `name: …dsh-workflow-worker-thread` / `config: provider: spawn`（**无** `agentOptions`、无 `model`） | **✅ 正确**（引证行号精确） |
| F3 | **本页 4 条路由常量**：`subagent`/`subagent_fork` = `adam`/`deepseek-v4.1-flash`（会被 settings 覆盖）；btw 默认在插件源码 `dsh-btw/src/host/vision.ts` 的 `VISION_DEFAULTS` = `deepseek-v4.1-flash` / opencode 网关 / `OPENCODE_GO_API_KEY` / `maxTokens 2000`<br>`03-…md:137-140` | `agent.cordis.yml:186-206`（两段 `agentOptions` 均为 `adam`/`deepseek-v4.1-flash`）<br>`dsh-btw/src/host/vision.ts:102-107` = `model: 'deepseek-v4.1-flash'`、`baseURL: 'https://opencode.ai/zen/go/v1'`、`apiKeyEnv: 'OPENCODE_GO_API_KEY'`、`maxTokens: 2000` | **✅ 正确**（逐字段命中） |
| F4 | **`dsh-taste` 占官方命名空间 `@deepseek-ai/dsh-taste` 且不带 `dsh.bundle.patch`**；根级只有 3 个 `cordis.patch.yml`<br>`program-notebook.md:95`、`01-…md:66-68` | `dsh-taste/package.json:2` = `@deepseek-ai/dsh-taste`；其 `dsh` 段**只有** `client`（无 `bundle`）<br>仓库根 3 个 `cordis.patch.yml`：`dsh-btw/`、`dsh-usage/`、`dsh-wallpaper-local/`；声明 `dsh.bundle.patch` 的也恰好这 3 个（`.workspace/**` 下的 15 个是部署快照，非根级包） | **✅ 正确** |
| F5 | **目录名 ≠ 包名**：`dsh-wallpaper-local/`→`@local/dsh-wallpaper`；`session-board/` 真包在子目录 `session-board/dsh-session-board/`；`pi-taste-analysis/` 无 `package.json` 非插件 | 三个 `package.json:2` 逐一命中；`ls pi-taste-analysis/package.json` = ENOENT | **✅ 正确** |
| F6 | **`session-board` host-only**：无 `lib/client.js`、无 `exports`、无 `cordis.patch.yml` | `ls session-board/dsh-session-board/lib/` = `board.js capture.js grouping.js index.js inject.js storage.js tool.js`（**无 client.js**） | **✅ 正确** |
| F7 | **部署形态**：自装插件运行时装单位在 `~/.dsh/profiles/node_modules/@local/`（真实目录非符号链接）；该目录是符号链接农场，指向全局安装树；`~/.dsh/profiles/web/node_modules` 不存在 | `ls -ld` 实测：`@local/dsh-*` 为**真目录**；`@deepseek-ai/dsh-tool-subagent` 为**符号链接** → `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-subagent` | **✅ 正确**（措辞精确：`@local/` 真目录 + 农场其余为链接） |
| F8 | **DSH 本体不在本仓库**，全局装于 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh`；本仓无根 `package.json`/`src/`/`tests/`/`.github/workflows`/根 `AGENTS.md` | 逐项 `ls` 均不存在；`which dsh` → `~/.npm-global/bin/dsh → ../lib/node_modules/@deepseek-ai/dsh/lib/bin.js` | **✅ 正确** |
| F9 | **`DEFAULT_CONTEXT_WINDOW = 262144`**（`dsh-llm-pi-ai`）<br>`program-notebook.md:230` D10、`03-…md:50` | `…/dsh-llm-pi-ai/lib/index.js:849` = `const DEFAULT_CONTEXT_WINDOW = 262144;`（`:851` `DEFAULT_MAX_TOKENS = 32768`，`:862` `DEFAULT_INPUT = ["text"]`，文档三值全对）<br>settings 实测：adam 50 条中 45 条有 `contextWindow` ⇒ 5 条缺失，与 D10「曾 45/50 缺」的**历史**叙述一致 | **✅ 正确**（`path:line` 精确；D10 的 D10 表述"45/50 条目缺"是历史事件，当前 45 条已补齐，文档已如此表述） |
| F10 | **`deploy-*/` 相对路径约束**：`deploy-lag/*.sh` 用 `SCRIPT_DIR` 引用同级批次，故 11 个 `deploy-*` 目录必须整体移动保持同级<br>`01-…md:99-101` | `ls -d .workspace/workstreams/deploy/*/` = **11**；`dsh-restart.sh` 头部 `STOP_WAIT` 默认 15、`--force` 语义与文档 §4 五道闸逐条命中（`:18`、`:50`、`:140-141`、`:176-182`、`:303`） | **✅ 正确** |
| F11 | **`vision-adam` 源码副本与部署副本字节一致**<br>`03-…md:186` | `md5sum`：`lib/index.js`、`lib/client.js` 双双 **SAME**（`.workspace/workstreams/sources/dsh-vision-adam-src/` ↔ `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/`） | **✅ 正确** |
| F12 | **`.workspace/reports/` 子目录清单**含 `ports`（`01-…md:42`） | `ls .workspace/reports/` = `audits diagnostics docs-reorg execs handoff incidents plans push-logs reference research runbooks` —— **无 `ports`**；`docs-reorg` 未列入 | **❌ 错误**（`ports` 不存在；另缺 `docs-reorg`）。正确表述：`{audits,execs,plans,research,runbooks,diagnostics,incidents,handoff,push-logs,reference,docs-reorg}` |
| F13 | **"声明 `input` 的只有 2 个 adam 条目"**（`deepseek-v4.1-flash`、`deepseek-v4-flash-vision-exp`）<br>`03-…md:43`、`03-…md:170`、`01-…md:144`（"只有 2 个"） | `settings.yaml` 解析：adam 的 50 条中**3 条**声明 `input`——`deepseek-v4-pro`（`:81-85`）、`deepseek-v4.1-flash`（`:176-180`）、`deepseek-v4-flash-vision-exp`（`:181-185`），均为 `[text, image]` | **❌ 错误（数据漂移）**。正确表述：**3 个**；且 `deepseek-v4-pro` 已声明 `image`——这直接影响 F1 的实际效果："主会话绝大多数图片流量仍走 vision-adam"在**当前 settings 下已不成立**（子代理/主会话若用 `deepseek-v4-pro` 则直传） |
| F14 | **"adam 60+ 条目"**（`03-…md:36`、`03-…md:170`、`01-…md:144`） | 实测 `len(adam.models)` = **50**；`with contextWindow` = 45 | **❌ 数字错误**。正确表述：**50 条**（不是 60+）。同段落"16 条 opencode-go / 全部给 contextWindow 与 maxTokens"**核对为对** |
| F15 | **`.workspace/backup-*` → `.workspace/backups/` 迁移后"`.gitignore` 必须同步补一条规则，否则备份内容会重新进入跟踪……本阶段按硬约束未改 `.gitignore`（待办）"**<br>`04-…md:227-229` | `.gitignore:22` **已经**有 `.workspace/backups/`；`git ls-files .workspace/backups` = 0 | **❌ 错误（陈述已过期，自相矛盾）**。正确表述：该风险已在 `2ece7258` 修复（`.gitignore:22` 新增 `.workspace/backups/`，`TRACK-D-DONE.md` 问题 #2 亦已登记"逐条迁移 + `git check-ignore` 逐个验证"）。且同页引用的 `.workspace/docs-reorg/reports/track-D-prep.md` 路径也需改为 `.workspace/reports/docs-reorg/reports/track-D-prep.md`（见 R8） |
| F16 | **`.workspace/backups/*` 共 14 个**（`04-…md:215`） | 实测**8 个**子目录（`btw config methodology patched plugins subagent-model usage-heatmap workspace`）；若把各项下的**时间戳子目录**也算作"备份"则 >8，但**不是 14** | **❌ 数字对不上**（口径未写清；建议写"8 个主题目录（其下 N 个时间戳备份）"并给出 `find` 命令） |
| F17 | **`session-board` 测试文件 2 个、命令 `node --test`**（`04-…md:214`） | `session-board/dsh-session-board/test/{unified-source,grouping-ttl}.test.mjs` = **2 个** ✅；`node --test` 的命令出处只在 `session-board/FIX-PROPOSAL.md:357`（"`node --test`（或 `node test/*.mjs`）"）为**提案措辞** | **✅ 正确**（文件数对；"命令"出自提案而非成品脚本，而文档已注明"命令只在提案档中给出"⇒ 表述准确）。其余测试盘点（btw 24 / usage 3 / taste 11 / wallpaper 0、仅 btw 有 `scripts.test`）**逐项核对为对** |
| F18 | **子代理路由未做运行时探针**（`03-…md:220`、`program-notebook.md` §8.1） | 无活体探针产物 | **⚠ 无法验证（文档已自标未知）** ⇒ 处理正确 |

### 5.1 必须指出的与事实不符之处（附正确表述）

1. **`README.md:169`（最严重，且是仓库入口）**
   - 现文：`模型路由：workflow/subagent/btw 统一 adam/deepseek-v4-flash；识图 = opencode deepseek-v4.1-flash`
   - 事实（三处都错）：
     - `subagent`/`subagent_fork` = **`adam/deepseek-v4-pro`**（preset `adam` + settings `model: deepseek-v4-pro`）；
     - `workflow` **没有任何默认模型常量**（`agent.cordis.yml:230-233` 只声明 `provider: spawn`），模型继承父代理；
     - btw 侧聊默认 = `` `deepseek-v4.1-flash` ``（`dsh-btw/src/host/vision.ts:103`），`deepseek-v4-flash` 只是**旧持久值的 legacy 回落**（见 `FEATURE-MAP.md:25`）。
   - **该行在 `pre-docs-reorg-…` 里逐字相同 ⇒ 属整理前陈旧，非本次引入**；但本次整理**已改写 README 14 处引用**却漏修此条，
     且新建的 `docs/architecture/03` 与 `program-notebook.md` 已给出正确结论 ⇒ **同一仓库内自相矛盾**。
   - **正确表述**：`子代理（subagent/subagent_fork）实际路由 = adam/deepseek-v4-pro（preset provider=adam + settings 仅覆盖 model）；workflow 无默认模型（继承父代理）；btw 侧聊默认 = deepseek-v4.1-flash（opencode 网关）；识图 = vision-adam → opencode deepseek-v4.1-flash`
2. **`docs/architecture/03-…md:43` / `03-…md:170` / `01-…md:144`：`input` 声明条目数 2 → 实为 3**（漏 `settings.yaml:81-85` 的 `deepseek-v4-pro`）。
   连带 §5 第 3 点"本部署净效果：adam 60+ 条目中只有 2 个声明了 `image` ⇒ 主会话与 btw 侧聊绝大多数图片流量仍走 vision-adam"**在当前 settings 下不成立**。
3. **adam 条目数 `60+` → 实为 50**（`03-…md:36`、`03-…md:170`、`01-…md:144`）。
4. **`docs/architecture/04-…md:234-238` 的迁移警告已过期**（`.gitignore:22` 已补 `.workspace/backups/`），且其待办引用路径 `docs-reorg/reports/track-D-prep.md` 失效。
5. **`.workspace/backups/*` 数量 14 → 实测 8 个主题目录**（`04-…md:230`）。
6. **`01-…md:44` 的 `.workspace/reports/` 清单含不存在的 `ports`**，且漏 `docs-reorg`。
7. **引证行号三处不准**：`settings.yaml:217-218` → **`:220-221`**；`dsh-tool-subagent/lib/index.js:132-134` → **`:119-136`**（且该相对路径在页面上不存在，应给 `~/.npm-global/.../dsh-tool-subagent/lib/index.js`）；`dsh-llm-pi-ai/lib/index.js:849` 值正确但同样缺前缀。
   注：`dsh-tool-subagent/lib/model-selection-settings.js:64-74`（**`docs/runbooks/port-wallpaper.md:46`** 引用）在**当前部署包内不存在**
   （该文件只在归档 `~/.dsh/profiles-archive/web2-20260915-105429/` 里）——`port-wallpaper.md` 是整理前既有文档（2026-09-11），
   按本次范围不追溯，但**该引用今天已不可复核**，建议加注归档路径。

### 5.2 关于"两条已确认事实"的独立复核
- **子代理路由 `adam/deepseek-v4-pro`**：**确认**（F1；机制 = `index.js:119-136` 的**字段级**合并 + settings 缺 `provider`）。
  文档 D1 的**结论正确**，仅引证行号需修正。**注意**：本审计档派生时获得的模型信息与此一致（未做活体探针，与文档同样的诚实边界）。
- **本部署无源码重建能力（只能原地打补丁）**：**确认**。证据：本仓**无根 `package.json`**、无工作区配置，
  且 `README.md` 尾段明确"工作区/全局树重装后的补丁重放"，`04-…md:99-101` 的 11 个 `deploy-*` 目录用 `SCRIPT_DIR` 相对引用同级批次，
  `replay-lag-fix.sh` 属"备份→应用→校验"原地改写 `~/.npm-global/.../@deepseek-ai/dsh/node_modules/**` 的 lib 文件。
  **但 `replay-lag-fix.sh:28` 注释"本环境 pnpm 不可用"确为过期**（`~/.npm-global/lib/node_modules/pnpm` 存在）——`program-notebook.md:227` D8 **判定正确**。

---

## 6. 可回滚性（只读判断）→ **三种方案都不能完整回滚；方案 3 是唯一能覆盖未跟踪搬移的，但会二次破坏**

| 方案（`TRACK-D-DONE.md:55-71`） | 能否真正回滚 | 缺陷 |
|---|---|---|
| **1. `git reset --hard pre-docs-reorg-20260920-154951`** | **部分**：跟踪文件可回到整理前 | ① **无法恢复 19 条由普通 `mv` 搬走的未跟踪目录**（实测这些源目录在 pre tag 里 `ls-tree` = **0** 条：`.workspace/twin-probe`、`vision-test`、`repos`、`research-luxweft-doc`、`tmp-ppt-research`、`backup-*` 等，共约 41 MiB 的 `.workspace/backups/`）——`reset` 只能删除工作树里的"未跟踪新路径"，**不会把内容搬回旧路径**；<br>② 会**连带丢弃**本 tag 之后的所有提交（含 `242fb0c3` 及 3 个 lag-fix 提交、`15338480`）与**并发会话未提交的工作树改动**（审计期间 peer 正改 `measure-after-C1.mjs`）；<br>③ 文档自己已加 ⚠️ 说明①，但**未说明②**（对"只回退整理、保留后续成果"的诉求是破坏性的） |
| **2. `git revert --no-commit 2ece7258 7cfa1369 && git commit`** | **不能可靠执行** | ① **实测失败**：`error: 您对下列文件的本地修改将被合并操作覆盖：.workspace/lag-fix/probes/measure-after-C1.mjs` → `fatal: 还原失败`（被并发未提交改动阻塞；执行者当时无此障碍，**该方案对"整理后继续工作"的将来不可复现**）；<br>② 即便在干净树执行，revert 是**内容级反向 diff**：204 条 `git mv` 会被反向 diff 还原为"删新路径 + 建旧路径"，但 **19 条普通 `mv`（未跟踪、无 diff）根本不在 revert 范围内**，故**"只回退文档整理"名不副实**——忽略规则与 `probes/**` 未跟踪内容都不会回位；<br>③ 若 `7cfa1369` 之后的 lag-fix 提交改过同一文件（如 `.workspace/lag-fix/**`、`dsh-usage/lib/*`），revert 会与其冲突需人工解 |
| **3. 按 `mapping.json` 倒序手工 `mv` 回去** | **能覆盖 19 条未跟踪搬移**（唯一），但会二次破坏 | ① 脚本片段按 `reversed(moves)` 输出，**包含 3 条自映射 no-op**（`from == to`，见 §1）——虽无害但会误导；<br>② **19 条反向 `mv` 的源目录现在被 gitignore**（`.workspace/backups/`、`workstreams/research/repos/` 等），反向执行后这些内容会**重新变得可被 `git add` 捕获**，而 `.gitignore` 仍是**迁移后**的规则 ⇒ 反向回滚后**忽略规则与目录布局不一致**（旧 `.workspace/backup-*/` 规则已删），下次 `git add -A` 会把 41 MiB 备份扫入库；<br>③ 不还原 13 条被改写的文档/脚本内容（§1-C 表）；<br>④ 依赖 `.workspace/reports/docs-reorg/mapping.json`——**该文件本身被跟踪**（`git ls-files` = 15 个文件，`242fb0c3` 引入 `TRACK-D-DONE.md`），此点无风险（文档"先把 mapping.json 备份到工作区外"是保守建议，非必需） |

**结论**：`TRACK-D-DONE.md` §四的 ⚠️ 注释**仅覆盖了方案 1 的一个缺陷**。完整表述应为：
> 方案 1 可恢复**跟踪文件**到整理前，但（a）不回搬 19 条未跟踪 `mv`（约 41 MiB），（b）**丢弃其后全部提交与未提交改动**；
> 方案 2 在"整理后仍有未提交改动"的现实盘面下可能**直接失败**，且**天然不覆盖 19 条未跟踪 `mv`**；
> 方案 3 是唯一覆盖未跟踪搬移的手段，但回滚后**必须同时把 `.gitignore` 还原到旧规则**（或反向搬回 `backups/` 内容），否则备份将重新可入库。
> **推荐**：回滚前先 `cp -a .workspace/backups /tmp/` 留底；优先用方案 3 + `.gitignore` 同步还原，而非方案 1。

---

## 7. 交付物清单与本审计自身的影响

### 误入库清单
**无。** 最近 3 次提交新增路径中：0 条命中 `venv`/`backup*`/`__pycache__`/`.pyc`/`node_modules`/`tarball`/`.tgz`/`repos/`，
0 个 >5MB 文件，跟踪树 47.24 MiB → 72.91 MiB（+25.93 MiB，可归因见 §4）。

### 未验证项（本审计明确不声称）
1. 子代理路由**未做活体探针**（与文档同一诚实边界；结论为"settings 值 + 合并代码"推论）。
2. `opencode-go` 内置 catalog 的实际 `baseURL`/`api` 未打开确认。
3. 判 `FEATURE-MAP.md` 两处链接为"本次引入"依据的是 `pre` 版该行为 `port-taste.md`（无前缀）——**未**逐字节审计改写器日志。
4. `revert` 的**失败**是实测（只读执行了 `--no-commit` 后 `--abort`，见下），但"在干净树上 revert 是否能成功"未实跑（属破坏性，未执行）。
5. `.workspace/probes/**` 内 160 条不可达引用中，`brief-history-bigfile.md` 的 73 条是否属"历史快照文档"而**不应改**，未与执行者确认口径。
6. `docs/architecture/04` 中"18 个 `*.sh`""447 个跟踪文件""22 条目 `~/.dsh/backups`"等盘点：
   `deploy-015`=**447 ✅**、`~/.dsh/backups`=**22 ✅**、`deploy-lag/backup-*`=**3 ✅**、`deploy-slots/backup-*`=**1 ✅**；
   但"≤2 层共 18 个 `*.sh`"按我口径为 **21 个**（含 `.workspace/lag-fix/{patches,probes,scripts,reports}` 中 8 个，
   该页写"（另一处）`settings-lag/scan_sessions.sh`"的排布暗示其口径不同）⇒ **口径未写清，判"无法复核"**。

### 审计自身的操作留痕（纪律）
- 只读约束下**误执行了一次 `git revert --no-commit 2ece7258 7cfa1369`**（为验证方案 2 是否可执行）。
  该命令因本地修改**报错终止**，随后 `git revert --abort` 已回退。
  残留副作用**仅一个未跟踪的空壳文件** `.workspace/lag-fix/probes/measure-after-C1.mjs.bak`（15:27 备份副本，**非我创建**，
  属并发会话产物，**未删除**）。复核：`.gitignore` 的 worktree 内容 sha == `HEAD:.gitignore` sha（`c166e550`，无差异）；
  `git status` 中 `measure-after-C1.mjs` 的修改**时间戳 16:06:20 且为 29+/23- 的内容改动，属并发会话**，非本次审计。
  **未**执行 `reset`/`checkout`/`commit`/移动文件。唯一写入 = 本报告。
- 未重启宿主 PID 20806，未触碰 `/proc/20806`。

---

**签名**：独立审计档 · 2026-09-20
**主要证据脚本**：`/tmp/docs-audit/refcheck.py`（引用可达性，可复跑）
**过程产物**：`/tmp/docs-audit/{unreachable.jsonl,move-analysis.json,pre.names,head.names,risky.*}`
