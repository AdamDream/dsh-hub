# 壁纸功能复核报告（三阶段闭环第 3 阶段）

> 复核对象：`dsh-wallpaper-local/` 执行产物 + `execute-wallpaper.md` 自报。
> 基线：`audit-wallpaper.md`（v2）14 条交付单元（§6）、§5 修订方案、§7 签名复核、§8 风险、父代理三项裁决（MP4 全移除 / 9191 删除 / 图片落盘）与 C1–C4 裁决。
> 方法：不信自报，全部独立重验——通读 fork 全部源文件、与上游 `/tmp/frog-wallpaper`（git 1044d3b，工作区干净，零改动属实）逐函数 diff、对本地 `~/.dsh/profiles/node_modules/` 实包核对签名与版本、用本地 schemastery 独立重跑 schema 语义测试、semver 独立求值、复跑全部静态检查。
> 本阶段只读复核，未改动任何执行产物。

---

## 0. 结论

## **通过**

14 条交付单元中 13 条完全落地且与审计方案一致（其中 U4/U13/U14 的三处形态差异均系父代理 C2/C3 裁决覆盖，非执行档私自决策）；未发现任何需要返工的 bug。发现 1 个轻微 bug（乐观写入失败无回滚，见 §3.1）与 4 项非阻塞观察。执行报告的 94 项自查抽验 3 项全部属实，自报可信。

**附条件**：U14 的运行时端到端验收（GUI 内 12 项清单）因插件尚未安装激活（C3 裁决：与 btw 统一接线）尚未执行——这是已裁决的推迟，不构成返工理由，但闭环最终确认需父代理运行 `install.sh` + 重启后跑完 execute-wallpaper.md §5 清单。

---

## 1. 七项重点验证结果（全部独立重验）

| # | 验证点 | 结果 | 独立证据 |
|---|---|---|---|
| 1 | peerDeps 全线对齐 | ✅ | 5 个 `@deepseek-ai/dsh-*` peer 全部 `^0.1.1-rc.2`；无 `dsh-client-ui-slots`；全包 grep 无 `^0.1.0-rc.*` 残留。**semver 元组冲突实测解掉**：用本地 semver 求值，安装版 `0.1.1-rc.2` satisfies `^0.1.1-rc.2` = true，satisfies 上游 `^0.1.0-rc.6` = **false**（prerelease 元组 (0,1,1)≠(0,1,0) 正是冲突根源）。8 项 peer（含 react 18.3.1、cordis 4.0.1、schemastery 3.18.1）逐一在本地 node_modules 实测存在且版本满足范围。 |
| 2 | 9191 端口删除 | ✅ | fork `cordis.patch.yml` YAML 解析结果恰为 `[{insert: [{id: wallpaper, name: '@local/dsh-wallpaper'}]}]`——顶层 1 条、仅 insert 键；上游的 `- id: webserver … port: 9191` 段已删，9191 仅存在于解释性注释。 |
| 3 | MP4 全移除 | ✅ | 大小写不敏感 grep 全包：mp4/ffmpeg/video 仅出现于头注释、README、LICENSE 的 fork 说明文字。`spawn` 导入、`isVideoWallpaper`、video 元素分支、`uploadVideo` 在与上游 diff 中确认删除。上传链路：浏览器原样 POST File → 宿主流式写 `MEDIA_ROOT/<uuid>.<ext>`；无 data URL、无 localStorage（`readStorage`/`writeStorage`/`compressImage`/`readImageAsDataUrl` 在 diff 中确认删除）。`~/.dsh/wallpapers/` 现为空、`~/.dsh/settings.yaml` 无 `wallpaper:` 键——与「未激活、测试已自清理」的自报一致。 |
| 4 | per-page 覆盖 | ✅ | 宿主 schema `{global: PageSchema, pages: {session/settings/home: union([PageSchema, const(null)])}}`（即审计 §5.2 的 global 默认 + 三页可选覆盖；复核指令中的 "default" 即此 global）。客户端 `resolveOverride(value, page) = pages[page] ?? global`（client.js L109-112）；页面检测 `ctx.sessions.list`（`current === undefined/null → home`，否则 session；`settingsOpen → settings` 优先，L326-337、L565-569）；`SessionListState.current: SessionId \| undefined` 在本地 runtime 契约中逐字确认。遮罩经 `wallpaperEl.after(maskEl)` 保证 DOM 序在壁纸之后（L215-224），同 z-index:-1 下遮罩盖壁纸、UI 之下，与审计 U8 一致。 |
| 5 | settings.yaml 持久化 | ✅ | 宿主：`ctx.inject(["settings"], sctx => sctx.settings.register(settingsNamespace("wallpaper"), WallpaperSettingsSchema))`（index.js L166-168）——与本地 `dsh-client-ui-theme/lib/index.js` L1-2/L55/L71-72 的官方形态逐字同构（`settingsNamespace` 导出、`z` 默认导出均实测存在）。客户端：`ctx.settingsScope.bind({namespace:"wallpaper"})`（L547）。scope 调用面 grep 实证仅 `getSnapshot`/`subscribe`/`set`（无 `mutate`、连 `unset` 也未用）——本地 `SettingsScope` 类型面确认只有 getSnapshot/subscribe/set/unset 四法，审计 U11 的 `scope.mutate` 确不可用，执行档改 `set` 整字段写入是正确的事实性修正（审计 §7 第 2 条预留了此复核）。 |
| 6 | 绝对路径安全 | ✅ | import 端点（index.js L193-228）：非绝对→400、扩展名白名单→415、不存在→404、非普通文件→400、>10MB→413，通过后 `copyFileSync` 复制进 MEDIA_ROOT 并返回**副本**的媒体 URL；绝不返回/不 serve 原路径。GET 仅服务匹配 `^[a-f0-9-]+\.(png\|jpe?g\|webp\|gif)$` 的名字（uuid 形态，basename 天然防穿越）+ resolve/startsWith 双保险。审计 §8「绝不直接 serve 任意路径」满足。 |
| 7 | 执行报告与代码一致性 | ✅ | 函数级抽查 5 处全部吻合（详见 §4），含两处执行期修复的机制逐行核对。 |

