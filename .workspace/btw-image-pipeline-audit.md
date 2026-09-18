# btw 侧聊图像传入管线 · 只读根因审计

**审计时间**：2026-09-18 10:30–11:05（CST）
**审计范围**：只读。除本报告外未修改任何文件；未重启、未 install、未改 settings。
**工作目录**：`/home/CNS2026495165/dsh`（项目 dsh-hub）

---

## 0. 结论摘要（置顶）

**一句话根因**：btw 侧聊**确实**是与主会话不同的一条图片管线（主会话走 `dsh-host-apiproxy` 的 `prompt` RPC + `session/prompt-image-transform` 瀑布 + `durablePromptContent`；btw 走侧聊 `send()` 自己 `admitEncodedImages` 后直接 `createUserMessage`+`agent.followup`），**但这条管线在当前部署位上是通的**：本次审计找到了**两次真实的 btw 贴图投递证据**，模型都收到了图并据图作答（详见 §3.0）。因此用户报告的「截图发给他他也找不到」**在当前部署位（部署位 lib mtime 09-17 17:29 + 09-18 运行进程）无法复现**。

**在 btw 管线里能确证的、与「找不到」同症状的真实缺陷有两条**（都不影响「模型是否收到图」，都会让用户觉得图"不见了"或"用不了"）：

| # | 缺陷 | 性质 | 是否影响模型看图 |
|---|---|---|---|
| **D1** | 侧聊恢复（resume）后 `imageRefsByMessageId` 是**全新空 Map**，历史消息的图片引用**无处恢复**（子会话日志只留文本，官方 `sessions.readAttachment` 也不认这些 ref）→ 重新打开抽屉/恢复侧聊后，历史图片**缩略图与 `images` 数组全部消失** | 代码确证（信息未持久化） | 否（只是显示/引用丢失） |
| **D2** | btw 子代理的工具白名单 `READ_ONLY_TOOL_CANDIDATES` 不含 `analyze_image`（部署位 bundle 里 0 次出现）→ 侧聊**没有主会话那条"图不行就调 analyze_image 转文本"的兜底**；一旦走 vision-adam 转文本路径失败，只能整条发送失败 | 代码确证 | 是（兜底能力缺失） |

**冷热面结论**：本报告的**修复建议全部落在宿主 lib（冷面）或 settings 值（热面）**，无一条需要改 client bundle；核对如下：

- `dsh-btw` 宿主代码（`lib/index.js`）= **冷面**，改完需重启 `dsh web`。
- `dsh-btw` 设置命名空间（`model.default` / `model.options` / `vision.autoTransform`）= **热面**，`readBtwSettings()` 每次调用热读，改 `~/.dsh/settings.yaml` **立即生效、无需重启**。
- 当前 `~/.dsh/settings.yaml` **根本没有 `dsh-btw:` 段**（`grep -n "^[a-zA-Z0-9_-]*:" settings.yaml` 只有 `ui-onboarding / llm-deepseek / llm-pi-ai / agent-default-model / vision-adam / agent-presets / web-search-deepseek / wallpaper / dsh-workerspace / dsh-ssh-gui`），所以**全部走代码默认值**：`vision.autoTransform = true`、`model.default = deepseek-v4.1-flash`、`model.options = [deepseek-v4.1-flash, glm-5.3, deepseek-v4-pro]`。

**最小修复**（详见 §5）：

1. **【热面 · 零代码 · 立即可做】不要动 `dsh-btw.model.default`**，保持 `deepseek-v4.1-flash`（它声明了 `input: [text, image]` → 走原图直传，实测可用）。若要在 btw 里换模型，**不要**选 `glm-5.3` / `deepseek-v4-pro`（二者未声明 image，会落到 vision-adam 转文本路径，多一跳、多一个失败点）。
2. **【冷面 · 修 D1】** `dsh-btw/src/host/side-chat-service.ts`：在 `startResumed()`（:816）与 `transcript()`（:426）里，从子会话日志的 `user/message` 事件中把 `attachment` 引用回填进 `imageRefsByMessageId`，或在持久层落一份 ref 索引。**这是本次唯一建议动手的代码修复**。
3. **【冷面 · 修 D2】** 在 `dsh-btw/src/shared/tool-policy.ts:20-25` 的 `READ_ONLY_TOOL_CANDIDATES` 里加入 `'analyze_image'`，给侧聊补回看图兜底（`visibleReadTools()` :154-155 会与父代理真实注册的工具求交，父代理没装该工具时自动不生效，安全）。

---

## 1. 版本锚点：部署位 vs 工作区源码

**结论（代码确证）：部署位 = 工作区源码的当前状态，本次审计以两者互证。**

| 项 | 值 | 证据 |
|---|---|---|
| 部署位 | `~/.dsh/profiles/node_modules/@local/dsh-btw/` | 目录存在 |
| 部署位产物 | `lib/index.js` 64280B / `lib/client.js` 335348B，mtime **09-17 17:29** | `ls -la .../lib/` |
| 工作区源码 | `/home/CNS2026495165/dsh/dsh-btw/src/**`，`side-chat-service.ts` mtime **09-17 17:23** | `ls -la src/host/` |
| git | `3029012d`（09-17 18:34），`git status --short` 对 `dsh-btw/` **无改动**（只有 `.workspace/*.md` 未跟踪） | `git log -1` / `git status` |

