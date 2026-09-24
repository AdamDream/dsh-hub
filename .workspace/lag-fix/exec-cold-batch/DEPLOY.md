# DEPLOY.md — U-CB1 / U-CB2 / U-CB3 冷面落地与验收

> 本批**全部冷面**（改宿主侧已部署件，须重启生效）。
> 本文档给协调者用；**deployed 写入一律由协调者执行**（执行档沙箱不可写工作区外）。
> 目录缩写 `CB=$PWD/.workspace/lag-fix/exec-cold-batch`（下文命令默认在仓库根 `/home/CNS2026495165/dsh` 下执行）。

---

## 0. 落地前

### 0.1 记下当前状态（必做）

```bash
cd /home/CNS2026495165/dsh
mkdir -p .workspace/lag-fix/exec-cold-batch/evidence
node .workspace/lag-fix/exec-cold-batch/scripts/verify-deployed-manifest-v1.mjs --json \
  | tee .workspace/lag-fix/exec-cold-batch/out/verify-pre-batch.json
# 期望：verdict = MATCH（= 与 exec-cold-batch 记录的 pre-deploy-baseline 完全一致，未被其它线改动）
# 若 MATCH 不成立 ⇒ 先查清谁动了 deployed，再决定是否继续。
```

### 0.2 干跑三件（不写任何文件）

```bash
node .workspace/lag-fix/exec-cold-batch/scripts/apply-CB1-v1.mjs            # 期望 DRY-RUN-OK
node .workspace/lag-fix/exec-cold-batch/scripts/apply-CB2-v1.mjs            # 期望 DRY-RUN-OK
node .workspace/lag-fix/exec-cold-batch/scripts/apply-CB3-v1.mjs            # 期望 DRY-RUN-OK（workspace 镜像）
node .workspace/lag-fix/exec-cold-batch/scripts/apply-CB3b-deployside-guard-v1.mjs   # 期望 DRY-RUN-OK
```
任一为 `ABORTED` ⇒ **不要继续**（fail-closed 说明锚点/前提与记录不符）。

---

## 1. 落地顺序（**不可交换**）

```
U-CB1  →  U-CB2  →  (重启)  →  验收  →  ① 哈希校验器 / ③ 闸门候选件（可同批或紧随）
```

**为什么 CB1 必须在 CB2 之前**：开 timer 后 ingest 走 `runIngest()`，**会**执行结算尾部 ⇒ **timer 会掩盖 `lastIngest` 缺陷而不是修好它**。本档已用独立 harness 实证（S4c 对照：未打补丁的 `index.js` + timer 打开时 `TIMER_TICK_ADVANCES_LASTINGEST=true`）。

### 1.1 U-CB1

```bash
node .workspace/lag-fix/exec-cold-batch/scripts/apply-CB1-v1.mjs --apply
# 期望：result=WROTE；pre-image 落在 pre-image/U-CB1/index.js
md5sum ~/.dsh/profiles/node_modules/@local/dsh-usage/lib/index.js
# 期望：8c7e889d7aef855fd19f5ab54da24ce1（CB1 单件）
```

### 1.2 U-CB2

```bash
node .workspace/lag-fix/exec-cold-batch/scripts/apply-CB2-v1.mjs --apply
md5sum ~/.dsh/profiles/node_modules/@local/dsh-usage/lib/index.js
# 期望：eae532a7a7bd8c96ebd1abd9aff0f8c9（CB1+CB2；两种顺序产出逐字节相同，已实测）
node -e 'const s=require("fs").readFileSync(process.env.HOME+"/.dsh/profiles/node_modules/@local/dsh-usage/lib/index.js","utf8");console.log("timer flag:",/const INGEST_TIMER_ENABLED = true;/.test(s),"waitIdle:",/waitIdle: \(\) => runIngest\(\),/.test(s))'
# 期望：timer flag: true waitIdle: true
```

### 1.3 U-CB3（② 只写工作区镜像；①③ 见 §4）

```bash
# 默认 = U-IG3 五项（任务书授权范围）
node .workspace/lag-fix/exec-cold-batch/scripts/apply-CB3-v1.mjs --apply
md5sum dsh-usage/lib/db.js     # 期望 726c0f72209db989e898caee4dae59b8

# 可选：--mode full 额外带上 hour 粒度，结果是**与 deployed 逐字节相同**（脚本内 md5 断言）
# node .workspace/lag-fix/exec-cold-batch/scripts/apply-CB3-v1.mjs --apply --mode full
# md5sum dsh-usage/lib/db.js   # 期望 d187d44932b35a583119f6af97cd82d6

# sources/dsh-usage-src 树：脚本**默认拒绝**（该树无 U-IG3 缺陷，反写是空操作）
node .workspace/lag-fix/exec-cold-batch/scripts/apply-CB3-v1.mjs --target workstreams   # 期望 REFUSED-BY-DESIGN (exit 3)
```

### 1.4 deployed 三件 sha 核对（重启前）

