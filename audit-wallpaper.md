# 壁纸功能审计报告（v2 完整版，取代 v1 草稿）

> 阶段：审计（三阶段闭环第 1 阶段）。完成度约 85–90%：
> 上游插件 0.4.0 已 100% 读完；DSH master 关键机制已定位；**本地 0.1.1-rc.2 差异已逐项实测校准，fork 所需全部关键 API 已确认存在**。剩余为执行期需复核的少量签名细节（§7），不影响审计方向与交付单元划分。
> 契约基线：`btw-wallpaper-plan.md`（壁纸节）。
> v1 草稿勘误：v1 称"URL 已支持"有误——上游**无 URL 输入 UI**，source 仅两种形态（data: URL、/dsh-wallpaper/media/ 路由），URL 来源是真实缺口（v1 正文第 15 行自己也这么写，与其结论行矛盾）。

---

## 0. 审计结论

**需修改（Fork 路线确认，但缺口比契约所列四处更多）。**

Fork `@frog755/dsh-wallpaper`（MIT，结构清晰、机制正确）是正确路线，但除了契约列出的四个缺口（per-page / URL / cover+遮罩 / settings.yaml）外，审计发现**三处部署级必须修正项**：

1. **cordis.patch.yml 把 webserver 钉死在 9191 端口**——本部署 GUI 在 3080，照搬会改变端口；且持久化改走 settings.yaml 后 localStorage 不再是持久层，钉端口彻底失去意义。必须删除。
2. **上游按 rc.6 生态接线**（peerDeps 含 `@deepseek-ai/dsh-client-ui-slots`，本地 rc.2 无此包）——fork 的 `dsh.client.inject` 与 peerDeps 必须对齐本地实际包集。
3. **图片被浏览器端有损压缩为 data URL 存 localStorage**（≤1600px JPEG q0.75）——不符合契约"上传 png/jpg/webp/gif 单张 ≤10MB"的原图保存预期，也不符合"存 `~/.dsh/wallpapers/`"的预期。

另有一处范围决策：上游主打 MP4 视频（300MB + ffmpeg 转码），契约范围是**静态图片**。审计建议执行时**移除 MP4 上传/转码逻辑**（严格对齐契约、大幅简化）；若父代理希望保留视频能力，需在执行前明示。

---

## 1. 已读关键文件

### 上游插件（/tmp/frog-wallpaper，git master 1044d3b = npm 0.4.0，MIT）
- `lib/index.js`（宿主半，256 行全文）
- `lib/client.js`（客户端半，468 行全文）
- `package.json`、`cordis.patch.yml`、`LICENSE`、README

### DSH master（/tmp/dsh-repo，c389f96）
- `packages/client/web/src/base.css`（L30：`body { background: var(--dsw-alias-bg-base, #fff) }`）
- `packages/client/ui-theme/src/client/index.ts`（ThemeRuntime / `overrideTokens` L308-317 / `theme/change` 事件 / 设置行注册范例 L454-477）
- `packages/client/ui-theme/src/client/styles.ts`（`installThemeStyles` L24-36）
- `packages/client/ui-theme/src/index.ts`（宿主半 `settings.register` 范例 L36-39）
- `packages/client/ui-theme/src/theme-settings.ts`（namespace + schemastery schema 范例）
- `packages/client/ui-settings/src/client/settings-scope.ts`（`SettingsScopeBinder`，`bind<T>(spec)` L282-298；`set/unset/mutate` 经 `remote.settings.mutate`）
- `packages/client/ui-settings/src/client/contract/slots.ts`（`settings.general.item` 契约 L89）
- `packages/client/ui-settings-general/src/client/SettingsRoot.tsx` + `shell-contract.ts`（设置模态：开关是组件局部 useState，`role="dialog" aria-modal="true"`，CSS module 哈希类 `<hash>_overlay`/`<hash>_panel`）
- `packages/client/ui-layout/src/client/AppFrame.tsx` / `columns.ts`（三栏布局，无路由器；rightbar 由 SessionProvider 门控）
- `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx`（首页 = EmptyHero）
- `packages/client/ui-conversation/src/client/apply.ts`（L160-184：`sessions.list.getSnapshot().current` 消费范例）
- `packages/api/session-controller/src/client/sessions/service.ts`（`reflect.provide('sessions')` L263；list store 含 `current`）
- `packages/host/webserver/src/index.ts`（`ctx.webServer.register({kind:'prefix', path, handler})` L165）
- `packages/settings/settings-file/src/index.ts`（settings.yaml 落盘，默认 `<dsh home>/settings.yaml`）

