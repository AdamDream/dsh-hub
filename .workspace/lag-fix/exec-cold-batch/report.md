# exec-cold-batch / U-CB1 · U-CB2 · U-CB3 — 修订执行复核一体档报告

- 日期：2026-09-22
- 档位：**修订执行复核一体**（不重新拆解、不扩范围）
- 宿主：PID 301709 **未重启**；本档**只产出候选与脚本**，deployed 写入由协调者排入冷面批次执行
- 独占目录：`.workspace/lag-fix/exec-cold-batch/`
- 契约：`program/w05-usage-ingest/audit.md` + `sub-b-correctness.md` + `exec-audit/BATCH-PLAN.md` §三bis/§五 + `program/FINDINGS-INDEX.md`
- 授权二级 subagent：1 个（`59a15140…`，被系统中断杀死；其落盘产物完整，我已**亲自重跑**复核）

## 0. 自复核裁决

| 单元 | 结论 |
|---|---|
| **U-CB1**（refresh 回写 `lastIngest`） | ✅ **PASS**（候选 + 脚本 + 离线活体验证 11/11，两轮可复现） |
| **U-CB2**（开 45s timer） | ✅ **PASS**（候选 + 脚本 + 开启后验收仪器已实测可用） |
| **U-CB3**（部署面风险闭合） | ✅ **PASS**（三件全交付；其中 ③ 相对协调者现状做**增量**，非覆盖） |
| 契约核对 | ✅ 审计描述**全部与 deployed 相符**，未触发"停下上报"条件 |
| 新增发现 | 🔴 1 条高严重度（审计未覆盖）：`deploy-side.sh` 是**默认真跑的整包部署器**，指向最旧的镜像 |
| 自评 | **全部 PASS，无 REWORK 项**；有 2 处**明确"不做"**并给出理由（见 §5） |

---

## 1. 开工前 deployed pre-image（纪律 #4）

deployed 根 = `~/.dsh/profiles/node_modules/@local/dsh-usage/`
⚠️ **任务书写的 `~/.npm-global/lib/node_modules/@local/dsh-usage/lib` 不存在**（`@local/` 不在 `~/.npm-global` 下）；按实际部署位执行。

| 文件 | md5 | sha256（前 16） | bytes | mtime |
|---|---|---|---|---|
| `lib/index.js` | `303cab9775572d4adf3190cee77feab5` | `ce85f4bdf2bfb0d9` | 14696 | 09-21 17:12 |
| `lib/rpc.js` | `fa2654ab8e0584512e6477ee14f0f013` | `6a3e774181d262de` | 10767 | 09-21 17:12 |
| `lib/db.js` | `d187d44932b35a583119f6af97cd82d6` | `ecb86c2357314c2c` | 38493 | 09-21 17:12 |
| `lib/ingest-worker.js` | `9dc04f44ec9815390c8b819f8ead38a7` | `15ac65f7d6c009d3` | 6596 | 09-21 17:12 |
| `lib/ingest-runner.js` | `23c88e5109068f4ecf3c80286ebaa1d7` | `92acb9bc014fa110` | 10898 | 09-21 17:12 |
| `lib/ingest-cc.js` | `5763aee12811e8f7cc0008b2634f7572` | `25f3560e578eaf59` | 8874 | 09-21 17:12 |
| `lib/ingest-dsh.js` | `f40144a33d616d3046047f1594525340` | — | 9717 | 09-18 10:51 |
| `lib/client.js` | `860271933283d29680009929d43b2566` | `cdbd87b6d97e3933` | 72804 | 09-21 14:30 |
| `lib/charts.js` | `7240517606966977aaba1a3058f10c91` | — | 27396 | 09-18 11:57 |
| `lib/zstd.js` | `c02051167b173260ace7bdef3fa6bb64` | — | 5265 | 09-18 10:51 |
| `package.json` | `1e351dacf2219ea6236edb6fac8dc62a` | `d69600ea782aabe7` | 1226 | 09-16 14:10 |
| `cordis.patch.yml` | `b3a94fc580a7762350a745537caca178` | — | 57 | 09-12 16:52 |

