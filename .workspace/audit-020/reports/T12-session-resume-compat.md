# T12 — 会话恢复 / 冷恢复 / 复述与投影链在 0.2.0 的变化

- 轨道：T12（审计阶段，只读；不改产品代码）
- 采样时刻：2026-09-29（当轮实测，全部命令与哈希见 §2 与附录 A）
- 目标版本：`0.2.0-rc.1`（`SESSION_FORMAT_VERSION = 4`）
- 对照基线：`0.1.7-rc.2`（全量安装树）、`0.1.1-rc.2`（现役 3080 安装树，只读）
- 硬约束遵守情况：仅写 `.workspace/**`；未启动任何监听端口的服务；**全程零模型请求**；未抄录任何会话正文；报告中不含原始会话 id、密钥、正文

---

## 1. 结论摘要

**一句话回答「迁移后老会话还能不能正常继续」：能继续，且比预期更安全 —— 但"能继续"的门槛由"格式迁移链是否放行"决定，而不是由"投影能否重建"决定；在本机现有语料上，迁移链**全部放行**，判为"需迁移（自动、一次性、不可逆地新增 v4 代）"，无"会失败"项。**

### 1.1 三条最重要的发现

**F1｜真正的恢复契约是 `ctx.agents.resume()`，`ctx.sessions` 按设计没有 resume/reopen/load —— 且只有 write 分支会触发迁移**
`dsh-session` 的 `SessionStore` 公开面只有 `create/prepare/enter/announce/flush/get/list/fork` + 消息投影注册，**没有任何 resume/reopen/load/adopt**。唯一公开恢复入口是 `dsh-agent` 的 `ctx.agents.resume({resumeSessionId,…})`，它经 `requireFactory()` 委派给 agent factory（实现包为 `dsh-agent-loop`，**不在本次解包树内**，记为未验证项 U2/U3）。
后端侧的决定性事实：`jsonl` persistence 的 `open(id, access)` 两个分支行为**完全不同** ——
- `read` 分支：`requireStoredLog` → 返回 `prepared` 的 handle，**不** `claimWrite`、**不** `acquireLease`、**不** `publishStoredMigration`；
- `write` 分支：`claimWrite(id)` → `findLog` → `acquireLease` → `requireStoredLog` → **`publishStoredMigration(id, prepared)`**（仅当 `prepared.status === 'prepared'`，即源代低于当前格式时才发布）。
  ⇒ **`0.2.0` 对 v0/v3 老日志的"迁移 → 发布 v4 继任代"只在 agent 级 write open 时发生。** 因此"用 `open(id,'read')` 能读通"**不能**作为"老会话可冷恢复"的判据（这正是历史误判 `D-01` 的机理，本轮在代码层独立复现）。

**F2｜迁移链在事件词汇表上对全部 2455 份 v0 老日志完全闭合 —— 零拒绝项**
`dsh-session-format-v0-to-v1` 的 alpha 边采用**封闭首要方清单**（`RELEASED_V0_EVENT_DISPOSITIONS`，51 项），"refuses every event type outside its frozen inventory, **including an unknown event marked `ignorable: true`**"。本轮对现役 0.1.1 根全部 v0 日志做了逐帧结构扫描（1459185 个 zstd 帧，逐帧解码）：
- 2455 份 v0 日志共出现 **42** 种事件类型；去掉 3 种由 v0 物理编解码器拥有的打包行标签（`text-chunks`/`reasoning-chunks`/`tool-call-chunks`，见 `PACKED_TAGS`）后，**落在清单之外的类型 = 0（空集）**；
- 唯一不在 v0 清单内的 2 个类型（`system/message`、`assistant/attempt`）**只出现在 3 份 v3 日志里，v0 日志中 0 次出现**（按代际拆分后确认）。
- 全部 v0 日志的表头 `version` 均为 `0`，与文件名无语义冲突（命名规则：无版本后缀 = v0）。

**F3｜本机已有 0.1.7 实例完成 v3→v4 `write open` 并发布继任代的真实工件证据**
现役 0.1.1 根：`version:0` 共 **2452** 份、`version:3` 共 **3** 份；对照 0.1.7 根：**仅**存在 `v3`(11) / `v4`(8) 代工件，无 v0。其中 **8 个会话目录含 v4 代**、**2 个目录同时含 v3 与 v4 两代**，且 v4 文件 mtime 晚于 v3、体积略大（例：v3=552482 B @ 09-12 → v4=553032 B @ 09-28），`session.lock` 恰为 8 个（与 v4 代目录数一致）。这**实证**了"源代字节不变 + 无覆盖发布继任代"的机制在真实链路上跑通。

### 1.2 影响判定汇总

| 判定 | 数量 | 说明 |
|---|---|---|
| 无影响 | 6 | 投影/查询/引用/格式编解码/待办/附件等包**逐字节等同** |
| 需迁移 | 3 | 会话日志本体（由 0.2.0 自动迁移 v0→v4）、投影缓存跨格式代失效、`dsh-session-log-deepseek` 配置读取时机 |
| 会失败 | 0 | 本轮语料与源码链路上**未发现**必然失败项 |

### 1.3 最重要的退化（非失败，但必须记账）

**老会话的投影缓存（`session_projcache`）在迁移后一律作废、冷重算**：缓存记录的身份含 `formatVersion`，而 `identityMatches` 要求 `stored.formatVersion === expected.formatVersion`；老会话的缓存行盖的是 **v0** 戳，迁移后会话头变 **v4**，故**永不匹配**（只有 listing 专用的 `cachedPredecessorTitle` 跨代放行 title 行）。后果是**会话列表/统计的首屏变慢（全量冷重放），不是数据错误** —— README 明确"a missing or older `formatVersion` never matches a current Session and therefore cannot seed hydration"。同时 `stateVersion` 在本对版本间**无一变更**，所以不存在"缓存被误当成新语义沿用"的反向风险。

---

## 2. 证据（源码行号 + 当轮命令）

### 2.1 基线与"解包缺口"更正（重要）

任务给的 0.1.7 基座 `src-017` 是**不完整解包**：它缺少 `dsh-session-checkpoint-policy` 与 `dsh-session-reference`。若照此对比会得出"0.2.0 新增两个包"的**假结论**。本轮改用 0.1.7 的**全量安装树**作基线并逐字节复核：

```bash
A=~/.npm-global-dsh017/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai   # 0.1.7 全量
B=.workspace/audit-020/src-020/node_modules/@deepseek-ai                              # 0.2.0 子集
# checkpoint-policy / reference 在两个版本均存在，且逐字节相同
node -p "require('$A/dsh-session-checkpoint-policy/package.json').version"   # → 0.1.7-rc.2
sha256sum $A/dsh-session-checkpoint-policy/lib/index.js $B/.../lib/index.js # → 同一 80a4475d…
sha256sum $A/dsh-session-reference/lib/index.js         $B/.../lib/index.js # → 同一 62dde13e…
```

> 更正结论：`dsh-session-checkpoint-policy`、`dsh-session-reference`、`dsh-session-projection-cache` 在 **0.1.1-rc.2 / 0.1.7-rc.2 / 0.2.0-rc.1 三个版本都存在**。`src-020` 中"缺失"的包（如 `dsh-goal`、`dsh-agent-loop`、`dsh-command-goal`）同样是**解包子集**所致，**不得**读作"0.2.0 移除"。

### 2.2 逐文件哈希差异矩阵（0.1.7 → 0.2.0）

对每个包按 `lib/**`（`.js` 与 `.d.ts` 分列）做全文件 sha256 对比：