关键片段逐条比对（**全部一致**）：

| 判据 | 源码 | 部署位 |
|---|---|---|
| 能力门禁文案 | `src/host/side-chat-service.ts:1112` | `lib/index.js:1257` `"当前模型不支持图片，且 dsh-btw.vision.autoTransform 已关闭（不自动转文本）。请开启该开关或改用支持图片的模型。"` |
| `autoTransform` 默认 | `src/index.ts:37` `.default(true)`；`:39` `.default({ autoTransform: true })` | `lib/index.js:1696` 同；`:1718` 同 |
| 直传判定 | `src/host/side-chat-service.ts:1094-1098` | `lib/index.js:1245` `if (route !== void 0 && await modelAcceptsImage(this.ctx, route)) directContent = [...]` |
| 贴图 handler | `src/client/SideChatSurface.tsx:400-419` | `lib/client.js:1596-1612` `onComposerPaste` |
| 客户端默认值 | `src/client/btw-settings.ts:36,39` | `lib/client.js:1131-1145` `BTW_DEFAULT_MODEL="deepseek-v4.1-flash"`、`vision: Object.freeze({ autoTransform: true })` |

> 唯一检索到的差异是**搜索词本身**：`directContent` 在部署位出现 3 次、在源码出现 2 次（编译产物多一处变量声明），非行为差异。
> **无版本漂移**，因此下文所有行号同时给出源码与部署位。

---

## 2. 两条管线逐段对照（主会话 vs btw 侧聊）

| # | 环节 | 主会话 | btw 侧聊 | 差异性质 |
|---|---|---|---|---|
| 1 | 客户端贴图 | web 主壳输入框（官方 `dsh-client-ui-chat` + `dsh-client-file-upload`）；上传走官方附件通道 | btw 自己的 `onComposerPaste`：`[...event.clipboardData.files].filter(f => imageTypeOf(f.type) !== undefined)` → `FileReader.readAsDataURL` → `viewStore.addAttachment()`（`SideChatSurface.tsx:400-419`；部署位 `client.js:1596-1612`） | **不同实现**：btw 只认 `image/*` 且只读 `clipboardData.files`（不支持 drag&drop / 文件选择器）；主会话用官方上传链路 |
| 2 | 前端 → 宿主 | WebSocket `prompt` RPC，payload `content` 为 **base64 data** 的 parts 数组 | btw 远端 `send()`：`images: [{type:'image', mediaType, data(base64), name?}]`（`controller.ts:498-505`） | 不同传输契约 |
| 3 | 宿主附件落盘 | `dsh-host-apiproxy/lib/index.js:2771` 之后 `durablePromptContent(ctx, effective)` 落盘 → `{type:'image', attachment: ref}` | btw 自己调 `admitEncodedImages(attachments, images)`（`side-chat-service.ts:1084-1090`；部署位 `index.js:1229-1236`） | **两条独立落盘实现，但落同一个 store**（见下） |
| 4 | 能力判定 | `dsh-host-apiproxy/lib/index.js:2777-2784`：`ctx.llm.resolveModelInfo(current.provider, current.model)`，`!inputModalities.includes('image')` → 直接 `err{code:'attachment-error', reason:'MODEL_DOES_NOT_SUPPORT_IMAGES'}` | `modelAcceptsImage(this.ctx, route)`（`vision.ts:90-99`；部署位 `index.js:198-208`），失败/未知 **返回 false 并静默降级**为转文本 | **语义不同**：主会话"不支持就拒发"，btw"不支持就转文本" |
| 5 | 转文本兜底 | 瀑布 `session/prompt-image-transform`（`apiproxy:2771`）→ btw 注册的 handler（`src/host/prompt-transform.ts:88-134`，注册于 `src/index.ts:69`） | btw `send()` 内联同一套 `analyzeImages` + `wrapImageDescriptions`（`side-chat-service.ts:1099-1127`） | 同一套 vision-adam，**入口不同** |
| 6 | 直传/转文本分叉 | 瀑布 handler 里 `await passDirect(ctx, payload.agent)`（`prompt-transform.ts:119`） | `side-chat-service.ts:1094` `entry.modelSelection?.current` → `modelAcceptsImage` | 同一判定函数，**取 route 的方式不同**（主会话读 agent 的 logged header/default selection；btw 读 `installBtwModelSelection()` 装的可变 current，`side-chat-service.ts:875-895`） |
| 7 | 请求组装 | 官方 agent loop 收 `createUserMessage`（由 apiproxy 造） | btw 自己 `createUserMessage({content: directContent ?? [{type:'text',...}], source:{kind:'user'}})` 后 `entry.handle?.agent.followup(message)`（`side-chat-service.ts:1129-1145`） | **关键分叉点**：btw 完全绕过 `prompt` RPC，因此**绕过第 4 步的宿主闸门** |
| 8 | 附件目录 | `~/.dsh/attachments/v1/{objects,request-images,tmp}` | **同一个 store**（`btwHome()` 只用于会话索引：`btw-registry.ts:48-54` → `~/.dsh/btw/index.json`） | **无命名空间分裂**，候选链 (e) 排除 |
| 9 | 模型侧图片序列化 | `dsh-llm-pi-ai` `toPiContextWithImages` → `prepareRequestImages` → `attachments.readImageRequest`（`dsh-llm-pi-ai/lib/index.js:1118,1188`） | 同一适配器（provider `adam` 由 `llm-pi-ai` 承载，见下） | **同一适配器**，候选链 (d) 需另找证据 |

