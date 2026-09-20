# lag-fix-audit：subagent 多开卡顿修复【审计】— 盘面核实与交付单元清单

> 阶段：三阶段闭环 · 审计（只读）。路由：adam/deepseek-v4-flash。
> 审计时间：2026-09-12。只读核实真实代码/文件 + 本报告落盘；未改动任何被审计文件
> （唯一写盘：本报告；tgz 仅解包到 `.workspace/tmp-tgz-audit/` 只读核对）。
> 前置输入已全部读完：`lag-audit-mechanism.md`、`lag-audit-diff.md`、`execution-2b.md`、
> `~/dsh-upgrade-backup/patched-official-files.tgz`、live 全局树 4 包、`~/.dsh/settings.yaml`、
> `.workspace/deploy/vision-adam/lib/index.js` 与 `settings-vision-adam.snippet.yaml`。

---

## 0. 结论摘要（先看这里）

用户已裁决 4 项，本审计逐项核实盘面可行性：

| 裁决 | 盘面核实结论 | 落地单元 |
|---|---|---|
| ① 恢复 3 个丢失补丁 | **可行，证据完整**：tgz 含且仅含 3 个补丁文件；agent-loop 补丁与 execution-2b.md 逐字一致；3 个补丁对 live 原厂文件 **patch --dry-run 全部 CLEAN MERGE**（上下文精确匹配） | U-1 / U-2 / U-3 |
| ② 加固 apiproxy SSE mux 订阅过滤 + FrameQueue 有界化 | **部分可行（如实报告）**：有界化完全可行、精确可落地（U-5）；「会话级订阅过滤」在当前架构下**纯服务端改动无法降帧**——mux WS 为 downlink-only（客户端消息直接 1008 关闭），HTTP RPC 无连接令牌、不可寻址到具体 queue，服务端没有任何「消费者关注哪些会话」的信号源；能落地的只有「订阅集合 seam + 过滤」（订阅=全量，行为零变化，U-4）。**真实降帧由 ②b（U-1：子代理 chunk 根本不落盘 → 根本不进 mux）+ U-5 封顶承担**。按「可见会话」过滤需协议级改动（dsh-client-connection 放宽 downlink-only + mux 订阅信封 + 客户端上报可见会话集），列为后续项，本修复不做 | U-4（seam）/ U-5（有界化） |
| ③ 重放脚本固化 | **可行**：工具链齐全（node v22 / bash 5.2 / patch / diff / cmp / tar / python3+pyyaml / 全局树内 node `yaml` 包均实测可用）；tgz 与脚本均在 npm 全局树之外，重装不抹；规格见 U-9 与 §4 | U-9 |
| ④ adam/deepseek-v4-flash 与 opencode/deepseek-v4.1-flash token 上限 → 990000 | **可行**：adam 条目现值 786432（settings.yaml L80，唯一出现）；opencode-go 当前**无** v4.1-flash 条目（需新增）；vision-adam 的 maxTokens=2000 不受影响（识图专用预算，lib 默认 2000 不动、settings 显式 2000 优先，二者相等无冲突） | U-6 / U-7 / U-8 |

**一句话**：4 项裁决全部可落地；② 中「订阅过滤」的降帧预期需修正为「②b + 有界化」承担，seam 照建（低成本、零破坏、留钩子）。

---

## 1. tgz 补丁核实（证据）

### 1.1 tgz 内容与目标路径（`tar -tzf ~/dsh-upgrade-backup/patched-official-files.tgz`）

tgz 内**恰好 3 个文件**（无目录前缀、无其它文件），目标路径（相对 tgz 根）与 live 落点：

| # | tgz 内路径 | 字节 | live 落点（全局树） | 类型 |
|---|---|---|---|---|
| 1 | `dsh-agent-loop/lib/index.js` | 48,119 | `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js` | ②b 非流式（关键机制） |
| 2 | `dsh-client-ui-subagent/lib/client.js` | 42,608 | `…/dsh-client-ui-subagent/lib/client.js` | tok/s 显示 |
| 3 | `dsh-web-search-deepseek/lib/index.js` | 13,746 | `…/dsh-web-search-deepseek/lib/index.js` | x-opencode-session 请求头 |

已知良 sha256（审计实测，供脚本校验锚点）：
- agent-loop: `b20d42dcf3aa8f5775cb6e50abe278b1539cd2277c8647daab0733cfcbfc53e6`
- ui-subagent: `ac7cbb972b126c7770a0c494c60795e2114ce642e2fc3a1d98c946fce9a31a04`
- web-search: `9e48db07dcaed014f7ad2a487deec9e421a01c52afa3d994c8820c7d481f579c`

### 1.2 与 execution-2b.md 的一致性（②b）

