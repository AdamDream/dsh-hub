# 壁纸功能执行报告（修订并执行阶段）

> 阶段：修订并执行（三阶段闭环第 2 阶段）。输入：`audit-wallpaper.md`（v2）+ 父代理三项裁决 + 父代理第二轮补充修正（peerDeps semver prerelease / broken symlinks，2026-09-08）。
> 产物：`/home/CNS2026495165/dsh/dsh-wallpaper-local/`（可直接安装的包）+ 本报告。
> 上游 `/tmp/frog-wallpaper` 未做任何改动（只读）。

## 0. 执行摘要

| 项 | 结果 |
|---|---|
| 改动文件 | 5 个核心文件全量重写/修改（`lib/index.js`、`lib/client.js`、`package.json`、`cordis.patch.yml`、`LICENSE`）+ 4 个配套文件（`lib/types/index.d.ts`、`lib/types/client/index.d.ts`、`README.md`、`README.zh-CN.md`）+ 2 个新增（`install.sh`；`assets/` 为上游截图原样复制） |
| 14 条交付单元 | 全部落地（U13 以「包内安装脚本 + 激活条目」形式交付，见 §3.13；U14 清单见 §5） |
| §7 签名复核 | 5/5 完成，其中 2 项复核结果**修正了审计建议的写法**（客户端 scope 无 `mutate`；schemastery 对象字段自动 default `{}`），见 §2 |
| 第二轮补充修正（btw 交叉验证） | ① peerDeps 全线 semver prerelease 修正（5 个 dsh-* 条目 → `>=0.1.1-rc.2 <0.2.0`；实证上游 `^0.1.0-rc.6` 形态对本地 0.1.1-rc.2 **全线冲突**，不止 ui-slots 一项）；② broken-symlink 防线（实测 flat dir 有 **5 个**指向已清除 npx 缓存的悬空链接；`install.sh` 真实目录拷贝 + 三道 fail-fast 守卫）。见 §2.6/§2.7 与 §4.7 |
| 静态验收自查 | 94 项断言（宿主半 39 / 客户端半 41 / 设置行渲染 14）+ 第二轮 19 项 install.sh 自测 + 8 项 peerDep 逐条 semver 校验，全部通过，见 §4 |
| 执行中发现并修复的实现缺陷 | 2 个（上传超限的孤儿文件竞态；设置行残留已删除的 state 引用），见 §4.4；另识别并绕开 2 个测试夹具假象（§4.7） |
| 待澄清 | 4 项（包名 scope 与审计不一致、U4 正则中 mp4 的取舍、U13 是否直接改 live profile、遮罩/透明度语义确认），见 §6 |

父代理三项裁决均已执行：**MP4 全链路移除**（上传/转码/播放/文案/类型）、**9191 webserver 钉死删除**（cordis.patch.yml 仅剩插件 insert）、**图片落盘 MEDIA_ROOT**（上传/导入均写 `~/.dsh/wallpapers/<uuid>.<ext>` 原图，无 data URL、无 localStorage）。
第二轮两项补充修正均已执行：**peerDeps 显式区间**（§2.6）、**真实目录拷贝安装 + broken-symlink 守卫**（§2.7）。

---

## 1. 各文件改动明细

### 1.1 `package.json`
- `name`: `@frog755/dsh-wallpaper` → **`@local/dsh-wallpaper`**（父代理指令；与审计 §5.1/U1 的 `@cns2026495165/dsh-wallpaper` 不同，见待澄清 C1）；`version` 0.4.0 → 0.5.0；description 更新为静态图片版描述；保留上游 repository/author（fork 署名，LICENSE 同步声明）。
- `dsh.client.inject`：`[runtime, locale, ui-theme]` → **`[runtime, locale, ui-theme, ui-settings]`**（新增 settingsScope 所在包；四包本地 rc.2 全部实测存在）。
- `peerDependencies`：移除 `@deepseek-ai/dsh-client-ui-slots`（slots 契约并入 runtime，且该包在本部署 flat 目录是 broken symlink，见 §2.7）；**全部 5 个 `@deepseek-ai/dsh-*` 条目（dsh-settings + 4 个 dsh-client-*）用显式区间 `>=0.1.1-rc.2 <0.2.0`**——不能用上游的 `^0.1.0-rc.6` 形态：npm semver 的 prerelease 元组规则下 `0.1.1-rc.2`（元组 0.1.1）不满足 `^0.1.0-rc.6`（元组 0.1.0），上游 5 条**全线冲突**，不止 ui-slots 一项（§2.6 实测）；新增宿主侧依赖 `@deepseek-ai/dsh-settings`、`@deepseek-ai/schemastery`；`react ^18.2.0`、`@deepseek-ai/cordis ^4.0.1`、`@deepseek-ai/schemastery ^3.18.1` 保留（纯正式版本号区间，不受 prerelease 规则影响，本地 18.3.1 / 4.0.1 / 3.18.1 实测满足）。
- `files` 加入 `install.sh`；`exports`/`main`/`type: module`/`dsh.bundle.patch` 结构不变（与上游、与本地加载器约定一致）。

### 1.2 `cordis.patch.yml`
- **删除整个 `- id: webserver` 段**（上游把 `@deepseek-ai/dsh-host-webserver` 钉死 9191）。现仅剩 `- insert: [{id: wallpaper, name: '@local/dsh-wallpaper'}]`，头部注释说明删除原因（本部署 GUI 在 3080；持久化已走 settings.yaml，localStorage origin 不再相关）。已用 YAML 解析器验证：顶层仅 1 个 entry、仅 `insert` 键、无任何 `config`/`inject` 键。