补充确证（provider → 适配器归属）：
- `~/.dsh/settings.yaml:4` `llm-pi-ai:` → `:73` `adam:` → `:75` `api: openai-completions`，`deepseek-v4.1-flash` 在 `:173-177` 声明
  ```yaml
  - id: deepseek-v4.1-flash
    contextWindow: 1000000
    input:
      - text
      - image
  ```
- `dsh-llm-pi-ai/lib/index.js:922` `input: z.array(z.union(MODALITIES))`（配置键就是 `input`）→ `:1668/:1687` `inputModalities: [...model.input]` —— **声明直接变成 `resolveModelInfo` 的返回**。

---

## 3. 能力判定逻辑（精确到字段）

### 3.1 btw 侧判"模型是否支持图片"

代码确证（`src/host/vision.ts:90-99`；部署位 `lib/index.js:198-208`）：

```ts
export async function modelAcceptsImage(ctx: Context, route: ModelRoute, signal?: AbortSignal): Promise<boolean> {
  const llm = (ctx as { get?: (name: string) => unknown }).get?.('llm') as ModelInfoLlm | undefined
  if (llm?.resolveModelInfo === undefined) return false
  try {
    const info = await llm.resolveModelInfo(route.provider, route.model, signal)
    return Array.isArray(info?.inputModalities) && info.inputModalities.includes('image')
  } catch {
    return false
  }
}
```

- **读的字段**：`ctx.llm.resolveModelInfo(provider, model)` 返回的 **`inputModalities`**（不是 btw 自己的白名单、不是 btw 设置里的清单）。
- **数据来源链**：`settings.yaml` 的模型条目 `input: [text, image]` → `dsh-llm-pi-ai` 配置 schema `:922` → `modelInfo()` `:1687` `inputModalities: [...resolvedModel.input]` → `dsh-llm` `resolveModelInfoFor → normalizeModelInfo`（`dsh-llm/lib/index.js:1390-1420`）。
- **失败语义**：`llm` 服务缺失、route 不可解析、`resolveModelInfo` 抛错、模态数组缺失 → **一律 false**，静默走转文本（保守，不报错）。**这是"静默降级"，没有任何日志或 UI 提示。**
- btw 侧 route 的取法（`side-chat-service.ts:1094`）：`entry.modelSelection?.current`；该 current 由 `installBtwModelSelection()`（`:875-895`）实现，优先级 = `setModel` 显式选择 → 子会话 logged `requestHeader().config` → `btwDefaultModel(ctx)`；provider 恒为 `adam`（`:83`）。
- **`route === undefined` 时不判定、直接进转文本分支**（`:1094` `if (route !== undefined && await modelAcceptsImage(...))`）——这也是一个静默降级点。

### 3.2 `dsh-btw.vision.autoTransform` 的默认值与语义

| 项 | 值 | 证据 |
|---|---|---|
| 默认值 | **`true`** | `src/index.ts:37` `autoTransform: z.boolean().default(true)`；`:39` `.default({ autoTransform: true })`；部署位 `lib/index.js:1696 / :1718`；客户端 `btw-settings.ts:44` / `client.js:1144` |
| 当前实际值 | **`true`（且在跑默认值）** | `~/.dsh/settings.yaml` **无 `dsh-btw:` 段**（顶层键清单见 §0） |
| 语义（开=true） | 模型不声明 image 时，**把每张图同步转成文本**：`attachments.readImage(ref)` → base64 → `analyzeImages()`（`vision.ts:195-219`）→ `wrapImageDescriptions()`（`:121-130`，R1-9 模板，含「用户附带了 N 张图片，以下为各图片的描述（vision-adam 生成）：」）→ 只把**文本**交给对话模型 | `side-chat-service.ts:1101-1126` |
| 语义（关=false） | **直接拒绝发送**并回错误文案（见 §0 表上方引文），图不落进会话 | `side-chat-service.ts:1106-1115` |
| 转文本调谁 | 部署位 `@deepseek-ai/dsh-vision-adam`，配置取 `settings` 的 **`vision-adam` 段**（不是 `dsh-btw`） | `vision.ts:144-154`；现配置 `settings.yaml:186-190`：`model: deepseek-v4.1-flash`、`baseURL: https://llmapi.roboscience.xyz/v1`、`apiKeyEnv: ADAM_API_KEY`、`maxTokens: 393216` |
| 失败行为 | 抛错 → `send()` 返回 `{code:'internal', message:'vision-adam 分析失败: ...'}`，**整条消息不发送**（requestId 不留记录，可重试） | `side-chat-service.ts:1122-1126`；`vision.ts:203-205` 另包一层「vision-adam 凭据不可用: ...」 |