tgz 内 agent-loop 与 live 原厂的 diff **精确等于 execution-2b.md L6-15 描述的两处改动**（无第三处、无差异）：

```diff
@@ step() L611 之后
+		const isSubagent = (this.options.subagentDepth ?? 0) > 0 || (this.session.header?.delegationDepth ?? 0) > 0;
@@ L621 逐 chunk append
-					chunkSeqs.push(this.session.append("assistant/chunk", {
+					if (!isSubagent) chunkSeqs.push(this.session.append("assistant/chunk", {
```

`assembler.push(chunk)` 在 `if (!isSubagent)` **之外**（保持逐字组装，最终 assistant/message 内容不变）——与 execution-2b.md L52 复核结论一致。live 树 `grep isSubagent` = 0（确认当前缺失）。

### 1.3 与 live 原厂的合并性（结论：**干净合并，无需重新锚定**）

live 三文件 = 原厂 0.1.1-rc.2（字节数 47,991 / 41,404 / 13,698 与 lag-audit-diff §2 基线一致，mtime 09-12 14:56 全新重装）。审计生成三份 unified diff（live→tgz）并 `patch --dry-run -p0` 实测：

| 补丁 | hunks | dry-run | 结论 |
|---|---|---|---|
| agent-loop | 2 | **CLEAN MERGE** | 上下文精确匹配 live 原厂，patch(1) 可直用 |
| ui-subagent | 4 | **CLEAN MERGE** | 同上 |
| web-search | 1 | **CLEAN MERGE** | 同上 |

两份 dry-run patch 产物在 `.workspace/tmp-tgz-audit/{pkg}.patch`（可复用于执行档，或直接走 tgz 解包 cp）。**推荐应用方式 = 从 tgz 解包后 cp 覆盖**（整文件字节替换，sha256 可校验，比 patch 更简单稳妥）；patch 方式亦可用。两种方式均不影响主会话打字机与 btw（门控条件 `depth>0`，depth=0 原样流式）。

---

## 2. 加固设计核实（读 live `dsh-host-apiproxy/lib/index.js` 真实代码）

### 2.1 (a) mux 会话级订阅过滤 — 现状与最小改动点

**现状（逐行核实）**：
- `mux(_request, signal)` 路由：**L3524**；每消费者一个 `new FrameQueue()`（**L3525**）；`muxQueues.add(queue)`（**L3526**）；连接时对**所有** live 会话 `subscribeSession(queue, session)`（**L3527**）。
- `subscribeSession`（**L1158-1165**）：只 push 一条 `session/subscribed` baseline 帧（`lastSeq: session.seq - 1`），**不维护任何订阅集合**。
- `ctx.on("session/event", (session, event) => {...})`（**L3556-3574**）：**无会话过滤** —— 每个 live 会话（主会话 + 全部子代理 + btw）的每个事件都 `queue.push(frame({type:"session/event", sessionId: session.id, event, view}))`（L3569-3573，`session.id` 即会话关联字段；viewFor 在 L3568）。新会话在 `session/created`（**L3576**）里自动 subscribeSession（**L3577**）。
- 会话→浏览器推送的目标集合 = 每个消费者的独立 queue（muxQueues L1672 是所有 queue 的集合；但 session/event 走的是**每连接各自的监听器闭包**，不是 `for (const queue of muxQueues)` 广播——后者（L1782/1889/1953）只用于 session/projection / question/requested / approval/requested，与本次改动无关）。
- 会话关联字段：`session.id`（事件钩子参数 + 帧内 `sessionId`）；`subscribeSession` 用 `session.id` + `session.seq`。

**最小改动点（seam，精确行号）**：
1. `mux()` 内 L3525 之后：`const subscribed = /* @__PURE__ */ new Set();`
2. `subscribeSession`（L1158）签名加参：`function subscribeSession(queue, subscribed, session)`，函数体内加 `subscribed.add(session.id);`（保留原 baseline 帧 push）。
3. 两处调用点传参：L3527 `subscribeSession(queue, subscribed, session)`；L3577 同。
4. `session/event` 监听器（L3556 之后、openCalls 处理之前）加一行：`if (!subscribed.has(session.id)) return;`

**行为**：连接时订阅全部 live 会话 + 新会话自动订阅 → 过滤恒真 → **与现状完全一致（零降帧、零破坏）**；为将来客户端驱动订阅留好 seam。

