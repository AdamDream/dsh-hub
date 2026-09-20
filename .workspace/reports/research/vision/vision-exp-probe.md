# deepseek-v4-flash-vision-exp 可用性实测（adam 网关主测 + opencode 网关补证）

- 日期：2026-09-12（本地真实 API 实测，非记忆/联网资料）
- 执行人：subagent（继承 workspace-write 沙箱，未使用 sandbox_permissions）
- 测试图：复用上一轮 `v4f-test.png` —— 360×140 PNG，纯绿底 RGB(0,170,60) + 左上角红色方块
  (10,10)-(60,60) RGB(220,30,30) + 白色粗体文字 **"V4F-73"**（3227 字节，base64 4304 字符，
  前缀 `iVBORw0KGgoAAAANSUhEUgAAAWgAAACMCAIAAADe…`）。
- 提问文本（与上一轮一致）：`"这张图里有什么？主体颜色是什么？图上写了什么文字？请用中文回答。"`
- 图片格式：OpenAI 兼容 `{type:"image_url", image_url:{url:"data:image/png;base64,…"}}`。
- 凭据（均从 `~/.dsh/.credentials.yaml` refs 取，全部脱敏，不出现在本文件中）：
  - adam：`ADAM_API_KEY`（51 字符，`sk-YWnPT…`）；环境变量 `$ADAM_API_KEY` 不存在。
  - opencode：`OPENCODE_GO_API_KEY`（67 字符，与 `DEEPSEEK_API_KEY` 同值，`sk-UgTf…`）。
- 原始产物（本目录）：请求体 `req_vexp_image.json` / `req_vexp_text.json` / `req_vexp_ctrl.json` /
  `oc_req_vexp_image.json` / `oc_req_vexp_text.json`；响应全文 `resp_vexp_image.json` /
  `resp_vexp_text.json` / `resp_vexp_ctrl.json` / `oc_resp_vexp_image.json` / `oc_resp_vexp_text.json`；
  模型清单 `models_fresh.json`（adam 40 个）/ `oc_models.json`（opencode 18 个）。

---

## 一、adam 网关主测（https://llmapi.roboscience.xyz/v1/）

### 1. 前置确认：GET /v1/models（带 key，本次实时重取）

- **HTTP 200**，共 **40 个模型**（`models_fresh.json` 全文）。
- deepseek 相关仅两个 id：`deepseek-v4-flash`、`deepseek-v4-pro`。
- **`deepseek-v4-flash-vision-exp` 不在清单中**，也无任何 deepseek vision 变体。

### 2. 主测试：POST /v1/chat/completions，model=deepseek-v4-flash-vision-exp + 图

- **HTTP 400**，响应体全文（key 无关，未脱敏需求）：
  ```json
  {"error":{"message":"模型 deepseek-v4-flash-vision-exp 的价格未配置。请前往「系统设置 → 运营设置」开启自用模式，或在「系统设置 → 分组与模型定价设置」中为该模型配置价格；Model deepseek-v4-flash-vision-exp price not configured. Go to System Settings → Operation Settings to enable self-use mode, or configure the model price in System Settings → Group \\u0026 Model Pricing. (request id: 202609120452221526866058268d9d65ETSGTRd)","type":"new_api_error","param":"","code":"model_price_error"}}
  ```
- 关键点：错误类型为 New API 网关的 `new_api_error`，code `model_price_error`——**网关系统认得
  该模型 id，但当前账号分组未配置该模型的价格/权限**，请求在路由层被拒绝，图片内容根本没被处理。
  这不同于"模型不存在"（那种情况网关通常直接报 model not found 类错误）。

### 3. 纯文本对照：同模型，"请只回答：1+1=?"

- **HTTP 400，错误体与第 2 步完全一致**（`model_price_error`，request id:
  202609120452312436143468268d9d6sAlxGd8G）。
- → 拒绝发生在模型/账号层，与请求内容（图/文本）无关；因此**无法**据此区分"模型存在但仅文本"——
  该 id 在 adam 账号下根本不放行，图与文本都进不去。

### 4. 请求形状对照（排除 key/格式问题）：model=deepseek-v4-flash 纯文本

- **HTTP 200**，`content: "1+1=2"`，`finish_reason: "stop"`，`model: "deepseek-v4-flash-0731"`。
- → key、端点、OpenAI 请求形状均正常；第 2/3 步的 400 是**模型 id 专属**的。

### 5. adam 网关小结

- `deepseek-v4-flash-vision-exp` 在 adam 网关：**不在 /v1/models 清单（40 个）**，且直接调用
  被 `model_price_error`（HTTP 400）拒绝。结论：**该模型 id 对当前 ADAM_API_KEY 不可用**。

---

## 二、补充证据：opencode.ai/zen/go/v1 网关（web-search-deepseek 所用）

- 配置出处：`~/.dsh/settings.yaml:140-142` `web-search-deepseek.baseURL =
  https://opencode.ai/zen/go/v1`；插件 `dsh-web-search-deepseek/lib/index.js:143` 带
  `x-opencode-session: crypto.randomUUID()` 头；`llm-pi-ai.providers.opencode-go.apiKeyEnv =
  OPENCODE_GO_API_KEY`（settings.yaml:8）。
- 请求头（镜像插件）：`authorization: Bearer <key>` + `x-api-key: <key>` +
  `x-opencode-session: <random uuid>`。