```bash
node .workspace/lag-fix/exec-cold-batch/scripts/verify-deployed-manifest-v1.mjs \
  --phase expected-after-cold-batch
# 期望：verdict = MATCH（exit 0）。唯一预期变化是 lib/index.js = eae532a7…；db.js 仍 d187d449…
```

---

## 2. 重启 → 验收

> 重启由协调者执行（本档不得重启/pkill）。重启后**先核对 sha**，再跑功能验收。

### 2.1 冷面通则（BATCH-PLAN §四）

```bash
node .workspace/lag-fix/exec-cold-batch/scripts/verify-deployed-manifest-v1.mjs --phase expected-after-cold-batch
# 期望 MATCH。回归哨兵用 listArtifacts() header 数（当前 1,209）；
# ⚠️ 不要用 session.list 当哨兵（1.30–4.47 s，重并发下 25 s 超时）。
```

### 2.2 **U-CB1 验收（核心：`lastIngest` 必须前进）**

```bash
# ① g1-live 的 advanced 谓词必须为 true（此前为 false ⇒ PRECONDITION-FAILED）
node .workspace/lag-fix/exec-ingest/tools/g1-live.mjs
# 期望输出：[verdict] lastIngest 推进=true
#          [pre]/[post] eventsDsh 应同步增长
```
判据（三条同时成立才算 PASS）：
1. `/usage/refresh` 返回 `ok:true`；
2. refresh 后 `status.lastIngest` **严格前进**（`post > pre`，且非 null）；
3. `eventsDsh` **同步增长**（证明这次是真实 pass，不是空转）。

> 附：`lastIngest` 为何此前恒为 `1790045703018`（= 2026-09-22T02:55:03Z = 本地 10:55 宿主启动那一轮）——那是 boot 路径走 `runIngestWorker` 写的唯一一次；此后只有 refresh 触发 ingest，而它绕过了结算尾部。

### 2.3 **U-CB2 验收（开启后：≥3 个 ≥60 s 心跳窗、跨 ≥2 tick、0 拍 >1000 ms）**

```bash
node .workspace/lag-fix/exec-cold-batch/scripts/accept-U-CB2-timer.mjs --windows 3 --window-ms 120000
```
- 窗口长度取 **120 s**（不是 60 s）：45 s 周期下 120 s 才能**稳定**跨 ≥2 个 tick；60 s 有可能只跨 1 个。判据用**观察到的 tick 数**（`lastIngest` 自行前进的次数，全程不调 `/usage/refresh`），不是靠假设。
- 逐窗输出 `hb n/p50/p95/max`、`>1000ms 拍数`、`observedTicks`。
- **判定**：`observedTicksTotal > 0` 且 **0 拍 > 1000 ms** 且每窗 `observedTicks ≥ 2` ⇒ `ACCEPT`（exit 0）；否则 `REJECT`（exit 2）；完全没 tick ⇒ `PRECONDITION-FAILED`（exit 3）。
- ⚠️ **必须如实标注**：G1 的**字面 `<100 ms` 阈值在本机不可判定**（静默期噪声地板 336–446 ms；本档独立复测静默 8 s×2 窗 max 297 / 223 ms，同样 >100 ms）⇒ 严格按字面只能算 **INCONCLUSIVE**。这里用 **1000 ms** 作硬回滚线，成立的是**量级判据**（亚秒 vs 修复前 2.68 s / 36.1 s）。仪器已在 timer 关闭状态下实测可用（exit 3、0 tick，与现状一致）。

### 2.4 回归面（防"顺手改坏"）

- `index.js` 里 `INGEST_VIA_WORKER`、`INGEST_INTERVAL_MS`、`ctx.inject(["timer"], …)` 安装块、dispose 接线**均未被本批改动**（脚本已机器断言；`changedCodeLines` 恰好 1 行 = 常量）。
- 并发 10 次 `/usage/refresh` 仍只触发 **1** 次 fold（G2；harness S3 已证 8 并发 = 1 次，修复前后都是 1）。
- 卸载后无残留 worker（G4）、`ingest-equiv/run-suite.sh` 全绿（G5）—— 本批未触碰这些路径，照旧跑即可。

---

## 3. 回滚

| 单元 | 触发条件 | 操作 |
|---|---|---|
| **U-CB2**（优先回滚项） | 验收观测到 **> 1000 ms 单拍**，或数据新鲜度换来可感卡顿 | `node scripts/apply-CB2-v1.mjs --rollback --apply`（常量改回 + 重启）。**不影响 U-CB1** |
| **U-CB1** | `lastIngest` 仍未前进，或出现了非预期副作用 | `node scripts/apply-CB1-v1.mjs --rollback --apply` + 重启 |
| **U-CB3 ②** | workspace 镜像改动引起任何本地问题（**不影响在产宿主**） | `node scripts/apply-CB3-v1.mjs --rollback --apply` |
| **U-CB3 ③** | 闸门误拦 | `node scripts/apply-CB3b-deployside-guard-v1.mjs --rollback --apply` |
| 全部 | 需要回到批次前 | 直接用 `evidence/pre-image-deployed/` 恢复：`cp -p evidence/pre-image-deployed/*.js ~/.dsh/profiles/node_modules/@local/dsh-usage/lib/`（index.js = `303cab97…`） |