- 全量副本：`evidence/pre-image-deployed/`（14 文件）；机器可读：`evidence/pre-image-deployed-manifest.json`
- 复核：`deploy-side.guarded` 的假 HOME 沙箱测试中，`db.js=d187d449 / index.js=eae532a7` 两个指纹分支均按预期打印 ⚠（见 §4.4 TEST 2b）

---

## 2. U-CB1 — `/usage/refresh` 永不回写 `lastIngest`（必修）

### 2.1 根因（逐行复核为真，并**精确化**了一条）

| 位置 | 事实 |
|---|---|
| `lib/index.js:263` | `waitIdle: () => (runner === null ? runIngest() : runner.run()),` |
| `lib/rpc.js:189-201` | `refresh` 分支 `if (typeof waitIdle === "function") await waitIdle();` → 拿到 `statusProvider()` |
| `lib/index.js:200-201` | `lastIngest = Date.now(); if (firstScanAt === null) firstScanAt = lastIngest;` ← **在 `runIngestWorker()` 内** |
| `lib/index.js:166-167` | 同样的两行**在 `runIngestSync()` 内** |
| `lib/index.js:296-304` | runner 的 `onProgress` 只写 `ingestSummary.scannedDsh/newEventsDsh` |

⇒ refresh 调 `runner.run()` 直接吃掉单飞 promise，**永不执行结算尾部** ⇒ 只有时间戳冻住、进度数照走。
**精确化（新）**：缺陷**只存在于 worker 路径**——`runner === null` 时旧代码同样走 `runIngest()` → `runIngestSync()`，而 `runIngestSync` 自己写了时间戳。即 `INGEST_VIA_WORKER=false` 时无此缺陷。

### 2.2 修法（file:line，改动形状）

**`lib/index.js:263`**：`waitIdle: () => (runner === null ? runIngest() : runner.run()),` → **`waitIdle: () => runIngest(),`**（+ 一段说明注释）

两条审计给出的修法形状里，采用"**让 refresh 也走到结算尾部**"这一支，理由是它让三条路径共用**同一个**结算点，而不是新造第三个半套路径：
`runIngest()` → `runIngestWorker()` → `await runner.run()`（**单飞不变**）→ 结算尾部。

- **收益**：手动刷新后 `status.lastIngest` 前进；`firstScanAt` 同时被正确 latch；顺带把权威计数（`result.dsh.scanned…`）也补齐（旧路径只靠 `onProgress`，最后一条 progress 若被节流会偏低）。
- **风险 / 已声明的副作用**：refresh 现在**也会**输出那一行 `ingest done: dsh scanned=… ` info 日志（boot/timer 路径一直都发）。**这是"共用结算点"的题中之义，不是新增代码路径**；且按 FINDINGS-INDEX F1，宿主插件日志在本构建**没有任何持久出口**（唯一 exporter 是 1000 条内存环形缓冲、全树零读取点），所以对用户不可见。此外 `runner === null` 分支**逐字节等价**于被替换的写法。
- **热/冷面**：**冷面**（宿主侧已部署件，须重启生效）。
- **验收标准**：refresh 后 `status.lastIngest` **必须前进**且 `eventsDsh` 同步增长；重跑 `exec-ingest/tools/g1-live.mjs` 时其 `advanced` 谓词为 **true**（此前为 `false` ⇒ PRECONDITION-FAILED）。
- **回滚**：`node scripts/apply-CB1-v1.mjs --rollback --apply`（或还原 `pre-image/U-CB1/index.js`）。

### 2.3 脚本性质（`scripts/apply-CB1-v1.mjs`）

