# 2026-09-17 批次「重启后验收」执行报告

- 执行者：主代理（会话 `session-cb106ec3-2628-43f5-8403-13f6c836a8dd`），目标锚点 `goal-dfc62e29-d803-4f07-a418-0ec3bfb1f9b1`
- 基线：HEAD `0c9affbf`（= `origin/main`），工作区仅 2 项预存 untracked
- 用户裁决（本轮）：验收 + 修复闭环（P0 四项 + P1 三项）；逐次提权策略（后因策略改为 `danger-full-access` + 审批禁用而无需提权）；热载项**跳过实改 settings**，以已有 E2E 证据 + 只读代码复核替代；overflow 并入本轮按 v4-flash 同档值修；修复产物本地 commit + push
- **所有结论均由本节原始输出支撑；未取到的证据一律标 ⏳/⚠️，不以"生成成功"代替验收**

---

## 0. 与交接材料的事实偏差（实测修正）

| 交接材料声称 | 实测 | 判定 |
|---|---|---|
| 「生效还差最后一步：重启 dsh web」 | 重启**已完成**：`node .../dsh web` PID **3411549**，lstart **2026-09-17 17:45:39**，`ss -ltnp` 显示其持有 `127.0.0.1:3080`；旧 PID 3365519 已不存在 | ❌ 声称过时（重启早于用户粘贴交接提示词） |
| HEAD = `0a5b4476` | HEAD = **`0c9affbf`**（= origin/main），比声称多 1 个提交（即交接提示词本身） | ❌ 差 1 提交 |
| §7：`settings.yaml` 含 `dsh-subagent` 段与 `dsh-btw.model` 段 | 两者**均不存在**（`grep -n -A4 '^dsh-subagent'` 无命中；与 16:59:28 备份 `diff` 无输出 = 逐字节相同） | ❌ 描述不成立（功能上无影响：两者都是可选覆写层，缺失即回落 preset/常量默认） |
| 「goal 修复属本次重启才加载的冷面改动」 | `dsh-goal-round-driver/lib/index.js` mtime **2026-09-16 14:10**（备份 `goal-round-driver.index.js.P0A.bak` 09-16 13:22、`.pending-subagent.bak` 09-16 14:10）→ **早于**旧进程启动（09-17 16:30），旧进程早已加载 | ❌ 归类错误（该修复并非本次重启的收益） |
| 回滚表 §3 第 4 行 `...index.js.bak-*.bak` | 实物名以时间戳结尾 → 该 glob **展开 0 个文件**（预检档 R1 红灯，见 §3.1） | ❌ 回滚命令按字面执行会失败 |
| adam provider `baseURL: https://llmapi.roboscience.xyz/v1/`（带尾斜杠） | 与交接自述的「必须无尾斜杠否则 Invalid URL」冲突；判定档结论见 §3.5 | ⚠️ 待判 |

---

## 1. P0 四项

### P0-1 重启存活 ✅ 通过

```
$ ps -eo pid,ppid,lstart,etime,cmd | grep 'dsh web'
3411533  3411533  四 9月 17 17:45:38 2026   npm exec @deepseek-ai/dsh web
3411548  3411533  四 9月 17 17:45:39 2026   sh -c dsh web
3411549  3411548  四 9月 17 17:45:39 2026   node /home/CNS2026495165/.npm-global/bin/dsh web

$ ss -ltnp | grep 3080
LISTEN 0  511  127.0.0.1:3080  0.0.0.0:*  users:(("node",pid=3411549,fd=25))

$ curl -s -o /dev/null -w 'http_code=%{http_code}\n' http://127.0.0.1:3080/
http_code=200

$ ps -p 3365519 -o pid,lstart,cmd        # 交接所称"旧进程"
（无输出 = 已不存在）
```

**判据**：3080 由单一进程持有、HTTP 200、旧 PID 消失 → 重启发生且唯一实例在服务。

### P0-2 子代理模型 = `adam/deepseek-v4.1-flash` ✅ 通过

重启时刻前后同项对比（子代理会话记录里的 `agentModel`）：

```
17:38:33  agentModel=deepseek-v4-flash      ← 旧进程
17:41:27  agentModel=deepseek-v4-flash      ← 旧进程
────────── 17:45:39 重启 ──────────
17:50:49  agentModel=deepseek-v4.1-flash    ← 新进程
17:52:31  agentModel=deepseek-v4.1-flash
17:53:12  agentModel=deepseek-v4.1-flash
17:53:18  agentModel=deepseek-v4.1-flash
17:53:25  agentModel=deepseek-v4.1-flash
17:53:26  agentModel=deepseek-v4.1-flash
17:53:27  agentModel=deepseek-v4.1-flash
```

**关键排除项**：17:47:04 派发的子代理写明 `agentModel:"deepseek-v4.1-flash"` 时，`settings.yaml` 中**没有** `dsh-subagent` 段（settings 热载路径排除）→ 该值只能来自启动时冷读的 preset。preset 文件 mtime 16:49:11，而 16:49:52 / 17:38 / 17:41 的旧进程子代理仍取 `deepseek-v4-flash` → 反向印证 preset 不热、且旧进程从未读到新 preset。
provider 亦为 `adam`（E2E 证据 `agentProvider: "adam"`，见 P0-3）。

### P0-3 子代理模型 settings 热载 ⚠️ 部分取证（按用户裁决：不实改运行盘面）