**回滚铁律（本批专属）**：**先回 U-CB2，再回 U-CB1**（反序会让"缺陷被掩盖"的中间态重新出现，虽无害但会让验收判据失效）。回滚后重跑 §2.1 的 sha 核对，期望回到 `pre-deploy-baseline` MATCH。
三个脚本的 `--rollback` 都带**归属校验**：目标文件没有本单元的 marker 时**拒绝回滚**（已实测），所以不会误抹他线改动。

---

## 4. U-CB3 ①③ 的落地（可与本批同批，也可紧随）

### 4.1 ① 哈希校验器（推荐**每批次**都跑）

```bash
node .workspace/lag-fix/exec-cold-batch/scripts/verify-deployed-manifest-v1.mjs                       # 默认 pre-deploy-baseline
node .workspace/lag-fix/exec-cold-batch/scripts/verify-deployed-manifest-v1.mjs --phase expected-after-cold-batch
node .workspace/lag-fix/exec-cold-batch/scripts/verify-deployed-manifest-v1.mjs --mirrors             # 只看 3 棵镜像指纹
node .workspace/lag-fix/exec-cold-batch/scripts/verify-deployed-manifest-v1.mjs --json                # 机器可读
```
- 退出码：`0` = 全部匹配；`1` = **不匹配（发生了回滚或未授权改动）**；`2` = manifest/部署位不可用。
- 建议把它作为**重启后第一件事**（BATCH-PLAN §四已有"重启后 sha 必须等于预期值"的同款要求，本器把它变成一条命令）。
- 本批之后请把 `expected-after-cold-batch` 相位**晋升为新的基线**（改 `deployed-manifest-v1.json` 的 `pre-deploy-baseline.expect`）。

### 4.2 ③ `deploy-side.sh` 前置闸门（增量落地）

协调者已先行加固（默认 dry-run / `--apply` / 5 s 红字 / 未知参数 exit 2）。本档在其之上**只插入、不改一行**：

```bash
# 干跑（会先断言目标 md5 == 5aeed414d02098679b14a4de3d660fe2）
node .workspace/lag-fix/exec-cold-batch/scripts/apply-CB3b-deployside-guard-v1.mjs
# 落地
node .workspace/lag-fix/exec-cold-batch/scripts/apply-CB3b-deployside-guard-v1.mjs --apply
bash -n .workspace/workstreams/side-deploy/deploy-side.sh    # 脚本内已自动跑一次
# 期望 md5：b0c22b32bab0cacd05a2a7546aba7ecb（removed lines = 0，纯插入）
```
- 若协调者此后又改过该文件 ⇒ 脚本会因 md5 不符而 `ABORTED`（**这是设计**）：把 `EXPECTED_MD5` 更新为新的现状后重跑干跑即可。
- 说明文档：`candidates/U-CB3/deploy-side.preflight-guard.diff`（增量 diff）、`candidates/U-CB3/SUPERSEDED-workstreams-sources.md`（超期快照标记，建议放置到 `.workspace/workstreams/sources/dsh-usage-src/README-SUPERSEDED.md`）。

### 4.3 已知的同类风险（**本批未处置**，登记备查）

- `.workspace/workstreams/side-deploy/session-board/install.sh:27` `cp -r "$SCRIPT_DIR" "$FB/dsh-session-board"` —— 第三个整包部署器，目标是在产的 `@deepseek-ai/dsh-session-board`。**实测该插件 deployed 与 SRC 当前逐字节一致**（`lib/index.js=e4080047`、`package.json=ffd2f3a2`），故当前不构成回滚风险；一旦日后对 session-board 做宿主侧修复，它会变成同一类陷阱。
- `dsh-usage/scripts/install-web2.sh:76` 也 `cp -r`，但目标是**已废弃的 web2 profile**，对活跃宿主无影响。

---

## 5. 一页速查

```bash
CB=/home/CNS2026495165/dsh/.workspace/lag-fix/exec-cold-batch
# 落地
node $CB/scripts/apply-CB1-v1.mjs --apply
node $CB/scripts/apply-CB2-v1.mjs --apply
node $CB/scripts/apply-CB3-v1.mjs --apply
node $CB/scripts/verify-deployed-manifest-v1.mjs --phase expected-after-cold-batch   # 期望 MATCH
# 重启后
node $CB/scripts/verify-deployed-manifest-v1.mjs --phase expected-after-cold-batch   # 期望 MATCH
node /home/CNS2026495165/dsh/.workspace/lag-fix/exec-ingest/tools/g1-live.mjs        # 期望 lastIngest 推进=true
node $CB/scripts/accept-U-CB2-timer.mjs --windows 3 --window-ms 120000              # 期望 ACCEPT
# 回滚（先 CB2 后 CB1）
node $CB/scripts/apply-CB2-v1.mjs --rollback --apply
node $CB/scripts/apply-CB1-v1.mjs --rollback --apply
```