dry-run 默认 · `--apply` 才写 · **锚点唯一命中否则一个文件都不写**（fail-closed）· 自动 pre-image（二次运行不覆盖原件）· `node --check` + `.mjs` ESM 解析双检 · 写后重读复断 · 幂等（marker `dsh-lag-fix ColdBatch-v1 (U-CB1)`）· `--rollback` 带**归属校验**（无我方 marker 拒绝回滚）。

额外**因果不变量**（不止锚点）：pre→ 时间戳写入点必须**恰好 2 处**（`runIngestSync`+`runIngestWorker`）、`firstScanAt` latch 2 处、`registerUsageRpc(ctx,{` 1 处、`if (INGEST_VIA_WORKER && runner !== null) {` 1 处；post→ 时间戳写入点仍 2 处（用**整行正则**计数，不受注释里出现同样代码文本影响）、`result = await runner.run();` 1 处、`ingest-runner.js` 的 `if (inFlight !== null) return inFlight;` 1 处。

---

## 3. U-CB2 — 开启 45s timer

### 3.1 改动（file:line）

**`lib/index.js:67`**：`const INGEST_TIMER_ENABLED = false;` → **`= true;`**（+ 一段 marker 注释）

安装块 `:318-334` **已经是正确形状**（`ctx.inject(["timer"], cb)` + `timerCtx.setInterval(() => void runIngest(), INGEST_INTERVAL_MS)`，`:38` 为 `45_000`，`:322-332` 有 `ctx.effect` 卸载）⇒ **常量是唯一改动**，与常量自陈的 "flip this to `true` and restart — no other edit is needed" 一致。脚本用 `codeLines` 结构化 diff **机器断言"唯一被改的可执行行就是这个常量"**（注释块对断言不可见）。

- **收益**：唯一的数据自动新鲜化路径恢复（当前 `INGEST_TIMER_ENABLED=false` ⇒ 触发面只剩 boot + 手动 refresh；实测宿主 10:55 启动后到 14:33 **3h38m** 无任何写入）。
- **依据（w05 G1 活体）**：一次真实 **7,835 ms** 的 pass，期间独立进程心跳 **max 148.5 ms、0 拍 >200 ms**（比 fold 墙钟低 **52.8×**）；同仪器能报出 **4,146 / 2,546 ms** 宿主停顿 ⇒ 通道灵敏度已自证。
- **⚠️ 必须如实标注的限制**：字面 **`<100 ms` 阈值在本机不可判定**——静默期噪声地板实测 **336–446 ms**（本档独立复测：静默 8 s×2 窗 max **297 / 223 ms**，同样 >100 ms）⇒ **严格按字面只能算 INCONCLUSIVE，不是 PASS**；成立的判据是**量级判据**（亚秒 vs 修复前 2.68 s / 36.1 s）。
- **顺序要求**：**先 U-CB1 再 U-CB2**。开 timer 后 ingest 走 `runIngest()`、**会**执行结算尾部 ⇒ **timer 会掩盖而非修好 `lastIngest` 缺陷**。本档已**独立实证**这一点：harness 的 S4c 对照（未打补丁的 index.js + timer 打开）`TIMER_TICK_ADVANCES_LASTINGEST=true`。
- **风险**：若 worker 路径在某些条件下仍阻塞，则会从"数据不新鲜"变成"每 45 s 卡一下"。故设**硬回滚阈值**。
- **热/冷面**：**冷面**。
- **验收标准（开启后）**：用 `scripts/accept-U-CB2-timer.mjs`（默认 3 窗 ×120 s，跨 **≥2 个 tick**）：
  1. 观察到的 tick 总数 > 0（`lastIngest` 自行前进，全程**不调用** `/usage/refresh`）；
  2. **0 拍 > 1000 ms**（fail bar；字面 100 ms 不作判据，理由如上）；
  3. 每窗观察到的 tick 数 **≥2**。
  ⇒ 一旦观测到 **>1000 ms 单拍**，**回滚**。
- **回滚**：常量改回 `false` + 重启（`node scripts/apply-CB2-v1.mjs --rollback --apply`）。回滚**不影响** U-CB1。

