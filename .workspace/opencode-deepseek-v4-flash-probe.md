# opencode.ai/zen/go 网关 deepseek-v4.1-flash 真实 API 探测

- 日期：2026-09-12（本地真实 HTTP 调用实测，非记忆/联网资料）
- 执行人：subagent（继承 workspace-write 沙箱，未使用 sandbox_permissions）
- 端点：`https://opencode.ai/zen/go/v1`（`/v1/models` 与 `/v1/chat/completions`）
- 凭据：`~/.dsh/.credentials.yaml` 的 `OPENCODE_GO_API_KEY`（67 字符，`sk-UgTf…`；请求/响应中零出现，已 `grep sk-` 校验无泄漏）
- 认证头（完整写法，key 脱敏）：
  - `authorization: Bearer <OPENCODE_GO_API_KEY>`（key 值脱敏）
  - `x-api-key: <OPENCODE_GO_API_KEY>`（与上同值）
  - `x-opencode-session: <每次随机 UUID>`
  - `content-type: application/json`（POST 时）；`accept: application/json`
- 测试图：复用 `v4f-test.png` —— 360×140 PNG，纯绿底 RGB(0,170,60) + 左上角红色方块 (10,10)-(60,60) RGB(220,30,30) + 白色粗体文字 **V4F-73**（3227 字节，base64 4304 字符）
- 图片格式：OpenAI 兼容 image_url data URL（`data:image/png;base64,…`）

---

## 一、GET /v1/models（完整认证头，本次实时重取）

- **HTTP 200**，共 **37 个模型**（比上次探测的 18 个更多，目录已扩容；全文 `oc_models_v41_probe.json`）。
- 目录条目无 `name`/能力字段（仅 `id/object/model/created/owned_by`），无"名称含 DeepSeek V4.1"的显示名，仅有 id。
- deepseek 相关全部条目（5 个）：
  | id | 备注 |
  |---|---|
  | `deepseek-v4-pro` | 非本次目标 |
  | `deepseek-v4-flash` | 非本次目标 |
  | `deepseek-flash` | 非本次目标 |
  | **`deepseek-v4.1-flash`** | **用户指定目标，存在** |
  | `deepseek-v4-flash-vision-exp` | 上次已实测可看图（本次再交叉验证） |
- v4.1 变体核查：目录中 v4.1 仅 `deepseek-v4.1-flash` 一个；无 v4.1-pro / v4.1-vision 等。vision 相关仅 `deepseek-v4-flash-vision-exp` 一个。

---

## 二、POST /v1/chat/completions：model=deepseek-v4.1-flash + 图

- 请求：`oc_req_v41_image.json`（max_tokens 2000；提问精确为 `这张图里有什么？主体颜色是什么？上面的文字是什么？` + 图片 content 块）
- **HTTP 200**（resp_id `8380193d-…`, created 2026-09-12T05:14:21Z），响应体全文（key 无关）：

```json
{
  "id": "8380193d-29f8-416a-b855-c08abe5a98bb",
  "object": "chat.completion",
  "created": 1789190061,
  "model": "deepseek-v4.1-flash",
  "choices": [
    {
      "index": 0,
      "finish_reason": "stop",
      "logprobs": null,
      "message": {
        "role": "assistant",
        "content": "图里是一面以绿色为底的标识/旗帜，左上角有一个红色正方形，中间偏右有白色文字。\n\n主体颜色：**绿色**。  \n上面的文字：**V4F-73**。",
        "reasoning_content": "我们需要回答用户问题。用户问“这张图里有什么？主体颜色是什么？上面的文字是什么？” 需要识别图片内容。图片是一面旗帜/标识？背景绿色，左上角有红色正方形（或矩形？），中间白色文字“V4F-73”。主体颜色？可能是绿色为主。文字是 V4F-73。需要回答中文。可以详细描述。注意：图片看起来像越南？不，这是马来西亚？V4F-73可能？绿色背景红方块白字。可能是某种旗帜？但不需要过度解释。用户问“这张图里有什么？主体颜色是什么？上面的文字是什么？” 图片里有什么：绿色背景、左上角一个红色正方形/矩形、白色文字。主体颜色：绿色。文字：V4F-73。注意红方块可能正方形。需要准确。可以回答：图中有一面绿色底、左上角带红色正方形的旗帜/标识符，中央（或偏左）有白色粗体字“V4F-73”。主体颜色是绿色。上面的文字是“V4F-73”。可能需要注意红色方块是左上角，白色文字在红方块右侧。就这些。\n\n最终回答简洁。"
      }
    }
  ],
  "usage": {
    "prompt_tokens": 243,
    "completion_tokens": 291,
    "total_tokens": 534,
    "prompt_cache_hit_tokens": 0,
    "prompt_cache_miss_tokens": 243,
    "prompt_tokens_details": {
      "cached_tokens": 0
    },
    "completion_tokens_details": {
      "reasoning_tokens": 246
    }
  },
  "cost": "0"
}
```