---

## 2. 14 条交付单元逐条核对

> 图例：✅ 落地 / ⚠️ 偏差 / ❌ 未落地。每条附一句话独立证据。

| 单元 | 结果 | 证据 |
|---|---|---|
| **U1** fork 落位与包元数据 | ✅ | package.json：`@local/dsh-wallpaper` 0.5.0、`dsh.client.inject` 四包（runtime/locale/ui-theme/ui-settings，本地全部存在）、peerDeps 对齐（§1.1）；cordis.patch.yml 仅 insert；LICENSE 头部 KinGao294+Frog755 双版权逐字保留 + 尾部 fork notice。包名与审计 §5.1 的 `@cns2026495165/` 不同系父代理 C1 裁决（保留 @local，与 btw 统一），全包无 cns2026495165 残留、@local 名七文件一致。 |
| **U2** 宿主半：图片上传端点 | ✅ | `POST /upload`：MIME 白名单 png/jpeg/webp/gif→否则 415、content-length 预检→413、流式上限→413、成功 201 `{url,size}`（index.js L174-191）；`MAX_IMAGE_BYTES`=10MB；ffmpeg/MP4 分支全删。 |
| **U3** 宿主半：绝对路径导入端点 | ✅ | `POST /import` 五重校验 + `copyFileSync` 复制进 MEDIA_ROOT（L193-228），只返回副本 URL，绝不 serve 原路径。 |
| **U4** 宿主半：GET/DELETE/cleanup 适配 | ✅（C2 裁决） | `mediaNameFromPath` 正则 `^[a-f0-9-]+\.(png\|jpe?g\|webp\|gif)$`、GET content-type 按扩展名映射、cleanup 正则同步（L137-145、L229-249）。**mp4 未保留在正则中**——审计 U4 原文（含 mp4）写于 MP4 裁决传达前，父代理 C2 裁决明确「保留移除」，属已裁决偏差。 |
| **U5** 宿主半：settings namespace 注册 | ✅ | `settingsNamespace("wallpaper")` + schemastery schema（global + pages{session,settings,home}）+ `ctx.inject(["settings"])`（L30、L51-58、L166-168）；`SETTINGS_ROUTE`/`SETTINGS_FILE`/settings.json 读写全删（grep 零残留）。schema 语义独立实测通过（见 §4 抽查 1）。 |
| **U6** 客户端半：配置结构与 store | ✅ | store state `{status, global, pages, revision}`，`sync(draft, snapshot)` 镜像 scope 快照（L306-318）；`resolveOverride = pages[page] ?? global`（整对象替换，L109-112）；`setSource/setValue/createOverride/clearOverride` 四 action 齐全（L504-532），createOverride 从 global 复制初始化。 |
| **U7** 客户端半：页面检测 + 切换 | ✅ | `inject` 含 `sessions`（L542）；初始化 + 订阅 `sessions.list`，变更→重算 page→`applyCurrent`（L565-569）；`currentPage()` 三态（settings 优先 → current 有无 → session/home）（L331-334）。 |
| **U8** 客户端半：暗色遮罩 overlay | ✅ | `ensureMaskElement`：fixed/inset:0/z-index:-1、`wallpaperEl.after(maskEl)` DOM 序在壁纸后、`rgba(0,0,0,darkMask)`；darkMask=0 → `releaseMaskElement`；无壁纸全释放；`teardownWallpaper` 同步释放 mask；壁纸重建时 mask 自动重排（L215-224、L246-251、L254-261）。 |
| **U9** 客户端半：URL 来源 UI | ✅ | `onApplyUrl` 三分支：`^https?://` 直接作 source；`/` 开头调宿主 import 转媒体 URL；其余报错不落盘（L416-434）；回车同效；上传/导入失败展示宿主错误信息。 |
| **U10** 客户端半：上传 UI 对齐契约 | ✅ | `accept=".png,.jpg,.jpeg,.webp,.gif"`、前端 10MB 校验、原文件 POST 无压缩（L399-415、L273-282）；`readImageAsDataUrl`/`compressImage`/`readFileAsDataUrl`/MP4 分支在与上游 diff 中确认删除。 |
| **U11** 客户端半：持久化改 settings.yaml | ✅ | localStorage 全链路删除（diff 确认 readStorage/writeStorage/migrateLegacyWallpaper/syncFromHost/pushSharedSettings/全部 key 消失）；`settingsScope.bind` + `scope.set('global'\|'pages', …)` + `scope.subscribe(sync)`（L547-564）；只读降级双门禁 `status !== "ready" \|\| !isWritable()` 控件禁用 + 提示，不崩（L392-397）。审计的 `scope.mutate` 不可用系事实修正（§1.5）。 |
| **U12** 客户端半：设置页检测信号 | ✅ | `useEffect` mount→`notifySettingsOpen(true)`、cleanup→false（L387-390）；并入 `currentPage`（settings 优先）；MutationObserver 兜底未加——审计 §3.5 标注「可选」，caveat 已在设计说明记录。 |
| **U13** profile 接线与安装 | ✅（C3 裁决形式） | `install.sh` 核验通过：复制到 `~/.dsh/profiles/node_modules/@local/dsh-wallpaper`（flat 回退目录，沿用 install-plugins.sh 模式）+ 幂等追加 patch insert（与审计 §3.7 条目同构），`bash -n` 通过。live profile 实测未动（无 @local 目录、profile patch 无 wallpaper 条目）——符合父代理 C3「与 btw 统一接线后重启」裁决，非执行偏差。 |
| **U14** 端到端验收清单 | ⚠️（已裁决推迟） | 清单已交付（execute §5，12 项）；静态可验证部分全部覆盖且抽验属实；**运行时 GUI 验收因插件未激活尚未执行**。按 C3 属推迟而非偏差，但闭环最终确认待接线后完成——这是本报告「通过」结论的唯一附条件。 |