**其它两处硬约束**（脚本已机器断言）：`typeof ctx.setInterval` 探测必须为 **0**（那正是 U-IG2 原始根因）；`INGEST_TIMER_ENABLED &&` 二次门禁必须为 **0**（避免半套状态）。

---

## 4. U-CB3 — 部署面风险闭合

### 4.1 复核：审计"五项全缺"为真，并补一条审计未列的 divergence

| 项 | deployed | `dsh-usage/lib/db.js`（workspace 镜像） | `sources/dsh-usage-src/lib/db.js` |
|---|---|---|---|
| 区间对齐（span DELETE） | ✅ `:282-286` `spanDays` | ❌ 缺（**缺陷本体在此**） | ⚠️ **不适用**（无此缺陷，见下） |
| `usage_daily` UPSERT | ✅ `:306` | ❌ 缺 | ⚠️ 不适用 |
| `busy_timeout = 5000` | ✅ `:81` | ❌ 缺 | ❌ 缺 |
| `temp_store = 2` | ✅ `:90` | ❌ 缺 | ❌ 缺 |
| `export invalidateMaxDailyDayCache` | ✅ `:541` | ❌ 未导出（`:476` 裸 `function`） | ❌ 整个函数都不存在 |

**workspace 镜像与 deployed 的 db.js 差异 = 7 个 hunk / +73 −8 行**，其中 5 项 = U-IG3 清单，**第 6 项 = `HOUR_SQL` + `queryTimeseries` 的 hour 粒度（审计未列、非 U-IG3）**。镜像的 `rpc.js:54` 仍是 `GRANULARITIES = new Set(["day"])` ⇒ 两侧对该特性是一致的旧状态，内部自洽。

### 4.2 🔴 新增高严重度发现（审计未覆盖）：存在**默认真跑**的整包部署器

`.workspace/workstreams/side-deploy/deploy-side.sh:92`
```bash
run cp -r "$SRC_USAGE" "$DST_USAGE"     # DST_USAGE="$FLAT/@local/dsh-usage" = 在产 deployed 位
```
- 该脚本整包覆盖 `@local/dsh-usage` **和** `@deepseek-ai/dsh-session-board`。SRC = `side-deploy/usage/`（**2026-09-12 期 v0.1.0 快照**，8 文件，`db.js` md5 `a9a8e785…` 22,367 B，**连 `ingest-worker.js`/`ingest-runner.js` 都不存在**，`rpc.js` md5 `9a82c83f…`）。
- ⇒ 一次执行就静默回滚 **U-IG1 + U-IG3(五项) + U-CC1 + P0-b settings + hour 粒度 + U-CB1 + U-CB2**，且 `rpc.js` 姿势不同会**直接打断 `/usage` 路由**。
- **这是脚本体、可无人值守**，比"有人手工 cp"高一个数量级 —— 比任务书设想的风险面更严重。
- 🟡 **协调者已先行加固**（我开工后核对：md5 `5aeed414d02098679b14a4de3d660fe2`，`bash -n` 通过）：默认 dry-run、必须 `--apply`、5 s 红字警告、未知参数 exit 2。**本档 ③ 就是在这之上做增量**（见 §4.4）。

**已核查的其余部署面（有界扫描，如实标注范围）**：
- `dsh-usage/scripts/install-web2.sh:76` `cp -r` → 目标 `$HOME/.dsh/profiles/**web2**/node_modules/@local/dsh-usage`，而 web2 是 `DEPRECATED-web2.md` 明令"已废弃·勿启用"的 profile ⇒ **对活跃宿主无影响**（低危）。
- `side-deploy/session-board/install.sh:27` `cp -r "$SCRIPT_DIR" "$FB/dsh-session-board"` → **第三个整包部署器**，目标是在产的 `@deepseek-ai/dsh-session-board`。**实测该插件 deployed 与 SRC 逐字节一致**（`lib/index.js` 均 `e4080047`、`package.json` 均 `ffd2f3a2`）⇒ 当前**不构成**回滚风险，但属同一风险类别，登记备查（越出本批范围，未处置）。
- `.workspace/workstreams/deploy/deploy-*/` 11 个子目录：**脚本平面无 `cp -r`/`rsync`**（内容为 svg/py/ts/js/md 等资产），未发现 `dsh-usage` 整包部署器。