### 1.3 `lib/index.js`（宿主半，256 → 268 行，实质全量重写）
| 函数/区域 | 改动 |
|---|---|
| 头注释 | 改为 fork 说明（静态图片、settings.yaml 持久化） |
| imports | 删 `spawn`（ffmpeg）；删 `renameSync`/`writeFileSync`/`readFileSync`（settings.json）；新增 `copyFileSync`（导入）、`isAbsolute`、`z from "@deepseek-ai/schemastery"`、`{ settingsNamespace } from "@deepseek-ai/dsh-settings"` |
| 常量 | `MAX_UPLOAD_BYTES` 300MB → `MAX_IMAGE_BYTES` 10MB；新增 `IMAGE_MIME_TO_EXT`（png/jpeg→jpg/webp/gif）、`IMAGE_EXT_PATTERN`、`CONTENT_TYPE_BY_EXT`；删除 `SETTINGS_ROUTE`/`SETTINGS_FILE` |
| 新增 schema | `PageSchema`（source: string default null、darkMask: percent default 0、opacity: percent default 0.8、blur: number 0..60 default 0）、`OptionalPageSchema = z.union([PageSchema, z.const(null)])`、`WallpaperSettingsSchema`（global: PageSchema.default(DEFAULT_GLOBAL)；pages: object{session/settings/home: OptionalPageSchema}.default({})） |
| 删除 | `readSettings`/`writeSettings`（settings.json 读写）、`run`/`commandAvailable`/`canCompressVideo`/`probeDuration`（ffmpeg 全套）、`/dsh-wallpaper/settings` 路由 |
| `readJsonBody` | 保留（import 端点复用） |
| `writeUpload` | 上限改 10MB；超限时错误带 `statusCode=413`；**竞态修复**：失败清理改为「等待流 open 完成后 destroy，在 `close` 事件里 rmSync」——直接 rmSync 会跑在异步 open 创建文件之前，留下空孤儿文件（§4.4） |
| `json()` | 增加 `closeRequest`/`req` 参数：请求体被放弃时（超限）先 `res.end(payload, cb)` 冲刷响应再 `req.destroy()`，保证 413 一定到达客户端 |
| `mediaNameFromPath` | 正则 `^[a-f0-9-]+\.mp4$` → `^[a-f0-9-]+\.(png|jpe?g|webp|gif)$`（mp4 不保留，见待澄清 C2） |
| `deleteMedia` | 逻辑不变（resolve + startsWith 前缀防逃逸） |
| 新增 `normalizedExt` | jpeg → jpg 归一 |
| `apply(ctx)` | ① 新增 `ctx.inject(["settings"], sctx => sctx.settings.register(WALLPAPER_NAMESPACE, WallpaperSettingsSchema))`（U5，照抄本地 ui-theme 宿主半形态）；② 媒体路由：`POST /upload`（MIME 白名单→415、content-length 预检→413、流式写+上限→413、成功 201 `{url,size}`）、**新增 `POST /import`**（JSON `{path}`：非绝对→400、扩展名白名单→415、不存在→404、非普通文件→400、>10MB→413、`copyFileSync` 复制进 MEDIA_ROOT→201 `{url,size}`；绝不 serve 原路径）、`POST /cleanup`（keep 名单外图片清理，正则改图片）、`DELETE`（不变）、`GET`（content-type 按扩展名映射，immutable 缓存头保留） |