| 包 | js | d.ts | README | 判定 |
|---|---|---|---|---|
| `dsh-session-projection` | 全部相同 | 全部相同 | 相同 | **无影响** |
| `dsh-session-query` | 全部相同 | 全部相同 | 相同 | **无影响** |
| `dsh-session-reference` | 仅 `typert.host.js` 不同 | 相同 | 相同 | **无影响**（见 2.4） |
| `dsh-session-checkpoint-policy` | 相同 | — | 相同 | **无影响** |
| `dsh-session-format` / `-catalog` / `-v0-to-v1` / `-v1-to-v2` / `-v2-to-v3` / `-v3-to-v4` | 全部相同 | 全部相同 | 相同 | **无影响** |
| `dsh-session-persistence` | 全部相同 | 全部相同 | 相同 | **无影响** |
| `dsh-session-persistence-jsonl` | `worker.cjs` 不同 | 全部相同 | 相同 | 见 2.5 |
| `dsh-session-title` | 相同 | 相同 | 相同 | **无影响** |
| `dsh-tool-todo` / `dsh-attachment` / `dsh-tools` / `dsh-agent` / `dsh-compaction` | 全部相同 | 全部相同 | — | **无影响** |
| `dsh-session` | `index.js`、`types/index.js`、`types/repair.js` 不同 | `types/index.d.ts`、`types/repair.d.ts` 不同 | 不同 | 见 2.3 |
| `dsh-session-log-deepseek` | `index.js`、`types/index.js` 不同 | `types/index.d.ts` 不同 | 不同 | 见 2.6 |

命令：
```bash
for p in <包名…>; do
  (cd $A/$p && find lib -type f -name '*.js' -exec sha256sum {} \; | sort -k2) > /tmp/a
  (cd $B/$p && find lib -type f -name '*.js' -exec sha256sum {} \; | sort -k2) > /tmp/b
  diff /tmp/a /tmp/b && echo "$p SAME"
done
# 生成的统一 diff 存档：.workspace/audit-020/t12/diff/*.diff（10 个文件，739 行）
```

**`SESSION_FORMAT_VERSION` 未变**：
```bash
grep -n "SESSION_FORMAT_VERSION = " $A/dsh-session/lib/types/types.js $B/dsh-session/lib/types/types.js
# 两侧同为 54:export const SESSION_FORMAT_VERSION = 4;
```
**已知事件词汇表未变**（字节相同）：
```bash
sha256sum $A/dsh-session/lib/types/known-event-types.js $B/dsh-session/lib/types/known-event-types.js
# → 两侧同为 8f38e6fc9439bb4e47f2bd3aa21c86d5141ef9679f41181c9d9a48765c67d3be
```

### 2.3 `dsh-session`：tool-result 恢复机制重构（本轨道唯一的实质逻辑变更）

来源：`.workspace/audit-020/t12/diff/dsh-session__lib_types_repair.js.diff`（247 行）

| 维度 | 0.1.7 | 0.2.0 |
|---|---|---|
| 产出形态 | `openTurnClosers` 内部自持 `pendingCalls`，仅对整份 events 数组一次扫描 | 抽出可实例化的 `ToolCallRecovery` 类（`observe(event)` / `results()`），供**实时 step** 与整份重放共用 |
| 归属字段 | pending 项只记 `{ step }`（step 取自 assistant/message 事件） | pending 项记 `{ turn, step }`，且 `TurnEndReason` 取该调用自己所属的 turn |
| 结果消费判定 | `case 'tool/result': pendingCalls.delete(callId)` —— **无条件删除** | 仅当 `surfaceOp === 'append'` **且** `entry.turn === data.turn` **且** `entry.step === data.step` 才删除 |
| 序号基准 | `let seq = last.seq + 1` 在生成 closers **之前**取 | `let seq = last.seq + closers.length + 1` —— 生成后按数量补偿 |
| 导出面 | 无 | 新增具名导出 `ToolCallRecovery`（`lib/types/index.js` 与 `.d.ts` 同步） |

语义影响：0.1.7 的"无条件删除"会让**被替换（replace）掉的旧 tool/result**或**跨 turn/step 的同 callId 结果**错误清空 pending 表，从而漏补真·悬挂调用；0.2.0 的两处修正（三条件消费 + turn/step 归属）使**尾部修复更保守、更少漏补**，且 `closers.length` 补偿避免合成结果的 seq 与真实事件撞号。README 相应改写：`src/repair.ts` 描述自 "Cold repair of crash-orphaned logs" 改为 "Shared tool-result recovery for failed steps, interrupted logs, and fork seeds"，并新增 "Shared recovery" 小节。

**对老会话恢复的影响：无影响（对 v0 语料）/ 净改善（对崩溃尾）**。理由：`interruptedTurnClosers` 这一**对外入口签名与语义未变**，`dsh-session-query` 的冷读路径逐字节未动（仍调用同名入口）；变的是内部实现，老会话**照常**能被平衡。相反地，老日志里大量正被 replace 的 tool/result（本轮实测 **1104** 条 replace 形态）在 0.1.7 下更容易被误删 pending，0.2.0 的判据更严 ⇒ 老会话在崩溃尾场景下**修复正确性提升**。

**⚠️ 但有一条必须记账的副作用：迁移窗口内的"修复不对称"。** 由于两版的 pending 消费判据不同（0.1.7 无条件删除 vs 0.2.0 要求 `append` 且 turn/step 双匹配），**同一份日志在两版下会补出不同数量的合成 `tool/result`**；而 §3.1a 已证 **0.2.0 的 resume 会把这些 closers durable 写回**。后果：**同一份崩溃尾老日志，若曾被 0.1.7 修复过一次，再由 0.2.0 打开，其 transcript 可能与"直接由 0.2.0 修复"不同**（0.2.0 判据更严 ⇒ pending 保留更久 ⇒ 合成错误结果更多）。这不是"不可读"，而是一处**behavioural 差异**，验收时必须对**同一份样本**固定"由哪一版完成首次修复"来消除歧义（§7 第 3 层第 4 条已把幂等性列为硬断言）。
一个**未验证但应当下界的缓解**：更严判据产生的转写**不等于** V4 原生准入会拒绝较宽松判据产生的转写 —— v3→v4 的 fork 结果准入检查的是 `TOOL_NOT_STARTED` 的**形状**（id 前缀 / role / 配对 source-call / `isError:true` / 错误码 / 单文本块），而非"是否本版本所生成"。故 0.1.7 时代已修复的日志在 0.2.0 下**大概率仍可读**；此点记为 **U9**（未构造样本实测）。

### 2.4 `dsh-session-reference`：仅生成式声明字符串差异

唯一差异在 `lib/typert.host.js` 内嵌的生成式声明文本：0.1.7 的 `SessionEventMap` 声明字符串在 `'compaction/prune'` 处**被截断**（缺 `feedback/*`、`goal/change`、`schedule/change` 等成员），0.2.0 补齐到 `'schedule/change'`。两侧 `KNOWN_SESSION_EVENT_TYPES` 字节相同，实际事件词汇表**未变**。

**对老会话恢复的影响：无影响**（仅为内嵌类型文本，运行期不参与事件解释）。

### 2.5 `dsh-session-persistence-jsonl/lib/worker.cjs`：迁移校验 worker 的引擎健壮性修正

```js
// 0.1.7
Function.prototype.toString.call(constructor) === `function ${name}() { [native code] }`
// 0.2.0
Function.prototype.toString.call(constructor) === Function.prototype.toString.call(name === "Array" ? Array : Object)
```
该函数 `hasIntrinsicConstructor` 只服务于 `isIntrinsicObjectPrototype` / `hasPlainArrayPrototype` —— 即 **Worker Thread 内迁移产物的校验**。0.1.7 用**硬编码字符串**判定原生构造器，在 `toString` 表现与 V8 默认不同的引擎上会**误判为"非原生"**，进而拒绝合法的迁移产物（= 迁移校验失败，**不发布继任代**）。0.2.0 改为**与同引擎的原生构造器自身输出比对**，等价但不再依赖具体文本。

**对老会话恢复的影响：需迁移场景下的净改善**（降低"v0→v4 校验阶段失败、无 v4 代发布"的概率），无回归风险。

### 2.6 `dsh-session-log-deepseek`：`enabled` 改为 volatile，按请求读取

```js
// 0.1.7: enabled: z.boolean().default(true)   且 apply() 开头 if (config.enabled !== true) return;
// 0.2.0: enabled: z.boolean().default(true).volatile()
//        注册无条件进行，改为 prepare() 内 if (!config.enabled.get()) return void 0;
```
**对老会话恢复的影响：无影响（行为等价，读取时机更宽松）**。它影响的是**发往模型的请求**是否附带 `dsh_session_log` 增量字段；纯冷读/离线投影不触发该 seam。**注意纪律**：该 seam 一旦生效就会把会话日志增量上传到官方 DeepSeek 接口，验收时若要跑真实请求须单独确认该开关（本轮零模型请求，未触及）。

