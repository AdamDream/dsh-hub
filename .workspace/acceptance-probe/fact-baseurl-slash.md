# 事实判定：provider `adam` 的 `baseURL` 尾斜杠（`https://llmapi.roboscience.xyz/v1/`）

**判定日期**：2026-09-17 · **档位**：只读事实判定 · **未发起任何真实网关 API 请求**

---

## 结论（一句话）

**无害（但有真实隐患的另一条路径，且该路径曾经真的炸过）** —— 置信度 **0.97**：
provider 层这条尾斜杠（`settings.yaml:76`）**在当前主会话实际对话中被 OpenAI SDK 规范化掉，拼不出双斜杠，完全无害**；
项目内「带尾斜杠会报 `Invalid URL`」的经验**属实但归属错误**——它发生在 **vision-adam 插件自己的字符串拼接路径**（`${baseURL}/chat/completions`），
而非 provider/openai-completions 路径。2026-09-17 那次 `Invalid URL (POST /v1//chat/completions)` 实锤是 **vision-adam 段**的尾斜杠造成的，且**已修复**。

---

## 证据链

### 1. provider 路径：走 `openai` SDK，SDK 内部消重斜杠（规范化确实存在）

`api: openai-completions`（`~/.dsh/settings.yaml:75`）由 pi-ai 的 openai-completions 实现处理。
该实现**不做字符串拼接**，而是把 `model.baseUrl` 原样交给 OpenAI Node SDK：

**文件：行号 + 原文**
`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:505-510`
```js
    return new OpenAI({
        apiKey,
        baseURL: model.baseUrl,
        dangerouslyAllowBrowser: true,
        defaultHeaders: headers,
    });
```
（同文件 `:1` 为 `import OpenAI from "openai";`）

SDK（`openai@6.26.0`）在发请求时统一走 `buildURL`，**内置尾斜杠/前导斜杠消重**：

`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/openai/client.js:220-225`
```js
    buildURL(path, query, defaultBaseURL) {
        const baseURL = (!tslib_1.__classPrivateFieldGet(this, _OpenAI_instances, "m", _OpenAI_baseURLOverridden).call(this) && defaultBaseURL) || this.baseURL;
        const url = (0, values_1.isAbsoluteURL)(path) ?
            new URL(path)
            : new URL(baseURL + (baseURL.endsWith('/') && path.startsWith('/') ? path.slice(1) : path));
```
注意第 224 行的 `baseURL.endsWith('/') && path.startsWith('/') ? path.slice(1) : path`：
**baseURL 有尾斜杠时，把请求路径的前导斜杠切掉**，因此拼出来只有一个斜杠。

调用方传入的路径是 `'/chat/completions'`：
`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/openai/resources/chat/completions/completions.js:24`
```js
        return this._client.post('/chat/completions', { body, ...options, stream: body.stream ?? false });
```
即：`isAbsoluteURL('/chat/completions')` 为 false → 走 `baseURL + path.slice(1)` 分支。`buildURL` 调用点：`openai/client.js:479`。

### 2. 实测 1：纯表达式与 `new URL` 结果（node -e，附原始输出）

```
$ node -e '...base 尾斜杠 vs 无尾斜杠...'
baseURL = "https://llmapi.roboscience.xyz/v1/"
  concatenated expr = https://llmapi.roboscience.xyz/v1/chat/completions
  new URL()         = https://llmapi.roboscience.xyz/v1/chat/completions
  naive template    = https://llmapi.roboscience.xyz/v1//chat/completions   ← 仅“朴素模板”才有双斜杠
baseURL = "https://llmapi.roboscience.xyz/v1"
  concatenated expr = https://llmapi.roboscience.xyz/v1/chat/completions
  new URL()         = https://llmapi.roboscience.xyz/v1/chat/completions
  naive template    = https://llmapi.roboscience.xyz/v1/chat/completions
```

### 3. 实测 2：直接调用**真实 SDK 的 `buildURL`**（无网络请求，不消耗配额）

```
$ node -e 'new OpenAI({apiKey:"sk-test", baseURL:".../v1/"}).buildURL("/chat/completions",{},...)'
A) trailing slash  : https://llmapi.roboscience.xyz/v1/chat/completions
B) no trailing slash: https://llmapi.roboscience.xyz/v1/chat/completions
```
**A 与 B 结果完全一致，单个斜杠。** 这是对 provider 路径「尾斜杠无害」的直接实锤。