### 1.4 `lib/client.js`（客户端半，468 → 592 行，实质全量重写）
| 函数/区域 | 改动 |
|---|---|
| module id | `@frog755/dsh-wallpaper` → `@local/dsh-wallpaper` |
| 常量 | 删全部 localStorage key（`WALLPAPER_KEY` 等）与 legacy 迁移 key、`MAX_VIDEO_UPLOAD_BYTES`；新增 `WALLPAPER_NAMESPACE`、`MEDIA_URL_PATTERN`（图片媒体 URL 正则）、`MAX_IMAGE_UPLOAD_BYTES`=10MB、`IMAGE_MIME_TYPES`、`ACCEPT_ATTRIBUTE`（`.png,.jpg,.jpeg,.webp,.gif`）、`PAGES`、`DEFAULT_GLOBAL` |
| locale 词典 | 全部重写（标题/目标选择/三滑杆/URL 输入/覆盖操作/只读降级/错误态，zh+en 各 24 键，键集一致已程序化校验） |
| 删除 | `readStorage`/`writeStorage`/`migrateLegacyWallpaper`/`readWallpaper`/`readOpacity`/`readBlur`、`compressImage`/`readFileAsDataUrl`/`readImageAsDataUrl`、`uploadVideo`、`fetchSharedSettings`/`pushSharedSettings`/`syncFromHost`、`SETTINGS_URL` 及 `/dsh-wallpaper/settings` 全部调用 |
| 新增 normalize 族 | `normalizePage`/`normalizePages`（防御性归一：source 非 string → null，数值 clamp）、`resolveOverride(value, page) = pages[page] ?? global`（U6，按审计 §5.2 整对象替换语义）、`referencedMediaNames`/`isReferenced`（媒体文件引用追踪） |
| `ensureWallpaperCss`/`toRgba`/`resolveBase` | 原样保留（审计 §3.1 判断：表面 CSS 继续常驻） |
| `shadeTokens(ctx, opacity)` | 参数化 opacity（原来内部 readOpacity） |
| layer 管理 | 删 video 分支（`isVideoWallpaper`、video 元素属性、`releaseWallpaperElement` 的 pause/load）；`createWallpaperElement` 只建 div（cover 三连样式保留）；**新增 mask 层**：`ensureMaskElement`（fixed/inset:0/z-index:-1，DOM 序在壁纸之后 → 同 z-index 下遮罩盖在壁纸上、UI 之下；壁纸重建时自动重排）、`releaseMaskElement`；`applyWallpaper(ctx, config)` 改为接收当前生效配置：source null → 全释放；darkMask>0 → 建 mask `rgba(0,0,0,darkMask)`，=0 → 释放；blur/opacity 沿用上游机制 |
| `teardownWallpaper` | 同步释放 mask |
| 媒体 helpers | `mediaNameFromUrl`（图片正则）、`deleteMedia`、`uploadImage`（POST 原文件，content-type=file.type）、`importImage`（POST `{path}`）、`cleanupMedia`（keep 名单） |
| `createStore` | state 改 `{status, global, pages, revision}`；action `sync(draft, snapshot)` 直接镜像 settingsScope 快照（上游的 url/opacity/blur/自增 revision 删除） |
| 页面状态（新增） | `pageState = {current, settingsOpen}`、`currentPage()`：`settingsOpen ? "settings" : (current === undefined/null ? "home" : "session")`（U7+U12 合流，settings 优先）；`latestValue`（最近一次已解析配置，乐观镜像）；`applyCurrent(ctx)` |
| `createRowActions`（新增） | 所有写操作入口：`commitField(field, edit)` 统一流程（ready+writable 门禁 → 基于 latestValue 构造下一个整体对象 → 乐观应用 → `scope.set(field, value)` → 被替换且不再被引用的媒体文件 DELETE）；暴露 `notifySettingsOpen`（U12 信号）、`setSource(target, source)`、`setValue(target, key, value)`（滑杆）、`createOverride(page)`（从 global 复制初始化）、`clearOverride(page)`、`isWritable()` |
| `WallpaperRow` | 重写：新增目标选择器（全局/首页/会话/设置，已覆盖的页面带标记）+ 预览；页面目标无覆盖时显示提示 + 「创建覆盖」按钮（控件禁用），有覆盖时控件可用 + 「清除覆盖」；URL 输入框 + 应用按钮（`^https?://` 直接作 source；`/` 开头调宿主 import；其余报错不落盘）；上传按钮 accept 限图片、前端 10MB 校验、原图 POST（无压缩无 data URL）；三滑杆（暗色遮罩/透明度/模糊，页面目标未覆盖或只读时禁用）；`useEffect` mount→`notifySettingsOpen(true)`、cleanup→false（U12）；loading/unavailable/只读 降级提示 |
| `apply(ctx)` | `inject` 数组（见下）；绑定 `ctx.settingsScope.bind({namespace:"wallpaper"})`；`sync()` = 快照→latestValue→store 镜像→applyCurrent，且首次 ready 后执行一次 cleanup（keep=全部被引用媒体名）；`ctx.effect(() => scope.subscribe(sync))`（跨浏览器实时同步）；sessions.list 订阅（初始化 + 变更→重算页面→applyCurrent）；`theme/change` → applyCurrent（上游联动保留）；teardown effect；locale 注册；slots 注册（store/locale/order 30/inject 绑定形态与上游、与本地 ui-theme 完全一致） |
| `inject` | `["slots", "locale", "theme"]` → **`["slots", "locale", "theme", "settingsScope", "sessions"]`**（audit §5.1） |

### 1.5 `lib/types/`、`LICENSE`、`README*`、`install.sh`
- `lib/types/index.d.ts`：`apply(): void` → `apply(ctx: Context): void` + 注释（媒体路由 + settings namespace）；`lib/types/client/index.d.ts`：注释更新为 fork 能力面。
- `LICENSE`：原 MIT 双版权文本逐字保留，尾部追加 fork notice（fork 来源、改动清单）。
- `README.md` / `README.zh-CN.md`：全量重写（fork 差异、安装、schema、持久化说明）。
- `install.sh`（新增，U13；第二轮加固）：以**真实目录拷贝**（`rm -rf` + `cp -r`，拷贝后断言目标非 symlink——本部署 flat 目录存在 5 个指向已清除 npx 缓存的 broken symlink，见 §2.7）安装到 `~/.dsh/profiles/node_modules/@local/dsh-wallpaper`（沿用 `~/.dsh/install-plugins.sh` 的 flat 回退目录模式）；拷贝后、动 profile 前执行**三道 fail-fast 后验**：① `package.json`/`lib/client.js`/`lib/index.js` grep 禁止引用 5 个 broken-symlink 包（ui-slots / ui-primitives / web-react / web / schema-form）；② 宿主半依赖 `@deepseek-ai/schemastery`、`@deepseek-ai/dsh-settings` 用 `require.resolve(paths:[DEST/lib])` 从安装位置实测解析（等价于真实 Node 解析链）；③ client-inject 四包在 web profile 模块树内实测存在（`test -d` 对 broken symlink 为假，天然排除悬空链接）；最后幂等追加 `~/.dsh/profiles/web/cordis.patch.yml` insert 条目。支持 `WALLPAPER_INSTALL_DEST` / `WALLPAPER_PROFILE_PATCH` / `WALLPAPER_CLIENT_MODULES` 环境覆盖（自测用）；`bash -n` 通过。

---

## 2. §7 执行期签名复核结果（全部完成）

1. **宿主 `settings.register` 签名**（对 `dsh-settings/lib/types/index.d.ts` + 本地 ui-theme 实产物）：
   `SettingsProvider.register<T>(ns: SettingsNamespace, schema: z<T>, options?: SettingsRegisterOptions<T>): SettingsScope<T>`。本地 ui-theme 宿主半实拍用法：`import { settingsNamespace } from "@deepseek-ai/dsh-settings"; import z from "@deepseek-ai/schemastery"; ctx.inject(["settings"], (settingsCtx) => { settingsCtx.settings.register(THEME_NAMESPACE, ThemeSettingsSchema); })`。**照此落地**：`settingsNamespace("wallpaper")` + `z.object` schema + 相同 `ctx.inject` 形态。schemastery 导入路径为默认导出 `import z from "@deepseek-ai/schemastery"`（本地 3.18.1）。已实测 `register` 收到 ns === "wallpaper"。