---

## 三、判定：deepseek-v4.1-flash 真实看图

- `finish_reason: "stop"`，`content` 非空且与 ground truth 一致：**绿色背景 / 左上角红色正方形 / 白色文字 V4F-73**；主体颜色判定为绿色。
- 视觉通道证据：含图 `prompt_tokens: 243` vs 纯文本对照 `38`（差额 +205，与上次 vision-exp 的 249 量级一致）→ 图片走了视觉 token，非 base64 文本化降级。
- 假成功排查：content 非空、无 `finish_reason: length`、reasoning 中无 base64 原文解码迹象（reasoning 为正常图像内容推理，见上文响应体）→ **非假成功**。
- 结论：**deepseek-v4.1-flash 在 opencode.ai/zen/go 网关支持图片输入并真实看图成功**。

---

## 四、纯文本对照（同模型）

- 请求：`oc_req_v41_text.json`（`请只回答：1+1=?`）
- **HTTP 200**（resp_id `f9f4f67d-…`, created 2026-09-12T05:14:24Z），`content: "2"`，`finish_reason: "stop"`，`prompt_tokens: 38`。响应全文：

```json
{
  "id": "f9f4f67d-e98e-4aad-b64b-e4f7385df9f9",
  "object": "chat.completion",
  "created": 1789190064,
  "model": "deepseek-v4.1-flash",
  "choices": [
    {
      "index": 0,
      "finish_reason": "stop",
      "logprobs": null,
      "message": {
        "role": "assistant",
        "content": "2",
        "reasoning_content": "We need answer only. User asks Chinese: \"请只回答：1+1=?\" Means \"Please only answer: 1+1=?\" Need just answer likely \"2\". Must comply only answer. final."
      }
    }
  ],
  "usage": {
    "prompt_tokens": 38,
    "completion_tokens": 47,
    "total_tokens": 85,
    "prompt_cache_hit_tokens": 0,
    "prompt_cache_miss_tokens": 38,
    "prompt_tokens_details": {
      "cached_tokens": 0
    },
    "completion_tokens_details": {
      "reasoning_tokens": 45
    }
  },
  "cost": "0"
}
```

---

## 五、备选交叉验证：deepseek-v4-flash-vision-exp（同图同提问）

- 请求：`oc_req_vexp2_image.json`；**HTTP 200**（resp_id `023f0fa2-…`, created 2026-09-12T05:14:44Z），`finish_reason: "stop"`，`prompt_tokens: 243`。
- content 与 ground truth 一致（红方块 / 白字 V4F-73 / 主体绿色）。响应全文：

