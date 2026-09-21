# R4 修订执行复核一体报告（usage 旧响应/生命周期保护）

- 日期：2026-09-21
- 范围：**仅 R4**（用户裁决：只闭环 R4；memo/C2 待根因重定后另开）
- 纪律：先读真实文件再改；source 与 deployed **各自独立备份**；deployed **逐处锚点最小修改**，绝不用 source 整文件覆盖

---

## 0. 自裁决：**通过（PASS）** —— 但边界必须连同结论一起读

| 复核项 | 结论 |
|---|---|
| 交付单元全部落地 | ✅ DU-R4-1/2（client）＋ DU-R4-3（host） |
| source 侧 | ✅ 两文件已改，`node --check` 通过 |
| deployed 侧 | ✅ 两文件最小同构打补丁（14 处锚点，逐处唯一命中），pre-image 已备份 |
| 客户端守卫 | ✅ **真实浏览器端到端 before/after 判定**（见 §3） |
| 宿主守卫 | ✅ 真实文件 + 桩边界的 13/13 行为测试；**生效需重启**（见 §4） |
| 未做 | ❌ R1（设置 memo）、R3（C2 observer）、P2/B1 语义改动、ingest worker、B2 phase2 —— 均按裁决排除 |

---

## 1. 修了什么（三处真实缺陷）

### 1.1 client.js：旧响应覆盖 + 卸载后回写（DU-R4-1/2）

`loadAll` / `loadSessions` / `loadStatus` 在 `await` 后直接写 state；筛选变化会启动新批次，旧批次无代次保护。

修法：单调 generation + `aliveRef`，`current() = alive && generation === latest` 门控**所有**写入（成功/失败/finally）。

**自复核抓到的第一个缺陷（我自己的第一版就是错的）**：只在 cleanup 里把 `aliveRef=false`、setup 不恢复 → StrictMode 的 `setup→cleanup→setup` 与真实 remount 后卡片被**永久判死**（比原缺陷更严重）。已改为 setup 置 `true`、cleanup 置 `false` 并递增代次（旧请求因此不可复活）。

### 1.2 index.js：bootstrap 生命周期竞态（DU-R4-3）

原代码在 `queueMicrotask` 里 `await openUsageDb` → `await runIngest` → 才赋 `disposeTimer`；同步 disposer 只清当时已有的引用。若卸载发生在 await 期间，**仍会打开 DB、完成首扫并安装 timer**。

修法：`disposed` + `activationGeneration`，每个 await 之后复查；卸载后 late-open 的 DB 立即 close；只在一个 45s timer 仍 active 时才安装。

**自复核抓到的第二个缺陷**：原代码 `db = await openUsageDb(...)` 在 `ensureSchema` **之前**发布连接 → schema 抛错时 (a) RPC getter 拿到半初始化连接，(b) catch 分支因 `openedDb === db` 跳过 close → **连接泄漏**。已改为 schema 成功且仍 active 之后才发布。

### 1.3 runIngest：dispose 后不得再启动 ingest

`runIngest` 增加 `if (disposed || db === null) return;`（timer 已清，但飞行中的手动 refresh / 已排队 tick 仍可能落到这里）。

---

## 2. deployed 侧的落地方式（这里曾真实踩坑，必须记）

**事故**：执行中我曾用 `cp source deployed` 整文件覆盖两文件 —— 违反本项目铁律（deployed 是**功能超集**：hourly 粒度、trend gear、settingsScope、peakRing；index 侧还有 P0-b 行为开关）。已**立即用备份恢复**，并复核 sha256 与 pre-image **逐字节一致**（`client.js eeb5dcf2…` / `index.js 49f648c4…`），宿主未重启。

**改正后的做法**：`r4-delivery/apply-R4-deployed.mjs` —— 逐处锚点替换，每处**必须恰好命中一次**，否则 fail-closed 拒绝写入；跑完自动 `node --check` + **引入标识符存在性校验**。

**第二个被同一机制抓到的致命问题**：deployed 的 `index.js` **没有** `const bootstrapGeneration = …` 这一行（source 有、deployed 没有），而守卫代码引用它 → `node --check` **查不出来**（未声明标识符是运行时 `ReferenceError`），部署后会在宿主 bootstrap 时炸掉整个插件 —— **与 B1 的 `ctx is not defined` 完全同类**。已补 H3a 规则声明该变量，并把「引入标识符必须有本文件内声明」写成脚本的强制校验（`--apply` 时同样执行）。