2. **`settingsScope.bind` 方法面**（对 `dsh-client-ui-settings/lib/types/client/settings-scope.d.ts` + `dsh-client-runtime/.../settings-scope.d.ts` + lib/client.js 实现）：
   `bind<T>(spec: {namespace: string, decode?})` 返回 scope = **`getSnapshot() / subscribe(fn) / set(field, value) / unset(field)`——没有 `mutate`**（mutate 只存在于宿主 `ctx.settings.mutate(ns, ops)`）。审计 U11 建议的 `scope.mutate([...])` 不可用，已改为 `scope.set('global', obj)` / `scope.set('pages', obj)`（整字段写入，value 为 JSON 对象，`set` 内部转 `{op:'set', path:[field], value}` 走宿主 mutate）。快照含 `status: 'loading'|'ready'|'unavailable'` 与 `writable`——只读降级据此实现。
3. **`sessions.list` 快照形状**（对 `dsh-client-runtime/lib/types/client/sessions/service.d.ts` + `contract/sessions.d.ts` + `contract/store.d.ts`）：
   `ISessions.list: ObservableSnapshot<SessionListState>`，`SessionListState.current: SessionId | undefined` —— **`current` 拼写确认**；`ObservableSnapshot` = `{getSnapshot(), subscribe(fn)→disposer}`。首页判定 `current === undefined` 成立。
4. **`slots.register` 选项字段名**（对本地 `dsh-client-ui-theme/lib/client.js` L1337-1344 实拍 + `dsh-client-runtime/lib/types/client/slots.d.ts`）：
   本地 ui-theme 用法与上游完全一致：`ctx.slots.register({ name, id, order, store, locale, inject }, Component)`，`ctx.slots.inject(key, cb)`，`inject` 回调返回的对象作为 props 展开给行组件，行组件同时收到 `t` 与由 `store` 派生的 `useStore`（`AppearanceRow({t, setTheme, useStore})` 实证）。fork 沿用同一契约；`store` 传 `runtime.defineStore(decl)` 的工厂句柄（本地 rc.2 的 defineStore 返回 `{spec, create(scopeKey)}`，由 slots 服务按 scope 实例化——与上游 rc.6 直接传 store 的写法在本地语义下兼容，本地 slots.d.ts L183 "Resolve (create or reuse) the store instance for a registered handle" 佐证）。
5. **MP4 移除决策**：父代理已裁决**移除**（任务指令「父代理裁决」节）。已全链路移除：上传/ffmpeg/import 白名单/GET-DELETE 正则/播放分支/文案/peerDep 无关项。

6. **peerDeps semver prerelease 匹配规则**（第二轮补充，btw 侧交叉验证输入；用本地 `semver` 7.8.5 实测）：npm semver 规则——带 prerelease 标签的版本只有在区间存在**同 [major,minor,patch] 元组**的 comparator 时才可能匹配。实测 `semver.satisfies('0.1.1-rc.2', '^0.1.0-rc.6')` → **false**（`^0.1.0-rc.6` 的元组是 0.1.0，本地版本的元组是 0.1.1）——即上游 peerDeps 的 5 个 dsh-* 条目在本地 0.1.1-rc.2 上**全线冲突**，修正范围不止删除 `dsh-client-ui-slots` 一项。**已修正**：package.json 全部 5 个 dsh-* 条目改为显式区间 **`>=0.1.1-rc.2 <0.2.0`**（父代理指令形态；实测本地版本满足，未来 0.1.x 正式版满足、0.2.0 排除、异元组预发布如 `0.1.5-rc.1` 依规则不匹配）。react/cordis/schemastery 是纯正式版本号区间（`^18.2.0`/`^4.0.1`/`^3.18.1`），不受 prerelease 规则影响，保留 `^`。程序化验证：对修改后的 package.json 逐条 `satisfies(本地实测版本, range)` → **8/8 PASS**（§4.7）。

7. **flat 目录 broken symlinks 与安装形态**（第二轮补充，btw 侧交叉验证输入；实测枚举）：`~/.dsh/profiles/node_modules/@deepseek-ai/` 共 202 个条目，绝大多数是指向 `~/.dsh/profiles/web/node_modules/@deepseek-ai/*` 的**有效** symlink（含本插件宿主半所需的 schemastery、dsh-settings）；实测发现 **5 个 broken symlink**，全部指向已清除的 npx 缓存 `~/.npm/_npx/1e7f6d9597241db0/...`：`dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-web-react`（父代理点名的 3 个）+ `dsh-client-web`、`dsh-client-schema-form`（实测多发现的 2 个）。含义：任何 `dsh.client.inject` 或客户端 require 引到这 5 个包的插件在本部署都会加载失败。**本插件接线面不受影响且已程序化守卫**：`dsh.client.inject` 仅含 runtime/locale/ui-theme/ui-settings（web profile 内实测全部为有效目录）；client 半是手写 ModuleLoader bundle（taste 式），仅 require `react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-runtime/client`，零引用上述 5 包（slots/theme 契约全部走 runtime）；宿主半 import 的 `@deepseek-ai/schemastery`、`@deepseek-ai/dsh-settings` 从 flat-tree 安装位置实测解析成功（有效 symlink → web/node_modules；`env -u NODE_PATH` 干净环境验证，NODE_PATH 未设置、无 `~/node_modules` 全局回退）。**安装形态**：`install.sh` 真实目录拷贝（`cp -r`）+ 断言非 symlink + 三道 fail-fast（§1.5、§4.7）。