### 4.3 两方案对比与**明确推荐**

| | 方案 A：反写回源码镜像 | 方案 B：声明 deployed 为唯一真源 + md5 部署校验 |
|---|---|---|
| 覆盖风险 | 只覆盖 `db.js`（`rpc.js`/`index.js`/`client.js` 仍是结构性旧版，**不是可部署树**） | 覆盖**任何**文件、**任何**方向的漂移（含刚才那 3 个部署器） |
| 可判定性 | 靠人读 diff | **机器判定**：哈希不符即失败，直接复用 BATCH-PLAN §四既有"重启后 sha 必须等于预期值"协议 |
| 对 R1（deploy-side.sh） | **无效**（该脚本仍会整包覆盖） | 有效（事后必被发现）＋ ③ 前置闸门（事前拒绝） |
| 失败模式 | 让人误以为"源码树=可用部署源" | 不阻止部署，但让回滚**响亮** |

**推荐：B 为主、A 为辅（且 A 只做 `db.js`）＋ R1 单独加前置闸门**。理由：
1. deployed 是**唯一自洽、承载全部成果**的工件；两个源码镜像在多维陈旧（`charts.js` 7 KB vs 27 KB、`client.js` 35 KB vs 73 KB、`index.js` 无 worker、`rpc.js` 姿势不同且**覆盖即打断 `/usage`**）⇒ **A 单独做不足以让任何一棵树"可部署"**，反而更危险；只有 `db.js` 这一处做 A 才是**净收益**（消除 U-IG3 的内容差异）。
2. 协调者已把"部署哈希校验器"排进冷面批次 ⇒ B 与既有排期一致，零额外协调成本。
3. R1 是**脚本体**，只有"事前拒绝"（③ 前置闸门）能真正拦住它；B 是它的**事后兜底**。两者互补，不是二选一。

**对 `sources/dsh-usage-src` 的处置（与任务书原设想相反的更正）**：该树 `rebuildDailyForDays` 的 DELETE 与 INSERT 用**同一个 `days` 集合**（`WHERE strftime(...) IN (${placeholders})`）⇒ DELETE 集合 == 产出集合，**不存在 gap 日 UNIQUE 冲突**，即**该树没有 U-IG3 缺陷**（缺陷是另一镜像经 sargable `[lo,hiExclusive)` 改造引入的）。故"把 U-IG3 反写回该树"是**语义空操作**；正确处置 = **标记超期快照 + 纳入哈希校验**（已交付 `SUPERSEDED-workstreams-sources.md`；脚本对该 target **默认拒绝**并要求 `--force-superseded`）。

### 4.4 三件交付物（对应任务书升级后的 ①②③）

**① 部署清单哈希校验器** — `deployed-manifest-v1.json` + `scripts/verify-deployed-manifest-v1.mjs`
- 两个相位：`pre-deploy-baseline`（现在，MATCH ✅）/ `expected-after-cold-batch`（**`lib/index.js` = `eae532a7a7bd8c96ebd1abd9aff0f8c9`**，其余不变；现在必然 MISMATCH ✅ —— 已双向实测，退出码 1/0 正确）。
- `--mirrors` 额外列出 3 棵镜像的指纹与"从它部署会毁掉什么"。退出码 0/1/2。

