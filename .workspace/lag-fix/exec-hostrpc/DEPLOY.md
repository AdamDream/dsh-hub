# DEPLOY：HostRPC-v1（U-HR1 memo · U-HR2 signal · U-HR3 去重复折叠 · U-HR4 有界并发）

> **状态：写入已完成（由协调者于 2026-09-22 15:54:12 执行，哈希与本档候选件逐字节相符）。**
> **剩余动作 = 一次冷面重启 + 重启后验收。** 本档未重启、未发任何信号。
> 全部路径以 `.workspace/lag-fix/exec-hostrpc/` 为工作目录（下称 `$EXEC`）；
> 目标包根 `$PKG = /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`。

---

## 0. 一页速览

| 项 | 值 |
|---|---|
| 单元 | **U-HR1**（persistence memo）、**U-HR4**（persistence 冷扫有界并发）、**U-HR2**（apiproxy signal，**2 处**）、**U-HR3**（apiproxy 去重复折叠） |
| 面 | **全部冷面**（两个文件都要重启宿主才生效；无热面部分） |
| 写入 | **已完成**：persistence `4c7059e7…`（U-HR1+U-HR4）、apiproxy `a6fe1ae9…`（U-HR2+U-HR3） |
| pre-image | persistence `8b6ebc45…97f3`、apiproxy `0d96607e…38cfc4`（`pre-image/` 内已存逐字节副本） |
| 剩余 | **重启宿主** → 跑 `verify-postdeploy.mjs` |
| 回滚 | `node apply-HostRPC-v1.mjs --rollback all`（或 `--rollback U-HR1,U-HR4` / `--rollback U-HR2,U-HR3`）；**按文件回滚** |
| 可选降级 | `--rollback all` 后 `--apply --skip U-HR4`（或 `--skip U-HR3`）可精确卸掉单个可选单元 |

**四条硬提醒**
1. **不要再跑 `--apply`**：脚本会报 `ALREADY-PATCHED` 并**不写任何文件**（幂等）。要重新落地请先 `--rollback all`。
2. **U-HR2 是 2 处**（路由表 `UNARY_ROUTES` + handler），只落 handler 是死代码。已按 2 处落地。
3. **测并发矩阵前必须先"预热"一次 `session.list`**（`verify-postdeploy.mjs` 已内置）。memo 尚冷的并发突发仍会各自全扫一次 —— 这是为保住"每调用者独立取消语义"而做的**有意**取舍（`report.md` §九.12）。
4. **判据以绝对量为主**：本轮已实测证明"比值判据会误判通过"（修复前拥塞时 4路/单发 = 1.14× 而绝对量 15.4 s）⇒ 见 §3.3。

---

## 1. 重启前：确认写入完好（只读，约 5 秒）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-hostrpc

# 1.1 哈希必须是本档候选件
sha256sum $PKG/dsh-session-persistence-jsonl/lib/index.js $PKG/dsh-host-apiproxy/lib/index.js
#   期望 persistence 4c7059e7b1b4d6d3ceb4252efe49c201e2f47392d26d103f152af3097dab8aa8
#        apiproxy    a6fe1ae90e8e14ad45d799656b058a2c969161c29db5506cc63cf4ca4dd35836

# 1.2 marker 计数（既有补丁必须原样保留）
grep -c "dsh-lag-fix B1"          $PKG/dsh-host-apiproxy/lib/index.js            # 期望 5
grep -c "dsh-lag-fix B1-perf v1"  $PKG/dsh-host-apiproxy/lib/index.js            # 期望 1
grep -c "dsh-lag-fix HR1"         $PKG/dsh-session-persistence-jsonl/lib/index.js # 期望 2
grep -c "dsh-lag-fix HR4"         $PKG/dsh-session-persistence-jsonl/lib/index.js # 期望 2
grep -c "dsh-lag-fix HR2"         $PKG/dsh-host-apiproxy/lib/index.js            # 期望 2
grep -c "dsh-lag-fix HR3"         $PKG/dsh-host-apiproxy/lib/index.js            # 期望 3