**复核中发现的两个额外事实（影响写法，已按事实落地）**：
- **schemastery 对象字段自动 `meta.default = {}`**（`lib/index.mjs` defineMethod：`if (name === "object" || name === "dict") schema.meta.default = {}`）：若 pages 的 page 字段直接用 `PageSchema`，缺席键会被解析成「全默认值的覆盖对象」，`pages[page] ?? global` 永远命中 page——回落语义失效。**修正**：page 字段改用 `z.union([PageSchema, z.const(null)])`（union 无自动 default，缺席键保持缺席；显式 null 也等于无覆盖）。已实测验证（§4.1）。
- 客户端 scope 无 mutate（见第 2 条）。

---

## 3. 14 条交付单元逐条落地情况

### U1 fork 落位与包元数据 ✅
见 §1.1/§1.2/§1.3(LICENSE)。包名按父代理指令 `@local/dsh-wallpaper`（审计原文为 `@cns2026495165/dsh-wallpaper`，待澄清 C1）。9191 webserver 段已删（YAML 解析验证）。
自查：`package.json` JSON 解析 ✓；`cordis.patch.yml` 顶层仅 1 个 insert entry、无 config ✓；peerDeps 全部 8 条对本地实测版本逐条 `semver.satisfies` PASS（第二轮修正后，§4.7）✓；包内零引用 5 个 broken-symlink 包（§2.7）✓；GUI 3080 不受影响（patch 无 webserver 条目，插件未激活时不改变任何启动行为；激活后也仅插入插件）。

### U2 宿主半：图片上传端点 ✅
`POST /dsh-wallpaper/media/upload`：MIME 白名单 png/jpeg/webp/gif（→415）、≤10MB（content-length 预检 + 流式上限 →413）、流式写 `MEDIA_ROOT/<uuid>.<ext>`、返回 201 `{url,size}`。MP4/ffmpeg 分支全删。
自查（模拟 HTTP 打真实 handler，§4.2）：png 上传 → 201 + URL ✓；GET → 200 `image/png` ✓；>10MB（content-length 与流式两路）→ 413 ✓；mp4 MIME → 415 ✓；**上传后 MEDIA_ROOT 中为原始字节**（逐字节比对）✓；超限不留文件 ✓。

### U3 宿主半：绝对路径导入端点 ✅
`POST /dsh-wallpaper/media/import`，body `{path}`：非绝对 → 400；扩展名白名单 → 415；不存在 → 404；非普通文件 → 400；>10MB → 413；通过后 `copyFileSync` 复制进 MEDIA_ROOT（绝不 serve 原路径）→ 201 `{url,size}`。
自查：合法 png 路径 → 201 + MEDIA_ROOT 出现内容一致的副本 ✓；相对路径 400 ✓；非图片扩展 415 ✓；不存在 404 ✓；超限 413 ✓；坏 JSON 400 ✓。

### U4 宿主半：GET/DELETE/cleanup 适配图片 ✅
`mediaNameFromPath` 正则改 `^[a-f0-9-]+\.(png|jpe?g|webp|gif)$`；GET content-type 按扩展名映射（png/jpg/jpeg/webp/gif）；cleanup 正则同步。**mp4 未保留在正则中**（父代理裁决移除 MP4 全链路；若需兼容上游遗留 .mp4 文件可加回，见待澄清 C2）。
自查：GET 图片 200 + 原始字节 + `image/png` ✓；DELETE 200 且文件实际删除 ✓；`settings.json` 等非图片名 → 404 ✓；cleanup 保留 keep 名单、清理未引用文件 ✓（测试实测清掉了此前跑挂遗留的孤儿文件）；未知方法 405 ✓。

### U5 宿主半：settings namespace 注册 ✅
`ctx.inject(["settings"], sctx => sctx.settings.register(settingsNamespace("wallpaper"), WallpaperSettingsSchema))`；`/dsh-wallpaper/settings` 路由与 settings.json 读写全删。schema 结构 = 审计 §5.2（global + pages{session,settings,home}，source/darkMask/opacity/blur）。
自查（§4.1，直接调用注册捕获的 schema）：`schema(undefined)` → global 默认 {source:null, darkMask:0, opacity:0.8, blur:0} + pages {} ✓；home 覆盖带字段默认值、缺席 page 键保持缺席 ✓；darkMask>1 / darkMask<0 / blur>60 / source 非 string 全部抛 ValidationError ✓；source:null 接受 ✓。`~/.dsh/settings.yaml` 实际落盘需宿主运行（静态环境无法端到端，U14 项）；本地已有 ui-onboarding 等 namespace 实证该通道可用。

### U6 客户端半：配置结构与 store 改造 ✅
state `{status, global, pages, revision}`；`resolveOverride(page) = pages[page] ?? global`（整对象替换，按审计 §5.2）；actions `sync` 镜像 scope 快照；行操作 `setSource`/`setValue`（对应审计的 setGlobal/setPageOverride，以 target 参数统一）/`clearOverride`/`createOverride`。
自查（§4.3）：无覆盖回落 global ✓；page 覆盖整体替换（含 mask/blur）✓；source null → 无壁纸（层+遮罩全释放）✓；createOverride 从 global 复制 ✓；clearOverride 删除 page 键 ✓；store 镜像与 scope 快照一致 ✓。