### 2.7 迁移链：0.2.0 的实际放行路径（v0 → v4）

| 阶段 | 归属 | 对老日志做什麼 | 关键证据 |
|---|---|---|---|
| v0 源解码 | `dsh-session-format-v0-to-v1` | 解打包行（`PACKED_TAGS`：`text-chunks`/`reasoning-chunks`/`tool-call-chunks`）；**封闭清单拒签**清单外类型（含 `ignorable`） | README:45；`lib/index.js` 清单 51 项 |
| v0→v1 | 同上 | `steering/message`→`user/message`；`compact/*`→`compaction/*`；删 `turn/start.trigger`；转换退役 `turn/end` 原因；补消息包装与确定性 id；删 `request/header.header.messagePrefix` | README:47 |
| v1→v2 | `-v1-to-v2` | 嵌入 assistant 流、基数变更引用重映射；拒绝指向已消费 chunk 的引用 | README:50 |
| v2→v3 | `-v2-to-v3` | **`{op:'replace',start,end}` → `{op:'replace',startSeq,endSeq}` 规范化**；`request/header.data.header.system` 转成前置 `system/message` 并**删除该字段**；`tool/code-dispatch{,-start}` → `tool/ptc-dispatch{,-start}`；`tools-code-mode`→`tools-ptc`；preset `code`→`ptc` | README:106（规范化）、:70（system 头）、:95（PTC 改名） |
| v3→v4 | `-v3-to-v4` | `tool/result` 从 user-role 包装**提升**为 tool-role 消息；消息 source 改名；补 `subagent/catalog` 父目录事实；**要求显式 child evidence**；按需插入 `turn/end{interrupted}` 并重映射引用 | README:51、:141、:164 |
| v4 准入 | 同上 | 五类 surface 事件必须有 `surfaceOp`；replace 对象**必须恰为** `op/startSeq/endSeq`（"old endpoint names, mixed spellings, and extra keys are refused"）；退役 PTC 标签、`request/header.header.system` 一律拒绝 | README:225、:278 |

**在 write open 时的落地**（`id`、格式与代号见附录 A）：
```bash
# 0.1.7 根：v4 代 8 个；含 v3+v4 双代 2 个；session.lock 8 个
find ~/.dsh-017/sessions -name 'session.v4.jsonl.zstd' | wc -l     # → 8
find ~/.dsh-017/sessions -name 'session.lock'        | wc -l       # → 8
# 双代样本：v3 头 version=3 / v4 头 version=4，源代 mtime 09-12 早于继任代 09-28
```
⇒ **"v3→v4 全链 4484 记录深等"的历史事实在本轮以工件形态复现**（同目录双代并存、源代保留、继任代发布）。

### 2.8 语料扫描方法（可复跑）

```bash
cd .workspace/audit-020/t12/probe
node scan-by-gen.mjs /home/CNS2026495165/.dsh/sessions     # 按代际拆分的事件类型统计
node scan-v0-logs.mjs /home/CNS2026495165/.dsh/sessions 100000 20000000 > full-live-0.1.1.json
```
要点（**这是本轮最关键的方法学修正**）：会话日志是 **Zstandard 帧的拼接**（每个 durable append 批次一帧），而 Node 的 `zstdDecompressSync` **只解第一帧**（即仅表头行）。必须按帧魔数 `28 b5 2f fd` 切分后**逐帧解码**，否则会把 12 MB 的日志读成 190 字节并得出完全错误的结论。
```bash
zstd -l <日志>   # → Frames 880（单文件帧数）
```
逐帧解码后同样得到后端自身的"可恢复尾"语义：**校验失败的尾帧被丢弃**（等价的 `tornTruncateTo`/`recoveredTail`）。

**扫描结果（按代际拆分，两轮复跑一致）**：

| 指标 | v0 日志（2455 份） | v3 日志（3 份） |
|---|---|---|
| 表头 version | 全部 0 | 全部 3 |
| 出现的事件类型数 | 42 | 30 |
| 落在 v0 封闭清单**之外**的类型 | 3（全部是打包行标签） | 2（`system/message`、`assistant/attempt`） |
| **清单外且非打包标签（= 潜在拒签）** | **0** | n/a（v3 不走 v0 边） |
| tool/result 总数 | 200560 | 207 |
| tool/call 总数 | 199670 | 203 |
| 其中 user-role 包装形态（待 v3→v4 提升） | 200560（100%） | 207 |
| 嵌套 tool-result 包装（**显式拒签项**） | **0** | 0 |
| `request/header.data.header.system`（v2→v3 会消费） | 3255 | 3 |
| `tool/code-dispatch{,-start}`（v2→v3 改名） | 243 + 243 | 0 |
| 顶层 `deferLoading`（**显式拒签项**） | **0** | 0 |
| `sourceEventSeqs` 失效 / replace 端点为未来序号 | 0（1104 条 replace 全部合法） | 0 |
| `ignorable` 事件 | 0 | 0 |
| 跨 fork 的 `session/end-seed` | 2612 | 4 |
| `subagent/descriptor`（父目录事实来源） | 2225 | 0 |
| `goal/change` / `todo/write` | 480 / 1845 | 4 / 7 |
| `image/offload`（附件离线化） | **0** | 0 |
| compaction 家族 | 201/198/174/930 | 4 |

⇒ **拒签项在 2455 份 v0 语料上全部为 0**。这直接把"v0→v4 会不会被迁移链拒签"从**推断**升级为**实测放行**。

---

## 3. 恢复与投影链结论

### 3.1 恢复（resume/reopen）流程

```
ctx.agents.resume({ resumeSessionId, … })            dsh-agent/lib/index.js:464
  └─ requireFactory() → Reflect.apply(factory.resume) dsh-agent/lib/index.js:438/468
       └─ agent-loop 的 resume-load（**0.1.7 实现，0.2.0 侧不可读**）：
            persistence.open(id,'write')                     dsh-agent-loop/lib/index.js:1932
              → handle.read(0)                               :1933
              → closers = interruptedTurnClosers(persisted)  :1935
              → if (closers.length > 0) await handle.append(closers)   :1936   ← **durable 写回**
              → SessionPreparation.create(ctx.sessions.prepare(id, {seed: [...persisted, ...closers], …}))  :1937-1943
            └─ ctx.sessionPersistence.open(id,'write')       jsonl/lib/index.js:2454
                 claimWrite → findLog → acquireLease → requireStoredLog
                 → publishStoredMigration（仅 status==='prepared'）  :2486-2495
                      └─ Worker 线程校验 → 源修订复核 → 无覆盖独占发布
            └─ 活体接管：prepare → Session.fromRestore → enter → announce
                                        dsh-session/lib/index.js:1680/1691/1734/1782
```

**§3.1a｜两条冷读通路对 closers 的处置不同（本轮实测确认，是验收判据的关键）**

| 通路 | 入口 | closers 是否落盘 |
|---|---|---|
| **agent 级 resume**（真正门禁对象） | `dsh-agent-loop` `resume-load` | **落盘**：`handle.append(closers)`（`dsh-agent-loop/lib/index.js:1936`），即"读一次冷日志 → 修复尾 turn → **durable 写回**"。persistence README:61 明文："Resume (agent-loop) reads the stored log through its write handle, computes `interruptedTurnClosers` … and **appends them through the same handle as an ordinary batch**." |
| **只读观察**（`session-query` 冷读） | `readColdSessionLog` | **不落盘**：`:52` 仅在内存追加，`cold-read.d.ts:12` 明文 "nothing is written back"。README:61："Read-only observers (session-query) balance an interrupted cold log with the same closers **in memory only**." |

⇒ **推论（必须写进验收判据）**：resume 会把**合成事件写进会话日志**（仅当尾 turn 处于打开状态，即 `closers.length > 0`）。因此"resume 后日志字节不变"这个断言是**错的**：应当是「**源代文件字节不变**」+「**继任代 = 源代 + 迁移重写 + closers**」。**只有当源日志尾 turn 已正常闭合（`closers.length === 0`）时，继任代才不含任何语义新增** —— 这决定了"老会话能否干净继续"的两分：**干净闭合的老会话 → 纯格式迁移，零语义新增；崩溃中断的老会话 → 迁移 + 尾部修复事件**。