用户裁决：**跳过实改 `settings.yaml` 的实测**（避免临时值影响其它并行会话），改用「只读代码复核 + 已有 E2E 证据」。

1. **部署位与产物逐字节一致**（补丁确实在跑的代码里）：
```
$ sha256sum <部署位>/dsh-tool-subagent/lib/index.js \
            .workspace/deploy-subagent-model/dsh-tool-subagent.index.js.patched
65288049b2fada12cb1686c92a0515f54a170b7843ba4c2d6bf988ca6a841214  <部署位>/lib/index.js
65288049b2fada12cb1686c92a0515f54a170b7843ba4c2d6bf988ca6a841214  ...patched
```
2. **热读点确在 execute 内（每次派发读）**：`部署位/lib/index.js:123` `settings.get("dsh-subagent")`；`:527` 注释 `// P0' dsh-subagent settings default layer: hot, per-dispatch read.`，紧随 `effectiveConfiguredAgentOptions(runtimeCtx, config.agentOptions)`。
3. **宿主半边已装载且默认值 = 当前固定路由**：新插件 host `lib/index.js` 注册 `settingsNamespace("dsh-subagent")`，`DEFAULT_ROUTE = {provider:"adam", model:"deepseek-v4.1-flash"}`，`Config = z.object({provider: z.string(), model: z.string()})`（两键可选）。
4. **已有 E2E 证据（真实派发，测试实例 :8091）**：
```
child-1-override（覆写 dsh-subagent: {provider: adam, model: glm-5.3}）
  subagent/descriptor: {"agentProvider":"adam","agentModel":"glm-5.3"}
  request/header:      {"provider":"adam","model":"glm-5.3","maxTokens":1000000}
  request/context:     {"provider":"adam","model":"glm-5.3","contextWindow":1000000}
child-2-fallback（清空该段）
  subagent/descriptor: {"agentProvider":"adam","agentModel":"deepseek-v4.1-flash"}
$ cat evidence/test-instance.log
dsh web: http://127.0.0.1:8091
```
5. **本会话实测到的分支**：当前 `settings.yaml` 无 `dsh-subagent` 段 → 全部子代理走"缺失即回落 preset 路由"分支，实测得到 `deepseek-v4.1-flash`（与 §1 P0-2 的证据同源）。**覆写分支（非空值优先于 preset）在本会话未实改盘面复测**——这是本项唯一的残留缺口，按用户裁决以第 4 条 E2E 证据替代。

**结论**：代码路径 + 装载状态 + 回落分支 = 已独立验证；覆写分支 = 引用既有 E2E（非本会话实测）。

### P0-4 goal 等待期不再空转 ⏳ 观测中（判据已机制化）

**机制（读部署位驱动源码）**：驱动通过 `Agent.followup()` 注入一条 `<goal_round>` 提示，其 source 为 `{kind:"goal", round>0}`；门控为
- `subagent/start` → `state.pendingSubagents += 1`；`subagent/end` → `-= 1`，归零时置 `competingQueued = true` 并 `requestDrive(state)`（关闭子代理后剩余通知仍在下发途中，用 competing 闸兜住窄窗口）；
- 静默条件 `ctx.fiber.state === 2 && !state.stopping && ctx.agents.get(...) === state.agent && state.agent.status === "idle" && state.pendingSubagents === 0 && !state.competingQueued`（`部署位 …/dsh-goal-round-driver/lib/index.js:82`）。

**因此可判据化**：等待期内本会话日志**不得**出现 `type=user/message` 且 `data.source.kind === "goal"` 且 `round > 0` 的记录。

**当前状态（goal 建立后、4 个后台档在跑）**：
```
$ <统计本会话 user/message 中 source.kind=goal 的记录>
（无输出 = 尚无 goal 轮注入）
本会话 goal/change 事件数 = 1（即本次 create_goal）
```
⏳ 完整的"等待期"观测窗口在本次回合结束后才成立（子代理 settle 期间）。收尾时按同一判据复查并回填本节。

**✅ 观测结果（2026-09-17 18:16:22 → 18:17:30，真实窗口，判据级）**

窗口构造：17:53:05 `goal/create`（revision 1，armed）→ 18:16:22 `turn/end`（我主动结束回合，此时后台子代理 `730cbce5` 于 18:16:10 派出、仍在飞）。

```
18:16:22  turn/end                {"turn":1,"reason":{"kind":"completed"}}     ← 等待窗口开始
18:17:30  agent/inbox/spliced     {"target":"next-turn","inserted":[{"content":[{"type":"text",
                                   "text":"Background subagent 730cbce5-… failed before it finished."…
                                  ← 唤醒源 = 子代理 settle 通知，不是 goal 轮
18:17:30  turn/start              {"turn":2}                                   ← 被通知唤醒（设计内行为）
```
全会话统计：`type=user/message` 且 `data.source.kind === "goal"` 的记录 **0 条**（含 round>0 与 round 0）。
⇒ **等待期内没有发生任何 goal 轮注入；父 agent 是被子代理通知唤醒的，不是被空转轮唤醒的。**

**判定：P0-4 通过**（判据 = 等待期零 goal 源注入 + 唤醒源为 subagent 通知）。补强证据：该驱动的门控代码已复核（`pendingSubagents` 计数来自 `subagent/start`/`subagent/end`，静默条件含 `state.pendingSubagents === 0 && !state.competingQueued`，见 `部署位 dsh-goal-round-driver/lib/index.js:82`、`:270-289`）。