**为何纯服务端无法真正降帧（关键审计发现，证据）**：
- mux 是 WebSocket 且 **downlink-only**：`dsh-client-connection/lib/index.js` L429-431 `websocket.once("message", () => websocket.close(1008, "downlink only"))`，注释明言「Client messages are a protocol violation: upstream traffic remains on HTTP」→ 客户端无法在流上声明会话兴趣。
- 上行走 HTTP unary RPC（`/api/<method>`），与 mux WS **无连接令牌**（WS URL 无 query token，RPC 载荷无连接标识）→ 任何「订阅 RPC」无法寻址到具体 queue。
- 服务端可观察的会话兴趣信号不存在：sessions 路由（list/search/create/history/models/selectModel/rename/fork/prompt/attachment）与 subagents 路由（list/history/prompt）均为 unary，无 watch/select/activate；浏览器切换会话是纯 UI 本地状态（client-modules 无 api 调用）。
- 结论：按「消费者已订阅的会话」过滤需客户端上报可见会话集 → 协议级跨包改动（dsh-client-connection + host-apiproxy + 客户端调用点），与「最小改动」矛盾，且 0.1.5（web2）也无此机制可参照（web2 树全盘 grep `session/subscribed` = 0，事件线已重构）。

**降帧真相**：②b（U-1）恢复后，子代理 chunk 事件**根本不 append → 根本不 emit → mux 监听器根本不触发**；残余子代理 mux 流量 = 每轮 ~4-6 条（turn/start、turn/end、tool/call、tool/result、assistant/message），帧风暴主体已消失。U-5 封顶兜底浏览器积压场景。

### 2.2 (b) FrameQueue 有界化 — 现状与最小改动点

**现状（L1095-1127，逐行核实）**：`buffer = []` **无界**（L1096）；`push(item)`（L1099-1103）无条件 `this.buffer.push(item)` + `this.waiter?.()`；`iterate(signal, cleanup)`（L1108-1126）是 async generator：`while (buffer.length > 0) yield buffer.shift()` + waiter 等待。生产路径 = 各监听器 `queue.push(...)`（含 session/event、session/projection 广播等）；消费路径 = SSE/WS 帧泵（`dsh-client-connection` `pump`：`for await (const frame of frames) await send(socket, frame)`）——浏览器渲染跟不上 → socket 背压 → buffer 无限增长（内存）＋每帧完整事件对象。FrameQueue 仅两处实例化：mux（L3525）与 host（L3610）。

**最小改动（精确改法）**：
1. L1094（FrameQueue 类注释行之前）加模块级常量：
   ```js
   /** SSE 帧队列上限：溢出丢最旧帧保 UI 响应（仅在消费者积压时触发）。 */
   const MAX_QUEUED_FRAMES = 4096;
   ```
2. `push()`（L1099-1103）改为：
   ```js
   push(item) {
       if (this.done) return;
       if (this.buffer.length >= MAX_QUEUED_FRAMES) this.buffer.shift();
       this.buffer.push(item);
       this.waiter?.();
   }
   ```

**语义/影响**：正常流量 buffer≈0、零丢弃；仅当消费者（浏览器）长期跟不上时封顶内存并丢最旧帧，新帧（含最终的 assistant/message、done 类事件）优先送达 → 保 UI 响应。mux 与 host 两条流共用该类，均封顶（host 流量低，实际不触发）。**丢帧只影响「推送到浏览器」的实时流，会话日志（真相源）不受影响**——不产生数据丢失，只可能有实时缺帧（刷新/历史回拉可补齐，客户端补偿路径细节见 §6 未确认项）。

**不破坏主会话打字机与 btw**：主会话/btw 为 depth=0 逐 chunk 流式，其 chunk 帧正常入队出队；封顶仅在积压 ≥4096 帧的极端场景丢**最旧**帧（通常是早已渲染过的早期 chunk），打字机后续帧照常；②b 下子代理无 chunk 帧可丢。

---

## 3. settings 变更规格

### 3.1 当前值与确切键路径（`~/.dsh/settings.yaml`，逐行核实）

| 键路径 | 当前值 | 行号 | 备注 |
|---|---|---|---|
| `llm-pi-ai.providers.adam.models[].maxTokens`（id=`deepseek-v4-flash`） | **786432** | L80（`maxTokens: 786432` 全文件唯一） | 主 agent 默认模型（`agent-default-model` L132-134 = adam/deepseek-v4-flash） |
| `llm-pi-ai.providers.opencode-go.models[]`（id=`deepseek-v4.1-flash`） | **不存在** | — | 同族 `deepseek-v4-flash` 在 L22-25（contextWindow 1000000 / maxTokens 384000）；`deepseek-v4.1-flash` 已确认存在于 opencode 网关（GET /v1/models 实测，`oc_models.json`/probe） |
| `llm-pi-ai.providers.opencode-go.models[].maxTokens`（id=`deepseek-v4-flash`） | 384000 | L25 | **不在裁决范围，不改** |
| `vision-adam.model` / `vision-adam.maxTokens` | `glm-5.3-flash` / `100000` | L136 / L137 | 将被 snippet 段整体替换（见 U-8） |