# 1.3 dry-run：应当全部 ALREADY-PATCHED，且不写任何文件
node apply-HostRPC-v1.mjs
# 期望：两个文件均 ALREADY-PATCHED / "未写任何文件"
```

任一项不符 ⇒ **先回滚再排查**（§4），不要叠加修改。

---

## 2. 重启宿主（协调者执行）

U-HR1–U-HR4 全为**冷面**：两文件已加载进内存，必须重启 `dsh web` 宿主进程（PID 301709，启动于 10:54:59）才生效。
可与本批其它冷面修复**一次重启合并**（见 §6）。

重启后立刻复核（最便宜的"本批是否真的生效"哨兵）：
```bash
grep -c "dsh-lag-fix HR1" $PKG/dsh-session-persistence-jsonl/lib/index.js   # 期望 2
```
> 注意：marker 计数读的是**磁盘文件**，与"进程内是否新代码"无关；真正的进程内证据是 §3 的 C7（它会在部署文件上构造实例并断言 memo 行为）。

---

## 3. 重启后验收（**必须**用这套，不要用单点 TTFB）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-hostrpc

# 3.0 冒烟（先确认脚本可用；推荐）
node scripts/verify-postdeploy.mjs --singles 3 --waves 1

# 3.1 完整验收
node scripts/verify-postdeploy.mjs --singles 20 --waves 5
#   输出 raw/verify-postdeploy.json，逐项 PASS/FAIL；退出码 0 = 全 PASS
```

脚本行为：先取共享探针锁（`.workspace/lag-fix/lib/probe-lock.mjs`）——**锁被占即 `exit 4` 退出，绝不回收他人锁**；
取不到锁时可等待重试，或在确认无兄弟线占用浏览器/探针时用 `--skip-lock`（本轮即在协调者授权下并发运行，
并在 JSON 里记录 `concurrentWith=` 与 `loadavg`）。它只做 HTTP RPC + 读两个产品文件 + 进程内参考扫描，不写产品文件、不发信号。

### 3.1 七项判据（`raw/verify-postdeploy.json → checks`）

| ID | 判据 | 阈值 | 说明 |
|---|---|---|---|
| **C1** | 单发 `session.list` TTFB p50（N=20） | **≤ 150 ms** | 审计 F1 验收 |
| **C2** | 并发矩阵 A-B-A：4 路并发 TTFB p50 | **≤ 单发 × 1.2**（**同时必须看绝对量**） | 见 §3.3 校准 |
| **C3** | 取消传播反事实：**3 路并发** abort @200 ms，其后 1 s 的 `host.describe` p50 | **≤ 5 ms** | 附带 `stillInFlightAtAbortMs200` / `discriminates`：若为 0 说明请求在 abort 前已跑完，**该次 PASS 不具判别力** |
| **C4** | 集合等式：宿主逐行身份字段 == 进程内冷扫描（漂移已分类） | 语义错配 = 0 | 身份字段 = `cwd/origin/parentSessionId/agentPreset`（**wire 上没有 `createdAt`**） |
| **C4b** | 投影键均为已注册单元；subagent 行 ≤200；顶层行 ≥99 | 见左 | 投影键集**逐行可以不同**（fail-soft 设计），故只验"⊂ 13 单元" |
| **C5** | 回归哨兵：`listArtifacts()` header 数 == 真实会话目录数 | 相等 | **不用 `session.list` 当哨兵**（BATCH-PLAN §四） |
| **C6** | 既有标记原样 + HR1–HR4 标记就位 + 两文件 sha256 | B1=5 / B1-perf=1 / HR1=2 / HR2=2 / HR3=3 / HR4=2 | 硬性验收 #5 |
| **C7** | 跳数断言：**部署文件本体**上 memo 命中的 per-session IO；且冷扫描工作量不随并发度变化 | **perSessionIO == 0**，`awaitsWorkConc1 == awaitsWorkConc4` | 硬性验收（追加单元 ③）；同时给出 `coldMsConc1 / coldMsConc4` 的加速比 |

### 3.2 C4 的"漂移"读法（重要）

本 campaign 在**持续创建会话**，因此"进程内冷扫描"与"宿主取样"相隔毫秒就可能**合法地**不一致（某会话日志尚未落盘）。
C4 因此最多重试 4 轮，并把差异**分类**：

- `classification: "clean round"` —— 某轮完全一致（最好）；
- `classification: "id-set drift only …"` —— **零字段错配**，只是两次取样之间的 id 集合在动（判 PASS）；
- `classification: "SEMANTIC MISMATCH"` —— **同一 sessionId 的身份字段不同**（判 FAIL，这才是真问题）。

⇒ 读 C4 时**先看 `identityFieldMismatches` 与 `classification`**，不要只看布尔值。

### 3.3 ⚠️ 判据校准：C2 的比值判据会**误判通过**