**② db.js 反写回源码镜像** — `scripts/apply-CB3-v1.mjs`（目标 = workspace 镜像，**候选件不落盘到真镜像**）
- **零手抄**：替换文本由脚本**从 live deployed 文件按锚点对切出**再拼接；开工先断言 deployed `db.js` md5 `d187d449…`+sha256 与记录一致，否则拒写。
- 两种模式：`--mode uig3`（默认，只做 5 项 = 任务书授权范围）→ md5 `726c0f72209db989e898caee4dae59b8`；`--mode full`（额外带 hour 粒度）→ **md5 断言 == deployed `d187d449…` 通过**（即与 deployed **逐字节相同**）。
- 诚实标注：脚本对 workspace 镜像同时提供了"语法 + 语义不变量"断言（`spanDays` 存在、DELETE 绑定 span 集合、UPSERT 存在、`.run(...days)` 归零、无朴素 `+86_400_000`、`busy_timeout`/`temp_store` 各 1、导出存在）。

**③ `deploy-side.sh` 前置闸门（增量，建立在协调者现状之上，merged 不覆盖）** — `candidates/U-CB3/deploy-side.guard-block.sh` + `scripts/apply-CB3b-deployside-guard-v1.mjs`
- **插入式**（`removed lines: 0`，机器断言"每一行原文按序存活"）；先断言目标 md5 == 协调者的 `5aeed414…`，否则拒写。
- 补的是协调者加固**没覆盖的另一半**：跑起来时**不许静默**。三处插入：定义块 + `guard_deploy_preflight`（备份段后）+ `guard_deploy_postcopy`（两条 `cp -r` 后）：
  - 用记录指纹证明 SRC 确为旧快照 + 逐条打印将丢失的单元；缺 `ingest-worker/runner` 亦作为判据；
  - ⚠ 基于**实际哈希**按单元告警（`db.js==d187d449` ⇒ U-IG3 将被回滚；`index.js==eae532a7` ⇒ CB1+CB2 将被回滚）；
  - **证明备份真的可用**（缺失/为空 ⇒ `exit 3`）—— 覆盖前状态取样自 `.bak-$TS`（因为 apply 模式下第 1 段已把 deployed `mv` 走）；
  - 覆盖后**复核 deployed == SRC**（不符 ⇒ `exit 4`）并打印红字恢复指引。
- 候选件 md5 `b0c22b32bab0cacd05a2a7546aba7ecb`；diff：`candidates/U-CB3/deploy-side.preflight-guard.diff`（+N −0）。

**③ 沙箱实跑（假 HOME，全程不碰真实 deployed / `profiles`）**

| TEST | 期望 | 实测 |
|---|---|---|
| T1 无参数（默认 dry-run） | 不写盘、**不中止**、打印将丢失单元 + 两条 ⚠ | ✅ 哈希不变、无 `.bak-` 生成、流水线 exit 0 |
| T2b `--apply` | 备份校验通过、**两条 ⚠ 按真实指纹触发**、覆盖后 `deployed == SRC`、红字恢复指引 | ✅ 全部命中（修复前此处 ⚠ 不触发，见 §6.2） |
| T3 `--oops` | exit 2 | ✅ exit 2（协调者加固） |
| T4a 备份缺失 | exit 3 | ✅ exit 3 |
| T4b 覆盖后 != SRC | exit 4 | ✅ exit 4 |

---

## 5. 明确"不做"的两项（附理由）

1. **不把 `index.js` / `rpc.js` / `client.js` 反写回任何源码镜像**：这三处的差异是**结构性**的（镜像 `index.js` 是 pre-Ingest-v1、无 worker 接线；镜像 `rpc.js` 用 0.1.5 姿势而运行位是 0.1.1-rc.2，**覆盖即打断 `/usage`**）。整树反写 = 一次越界的重写工程，且**本轮任务书未授权**。`verify-deployed-manifest-v1.mjs` 已把这些差异变成可判定信息。
2. **不往 `sources/dsh-usage-src` 树写任何东西**：该树无 U-IG3 缺陷（DELETE 集合 == 产出集合，已核实），且它连 `MAX(day)` 闸门都没有 ⇒ `invalidateMaxDailyDayCache` 无对应物、`busy_timeout` 无消费者。写进去是"给不存在的病开药"。脚本默认拒绝该 target。

---