- `ctx.sessions` **不参与**持久化：`sessionPersistence` 在 `dsh-session/lib/index.js` 中**零命中**。
- 后端只有 5 个方法（README:39-44），**没有按 id 寻址的 append/load**；读用 read handle，写用 write handle。
- **`AgentFactory.resume` 的具体实现不在树内（U2/U3）**：`dsh-agent-loop` 未随本轮解包提供；上图中 `resume-load` 的**行号来自 0.1.7 全量树**，是**行为契约 + 后端行为**的合成证据，非 0.2.0 单点可读代码。

### 3.2 投影如何从事件流重建上下文

- **投影注册表**：`ctx.sessionProjections.register(def)`（`dsh-session-projection/lib/types/index.d.ts:38-80`）。注意：任务描述里的 `registerProjection` **在该代码库中不存在**（零命中），真实 API 是 `ctx.sessionProjections.register(...)`。
- **生命周期**：事件驱动 **eager**（每个 `session/event` 都推给每个 unit，`lib/index.js:64/403`）；cell **lazy**（首次触达时折叠整份内存日志，`:378-385`）；其后 **incremental**（`advanceCell`，`:387-400`），并以两处 `Object.is` 闸门避免无谓失效（`:412`/`:421`）。
- **作用域**：注册表按 `def.key` 进程级去重（`:85-99`）；**每会话 cell 用 `WeakMap<Session, cell>`**（`:87`）。
- **注册表 cell 仅内存**（README:133，包内 `node:` 导入为 0）——重启即丢，必须从日志重建。
- **模型可见消息的重建顺序**：`Session.fromRestore`（`dsh-session/lib/index.js:1320`）→ 构造函数内逐 seed 事件 `assertSessionEventEnvelope` → seq 连续性 → `surfaceManager.validateNext` → `log.push`（`:1329-1336`）→ `firstLiveSeq`/fork 切点/`session/end-seed`（`:1338-1352`）。surface 折叠是 **lazy**（`surface.js:506-507`）；`deriveMessages()`（`:1554-1569`）在 `contentGeneration` 变化时整体重置，否则**按增量续算**（`nodes.slice(derivedNodes)`），返回共享冻结的 `Message[]`。
- **失效条件**：`contentGeneration` 仅在 **replace**（`surface.js:444`）与**消息投影变更**（`:450`）时递增 ⇒ **纯 append 永不失效**（这是 KV 前缀可复用的根据，也是老会话"继续追加"便宜的根据）。
- **持久化的投影只有一处**：`dsh-session-projection-cache` 的 `session_projcache` 域；其余（消息历史、surface 节点、tool history、request header/context 折叠、注册表 cell、wire view）**一律派生、从不落盘**。

### 3.3 checkpoint 的触发与存储

- 策略包**自身无状态**（`dsh-session-checkpoint-policy/README.md:66`、`:72-73`），三个 listener 只做一件事：`ctx.sessions.flush`。
  - `llm/stream`（`lib/index.js:61`）：在构造下游流**之前** flush（`:28`→`:29`）；
  - `tools/execute`（`:66`）：顶层 tool body 执行前 flush（`:68`），取消时返回 `ABORTED_BEFORE_DISPATCH`（`:69`）；
  - `agent/pre-step`（`:72`）：上一步的响应与有序 tool 结果 flush 后再派生下一请求（`:73`）。
- **结论：不存在"checkpoint 文件/checkpoint 事件"**。`checkpoint` 是**持久化时间点**，不是落盘对象；`KNOWN_SESSION_EVENT_TYPES` 中无 checkpoint 类型，会话目录里除 `session[.vN].jsonl[.zstd]` 与 `session.lock` 外没有别的落盘物。
- **因此 checkpoint policy 对老会话恢复零影响**：0.1.7→0.2.0 该包 `lib/index.js` 逐字节相同。

### 3.4 会话索引 / 列表如何被查询

- **没有 sidecar 索引、没有 manifest**。会话发现是**纯目录扫描**：`resolveGenerationInDirectory` 选**数值最高**的规范代（`jsonl/lib/index.js:3327`，排序 `:3351`）；路径形如 `<root>/--<cwd>--/<转义后的 id>/session[.vN].jsonl[.zstd]`。同一 id 出现在两个项目目录会**抛错**（`:3370`）。
- `stat(id)` 与 `list()` **只读并校验最高代的表头帧，不读事件行、不启动迁移**（README:82）⇒ **列表/发现对老会话天然安全**，不触发迁移、不因老格式而失败。
- 会话列表元数据（title、时间、计数）来自**日志代自身的表头 + 投影缓存**；跨格式代时仅 `cachedPredecessorTitle` 放行 title 行（title 文本在相邻边上不变），其余行不可用。实测后果：老会话的 `updatedAt` 回落为 `createdAt`，`blank` 退化为 `false`，**冷统计/大纲不可用**，而**标题仍可显示**。
- **表头不可解释/不支持的日志会被 `list()` 静默丢弃**（而非"列出并报错"），与 README:84 一致；这条对"迁移后老会话是否还在列表里可见"是**关键**：v0 表头本身可解释，故不受影响；但**若某目录里存在高于 0.2.0 的代**，运行期会选最高代并可能拒绝解释 ⇒ 该会话从列表消失（这正是历史 G-11"陈旧更高代"的机理）。
- **可选的派生索引：SQLite FTS5**（`dsh-session-query-sqlite`，schema v8、app id 1146308689）。关键事实：**出厂即关闭** —— `dsh-base/cordis.patch.yml` 与 `dsh-web-app/cordis.patch.yml` 均设 `path: ':memory:'`、`openAt: never`（即"SQLite 从不打开；Web 侧栏搜索只匹配标题与工作区名"）。因此它**不是**会话列表的必需品。若某部署**自行开启**它，其自愈行为是：`user_version !== 8` ⇒ 就地丢弃派生表并重建，随后在下次搜索时**从 JSONL 全量重建**（空表会让修订号短路失效 ⇒ 每份日志经 `readColdSessionLog` 读入后在一个 `BEGIN IMMEDIATE…COMMIT` 内写入）；**外来/未知库则 fail-closed 而非重置**。schema v8 在两版**完全相同**，故本次升级不会触发重置；即便如此，**它也从设计上自愈**，对老会话无迁移负担。
- `dsh-session-query` 的读路径有 **live-first** 语义：已知活体会话直接快照，否则列→完整读→**再检一次是否已转活**后才克隆（`dsh-session-query/README.md:107`），并按 `stat` 修订号做有界缓存（`:111`）。

---

## 4. 0.1.7 → 0.2.0 差异与影响判定（逐项）

| # | 差异 | 位置 | 对老会话恢复的影响判定 |
|---|---|---|---|
| D1 | tool-result 恢复重构为 `ToolCallRecovery`（turn/step 归属 + 三条件消费 + seq 补偿） | `dsh-session` `types/repair.js`、`index.js` | **无影响**（`interruptedTurnClosers` 入口语义不变）；崩溃尾场景**净改善**；但引入**迁移窗口修复不对称**（同一崩溃尾日志在两版下合成 closers 数量不同，且 0.2.0 会 durable 写回）——见 §2.3 与 U9 |
| D2 | 新增具名导出 `ToolCallRecovery` | `dsh-session` `types/index.{js,d.ts}` | **无影响**（纯增量导出） |
| D3 | 文档口径改写（"Cold repair" → "Tool-result recovery"，新增 Shared recovery 小节） | `dsh-session/README.md` | **无影响**（注意：术语"cold"在此处被重命名为通用恢复，**是历史术语碰撞的来源之一**） |
| D4 | 迁移校验 worker 的原生构造器判定改为同引擎比对 | `jsonl/lib/worker.cjs` | **需迁移场景净改善**（降低校验阶段误拒） |
| D5 | `dsh_session_log` 的 `enabled` 改 volatile、按请求读取 | `dsh-session-log-deepseek` | **无影响**（等价；但会把日志增量上传官方接口，验收需单独把关） |
| D6 | `typert.host.js` 内嵌 `SessionEventMap` 声明补全 | `dsh-session-reference` | **无影响**（仅生成式类型文本） |
| D7 | 会话日志本体格式代（v0 → v4 的自动迁移 + 继任代发布） | `jsonl` + `format-catalog` + 4 条边 | **需迁移**（自动、一次性、源代不可变、无覆盖） |
| D8 | 投影缓存跨格式代失效 | `dsh-session-projection-cache` | **需迁移**（老缓存行按设计被忽略并冷重算；**性能退化而非数据错误**） |
| D9 | 投影/查询/引用/格式编解码/待办/附件包 | 多处 | **无影响**（逐字节相同） |