**小结**：13 ✅ + 1 ⚠️（U14，已裁决推迟）；无 ❌。三处与审计原文的形态差异（包名 C1、mp4 正则 C2、U13 脚本化 C3）全部有父代理明文裁决背书，执行档「歧义上报不拍板」的纪律执行到位。

---

## 3. 发现的 bug / 遗漏 / 副作用

**无需返工级问题。** 以下按严重度排列：

### 3.1 [轻微 bug] 乐观写入失败无回滚，注释与行为不符
- 位置：`lib/client.js` L487-492（`commitField`）。
- 问题：注释声称乐观镜像会被 "the scope snapshot (or a failed-write recovery) re-syncs this shortly"，但 `scope.set(field, value[field]).catch(() => {})` 吞掉 rejection 且不回滚 `latestValue`。若 `scope.set` 失败（网络/校验拒绝），本浏览器持续显示未持久化的配置，直到下一次快照变更才被纠正；期间连续写入会基于幽灵值构建；更窄的连带：另一个客户端首次 ready 时的 cleanup 以持久配置为准，可能删掉这个「已上传但未持久引用」的媒体文件。
- 影响：低（本地 host 的 settings 写入极少失败；刷新即恢复真值）。
- 修法（一行）：`scope.set(field, value[field]).catch(() => { sync(); })` —— 从 `scope.getSnapshot()` 重建 `latestValue` 并重放 `applyCurrent`；或至少删掉注释里 "failed-write recovery" 的失实部分。