### 4. 反证检查 ①：上游是否有其它规范化？（答案是「无」，SDK 独自承担）

`dsh-llm-pi-ai` 把配置里的 `baseURL` **原样透传**，并不裁剪尾斜杠：

`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js:784-788`
```js
	const baseUrl = spec.baseURL ?? base.baseUrl;
	...
		...baseUrl === void 0 ? {} : { baseUrl },
```
→ **provider 路径上唯一的规范化点就是 `openai/client.js:224`**。它存在且生效，故无害；
但也意味着**一旦换成不走该 SDK 的路径，同样的尾斜杠立刻致命**（见第 5 节）。

对比：其他 pi-ai 方言**显式**裁剪尾斜杠，说明「尾斜杠要自己处理」是本仓库的普遍约束，而 openai-completions 恰好靠 SDK 兜住：
- `pi-ai/dist/api/pi-messages.js:244` — `new URL(\`${model.baseUrl.replace(/\/+$/u, "")}/messages\`)`
- `pi-ai/dist/api/openai-codex-responses.js:445`、`azure-openai-responses.js:130`
- `dsh-llm-deepseek/lib/index.js:527` — `this.baseURL = options.baseURL.replace(/\/+$/u, "");`

### 5. 触发那次 `Invalid URL` 的**具体代码路径**：vision-adam 的字符串拼接

**路径 A（provider，安全）** = pi-ai openai-completions → `openai` SDK `buildURL`（消重）
**路径 B（vision-adam，致命）** = 插件内**手写模板拼接**，无任何消重：

部署位：`/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js:161`
```js
  const response = await fetch(`${options.baseURL}/chat/completions`, {
```
源工程：`/home/CNS2026495165/dsh-vision-adam/lib/index.js:105`（同一写法）
```
105:  const response = await fetch(`${options.baseURL}/chat/completions`, {
```
（两文件 sha256 不同——部署位 `54ac2548…`、源 `6dd85463…`——但该行拼接写法一致。）

**`Invalid URL` 的确切来源（关键澄清）**：**不是 Node 客户端抛的**，而是**网关返回的 404 响应体**。
- Node 的 `fetch`/`undici` **不会**规范化路径中的 `//`——实测本地 HTTP 服务器：
```
SERVER SAW PATH: "/v1//chat/completions"    ← 双斜杠被原样发出
SERVER SAW PATH: "/v1/chat/completions"
```
- 只有真正**相对**的 URL 才会抛客户端 `TypeError: Invalid URL`：
```
new URL THROWS: "/chat/completions" | TypeError | Invalid URL
new URL THROWS: "//chat/completions" | TypeError | Invalid URL
new URL: "https://host/v1//chat/completions" => https://host/v1//chat/completions   ← 不抛
fetch  https://host/v1//chat/completions → status 404（双斜杠本身不致命）
```
所以那次报错的形态是 **`Error: Invalid URL (POST /v1//chat/completions)`（含 `POST /v1//…` 字样、10 次出现）= 网关路由拒绝该双斜杠路径后回写在响应体的文案**。

### 6. 运行态旁证（实锤 = 有）

**旁证 1：真实的运行时报错记录（2026-09-17，session `bc0b7655-8e6a-4d10-9d91-03888c3e57ce`）**

