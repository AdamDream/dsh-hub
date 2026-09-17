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

⏳ **目视项（需你确认）**：打开 btw 抽屉 → 选择器应显示 `deepseek-v4.1-flash`，下拉为 `v4.1-flash / glm-5.3 / deepseek-v4-pro` 三值。

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

⏳ **目视项（需你确认）**：设置 → 「子代理模型」可读写 provider/model，保存即热生效。

### P1-7 vision 原图直传 ⚠️ 结构证据齐备 + 需重启后新贴一张图

已取到的证据：
- **能力声明**：`settings.yaml` `adam.deepseek-v4.1-flash` 条目 `input: [text, image]`（同 provider 的 `deepseek-v4-flash` **故意未声明**）。
- **真实多模态实测**（`.workspace/mmt-probe/RESULTS.md`）：v4.1-flash 原生识图可用（UI 截图大字/色值逐字命中 **15/17**）；对照组 `deepseek-v4-flash` 自述看不到图、`content` 空。
- **请求图落盘**：`~/.dsh/attachments/v1/request-images/3f/3f0fc7f1…`（201,992 B，2026-09-17 16:42）。
- **会话内的 image part**：`session-bc0b7655-…` 中出现 `"type":"image"`（mtime 17:45，即**重启前**的那次直传）。

⏳ **缺的最后一步（需你操作）**：重启后**新贴一张图**并发送，然后核对：
```
S=$(zstd -dc ~/.dsh/sessions/--home-CNS2026495165-dsh--/<你的会话>/session.jsonl.zstd | grep -c '"type":"image"')
ls -t ~/.dsh/attachments/v1/request-images/*/* | head -3
```
（我可以代跑，你只需贴图。判据：出现新的 request-image 文件 + 会话内 image part 计数 +1。）

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

→ 真实窗口 ∈ **(998,887, ≈1,055,800]**，与 2^20 = 1,048,576 吻合 ⇒ `deepseek-v4.1-flash: contextWindow: 1000000` 有实测支撑且不越界。
**重要副产物**：该网关对超窗请求**不返回长度错误文案**，而是 `{"code":"get_channel_failed","message":"分组 auto 下模型 … 的可用渠道不存在"}` —— 客户端窗口声明不准时，排障会被误导到"渠道路由"方向。

### 3.7 baseURL 尾斜杠判定 ✅ 结案：provider 层无害，真凶是 vision-adam 手写拼接 — `.workspace/acceptance-probe/fact-baseurl-slash.md`

- `adam` provider 的 `baseURL: …/v1/`（带尾斜杠）**无害**：`pi-ai/dist/api/openai-completions.js:507` 原样透传，而 OpenAI SDK `openai/client.js:224` 会 `baseURL.endsWith('/') && path.startsWith('/') ? path.slice(1) : path` 切掉前导斜杠；本地实测两种写法拼出的 URL 完全相同（`…/v1/chat/completions`）。
- 真正踩坑的是 `dsh-vision-adam/lib/index.js:161` 的手写 `` fetch(`${options.baseURL}/chat/completions`) ``（无消重），运行态实锤 `"Error: Invalid URL (POST /v1//chat/completions)"` 出现 10 次，**失败工具是 `analyze_image`**；且该文案是**网关 404 响应体**而非 Node 抛错（实测 Node fetch 不规范化 `//`）。
- **已加固**：该行改为先归一化 `.replace(/\/+$/, "")`；部署位与 `.workspace/dsh-vision-adam-src` 逐字节一致（`f331b3d8…`），`node --check` 通过，归一化行为本地实测三种输入均产出单斜杠 URL。
- 另按裁决去掉 provider 层尾斜杠（消除对 SDK 消重的单一依赖）。

### 3.8 `agent-default-model` 于 18:06:44 被第三方改动（已核实为用户应急切换并恢复）

- 实测：`agent-default-model.model` 在 **18:06:44** 由 `deepseek-v4.1-flash` 变为 `deepseek-v4-flash`（我 18:04 的备份里仍是 v4.1-flash，且我只改过 `contextWindow` 与 provider `baseURL`）。
- 用户确认：是其在另一会话因 4.1 窗口故障不可用时**临时应急**切到已声明窗口的 v4-flash。
- 处置：窗口已在 18:04 修好且经受压探测确证，故于 **18:12:39** 恢复为 `deepseek-v4.1-flash`（三处统一裁决不变）。恢复后同一失败会话在 18:07 之后已无溢出失败记录。

---

## 4. 待你操作 / 已执行裁决

**需你动手（2 项目视 + 1 项贴图）**
1. 设置 → 「子代理模型」是否可见、可读写、保存后是否热生效（对应 §2 P1-6）。
2. btw 抽屉默认是否显示 `deepseek-v4.1-flash`，下拉是否三值（对应 §2 P1-5）。
3. 贴一张图并发送，我核对 image part 与 request-image 落盘（对应 §2 P1-7）。

**本轮已执行的裁决（逐项落地证据见上）**
| 裁决 | 落地 |
|---|---|
| S21 显式模型选择 → **否决启用** | 未改任何开关；FEATURE-MAP §二 S21 行补入定性（缺宿主半边、启用即 throw） |
| preset 热重载 → **不做** + 顺手修正注释 | `~/.dsh/profiles/web/cordis.patch.yml:8-16` 注释改为与代码一致（新建会话已热；不热的是改动前已存在的会话） |
| 历史大文件 → **路线 A**（保留历史 + 停止跟踪 venv） | `git rm -r --cached` 1817 文件 + `.gitignore`；历史未动 |
| overflow → **只加 contextWindow + 给其余条目补齐** | 40 条落地（证据优先保守档），`deepseek-v4.1-flash` 保持 1000000（实测支撑） |
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
| `.workspace/acceptance-probe/push-log3-GH001-archive.txt` | 原 `push-log3.txt` 关键内容归档（原件已删） |

---

## 6. 本轮改动清单（commit 前）

| 文件 | 改动 |
|---|---|
| `~/.dsh/settings.yaml` | adam 40 条补 `contextWindow`（证据优先保守档）；provider `baseURL` 去尾斜杠；`agent-default-model` 恢复 `deepseek-v4.1-flash`（备份 `settings.yaml.cwfill-20260917-181239.bak`、`…acceptance-20260917-180406.bak`） |
| `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js` + `.workspace/dsh-vision-adam-src/lib/index.js` | baseURL 归一化 `.replace(/\/+$/, "")`（两份逐字节一致 `f331b3d8…`） |
| `~/.dsh/profiles/web/cordis.patch.yml` | 第 8-16 行注释按源码事实修正 |
| `.gitignore` | 新增 venv 测试环境与用户截图两条 |
| `dsh-btw/tests/host-opening.spec.ts` | 固定 tick 轮询 → wall-clock 条件等待 |
| `.workspace/RESTART-ACCEPTANCE.md` | 顶部状态更新（重启已完成）+ §3 回滚表修正（R1 glob、嵌套包路径、btw 备份黄灯） |
| `.workspace/NEXT_SESSION_PROMPT.txt` | 顶部 7 条勘误（重启/HEAD/settings 段/goal 归类/尾斜杠归属/包路径/新增事实） |
| `FEATURE-MAP.md` | §一/§二 状态更新 + S21 定性 + §二·附 新增 5 行验收批次修复 + §三 preset 机制纠正 |
| `README.md` | 「改 settings 想立即生效」补热载面 + 新增 overflow 排查入口 |
| `.workspace/acceptance-exec.md` + `.workspace/acceptance-probe/**` | 本报告与全部证据档 |