### 本地部署（0.1.1-rc.2，实测校准）
- `~/.dsh/profiles/web/package.json`（`@deepseek-ai/dsh ^0.1.1-rc.2`；**实际安装版本 0.1.1-rc.2 已实测确认**）+ `cordis.patch.yml`（现有 insert 模式：vision-adam / taste）
- `~/.dsh/settings.yaml`（已有 ui-onboarding / agent-presets 等 namespace 实证落盘）
- `~/.dsh/install-plugins.sh`（第三方插件安装模式：复制进 `~/.dsh/profiles/node_modules/` flat 回退目录）
- 本地包清单实测：**无** `dsh-client-ui-slots`；有 `dsh-client-runtime` / `dsh-client-ui-settings` / `dsh-client-ui-settings-general` / `dsh-client-ui-theme` / `dsh-client-ui-layout` / `dsh-host-webserver` / `dsh-settings` / `dsh-settings-file`
- `dsh-client-ui-theme/lib/types/client/styles.d.ts` L6（`installThemeStyles`，父代理提示复核属实）
- `dsh-client-ui-theme/lib/types/client/index.d.ts` L167（`overrideTokens(source, tokens)`，父代理提示复核属实）
- `dsh-client-runtime/lib/types/client/contract/sessions.d.ts`（`ctx.sessions` 契约在本地 runtime 包内：`ISessions.list: ObservableSnapshot<SessionListState>` 含 current 选择）
- `dsh-client-ui-settings/lib/client.js`（`super(ctx, "settingsScope")` —— settingsScope 服务本地存在）
- `dsh-client-ui-theme/lib/client.js`（本地设置行注册模板：`slots.inject("settings.general.item", () => ctx.slots.register({...}))` + `settingsScope.bind({ namespace })` —— **与上游插件写法、与 master 写法一致**）
- 运行中 GUI（127.0.0.1:3080）实测：`__ModuleLoader__` 队列模式与上游 bundle 格式一致；**响应无 Content-Security-Policy 头 → URL 远程壁纸可行**；设置模态哈希类形如 `VOzbGW_overlay`/`VOzbGW_panel`（构建哈希，不可作稳定选择器）

---

## 2. 上游插件现状（@frog755/dsh-wallpaper 0.4.0）