**独立复核（`.workspace/acceptance-probe/verify-goal-gate.md`，271 行，观测窗口 18:16:14→18:32:14）**
- 注入唯一出口 `drive() → agent.followup()`（`G:156`），前置 `readyToDrive`（`G:80-83`）**五道门全真**；等待期由 `pendingSubagents` 单独封死，归零瞬间另置 `competingQueued` 作窄窗兜底（`G:281`），该旗只在父进入 idle 时清除（`G:221`）。
- **跨包验证**（非照抄）：插件读 `this` 而非事件参数——cordis `dispatch` 以 `args[0]` 作 `thisArg`（`cordis/lib/index.js:259,265`），子代理生命周期确以 carrier 作首参（`dsh-subagent/lib/types/lifecycle.js:30-33`），carrier key **就是父 Agent 对象本身**（`dsh-subagent/lib/index.js:2518` + `dsh-agent/lib/index.js:369`）⇒ `carrierKeyOf(this)` 与 `states` 同键，能命中。
- **两条决定性补强**（主代理未取到）：① 全会话 `goal/change` **仅 1 条**（17:53:05 create，**无 pause/disarm**）⇒ 观测期内 goal 始终 `active && armed`，零注入是"该注入却未注入"，可归因门控；② settle 通知落库为 `source.kind === "subagent-settled"`（非 `subagent-report`），该会话 9 次 settled **每一次后面都是父的 `turn/start`**，无一次被替换成 goal 轮。
- **反证检查**：未发现未封堵路径（并发多子代理 / `end` 先于通知 / continuable 冷恢复 / 父非 running / `maxGoalRounds` 边界均判定已封堵，附行号）。**唯一 fail-open 方向**是 `carrierKeyOf(this)` 取不到父 agent 时计数静默不加（`G:271-273/277`）——实际不可达（三处发布点均传活体父 Agent），但建议加 `logger.warn` 把静默 fail-open 变成可观测。
- **诚实边界**：**未取得补丁前的对照样本**，故"该补丁消除了一个真实存在的空转"这一**因果主张不予背书**；背书的是弱主张——补丁在位时本批 8 个等待/结算实例上等待期零注入。（补丁 mtime 09-16 14:10，早于旧进程启动，故旧进程亦已加载，无法构造前后对照。）

**R1 加固已落地（但未生效，等你安排重启）**：按你的裁决"现在就改"，已在部署位 `dsh-goal-round-driver/lib/index.js` 的两处归因失败分支加 `ctx.logger.warn`（`subagent/start` 的 no-op 分支 + `subagent/end` 的 `state === void 0` 提前 return 分支），把唯一 fail-open 方向从**静默**变为**可观测**。
- **仅日志、零行为变更**：计数与门控逻辑逐字未动（`start` 用 `else` 接替原来的隐式 no-op；`end` 加 warn 后照旧 `return`）。
- `ctx.logger` 在该文件内既有 7 处同类用法（`:93/:113/:159/:181/:187/:197/:229`），`inject` 列表（`agents`/`goals`/`sessions`）无需改动 → 不引入新依赖。
- `node --check` 通过；sha `c4f3ea68…` → **`4351e1742d3a6db1deb3b95e5006976e10b15c897362eb4518a0e42fcecb1b76`**；备份 `~/.dsh/backups/goal-round-driver.index.js.r1warn-20260917-183347.bak`；diff 归档 `.workspace/acceptance-probe/goal-r1-warn.diff`。
- **生效条件：下一次 dsh web 重启**（宿主 lib 属冷面）。不生效不影响任何现有行为。

---

## 2. P1 三项

### P1-5 btw 默认模型 = v4.1-flash 且热读 ✅ 通过（离线实测 + 代码读点）

```
$ cd dsh-btw && node scripts/verify-btw-model-hotread.mjs
✓ settings dsh-btw.model.default=glm-5.3 → new chat default model = glm-5.3
✓ create agentOptions.model = glm-5.3 (routed to the settings default)
✓ hot edit → dsh-btw.model.default=deepseek-v4-pro → new chat default model = deepseek-v4-pro
✓ cleared/absent section → fallback constant default = deepseek-v4.1-flash
PASS: btw default model is settings-driven and hot-read (no restart needed for value changes)
```
代码读点（部署位 `@local/dsh-btw/lib/index.js`）：默认常量 `:210` / `:350` / `:1698` 均为 `deepseek-v4.1-flash`；legacy 映射 `:360` `{ "deepseek-v4-flash": "deepseek-v4.1-flash" }`；注释 `:339` `dsh-btw.model.options / dsh-btw.model.default are read on every call`；schema/注册 `:1686` `BTW_SETTINGS_SCHEMA`、`:1730` `settings.register(BTW_SETTINGS_NS, ...)`；读点 `:248` `ctx.get("settings")?.get?.("dsh-btw")`。

✅ **用户目视确认（2026-09-17 18:31）：是**（btw 抽屉默认模型与三值下拉均正确）。

### P1-6 设置页「子代理模型」（order 70）✅ 服务端/客户端取证通过 ⏳ 目视待你确认

