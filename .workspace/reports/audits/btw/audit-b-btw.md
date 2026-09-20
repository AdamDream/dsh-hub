# 审计报告 B：btw 插件（v2 功能 + P0 + 面板对齐）

- 审计阶段：独立交叉审计（deepseek-v4-flash）｜只读，未改任何代码
- 方法：以源码 / 部署 bundle / 官方补丁 / 运行时解析链的真实盘面为准，不信执行报告
- 结论：**整体 PASS**。1 项低严重度元数据漂移（见 ⑥），无阻断问题。

---

## ① 源码 ↔ 部署一致性 — **PASS**

`/home/CNS2026495165/dsh/dsh-btw/lib/` vs `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/`：10/10 文件 `cmp` 逐字节一致
（client.js、index.d.ts、index.js、remote-BmXjp3i9.d.ts、remote-descriptors-xg8tvseq.js、remote-DxLkxvnp.js、typert.host.d.ts、typert.host.js、typert.remote-client.d.ts、typert.remote-client.js）。

运行时解析确认：从 `~/.dsh/profiles/web` 与 profiles 根做 `require.resolve('@local/dsh-btw')` 均落到 `~/.dsh/profiles/node_modules/@local/dsh-btw`（即已验证一致的部署位）。

源码落点证据（均存在于当前源码树）：

| 项 | 证据（文件:行） |
|---|---|
| 图片管线：analyzeImageBytes 调用 | `src/host/vision.ts:112`（懒加载 + 导出契约校验 :70-78；settings 读 `vision-adam` :81-90） |
| R1-9 模板 | `src/host/vision.ts:57-66`（`wrapImageDescriptions`：标题 + `[图片 N]` 段 + 用户原文） |
| 失败不发送 | `vision.ts:99-123` 分析抛错 → `side-chat-service.ts:1040-1041` 返回 `internal` 错误、requestId 未记录（重试会重跑）；主会话侧 `prompt-transform.ts:84` 抛错 → host 判 `agent-busy` 不发送 |
| sideChat/readImage | `side-chat-service.ts:1140-1167`（`readSideChatImage`，:1162 `attachments.readImage`） |
| listTree | `side-chat-service.ts:1174-1190`（`subagents.listDescendants` :1179） |
| listProject | `side-chat-service.ts:1197-1218`（`sessionQuery.listSessions` 按 realpath 过滤 :1205-1212） |
| remote-descriptors 数量 = 10 | `src/remote-descriptors.ts:37-47`（start/read/send/answer/cancel/close/setModel/readImage/listTree/listProject） |
| typert/client/descriptor 三处接线 | `src/remote-descriptors.ts`（descriptor 源）、`src/typert.host.ts:3-27`（host 面，10 members）、`src/client/remote.ts:23-39`（TYPERT_REMOTE + TypertRemoteMap 10 条），`client/index.ts:18-19` 挂载 |
| 索引 v2 parentTitle/parentCwd/lastPreview | `btw-registry.ts:34-37`（BtwIndexExtras）、`side-chat-service.ts:1243-1252`（indexExtras）、:1255-1267（touchIndex）、:1280-1290（listEntries 使用） |
| 模型路由三选项 + 持久化 | `side-chat-service.ts:74-77`（`['deepseek-v4-flash','glm-5.3','deepseek-v4-pro']` + provider adam + 默认 flash）、`installBtwModelSelection` :822-838（`requestHeader()?.config` 持久化 + `installModelSelection`）、setModel :1120-1132；UI 三 option `SideChatSurface.tsx:448-450` |

---

## ② P0 — **PASS**

- **检测点**：`src/host/side-chat-service.ts:707-712` — `this.ctx.get('subagents')` 后 `subagents?.materializeContinuableChild === undefined` 即返回「runtime patch 未应用」错误（:708-710），存在则调用 `materializeContinuableChild(directParent.parent, parentId, { signal })`（:712）。
- **冷恢复路径**：`side-chat-service.ts:590-601`（start 时 parent 非 live → `recoverParent`）、`:677-725`（subagent origin 分支 :698-717 递归上溯父链后 materialize；普通顶层会话 :719-724 走 `ctx.agents.resume`）。
- **部署 bundle 含该逻辑**：`~/.dsh/profiles/node_modules/@local/dsh-btw/lib/index.js:758-760`（相同检测 + 调用），`recoverParent` :739/:754，冷恢复入口 :669。grep 字符串命中。
- **官方 dsh-subagent 同服务类**：`~/.npm-global/.../dsh/node_modules/@deepseek-ai/dsh-subagent/lib/index.js` — `SubagentRuntime` 类起 :2450，`super(ctx,"subagents")` :2462，`materializeContinuableChild` :2524-2525（**同一类**，转发 `this.requireContinuations().materializeContinuableChild`；真实实现位于 `SubagentContinuationManager` :1199，经 `requireContinuations()` 到达）。
- **运行时解析无遮蔽**：默认 profile `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-subagent` 为符号链接 → 全局已打补丁副本（readlink 验证）；web profile 无独立 node_modules，Node 解析回落到默认 profile → 全局。唯一真实（非符号链接）未打补丁副本在 `~/.dsh/profiles/web2/node_modules/`（`materializeContinuableChild` 计数 0），但 web2 已由 `DEPRECATED.md`（2026-09-12）标记废弃、不在活动解析链上。**活动运行时只可达已补丁副本，无遮蔽。**

---