**旁证（说明设计意图，非本次证据）**：`dsh/.dsh/taste/taste.md:3` 记录了本部署的裁决口径——「模型条目声明 `input` 含 image 则主会话/侧聊**原图直传**，未声明（如 `deepseek-v4-flash`）仍统一经 vision-adam 转文本，使图片输入与对话模型的视觉能力解耦」。

---

## 4. "找不到"到底是哪一步断了：候选链逐条排查

### 4.0 先给硬证据：**当前部署位上，btw 贴图是通到模型的**

审计在 `~/.dsh/sessions/**` 与 `~/.dsh/attachments/**` 中定位到 **2 次真实 btw 贴图**，两次都是**原图直传**（会话日志里出现 `image` 内容块，且**完全没有** R1-9 转文本标记）：

**证据 A —— 2026-09-17 17:57 / 17:58（btw 会话 `6299aa16-4eec-4ace-af3b-e3273cc759ff`，2 张图）**

用户消息（`user/message` seq 14，time 1789639035825）：
```json
{"content":[{"type":"text","text":"解读一下这个选项"},
 {"type":"image","attachment":{"attachmentId":"sha256:b76163802b9de8e9db996c48da1a7363956e2a63eb4aa3149698a9cf61c76df3", ...}}],
 "source":{"kind":"user"},"role":"user"}
```
`request/header` config = `{"provider":"adam","model":"deepseek-v4.1-flash"}`（seq 19）。
**模型答出来了**（`assistant/message` seq 23，`usage {inputTokens: 9610, outputTokens: 482}`）——其 reasoning 原文引用了**只存在于截图里、用户文字里没有**的内容：
> 「Let me gather facts lightly — the screenshot says: **S21 显式模型选择: 建议否决**. Evidence: `dsh-tool-subagent/lib/index.js:287` default `false`; `:618-621` when false, earl…」

用户该条文字仅为「解读一下这个选项」，无以上任何字样 ⇒ **模型确实看到了图**。

**证据 B —— 2026-09-18 10:24（btw 会话 `81487e19-8891-4940-8f42-130ff57c60fe`，1 张图，**当前部署位 + 当前服务进程**）**

`user/message` seq 12（time 1789698251858）：
```json
{"content":[{"type":"text","text":"这几个选项如何理解"},
 {"type":"image","attachment":{"attachmentId":"sha256:0920a5072917ed92ed2b41b7c2a358f63fa468b3e92a6429cf67387cd8b9225b",
  "mediaType":"image/png","width":2048,"height":872,"bytes":522975,"name":"image.png",
  "originalDimensions":{"width":2178,"height":927}}}],
 "source":{"kind":"user"},"role":"user","id":"d890e281-f960-472d-b72c-17f651dc8a96"}
```
同一内容亦见于 `agent/inbox/spliced` seq 5（`target: "next-turn"`）。`request/context` seq 20 = `{"provider":"adam","model":"deepseek-v4.1-flash","contextWindow":1000000}`。
模型 reasoning（seq 21，10:24:22）复述了用户**只在截图里才有**的内容：
> 「They want an interpretation of the four options: A/B/C/D for **"P2 三项 (glove-solution 重建决策 / mHandPro.so 授权策略 / DOCS 仓远程发布) 本轮是否纳入?"**」

且该会话**零次**出现 `vision-adam 生成` 标记、**2 次** `attachmentId`（`grep -c` 实测：`0` / `2`）⇒ 走的是 `directContent` 直传分支，不是转文本分支。

**附件落盘反证（同一次贴图）**：
```
2026-09-18 10:24  522975  ~/.dsh/attachments/v1/objects/09/0920a5072917ed92ed2b41b7c2a358f63fa468b3e92a6429cf67387cd8b9225b
```
sha 与消息里的 `attachmentId` 完全一致 ⇒ 附件服务、内容寻址、refs 全部正常工作。

### 4.1 逐条排除