**明确"会失败"的候选与本轮实测结论**：

| 候选失败机理 | 0.2.0 是否拒签 | 本轮语料实测 |
|---|---|---|
| v0 封闭清单外的未知事件（含 `ignorable`） | 是（v0→v1 alpha 边） | **0 例**（唯一疑似两型只在 v3 日志，v0 为 0 次） |
| 退役 PTC 标签 `tool/code-dispatch*` 到达 v3+ | 是（v0 边允许、v2→v3 改名） | 486 例**全部会被改名**为 `tool/ptc-dispatch*` ⇒ 不失败 |
| `request/header.data.header.system` 到达 V3+ | 是（V3 原生拒绝） | 3255 例**全部在 v2→v3 被消费并删除** ⇒ 不失败 |
| replace 端点用旧拼写 `{start,end}` 到达 V4 | 是（"old endpoint names … are refused"） | 1104 例**全部在 v2→v3 被规范化**为 `{startSeq,endSeq}` ⇒ 不失败 |
| 嵌套 tool-result 包装 | 是（"refuses results containing another tool-result wrapper"） | **0 例** |
| tool 定义带顶层 `deferLoading` | 是（V3 迁移拒绝） | **0 例** |
| v3→v4 缺 child evidence（父会话的子会话日志缺失/损坏） | 部分（JSONL provider 隔离不可读子头、解码失败与非法 descriptor 字段，保留其他目录项） | 2225 条 `subagent/descriptor` 可供收集；**跨根/子日志被删的父会话为未验证项（U5）** |

---

## 5. 老会话能力逐项判定

判定口径：**REBUILT-FROM-LOG**（跨升级天然安全，因而是"继续可用"）/ **ON-DISK-SEPARATE**（另有落盘状态，需单独把关）/ **需迁移** / **会失败**。

| 能力 | 载体 | 判据 | 判定 |
|---|---|---|---|
| **工具调用历史重建** | `tool/call` + `tool/result` 事件；`session.toolHistory()` 折叠 | `tool-history.js` 两版**字节相同**；老日志 199670/200560 对 tool call/result 为 **user-role 包装**，v3→v4 会**提升**为 tool-role（字段一一对应、id 不重生） | **REBUILT-FROM-LOG + 需迁移**（结构性重写，语义等价） |
| **附件引用** | 引用在 `user/message` 事件的 `ImageBlock`/`FileBlock` 载荷内；**字节**在 `<DSH_HOME>/attachments/v1/{objects,file-objects,files}`（内容寻址，`attachmentId` 形如 `sha256:<64hex>`），**不在会话目录内** | `dsh-attachment` 两版**字节相同**；老语料 `image/offload` **0 例**（无历史附件需要保留）。**缺文件时 fail-closed**：`ATTACHMENT_NOT_FOUND` —— 日志仍可重放，仅该次请求失败；被 offload 的图片降级为占位文本 | **REBUILT-FROM-LOG（引用）+ ON-DISK-SEPARATE（字节）**：迁 `DSH_HOME` 必须携带 `attachments/v1/` |
| **子代理关系** | 子会话自有 `subagent/descriptor` 事件（**子会话日志**）+ 父会话 `subagent/catalog` 事件；另含表头 `parentSession`/`delegationDepth` | **本轮实测（v0 全量语料）**：`subagent/descriptor` 共 **2225** 条，**全部 `version: 2`**；mode 分布 continuable 1749 / one-shot 476。而 v3→v4 的 `childCatalogFact` 显式接受 `version ∈ [1,2,3]`（`lib/index.js:904-908`）⇒ **0.1.1 时代的 v2 descriptor 完全在支持范围内**，可据其 mode/label 补出 v0 版目录事实。v3→v4 **不**读父日志推子关系，而是从**同根内可识别的直接子会话**收集证据 | **REBUILT-FROM-LOG（由迁移补建）** —— 但**判据是"同根子日志可得 + 恰好 1 条自有 descriptor"**，见下方风险 |
| **goal 状态** | `goal/change` 事件（**唯一存储**）；投影键 `goal`（stateVersion 6） | 老语料 **480** 例；README 明文"the only store of goal state"就是会话日志；**无文件**。**但 `activation`（armed/disarmed 自动续跑）是进程内 `WeakMap`，且每次 `agent/created` 都 disarm** | **REBUILT-FROM-LOG（目标值）**；**activation 不恢复** ⇒ 恢复后的 active goal **不会自动续跑**，需重新 arm |
| **todos** | `todo/write` 事件 + 投影键 `todos`（last-write-wins，遇 `turn/start` 重置） | 老语料 **1845** 例；`dsh-tool-todo` 两版**字节相同**，注册点 `dsh-tool-todo/lib/index.js:80` | **REBUILT-FROM-LOG** |
| **taste 条目** | **不在会话日志内**：`<DSH_HOME>/taste/{taste.md,config.json}`（全局域）+ `<git-root｜cwd>/.dsh/taste/`（项目域）；**无** `session.append`（零命中） | 会话内**无载体** ⇒ 与日志迁移**完全解耦**；按 home+cwd 键控，**非按会话** | **ON-DISK-SEPARATE**（会话恢复无影响；但**不受任何会话备份覆盖**，迁 `DSH_HOME` 必须单独拷贝 `taste/` 与各项目 `.dsh/taste/`） |
| **btw 侧聊关系** | **不在会话日志内**：`<DSH_HOME>/btw/index.json`（`version:1`，`entries[parentSessionId] → {childSessionId, createdAt, lastActiveAt}`；**原子 rename** 落盘） | **无** `session.append`（零命中）；且**子会话表头刻意不带父链** ⇒ 关系**只能**经该 sidecar 恢复，不能由会话日志推得 | **ON-DISK-SEPARATE**（会话本身可恢复；**父子对应关系依赖 sidecar**，迁 `DSH_HOME` 必须一并携带 `btw/index.json`，否则侧聊"孤儿化"） |
| 投影缓存（列表/统计首屏） | `session_projcache`（`~/.dsh/storages/session_projcache*`） | 缓存行盖 `formatVersion` 戳；跨代**永不匹配** | **需迁移（性能退化）** |
| 会话列表/发现 | 目录扫描 + 表头 | `list()`/`stat()` 只读表头、不迁移 | **REBUILT-FROM-LOG** |

> 说明：`taste` 与 `btw` 的判定依据来自**树外本地插件**（`dsh-taste`、`dsh-btw` 在 0.1.1/0.1.7/0.2.0 三棵 npm 树中**均不存在**，是 live-mounted 的本地插件），并已在本轮做**独立实测核对**：
> ```bash
> node -e "…读 ~/.dsh/btw/index.json 的结构字段…"
> # → top-level keys ["version","entries"]; version 1; entries 为对象; 条目数 10;
> #   每个条目的键恰为 childSessionId,createdAt,lastActiveAt
> ls -la ~/.dsh/taste/ ; ls -la <repo>/.dsh/taste/
> # → 全局域 taste.md + config.json(+display.zh.json 及一份 .migrated-backup)；
> #   项目域 .gitignore + taste.md
> grep -c "session.append\|session/event" <repo>/dsh-btw/lib/index.js    # → 0
> grep -c "session.append"               <repo>/dsh-taste/lib/index.js  # → 0
> ```
> **这两项都不构成"需迁移/会失败"** —— 它们的作用域是 `DSH_HOME` 而非会话日志；结论是**迁移清单必须显式包含 `<DSH_HOME>/taste/`、`<DSH_HOME>/btw/index.json` 与各项目 `<git-root>/.dsh/taste/`**，这与本轨道"会话恢复"主线正交。

### 5.1 子代理关系重建的**关键风险**（本轨道对升级门禁影响最大的一条）