### U7 客户端半：页面检测 + per-page 切换 ✅
`inject` 加 `sessions`；订阅 `sessions.list`，`current ? 'session' : 'home'`；page 变化 → `applyCurrent` → 按生效配置设置/释放 layer 与遮罩。
自查（§4.3）：无会话 → home 壁纸 ✓；打开会话 → 切 session 壁纸（可与 global 不同）✓；关闭会话回 home ✓；单 layer 元素复用（无残留，切换仅换 backgroundImage）✓。

### U8 客户端半：暗色遮罩 overlay ✅
壁纸 layer 之后追加 `maskEl`（fixed/inset:0/z-index:-1、DOM 序在壁纸后、`background: rgba(0,0,0,darkMask)`）；darkMask=0 → 不渲染；无壁纸 → 无 mask；`teardownWallpaper` 同步释放；壁纸重建时 mask 自动重排到正确位置。
自查（§4.3）：darkMask 0.5 → `rgba(0, 0, 0, 0.5)` 的 mask 出现且 `previousSibling` 是壁纸层 ✓；darkMask 0 → mask 移除 ✓；source null → 全释放 ✓；滑杆写入 0.4 → mask 即时出现 ✓。

### U9 客户端半：URL 来源 UI ✅
WallpaperRow 新增 URL 输入 + 应用按钮（回车同效）：`^https?://` 直接作 source；`/` 开头 → 调 U3 import 后转媒体 URL；其他 → 报错不落盘。上传/导入失败显示宿主返回的错误信息。
自查（§4.3/§4.4）：输入框与按钮渲染 ✓（真实 React SSR）；URL 直传经 setSource 写入 scope 且壁纸立即切换 ✓（setSource 路径全覆盖）；非法输入报错分支为纯前端分支（regex 已覆盖）；远程 URL 无 CSP 已由审计预验证（§1 运行中 GUI 实测无 Content-Security-Policy 头）。

### U10 客户端半：上传 UI 对齐契约 ✅
accept 限 `.png,.jpg,.jpeg,.webp,.gif`；前端 10MB 校验；上传走 U2 端点（原文件 POST，无压缩）；`readImageAsDataUrl`/`compressImage`/`readFileAsDataUrl` 删除；MP4 分支与视频文案删除。
自查：accept 属性渲染 ✓（SSR 断言）；MIME 白名单 + 大小校验为行内分支（§4.4 渲染覆盖错误文案 key）；宿主侧已验证**原图逐字节落盘**（U2 自查）；source 形态为 `/dsh-wallpaper/media/<uuid>.<ext>` ✓。

### U11 客户端半：持久化改 settings.yaml ✅
localStorage 全链路删除（keys/readStorage/writeStorage/migrate/settings.json 路由客户端）；`ctx.settingsScope.bind({namespace:'wallpaper'})`；所有写操作 `scope.set('global'|'pages', next)`（**审计原文的 `scope.mutate` 在本地客户端 scope 不存在**，见 §2.2，已按实际 API 适配）；`scope.subscribe(sync)` 实现跨浏览器实时同步；scope 不可用（status unavailable / !writable）→ 控件禁用 + 只读提示，不崩。
自查（§4.3）：setSource/setValue/createOverride/clearOverride 均产出正确的 `scope.set` 调用载荷 ✓；scope 快照变更 → 层实时更新 ✓；unavailable → isWritable()=false、写入被拒（无 scope.set 调用）、只读提示渲染、控件 disabled ✓。

### U12 客户端半：设置页检测信号 ✅
WallpaperRow `useEffect`：mount → `notifySettingsOpen(true)`，cleanup → false；并入 page 计算（`settingsOpen ? 'settings' : (current ? 'session' : 'home')`）。
自查（§4.3）：信号 true → 切 settings 覆盖壁纸（含遮罩）✓；信号 false → 回 session ✓；caveat（设置模态切到其他节 → 行卸载 → 回落 session/home）为审计 §3.5 已记录的设计行为，未加 MutationObserver 兜底（审计标注「可选」）。

### U13 profile 接线与安装 ✅（以脚本形式交付，激活待父代理执行）
`install.sh`（包内，第二轮加固）：真实目录拷贝到 `~/.dsh/profiles/node_modules/@local/dsh-wallpaper` + 三道 fail-fast 后验（①禁止引用 5 个 broken-symlink 包；②宿主依赖从安装位置 `require.resolve` 实测；③client-inject 四包存在性，见 §1.5）+ 幂等追加 profile patch insert 条目；README 提供等价手工步骤。
自查（§4.7，19 项矩阵）：正例 2 次（真实目录断言、5 项依赖检查全绿、patch 追加且二跑幂等、追加 YAML 块与预期逐字一致）✓；负例 A（包引用 `dsh-client-ui-slots` → 拒绝安装并说明原因）✓；负例 B（client-inject 目录缺失 → 报错退出）✓；负例 C（DEST 在解析链外，等价于 broken symlink 场景 → 宿主依赖解析报错退出）✓；测试 scratch 已从 flat tree 清空、live profile 未触碰。
**说明**：本阶段约束「全部改动落在 dsh-wallpaper-local/」，且激活需要重启 `dsh web`（会终止当前 GUI 会话，无法从会话内自验），故未直接修改 live profile——见待澄清 C3。

### U14 端到端验收清单（手工）→ 见 §5
静态可验证部分已全部覆盖（§4）；需运行 GUI 的部分整理为清单待激活后执行。

---

## 4. 验收自查详情

### 4.1 宿主半 schema 测试（14 项断言）
用 mock `ctx.inject(["settings"])` 捕获 `register` 实参后直接调用 schema：默认解析、覆盖解析、非法值拒绝（darkMask 越界/负值、blur 越界、source 非 string）、null 接受、**缺席 page 键保持缺席**（schemastery 自动 default 修正后的关键回归项）。14/14 通过。