```
$ curl -s http://127.0.0.1:3080/ | grep -o '__DSH_BOOT__[^<]\{0,600\}'
__DSH_BOOT__"] = {"rev":"7704aa37bbaf","entries":[ ... 
（新插件入 boot 图：{"id":"@local/dsh-subagent-model",...,"rev":"d0b7a565217f"}）

$ curl -s -o /tmp/subm.js -w '%{http_code} %{size_download}' \
    http://127.0.0.1:3080/plugins/@local/dsh-subagent-model/client.js
200 17099

$ grep（bundle 内）
settings.section", () => ctx.slots.register({     ← 注册
子代理模型                                        ← 分区标题
order: 70                                         ← 排序值
（对比：bridge 侧 /plugins/@local/dsh-subagent-model/lib/client.js → 404，说明真实入口是 package.json exports 的 ./client → lib/client.js）
```
宿主半边（`部署位/@local/dsh-subagent-model/lib/index.js`）：`installSettingsSection(ctx, NS, Config, {...DEFAULT_ROUTE, ...config}, {setSource, onChange})`，`inject = []`（无宿主服务硬依赖）。

✅ **用户目视确认（2026-09-17 18:31）：是**（设置页「子代理模型」可见、可读写 provider/model，保存即热生效）。

### P1-7 vision 原图直传 ✅ 通过（用户贴图实测）

已取到的证据：
- **能力声明**：`settings.yaml` `adam.deepseek-v4.1-flash` 条目 `input: [text, image]`（同 provider 的 `deepseek-v4-flash` **故意未声明**）。
- **真实多模态实测**（`.workspace/mmt-probe/RESULTS.md`）：v4.1-flash 原生识图可用（UI 截图大字/色值逐字命中 **15/17**）；对照组 `deepseek-v4-flash` 自述看不到图、`content` 空。
- **请求图落盘**：`~/.dsh/attachments/v1/request-images/3f/3f0fc7f1…`（201,992 B，2026-09-17 16:42）。
- **会话内的 image part**：`session-bc0b7655-…` 中出现 `"type":"image"`（mtime 17:45，即**重启前**的那次直传）。

**✅ 已完成（2026-09-17 18:31，你贴了截图）——P1-7 通过，且证据比预期完整**

会话记录原文（`session-cb106ec3…/session.jsonl.zstd`）：
```json
{"type":"user/message","seq":141553,"time":1789641113147,"data":{"content":[
 {"type":"image","attachment":{"attachmentId":"sha256:077b16c15b937189d36c10ef3fb1bff9ad5a4b66deafeddb7453b0b32d2b53d9",
   "mediaType":"image/png","width":2048,"height":1152,"bytes":1766643,"name":"image.png",
   "originalDimensions":{"width":5120,"height":2880}}},
 {"type":"text","text":"看下落盘，第一，是的，第二，是的，第三，截图发你了"}],...}}
```
- **会话内 image part**（非 vision-adam 转文本）⇒ 原图直传成立。
- **原始对象落盘**：`attachments/v1/objects/07/077b16c1…` = PNG 2048×1152 RGBA，1,766,643 B。
- **请求图落盘**：`attachments/v1/request-images/bd/bd67c9f2…` = WebP 2048×1152，196,370 B，**18:31:53 写入**（`request-images/` 累计 2 个文件，另一个是 16:42 那次）。
- **消费模型**：`assistant/message` 的 model 来源在 18:32:07 / 18:32:21 / 18:32:32 均为 `adam/deepseek-v4.1-flash` —— 即声明了 `input: [text, image]` 的那个。
- **一个值得记录的细节**：原图 5120×2880 被 harness **降采样到 2048×1152** 后才作为请求图发出。这与"不做放大预处理"的裁决不冲突，但它说明小字保真度的上限由这一步决定（`originalDimensions` 字段把原始尺寸也留档了）。

**另一个必须记录的交互**：`agent-default-model` 在 18:27 已改为 `deepseek-v4-flash`，但**本会话仍跑在 `deepseek-v4.1-flash`**（见上：18:32 的 model 来源）。即默认模型的改动只对**新会话**生效，已存在的会话保持自己的路由 —— 这与 `6b9b6c3f` 会话在 18:07 跟随了当时的新默认值（v4-flash）并不矛盾：那是另一条会话在其自身生命周期内解析默认值的结果，具体口径（会话创建时钉住 vs 每轮解析）本报告未定论，**留作后续需核实的开放项**。

---

## 3. 验收外但影响判定的附带发现

### 3.1 预检：GO + 1 红灯（R1）— `.workspace/acceptance-probe/preflight.md`

- **GO**：新插件 host+client 双入口齐全且与产物逐字节相等；DSH 自身组合解析 exit 0（548 行、stderr 空、新条目恰好 1 次）；145/145 插件名可解析；`.rej`/`.orig` = 0。历史"缺 `lib/index.js`"故障形态不存在。
- **红灯 R1（回滚失效类）**：`RESTART-ACCEPTANCE.md` §3 第 4 行 glob `...index.js.bak-*.bak` 实测展开 **0 个文件** → 按字面回滚会失败。最小修复：去掉多余的 `.bak`（或写死 `…bak-20260917-165928`）。→ 纳入文档回写。
- **黄灯**：btw 回滚目标 `backup-btw-20260917-170146` 是 v4.1 之前的更早态，回滚会连带退掉 P0-b 热读等后续单元；现存两个 btw 备份都不等于 live 当前态。

### 3.2 vitest 实测与交接声称不符 ⚠️ 判定为负载敏感 flake（非回归）