v3→v4 的父目录补建是**安全网式**的（"Missing own parent entry with complete supported evidence → Append a version-0 catalog fact"），但有**两道硬条件**：

1. **必须有显式、完整的直接子事实集**：`sessionFormatV3ToV4.createStage()` **在没有 child evidence 绑定时报错**（"refuses without that binding; an empty array explicitly declares no children"）。JSONL provider 会**隔离**不可读的子表头、子解码失败与非法 descriptor 字段并保留其他目录项（即**容忍**），但"该根内子日志完全缺失"的父会话能否顺利迁移，本轮**未实跑**（U5）。
2. **恰好 1 条自有 descriptor**：`if (count !== 1 || !known) return void 0`（`lib/index.js:908`）——**多于 1 条时不会失败，而是降级**为"保留已有项 / 追加 unknown-mode 成员"（宽松降级，安全性好）。`count = 子会话自有 `subagent/descriptor` 事件数（**继承切点之后**）`。

**本机实测的有利结论**：v0 语料里 2225 条 descriptor **全为 version 2**，正是 `childCatalogFact` 白名单 `[1,2,3]` 的成员，故 0.1.1 时代的子关系**具备被自动补建的资格**；且 0.1.1 **根本没有** `subagent/catalog`、子级发现靠表头（`list-children.js`），因此"0.1.1 父会话缺目录项"是**常态**，正是该补建逻辑的目标场景。

### 5.2 一处必须记账的 0.1.1 → 0.1.7 路径变更（影响附件缓存，不影响持久对象）

请求期图片缓存根从 `<DSH_HOME>/attachments/v1/request-images` 迁到 `<DSH_HOME>/cache/attachments/request-images`（实测：现役 `~/.dsh/cache` **不存在**，而 `~/.dsh/attachments/v1/request-images` **存在**）。**持久对象路径未变**（两侧均为 `attachments/v1/objects/<2>/<sha>`）。⇒ 缓存层是可再生的，**不构成迁移阻断项**。

---

## 6. 两层"冷恢复"的判据与预期（历史术语碰撞坑）

历史文档中"冷恢复通过"**必然**指 (a)，而升级门禁要的是 (b)。本轨道在代码层复现了两者的**判据层级差异**，这正是误判 `D-01` 的机理。

### (a) subagent 冷恢复（新造 child 的重建）—— 真通过，但对象不是老会话

- **含义**：本次运行新造的 continuable child 在进程死亡后，由新进程凭磁盘上的 descriptor 用 `send_message` 重建 Agent。
- **0.2.0 判据**：`dsh-subagent` 的 `maxActiveSubagents` 池在"每次新建或**冷恢复** Activation 前"读取；容量耗尽以 `ACTIVATION_LIMIT_REACHED` 拒绝；**只有直接 child 可以冷恢复**。
- **判定方法**：`flush` 水位在冷恢复前后递进（历史实测 `508→5883→10044` 形态）、`activations.get()=undefined` 表明旧 Activation 已死、随后由新进程重建。
- **预期结果**：**PASS**（历史 `steering-017` G2 记录 23/0）。**但这不构成对老会话的推断** —— 对象是本次新造的 child session。

### (b) 老会话的 agent 级冷恢复 / 冷 adopt —— 门禁所指的那一层

- **含义**：**0.1.1 时代**写出的 v0/v3 真实工件，在 0.2.0 实例里做**实例级 open**。
- **判据（三条同时成立才算通过）**：
  1. **层级必须是 agent 级**：走 `ctx.agents.resume()`（或等价的 `open(id,'write')`），**不得**用 `open(id,'read')` 冒充 —— 读分支不 `claimWrite`/`acquireLease`/`publishStoredMigration`，读成功时盘面**完全不变、无 v4 代**；
  2. **盘面证据**：同一会话目录内出现**新代文件** `session.v4.jsonl.zstd`（表头 `version:4`），且**源代文件字节不变**（sha256 前后相同），`session.lock` 出现；
  3. **能力证据**：新实例能列出/读回该会话且投影重建无缺失（见 §7 第 2 层）。
- **预期结果（基于本轮实测）**：**判为可通**——v0 语料对封闭清单**零拒签项**、全部疑似拒签结构均有确定的消费/改名边；0.1.7 实例已实证 v3→v4 的 `write open` 发布继任代。**但"老 v0 会话的 agent 级 open"本轮仍未实跑**（零模型请求约束 + 不得触碰运行中实例），故记为**未验证项 U1**，只能给出"预期可通 + 可判定验收方案"。

### 6.3 与历史记录的交叉核对（本轮独立结论 vs 历史）

| 历史记录 | 本轮独立结论 | 是否一致 |
|---|---|---|
| 旧会话冷恢复从未开始 / 阻断（G-11/G-12、B1） | 本轮同样**未实跑**，判为 U1 | 一致 |
| `open(id,'read')` 不能当作冷 adopt 通过（D-01） | 代码层独立复现：read 分支无 claimWrite/lease/publish | 一致（并补充了 write 分支的行号证据） |
| "旧会话更高代陈旧前缀需另案处置"（G-11） | 本轮给出机理：最高代选择 `resolveGenerationInDirectory`；**若目录里存在比 0.2.0 更高或不可解释的代，运行期选它并可能拒绝解释** | 一致，且补齐机理 |
| "热修复 A 缩水：v4 == v3、v0 的 613 行不进入 v4" | 本轮**未触及**该议题（属 A 域），但提供了同一机制的另一面：v0→v4 的转换是**语义等价重写 + 引用重映射**，不是逐行复制 | 不冲突，留待 A 域裁决 |

---

## 7. 会话恢复验收方案（隔离根内、**零模型请求**、可判定）

**前置约束**：所有命令只在**新建隔离根**内执行；`DSH_HOME` 指向隔离根；不得对现役 3080 / 隔离 3097 的目录做任何写操作；不得启动新增监听端口的服务；不得发起模型请求。
**样本卫生**：把待验老日志**复制**到隔离根的 sessions 目录（复制不改原件；禁止就地改动真实会话正文）。
**脚本状态（诚实标注，避免误读）**：本层引用的 `assert-projection-parity.mjs`、`write-open-drill.mjs`、`assert-capabilities.mjs`、`assert-idempotent-resume.mjs`、`iso-no-model.yml` 是**待实现的验收件**，**本轮未编写**（本轮只交付了结构扫描器，见附录 B）。已实现并复跑通过的是 `scan-by-gen.mjs`、`scan-v0-logs.mjs`、`surfop.mjs`、`descver.mjs` 四个只读结构扫描器。
**`DSH_HOME` 级状态清单（与会话日志正交，务必一并迁移）**：`<DSH_HOME>/taste/`、各项目 `<git-root>/.dsh/taste/`、`<DSH_HOME>/btw/index.json`、`<DSH_HOME>/attachments/v1/`、`<DSH_HOME>/storages/session_projcache*` —— 这些**不在**会话迁移链的覆盖范围内。

### 第 0 层｜环境与版本锚定（零模型）

```bash
export ISO=/home/CNS2026495165/dsh/.workspace/audit-020/t12/iso-run
export DSH_HOME=$ISO/home
export npm_config_cache=/home/CNS2026495165/dsh/.workspace/npm-cache
export npm_config_logs_dir=/home/CNS2026495165/dsh/.workspace/npm-logs
mkdir -p "$DSH_HOME"
dsh --version                       # 预期：0.2.0-rc.1
dsh --profile web --dump-config     # 预期：退出 0，打印合成后的 profile 树（不挂载、不联网）
```
**通过标准**：`--version` 为 `0.2.0-rc.1`；`--dump-config` 退出 0 且能列出 `dsh-session-persistence-jsonl`、`dsh-session-checkpoint-policy`、`dsh-session-projection-cache` 三者。

### 第 1 层｜格式迁移链放行（**只读，不迁移**）——证明"能不能被解释"