配置加载机制：`dsh-settings-file/lib/index.js` 用 chokidar watch（`watch: config.watch ?? true`，L37）→ settings.yaml 大概率热重载；llm-pi-ai 模型目录对已建会话的生效时机未逐一确认（标「未确认」），建议重启 DSH 验证。vision-adam 新 lib 已产出（`.workspace/deploy/vision-adam/lib/index.js`），`DEFAULT_MAX_TOKENS = 2000`（L39）不动；snippet settings 显式 `maxTokens: 2000`（settings 优先，二者相等无冲突）。

### 3.2 改为 990000 的最小片段

**U-6（adam）**：将 L80 `          maxTokens: 786432` 改为 `          maxTokens: 990000`（键路径 `llm-pi-ai.providers.adam.models[deepseek-v4-flash].maxTokens`）。
**U-7（opencode v4.1-flash）**：在 `llm-pi-ai.providers.opencode-go.models` 追加（与同族条目格式一致）：
```yaml
        - id: deepseek-v4.1-flash
          name: DeepSeek V4.1 Flash
          contextWindow: 1000000
          maxTokens: 990000
```
**U-8（vision-adam 段替换，按已产出 snippet `.workspace/deploy/settings-vision-adam.snippet.yaml` L17-27）**：将 L135-137 的
```yaml
vision-adam:
  model: glm-5.3-flash
  maxTokens: 100000
```
替换为
```yaml
vision-adam:
  model: deepseek-v4.1-flash
  baseURL: https://opencode.ai/zen/go/v1
  apiKeyEnv: OPENCODE_GO_API_KEY
  maxTokens: 2000
```
（其余可选键不写即回落 lib 默认：xApiKey/sessionHeader=true、maxBytes/maxVideoBytes 等。）

**合并方式结论**：lib 默认（2000）不动；settings 显式值优先（2000 = 2000，无冲突）。settings.yaml 全文件无注释，yaml 解析-改写-写回安全（pyyaml / node `yaml` 均实测可用）。sed 锚点备选：`maxTokens: 786432` 唯一（可 sed）；`vision-adam:` 唯一（可 sed 范围替换）；opencode-go 新增条目需结构化改写（`maxTokens: 384000` 出现 2 次不唯一，**不建议 sed**）。推荐 python3 pyyaml 结构化改写 + 写回前解析校验。

### 3.3 边界

- vision-adam **新 lib 的部署**（替换插件实现）属 btw-upgrade 线，不在本修复；本修复只写 settings 段。vision-adam 插件当前在 cordis.patch.yml 为 disabled（lag-audit-diff §0），settings 写入后是否生效取决于插件启用与 lib 部署（「未确认」，不阻塞本修复）。
- `agent-default-model`（adam/deepseek-v4-flash）无独立 maxTokens，随 U-6 生效。

---

## 4. 重放脚本规格（U-9）

**位置**：`/home/CNS2026495165/dsh/.workspace/deploy-lag/`（新建；含 `replay.sh` + `patches/` 目录 + `known-sha256.txt`）。
**语言**：纯 bash + node/python3（本环境 **pnpm 不可用**，勿依赖）。

**目标路径常量**（可被 `DSH_ROOT` 环境变量覆盖）：
```
ROOT=${DSH_ROOT:-$HOME/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai}
$ROOT/dsh-agent-loop/lib/index.js
$ROOT/dsh-client-ui-subagent/lib/client.js
$ROOT/dsh-web-search-deepseek/lib/index.js
$ROOT/dsh-host-apiproxy/lib/index.js
$HOME/.dsh/settings.yaml
TGZ=${PATCH_TGZ:-$HOME/dsh-upgrade-backup/patched-official-files.tgz}
```

**模式**：`--dry-run`（只打印将执行的步骤 + 运行全部前置校验，不写任何文件）；默认执行；`--rollback`（用最新备份还原）。每单元独立幂等：**已应用（锚点命中/字节全等）则跳过并提示 SKIP**。

**流程（每单元：备份 → 应用 → 校验）**：
1. **备份**：首次应用前 `cp -r` 受改包目录 → `.workspace/deploy-lag/backup-<YYYYmmdd-HHMMSS>/<pkg>/`（settings.yaml 单独 `cp`）。回滚 = `mv` 备份目录还原 + 重启。
2. **应用**：
   - U-1..U-3：`tar -xzf "$TGZ" -C <tmp>` → sha256 与 known-sha256.txt 比对（防 tgz 损坏/被换）→ `cp` 覆盖到 live 路径。
   - U-4/U-5：`patch -p0 --dry-run` 预检（context 必须命中，未命中即中止并提示需重新锚定）→ `patch -p0` 应用（patch 文件由执行档生成放 `deploy-lag/patches/`）。
   - U-6..U-8：python3 pyyaml 或 node `yaml` 结构化改写（先备份、解析失败即中止），写回后立即解析断言。