| 候选链 | 判定 | 证据 / 缺口 |
|---|---|---|
| **(a) btw 客户端根本没上传/没带进消息** | **排除（代码确证 + 实例确证）** | handler 在（`SideChatSurface.tsx:400-419` / `client.js:1596-1612`）；`controller.ts:498-505` 把 `images` 打进远端 payload；证据 A/B 的 `user/message` 里 image 块与 `attachmentId` 俱在 |
| **(b) 进了会话但被判"不支持"→ 剥掉/换占位文本** | **排除（实例确证）** | 两次都落 `directContent`（日志里是 image 块本身，无 R1-9 标记）；若走转文本分支，会话日志会出现 `用户附带了 N 张图片…（vision-adam 生成）`，实测 `grep -c "vision-adam 生成"` = **0** |
| **(c) 判为需转文本但 vision-adam 调用失败/未接** | **本次未触发；但该路径可用性未被验证** | 触发时行为是**整条发送失败**并回错误文案（`side-chat-service.ts:1106-1112` / `:1122-1126`），**不会**出现"图被静默丢弃"；该路径只在选中 `glm-5.3` / `deepseek-v4-pro` 时才会走到。**缺口**：本次无该路径的真实会话样本（历史 btw 会话只有上述 2 次贴图，均为直传），所以"vision-adam 在 btw 路径上今天是否可用"**无法确证**——只能说明它配置齐全（`vision-adam` 段 + `ADAM_API_KEY` 走凭据链） |
| **(d) 图进了请求但模型侧确实不看图** | **排除（实例确证）** | 证据 A/B 的 reasoning 均引用了**仅存在于截图**的文本；模型为 `adam/deepseek-v4.1-flash`，其声明 `input: [text, image]`（`settings.yaml:173-177`）经 `dsh-llm-pi-ai:922/:1687` 变成 `inputModalities`，`dsh-llm-pi-ai/lib/index.js:1721` 还会用 `model.input.includes("image")` 二次校验，不通过会抛 `UNSUPPORTED_CONTENT`（不会有回复） |
| **(e) 附件目录/命名空间不同，引用跨不过去** | **排除（代码确证）** | btw **没有**自己的附件根：`btwHome()` 仅用于会话索引 `~/.dsh/btw/index.json`（`btw-registry.ts:48-54`）；图片落盘走 `admitEncodedImages` → 同一个 `attachments` 服务 → 同一 `~/.dsh/attachments/v1/**`（证据见上，sha 吻合） |
| **(f) 新增候选：侧聊 resume 后图片引用全丢（D1）** | **成立（代码确证；该场景下的"找不到"必然发生）** | `imageRefsByMessageId: new Map()` 在 `startResumed()`（`side-chat-service.ts:816`）与新建（`:684`）都是**空 Map**，**全代码没有任何地方从持久日志重建它**（`grep imageRefsByMessageId` 只有 5 处：:277 读、:401 声明、:684/:816 置空、:1134 发送时写）。`transcript()` 用 `imageRefsOf(entry, id)`（`:276-278`）取 `images` 字段 → 恢复后恒为 `undefined`；`readSideChatImage()`（`:1233-1256`）遍历同一空 Map → 返回 `{code:'invalid-input', message:'Unknown attachment id for this side conversation.'}`；客户端拿不到 bytes 就**不渲染缩略图**（`SideChatSurface.tsx:539-562`）。**用户看到的现象 = 历史图片整片消失**（"找不到"）。原始对象其实还在 `objects/` 里，**是引用没持久化，不是数据丢了** |
| **(g) 新增候选：btw 没有 `analyze_image` 兜底（D2）** | **成立（代码确证）** | `src/shared/tool-policy.ts:20-25` 的 `READ_ONLY_TOOL_CANDIDATES` 里有 `read_image` 但**没有** `analyze_image`；`grep -c "analyze_image" 部署位 lib/index.js` = **0**。而主会话系统提示里该工具是明写的（「Use the analyze_image tool to understand image and video files… it works even when the current model cannot receive images directly」）。后果：主会话在模型不支持图时有工具兜底，**侧聊没有任何兜底**——只能走 vision-adam 预转文本，失败即整条失败 |
| **(h) 新增候选：主会话 vs 侧聊的"不支持"语义不同（行为落差）** | **成立（代码确证）** | 主会话：宿主闸门直接拒发，错误码 `attachment-error` / `MODEL_DOES_NOT_SUPPORT_IMAGES`（`apiproxy:2777-2783`）；侧聊：静默转文本（`side-chat-service.ts:1099+`）。同一用户操作在两边表现完全不同，正是用户所说"**不同管线**"的实际体感来源 |

### 4.2 关于"那次贴图"的检索范围（诚实边界）

**查了哪些位置**：

1. `~/.dsh/btw/index.json`（btw 自己的会话索引，5 条条目）→ 定位到 `81487e19-…`（parent `session-f280a6e9-…`，10:24）
2. `~/.dsh/sessions/**/session.jsonl.zstd`：全量扫描「含 user image 块」的会话，得 4 条 —— 主会话 `session-cb106ec3`（9/17 18:31）、主会话 `session-bc0b7655`、**btw `6299aa16`（9/17 17:57+17:58）**、**btw `81487e19`（9/18 10:24）**
3. btw 子会话判别法：`origin:"subagent"` **且无** `parentSession`（`hiddenSideChatMeta()` 故意剥掉 durable parent link，`side-chat-service.ts:158-166`）或 `request/header.system` 含 btw persona
4. `~/.dsh/attachments/v1/{objects,request-images}` 全量时间线比对
5. 全量会话正文检索 `找不到` + (`btw`|`侧聊`)，命中唯一相关处：`session-cb106ec3` 的 `ask_user_question` 工具结果（用户 custom 答复原文，10:28:14）：
   > `{"id":"bar_ramp","selected":[],"custom":"线性归一化到黄到橙，此外，btw侧聊的图像传入有问题，他好像和主会话的图像传入是不同管线，导致我截图向他提问他也找不到"}`

**没能查到的**：用户报告时所指的**那一次具体贴图**（既不是 9/17 17:57/17:58 那两张，也不是 9/18 10:24 那张——那三张**都成功了**）。用户是在 `ask_user_question` 的自由文本框里提的缺陷，**没有留下失败现场**；10:28:14 之后 btw 侧无新的贴图记录，10:29:40 的 btw 第 2 轮是纯文本（`content: [text]`）。
⇒ **结论：无该次失败记录**。（不排除是 9/17 之前、或已被 9/17 首次部署覆盖的旧版本 btw 的行为；但**不足以定性**，故不作为根因。）