本轮实测反证（**重启前**那次 live 跑，旧代码，loadavg 7.7–12）：

| 观测 | 值 |
|---|---|
| 单发 `session.list` p50 | **13 486 ms**（复现 32 780 ms 那次更差） |
| 4 路并发 p50 | **15 400 ms** |
| 比值 | **1.14 ⇒ 按"≤1.2"读作 PASS** |

也就是说：**修复前的灾难状态下，比值判据给出"通过"**。原因是此时单发本身已被积压拖到与并发同量级，比值失去分辨力。

⇒ **推荐判据（绝对量为主）**：
- `4 路并发 p50 ≤ 150 ms`；
- `4 路并发 max ≤ 300 ms`；
- 比值与 `loadavg` / 外部浏览器主进程数**照报，用于解释而非判死**。

`C2` 的 detail 已同时给出 `singleBaselineP50 / concurrentP50 / ratio / concurrentMax`，两种口径都能读。

参照：本轮取得的**重启前基线**（`raw/verify-prerestart.json`）单发 p50 **12 960 ms**、4 路 **15 400 ms**；
重启后同窗口对比即可。

### 3.4 追加单元 ①/③ 的专属验证

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-hostrpc

# ① 上限只挡行、不挡扫描：扫描产出的 artifact 数应远大于下发上限
python3 -c "
import json; c=json.load(open('raw/verify-postdeploy.json'))
eq=c['raw']['equality']; print('coldArtifacts =', eq['coldArtifacts'], '| servedB =', eq['servedB'],
  '| topLevel =', eq['topLevelServedB'], '| subagent =', eq['servedB']-eq['topLevelServedB'])"
# 期望（2026-09-22 16:1x 口径）：coldArtifacts ≈ 1367、servedB = 300 = 100 顶层 + 200 subagent
#   ⇒ 约 1067 条（78%+）被扫但永不下发。修复后这部分成本已被 memo 吸收（C7 已断言为 0）。

# ③ 跳数（受控根精确斜率；自建受控根，不碰 live）
bash scripts/hop-count.sh
python3 -c "
import json; d=json.load(open('raw/hop-count.json'))
print(json.dumps(d['perSessionDirectorySlope'], indent=1))"
# 期望：candidate-warm 全部 per-session 斜率 = 0.00；preimage-cold 15.25 syscall / 8.94 轮次；
#       candidate-cold 8.44 syscall / 2.25 轮次

# U-HR4 剂量-响应（真实 root，6 臂轮转 + 工作不变性断言）
node scripts/scan-concurrency-sweep.mjs --reps 8
# 期望：preimage ≈197 ms → conc=4 ≈69 ms（2.85×）；awaits/syscalls 六臂全等
```

### 3.5 GUI 侧确认（主观，可选）

刷新 `http://127.0.0.1:3080/`：侧栏会话行应**不再出现"静默空白"**，且在多线并发开浏览器（本 campaign 常态）时仍能出内容。
这是 w08 点名的用户可见症状。

---

## 4. 回滚

**本批的写入由协调者的流程完成，未经本工具登记 pre-image**（`pre-image/applied/index.json` 是空的）
⇒ 回滚请用 **`--from-preimage`** 路径（它不需要索引记录，但有严格守卫）：

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-hostrpc

node apply-HostRPC-v1.mjs --rollback all --from-preimage          # 两文件都还原到 pre-image
node apply-HostRPC-v1.mjs --rollback U-HR1,U-HR4 --from-preimage  # 只还原 persistence
node apply-HostRPC-v1.mjs --rollback U-HR2,U-HR3 --from-preimage  # 只还原 apiproxy