3. **校验**：按 §5 逐单元跑；任一失败 → 该单元 FAIL、脚本退出非零（不回滚，人工介入或 `--rollback`）。

**幂等锚点**：U-1..U-3 = live sha256 == known-sha256（或 `grep -q` isSubagent / formatTokensPerSecond / x-opencode-session）；U-4 = `grep -q "if (!subscribed.has(session.id)) return;"`；U-5 = `grep -q "MAX_QUEUED_FRAMES"`；U-6 = yaml 断言 adam/deepseek-v4-flash.maxTokens==990000；U-7 = yaml 断言 opencode-go 含 v4.1-flash 且 maxTokens==990000；U-8 = yaml 断言 vision-adam.model==deepseek-v4.1-flash 且 maxTokens==2000。

**固化说明**：tgz 在 `~/dsh-upgrade-backup/`、脚本在 `.workspace/deploy-lag/`，均在 npm 全局树之外——任何 `npm i -g @deepseek-ai/dsh…` 重装只会抹全局树内补丁，重装后重跑脚本即恢复（§6 风险 1）。脚本自身 `bash -n` 校验；附带运行 Runbook（重启 DSH + 观测子代理事件数，复用 execution-2b.md L33-44 模板）。

---

## 5. 验证命令清单（本环境实测可用）

| 验证 | 命令 | 适用 |
|---|---|---|
| 语法 | `node --check <file>`（4 个目标 .js 全部 ESM、当前 live 版实测全 PASS） | U-1..U-5 |
| 锚点 | `grep -n "isSubagent" …/dsh-agent-loop/lib/index.js`（应 ≥2）；`grep -n "formatTokensPerSecond" …/dsh-client-ui-subagent/lib/client.js`；`grep -n "x-opencode-session" …/dsh-web-search-deepseek/lib/index.js`；`grep -n "MAX_QUEUED_FRAMES"` 与 `grep -n "subscribed.has(session.id)"` …/dsh-host-apiproxy/lib/index.js | U-1..U-5 |
| 字节比对 | `sha256sum` 比对 known-sha256.txt；`cmp -s` live vs tgz 解包；`diff -u` 为 0 | U-1..U-3 |
| 合并预检 | `patch -p0 --dry-run < patches/xxx.patch` | U-4/U-5 |
| settings 解析 | node：`node -e "const y=require('<全局树>/node_modules/yaml');…"`（yaml 包实测可用）；或 python3：`python3 -c "import yaml; …"`（pyyaml 实测可用）——断言三条：adam v4-flash=990000、opencode-go v4.1-flash=990000、vision-adam={deepseek-v4.1-flash, 2000} | U-6..U-8 |
| 脚本语法 | `bash -n .workspace/deploy-lag/replay.sh`；先跑 `--dry-run` | U-9 |
| 运行时（重启后，执行档可选） | 派一个 subagent 调研：子代理会话 0 条 assistant/chunk、1 条 assistant/message；主会话打字机照常（execution-2b.md Runbook 复用） | U-1 验收 |

---

## 6. 风险