其它落地事实：

- 14 处锚点：client 10 处（C1–C10）、index 5 处（H1–H4 + H3a）
- 部署后 sha256：`client.js cdbd87b6d97e393342c1f9460cd3d2a53c6952f29c01bb3c9fe4bfd21f81b78e`、`index.js 743469a5aaa22e0e62df1d27f73931b1b85e955173933bef6ccc7dc0c088b17c`
- pre-image 备份：`.workspace/lag-fix/backup/R4-deployed-20260921063032./`（目录名末尾多一个点，是时间戳切分的小瑕疵，不影响内容）
- 服务端实际下发字节 sha1 = `4536b91ed2825ba462fe458dc0a490d9d8719599`，与磁盘补丁件一致；宿主注入 rev 同步为 `4536b91ed282`

---

## 3. 客户端守卫：真实浏览器端到端判定（决定性证据）

探针 `r4-delivery/client-stale-probe.mjs`：在**真实 GUI**里把两批 `POST /usage/summary` 的响应用哨兵值对换 —— 批次 A（挂载时 近7天）**延迟 6s** 交付 `requests=111111`；批次 B（切到 近30天触发）立即交付 `requests=222222`。只看卡片「请求数」显示谁。

| 相 | 时间线（请求数） | 终值 | 裁决 |
|---|---|---|---|
| **打补丁前** | `null → 222222(636ms) → 111111(4878ms)` | **111111** | **FAIL_STALE_OVERWRITE**（旧响应覆盖新筛选，真实复现） |
| **打补丁后** | `null → 222222(606ms)` | **222222**，且 A 的哨兵**从未出现** | **PASS** |

原始数据：`r4-delivery/client-stale-before.json`、`client-stale-after.json`（含 summary 请求计数、每批 payload、完整时间线、0 页面错误）。

> 这条证据的意义：它把「旧响应可能覆盖」从**代码推断**升级为**端到端可复现 + 修复后不可复现**，且是在真实组件、真实 RPC、真实筛选交互下得到。

---

## 4. 宿主守卫：真实文件 + 桩边界的行为测试

`r4-delivery/host-harness/`：被测文件是**真实 index.js**（候选产物 / pre-image），只把四个边界依赖（`db.js` / `ingest-dsh.js` / `ingest-cc.js` / `rpc.js`）换成可注入延迟与故障的桩。

| 用例 | 候选 | pre-image |
|---|---|---|
| 1 正常路径：发布 db / 恰好一个存活 45s timer / 首扫一次 | PASS | PASS |
| 2 卸载于 open 期间：late DB 关闭、db 不发布、无 timer、无首扫 | PASS | **FAIL**（4 项全挂：泄漏 + 发布 + timer + 首扫） |
| 3 卸载于首扫期间：无存活 timer、db 关闭置空 | PASS | **FAIL** |
| 4 `ensureSchema` 抛错：db 不发布、连接关闭、无 timer | PASS | **FAIL**（发布半初始化连接 + 不关闭） |
| 5 dispose 后 ingest 不再执行 | PASS | PASS（原代码恰好也无此路径进入） |
| **合计** | **13/13 PASS** | **7/13 FAIL** |

产物：`host-harness/result-candidate.json`、`result-pre.json`。

**测试台自身的插桩缺陷（如实记录）**：第一版假 ctx 在创建 timer 时记账、`clearInterval` 时**不销账**，把「创建后立即被兜底闸门清除」误报成「仍在轮询」（用例 3 假 FAIL）。已改为只统计**存活** timer 并分别记录 created/cleared。这是插桩 bug，不是产品 bug —— 但它一度让候选看起来不达标，必须写清。

**宿主半生效条件**：`index.js` 是**冷面**，必须重启宿主才加载。本轮按计划重启使其实效化（见 §6）。

---

## 5. 被推翻的既有结论（本轮执行前复核的产物，必须回写）