## 6. 同档自复核详情

### 6.1 独立活体 harness（二级 subagent 产物 + **我亲自重跑**）

位置：`subagent-verify/`（`harness.mjs` / `run.sh` / `stage/{unpatched,patched,patched-timer,unpatched-timer}/` / `out/*.json`）
方法：把**真实** deployed `index.js`+`rpc.js`+`ingest-runner.js` 以**符号链接**放进 stage 目录，`./db.js` 与 `./ingest-worker.js` 换成桩件，并用 `--preserve-symlinks` 使符号链接模块的相对 import 解析**留在 stage 内**（其自证：`isolated: true` —— 真实 `./db.js` 不可达，全程不碰生产库）。`ctx` 全桩，**捕获真实 `ctx.connection.rpc.handle` 收到的 handler**，直接驱动真实 `/usage` 端点。

**我在 subagent 被杀后亲自重跑：`bash run.sh` → exit 0，11/11 PASS（可复现）**

| 判据 | 结果 |
|---|---|
| `DEFECT_REPRODUCED` | ✅ 未打补丁：refresh `ok=true`、计数 1013→2026 变了、**`lastIngest` 逐字节不变**（`lastIngestAdvanced=false`） |
| `FIX_VERIFIED` | ✅ 打补丁：refresh 后 `lastIngest` **前进** |
| `SINGLE_FLIGHT_UNPATCHED` / `_PATCHED` | ✅ 8 并发 refresh **只触发 1 次 fold**（两个 stage 都是 1）⇒ 修法未削弱 G2 |
| `ANCHOR_UNIQUE` | ✅ `:263` 唯一命中；部署三件 md5 与记录**逐一致** |
| `TIMER_PATH_UNREACHABLE_IN_DEPLOYED_FILE` | ✅ 常量 false ⇒ 部署文件的 timer 路径不可达 |
| `TIMER_TICK_ADVANCES_LASTINGEST`（patched-timer **与** unpatched-timer 对照） | ✅ 两条都是 true ⇒ **独立确认"开 timer 会掩盖而非修好 lastIngest 缺陷"**，即"先 CB1 再 CB2"的顺序要求有实证支撑 |
| `NO_PLUGIN_FILE_SIDE_EFFECTS` / `PRODUCTION_DB_UNREACHABLE` | ✅ deployed 树与 DB 三件（db/-wal/-shm）前后快照一致，未变更 |
| 路径归属（静态） | ✅ `runIngestSync` 写时间戳(`:166`)、`runIngestWorker` 写时间戳(`:200`)、**refresh 路径不写**（`rpc.js:199`→`index.js:263`） |

> 说明：S4b/S4c 的输出里有一条 subagent 自陈的**它自己断言写错**（期望 3 次 fold，实际 2 次——该场景没有 refresh），与其被中断前的收尾留言一致；该条不影响任何判据（`ok=true`，非 critical）。我按实际语义复核后接受。
> `waitIdle.diff`（候选与部署的唯一行为差异）亦已落盘。

### 6.2 本档自查发现的 4 个真问题（均已修并复测）

1. **CB1 不变量用了带 tab 前缀的 needle** ⇒ 两处写入点缩进深度不同（3 tab / 2 tab），命中 0 ⇒ **fail-closed 正确拦下**，未写入任何东西。改为整行正则计数。
2. **CB3 起初只"插入"不"替换"** ⇒ 目标文件里旧函数体残留，`node --check` 直接报错并被拦下。改为"替换两锚点之间的目标区间"。
3. **③ 闸门在 dry-run 下会因"备份不存在"而 exit 3** ⇒ dry-run 被误杀。已加 `if $DRY_RUN` 分支跳过备份/后置校验。
4. **③ 闸门在 apply 模式下 ⚠ 不触发**（第 1 段已把 deployed `mv` 成 `.bak-$TS`，取样到 ABSENT）⇒ 改为**从备份目录取样覆盖前状态**（备份即 pre-image），复测两条 ⚠ 均按真实指纹触发。
另：`accept-U-CB2-timer.mjs` 初版有**死锁**（子进程可能先于监听器注册而退出 ⇒ `once("exit")` 永不触发），已改为 spawn 后立刻挂监听 + `race`，并实测通过（退出码 3 / 0 tick 与"timer 仍关"的现状一致）。