### 3.2 [观察·继承上游] Slider 双提交放大磁盘写
- 位置：`lib/client.js` L368（`onInput: commit, onChange: commit` 同时挂）。
- 上游同款写法（已对照上游 L345 确认），非 fork 引入；但 fork 中每次拖动 tick 会触发两次 `scope.set` → 两次 settings.yaml 落盘（上游是廉价的 localStorage 写）。功能正确，纯性能观察。可选修法：仅挂 `onChange`（React 对 range 的 onChange 已按 input 语义触发），或拖动结束再提交。

### 3.3 [观察·固有窄窗口] 跨客户端 cleanup 竞态
- 位置：`lib/client.js` L558-561（首次 ready 后 `cleanupMedia(referencedMediaNames(latestValue))`）。
- 客户端 A「上传完成 → scope.set 落地」之间，客户端 B 恰好首次 ready 执行 cleanup，会删掉 A 刚上传、持久配置尚未引用的文件。每客户端生命周期仅清一次，窗口极窄；上游每次启动都跑 cleanup，暴露面更大。可选修法：cleanup 跳过 mtime 新于数分钟的文件。

### 3.4 [观察·继承上游·审计未要求] 媒体路由无 CSRF/Content-Type 硬化
- 位置：`lib/index.js` L193-249（import/cleanup 不校验请求 Content-Type；恶意网页可用 `text/plain` 表单 POST 直击 simple-request，绕过 CORS 预检触发清理/导入）。
- 路由绑 127.0.0.1、上游同样暴露、审计 §8 未列此项——不构成本轮返工依据，记录供后续加固（校验 `content-type` + `Sec-Fetch-Site: same-origin`）。

### 3.5 [trivial] install.sh 静默跳过
- 位置：`install.sh` L31-43：`$PROFILE_PATCH` 不存在时无 else 分支，激活被静默跳过。本部署该文件必在，不影响；健壮性可加一行报错。

### 副作用核查（全部干净）
- 上游 `/tmp/frog-wallpaper`：git status 空、HEAD=1044d3b，零改动属实。
- `~/.dsh/wallpapers/`：空目录（测试自清理声明属实）；`~/.dsh/settings.yaml` 无 wallpaper 节。
- live profile / 运行中 GUI：未触碰（无 @local 安装目录、profile patch 无 wallpaper 条目）。
- `assets/` 两张截图与上游 md5 逐字节一致（「原样复制」属实）。