**一个可复现的时序线索（推断，非确证）**：唯一的共振点是**resume**——10:24 那次贴图成功后，若用户把抽屉关掉再打开（触发 `startResumed()`，`side-chat-service.ts:825` `ctx.agents.resume`），D1 立刻生效：历史那张图**从面板上消失**（缩略图不渲染），且对模型而言该图仍在日志里但面板无法证明它"在"。用户完全可能据此判断"图丢了/他找不到"。

---

## 5. 根因结论

### 5.1 一句话根因（对"报告的那次故障"）

> **无法判定（缺观测）**：用户报告的那一次贴图**没有留下失败记录**（查遍 btw 索引、全部会话日志、附件时间线，btw 侧仅有的 3 次贴图全部成功直传到模型）；而当前部署位上 btw 贴图管线**经实测可用**。

### 5.2 与用户描述吻合、且已被确证的管线缺陷（本报告的实际落点）

> **btw 侧聊与主会话确实是两条独立管线（用户判断正确）**；两条管线在"能力判定"上语义相反（主：不支持就拒发；侧：不支持就静默转文本），在"图片引用持久化"上 btw 是**内存态**（resume 即全丢，D1），在"看图兜底"上 btw **缺 `analyze_image`**（D2）。D1 精确产生"截图不见了/找不到"的表象。

### 5.3 完整因果链

```
用户贴图
 ├─ 客户端: onComposerPaste(clipboardData.files → dataURL)
 ├─ 远端:   send({images:[{mediaType,data}]})
 ├─ 宿主:   admitEncodedImages(attachments, images) → objects/<sha> 落盘 (durable)
 ├─ 能力判定: modelAcceptsImage(ctx, entry.modelSelection.current)
 │     ├─ true  → directContent=[text?, image(attachment ref)]        ← 9/17、9/18 两次实测走此路
 │     └─ false → autoTransform?
 │                  ├─ true  → vision-adam 逐图转文本 → R1-9 模板 → 只发文本（失败则整条不发送）
 │                  └─ false → 直接拒绝发送（§0 引文）
 ├─ createUserMessage(content) → entry.handle.agent.followup(message)   ← 绕过 apiproxy 的 prompt 闸门
 ├─ 子会话日志: user/message 带 image 块（durable，含完整 attachment ref）
 └─ 面板显示: transcript() 用 【内存】 imageRefsByMessageId[messageId] 取 images
        ├─ 同一次 open 内 → 有 → 缩略图正常
        └─ 关闭/重开（startResumed :816 new Map()）→ 空 → images 缺失 + readSideChatImage → invalid-input
                                                   → 缩略图不渲染、引用"消失"（D1）
```

### 5.4 为什么"主会话能、btw 不能"（语义层差异）

1. **入口不同**：主会话走 `apiproxy.prompt` → **宿主闸门会替它把"模型不支持图"翻译成明确错误**，且 btw 注册的 `session/prompt-image-transform` 瀑布**只在主会话路上跑**；btw 自己那条路把同一套能力判定**内联**了一遍，并且**判定失败时静默降级**而不是报错。
2. **引用生命周期不同**：主会话的历史图片引用在会话日志里是标准 `attachment` ref，官方 `sessions.readAttachment` / 附件投影能读回来；btw 面板的显示通道是**插件自建的内存 Map**（因为 btw 子会话的日志"只留文本"这一前提写在 `readSideChatImage` 的注释里，`side-chat-service.ts:1229-1231`），resume 后无法恢复。
3. **兜底不同**：主会话有 `analyze_image`（模型看不见图也能让工具去"看"）；侧聊白名单没有该工具。

---

## 6. 最小修复方案

> 全部只读评估，**未执行**。

### 修复 A（推荐主线 · 冷面 · 修 D1：resume 后图片引用丢失）

- **文件/位置**：`dsh-btw/src/host/side-chat-service.ts`
  - `startResumed()` :816 `imageRefsByMessageId: new Map(),`
  - `transcript()` :426 起的事件遍历
  - 参照 `:276-278` `imageRefsOf()`
- **改法**：在 resume 建立 entry 时，从 `handle.agent.session.events` 里扫 `type === 'user/message'` 且 content 含 `type:'image'` 的事件，把 `block.attachment` 按 `String(event.data.id)` 回填进 `imageRefsByMessageId`；`transcript()` 的 `imageRefsOf` 相应改为「内存优先、日志兜底」。回填后 `readSideChatImage()`（:1233）无需改动即可命中，缩略图恢复。
- **面**：**冷面**（宿主 lib）。机制理由：这是宿主侧运行时状态构造，不在设置命名空间、不在 client bundle；DSH 部署位插件只认 `lib/*.js`，`dsh-btw` 每次派发/恢复都从模块加载的代码里取，**改完必须重启 `dsh web`**（HMR 只覆盖 client bundle，且需要 `pnpm run dev:web` 在跑）。
- **是否只需改配置**：**否**，此项必须改代码。
- **回滚**：`~/.dsh/profiles/node_modules/@local/dsh-btw/lib/index.js` 改前先 `cp` 一份带时间戳的 `.bak`（本部署已有先例：`dsh-vision-adam/lib/index.js.bak-restore-20260912-161015`），回滚 = 覆盖回 `.bak` + 重启。源码侧 `git revert` 对应提交。