```
$ cd dsh-btw && node_modules/.bin/vitest run --reporter=dot
Test Files  1 failed | 23 passed (24)
     Tests  1 failed | 230 passed | 2 skipped (233)      ← 交接声称 231 passed / 2 skipped
FAIL tests/host-opening.spec.ts > acknowledges start before child creation settles
     AssertionError: expected false to be true  (tests/host-opening.spec.ts:153)

$ node_modules/.bin/vitest run tests/host-opening.spec.ts   （单文件隔离复跑 10 次）
PASS=10  FAIL=0
```
失败的断言是**纯时序断言**：测试在 `await setImmediate` 循环里轮询 100 个 tick，期待"admission 已 settled"（admission 内含一次小 fs 往返）——首跑发生在 5 个后台子代理 + 全量 suite 并发时。
**flakiness 定性与加固**（全部实测）：
```
$ node_modules/.bin/vitest run tests/host-opening.spec.ts        （隔离复跑 10 次）
PASS=10  FAIL=0
$ node_modules/.bin/vitest run --reporter=dot                    （全量复跑 3 次）
run1/2/3:  Test Files 24 passed (24) | Tests 231 passed | 2 skipped (233)
$ 单文件 + 人为 CPU 负载（python busy loop） 5 次
loaded run 1..5: PASS ×5
```
结论：**负载敏感的测试缺陷，不是 btw 本批次改动引入的回归**。已按裁决加固：`tests/host-opening.spec.ts:145` 的固定 tick 轮询改为 wall-clock 上限 10s 的条件等待（`child` 全程保持 pending，断言语义不变）；加固后单文件 18/18、全量 231 passed | 2 skipped。（另两处 `settledBeforeChild` 断言用的是单 microtask 等待、语义更强且稳定，未改动。）

### 3.3 历史大文件：交接声称半成立，且发现真正的扩散源 — `.workspace/acceptance-probe/brief-history-bigfile.md`

| 交接声称 | 实测 |
|---|---|
| 历史含 `.workspace/tmp-ppt-research/raw/mgr.tgz`（51MB） | ✅ blob `15dcbf4818e5bb93956c2e826626923a41af405b`，**53,561,751 B = 51.08 MiB**，仅存在于提交 `3028e624` 的 tree（删除于 `5dc98a7e`），仍在 `origin/main` 可达历史；占 clone pack **28.4%** 且**不可压缩**（compressed == uncompressed） |
| 「GitHub **持续**告警」 | ❌ 实际是 2026-09-15 单次 push 的 GH001 一次性告警（原始证据 `.workspace/push-log3.txt`，推送范围 `80ef4ec6..a5976993`）；GitHub 只对当次推送对象告警，blob 已在远端；HEAD 最大文件仅 5.03 MiB → 未来 push 不再触发 |
| （隐含）只有这一个 | ❌ 历史 ≥1 MiB blob 共 **59 个 / 202.25 MiB**；全仓 blob 363.13 MiB vs HEAD 97.86 MiB → 约 265 MiB 死历史 |
| — | **新发现（真正在扩散）**：HEAD 仍跟踪 **`.workspace/deploy-pptmaster/.venv-ppt-test/` = 1817 文件 / 51.62 MiB（占 HEAD 跟踪量 52.8%）**，未被 ignore，且由同一个 `3028e624` 引入 |

量化：clone pack 180.61 MiB；只 purge mgr.tgz → 129.53 MiB（−28.3%，改 9/14 个 commit SHA）；清 ≥1 MiB → 65.64 MiB（−63.6%）。爆炸半径≈0（本机仅 1 个 clone、无 CI/tag/fork、无 LFS、历史无 secret）。远端 `origin = git@github.com:AdamDream/dsh-hub.git`，本地与 origin/main 一致（0/0）。GitHub 侧告警状态**无法核实**（无 gh CLI、API 403、无 token）。

**已按你裁决执行（路线 A，零风险面）**：
```
$ { grep -n "GH001\|remote: warning" .workspace/push-log3.txt ; } > .workspace/acceptance-probe/push-log3-GH001-archive.txt
# 归档原文：remote: warning: File .workspace/tmp-ppt-research/raw/mgr.tgz is 51.08 MB; this is larger than GitHub's recommended maximum file size of 50.00 MB
#           remote: warning: GH001: Large files detected. ...
$ rm -f .workspace/push-log3.txt                     # 残渣清理（内容已归档）
$ git rm -r --cached .workspace/deploy-pptmaster/.venv-ppt-test/
$ git ls-files .workspace/deploy-pptmaster/.venv-ppt-test/ | wc -l     → 0
$ ls .workspace/deploy-pptmaster/.venv-ppt-test/ | wc -l               → 5   （磁盘文件保留）
```
`.gitignore` 新增该 venv 路径与 `pasted-2048.png`（用户截图保持不入库）。**历史未重写**（B-lite 需 force push + 改 9/14 SHA，你已裁决先不做）。

### 3.4 S21 显式模型选择：**建议否决** — `.workspace/acceptance-probe/brief-s21.md`

- 启用即抛错：`dsh-tool-subagent/lib/index.js:287`（`modelSelectionSettings: z.boolean().default(false)`）→ `:618-621` 为 false 时提前 `install(ctx, void 0); return;` → `:622-623` 为 true 时 `ctx.get("subagentModelSelection")`，该服务缺失则 **throw**。
- 本版本树**没有**那个宿主半边：`package.json:16-27` 无 `./model-selection-settings` export，`lib/` 只有 `index.js`+`invariant.js`，全盘 find 零命中（0.1.5 归档树里才有 `lib/model-selection-settings.js`）。
- 语义冲突：把 provider/model 选路权交给模型，与已裁决的「路由调整须用户明确指令」直接冲突；而其目标（子代理默认路由可配）已由 P0' settings 层覆盖。