### 1. GET /v1/models（带 key）

- **HTTP 200**，共 **18 个模型**（`oc_models.json` 全文），其中包含
  **`deepseek-v4-flash-vision-exp`**（另有 deepseek-v4-pro / deepseek-v4-flash /
  deepseek-flash / deepseek-v4.1-flash / minimax-m3 / kimi-k3 / glm-5.3 等）。
- → 与任务补充线索一致：该网关目录确实声明此模型（任务所述 input [text,image] 能力本次实测验证）。

### 2. 含图实测：POST /v1/chat/completions，model=deepseek-v4-flash-vision-exp + 同一测试图

- **HTTP 200**，`finish_reason: "stop"`，`model: "deepseek-v4-flash-vision-exp"`。
- `content`（全文）：
  > "这张图是一个绿色背景的矩形标志，左上角有一个红色正方形色块，中央有醒目的白色粗体文字。主体颜色是绿色。图上写的文字是 **V4F-73**。"
- `reasoning_content` 头（节选）："哦，我需要提取图中的文字内容。这张图整体是一个绿色背景的矩形标志，
  左上角有一个红色正方形色块……文字是横向排列的，清晰无旋转或模糊，内容为"V4F-73"……"
- `usage.prompt_tokens: 249`（对照纯文本 38）——图片以**视觉 token** 计入，且回答与 ground truth
  完全一致（绿底、左上红块、白字 V4F-73、主体绿色）→ **模型真实看到了像素**，非 base64 文本化
  （对比 adam 上 deepseek-v4-flash 的 `<image_base64>…` 降级 + prompt_tokens 仅 +105）。

### 3. 纯文本对照：同模型，"请只回答：1+1=?"

- **HTTP 200**，`content: "2"`，`finish_reason: "stop"`，`prompt_tokens: 38`。

---

## 三、结论

1. **adam 网关不能用 `deepseek-v4-flash-vision-exp` 看图。**
   - 证据 a：GET /v1/models（本次实时）40 个模型中**无此 id**（deepseek 仅 flash / pro）。
   - 证据 b：带图请求 → HTTP 400 `model_price_error`（"价格未配置"，New API 网关错误，
     账号分组未放行该模型）。
   - 证据 c：同模型纯文本同样 400 → 拒绝在模型/账号层，连"仅文本"使用都不可能。
   - 证据 d：同请求形状换 `deepseek-v4-flash` → 200 正常，排除 key/端点/格式因素。
   - 定性：**模型 id 对该账号不可用**（网关认得该 id 但无价格/分组授权，严格讲不是
     "model not found"，但效果等同：不可调用，自然谈不上看图）。
2. **补充证据（同一模型 id 在 opencode.ai/zen/go/v1 网关实测可用且真能看图）**：
   - 该网关 /v1/models 目录含 `deepseek-v4-flash-vision-exp`（18 个模型之一）；
   - OpenAI `image_url` data URL 格式 + 同一测试图 → HTTP 200，回答与 ground truth 完全一致
     （绿底、左上红块、白字 V4F-73），`prompt_tokens: 249` 表明图片走了视觉通道；
   - 纯文本 1+1=? → "2"。→ 用户"界面见过该模型名"与 opencode 网关目录一致，但**该能力
     不经过 adam 网关**，两者是不同网关（不同 key：OPENCODE_GO_API_KEY vs ADAM_API_KEY）。
3. **回退建议**：
   - 在 **adam 网关**内需要看图：沿用已实测通过的 **`gemini-3.5-flash`**（上一轮阳性对照），
     或当前 vision-adam 配置的 `glm-5.3-flash`、插件默认 `gemini-3.6-flash`。
   - 若必须在 DSH 里用 `deepseek-v4-flash-vision-exp`：需改用 **opencode.ai/zen/go/v1** 网关
     （`OPENCODE_GO_API_KEY` 可用、目录含该模型、本次含图实测通过），注意那是另一个 provider
     （`llm-pi-ai.providers.opencode-go` / web-search-deepseek 同网关），不是 adam；
     且该模型带 `-exp` 后缀（实验模型），生产场景建议先用同网关的稳定视觉模型（如 glm-5.3-flash
     也在其目录中）验证可靠性。

---

## 四、调用明细速查

| # | 网关 | 端点 | model | 内容 | HTTP | 结果 |
|---|---|---|---|---|---|---|
| 1 | adam | GET /v1/models | — | — | 200 | 40 模型，无 vision-exp |
| 2 | adam | POST /chat/completions | deepseek-v4-flash-vision-exp | 图+文 | 400 | model_price_error（价格未配置） |
| 3 | adam | POST /chat/completions | deepseek-v4-flash-vision-exp | 纯文本 | 400 | model_price_error（同上） |
| 4 | adam | POST /chat/completions | deepseek-v4-flash（对照） | 纯文本 | 200 | "1+1=2" |
| 5 | opencode | GET /v1/models | — | — | 200 | 18 模型，**含 vision-exp** |
| 6 | opencode | POST /chat/completions | deepseek-v4-flash-vision-exp | 图+文 | 200 | **正确看图**（绿底/左上红块/V4F-73） |
| 7 | opencode | POST /chat/completions | deepseek-v4-flash-vision-exp | 纯文本 | 200 | "2" |