```bash
# 1a 结构扫描：把老日志按代际归类，确认无清单外事件
node .workspace/audit-020/t12/probe/scan-by-gen.mjs "$ISO/sessions"
# 1b 表头分类 + 迁移计划（readHeader 不读事件行、不发布）
node - <<'JS'
const { readFileSync } = require('fs');
const { zstdDecompressSync } = require('zlib');
const M = Buffer.from([0x28,0xb5,0x2f,0xfd]);
const dec = (b) => { const o=[]; let i=b.indexOf(M);
  while(i!==-1){o.push(i); i=b.indexOf(M,i+4);}
  let s=''; for(let k=0;k<o.length;k++){const e=k+1<o.length?o[k+1]:b.length;
    try{ s+=zstdDecompressSync(b.subarray(o[k],e)).toString('utf8'); }catch{} } return s; };
const buf = readFileSync(process.argv[1]);
const header = JSON.parse(dec(buf).split('\n')[0]);
console.log('physical header version =', header.version, '=> migration plan =',
  header.version === 4 ? '[]' : ['vN→…→v4']);
JS <某个复制过来的老日志>
```
**通过标准**：
- 表头 `version` 可读出（v0 为 `0`），**且 `version <= 4`**（`>4` 会被判"请升级 harness"，属预期外的**拒绝解释**）；
- `scan-by-gen` 输出中 **`typesNotInV0Inventory_excludingPackedCodecTags` 为空数组**（放行判据的核心）；
- 本层**不得改动任何文件** —— 用 `sha256sum` 前后比对该日志确认零写入。

### 第 2 层｜投影正确性（**零模型请求**）——证明"读回来的上下文正确"

**关键判据（不用模型请求就能证明投影正确）**：`interruptedTurnClosers` 是**纯函数**，且格式编解码是确定性的，因此对同一份日志存在**两条应当逐字节相等的重建通路**：

| 通路 A | 通路 B |
|---|---|
| 冷读：`persistence.open(id,'read')` → `handle.read(0)` → `events` → **`interruptedTurnClosers(events)`** | 全量逻辑恢复：把该日志的全部物理行喂给 **`sessionFormatCatalog.createRestore(header, {recovery:'recoverable', validation:'transformed'})`** 的 `decodeRow`/`finish()` |

```bash
# 2a 断言 A == B（事件序列、字段、消息 id、sourceEventSeqs、surfaceOp 全等）
node .workspace/audit-020/t12/probe/assert-projection-parity.mjs <会话id> > parity.json
# 2b 从 A（或 B）派生模型可见消息，并与"同一实例内不重启直接读"的结果比对
#    （同进程二次 deriveMessages() 必须与首次逐项 Object.is 相等 —— 缓存与非缓存路径一致性）
# 2c 幂等性：同一日志连续跑 2 次第 2 层，输出必须逐字节相同
sha256sum parity-run1.json parity-run2.json   # 预期：相同
```
**通过标准（必须全部成立）**：
1. `A == B`：两条通路的规范化 JSON 逐字节相等；
2. **序号连续无缺口**：`seq` 覆盖 `0..N-1` 无空洞、无重复；
3. **turn/step 闭合**：每个 `step/start` 有配对的 `step/end`；每个 `turn/start` 有配对的 `turn/end`；**每个 `tool/call` 都有配对的 `tool/result`**（否则说明尾部修复漏补）；
4. **surface 合法性**：五类 surface 事件均带 `surfaceOp`；每个 replace 恰为 `op/startSeq/endSeq` 且端点指向更早事件、覆盖完整被替换节点；
5. **引用完整**：所有 `sourceEventSeqs` / `messageSeqs` / `shadowedRange` / `shadowedSeqs` 指向**存在的、更早的** seq；
6. **无拒签**：迁移链每一步未抛 `SessionFormatError` / `SessionFormatUnsupportedMigrationError`；
7. **幂等**：2c 两次输出相同。

### 第 3 层｜agent 级冷恢复（**写盘证据**，是本门禁的真正对象）

**若允许一次 agent 级 open（推荐在隔离根内、且用零模型配置）**：
```bash
# 记录迁移前盘面
PRE=$(sha256sum "$ISO/sessions/<proj>/<id>/session.jsonl.zstd")
# 以 agent 级入口恢复该会话（具体 app 参数按 0.2.0 的 tui/headless 帮助而定）
dsh tui --resume <id> --patch ./iso-no-model.yml     # iso-no-model.yml 需关掉一切模型出网
# 记录迁移后盘面
ls -la "$ISO/sessions/<proj>/<id>/"
POST=$(sha256sum "$ISO/sessions/<proj>/<id>/session.jsonl.zstd")
```
**通过标准（四条同时成立）**：
1. 目录内出现 **`session.v4.jsonl.zstd`**，且其表头 `version` 读出为 `4`；
2. **源代文件 sha256 前后相同**（`PRE == POST`）：迁移不可变、无覆盖 —— 注意这是**源代**不变，**不是**"日志不变"（见 §3.1a）；
3. 出现 `session.lock`；且该会话可再次被 `list()` 发现、`read` 读回；
4. **尾部修复的预期性**：若源日志尾 turn 已闭合，则继任代相对源代**只应有格式差异、零语义新增**（逐事件类型/seq 数比对）；若尾 turn 打开，则继任代 = 源代 + closers，且 closers 必须满足 `tool/result`(错误结果) → 开放 `step/end` → `turn/end{interrupted}` 的顺序，并**逐条**与 `interruptedTurnClosers(源事件)` 的预期结果全等。**第二遍 resume 必须零新增 closers（幂等）** —— 这是判定"干净继续"的核心断言。

**若不允许 agent 级 open**（本轮即为此种情形：零模型请求 + 不得触碰运行实例）：**降级为 write-open 证据**，只驱动持久化后端、不进入 agent loop：
```bash
node .workspace/audit-020/t12/probe/write-open-drill.mjs "$DSH_HOME/sessions" <id>
```
**通过标准**：同上第 1、2 条（出现 v4 继任代 + 源代字节不变）。**并须在报告中显式标注"这是 write-open 级证据，不是 agent 级 `ctx.agents.resume` 证据"** —— 按 §6(b) 判据第 1 条，两者不可互换。

### 第 4 层｜能力逐项断言（零模型）

对第 2 层重建出的事件序列，直接断言 §5 各项能力的存在性与结构：
```bash
node .workspace/audit-020/t12/probe/assert-capabilities.mjs parity.json
```
**通过标准**：老日志中原文存在的每一类状态，在重建结果中**计数相等且结构合法**：
`tool/call`↔`tool/result` 配对率 100%、`todo/write` 末值可读、`goal/change` 末值可读、`subagent/descriptor` 可被 v3→v4 收集为父目录事实、`session/end-seed` 的继承切点与 `inheritedEventCount` 一致。

### 第 5 层｜投影缓存跨代行为（零模型）

```bash
# 迁移前记录缓存的 formatVersion 戳（只读结构字段，不读会话正文）
node -e "/* 读 session_projcache 记录，仅打印 identity.formatVersion 分布 */"
```
**通过标准**：迁移后老会话的缓存行**不再作为 fold 起点**（即被忽略并冷重算），且**进程不因此报错、列表仍可读**；`title` 行可经 `cachedPredecessorTitle` 跨代放行。**注意**：本层期望的正确行为就是"缓存作废"，因此**"缓存命中率下降"不是失败**；失败只应是"缓存作废导致启动失败或列表不可读"。

---

## 8. 未验证项（显式标注，共 9 项）