```json
{
  "id": "023f0fa2-2a3a-4a32-a884-c03ce963506c",
  "object": "chat.completion",
  "created": 1789190084,
  "model": "deepseek-v4-flash-vision-exp",
  "choices": [
    {
      "index": 0,
      "finish_reason": "stop",
      "logprobs": null,
      "message": {
        "role": "assistant",
        "content": "图中有一个红色正方形色块，以及白色粗体文字“V4F-73”。  \n主体颜色是绿色。  \n上面的文字是：**V4F-73**。",
        "reasoning_content": "我们需要回答用户中文问题。需要识别图片内容：图中有什么？主体颜色是什么？上面的文字是什么？我们需要看提供的图片。图片似乎是绿色背景（亮绿色？主体颜色绿色），左上角有一个红色正方形，中间白色粗体文字“V4F-73”。需要回答。\n\n注意：用户问“这张图里有什么？主体颜色是什么？上面的文字是什么？” 可能期待详细描述。我们需要准确。图片整体绿色，左上角一个红色小方块，中间有白色文字“V4F-73”。主体颜色？可能指绿色（背景主色），或者红色方块？一般主体颜色可能是绿色。文字是什么：V4F-73。需要回答简洁。可以说明：图中有一个红色正方形色块和白色文字“V4F-73”；主体颜色为绿色；文字是“V4F-73”。注意“V4F-73” 是连字符？是的 V4F-73。红方块左上角。文字白色。背景亮绿色。可能没有其他。这里需要小心是否有歧义：主体颜色可能是绿色，因为背景占大部分。但用户可能想要主体颜色（主要颜色）是绿色。如果“主体颜色”指主体对象的颜色？图中主体文字是白色，红色方块和绿色背景。但通常主体颜色即主色调：绿色。回答包括“主体颜色是绿色”。也可以说“整体以绿色为主，左上角有红色方块，文字为白色。” 这样满足。\n\n需要确保不添加额外猜测。最终回答。"
      }
    }
  ],
  "usage": {
    "prompt_tokens": 243,
    "completion_tokens": 353,
    "total_tokens": 596,
    "prompt_cache_hit_tokens": 0,
    "prompt_cache_miss_tokens": 243,
    "prompt_tokens_details": {
      "cached_tokens": 0
    },
    "completion_tokens_details": {
      "reasoning_tokens": 314
    }
  },
  "cost": "0"
}
```

---

## 六、结论与推荐

1. **opencode 网关可用的 deepseek 系视觉模型 = `deepseek-v4.1-flash`（推荐）**，次选 `deepseek-v4-flash-vision-exp`（-exp 实验后缀）。两者本次均实测真实看图成功；v4.1-flash 为稳定版命名、无 -exp 后缀，且正是用户指定的模型。
2. 请求格式：OpenAI 兼容 `/v1/chat/completions`，图片用 `image_url` data URL（`data:image/png;base64,…`），与 vision-exp 相同；`max_tokens` 建议 ≥2000（本次 2000 足够，completion 含 reasoning）。
3. 认证：三头缺一不可——`authorization: Bearer <OPENCODE_GO_API_KEY>` + `x-api-key: <同 key>` + `x-opencode-session: <UUID>`。
4. 该能力只存在于 **opencode.ai/zen/go** 网关（`OPENCODE_GO_API_KEY`）；adam 网关（`ADAM_API_KEY`）的 `deepseek-v4-flash-vision-exp` 仍是被 `model_price_error` 拒绝的状态（见上一轮 `vision-exp-probe.md`）。

---

## 七、调用明细速查

| # | 端点 | model | 内容 | HTTP | 结果 |
|---|---|---|---|---|---|
| 1 | GET /v1/models | — | — | 200 | 37 模型，**含 deepseek-v4.1-flash**（另有 4 个 deepseek id） |
| 2 | POST /chat/completions | deepseek-v4.1-flash | 图+文 | 200 | **真实看图成功**（绿底/左上红块/V4F-73），prompt_tokens 243 |
| 3 | POST /chat/completions | deepseek-v4.1-flash | 纯文本 1+1=? | 200 | "2"（prompt_tokens 38） |
| 4 | POST /chat/completions | deepseek-v4-flash-vision-exp | 图+文 | 200 | 交叉验证成功（同 ground truth），prompt_tokens 243 |

---

## 八、原始产物（本目录）

- `oc_models_v41_probe.json`：GET /v1/models 全文（37 个模型）
- `oc_req_v41_image.json` / `oc_resp_v41_image.json`：v4.1-flash 含图请求/响应全文
- `oc_req_v41_text.json` / `oc_resp_v41_text.json`：v4.1-flash 纯文本请求/响应全文
- `oc_req_vexp2_image.json` / `oc_resp_vexp2_image.json`：vision-exp 交叉验证请求/响应全文
- 本轮全程未使用 sandbox_permissions；无凭据泄漏（`grep sk-` 零命中）。