1. **global 重装再抹补丁（必须固化）**：任何 `npm i -g @deepseek-ai/dsh…` / `npm cache clean --force` + 重装都会再次抹掉 U-1..U-5 的 4 个被改包（0.1.1-rc.2 原厂重装）。缓解 = U-9 重放脚本（tgz + 脚本均在全局树外）+ runbook 固化「重装后重跑 replay.sh」。settings.yaml 在 `~/.dsh/` 不在 npm 树内，重装不抹。
2. **宿主侧改动需重启 DSH 生效**：agent-loop 与 host-apiproxy 为宿主加载的 ESM（`main: lib/index.js` 非 bundle），改动不热载 → 必须重启 `npx @deepseek-ai/dsh web`。client.js（ui-subagent）按请求读盘 + rev=sha1（lag-audit-diff §4），浏览器刷新即生效，无需重启。settings.yaml 有 chokidar watch（大概率热载，标「未确认」），仍建议随重启统一生效。
3. **加固对现有浏览器会话的兼容**：U-4 订阅=全量 → 现有浏览器行为逐帧不变（零破坏）；U-5 只在积压 ≥4096 帧时丢最旧帧（浏览器已卡死场景），丢帧仅影响实时推送，会话日志不受影响。应答帧（approval/question/requested）理论上也可能被丢（极低概率）——如需「应答帧永不被丢」的守卫（push 溢出时优先丢 session/event 类），属额外决策，**留给用户裁决，执行档不得自行拍板**。
4. **②b 与主会话/btw 兼容**：isSubagent 门控 `depth>0`，主会话与 btw 侧聊（depth=0）逐 chunk 流式不变；`sourceEventSeqs:[]` 仅允许在 assistant/message（execution-2b.md L21 复核 PASS）。恢复后建议按 §5 运行时 Runbook 实测打字机。
5. **settings 990000 上限**：0.99M < contextWindow 1M 自洽；adam 网关对 max_tokens 的服务端硬上限「未确认」——若网关拒绝 >某值会请求报错（执行档可先小步验证；裁决已定 990000，照做）。
6. **FrameQueue 丢帧的客户端表现**：主会话缺帧时实时消息可能出现瞬时缺口（刷新/历史回拉可补齐，机制上会话日志完整）；具体客户端补偿路径细节「未确认」。
7. **cordis.patch.yml 4 条 disabled 残留**（lag-audit-diff §0/§4）：不在本次裁决范围，本修复不动；其中 `subagent-model-selection-settings` 为 0.1.5 残留 id。恢复与否需用户确认意图（另线处理）。
8. **web2（0.1.5）参照失效**：web2 树无 `session/subscribed`（事件线已重构），不可作为 mux 过滤的参照实现（§2.1 已核实）。

---

## 7. 细粒度交付单元清单（执行档逐条落地）

> 应用顺序：U-1 → U-2 → U-3 → U-4 → U-5 → U-6 → U-7 → U-8；U-9 为封装以上全部的重放脚本。
> 每单元「目标文件」均为 live 全局树路径（`profiles/web/node_modules` 为空目录、`profiles/node_modules/@deepseek-ai/*` 为符号链接，改 profile 侧无效）。

### U-1 恢复 dsh-agent-loop ②b 非流式落盘补丁（关键机制）
- **目标文件**：`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js`
- **位置**：`step()` L611 之后插入判定；L621 门控
- **改动**（与 execution-2b.md L6-15 逐字一致，2 处）：
  1. L611 `const system = renderPrompt(assembly);` 后插入：`const isSubagent = (this.options.subagentDepth ?? 0) > 0 || (this.session.header?.delegationDepth ?? 0) > 0;`
  2. L621 `chunkSeqs.push(this.session.append("assistant/chunk", {` 改为 `if (!isSubagent) chunkSeqs.push(this.session.append("assistant/chunk", {`（`assembler.push(chunk)` 保持在外）
- **合并方式**：tgz 解包 cp 覆盖（sha256 == `b20d42dc…`）或 2-hunk patch（已 dry-run 通过，patch 在 `.workspace/tmp-tgz-audit/dsh-agent-loop.patch`）
- **验收**：sha256 全等；`grep -n isSubagent` ≥2；`node --check` PASS；重启后子代理一轮 0 条 assistant/chunk、1 条 assistant/message；主会话/btw 打字机不变

### U-2 恢复 dsh-client-ui-subagent tok/s 补丁
- **目标文件**：`…/dsh-client-ui-subagent/lib/client.js`
- **改动**：4 hunk（`formatTokensPerSecond`/`decodeTokensPerSecond` 定义 + lineage metrics 接线 + `SubagentReadOnlyComposer` speed 显示；与 lag-audit-diff §2「tok/s 显示补丁，对应 audit B9」一致）
- **合并方式**：tgz cp（sha256 == `ac7cbb97…`）或 patch（`.workspace/tmp-tgz-audit/dsh-client-ui-subagent.patch`）
- **验收**：sha256 全等；`grep -n "formatTokensPerSecond\|decodeTokensPerSecond"` ≥2；`node --check` PASS；浏览器刷新即生效（客户端补丁按请求读盘）

### U-3 恢复 dsh-web-search-deepseek x-opencode-session 补丁
- **目标文件**：`…/dsh-web-search-deepseek/lib/index.js`
- **位置**：L140 `"user-agent": USER_AGENT` 后
- **改动**：加 `,` + `"x-opencode-session": crypto.randomUUID()`（1 hunk，opencode 三头认证之一，与 vision-adam 同网关同认证）
- **合并方式**：tgz cp（sha256 == `9e48db07…`）或 patch
- **验收**：sha256 全等；`grep -n x-opencode-session` ≥1；`node --check` PASS；重启 DSH 生效