| 编号 | 未验证内容 | 原因 | 影响 |
|---|---|---|---|
| **U1** | **老 v0 会话在 0.2.0 下的 agent 级 `ctx.agents.resume` 实跑** | 零模型请求硬约束 + 不得触碰运行中实例；且 agent 级入口需 agent-loop + app | 本轨道最高影响项：§6(b) 只能给"预期可通 + 验收方案"，**不能**宣告通过 |
| **U2** | `AgentFactory.resume` 的**具体实现** | `dsh-agent-loop` 不在本轮解包树内 | §3.1 第 3 步以下是契约 + 后端行为的合成 |
| **U3** | 活体接管实际选用 `prepare`+`enter`+`announce` 还是 `Session.create` | 同 U2 | 不影响结论方向，影响细节 |
| **U4** | 冷读命中 `shared-frozen` 还是 `detached` | 未实跑后端 | 低 |
| **U5** | **父会话的子日志缺失/损坏**时 v3→v4 的 child-fact 收集结果 | 需要构造"子日志被删/损坏"的样本，属写入实验 | 中：影响 §4 最后一行候选失败项 |
| **U6** | taste / btw 的**代码在 0.2.0 下是否仍兼容** | 二者为**树外本地插件**，本次解包不含其 0.2.0 适配态；本轮只核了其**状态文件结构**与"无 `session.append`"（两处 grep 均为 0） | 中：影响迁 `DSH_HOME` 后的侧聊/taste 可用性，不影响会话恢复主线 |
| **U7** | 隔离根内 `0.2.0` 实际挂载组合与 `--dump-config` 输出 | 本轮未启隔离根实例（避免与 3080/3097 混淆） | 低：§7 第 0 层给出可执行判据 |
| **U8** | **0.1.7 时代已修复过的崩溃尾日志，在 0.2.0 下是否仍通过 V4 原生准入** | 需构造"由 0.1.7 修复的 v4 日志"样本；本轮无写入实验 | 中：见 §2.3 的缓解推理（准入查形状而非来源版本），但**未实测** |
| **U9** | 0.2.0 `dsh-agent-loop` 的实际 `resume-load` 代码 | 包不在解包树内（`resume-load` 行号来自 0.1.7 全量树） | 中：与 U2/U3 同源；§3.1 已标注为合成证据 |

---

## 附录 A｜当轮实测命令与关键输出（编号化，不含会话 id 与正文）

| 编号 | 命令（要点） | 关键输出 |
|---|---|---|
| E1 | `node -p "require(...dsh/package.json).version"`（三棵树） | 0.1.1-rc.2 / 0.1.7-rc.2 / 0.2.0-rc.1 |
| E2 | 逐包 `sha256sum` 全 `lib/**` 对比 | 见 §2.2 矩阵；仅 `dsh-session`、`dsh-session-reference/lib/typert.host.js`、`jsonl/lib/worker.cjs`、`dsh-session-log-deepseek` 有差异 |
| E3 | `grep -n "SESSION_FORMAT_VERSION = "`（两侧） | 同为 `4` |
| E4 | `sha256sum known-event-types.js`（两侧） | 同为 `8f38e6fc…`（**事件词汇表未变**） |
| E5 | `diff -u repair.js`（017 vs 020） | 247 行；`ToolCallRecovery` 抽取 + turn/step 归属 + 三条件消费 + seq 补偿 |
| E6 | `zstd -l <日志>` | `Frames 880`（**拼接帧**，故 Node 单次解压只得 190 B） |
| E7 | `node scan-by-gen.mjs ~/.dsh/sessions`（**两轮复跑一致**） | v0：2455 份 / 42 型 / 清单外违规 **0**；v3：3 份 / 30 型 |
| E8 | `node scan-v0-logs.mjs …`（全量） | 1459185 帧；tool/result 200560、tool/call 199670、header.system 3255、code-dispatch 243+243、descriptor 2225、goal/change 480、todo/write 1845、image/offload **0**、嵌套包装 **0**、deferLoading **0**、ignorable **0** |
| E9 | v0 封闭清单抽取 | 51 项，`sha256(keys.join)=1614a30c…`（复跑一致） |
| E10 | `node surfop.mjs`（全量 surfaceOp 形态） | 395141 条：append 394030、`{start,end}` 1104、`{startSeq,endSeq}` 7；**非法 0** |
| E11 | `find ~/.dsh-017/sessions -name 'session.v4.jsonl.zstd' \| wc -l` | 8（含 v3+v4 双代目录 2 个）；`session.lock` 8 |
| E12 | 双代样本表头读取 | v3 头 `version:3`、v4 头 `version:4`；源代 mtime 09-12 < 继任代 09-28；源代体积略小 |
| E13 | `sed -n '2454,2510p' jsonl/lib/index.js` | read 分支无 `claimWrite/acquireLease/publishStoredMigration`；write 分支 `:2486/:2491/:2492/:2495` |
| E14 | `grep -n "formatVersion" projection-cache/lib/index.js` | `:400 currentLifecycleMatches` 要求 `===`；`:404 predecessorIdentityMatches` 允许 `<`（listing 专用） |

## 附录 B｜本轨道产物清单

| 路径 | 内容 |
|---|---|
| `.workspace/audit-020/t12/diff/*.diff` | 0.1.7→0.2.0 逐文件统一 diff（10 个文件 / 739 行） |
| `.workspace/audit-020/t12/probe/scan-by-gen.mjs` | 按格式代拆分的事件类型结构扫描器 |
| `.workspace/audit-020/t12/probe/scan-v0-logs.mjs` | v0 全量结构扫描器（含拒签项计数） |
| `.workspace/audit-020/t12/probe/full-live-0.1.1.json` | 全量扫描结果（2455 份 v0 + 3 份 v3） |
| `.workspace/audit-020/t12/probe/surfop.mjs` | surfaceOp 形态分布扫描器（**已实现，复跑通过**） |
| `.workspace/audit-020/t12/probe/descver.mjs` | `subagent/descriptor` 版本/mode 直方图扫描器（**已实现，复跑通过**） |
| `.workspace/audit-020/t12/probe/v0-inventory.txt` | 从 0.2.0 源码抽出的 v0 封闭事件清单（51 项） |
| `.workspace/audit-020/t12/sub-a-resume-flow.md` | 恢复/冷读流程详档（456 行，逐条 `path:line`） |
| `.workspace/audit-020/t12/sub-b-projection.md` | 投影重建详档（658 行，~400 条 `path:line`） |
| `.workspace/audit-020/t12/sub-c-query-index.md` | 查询/索引详档（703 行，127 条 `path:line`） |
| `.workspace/audit-020/t12/sub-d-capabilities.md` | 能力载体详档（501 行，含 7 项裁决与证据表） |

### B.1｜子代理产物与本报告的交叉核对（哪些被采纳、哪些被修正）

| 来源 | 采纳 | 修正 / 独立复核 |
|---|---|---|
| sub-a | 恢复入口 = `ctx.agents.resume`；read 分支无 `claimWrite/lease/publish`；无 sidecar 索引；`SESSION_FORMAT_VERSION=4` | 独立复核了 jsonl `open()` 两分支行号（`:2454`/`:2486`/`:2491`/`:2492`/`:2495`），并**补上** `dsh-agent-loop:1935-1936` 的 durable `handle.append(closers)` —— 这是 sub-a 未展开、却**决定验收判据**的关键（§3.1a） |
| sub-b | 投影为内存 cell；唯一落盘者是 `session-projection-cache`；`registerProjection` 不存在；`dsh-agent-loop` 缺席致 assembly 站点不可读 | 独立复核 `formatVersion` 身份闸门（`:400` 用 `===` vs `:404` 用 `<`），把"缓存跨代作废"从推断落为**代码级判据**（§1.3、§3.4） |
| sub-c | **无会话索引**（目录扫描 + 仅读表头）；SQLite FTS **出厂 `:memory:` + `openAt: never`** 且能自愈重建；cold-read 定义 | 已把 FTS 自愈、以及"表头不可解释即从列表静默消失"两节并入 §3.4 |
| sub-d | descriptor **v2** 全量；v3→v4 接受 `[1,2,3]`；attachment 字节在全局 store（缺失即 `ATTACHMENT_NOT_FOUND`）；goal `activation` 不复原；taste/btw 为 sidecar | **独立实测**了 descriptor 版本直方图（2225 条全 v2）、btw/taste 状态文件结构、及两处 `session.append` 零命中（§5、§5.1） |

## 附录 C｜对协调者的两条更正（会影响其他轨道）

1. **`src-020` 与 `src-017` 均为不完整解包**，不是"包被移除"。`src-017` 缺 `dsh-session-checkpoint-policy`、`dsh-session-reference`、`dsh-session-projection-cache`；`src-020` 缺 `dsh-goal`、`dsh-agent-loop`、`dsh-command-goal` 等。**凡以这两棵树做"新增/移除包"判定的轨道（T01 等）必须复核**，否则会产出假阳性/假阴性。
2. **读会话日志必须按 zstd 帧逐帧解码**。`zstdDecompressSync(整个文件)` 只返回**第一帧**（表头行，约 200 字节），对 12 MB 日志会静默给出 190 字节，极易得出错误结论。本轨道首轮即踩此坑并已修正。