---

## 4. 对 94 项自查可信度的独立判断

**判断：可信。** 抽查 3 项（覆盖宿主 schema、宿主修复、静态检查三类），另将 §2 全部 5 项签名复核对本地实包独立重验：

1. **§4.1 schema 断言（14 项）——属实。** 我用本地 schemastery 3.18.1 独立重跑等价 schema：union 包装下缺席 page 键保持缺席（`pages keys = []`）、显式 null 等价无覆盖、覆盖对象字段默认值补齐、`darkMask 1.5`/`source 42`/`blur 61` 全部抛 ValidationError；**对照组（不用 union）证实缺席键确实被自动 default 成全默认对象**——执行档 §2 声称的「schemastery 对象字段自动 default {} 陷阱」真实存在，其 union 修正不是虚构的技巧而是必要修复。
2. **§4.5.1 上传超限孤儿文件竞态修复——属实。** 逐行核对 `writeUpload`（index.js L77-122）：`stream.once("close", removeFile)` 前置注册 + 未 open 时改等 `open` 再 destroy 的门控逻辑，与报告描述的机制完全一致；`json()` 的 `closeRequest` 路径先 `res.end(payload, cb)` 冲刷再 `req.destroy()` 也在代码中（L124-135）。其描述的失败模式（`createWriteStream` 的 open 异步、早 rmSync 跑在文件创建前）技术上成立。`node --check` 独立复跑通过。
3. **§4.6 静态检查——属实。** 五项全部独立复跑：`node --check` 两 lib 文件 ✓、package.json 解析 ✓、cordis.patch.yml YAML 解析 + 结构断言（顶层 1 条、仅 insert）✓、`bash -n install.sh` ✓、mp4/ffmpeg/localStorage/dataUrl 残留 grep ✓（仅注释/README/LICENSE 说明文字）。

附带背书：§2 的 5 项签名复核我逐一对照本地包验证——`settingsNamespace` 导出（dsh-settings types L20）、`SettingsScope` 方法面 getSnapshot/subscribe/set/unset **无 mutate**（ui-settings settings-scope.d.ts）、`SessionListState.current: SessionId | undefined`（runtime sessions/service.d.ts L72）、`slots.register` 字段名与本地 ui-theme L1337-1343 逐字一致、宿主半注册形态与本地 ui-theme lib/index.js L1-2/L71-72 逐字同构。执行档对审计的两处事实性修正（scope 无 mutate、union 防 auto-default）均经我独立复核为真，属正确的「按事实修正」而非偷工。

---

## 5. 复核方法备注（可追溯）

- 通读：fork 全部 12 个文件（重点 lib/index.js 268 行、lib/client.js 592 行全文）+ 上游 lib/*.js 关键区域。
- diff：fork client vs 上游 client 函数级 diff，逐一映射执行报告 §1.4 的删除/新增/改写清单（readStorage 族删除、normalize 族新增、shadeTokens 参数化、video 分支删除、uploadVideo→uploadImage、importImage 新增、store sync 改形、WallpaperRow 重写、onApplyUrl 新增——全部吻合）。
- 实证：本地 8 个 peer 包版本实测；semver satisfies 独立求值；schemastery schema 独立测试脚本（/tmp/review-schema-test.mjs）；静态检查五件套复跑；assets md5 比对；上游 git 状态核验。
- 一处特别澄清：fork `ensureWallpaperCss` 中的 `data-dsh-better-sidebar` / 桌面平台 sidebarCol 规则**不是夹带私货**——上游 L91-120 原文即含这些规则，执行报告「原样保留」声明属实。

## 6. 给父代理的行动建议（非返工）

1. 按 C3 计划：btw 就绪后统一 `bash dsh-wallpaper-local/install.sh` + 重启，随后执行 execute-wallpaper.md §5 的 12 项手工清单，完成 U14 闭环。
2. 顺手修 §3.1 的一行回滚（或删失实注释）；§3.2-3.5 可留待后续版本。