### 3.5 preset 热重载：**建议不做** + 机制纠正 — `.workspace/acceptance-probe/brief-preset-hot.md`

- 交接的机制假设**部分成立**：子代理派发走 `composeFrom`（bind 非 mount）复用父 standing mount，确实绕开 `ensureStanding`（`@/dsh-agent-presets/lib/index.js:988-994`、调用点 `@/dsh-subagent/lib/index.js:598` ← `@/dsh-subagent-in-process-driver/lib/index.js:172`）。
- **但全称表述"改 preset 文件不热"与代码不符**：`ensureStanding` **有** stamp 重挂载检查（`:1130-1138`，stamp = mtimeMs+size，`:1161-1176`），而 `mount()` 只在**会话创建**时调用（`@/dsh-host-apiproxy/lib/index.js:1782`）→ **新建会话今天就已经是热的**；不热的只是"编辑前已存在的会话及其子代理"。41 秒实测与该链条一致。
- 真·热化路线 C（每次派发热读 preset 文件）约 40–60 行、热面可行，但收益与现有 settings 层重叠≈0；路线 A2（子代理创建前重解析代际）违反"child 与 parent 同 generation"公开契约，会引入跨代际不一致。
- 附带建议：修正 `~/.dsh/profiles/web/cordis.patch.yml:10` 过时注释"组合变更需重启 DSH 后对新会话生效"（误解传播源）。

### 3.6 context overflow 根因与修复 ✅ 已根治（本轮最重的发现）— `.workspace/acceptance-probe/rootcause-context-overflow.md`

**根因（源码确证）**
- 报错源：`dsh-llm-pi-ai/lib/index.js:1292`（message）/ `:1293`（`CONTEXT_WINDOW_EXCEEDED`），函数 `mapStopReason`。
- 性质：pi-ai `@earendil-works/pi-ai/dist/utils/overflow.js:128-154` 的 **Case 2 = 纯客户端预估**，服务端实际返回 `stopReason:"stop"`。判据 `usage.input + usage.cacheRead > contextWindow`。
- **默认值确证 = 262144**：`dsh-llm-pi-ai/lib/index.js:849 const DEFAULT_CONTEXT_WINDOW = 262144;`，回落链 `:639 entry.contextWindow ?? base?.contextWindow ?? request.defaultContextWindow`。
- `maxTokens` **不参与**溢出判定；`maxTokens > contextWindow` 也不报错（被 `clampMaxTokensToContext` 静默夹取）。
- 触发变量是"每轮末步 `stopReason==="stop"`"：同尺寸的 `toolUse` 步全部成功（497,870 成功 vs 497,869 失败）。

**真实失败会话（不是当前会话）**：`session-6b9b6c3f…`（工作区 `Dexterous_Hand_23Dof`），同一会话时间线实测：
```
17:46:45  request/context contextWindow=262144 model=deepseek-v4.1-flash
17:48:42  ❌ CONTEXT_WINDOW_EXCEEDED（assistant/chunk）
17:52:46  ❌ 同
17:56:24  ❌ 同
────────── 18:04 热载修复 ──────────
18:07:32  request/context contextWindow=1000000
18:08:45  turn/end（无失败）
```

**修复**：45 个未声明条目按「证据优先保守档」补齐 40 条（E1 同文件条目 7 条 / E2-cat 本机 pi-ai 目录同名规格 28 条 / E3 无证据兜底 1000000 5 条），5 条非对话模型（`veo3.1-fast`、`veo3.1-pro`、`gemini-3.1-flash-image-preview` 及 `-2k/-4k`）按裁决不填。落地脚本与校验见 `.workspace/acceptance-probe/fill-context-windows.py`；校验输出：`adam 条目数: 50 | 已声明 contextWindow: 45`、`opencode-go 块逐字节未变: True`。
保守档下调的 10 条（目录同名证据远低于 1000000）：`claude-haiku-4-5` / `claude-opus-4-5` → 200000、`glm-4.7` / `glm-5` → 204800、`gpt-5.4` / `gpt-5.5` / `gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna` → 272000、`gpt-5.4-mini` → 400000。

**热载实锤（同进程、未重启，PID 仍为 3411549）**：`request/context` 事件 `17:46:02 → contextWindow 262144`、`18:04:17 → contextWindow 1000000`。

**受压探测把真实窗口夹死**（脚本与原始响应见同目录 `probe-context-window.sh` / `-round2.sh` 与 `probe-context-window*.log`）：

| 实际 prompt_tokens | 结果 |
|---|---|
| 833,612（对照复跑） | ✅ 200 |
| **998,887** | ✅ **200** |
| ≈1,055,800（chars 5,236,767） | ❌ 500 |
| ≈1.46M / ≈2.58M（第一轮） | ❌ 500 |