### U-4 apiproxy mux 会话级订阅过滤（seam，零行为变化）
- **目标文件**：`…/dsh-host-apiproxy/lib/index.js`
- **位置**：`mux()` L3524-3605；`subscribeSession` L1158-1165；`session/event` 监听器 L3556-3574
- **改动**（4 处）：
  1. L3525 `const queue = new FrameQueue();` 后加 `const subscribed = /* @__PURE__ */ new Set();`
  2. L1158 签名改 `function subscribeSession(queue, subscribed, session)`，函数体内（baseline 帧 push 前）加 `subscribed.add(session.id);`
  3. L3527 / L3577 调用点传 `subscribed`：`subscribeSession(queue, subscribed, session);`
  4. L3556 监听器首行加 `if (!subscribed.has(session.id)) return;`（在 openCalls 处理之前）
- **验收**：`node --check` PASS；`grep -n "subscribed.has(session.id)"` ≥1；现有浏览器会话行为不变（所有 live 会话仍全量推送）；主会话打字机/btw 不受影响。**注意**：本单元不降帧（订阅=全量），为将来客户端驱动订阅留 seam——降帧由 U-1+U-5 承担（§2.1 审计发现）

### U-5 apiproxy FrameQueue 有界化（溢出丢最旧帧）
- **目标文件**：`…/dsh-host-apiproxy/lib/index.js`
- **位置**：`FrameQueue` 类 L1095-1127；`push()` L1099-1103；常量插在 L1094（类注释前）
- **改动**（2 处）：
  1. L1094 前加：`const MAX_QUEUED_FRAMES = 4096;`（带注释：仅消费者积压时触发）
  2. `push()` 内 L1100-1102 改为：`if (this.buffer.length >= MAX_QUEUED_FRAMES) this.buffer.shift();` 后再 `this.buffer.push(item);`（丢最旧保新帧）
- **验收**：`node --check` PASS；`grep -n MAX_QUEUED_FRAMES` ≥2（定义+使用）；代码审查：正常流量零丢弃（cap 仅 ≥4096 积压触发）；内存有界。mux/host 两流共用该类均封顶。丢帧只影响实时推送、会话日志不受影响（§6-3）

### U-6 settings：adam/deepseek-v4-flash maxTokens → 990000
- **目标文件**：`~/.dsh/settings.yaml`
- **键路径**：`llm-pi-ai.providers.adam.models[].maxTokens`（id=`deepseek-v4-flash`），现值 786432（L80，唯一）
- **改动**：`maxTokens: 786432` → `maxTokens: 990000`（sed 可行；结构化改写亦兼容）
- **验收**：yaml 解析该路径 == 990000；`grep -n "maxTokens: 990000"` ≥1

### U-7 settings：opencode-go 新增 deepseek-v4.1-flash（maxTokens 990000）
- **目标文件**：`~/.dsh/settings.yaml`
- **键路径**：`llm-pi-ai.providers.opencode-go.models`（当前无 v4.1-flash；同族 v4-flash L22-25）
- **改动**：追加条目（与同族格式一致）：`- id: deepseek-v4.1-flash` + `name: DeepSeek V4.1 Flash` + `contextWindow: 1000000` + `maxTokens: 990000`（结构化改写；**勿用 sed**——`maxTokens: 384000` 不唯一）
- **验收**：yaml 解析 opencode-go.models 含 id=`deepseek-v4.1-flash` 且 maxTokens == 990000

### U-8 settings：vision-adam 段替换（按已产出 snippet）
- **目标文件**：`~/.dsh/settings.yaml`
- **键路径**：`vision-adam`（L135-137 现值 model=glm-5.3-flash / maxTokens=100000）
- **改动**：替换为 snippet（`.workspace/deploy/settings-vision-adam.snippet.yaml` L17-27）的 4 键段：model=deepseek-v4.1-flash / baseURL=https://opencode.ai/zen/go/v1 / apiKeyEnv=OPENCODE_GO_API_KEY / maxTokens=2000
- **合并方式**：新 lib 默认 DEFAULT_MAX_TOKENS=2000 不动；settings 显式 2000 优先（相等无冲突）。新 lib 部署属 btw-upgrade 线，本单元只写 settings
- **验收**：yaml 解析 `vision-adam.model == deepseek-v4.1-flash`、`vision-adam.maxTokens == 2000`、`baseURL == https://opencode.ai/zen/go/v1`、`apiKeyEnv == OPENCODE_GO_API_KEY`

### U-9 重放脚本（固化防重装再抹）
- **目标文件**：`/home/CNS2026495165/dsh/.workspace/deploy-lag/replay.sh`（+ `patches/`、`known-sha256.txt`）
- **规格**：§4 全节（备份 cp -r+时间戳 / 应用 cp 或 patch / 校验 grep+node --check+sha256 / 幂等已应用即 SKIP / `--dry-run` / `--rollback`；覆盖 U-1..U-8；目标路径 live 全局树；纯 bash+node/python3，无 pnpm）
- **验收**：`bash -n` PASS；`--dry-run` 无副作用输出正确步骤；首次运行全 PASS；二次运行全 SKIP；模拟重装（恢复原厂）后再跑全 PASS

