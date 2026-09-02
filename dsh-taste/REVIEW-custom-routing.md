# 复核报告：custom 路由提前落地（P1 §4/§10.5）

**结论：PASS（0 blocker / 0 issue）**
**复核时间**：本轮独立复核（子代理，未看到主代理任何前置结论）
**基线**：M0 终审 PASS 106/106；本次 +3 用例 → 109/109

---

## 一、亲跑验证（实测输出）

```
$ cd /home/CNS2026495165/dsh/dsh-taste && node --test "test/*.test.js"
# tests 109 / # pass 109 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0
```

```
$ node -e "import('.../lib/index.js').then(m=>console.log(m.inject.join(',')))"
agents,commands,systemPrompt
```

inject 数组未变，与 M0 一致。

---

## 二、方案符合性（4 处逐点核对）

| # | 改动点 | 结论 | 说明 |
|---|---|---|---|
| 1 | lib/config.js 白名单 | ✅ | `modelMode` 白名单 `"inherit" \| "custom"`，其余（含 `""`/`"CUSTOM"`/`7`/`null`/`undefined`）归一为 `DEFAULT_CONFIG.observer.modelMode`（=`"inherit"`）；`provider`/`model` 继续 `stringOr` 透传（默认 `""`）。注释由 "M0 ships inherit only" 改为 §4/§10.5 白名单语义。 |
| 2 | lib/learner.js 三分支 | ✅ | ① custom 且 provider/model 均非空 → `{ provider: observer.provider, model: observer.model }`；② custom 但缺失 → `agentOptions` 保持 `parentRoute`（父路由）+ `console.warn`，文案含 `"falling back to inherit"`；③ 其他（inherit）→ `parentAgent.options` 的 provider/model（现状不变）。`typeof === "string"` 为对直接调用的防御（config.js 已归一，双保险）。注释已更新。 |
| 3 | lib/commands.js 真实显示 | ✅ | `showModel` 改为 `async (deps)`，读 `deps.loadConfig(deps.globalDir())`；custom → `custom (provider X, model Y)`，inherit → `inherit (follows main model)`；顺带输出 `timeoutMs`/`maxTurns`。dispatch 传 `deps`。 |
| 4 | config.example.json + README | ✅ | 根目录新建完整 §8 形状，observer 节 `modelMode:"custom"`、`provider:"adam"`、`model:"deepseek-v4-pro"`；README 命令表 `/taste model` 行更新、新增 "Custom 路由" 小节（config 示例 + 字段说明 + 默认 inherit / 不跟随主模型 / 熔断不影响主会话）。 |

---

## 三、安全隔离不回退（核心关切"不用主模型是否安全"）

逐条核对，本次改动**未削弱任何一条**：

1. **custom 失败路径完整**：无效 provider/model（或 create/请求抛错）→ `runLearner` 内 `try/finally` 只包住 followup/whenIdle/dispose，`agents.withInitiator(...create)` 的抛错原样上抛 → `executeJob` → `queue.js` `schedule()` 的 catch（第 84-88 行：`failCount += 1` → `>= budget` 时置 `cooldownUntil`）→ 3 连败熔断。custom 只改变传给 `create` 的 `agentOptions`，**未绕过** queue catch。
2. **注入只读 taste.md、不依赖 learner**：`injectTasteContext` 只读 `learningEnabled`/`injection.enabled`/快照文件，**从不触碰** `observer.modelMode/provider/model`；custom 配置对注入零影响。
3. **timeoutMs 经 AbortSignal.any 融合**：learner.js 158-165 行未被改动，`signal` + `AbortSignal.timeout(timeoutMs)` 融合逻辑原样。
4. **改动面极小**：仅 config/learner/commands + example + README + 两个 test 文件；queue/storage/collector/index.js 均未触碰（git diff 确认）。

---

## 四、默认行为不变

- 不写 `config.json`：`runTasteJob` 直接 `loadConfig(globalDir)`（文件缺失 → `DEFAULT_CONFIG`，`modelMode:"inherit"`、`provider:""`、`model:""`），`runLearner` 走 inherit 分支 → `parentRoute`，与 M0 **逐字节一致**。
- index.js 的声明式 `Config` schema 与 `currentConfig()` 播种逻辑未动（且 index.js 属"不碰"清单，合规）；声明式 modelMode 从不参与 learner 路由，无行为影响。

---

## 五、范围纪律

- 未加 model set 子命令（`showModel` 只读显示）✅
- 未改 `inject` 数组 ✅
- 未碰 queue/storage/collector/index.js ✅
- 改动文件 = 严格 4 处代码 + 1 example + README + 2 test（见 git diff）✅
- 无方案外功能。

---

## 六、测试真实性

- `config.test.js` 新增 "whitelists modelMode inherit/custom and normalizes anything else to inherit"：8 种输入真实断言归一结果 ✅
- `learner.test.js`：
  - custom → `agents.calls.create[0].agentOptions` **deepEqual `{ provider: "adam", model: "deepseek-v4-pro" }`**（真实断言路由参数）✅
  - 缺 model（`model:""`）与缺 provider（`provider:42`）→ 两次 create 均回退 `{ provider: "parent-provider", model: "parent-model" }` 且 `console.warn` 捕获到 2 条 `falling back to inherit` ✅
  - inherit → 不告警、父路由（现状用例保留并强化"无 warning"）✅
- 无 commands.test.js，按规范"没有则不强加"；`showModel` 依赖的 `deps.loadConfig`/`deps.globalDir` 在 index.js 均已注入。

---

## 七、Issues

无。以下为记录在案的非问题观察（不改变 verdict，供后续 P1 set 子命令时参考）：

1. `/taste status`（commands.js:72）仍只显示 `model route: <modelMode>`（custom 时仅打印 "custom" 不含 provider/model）。属 spec 范围外（本次仅要求 `/taste model` 子命令），且为只读展示，非缺陷。
2. 非法 custom 配置（modelMode:"custom" 但 provider/model 空）下，`/taste model` 显示 `custom (provider (unset), model (unset))` 而非提示"已回退 inherit"。显示的是真实 config，属可接受的忠实展示；如后续想消除歧义可在此处同步提示回退。
3. `provider`/`model` 不做 `trim`（与全项目 `stringOr` 一致，无任何 trim 先例），纯空白串会被当"非空"传入 create → create 抛错 → 走熔断，安全失败，非漏洞。

---

## 八、blocker 判定

- 方案未落实？否（4 处 + example + README 全落实）
- 隔离被削弱？否（熔断/注入解耦/超时融合三条现行有效）
- 测试不绿？否（109/109）
- 默认行为改变？否（无 config.json 与 M0 逐字节一致）

→ **无 blocker，仅 minor → PASS**。