- **结构**：只发布编译后 `lib/`（纯手写 JS，非 TS 编译产物；`lib/client.js` 是 lazy-CJS 格式 `window.__ModuleLoader__.load({id, factory})`，与本地加载器一致——**fork 可直接编辑 lib/*.js，无需构建链**）。
- **宿主半**（lib/index.js）：`inject: ['webServer']`；`MEDIA_ROOT = ~/.dsh/wallpapers`（L13）；路由 `/dsh-wallpaper/media`（MP4 upload/ffmpeg 转码/cleanup/DELETE/GET，L163-234）与 `/dsh-wallpaper/settings`（GET/POST JSON，L235-255）。
- **客户端半**（lib/client.js）：壁纸 layer + token 染色 + `settings.general.item` 设置行（order 30，WallpaperRow，opacity/blur 滑杆）。
- **持久化**：localStorage（`dsh-wallpaper:image` 等 key）+ 宿主 `~/.dsh/wallpapers/settings.json`（自定义路由同步，为跨浏览器一致）。
- **License**：MIT（KinGao294 + Frog755 双版权）——**允许 fork/修改/再分发**，保留 LICENSE 与版权声明即可。

---

## 3. 关键机制确认（文件 + 行号）

### 3.1 原版背景注入方式：独立 layer + token 染色（不是纯 style 注入）
- `createWallpaperElement`（lib/client.js L165-178）：`position:fixed; inset:0; z-index:-1; pointer-events:none` 的 div（图片：**`background-size:cover; background-position:center; background-repeat:no-repeat`**）或 video（`object-fit:cover`），`document.body.prepend(element)`。
- `shadeTokens`（L136-152）：`ctx.theme.overrideTokens('dsh-wallpaper:surface', { '--dsw-alias-bg-base': { light: rgba(base, opacity), dark: rgba(base, opacity) } })` —— 把基础背景 token 染半透明，让壁纸从各 UI 表面透出（body 的 `background: var(--dsw-alias-bg-base)` 在 base.css L30）。
- `ensureWallpaperCss`（L91-120）：注入表面 CSS（`[data-phase]:not(textarea){background:transparent!important}`、`body{--dsw-specific-sidebar-fill:transparent!important}` 等）使三栏共用同一底色。

**判断**：壁纸主体走**独立背景 layer**（沿用上游，正确）；暗色遮罩=同模式**新增一个 overlay div**；`installThemeStyles` 的 ctx.effect style 标签模式仅用于我们自己的少量静态表面 CSS；token 覆盖（overrideTokens）仅用于表面染色（可选保留）。三者各司其职，不互相替代。

### 3.2 媒体文件存取
- MP4：`POST /dsh-wallpaper/media/upload` → ffmpeg 压缩 → `~/.dsh/wallpapers/<uuid>.mp4` → `GET /dsh-wallpaper/media/<uuid>.mp4`（immutable cache）。
- **图片：不落盘**——浏览器端压缩为 data URL（L229-244，≤1600px JPEG q0.75，>2MB 再降）存 localStorage。
- 设置 JSON：`~/.dsh/wallpapers/settings.json`（L16）。

### 3.3 设置卡片注册（属实）
- `ctx.slots.inject('settings.general.item', () => ctx.slots.register({ name, id:'wallpaper', order:30, store, locale, inject }, WallpaperRow))`（lib/client.js L445-460）。
- 与本地 `dsh-client-ui-theme/lib/client.js`、master `ui-theme/src/client/index.ts` L454-461 的官方形态**完全一致**。✅

### 3.4 配置持久化（原版）→ 不是 settings.yaml
- localStorage（每浏览器）+ `~/.dsh/wallpapers/settings.json`（自定义 HTTP 路由）。
- 官方通道（本地已确认可用）：宿主半 `ctx.inject(['settings'], sctx => sctx.settings.register(ns, schema))`（master ui-theme/src/index.ts L36-39 范例；本地有 dsh-settings/dsh-settings-file 包，`~/.dsh/settings.yaml` 已有多个 plugin namespace 实证）；客户端半 `ctx.settingsScope.bind({namespace})` → `set/unset/mutate`（本地 `dsh-client-ui-settings` 提供 `settingsScope` 服务，`super(ctx, "settingsScope")` 已确认；本地 ui-theme 即此用法）。

### 3.5 DSH 前端"当前页面"感知：无路由器，三态识别
Web GUI 是三栏 SPA（ui-layout AppFrame），**没有 react-router / pathname**。"页面"是三态：
- **首页** = 无当前会话：`ctx.sessions.list.getSnapshot().current === undefined`（EmptyHero 渲染）。本地契约：`dsh-client-runtime/lib/types/client/contract/sessions.d.ts`（`ISessions.list` 含 current；master 提供方 `packages/api/session-controller/.../service.ts` L263）。
- **会话页** = `current !== undefined`。
- **设置页** = 设置模态打开：开关是 SettingsRoot 组件**局部 useState**（无全局事件、无稳定 DOM id；仅 `role="dialog" aria-modal="true"` 语义属性 + 构建哈希类）。**最稳信号 = 我们自己注册的 WallpaperRow 挂载/卸载**（设置行只在设置模态 General 节打开时挂载）——零依赖、插件自身即可感知；caveat：用户切到设置的其他节（Models/Plugins）时行会卸载，若需覆盖该边缘场景，辅以 `MutationObserver('[role="dialog"][aria-modal="true"]')`。

### 3.6 本地 rc.2 与 master 的差异（接线相关）
- slots 机制/`ctx.sessions` 契约并入 `dsh-client-runtime`（本地无独立 ui-slots 包；其 .d.ts 中对 `@deepseek-ai/dsh-client-ui-slots` 的引用是纯类型导入，运行时无碍）。
- `settings.general.item` 契约类型在本地 `dsh-client-ui-settings`。
- 本地有 `installThemeStyles` / `ctx.theme.overrideTokens` / theme-presenter（投影到 document.body，dsh-client-ui-layout）——父代理提示全部复核属实。
- 上游 peerDeps 的 `dsh-client-ui-slots@^0.1.0-rc.6` 本地不存在 → fork 元数据必须改。

### 3.7 profile 接线（本部署正确方式）
- 安装位置：`~/.dsh/profiles/node_modules/@cns2026495165/dsh-wallpaper`（flat 回退目录，loader 从 profile 向上解析、peer 依赖可解析到官方包；参照 `install-plugins.sh` 既有模式）。
- 激活：`~/.dsh/profiles/web/cordis.patch.yml` 追加
  ```yaml
  - insert:
      - id: wallpaper
        name: '@cns2026495165/dsh-wallpaper'
  ```
  （与现有 vision-adam / taste 条目同模式；不动 `dsh.profile.bundles`——那是官方 bundle 列表。）
- 插件自带 `cordis.patch.yml`（`dsh.bundle.patch`）里的 insert 在作为 bundle 安装时生效，但**其中的 webserver 9191 端口钉死必须删除**。

---

## 4. 调研差异（研究阶段结论 vs 真实源码）

| # | 研究结论 | 真实源码 | 处置 |
|---|---|---|---|
| 1 | "原版是 opacity/blur，需补 cover 铺满" | **cover 已有**：图片 `background-size:cover` / video `object-fit:cover`（client.js L167/L174）。opacity 不是壁纸透明度，而是把 `--dsw-alias-bg-base` 染半透明（L136-152） | 缺口实为"**可选暗色遮罩**"；cover 保留即可 |
| 2 | "媒体存 ~/.dsh/wallpapers" | **半真**：仅 MP4 与 settings.json 在该目录；图片是 localStorage data URL（有损压缩 ≤1600px） | fork 改为图片也上传落盘 |
| 3 | （未提及）配置持久化位置 | localStorage + `~/.dsh/wallpapers/settings.json`，**不是 settings.yaml** | 对齐 settings.yaml（§5.3-4） |
| 4 | "有 Settings 卡片" | **属实**（settings.general.item，order 30） | 保留 |
| 5 | "确认是否支持 URL" | **不支持**（无 URL 输入 UI；source 仅 data: 与 /dsh-wallpaper/media/ 两种形态） | 补 URL 输入 |
| 6 | （未提及）范围 | 上游主打 MP4（300MB+ffmpeg）；契约是静态图片 | 建议移除 MP4（执行前需父代理确认） |
| 7 | （未提及）端口 | cordis.patch.yml 钉死 webserver 9191；本部署 GUI 在 3080 | **必须删除** |
| 8 | （未提及）生态版本 | 上游 peerDeps 按 rc.6（含 dsh-client-ui-slots）；本地 rc.2 无此包 | fork 元数据对齐本地 |
| 9 | license | MIT（双版权 KinGao294 + Frog755），允许 fork | 保留 LICENSE + 声明 |

---

## 5. 修订后的方案

### 5.1 Fork 包结构

```
~/.dsh/profiles/node_modules/@cns2026495165/dsh-wallpaper/
  package.json        # 改名 @cns2026495165/dsh-wallpaper；dsh.client.inject 对齐本地；peerDeps 修正
  cordis.patch.yml    # 仅插件 insert；删除 webserver 9191 钉死
  lib/index.js        # 宿主半：图片媒体路由（upload/import/GET/DELETE/cleanup）+ settings namespace 注册
  lib/client.js       # 客户端半：壁纸 layer + per-page + 遮罩 + URL + 设置行 + settingsScope 持久化
  lib/types/          # 类型声明同步更新
  LICENSE             # MIT 保留双版权 + fork 说明
  README.md
```

- 直接 fork 上游（`lib/` 是手写 JS，可直接编辑，无需 TS 构建链）。
- `dsh.client.inject`：`["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-theme", "@deepseek-ai/dsh-client-ui-settings"]`（前三项沿用上游且本地全部存在；**新增 ui-settings**——settingsScope 服务所在；sessions 契约随 runtime）。
- 客户端 `inject`：`['slots', 'locale', 'theme', 'settingsScope', 'sessions']`。

### 5.2 settings schema（wallpaper namespace，schemastery）

```
wallpaper:
  global:   { source: string|null, darkMask: 0..1 (default 0), opacity?: 0..1, blur?: 0..60 }
  pages:
    session?:  { source, darkMask?, ... }
    settings?: { source, darkMask?, ... }
    home?:     { source, darkMask?, ... }
```
- `source` 取值：媒体路由 URL（`/dsh-wallpaper/media/<uuid>.<ext>`）/ 远程 http(s) URL / null。
- 未设置 page 项 → 回落 `global`；`global.source = null` 且无 page 覆盖 → 无壁纸（保持现状外观，契约默认）。

### 5.3 每处缺口的改法

1. **per-page 覆盖**：注入 `sessions` 订阅 `list` → `current ? 'session' : 'home'`；settings 页 = WallpaperRow mount/unmount 信号（+可选 aria-modal MutationObserver 兜底）；page 变化 → `applyWallpaper(pages[page] ?? global)`。
2. **URL 来源**：设置行加 URL 输入（http/https 直接作 source；绝对路径经宿主 import 端点复制进 MEDIA_ROOT 后转媒体 URL）。无 CSP 头已实测，远程 URL 可行。
3. **cover + 暗色遮罩**：保留上游 cover；新增 mask layer（`rgba(0,0,0,darkMask)` fixed div，壁纸层之上、UI 之下）；opacity/blur 滑杆保留为可选附加项。
4. **settings.yaml 持久化**：宿主半 `ctx.inject(['settings'], register('wallpaper', schema))`；客户端半 `settingsScope.bind({namespace:'wallpaper'})` 写入；删除 localStorage 层、settings.json 路由、9191 钉死。多浏览器一致性由 host 单一事实源免费获得。

---

## 6. 细粒度交付单元清单（14 条）

> 每条含目标文件/函数、改动内容、验收标准。执行档按单元逐条落地，歧义处上报审计澄清。

**U1 fork 落位与包元数据**
- 文件：`package.json`、`cordis.patch.yml`、`LICENSE`
- 改动：包名 `@cns2026495165/dsh-wallpaper`；`dsh.client.inject` 按 §5.1；peerDeps 对齐本地 rc.2 包集（去掉 `dsh-client-ui-slots` 或降为可选）；**删除 cordis.patch.yml 的 webserver 9191 端口段**；LICENSE 保留 MIT 双版权 + fork 声明。
- 验收：`dsh web` 启动后插件加载、GUI 仍在 3080；`curl -sI 127.0.0.1:3080` 正常。

**U2 宿主半：图片上传端点**
- 文件：`lib/index.js`（upload handler，替换 MP4 逻辑）
- 改动：`POST /dsh-wallpaper/media/upload` 接受 `image/png|jpeg|webp|gif`，≤10MB，流式写 `MEDIA_ROOT/<uuid>.<ext>`，返回 `{url}`；移除 ffmpeg/MP4 全部分支（默认决策，见 §0）。
- 验收：curl 上传 png → 201 + URL；GET URL → 200 `image/png`；>10MB → 413；非图片 MIME → 415。

**U3 宿主半：绝对路径导入端点**
- 文件：`lib/index.js`（新增 handler）
- 改动：`POST /dsh-wallpaper/media/import`，body `{path}`；校验绝对路径存在、扩展名白名单、≤10MB，**复制**进 MEDIA_ROOT（不 serve 任意路径，防任意文件读取），返回媒体 URL。
- 验收：导入后文件出现在 `~/.dsh/wallpapers`；URL 可访问；目录外路径/非图片/超限 → 4xx。

**U4 宿主半：媒体 GET/DELETE/cleanup 适配图片**
- 文件：`lib/index.js`（`mediaNameFromPath` L146-149、cleanup L196-217）
- 改动：文件名正则从 `^[a-f0-9-]+\.mp4$` 扩为 `(png|jpe?g|webp|gif|mp4)`；GET content-type 按扩展名。
- 验收：对图片 URL 的 GET/DELETE/cleanup 全部生效。

**U5 宿主半：settings namespace 注册**
- 文件：`lib/index.js`（apply 内新增；删除 `/dsh-wallpaper/settings` 路由与 `settings.json` 读写 L27-52/L235-255）
- 改动：`ctx.inject(['settings'], sctx => sctx.settings.register('wallpaper', WallpaperSettingsSchema))`（schemastery，结构 §5.2）。**执行时对本地 `dsh-settings/lib/types/index.d.ts` 复核 register 签名**。
- 验收：写入后 `~/.dsh/settings.yaml` 出现 `wallpaper:` 节；非法值被 schema 拒绝。

**U6 客户端半：配置结构与 store 改造**
- 文件：`lib/client.js`（`createStore` L301-319、常量区）
- 改动：state 改为 §5.2 的 per-page 结构；action 扩展 `setGlobal/setPageOverride/clearPage`；解析函数 `resolveOverride(page) = pages[page] ?? global`。
- 验收：store 状态与配置一致；无 page 覆盖时回落 global；全空 → 无壁纸。

**U7 客户端半：页面检测 + per-page 切换**
- 文件：`lib/client.js`（apply L423-461）
- 改动：`inject` 加 `'sessions'`；`ctx.effect(() => sessions.list.subscribe(...))` 计算 `current ? 'session' : 'home'`；page 变化 → `applyWallpaper(ctx, page)`；`applyWallpaper` 按 resolveOverride 结果设置/释放 layer 与遮罩。
- 验收：无会话显示 home 壁纸，打开会话切 session 壁纸，二者可不同；快速切换无残留 layer。

**U8 客户端半：暗色遮罩 overlay**
- 文件：`lib/client.js`（`createWallpaperElement`/`applyWallpaper` L165-206）
- 改动：壁纸 layer 之后追加 `maskEl`（fixed, inset:0, z-index:-1 但 DOM 序在壁纸后，`background: rgba(0,0,0,darkMask)`；darkMask=0 时不渲染/透明）；`teardownWallpaper` 同步释放。
- 验收：darkMask 0.5 时壁纸可见变暗；设为 0 恢复；无壁纸时无 mask；卸载插件后 DOM 干净。

**U9 客户端半：URL 来源 UI**
- 文件：`lib/client.js`（`WallpaperRow` L349-405、locale 词典）
- 改动：新增 URL 输入框 + 应用按钮；`^https?://` 直接作 source；绝对路径调 U3 import；错误态（无效 URL/导入失败）显示。
- 验收：输入合法 URL → 壁纸立即切换且 settings.yaml 落盘；远程图无 CSP 拦截（已预验证无 CSP 头）；非法输入报错不落盘。

**U10 客户端半：上传 UI 对齐契约**
- 文件：`lib/client.js`（`onFile` L357-386；删除 `readImageAsDataUrl`/`compressImage` L215-244）
- 改动：accept 限 `.png,.jpg,.jpeg,.webp,.gif`；前端 ≤10MB 校验；上传走 U2 端点（不再压缩、不再 data URL）；删除 MP4 分支与视频文案。
- 验收：上传 5MB png 后 MEDIA_ROOT 有**原文件**；source 为媒体路由 URL；超限/错型报错。

**U11 客户端半：持久化改 settings.yaml**
- 文件：`lib/client.js`（删除 `readStorage/writeStorage`/`migrateLegacyWallpaper`/`syncFromHost`/`pushSharedSettings` 及全部 localStorage key L54-99/L272-299/L407-420）
- 改动：`inject` 加 `'settingsScope'`；`const scope = ctx.settingsScope.bind({ namespace: 'wallpaper' })`；所有写操作改 `scope.set('global', {...})` / `scope.mutate([...])`；订阅 `scope.subscribe(() => reapply())`（跨浏览器实时同步）；持久化不再依赖 localStorage。
- 验收：任何设置变更后 `cat ~/.dsh/settings.yaml` 即见 `wallpaper:` 节；重启 DSH/换浏览器壁纸一致；scope 不可用时 UI 只读降级不崩。

**U12 客户端半：设置页检测信号**
- 文件：`lib/client.js`（`WallpaperRow` 组件）
- 改动：组件 `useEffect` mount → 通知 apply 层 `settingsOpen=true`，cleanup → false；并入 U7 的 page 计算（`settingsOpen ? 'settings' : (current ? 'session' : 'home')`）。
- 验收：打开 Settings→General 出现 settings 覆盖壁纸；关闭恢复；切换到设置其他节时行为符合设计说明（回落 session/home，caveat 已记录）。

**U13 profile 接线与安装**
- 文件：`~/.dsh/profiles/web/cordis.patch.yml`、`~/.dsh/install-plugins.sh`（或新脚本）
- 改动：fork 目录复制到 `~/.dsh/profiles/node_modules/@cns2026495165/dsh-wallpaper`；patch 追加 §3.7 的 insert 条目。
- 验收：重启 `npx @deepseek-ai/dsh web` 后 3080 正常；Settings→General 出现壁纸卡片。

**U14 端到端验收清单（手工）**
- 覆盖：全局默认 + 三页独立覆盖；上传/绝对路径/URL 三来源；cover 铺满；遮罩滑杆；settings.yaml 落盘与重启持久；无壁纸时外观与现状完全一致；明暗主题切换下壁纸与遮罩正常（`theme/change` 联动沿用上游 L443）。
- 验收：清单逐项通过并在报告记录。

---

## 7. 执行期待复核项（不改变方向，只影响个别写法）

1. 本地 `dsh-settings` 宿主侧 `register(ns, schema)` 精确签名与 schemastery 导入路径（对 `dsh-settings/lib/types/index.d.ts`）。
2. 本地 `settingsScope.bind` 返回的 scope 方法面（`set/unset/mutate/subscribe/getSnapshot` 是否与 master 一致——本地 ui-theme 用法一致，大概率相同）。
3. `sessions.list` 快照字段的精确形状（`current` 字段名在本地 rc.2 契约中的拼写）。
4. slots.register 的 `store/locale/inject` 选项在本地 rc.2 的精确字段名（本地 ui-theme 用法与上游一致，大概率相同）。
5. MP4 移除决策的父代理确认（§0）。

## 8. 风险与注意

- **不要照搬上游 cordis.patch.yml**（9191 钉死）。
- **图片必须落盘 MEDIA_ROOT**（契约 + 跨浏览器一致），杜绝 data URL。
- 绝对路径导入只做"复制进 MEDIA_ROOT"，**绝不直接 serve 任意路径**（任意文件读取风险）。
- 设置模态哈希类名（`<hash>_overlay`）随构建变化，**不得**作为选择器依赖；语义属性（`role="dialog"`）与自身行挂载信号才稳。
- fork 后包名换 scope，避免与上游 npm 包混淆；保留上游 MIT 版权声明。
