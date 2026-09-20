# 终审 A — 官方补丁完整性 + 启动关键路径（只读审计报告）

- **阶段**：重启前终审 A（路由 adam/deepseek-v4-flash，审计子代理）
- **审计对象**：全局树 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/` 下 32 个被改包
- **覆盖补丁面**：5 既有（replay-lag-fix 管理面）+ groupB subagent 族 + lean12（patch-official-015）+ 组A6 + 组C7 + 槽位B ui-workspace（patch-official-slots）
- **审计时间**：2026-09-15（部署三段式重放完成、重启前）
- **约束**：全程只读（未写全局树任何文件）；报告为唯一产物

---

## 0. 结论摘要

> **结论：全绿放行（无 blocker）**。启动关键路径（语法层 / 锚点共存 / 模块加载期）全部通过；
> 2 个非阻塞发现（P3、观察项 O1，详见 §7），均不影响重启，但按任务标准有 1 项未达"应为 0"：
> 全局树存在 1 个 `.orig` 残留（P3，清理即达标）。

| # | 检查项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 32 包全部被改 .js node --check | ✅ PASS | 225 个 .js，0 失败（§1） |
| 2 | 关键锚点共存（5 组） | ✅ PASS | grep 计数 + 文件:行号（§2） |
| 3 | 启动关键路径 ESM 冒烟（5 核心包） | ✅ PASS | 5/5 import 无导入期抛错；另补 require 冒烟 32/32（§3） |
| 4 | .rej/.orig 残留 = 0 | ⚠️ 1 个 .orig | `.rej`=0；`dsh-host-apiproxy/lib/index.js.orig` ×1（P3，§4） |
| 5 | 6 包 live vs deploy-015 sha256 一致 + deploy-p0 materialize sha 不变 | ✅ PASS（+1 观察项） | 6 包全等；31 条 known 全匹配；64088a4b/36c832b6 不变；O1 见 §5.4 |

---

## 1. 任务 1 — 全部被改包 node --check（PASS）

对 32 个被改包的**全部 `.js`**（含 `lib/types/*.js`）执行 `node --check`（只解析不执行，无副作用）：

```
=== node --check 汇总: 共 225 个 .js, 失败 0 ===
```

被覆盖包（32，含 dsh-subagent 的 lib/types/{child-agent,continuation,index,out-of-process,run-settlement}.js）：
`dsh-agent-loop dsh-host-apiproxy dsh-subagent dsh-subagent-fork-in-process dsh-subagent-spawn-in-process dsh-tool-subagent dsh-client-ui-subagent dsh-web-search-deepseek dsh-client-ui-workspace dsh-fs dsh-fs-local dsh-tool-web dsh-atomic-write dsh-tool-str-replace-editor dsh-launch-environment dsh-llm-deepseek dsh-goal-round-driver dsh-user-approval dsh-mcp-client dsh-tool-fs-search dsh-tool-bash-persistent dsh-spill-local dsh-client-connection dsh-client-ui-trajectory dsh-host-frontend-static dsh-file-reference-local dsh-cmdline dsh-session dsh-session-projection dsh-session-persistence dsh-llm-retry dsh-agent`

补充：32 包 `package.json` 全部 JSON 合法、`main`（均 lib/index.js）指向存在的文件（`tool-subagent` 依赖 `zod: ^4.4.3`，运行时 hoisted zod 4.6.2 可解析，已实测 `require.resolve('zod')` 从 dsh 根与两个消费包均命中）。

**被改文件面确认**（= 补丁交付面，非全包）：
- deploy-015 覆盖 28 包：与副本 `diff -rq` 逐字节比对，仅 1 个 .js 有差异（见 §5.4 O1），其余全部一致 → 被改文件即补丁锚点所在文件；
- 4 个非 deploy-015 包（lag-fix 管理面 + slots）：`dsh-host-apiproxy/lib/index.js`（u4/u5/u5b/btw 四补丁，单文件）、`dsh-client-ui-subagent/lib/client.js`、`dsh-web-search-deepseek/lib/index.js`、`dsh-client-ui-workspace/lib/client.js`（+非 js 的 slots.d.ts）。均已实测与 9-12 补丁前备份仅上述文件差异。

## 2. 任务 2 — 关键锚点共存（PASS，全部带文件:行号）

| 包 | 锚点 | 实测 | 证据 |
|---|---|---|---|
| dsh-agent-loop | isSubagent ≥2 | **2** | `lib/index.js:613`（`const isSubagent = ...`）、`:623`（`if (!isSubagent) ...`） |
| dsh-agent-loop | reasoningEffort ≥1 | **5** | `lib/index.js:331,703,704,708,994` |
| dsh-host-apiproxy | session/prompt-image-transform | **1** | `lib/index.js:2771`（`ctx.waterfall("session/prompt-image-transform", ...)`） |
| dsh-host-apiproxy | MAX_QUEUED_FRAMES | **2** | `lib/index.js:1095`（`const MAX_QUEUED_FRAMES = 4096`）、`:1108` |
| dsh-host-apiproxy | isAnswerableFrame | **3** | `lib/index.js:1097,1111,1112` |
| dsh-host-apiproxy | （附 u4 锚点） | **1** | `lib/index.js:3581`（`if (!subscribed.has(session.id)) return;`） |
| dsh-subagent | materializeContinuableChild ≥3 | **3** | `lib/index.js:1231`（方法定义）、`:2579/:2580`（facade 委托）；types 侧 `lib/types/index.d.ts:1` |
| dsh-subagent | parentAgentOptionsForDelegation | **3** | `lib/index.js:500`（定义）、`:523`（resolveChildAgentOptions 使用）、`:2816`（导出） |
| dsh-client-connection | 双补丁锚点（组A S2 在 client.js + 组C S9 在 index.js） | ✅ | S2：client.js `:14`（generationReadyTimeoutMs: 15e3）、`:160`（onReconnectRequested?.()）、`:218`（waitForReady(ready, this.config, ac.signal)）；S9：index.js `:337`（MAX_MISSED_HEARTBEATS=2）、`:339`（DEFAULT_WEBSOCKET_HEARTBEAT_INTERVAL_MS=2e3）、`:341/:357/:367`（downlinkWrites 写串行化）、`:449/:451`（missed≥2 terminate）、`:458` |
| dsh-client-ui-workspace | remoteHosts ≥2 | **2** | `lib/client.js:2013`（renderSlot）、`:2440`（SlotMap 声明）；`lib/types/client/contract/slots.d.ts:65` |
| dsh-client-ui-subagent（附） | formatTokensPerSecond 等 | **5** | `lib/client.js`（U-2 恢复锚点） |
| dsh-web-search-deepseek（附） | x-opencode-session | **1** | `lib/index.js`（U-3 恢复锚点） |

## 3. 任务 3 — 启动关键路径 ESM 加载冒烟（PASS）

对最核心 5 包 `dsh-agent-loop / dsh-host-apiproxy / dsh-subagent / dsh-session / dsh-client-connection` 用 `file://` 绝对路径动态 `import()`（评估顶层代码）：

```
[OK] dsh-agent-loop       import 成功, 导出 6 项
[OK] dsh-host-apiproxy    import 成功, 导出 7 项
[OK] dsh-subagent         import 成功, 导出 28 项
[OK] dsh-session          import 成功, 导出 26 项
[OK] dsh-client-connection import 成功, 导出 8 项
=== ESM 冒烟: 5/5 通过 ===
```

无任何导入期抛错；5 包均为 CJS bundle，import 期即执行顶层代码，无副作用加载报错。
**补充加固**：另对全部 32 包做 `require('@deepseek-ai/<pkg>')` 冒烟（cordis 插件真实加载路径），**32/32 全部通过**，无导入期异常。zod（tool-subagent/llm-retry 运行时依赖）从 dsh 根、tool-subagent、llm-retry 三处解析均命中 hoisted `dsh/node_modules/zod`（4.6.2，满足 `^4.4.3`）。

## 4. 任务 4 — 无 .rej / 无残留（⚠️ 1 个 .orig，P3）

全 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh` 树扫描：

- `*.rej`：**0** ✅
- `*.orig`：**1** ❌（未达"应为 0"）
  - `dsh-host-apiproxy/lib/index.js.orig`（212,690 B，mtime 2026-09-12 16:08）
  - 性质核验：该文件 = live `lib/index.js` **减去 btw 补丁**的旧态（含 u4/u5/u5b 锚点、不含 `session/prompt-image-transform`），系 9-12 btw 补丁应用时 `patch` 生成的自动备份残留；
  - 危害评估：**零启动影响** —— 全树无任何模块引用该文件名（grep 无命中），node 加载路径只认 `lib/index.js`；文件为死文件。
  - 处置建议：`rm ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js.orig` 即达标（审计只读未动）。

## 5. 任务 5 — 与交付副本一致性（PASS + 观察项 O1）

### 5.1 抽查 6 包 live vs `.workspace/deploy-015/<pkg>` 全文件 sha256（lean/组A/组C 各 2）

| 组 | 包 | 文件数 | 结果 |
|---|---|---|---|
| lean | dsh-fs | 10 | ✅ 全等 |
| lean | dsh-user-approval | 13 | ✅ 全等 |
| 组A | dsh-spill-local | 11 | ✅ 全等 |
| 组A | dsh-client-ui-trajectory | 114 | ✅ 全等 |
| 组C | dsh-session | 27 | ✅ 全等 |
| 组C | dsh-agent-loop | 13 | ✅ 全等 |

### 5.2 known-sha256-015.txt 全量复验
31 条文件条目（lean12 + groupB 13 文件）live sha256 **全部匹配**（唯一"不匹配"为 `---` 开头注释行误报，非条目）。

### 5.3 deploy-p0 materialize sha 不变 ✅
- `deploy-p0/dsh-subagent.lib.index.js` sha256 = `64088a4b…67b5`（8 位前缀 64088a4b，不变）✅
- `deploy-p0/dsh-subagent.lib.types.index.d.ts` sha256 = `36c832b6…adf9`（不变）✅
- **materialize 区零触碰**：live `dsh-subagent/lib/index.js` 与 deploy-p0 副本的 `materializeContinuableChild` 函数体（含 facade 两处）**2040B 逐字节一致** ✅（groupB 补丁未扰动 materialize 区）
- live `dsh-subagent/lib/index.js`=36650446…、`lib/types/index.d.ts`=a8ed3f81…，与 known-sha256-015 groupB 节一致 ✅

### 5.4 观察项 O1（非阻塞）— deploy-015 副本 dsh-client-connection/lib/client.js 滞后
- 28 个 deploy-015 包与 live 逐字节比对：**27 包全等**；唯一差异 = `dsh-client-connection/lib/client.js`。
- 核验结论：**live 是正确的组A交付态，deploy-015 副本是滞后副本**。
  - live client.js 含 S2 全部锚点（waitForReady/onReconnectRequested/generationReadyTimeoutMs，§2）；
  - 重建验证：`deploy-015 副本 + dsh-client-connection.recovery-enhancement.patch（S2）` 打补后 **与 live 逐字节一致**；
  - deploy-015 的 `index.js` 已含 S9 且与 live 全等（副本并非整包旧版，仅 client.js 单文件滞后，疑为 16:07 副本刷新时混入旧态）。
- 影响：**不影响本次重启**（启动读 live，不读副本）；风险仅在"从 deploy-015 重新部署会丢 S2"，建议主代理择机刷新该副本（非本次重启闸门）。

## 6. 与各执行档声明的一致性
- groupA/groupC/groupB/lean 各档"node --check 全过 / patch 应用后与副本逐字节一致"声明，与本次 live 实测一致（除 O1 副本单文件滞后，live 侧无漂移）。
- groupC「S9 只改 index.js、未碰 client.js」与「deploy-015 副本 client.js 与 GLOB 一致」两项声明在当下 live 均成立（live client.js=S2 交付态；副本滞后属 16:07 后事件，groupC 档内当时属实）。
- groupB「materialize 区 0 行触碰 / 函数体逐字节一致」实测复核成立（§5.3）。

## 7. 发现清单（按严重度）

| ID | 严重度 | 描述 | 是否重启 blocker |
|---|---|---|---|
| P3-1 | **P3（低）** | 全局树残留 `dsh-host-apiproxy/lib/index.js.orig`（9-12 btw 补丁自动备份，死文件，无引用）→ 任务标准"应为 0"未达标 | **否**（零启动影响；rm 即达标，审计只读未清） |
| O1 | 观察项 | `deploy-015/dsh-client-connection/lib/client.js` 副本滞后（缺组A S2 补丁）；live 已是正确交付态 | **否**（建议刷新副本防未来误部署） |

**重启闸门：通过。** 32 包语法/结构（225 .js node --check + 32 package.json + require 冒烟 32/32）、5 核心包启动关键路径（ESM import 5/5）、全部关键锚点共存、交付副本一致性（6 抽查 + 31 known + materialize 64088a4b/36c832b6 不变）均绿；无 .rej；唯一 .orig 为 P3 低危死文件。