### 修复 B（冷面 · 修 D2：补回看图兜底）

- **文件/位置**：`dsh-btw/src/shared/tool-policy.ts:20-25` `READ_ONLY_TOOL_CANDIDATES`
- **改法**：数组里加入 `'analyze_image'`。**不要**改 `READ_ONLY_TOOL_SET` 的其它成员。（`visibleReadTools()` `side-chat-service.ts:154-155` 会与父代理真实注册的工具求交，父代理未装该工具则自动不生效；`isSideChatToolAllowed` 守卫是白名单制，加这一项等于同时放行执行。）需同步核对父代理侧工具名确为 `analyze_image`（本会话系统提示中即此名）。
- **面**：**冷面**，同上需重启。
- **是否只需改配置**：否。
- **回滚**：同 A。

### 修复 C（热面 · 零代码 · 建议先做）

- **不需要改任何文件**。维持 `~/.dsh/settings.yaml` **不写 `dsh-btw:` 段**（或显式写 `vision.autoTransform: true` + `model.default: deepseek-v4.1-flash`）：
  ```yaml
  dsh-btw:
    model:
      default: deepseek-v4.1-flash
      options: [deepseek-v4.1-flash, glm-5.3, deepseek-v4-pro]
    vision:
      autoTransform: true
  ```
- **理由**：只有 `deepseek-v4.1-flash`（及 `deepseek-v4-flash-vision-exp`）在 `settings.yaml` 里声明了 `input: [text, image]`，才走**原图直传**（本次两次实测的那条路）；`glm-5.3` / `deepseek-v4-pro` 未声明 → 落到 vision-adam 转文本路径（`side-chat-service.ts:1099+`），**多一跳网络、多一个失败点，且当前无成功样本**。
- **面**：**热面（值级）**。机制理由：`readBtwSettings()`（`vision.ts:169-186`）每次调用都 `ctx.get('settings').get('dsh-btw')`；`btwDefaultModel()`（`:120-122`）与 `btwRoutableModels()`（`:113-116`）均 per-call 读 → 编辑 yaml 立即生效；客户端也一样（`btw-settings.ts` 的 `bindBtwSettings` + `decodeBtwSettings`，当前走 `BTW_SETTINGS_DEFAULTS`）。
- **回滚**：删掉该段即回到当前默认值。
- **⚠️ 不要**为了"让图能进"而去关 `autoTransform`（`false` 会让未声明图片的模型**直接拒发**，错误文案见 §0）——方向正好相反。

### 修复 D（可选 · 冷面 · 消除行为落差，修 D2 的语义面）

- **文件/位置**：`dsh-btw/src/host/side-chat-service.ts:1099-1115`（转文本分支入口）
- **改法**：在 `autoTransform === true` 但 `analyzeImages` 失败时，除返回 `internal` 错误外，把失败原因透传到面板（现在已经是 `vision-adam 分析失败: …`，可再加"可改用 deepseek-v4.1-flash 直传"的引导文案），使"静默降级"变成"可见降级"。**属体验改进，非必要**。

---

## 7. 验证方案

### 7.1 改完怎么证（可观测判据）

**对修复 A（D1）—— 决定性判据（面板 + 日志双证）**：

1. 在 btw 抽屉贴一张**内容唯一**的截图（例如含一串随机 token 的图片），提问后让它答出来 ⇒ 首次仍应直传（沿用 §3/§4.0 判据）。
2. **关闭抽屉再重新打开**（触发 `startResumed()`）。
3. 观察三点，全部满足才算修好：
   - 面板上那条历史消息**仍显示缩略图**（不显示即为未修复）；
   - 该会话日志（`~/.dsh/sessions/<cwd编码>/<childSessionId>/session.jsonl.zstd`，`zstd -dc` 后）里，`user/message` 事件的 content **仍含 `{"type":"image","attachment":{"attachmentId":"sha256:…"}}`**（这是**修复前后都不变**的：它证明日志侧本来就没丢，丢的是引用重建）；
   - 重新打开后**再发一条新帖图**，`~/.dsh/attachments/v1/objects/<前两位>/<sha>` 出现新文件且 mtime 与发送时刻一致。
   > 反证基线（修复前应观察到）：resume 后同一条历史消息的 `images` 字段消失、缩略图区域空白；`readSideChatImage` 收到 `invalid-input / Unknown attachment id for this side conversation`。

**对修复 B（D2）**：在 btw 抽屉里**选 `glm-5.3`**（未声明 image）贴一张图 → 正确行为是走 vision-adam 转文本并**成功作答**；此时会话日志里应出现 `用户附带了 1 张图片，以下为各图片的描述（vision-adam 生成）：` + `[图片 1] …`（`grep -c "vision-adam 生成"` ≥ 1），且该消息 content **只有 text、没有 image 块**。若失败，日志与面板应给出 `vision-adam 分析失败: …`（不再是静默）。修复 B 生效的额外判据：侧聊子会话的 `request/header.tools[]` 里出现 `analyze_image`。

**对修复 C（纯配置）**：无需重启，改完立刻生效的判据 = 抽屉模型下拉的当前项与默认值变化（`btwCurrentModel`/`btwDefaultModel` per-call 读）。

### 7.2 不改代码的临时绕法