### 4.2 宿主半 handler 模拟 HTTP 测试（25 项断言）
以 `EventEmitter` 模拟 req、`stream.Writable` 模拟 res（支持真实 `createReadStream().pipe(res)`），对真实 `apply(mockCtx)` 捕获的 media 路由 handler 打真实请求（文件落在真实 `~/.dsh/wallpapers/`，测试自清理，结束后目录为空）。覆盖 U2/U3/U4 全部验收点 + 越界/穿越/坏输入。25/25 通过。

### 4.3 客户端半 apply 级测试（41 项断言）
fake DOM（节点树 + previousSibling/after/prepend/contains）+ fake `settingsScope`/`sessions`/`theme`/`locale`/`slots` 服务 + 真实 react，加载真实 `lib/client.js` 并调用真实 `apply(ctx)`。覆盖：inject 数组、scope/sessions 订阅、theme/change、行注册选项（id/order/store/locale）、行操作面、home↔session↔settings 三态切换、遮罩生命周期、乐观写入与 scope.set 载荷、替换后媒体 DELETE、只读降级、词典键集一致 + t() 键全存在。41/41 通过。

### 4.4 设置行渲染测试（14 项断言，真实 react-dom/server SSR）
用与 GUI 同版本的 react/react-dom 渲染 WallpaperRow：标题/目标选择器（4 选项 + 已覆盖标记）/预览图/移除按钮/URL 输入/应用按钮/三滑杆/无覆盖提示/加载提示/只读提示 + 控件禁用/en 词典渲染。14/14 通过。

### 4.5 执行中发现并修复的缺陷（均为自查揪出）
1. **上传超限孤儿文件竞态（lib/index.js `writeUpload`）**：`createWriteStream` 的 open 是异步的；超限失败时立即 `rmSync` 会跑在文件创建之前，且 destroy 在 open 前调用时 `close` 事件先于文件创建发出——两者都会留下 0 字节孤儿文件（模拟测试稳定复现）。修复：失败清理改为「未 open 则等 `open` 事件再 destroy，`close` 时 rmSync」；413 响应先冲刷再断开请求。修复后测试含 100ms 稳定期断言，通过。
2. **设置行残留 `setNotice` 引用（lib/client.js select onChange）**：移除 notice state 时漏改一处，会在切换目标时抛 ReferenceError。SSR 不触发事件、语法检查也查不出（标识符合法），代码复查发现并修复；grep 复核无残留。

### 4.6 静态检查
`node --check` 两个 lib 文件 ✓；`package.json` JSON 解析 ✓；`cordis.patch.yml` YAML 解析 + 结构断言 ✓；`install.sh` `bash -n` ✓；代码中无 mp4/ffmpeg/localStorage/dataUrl 残留（仅 fork 说明注释提及）✓；MIT 双版权保留 + fork notice ✓。

### 4.7 第二轮补充修正验证（btw 侧交叉验证输入；测试脚本 `/tmp/wp-test/install.test.sh`）
- **peerDeps semver 实证**（本地 `semver` 7.8.5）：`0.1.1-rc.2` vs 上游 `^0.1.0-rc.6` → **false**（5 个 dsh-* 条目全线冲突的证据）；vs `>=0.1.1-rc.2 <0.2.0` → **true**；未来 `0.1.5` 正式版 → true、`0.2.0` → false、`0.1.5-rc.1`（异元组预发布）→ false（符合 prerelease 元组规则）。对修改后的 package.json 逐条 `satisfies(本地实测版本, range)`：**8/8 PASS**（react 18.3.1 / cordis 4.0.1 / schemastery 3.18.1 / dsh-settings + 4×dsh-client-* 均 0.1.1-rc.2）。
- **broken symlinks 实测枚举**：flat dir `@deepseek-ai/` 下 **5 个**（ui-slots / ui-primitives / web-react / web / schema-form，均指向已清除的 `~/.npm/_npx/1e7f6d9597241db0/`）；父代理点名 3 个 + 实测多发现 2 个。其余条目（含本插件所需的 schemastery、dsh-settings）为指向 web/node_modules 的有效 symlink 或真实目录；这 5 个包在 web profile node_modules 内均不存在（是 flat 侧的悬空链接，非「存在但坏」）。
- **解析链实测**（`env -u NODE_PATH` 排除环境干扰；实测 NODE_PATH 未设置、无 `~/node_modules`/`~/.node_modules` 全局回退）：从 flat tree 内位置解析 `@deepseek-ai/schemastery|dsh-settings` → 成功（经 flat dir 有效 symlink → web/node_modules）；从链外 `/tmp` → 失败（证明 install.sh 的检查能捕获真实失效场景）。
- **install.sh 自测矩阵（19/19 通过）**：正例 2 次（幂等：patch 条目数保持 1；真实目录断言；5 项依赖检查全绿；追加 YAML 块与预期逐字一致；包文件完整拷贝）；负例 A（包引用 broken-symlink 包 → 拒绝安装并说明）、负例 B（client-inject 目录缺失 → 报错退出）、负例 C（DEST 在解析链外 → 宿主依赖解析报错退出）全部按预期失败。自测使用的 flat tree 内 scratch 目录 `.wp-install-selftest` 已清空；live profile 与 `~/.dsh/profiles/web/cordis.patch.yml` 全程未被触碰（脚本末尾有断言）。
- **测试夹具假象 2 例（识别后绕开，非产品缺陷）**：负例 C 两次「意外通过」均因把隔离 DEST 放在 `/tmp/wp-test` 下——该目录有第一轮为 host/client/render 测试搭的 `node_modules` symlink（→ web/node_modules），落在解析链上把失败救活了；修正为把隔离 DEST 放在 `/tmp/wp-test` 之外后，负例如预期失败。
- **回归**：三套测试套件（host 39 / client 41 / render 14）在第二轮修改后全部重跑通过；语法/JSON/YAML/bash 静态检查全部通过。