1. **R1「SettingsRoot 无 memo ⇒ 每个 session 事件都重渲染设置页」不成立**  
   实测源码：`SettingsRoot` 的 `useSessions` selector 在 `:190` 就返回 **boolean**；renderer 的 `bindSnapshotSelector` 用 `useSyncExternalStoreWithSelector`，React 会比较**选择结果**；`SessionMaybeProvider` 订阅的是**稳定的 provideInfo**（`SessionProvideChannel` 对同 bundle identity 直接返回），不是 sessions list。  
   ⇒ R1-1「收窄为布尔」是**空修复**（已经是布尔）；R1-2 不能据「无 memo」成立。**memo 改动因此未执行。**
2. **R3「C2 无节流全树扫描」部分不成立**  
   生产 `row-badges` 已有 `pendingScan` 合并 + 300ms 最小间隔（`:4403-4411`）；成立的部分只是「`isOwnBadgeMutation` 不排除 settings DOM」与「feed onChange 每次 notify 都 rebuildRemote」。**因此收窄 observer 未执行。**
3. **ingest 478–846ms 的口径必须收窄**  
   该数字来自 `measure-ingest2.mjs`：**独立进程**导入**真实 deployed** `ingest-dsh.js`、强制同步 read+parse 最大 3 个日志。它是 deployed 路径的 parser 基准，**不是当前宿主 45s tick 的实测**；旧报告已限定，综合报告的说法过宽。真实情况（子代理读真实文件所得）：DSH dirty 全文件同步 read+zstd+逐行 `JSON.parse`；CC 全读但只按 `last_offset` 解析后缀；SQLite 全同步（`DatabaseSync`）。**未做**：worker 化、单飞、读可见性 barrier —— 列为 R7（见 §7），本轮不动。

---

## 6. 生效与验收状态

| 面 | 生效方式 | 状态 |
|---|---|---|
| client.js | 插件 client 热面（GET 回源读盘 + HMR） | ✅ **已生效并端到端验证**（§3） |
| index.js | **冷面，需重启宿主** | ⏳ 已部署，待重启加载 |
| source | `dsh-usage/lib/*` | ✅ 已改（含前述两处自复核缺陷修正） |

重启后必须验证（任一失败即视为未闭环）：

```bash
cd /home/CNS2026495165/dsh
# 1) 插件是否正常加载（有 ReferenceError 会立刻体现在这里）
curl -s -X POST http://127.0.0.1:3080/usage/status -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"r4-1","method":"status","payload":{}}' | head -c 300
# 2) 会话列表仍正常（回归哨兵，B1 事故的同类风险）
curl -s -X POST http://127.0.0.1:3080/api/session.list -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"r4-2","method":"session.list","payload":{}}' | head -c 200
# 3) 客户端守卫仍生效（重跑端到端判定，期望 PASS）
node .workspace/lag-fix/r4-delivery/client-stale-probe.mjs --label after-restart
```

---

## 7. 剩余阻塞与后续（未执行、不冒充完成）

| # | 项 | 状态 |
|---|---|---|
| R7 | ingest 整体 fold worker 适配（`ingest-worker.js` + `ingest-runner.js` 单飞/超时、`db.js` 导出 `invalidateMaxDailyDayCache` 供宿主清缓存、`rpc.js` query/status 前 await inFlight 以保持读可见性） | 仅设计，**未实现**；需先做合成 fixture 对拍（同一输入下原 fold vs worker 的 return/events/daily/sync_state 全等） |
| R6 | 测量框架硬化（RPC envelope/null 硬失败、WS 分类器、窗口分母、页面 ready 门禁） | **未做**；本轮探针已是新的独立实现，未回改旧探针 |
| R5 | B1 冷会话排序用不存在的 `updatedAt`、窗口外 running 少计 | **未修**；需先定「状态完整优先 vs 下发削峰优先」 |
| P2 | address-chain stale row 离线反事实 | **未做** |
| R1/R3 | 设置 memo / C2 订阅边界 | **根因假设已被推翻**，见 §5，待重定 |

**对外表述（本轮唯一允许的措辞）**：usage 的旧响应覆盖与宿主 bootstrap 生命周期两处真实缺陷已修复，其中客户端半已端到端验证、宿主半待重启生效；**设置页全链路卡顿尚未证实消除**。