## ③ 面板对齐锚点 — **PASS**

| 项 | 源码证据 | 部署 bundle 锚点 |
|---|---|---|
| 运行横幅（浅绿 #b7e85b 系） | `SideChatSurface.tsx:481-489`（`runningBanner`，role=status）；CSS `side-chat.module.css:229-257`（sticky top、#b7e85b 渐变 shimmer 文字，注释 :226-228 明确从官方蓝改绿） | client.js `.SalQ5q_runningBanner/.runningBannerText`（#b7e85b 渐变 + shimmer keyframes） |
| 工具调用块（tool/call+result 摘要 + SideChatToolRow） | digest 构建 `side-chat-service.ts:435-464`（tool/call 建 digest、tool/result 按 toolCallId 结算 result/isError/running）；挂载 `SideChatSurface.tsx:516-522`；`SideChatToolRow.tsx:41-85`（DisclosureRow + IN/OUT ioCard + data-state） | `.SalQ5q_toolRow*`、`.toolRowIoCard/IoSection/IoLabel/IoDivider/IoText`（client.js 内联 CSS + 组件引用） |
| 图片徽标（左上角白底黑字） | `SideChatSurface.tsx:549-551`（仅多图消息，`{index+1}`）；CSS `side-chat.module.css:488-501`（top:4 left:4，background #fff，color #000，pointer-events none） | `.SalQ5q_messageImageBadge`（top:4px left:4px，#fff/#000） |
| lightbox（自绘 body-portal + Esc/遮罩/关闭 + imageCache 修复） | `ImageLightbox` `SideChatSurface.tsx:179-219`：`createPortal(..., document.body)` :205-218、Esc :192-203、遮罩点击 :207、关闭钮 :209-211；焦点回恢 :382-385；`imageCache` + `fetchStateRef`（'failed' 下次 effect 重试，修复开聊前读图失败） :242-305；CSS `:507-561` | client.js `ImageLightbox` ×5、`createPortal` :1328、`document.body` :1356、`imageCache`/`fetchState` 合计 11 处、`lightboxOpener` 3 处 |

---

## ④ 测试与 smoke 基线 — **PASS**

- **vitest run（本次实测，1 次）**：23 个测试文件全过；**199 passed | 2 skipped（201）**，Duration 840ms。
  - 2 个 skip 均为 `tests/sign-contract.spec.ts` 的环境专属渲染字节测试（native macOS 隔离渲染 / 本地作者环境），在 Linux 环境条件跳过，属预期。
- **smoke 断言**：`scripts/smoke-build.mjs` 断言 10 remote —— :16 `typert.TYPERT.invocations.length === 10`、:21 `remote.TYPERT_REMOTE.descriptors.length === 10`（另有 10 方法名逐一断言 :17-19、readImage/listProject 存在 :22-23）。实测运行输出 `smoke ok: @local/dsh-btw build artifacts consistent`。
- 测试还覆盖了 P0/面板锚点：`host-recovery.spec.ts`（冷恢复）、`host-image.spec.ts` / `vision-template.spec.ts`（图片管线 + R1-9）、`side-chat-surface.spec.tsx`（22 测试：横幅/徽标/lightbox 交互/imageCache）、`banner-theme.spec.ts`。

---

## ⑤ 主会话图片变换 waterfall 对齐 — **PASS**

- **官方 host-apiproxy**：`~/.npm-global/.../dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js:2771`
  `const transformed = await ctx.waterfall("session/prompt-image-transform", { agent, content }, () => void 0)`；
  语义 :2768-2775：`transformed !== void 0` 才替换 effective → 有 image 部分才触发模型图片门；抛错进 catch → `err(agent-busy, "prompt rejected")` **不发送**。
- **btw host 监听器签名**：`src/host/prompt-transform.ts:43-46` 事件名一致；`:29-32` payload `{ agent, content }` 一致；handler :66-87：先 `next()`（:74，尊重更早注册者的变换）→ 无 image 部分返回 `undefined` = 不拦截（:77/:79）→ 分析后返回纯文本模板数组 = 变换（:85）→ 分析失败抛错 = 不发送（:84）。**与官方契约逐一吻合。**

---

## ⑥ 问题清单（按严重度）

| 严重度 | 问题 | 证据 | 处置建议 |
|---|---|---|---|
| **低** | 部署 `package.json` 缺 2 条 peerDependencies（`@deepseek-ai/dsh-attachment`、`@deepseek-ai/dsh-vision-adam`），源码有、部署无 | `diff package.json`：源码 :97/:103 两条缺失于 `~/.dsh/profiles/node_modules/@local/dsh-btw/package.json` | 不影响运行：两处均为懒动态 import（`side-chat-service.ts:1022`、`vision.ts:71`），且两包均已部署于 profile node_modules（vision-adam 导出 `analyzeImageBytes/resolveOptions/resolveApiKey` 实测在 :147/:90/:107）。下次重发包时补回即可 |
| 无 | web2 profile 内存有未打补丁的 dsh-subagent 与旧版 dsh-btw（materialize 计数 0） | `web2/node_modules/@deepseek-ai/dsh-subagent/lib/index.js` 计数 0；`web2/node_modules/@local/dsh-btw/lib` 无 materialize/runningBanner | 仅参照/废弃残留，活动运行时不解析；不处理亦无影响 |

**最终裁决：通过（PASS）** — 五项审计范围全部满足，无需要修订执行阶段处理的阻断项。