| 场景 | 绕法 | 依据 |
|---|---|---|
| 想让侧聊**看图**（今天就能用） | **保持/切到抽屉里的 `deepseek-v4.1-flash`**（默认项）——它声明 image，走原图直传，本次两次实测成功 | §4.0 证据 A/B；`settings.yaml:173-177` |
| 侧聊里想换别的模型又问图 | 别在 btw 里换；**在主会话用 `deepseek-v4.1-flash` 提问**（主会话直传链路 + `analyze_image` 兜底都在） | `apiproxy:2771-2783` |
| 侧聊模型看不见图时的兜底 | 侧聊**没有** `analyze_image`（D2）。临时办法：把图存成文件，在侧聊里用 `read_image`（白名单里有）让模型直接读文件——注意这与"贴图"是两条不同通道，**能否看到取决于当前模型是否声明 image，`read_image` 只是把文件字节喂回去** | `tool-policy.ts:21` 含 `read_image`；无 `analyze_image` |
| 侧聊历史里的图"消失"了想再看 | 目前无热绕法（D1 是宿主内存态）；图片**原始对象仍在** `~/.dsh/attachments/v1/objects/<sha>`，可直接按 sha 从磁盘取原图 | §5.3；`objects/09/0920a507…` 实测存在 |
| 担心 `autoTransform` 被误关 | `~/.dsh/settings.yaml` 里**不要**写 `dsh-btw.vision.autoTransform: false`（那会让未声明图的模型直接拒发） | `side-chat-service.ts:1106-1115` |

---

## 8. 论断分级清单（诚实边界）

**代码确证**：
- 两条管线的分段与分叉点（§2 全表）
- 能力判定读 `inputModalities`、失败静默降级（§3.1）
- `autoTransform` 默认 true、开/关语义、转文本调 vision-adam（§3.2）
- 附件无命名空间分裂，btw 只用 `~/.dsh/btw/index.json` 存索引（§2 第 8 行、§4.1(e)）
- **D1**（resume 后 `imageRefsByMessageId` 为空且无处重建）——`grep` 全量 5 处引用，无重建路径
- **D2**（btw 工具白名单无 `analyze_image`，部署位 bundle 出现 0 次）
- 主会话"不支持即拒发" vs 侧聊"不支持即转文本"的语义差（§4.1(h)）
- 部署位与工作区源码**一致**（§1 逐条比对）

**实例确证（实测/日志原始证据）**：
- btw 贴图在 9/17 ×2、9/18 ×1 共 3 次**全部直传到模型并据图作答**（§4.0 证据 A/B + §4.1 排除表）
- 附件落盘 sha 与消息 ref 一致（`objects/09/0920a507…`，10:24）

**推断（未证实）**：
- 用户"找不到"的体感可能来自 D1（关掉抽屉再打开后历史图消失）；**无失败现场样本，故仅为推断**
- 转文本路径（选 `glm-5.3` / `deepseek-v4-pro` 时）在当前部署位**是否可用**：配置齐全但**无实测样本**，§4.1(c) 标记为"无法判定"

**无法确证（缺什么观测）**：
- **用户报告的那一次具体失败贴图**：不存在对应会话记录/附件记录（§4.2）。缺的观测是：**失败时刻的 btw chatToken/childSessionId、面板错误文案、或该次请求的 `agent/inbox/spliced` 记录**
- 主会话 18:31 那次是 `request-images` 有派生（`bd67c9f2…`，196370B @18:31:53），而 btw 的三次贴图在 `request-images/` 下**没有对应新文件**（该目录 9/17 18:31 之后无写入）。**这一现象与"模型确实看到了图"并存**，本次**未能解释**（可能的解释：pi-ai 在该 route 上未走 `readImageRequest` 投影，或派生键复用；但**不猜测**）——记为未解观测差异，供后续用一次"在 btw 贴图并抓 pi-ai 请求"的实测去判定。

---

## 附：本次审计用到的关键命令（可复核）

```bash
# btw 会话索引与子会话定位
cat ~/.dsh/btw/index.json
# 全量找出"含用户图片块"的会话并区分主/侧聊
for f in $(find ~/.dsh/sessions -name session.jsonl.zstd); do zstd -dc "$f" | python3 -c "
import sys,json
es=[json.loads(l) for l in sys.stdin if l.strip()]
h=es[0]
img=[e for e in es if e['type']=='user/message' and e['data'].get('source',{}).get('kind')=='user' and any(x.get('type')=='image' for x in e['data']['content'])]
if not img: sys.exit()
btw=any(e['type']=='request/header' and 'persistent side conversation (btw)' in json.dumps(e['data']) for e in es)
print(('BTW  ' if btw else 'MAIN '),h.get('id'),'imgs=',len(img))
"; done
# 判据：btw 是否走直传（无转文本标记）还是转文本
zstd -dc <childSession>.jsonl.zstd | grep -c "vision-adam 生成"   # 0 = 直传
zstd -dc <childSession>.jsonl.zstd | grep -c "attachmentId"        # >0 = 消息带图
# 附件时间线
find ~/.dsh/attachments/v1/{objects,request-images} -type f -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' | sort
```

**报告路径**：`/home/CNS2026495165/dsh/.workspace/btw-image-pipeline-audit.md`
