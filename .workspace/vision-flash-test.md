# vision-adam 审计 + adam 网关 deepseek-v4-flash 图片能力实测报告

- 日期：2026-09-12（本地实测，非记忆/联网资料）
- 网关：`https://llmapi.roboscience.xyz/v1/`（settings.yaml 中 adam provider）
- 凭据：`$ADAM_API_KEY` 环境变量不存在（`env | grep -c ADAM_API_KEY` = 0）；实际使用
  `~/.dsh/.credentials.yaml` `refs.ADAM_API_KEY`（51 字符，`sk-YWnPT…`，全文不在本文件中出现，已脱敏）。
- 网络：网关可达（无 key 探测返回 HTTP 401；带 key 全部请求 HTTP 200）。
- 原始产物（本目录）：`v4f-test.png`（测试图）、`req1_image.json` / `req1b_bigbudget.json` /
  `req2_text.json` / `req_a_rawb64.json` / `req_b_image.json` / `req_gem_ctrl.json`（请求体）、
  `resp1_raw.json` / `resp1b.json` / `resp2_raw.json` / `resp_a.json` / `resp_b.json` /
  `resp_gem_ctrl.json`（脱敏响应体全文）、`models_list.json`（模型清单）。

---

## 一、vision-adam 调用链审计（文件:行号证据）