---

## 5. U14 手工端到端验收清单（激活后执行）

前置：`bash dsh-wallpaper-local/install.sh` + 重启 `npx @deepseek-ai/dsh web`（GUI 仍在 3080）。

- [ ] Settings → General 出现「壁纸」卡片（目标选择器 + 三滑杆 + URL 输入）
- [ ] 全局默认：上传 png → 壁纸出现、cover 铺满；`~/.dsh/wallpapers/` 有原图（文件大小=原文件）；`cat ~/.dsh/settings.yaml` 出现 `wallpaper:` 节
- [ ] URL 来源：输入 https 图片地址 → 立即切换；非法输入 → 报错且 settings.yaml 不变
- [ ] 绝对路径导入：输入本机 png 绝对路径 → MEDIA_ROOT 出现副本、壁纸切换
- [ ] per-page：为「首页」「会话页」分别设不同壁纸；无会话↔打开会话切换正确；打开 Settings→General 时 settings 覆盖生效、关闭恢复
- [ ] 页面覆盖回落：清除某页覆盖 → 该页回全局壁纸
- [ ] 遮罩滑杆：0.5 时壁纸可见变暗、0 恢复、无壁纸时无遮罩；透明度/模糊滑杆生效
- [ ] 持久化：重启 DSH 后壁纸一致；换浏览器（或无痕窗口）壁纸一致
- [ ] 明暗主题切换（theme/change）下壁纸与遮罩正常
- [ ] 无壁纸时外观与现状一致（表面 CSS 常驻为上游原行为）
- [ ] 移除壁纸 → 层/遮罩清除；替换壁纸 → 旧媒体文件被删（若未被其他页引用）
- [ ] `curl -sI 127.0.0.1:3080` 正常；插件加载无报错日志

---

## 6. 待澄清项（未拍板，均按最贴近审计/父代理指令的理解落地）

- **C1 包名 scope**：审计 §5.1/U1/U13 写 `@cns2026495165/dsh-wallpaper`，父代理执行指令写 `@local/dsh-wallpaper`。**已按父代理指令取 `@local/dsh-wallpaper`**（模块 id、patch、install.sh、README 同步）。若审计本意是 `@cns2026495165` scope，需要改 5 处字符串（package.json name、client.js module id、cordis.patch.yml、install.sh、README×2）。
- **C2 U4 正则中的 mp4**：审计 U4 原文「扩为 `(png|jpe?g|webp|gif|mp4)`」写于父代理 MP4 裁决传达之前。父代理裁决「删掉 MP4 上传/ffmpeg 转码/视频播放逻辑」——GET/DELETE 属播放链路支撑，且 fork 是全新安装（无历史 mp4 文件需要兼容），故正则**未保留 mp4**。若审计本意是「保留对上游遗留 mp4 文件的只读 serve」，在 `mediaNameFromPath`/cleanup 正则与 `CONTENT_TYPE_BY_EXT` 加回 mp4 即可。
- **C3 U13 的执行边界**：U13 原文要求直接改 `~/.dsh/profiles/web/cordis.patch.yml` 并安装到 profile 目录；但本阶段约束「全部改动落在 dsh-wallpaper-local/」，且重启验证无法在会话内完成。**已落为包内 `install.sh` + README 手工步骤**，未触碰 live profile。请父代理决定：自行运行 install.sh，或授权执行档直接改 live profile。
- **C4 遮罩与「透明度」的语义并存**：上游 opacity 是「UI 表面 token 染半透明」（壁纸从表面透出），非壁纸透明度；新增 darkMask 是壁纸上的暗色遮罩。两者+blur 三个滑杆并存（审计 §5.3-3「opacity/blur 滑杆保留为可选附加项」）。若产品上认为 opacity 语义易误解，可考虑后续改文案，本轮未动语义。
- 另记录两处按事实修正的审计写法（非歧义，属 §7 复核结论）：客户端 scope 无 `mutate`（改 `set` 整字段写入）；schemastery 对象字段自动 default `{}`（page 字段加 union 包装保住缺席语义）。详见 §2。

## 7. 副作用与风险说明

- 测试期间在真实 `~/.dsh/wallpapers/` 创建并清理了若干测试 png（结束时目录为空，`~/.dsh/settings.yaml` 未被触碰——插件未激活，settings 注册与写入均发生在 mock 中）。
- 第二轮 install.sh 自测曾在 flat tree 内短暂创建 `~/.dsh/profiles/node_modules/.wp-install-selftest/`（正/负例的安装目标），测试结束已清空；live profile patch 全程未触碰（自测脚本内有断言）。
- 上游 `/tmp/frog-wallpaper` 零改动。
- 插件未安装、未激活：live profile、运行中 GUI 均未修改。
- 已知环境事实（供后续阶段参考）：flat dir 的 5 个 broken symlink 是本部署的既有问题，属宿主环境而非本插件引入；若日后修复（重指或删除），不影响本插件（它不引用这 5 个包）。

## 父代理裁决（C1–C4）
- C1 包名 scope：保留 `@local/dsh-wallpaper`（与 btw 的 `@local/dsh-btw` 一致，统一本地 fork scope）。
- C2 MP4：保留移除（契约=静态图片；上游遗留 mp4 文件暂不兼容，如需后续再加）。
- C3 安装：父代理在 btw 完成后统一接线（run install.sh + 重启一次），不改 C3 结论。
- C4 双滑杆：保留 opacity（表面透明）+ darkMask（壁纸遮罩）两个语义并存，符合契约"cover+可选暗色遮罩"。