# 只卸掉可选单元（保留其余）：
node apply-HostRPC-v1.mjs --rollback all --from-preimage
node apply-HostRPC-v1.mjs --apply --skip U-HR4         # = 只落 U-HR1（得到 1b3185c7…）
# 或
node apply-HostRPC-v1.mjs --rollback all --from-preimage
node apply-HostRPC-v1.mjs --apply --skip U-HR3         # = 落 U-HR1+U-HR2+U-HR4
```

**`--from-preimage` 的守卫（已实测）**：只有当目标文件的**当前内容** sha256 **恰好等于本计划对该文件的输出**时才覆盖；
否则**拒绝并退出 7**，且**其余文件一律不动**。已实测两种情形：
① 目标持有本档候选件（`4c7059e7…`/`a6fe1ae9…`，即当前 live 状态）⇒ 回滚成功，两文件回到 `8b6ebc45…`/`0d96607e…`；
② 目标被第三方追加了一行 ⇒ `exit 7` + 明确拒绝，另一个文件未被触碰。
⇒ 这个开关**不可能**误盖无关改动。

若写入是由本工具 `--apply` 完成的，则用不带 `--from-preimage` 的 `--rollback`（走索引记录，同样校验备份自身 sha256）。

- 回滚源 = `--from-preimage` 走 `pre-image/<fileKey>__lib__index.js`（逐字节 pre-image 副本）；
  不带该开关时走"最近一次 `--apply` 登记的 pre-image"（`pre-image/applied/<stamp>/<fileKey>/index.js`），
  两者都会校验来源自身 sha256，并**按记录/推导出的真实目标路径**还原（绝不按 `--root` 重算）。
- **回滚同样需要重启**才生效（冷面）。
- 手工回滚（等价）：把 `pre-image/dsh-*.js` 覆盖回 `$PKG` 下对应路径。
- 回滚后复核：`grep -c "dsh-lag-fix HR" $PKG/...` 应为 **0**；`dsh-lag-fix B1` 应仍为 **5**。
- **回滚判据（建议）**：若 **C4（语义错配）/ C5 / C6 / C7** 任一 FAIL ⇒ **立即回滚并上报**
  （那意味着集合等式或既有补丁受影响，属停止条件）；若仅 C1/C2/C3 未达标 ⇒ 不回滚，
  先把 `raw/verify-postdeploy.json` + `loadavg` 报回协调者裁决。

---

## 5. 已知边界（部署/验收前请读）

| # | 边界 | 影响 | 处置 |
|---|---|---|---|
| 1 | **冷 memo 的并发突发仍各自全扫**（未做 single-flight） | 重启后立刻打并发矩阵、且**不预热**时会看到与修复前相同的形状 | 测量前预热一次（脚本已内置）；这是为保住"每调用者独立取消"语义的有意取舍 |
| 2 | **memo 命中不再逐目录做 opposite-compression 检查** | 极端情况下（事后在已缓存目录旁放 opposite 文件）`list()` 不报 `encodingMismatch` | 根级同一检查本来就是"每实例一次"，本改动只让口径一致；代码中不存在产生该情形的路径 |
| 3 | **U-HR3 的快照时刻** | subagent 行的 `updatedAt/blank/lastPromptAt` 取自"请求开始时刻"；若请求在飞期间该会话追加事件，取值比修复前略早 | 冻结输入下逐行等值已证（`raw/fold-dedupe.json` P1 10/10）；若要求逐字节等同 pre-image，则 `--skip U-HR3`（代价：重会话每请求多 ~16.8 ms 折叠） |
| 4 | **U-HR4 在出错路径上多做 I/O** | 抛错前已为后续目录付过 I/O（只读、无副作用）；抛错内容与顺序不变 | 已文档化；如需回退用 `--skip U-HR4` |
| 5 | **C2 比值判据** | 见 §3.3（实测会误判通过） | 以绝对量为主判断 |
| 6 | **C4 会因会话持续创建而出现 id 集合漂移** | 见 §3.2 | 按 `classification` 读，不只看布尔值 |
| 7 | 未测 | 宿主侧实测需重启；客户端消费 505 KB 的渲染成本未测（w08 同一空缺） | — |

---

## 6. 与既有冷面批次的合并

四个单元都是**冷面**，与协调者正在攒的冷面批次**可一次重启合并**。合并时注意：

- 本批**只碰 2 个文件**（`dsh-session-persistence-jsonl/lib/index.js`、`dsh-host-apiproxy/lib/index.js`），且**已写入**。
  若批次内**其他线也要改这两个文件**，请**串行化**：先确认本批 marker 计数（§1.2）→ 再落他批 → 落完用
  `node apply-HostRPC-v1.mjs`（dry-run）确认本批仍报 `ALREADY-PATCHED` 而非 `PARTIAL`。
  若报 `PARTIAL`，说明本批被覆盖，需按 §4 处置。
- 本批的分文件回滚依赖 `pre-image/applied/index.json`；**请勿在他批的部署脚本里清理该目录**。
  注意：该索引当前为**空**（本批写入未经本工具登记）⇒ 回滚请用 §4 的 **`--from-preimage`** 路径。
- 重启后**先跑 §1.2 的 marker 计数**，再跑 §3.1 的验收（marker 计数是最便宜的"本批是否还在"哨兵）。