插件根目录：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/`

### 1. 请求怎么构造

- **不经过 `ctx.llm`，也不读 settings 的 provider 定义**——直接用 `fetch` 打
  `${options.baseURL}/chat/completions`：
  - `lib/index.js:24` 硬编码默认 `DEFAULT_BASE_URL = "https://llmapi.roboscience.xyz/v1"`；
  - `lib/index.js:123` `fetch(\`${options.baseURL}/chat/completions\`, ...)`；
  - `lib/index.js:124-129` 请求头：`authorization: Bearer ${apiKey}`、`content-type: application/json`、
    `user-agent: deepseek-harness/0.3.0 (vision-adam)`。
- **模型来源**：仅来自 `vision-adam` settings 段（`lib/index.js:57-65` Config 定义
  `model`/`maxTokens`/`baseURL`/`apiKeyEnv`/`apiKey` 等；`:71-83` resolveOptions 原样透传；
  `:131` `model: options.model` 直接放进请求体）。代码内不存在按模型分支的逻辑，
  `lib/index.js:26` 默认 `DEFAULT_MODEL = "gemini-3.6-flash"` 只在不配时生效。
- **key 解析**：`lib/index.js:86-99` — 优先字面 `apiKey`；否则 `ctx.get("credentials")`
  （dsh-credentials 插件）resolve `ADAM_API_KEY` 凭证引用（= `~/.dsh/.credentials.yaml` 的 refs）；
  再退到 launch environment。缺失时抛错 `vision-adam has no API key for "ADAM_API_KEY"…`（`:98`）。
- **图片输入格式（写死，与模型无关）**：`lib/index.js:139` 图片 →
  `{ type: "image_url", image_url: { url: "data:<mediaType>;base64,<base64>" } }`
  （OpenAI 兼容 data URL；`IMAGE_TYPES` 映射在 `:39-45`）；`lib/index.js:138` 视频 →
  Zhipu 风格 `{ type: "video_url", video_url: { url: "data:…;base64,…" } }`。
  文件读取走 `ctx.fs.readBytes`（`:169-180`，上限 `maxBytes` 20MiB / `maxVideoBytes` 50MiB），
  `:241` `Buffer.from(data).toString("base64")`。
- **错误/空内容处理**：`:145-155` 非 2xx 抛错；`:161-164` 若 `content` 为空则**回退返回
  `reasoning_content`**（注释：部分网关模型把预算耗在 reasoning 上）。

### 2. 把 model 改成 deepseek-v4-flash 是否只是 settings 一个键

- **配置层面：是**。`settings.yaml:135-137`：
  ```yaml
  vision-adam:
    model: glm-5.3-flash
    maxTokens: 100000
  ```
  改成 `model: deepseek-v4-flash` 即完成（插件按 settings 热加载，README.md:41「settings
  命名空间 vision-adam（热加载）」；`lib/index.js:188-193` installSettingsSection）。
  不需要改插件代码：provider/baseURL 是插件内写死的网关（`lib/index.js:24`），图片格式对
  所有模型都是同一套 OpenAI `image_url` data URL（`:139`），无 per-model 分支。
- **功能层面：不成立（见第二节实测）**——该网关上的 deepseek-v4-flash 实际收不到图片像素，
  改过去后工具要么返回空的 `content`→回退的 `reasoning_content`（base64 解码脑补文本，
  `lib/index.js:161-164`），要么返回「我看不到图片」，不能完成任务。
- 附带确认：settings.yaml:74-77 adam provider 定义 `apiKeyEnv: ADAM_API_KEY`、
  `api: openai-completions`、`baseURL: https://llmapi.roboscience.xyz/v1/`；
  `:79-80` models 含 `deepseek-v4-flash`（`maxTokens: 786432`）。README.md:16 亦记载
  `deepseek-v4-pro` 在 adam 网关下「没有图片渠道（实测带图请求 500/503）」——与本次
  deepseek-v4-flash 的发现同型。

---

## 二、真实 API 实测

### 0. 测试图

`v4f-test.png`：360×140 PNG，**纯绿底 RGB(0,170,60)** + 左上角**红色方块 RGB(220,30,30)**
（(10,10)-(60,60)）+ 白色粗体文字 **"V4F-73"**。
- 文件 3227 字节；base64 长 4304 字符；base64 前缀 `iVBORw0KGgoAAAANSUhEUgAAAWgAAACMCAIAAADe…`；mime `image/png`。

### 1. 主测试（请求 1）：deepseek-v4-flash + OpenAI 多模态格式

POST `/v1/chat/completions`，`model=deepseek-v4-flash`，`max_tokens=1000`，
`messages[0].content = [{type:text, text:"这张图里有什么？主体颜色是什么？图上写了什么文字？请用中文回答。"},
{type:image_url, image_url:{url:"data:image/png;base64,…"}}]`（完整体见 `req1_image.json`）。

**HTTP 200（无报错）**，但：
```json
{"choices":[{"index":0,"message":{"role":"assistant","content":"","reasoning_content":"We need answer in Chinese. Need inspect image? We have base64 truncated? Actually prompt includes <image_base64>iVBORw0KGgoAAAANSUhEUgAAAWgAAACMCAIAAADeJaSi …"},"finish_reason":"length","logprobs":null}],
 "model":"deepseek-v4-flash-0731",
 "usage":{"prompt_tokens":196,"completion_tokens":1000,"total_tokens":1196,
          "prompt_tokens_details":{"cached_tokens":0},
          "completion_tokens_details":{"reasoning_tokens":1000}}}
```
关键点：
- `content` 为空、`finish_reason:"length"`、1000 token 全烧在 reasoning；
- 模型思考文本中出现 `prompt includes <image_base64>iVBORw0KGgo…` —— **网关把 image_url
  内容降级成了文本占位符 `<image_base64>…`（base64）**，模型拿到的是文本不是图；
- `prompt_tokens=196`，其中图片只贡献约 105 token（对照纯文本请求 2 为 91）——远小于完整
  base64 的 ~1100 token，且模型自述 `base64 truncated`，即该文本化是**截断的**。

### 1b. 同一请求，max_tokens=4000（排除预算不足假象）

HTTP 200，`content: ""`，`finish_reason:"length"`，4000 token 全在 reasoning。
reasoning 头：`"…The user provided image_base64 truncated? …Actually base64 is truncated in prompt:
"<image_base64>iVBORw0KGgoAAAANSUhEUgAAAWgAAACMCAIAAADeJaSi"…"`；
reasoning 尾：`"…SUhE ->? This should decode "IHDR". "SUhE" dec…"` —— 模型在**逐字节手工解码
base64 文本**（把 `SUhE` 当 base64 猜 `IHDR`），全程没有真正看图。预算再大也不会得出图像答案。

### 2. 对照（请求 2）：同模型纯文本

`model=deepseek-v4-flash`，`messages=[{role:user,content:[{type:text,text:"请只回答：1+1=?"}]}]`。
**HTTP 200**，`content: "1+1=2"`，`finish_reason:"stop"`，`usage:{prompt_tokens:91,…}`。
→ 模型本身可用，问题只出在图片渠道。

### 3. 变体测试（均 deepseek-v4-flash，同问题）

| 变体 | 请求体 | HTTP | 结果 |
|---|---|---|---|
| A | `image_url.url` 直接传裸 base64（无 data: 前缀） | 200 | `content:"我没有看到您提到的图片。请上传图片后，我可以帮您描述图中的内容、主体颜色和文字。"`，`prompt_tokens:102` |
| B | `content` 项 `{type:"image", image:"data:image/png;base64,…"}` | 200 | `content:"抱歉，我看不到您提到的图片。请把图片发给我，我再帮您描述图里的内容、主体颜色和文字。"`，`prompt_tokens:102` |

→ 三种格式全部失败：模型明确自认看不到图。变体 A/B 中图片贡献约 11 token（102−91），
基本被网关丢弃或忽略。

### 4. 阳性对照（变体 C）：gemini-3.5-flash + 与请求 1 完全相同的 image_url data URL 格式

**HTTP 200**，模型基于图片像素正确回答（与测试图 ground truth 完全一致）：
```text
content: '这张图的具体内容如下：

1. **图中的元素**：包含一个纯绿色的背景、左上角有一个**红色正方形色块**，以及中间偏下位置的**白色英文字符与数字**。
2. **主体颜色**：**绿色**（背景占绝大部分面积）。
3. **图上的文字**：**V4F-73**'
finish_reason: stop
```
→ **网关的图片通道本身工作正常**（图片可送达、可理解），同一格式只在 deepseek-v4-flash
上失效 → 问题确定在模型（该网关上的 deepseek-v4-flash 为文本模型，无图片渠道）。

### 5. vision 变体探测

`GET /v1/models`（带 key）→ HTTP 200，共 **40 个模型**。deepseek 相关只有
`deepseek-v4-flash` 与 `deepseek-v4-pro` 两个 id，**不存在** `deepseek-v4-flash-vision-exp`
或任何 deepseek vision 变体（`models_list.json` 全文）。视觉能力模型可选：`gemini-3.5-flash`、
`gemini-3.6-flash`、`gemini-3-flash`、`gemini-3-pro-image-preview(-2k/-4k)`、
`glm-5.3-flash`（README 记载其支持 Zhipu `video_url` 视频格式）、`glm-5.3`、`qwen3.8-flash` 等。

---

## 三、结论

1. **adam 网关上的 `deepseek-v4-flash` 不支持图片输入。** 带图请求不报错（HTTP 200），
   但模型收不到图像像素：OpenAI `image_url` data URL 会被网关降级为**截断的文本占位符
   `<image_base64>…`**（模型把预算耗在手工解码 base64 上，`content` 恒空）；
   裸 base64 url 与 `{type:"image"}` 变体则被直接丢弃，模型明说「我看不到图片」。
2. **不返回基于图片的响应**（reasoning 内容基于 base64 文本，非图像内容）。
3. **可靠请求格式**：对支持视觉的模型（gemini-3.5-flash 等）用 OpenAI 兼容
   `{type:"image_url", image_url:{url:"data:image/png;base64,…"}}`（变体 C 已验证）；
   对 deepseek-v4-flash，**没有可用格式**。
4. **vision-adam 改用 deepseek-v4-flash 的最小改动**：配置上仅改 `settings.yaml:136`
  `vision-adam.model` 一个键（插件代码无需动，格式/provider 与模型无关）；
  但**该改动会使其实际失效**（工具拿不到图像答案，且 `lib/index.js:161-164` 的
  `reasoning_content` 回退会把 base64 解码脑补文本当成「分析」返回，产生误导）。
5. **备选 vision 变体模型**：网关**不存在** deepseek-vision 变体（无
   `deepseek-v4-flash-vision-exp`）；如需在 adam 网关看图，建议沿用视觉模型
   （如 `glm-5.3-flash`（当前配置）、`gemini-3.6-flash`（插件默认）、`gemini-3.5-flash`（本次阳性对照验证））。