→ **只能确证下界**：`≥ 998,887`（该尺寸实测被接受）。**上界不成立，先前推论已作废**：18:17:30 一个 `inputTokens=0` 的**零尺寸**请求同样被
```
503 {"code":"model_not_found","message":"No available channel for model deepseek-v4.1-flash under group auto (distributor)"}
```
拒掉（`llm/retry` 重试 5 次后 `turn/end` reason=error）⇒ 三次"大尺寸被拒"（≈1,055,800 / ≈1.46M / ≈2.58M，错误码 `get_channel_failed`）**与请求尺寸无关**，是同一类**渠道路由故障**，不能当作窗口边界证据。
**用户补充事实**：该公司自建网关对 `deepseek-v4.1-flash` 的路由本身就有问题（本次故障即源于此，与窗口无关）。
因此 `deepseek-v4.1-flash: contextWindow: 1000000` 的依据仅为"≥998,887 实测接受"这一下界，**不是**测得的真实上限；该值与 2^20 的一致性只是巧合级旁证，不足以当结论。
待办（未做）：`probe-channel-availability.sh`（v4.1-flash vs v4-flash 各 10 次极小请求的通道可用率对比）**已写好但按你的指示未运行**（已知网关问题，不再消耗配额）。

### 3.7 baseURL 尾斜杠判定 ✅ 结案：provider 层无害，真凶是 vision-adam 手写拼接 — `.workspace/acceptance-probe/fact-baseurl-slash.md`

- `adam` provider 的 `baseURL: …/v1/`（带尾斜杠）**无害**：`pi-ai/dist/api/openai-completions.js:507` 原样透传，而 OpenAI SDK `openai/client.js:224` 会 `baseURL.endsWith('/') && path.startsWith('/') ? path.slice(1) : path` 切掉前导斜杠；本地实测两种写法拼出的 URL 完全相同（`…/v1/chat/completions`）。
- 真正踩坑的是 `dsh-vision-adam/lib/index.js:161` 的手写 `` fetch(`${options.baseURL}/chat/completions`) ``（无消重），运行态实锤 `"Error: Invalid URL (POST /v1//chat/completions)"` 出现 10 次，**失败工具是 `analyze_image`**；且该文案是**网关 404 响应体**而非 Node 抛错（实测 Node fetch 不规范化 `//`）。
- **已加固**：该行改为先归一化 `.replace(/\/+$/, "")`；部署位与 `.workspace/dsh-vision-adam-src` 逐字节一致（`f331b3d8…`），`node --check` 通过，归一化行为本地实测三种输入均产出单斜杠 URL。
- 另按裁决去掉 provider 层尾斜杠（消除对 SDK 消重的单一依赖）。

### 3.8 `agent-default-model` 的三次变更（含一次我自己的错误处置，已按你的纠正撤销）

时间线（全部实测）：
| 时刻 | 值 | 谁 | 依据 |
|---|---|---|---|
| ~17:45 之前 | `deepseek-v4.1-flash` | 既有裁决「三处统一」 | — |
| **18:06:44** | `deepseek-v4-flash` | **你** | 另一会话因 `deepseek-v4.1-flash` 不可用，切到可用的 v4 应急 |
| **18:12:39** | `deepseek-v4.1-flash` | **我** | ❌ **我的误判**：我把它当成"窗口故障导致的临时规避"，而窗口已在 18:04 修好，于是按现行裁决恢复了 |
| **18:27** | `deepseek-v4-flash` | **我（按你的纠正撤销上一步）** | 你指出根因是**公司自建网关对 `deepseek-v4.1-flash` 的路由本身有问题**，与窗口无关 |

**教训（记录在案）**：我在"窗口已修好 ⇒ 应急规避可以撤销"这一步做了**未经确认的因果推断**——把用户的操作归因到我自己刚修的那个故障上，而真实原因是另一个（网关路由）。正确做法是先问"这次切换是因为窗口吗"，再决定是否恢复。报告此处保留原始判断痕迹，不抹掉。
现状：`agent-default-model = adam/deepseek-v4-flash`；45 条 `contextWindow` 声明保留（窗口修复本身与本次回退无关，且下界实测有效）。

---

## 4. 待你操作 / 已执行裁决

**你已完成的目视/实测确认（2026-09-17 18:31）**
1. ✅ 设置 → 「子代理模型」可见、可读写、保存即热生效（对应 §2 P1-6）。
2. ✅ btw 抽屉默认 `deepseek-v4.1-flash`、下拉三值（对应 §2 P1-5）。
3. ✅ 贴图实测：会话内 image part + request-image 落盘（对应 §2 P1-7）。

**本轮已执行的裁决（逐项落地证据见上）**
| 裁决 | 落地 |
|---|---|
| S21 显式模型选择 → **否决启用** | 未改任何开关；FEATURE-MAP §二 S21 行补入定性（缺宿主半边、启用即 throw） |
| preset 热重载 → **不做** + 顺手修正注释 | `~/.dsh/profiles/web/cordis.patch.yml:8-16` 注释改为与代码一致（新建会话已热；不热的是改动前已存在的会话） |
| 历史大文件 → **路线 A**（保留历史 + 停止跟踪 venv） | `git rm -r --cached` 1817 文件 + `.gitignore`；历史未动 |
| overflow → **只加 contextWindow + 给其余条目补齐** | 40 条落地（证据优先保守档），`deepseek-v4.1-flash` 保持 1000000（仅下界 ≥998,887 实测支撑，上界未确证，见 §3.6 更正） |
| 主默认模型 → **改回 `deepseek-v4-flash`** | 你的纠正：根因是公司自建网关对 v4.1 的路由问题，与窗口无关；我 18:12 的恢复属误判已撤销，见 §3.8 |
| 三处路由范围 → **只改主会话，subagent / btw 保持 v4.1-flash 不动** | 未改 `dsh-subagent` 段、未改 `dsh-btw.model.default`；已知它们会间歇撞同一网关故障（本会话已有一个复核档因此中断） |
| overflow 后续 → **本轮做受控加压探测** | 两轮探测完成，窗口夹到 (998,887, ≈1,055,800]，见 §3.6 |
| 附带修复：vision-adam 加固 / 去 provider 尾斜杠 / vitest 断言加固 / 残渣清理 | 全部完成，见 §3.2 / §3.3 / §3.7 |
| 修复产物去向 → 本地 commit + push | 见 §6 |