`~/.dsh/sessions/--home-CNS2026495165-dsh--/session-bc0b7655-…/session.jsonl.zstd`（`zstdcat` 解压后 grep），原文：
```json
"content":[{"type":"tool-result","toolCallId":"call_00_ET_uRaQpVjhyFCLadh3jKrt1951",
"content":[{"type":"text","text":"Error: Invalid URL (POST /v1//chat/completions)"}],"isError":true}]
```
该形态在会话中出现 **10 次**；同一会话的推理块记录了当时的因果链（原文摘录）：
> "The analyze_image tool now fails with "Invalid URL (POST /v1//chat/completions)" — because I changed **vision-adam's baseURL** to `https://llmapi.roboscience.xyz/v1/` (with trailing slash)… the plugin builds `${baseURL}/chat/completions` where baseURL already ends with `/v1/` → double slash"
> "**vision-adam 首次调用报 `Invalid URL (POST /v1//chat/completions)`**——它内部拼 `${baseURL}/chat/completions`，我写的 `.../v1/` 尾斜杠造成双斜杠；已改为无尾斜杠并复测通过"

→ **失败者是 `analyze_image`（vision-adam 路径），不是主对话（provider 路径）**。

**旁证 2：同会话里出现的「单斜杠」URL，反向证明 provider 路径已被规范化**

grep 该会话里出现过的实际 URL 形态计数：
```
  8 https://llmapi.roboscience.xyz/v1/chat/completions     ← 单斜杠（provider 路径实态）
  0 https://llmapi.roboscience.xyz/v1//chat/completions    ← 从未以 URL 形式出现（只有报错文案里的 POST /v1//…）
```
而**当时 settings 里 `adam` provider 段就已经带尾斜杠**（`settings.yaml:76`，mtime 2026-09-17 17:46，会话期间即为此值）。
**配置带尾斜杠、实际请求 URL 却是单斜杠 ⇒ 规范化确实发生了**（对应 `openai/client.js:224`）。

**旁证 3：项目内部记载（同一事实，但归属写错）**

- `/home/CNS2026495165/dsh/FEATURE-MAP.md:28`：「默认网关 = adam（`https://llmapi.roboscience.xyz/v1`（**无尾斜杠**——带尾斜杠会拼出 `//chat/completions` 报 Invalid URL，2026-09-17 实测修复）…）」
- `/home/CNS2026495165/dsh/.workspace/NEXT_SESSION_PROMPT.txt:104`：「**踩坑**：`baseURL` 带尾斜杠会拼出 `//chat/completions` 报 `Invalid URL` —— 必须无尾斜杠。」

**归属纠正**：这两条记载把「vision-adam 段的尾斜杠」泛化成了「所有 baseURL」。按本次代码取证，
它**只对 vision-adam（手写模板拼接）成立**，**对 provider `adam` 段不成立**（那里被 SDK 消重）。

### 7. 反证检查（有没有证据指向相反结论）

| 检查项 | 结果 |
|---|---|
| 是否存在 provider 层字符串拼接 `${baseURL}/chat/completions`？ | **无**。全 checkout 内 openai-completions 仅用 `new OpenAI({baseURL: model.baseUrl})`（`api/openai-completions.js:507`），请求路径 `'/chat/completions'` 由 SDK `buildURL` 组装（`openai/client.js:224`）。 |
| SDK 消重分支是否真被走到（而非 `isAbsoluteURL` 为真绕过）？ | **被走到**。`'/chat/completions'` 非绝对 URL；实测 `buildURL` 返回单斜杠（第 3 节 A 行）。 |
| 是否有上游裁剪尾斜杠、即规范化发生在别处？ | **无**。`dsh-llm-pi-ai/lib/index.js:784-788` 原样透传；唯一裁剪点是 SDK。 |
| 是否有运行日志显示 provider 路径发过 `//chat/completions`？ | **无**（`0` 次）。会话中实际 URL 为单斜杠 `/v1/chat/completions`（8 次）。 |
| 那次 `Invalid URL` 会不会其实是 provider 路径发的？ | **不会**。报错由 `analyze_image`（vision-adam）工具结果携带；同会话推理块明确指向 vision-adam。且 provider 路径当时已正常工作（否则整个会话根本无法进行）。 |
| `~/.dsh/logs` 是否有独立请求日志？ | **该目录不存在**（`ls ~/.dsh/logs` 为空）。旁证取自 `~/.dsh/sessions/**.jsonl.zstd`（zstd 压缩，需 `zstdcat`）+ `.workspace` 文档，已如上给出。 |

**残留不确定性（为何置信度 0.97 而非 1.00）**：
- 我们**没有**（且按要求**不**）发起真实的 provider 请求抓取线上 URL；「provider 路径规范化」的证据是「SDK 源码 + 真实 SDK 调用实测 + 运行态 URL 形态旁证」三重一致，而非线上抓包。
- vision-adam 部署位（`54ac2548…`）与源工程（`6dd85463…`）sha256 不同，未逐字节比对除该行以外的差异；但第 161/105 行拼接写法一致，且运行时报错与该写法完全吻合。

---

## 二选一判定

- [x] **无害**（客户端会规范化，无需修改）→ 规范化代码：`openai/client.js:224`（经 `pi-ai/dist/api/openai-completions.js:507` 传入 `baseURL: model.baseUrl`）；实测 URL：`https://llmapi.roboscience.xyz/v1/chat/completions`（尾斜杠与无尾斜杠两种输入结果完全相同）。
- [ ] 潜在缺陷 → 该判定**只对 vision-adam 路径成立**，而那条路径的尾斜杠**已于 2026-09-17 修复**（现 `settings.yaml:147` 为无尾斜杠）。

---

## 风险与修复建议

### 对 provider `adam`（`settings.yaml:76`）
**技术上无需修改**——保留尾斜杠不会导致双斜杠 URL，主会话对话与子代理派发均不受影响。

但建议**顺手删掉该尾斜杠**（改为 `https://llmapi.roboscience.xyz/v1`），理由是**一致性/健壮性**而非 bug 修复：
1. 与同文件 `vision-adam` 段（`:147`，已无尾斜杠）及项目既定规范（`FEATURE-MAP.md:28`、`NEXT_SESSION_PROMPT.txt:104`「必须无尾斜杠」）保持一致，避免下次审计再把它误判为隐患。
2. **前向风险**：provider 路径的安全性**完全依赖 `openai` SDK 的 `buildURL` 消重**。若将来该 provider 改走 `pi-messages`/自写 fetch/其它方言，或 SDK 升级改动该分支，同一尾斜杠会立即变成真实故障（`pi-ai/dist/api/pi-messages.js:244` 等路径是**显式** `replace(/\/+$/u,"")` 兜的，说明不能依赖运气）。
3. 修改位置：`~/.dsh/settings.yaml:76`，`baseURL: https://llmapi.roboscience.xyz/v1/` → `baseURL: https://llmapi.roboscience.xyz/v1`。**本次只读判定档未作任何修改**（无写权限，亦未尝试）。

### 对 vision-adam 路径（真正的隐患面，已修复但值得加固）
当前靠「配置约定无尾斜杠」规避，属**约定脆弱点**。建议在插件侧做**代码级**兜底（一行），使配置写错不再致命：

- 部署位：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js:161`
- 源工程：`/home/CNS2026495165/dsh-vision-adam/lib/index.js:105`

```js
// 现状（尾斜杠即产出 // 路径，网关 404 Invalid URL）
const response = await fetch(`${options.baseURL}/chat/completions`, {

// 建议最小修复（与 pi-messages.js:244 同款写法，裁剪尾斜杠）
const base = options.baseURL.replace(/\/+$/, "");
const response = await fetch(`${base}/chat/completions`, {
```
（或在 `resolveOptions` 处统一规范化 `baseURL` 一次，使设置页手填尾斜杠也不再炸。）

---

## 复现命令（只读，无网络请求）

```bash
# 1) provider 路径规范化：真实 SDK buildURL（无网络）
cd /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh
node -e '
const OpenAI = require("openai").default || require("openai");
for (const b of ["https://llmapi.roboscience.xyz/v1/","https://llmapi.roboscience.xyz/v1"]) {
  console.log(b, "=>", new OpenAI({apiKey:"sk-test", baseURL:b}).buildURL("/chat/completions", {}, "https://api.openai.com/v1"));
}'
# 期望两行均为 .../v1/chat/completions（单斜杠）

# 2) 判定代码路径
sed -n 220,225p node_modules/openai/client.js
sed -n 505,510p node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js

# 3) 手写拼接路径（致命那条）
sed -n 161p ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js

# 4) 运行态旁证
cd ~/.dsh/sessions/--home-CNS2026495165-dsh--
zstdcat session-bc0b7655-8e6a-4d10-9d91-03888c3e57ce/session.jsonl.zstd \
  | grep -a -m2 -o 'Invalid URL.\{0,180\}'
```

## 取证环境
- checkout：`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/`
- `@earendil-works/pi-ai` v0.82.1 · `openai` v6.26.0 · Node（`node -e` 实测）
- 配置：`~/.dsh/settings.yaml`（mtime 2026-09-17 17:46:42）
- **全程只读**：除本报告外未修改任何文件；未改 settings；未重启；未 install；**未发起任何真实网关 API 请求**。