---

## 8. 证据索引（file:line 速查）

| 证据点 | 位置 |
|---|---|
| tgz 恰 3 文件 + sha256 | `tar -tzf ~/dsh-upgrade-backup/patched-official-files.tgz`；sha256 见 §1.1 |
| agent-loop 补丁 == execution-2b.md | tgz↔live diff 仅 2 hunk（isSubagent + if 门控），与 execution-2b.md L6-15 逐字一致 |
| 3 补丁 CLEAN MERGE | `patch --dry-run -p0` 全过；patch 产物 `.workspace/tmp-tgz-audit/{pkg}.patch` |
| live 树 = 原厂（补丁缺失） | live `grep isSubagent`/`formatTokensPerSecond`/`x-opencode-session` 均 = 0；字节 47,991/41,404/13,698（09-12 14:56） |
| 解析根 = 全局树 | `profiles/web/node_modules` 空（09-12 14:44）；`profiles/node_modules/@deepseek-ai/*` → 全局树符号链接 |
| agent-loop step() 锚点 | live L611 `const system = renderPrompt(assembly);`；L621 `chunkSeqs.push(...assistant/chunk...)` |
| mux 路由 | host-apiproxy L3524 mux / L3525 queue / L3526 muxQueues.add / L3527 subscribe-all / L3528-3554 baseline 帧 / L3556 session/event 监听 / L3568 viewFor / L3569-3573 push frame / L3576 created / L3577 subscribe / L3605 cleanup |
| subscribeSession | host-apiproxy L1158-1165（仅 baseline 帧，无订阅集合） |
| FrameQueue | host-apiproxy L1095-1127（buffer L1096 无界 / push L1099-1103 / iterate L1108-1126）；实例化 L3525、L3610 |
| mux WS downlink-only | dsh-client-connection/lib/index.js L429-431 `websocket.close(1008, "downlink only")`；L376-407 upgrade→api.events.mux/host |
| RPC 与 WS 无连接令牌 | 客户端 `api.events.mux({})`（client.js L94）无 token；HTTP unary `/api/<method>`（index.js L537） |
| 无客户端会话兴趣信号 | sessions 路由 L2395-2874（list/search/create/history/models/selectModel/rename/fork/prompt/attachment）；subagents 路由 L2874-3009（list/history/prompt）；client-modules 无 api 调用 |
| session/projection 走 mux 广播 | host-apiproxy L1782 `broadcast()`；客户端 handleMuxEnvelope L8302（与本次改动无关，U-5 封顶覆盖） |
| settings 现值 | settings.yaml L80 adam v4-flash=786432（唯一）；L22-25 opencode-go v4-flash（384000）；L135-137 vision-adam（glm-5.3-flash/100000） |
| 配置热载 | dsh-settings-file/lib/index.js L37 `watch: config.watch ?? true`（chokidar） |
| vision-adam 新 lib | .workspace/deploy/vision-adam/lib/index.js L39 `DEFAULT_MAX_TOKENS = 2000`；snippet L17-27 |
| 凭据 | ~/.dsh/.credentials.yaml L4-5（OPENCODE_GO_API_KEY / ADAM_API_KEY 均在） |
| 工具可用性 | node v22.23.2 / bash 5.2.21 / patch / diff / cmp / tar / python3+pyyaml / 全局树 node `yaml` 包；4 个目标 .js `node --check` 实测 PASS |

---

## 9. 未确认项

1. settings.yaml 热重载对 llm-pi-ai 已建会话的生效时机（chokidar watch 存在，未逐一会话验证）→ 建议重启 DSH 统一生效。
2. adam 网关对 max_tokens=990000 的服务端硬上限（0.99M < contextWindow 1M 自洽；网关侧未确认）。
3. 浏览器对非可见会话帧的实际渲染消耗（host 侧无法观测；沿用机制审计未确认③）。
4. FrameQueue 丢帧后客户端实时消息缺口的具体补偿路径（会话日志不受影响；客户端表现细节未确认）。
5. ②b 恢复后 mux 帧率下降幅度（需重启后运行时实测，执行档可选加观测 Runbook）。
6. vision-adam 插件 disabled 态下 settings 段写入的即时生效边界（依赖 btw-upgrade 线的 lib 部署与插件启用）。
7. 应答帧（approval/question）是否需「永不被丢」守卫（U-5 溢出策略的额外决策，留用户裁决）。