### 6.3 交付物一致性核对

- `index.js` 组合性：**CB1→CB2 与 CB2→CB1 两种顺序产出逐字节相同**（`cmp` 通过），组合结果 md5 = **`eae532a7a7bd8c96ebd1abd9aff0f8c9`** ⇒ 已写入 manifest 的 `expected-after-cold-batch`。单件 md5：CB1-alone `8c7e889d7aef855fd19f5ab54da24ce1`、CB2-alone `1287401548468c3f814ab654f7bd7c74`。
- 幂等/回滚实测：两脚本重复运行 → `ALREADY-PATCHED`；`--rollback` 后与 deployed pre-image **逐字节相同**（`303cab97…`）；对无 marker 的文件执行 `--rollback` → **归属校验拒绝**。
- 所有脚本 `node --check`/`bash -n` 通过；所有候选件哈希已登记（见 §7）。

---

## 7. 交付物清单（均在 `.workspace/lag-fix/exec-cold-batch/`）

| 用途 | 文件 | md5 |
|---|---|---|
| U-CB1 补丁脚本 | `scripts/apply-CB1-v1.mjs` | — |
| U-CB2 补丁脚本 | `scripts/apply-CB2-v1.mjs` | — |
| U-CB3 ② db.js 反写脚本 | `scripts/apply-CB3-v1.mjs` | — |
| U-CB3 ③ 闸门增量脚本 | `scripts/apply-CB3b-deployside-guard-v1.mjs` | — |
| U-CB3 ① 哈希校验器 | `scripts/verify-deployed-manifest-v1.mjs` | — |
| U-CB2 验收仪器 | `scripts/accept-U-CB2-timer.mjs` + `scripts/hb-child.mjs` | — |
| 部署清单 | `deployed-manifest-v1.json` | — |
| 候选：CB1 单件 | `candidates/U-CB1/index.js.patched` | `8c7e889d7aef855fd19f5ab54da24ce1` |
| 候选：CB2 单件 | `candidates/U-CB2/index.js.patched-only-CB2` | `1287401548468c3f814ab654f7bd7c74` |
| 候选：CB1+CB2（**冷面批次目标态**） | `candidates/U-CB2/index.js.patched-CB1+CB2` | `eae532a7a7bd8c96ebd1abd9aff0f8c9` |
| 候选：CB3 db.js（U-IG3 五项） | `candidates/U-CB3/db.js.workspace-uig3-mode` | `726c0f72209db989e898caee4dae59b8` |
| 候选：CB3 db.js（full，与 deployed 逐字节同） | `candidates/U-CB3/db.js.workspace-full-mode-byte-identical-to-deployed` | `d187d44932b35a583119f6af97cd82d6` |
| 候选：③ 闸门整文件 | `candidates/U-CB3/deploy-side.sh.guarded` | `b0c22b32bab0cacd05a2a7546aba7ecb` |
| 候选：③ 闸门增量 diff | `candidates/U-CB3/deploy-side.preflight-guard.diff` | — |
| 候选：超期快照标记 | `candidates/U-CB3/SUPERSEDED-workstreams-sources.md` | — |
| 证据：deployed pre-image | `evidence/pre-image-deployed/` + `evidence/pre-image-deployed-manifest.json` | — |
| 原始 JSON | `out/*.json` | — |
| 独立 harness | `subagent-verify/`（含 `out/summary.json`） | — |
| 原始 diff | `raw/diff-workspace-vs-deployed-db.js.u.diff`、`raw/U-CB1-candidate.diff` | — |

**未做任何 deployed 写入；未触碰宿主进程；未修改任何产品文件。**
