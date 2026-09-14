# adam 网关 glm-5.3-flash 图片能力真实冒烟实测报告

- 日期：2026-09-12（本地真实调用，非记忆/联网资料）
- 网关：`https://llmapi.roboscience.xyz/v1/`（settings.yaml 中 adam provider，`api: openai-completions`）
- 凭据：`~/.dsh/.credentials.yaml` `refs.ADAM_API_KEY`（51 字符，`sk-YWnPT…`，响应体/本文件均已脱敏为 `sk-MASKED`）
- 测试模型：`glm-5.3-flash`（vision-adam 插件当前 settings 配置 `settings.yaml:136` `vision-adam.model: glm-5.3-flash`）
- 测试图：复用 `v4f-test.png`（360×140 纯绿底 RGB(0,170,60) + 左上角红色方块 RGB(220,30,30) (10,10)-(60,60) + 白色粗体文字 **"V4F-73"**；3227 字节，base64 4304 字符，mime `image/png`）
- 请求格式：OpenAI 兼容 `{type:"image_url", image_url:{url:"data:image/png;base64,…"}}`（与 vision-adam `lib/index.js:139` 完全一致；上一轮 gemini-3.5-flash 阳性对照同格式）

原始产物（本目录）：`glm53_image.json`（带图请求完整响应，key 已脱敏）、`glm53_text.json`（纯文本对照响应）。

---

## 一、主测试：glm-5.3-flash + OpenAI image_url data URL

POST `/v1/chat/completions`，`model=glm-5.3-flash`，`max_tokens=1000`，
`messages[0].content = [{type:text, text:"这张图里有什么？主体颜色是什么？图上的文字是什么？请用中文回答。"},
{type:image_url, image_url:{url:"data:image/png;base64,…"}}]`（完整体见 `glm53_image.json`）。

**HTTP 200**，响应体全文（key 脱敏）：

```json
{"id":"e6c92b32-8485-4e23-a210-d914a063434b","object":"chat.completion","model":"glm-5.3-flash","created":1789188937,
 "choices":[{"index":0,"message":{"role":"assistant",
   "content":"这张图里包含以下内容：\n\n**图中元素：**\n- 左上方有一个**红色方块**\n- 中间偏下位置有一行白色的粗体文字\n\n**主体颜色：**\n- 整个图片的背景是**绿色**，这是画面的主体颜色\n- 此外还有红色（方块）和白色（文字）作为点缀\n\n**图上的文字：**\n- 文字内容为 **\"V4F-73\"**，以白色粗体显示在绿色背景上\n\n整体来看，这可能是一个标识、标签或编号图片。",
   "reasoning_content":"The user is asking me in Chinese: \"What's in this image? What is the main color? What is the text on the image? Please answer in Chinese.\"\n\nLooking at the image:\n- There's a red square in the upper left area\n- There's white text \"V4F-73\" \n- The background is green (a bright/medium green)\n- The text appears to be bold white font\n\nLet me answer in Chinese:\n- 图中内容：一个红色方块和白色文字\"V4F-73\"\n- 主体颜色：绿色（背景是绿色的）\n- 文字：V4F-73"},
   "finish_reason":"stop","logprobs":null}],
 "usage":{"prompt_tokens":98,"completion_tokens":246,"total_tokens":344,
          "prompt_tokens_details":{"cached_tokens":0},
          "completion_tokens_details":{"reasoning_tokens":130}}}
```

### 判定核验（逐项）

| 检查项 | 结果 |
|---|---|
| `content` 非空 | ✅ 非空，基于图片给出了完整中文描述 |
| `finish_reason` | ✅ `stop`（非 `length`，无预算不足假象） |
| 主体颜色 = 绿底 | ✅ 「整个图片的背景是**绿色**，这是画面的主体颜色」 |
| 左上红方块 | ✅ 「左上方有一个**红色方块**」 |
| 文字 V4F-73 | ✅ 「文字内容为 **\"V4F-73\"**，以白色粗体显示」 |
| reasoning 含 base64 解码文本 | ✅ 无（无 `iVBORw0…`、无 `<image_base64>` 占位符、无 "base64"/"truncated" 字样，grep 命中 0） |
| 与 ground truth 一致性 | ✅ 绿底/红方块/V4F-73 三点全部命中，且描述「白色粗体」与测试图一致 |

→ **模型真实看到了图像像素并返回基于图片的响应**，非假成功。

---

## 二、对照：同模型纯文本

`model=glm-5.3-flash`，`messages=[{role:user, content:[{type:text, text:"请只回答：1+1=?"}]}]`。

**HTTP 200**：`content: "2"`，`finish_reason: "stop"`，
`usage:{prompt_tokens:20, completion_tokens:56, reasoning_tokens:53, total_tokens:76}`（全文见 `glm53_text.json`）。

→ 模型本身可用；图片请求 `prompt_tokens=98` 较纯文本 20 多 78，为正常图片 token 计价（该网关对 glm 图片 token 计费方式不同于 deepseek 的文本化降级 196 / gemini 的 1082，均属网关侧计价口径差异，不影响结论）。

---

## 三、结论与推荐

1. **adam 网关上的 `glm-5.3-flash` 支持图片输入并真实返回基于图片的响应。** 用与
   vision-adam 插件完全一致的 OpenAI `image_url` data URL 格式（`lib/index.js:139`），
   HTTP 200、`finish_reason:"stop"`、`content` 非空且与测试图 ground truth 完全一致
   （绿底 / 左上红方块 / 白色粗体 "V4F-73"）；reasoning 为图像内容的正常描述，
   **无** deepseek-v4-flash 的「截断 base64 文本解码」退化形态（对照
   `vision-flash-test.md` 第二节 1/1b 的 `<image_base64>…` 现象）。
2. **推荐：vision-adam 保持 `glm-5.3-flash`（`settings.yaml:136`）作为视觉模型即可，无需回退**
   ——本次实测为该模型图片能力的首次真实确认（此前仅凭 README 记载）。
   备选 gemini-3.5-flash 亦实测可用（上轮阳性对照 `resp_gem_ctrl.json`），两者皆可。
3. 附：`deepseek-v4-flash` 在 adam 网关无图片渠道（上轮实测：图片被降级为截断 base64 文本，
   `content` 恒空），维持「不回退到 deepseek-v4-flash」的既有裁决。