**仍未做（如实列出）**
- 历史重写（B-lite）—— 已裁决先不做；如需瘦身再开一轮（前提条件见 brief-history-bigfile.md §2.B）。
- `dsh-ssh-gui` / `dsh-workerspace` 真机实测 —— 你本轮选择不接真机（未排期）。
- `deepseek-v4.1-flash` 之外的 adam 条目窗口**均为声明值而非实测**（只有 v4.1-flash 做过受压探测）；E2-cat 来源是本机 pi-ai 目录的第三方规格数据，非网关实测。

---

## 5. 本轮后台事实档与产物

| 报告 | 结论一句话 |
|---|---|
| `.workspace/acceptance-probe/live-vs-disk.md` | 3080 上是**新进程**（重启已发生）；启动窗口后被主代理实测定位为 17:45:39 |
| `.workspace/acceptance-probe/preflight.md` | 冷面装载 **GO**；红灯 R1 = 回滚 glob 失效（已修） |
| `.workspace/acceptance-probe/brief-s21.md` | S21 **否决**（缺宿主半边，启用即 throw） |
| `.workspace/acceptance-probe/brief-preset-hot.md` | preset 热化**不做**；机制纠正：新建会话已热 |
| `.workspace/acceptance-probe/brief-history-bigfile.md` | mgr.tgz 51.08 MiB 确在历史；"持续告警"不成立；扩散源实为 `.venv-ppt-test` |
| `.workspace/acceptance-probe/rootcause-context-overflow.md` | 默认窗口 262144（`:849`）→ 客户端预估误判；真实失败会话 `6b9b6c3f` |
| `.workspace/acceptance-probe/context-window-table.md` | 45 条逐项取值表（E1 7 / E2-cat 28 / E3 5 / N/A 5）+ 高风险清单 |
| `.workspace/acceptance-probe/fact-baseurl-slash.md` | provider 层尾斜杠无害；真凶是 vision-adam 手写拼接（已加固） |
| `.workspace/acceptance-probe/probe-context-window{,-round2}.sh` + `.log` | 受压探测脚本与原始响应（窗口 ∈ (998,887, ≈1,055,800]） |
| `.workspace/acceptance-probe/fill-context-windows.py` | 40 条落地脚本（含 N/A 排除与主模型恢复） |
| `.workspace/acceptance-probe/probe-channel-availability.sh` | **已写好未运行**：v4.1-flash vs v4-flash 通道可用率对比脚本（按你指示不再消耗配额） |
| `.workspace/acceptance-probe/push-log3-GH001-archive.txt` | 原 `push-log3.txt` 关键内容归档（原件已删） |

---

## 6. 本轮改动清单（commit 前）

| 文件 | 改动 |
|---|---|
| `~/.dsh/settings.yaml` | adam 40 条补 `contextWindow`（证据优先保守档）；provider `baseURL` 去尾斜杠；`agent-default-model` 恢复 `deepseek-v4.1-flash`（备份 `settings.yaml.cwfill-20260917-181239.bak`、`…acceptance-20260917-180406.bak`） |
| `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js` + `.workspace/dsh-vision-adam-src/lib/index.js` | baseURL 归一化 `.replace(/\/+$/, "")`（两份逐字节一致 `f331b3d8…`） |
| `~/.dsh/profiles/web/cordis.patch.yml` | 第 8-16 行注释按源码事实修正 |
| `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-goal-round-driver/lib/index.js` | R1 加固：两处归因失败分支加 `ctx.logger.warn`（仅日志、零行为变更；**冷面，待下次重启生效**；sha `4351e1742d3a…`；diff 见 `.workspace/acceptance-probe/goal-r1-warn.diff`） |
| `.gitignore` | 新增 venv 测试环境与用户截图两条 |
| `dsh-btw/tests/host-opening.spec.ts` | 固定 tick 轮询 → wall-clock 条件等待 |
| `.workspace/RESTART-ACCEPTANCE.md` | 顶部状态更新（重启已完成）+ §3 回滚表修正（R1 glob、嵌套包路径、btw 备份黄灯） |
| `.workspace/NEXT_SESSION_PROMPT.txt` | 顶部 7 条勘误（重启/HEAD/settings 段/goal 归类/尾斜杠归属/包路径/新增事实） |
| `FEATURE-MAP.md` | §一/§二 状态更新 + S21 定性 + §二·附 新增 5 行验收批次修复 + §三 preset 机制纠正 |
| `README.md` | 「改 settings 想立即生效」补热载面 + 新增 overflow 排查入口 |
| `.workspace/acceptance-exec.md` + `.workspace/acceptance-probe/**` | 本报告与全部证据档 |
