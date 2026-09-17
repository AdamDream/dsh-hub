# P0-b — settings 行为开关试点：修订执行复核一体报告（2026-09-16）

阶段：修订执行复核一体（route: adam/deepseek-v4-flash），同一档内完成修改 + 自复核 + 验证。
目标：把高频「改参数重启」下沉到热载 settings —— dsh-usage / dsh-btw 各搬 3–5 个纯行为开关，
从常量改为读 settings 命名空间；默认值与现状一致（无键 = 现状，旧配置兼容）；验证热载路径。
约束遵守：只改 `.workspace/dsh-usage-src/` 与 `dsh-btw/` 源码及报告；`~/.dsh` 部署位未触碰
（diff 证实仍为基线）；未使用 sandbox_permissions。

---

## 1. 搬的键（每插件 4–5 个，全部纯行为开关，不碰安全/路由）

### dsh-usage（命名空间 `dsh-usage`，宿主 schema 从空扩展为 Config，5 键）

| 键 | 默认 | 行为 |
|---|---|---|
| `dsh-usage.ui.tooltip` | `true` | 三图自绘跟随鼠标 tooltip（面积/柱状/热力图）。`false` = 无自绘浮层（热力图保留原生 `<title>` 兜底） |
| `dsh-usage.heatmap.peakRing` | `true` | 峰值日单元格 2px 环（`--du-heat-peak-stroke`） |
| `dsh-usage.heatmap.monthLabels` | `true` | 热力图月份标签行（覆盖列跨度居中） |
| `dsh-usage.heatmap.legendNote` | `true` | 热力图图例说明行（"单位 tokens/日 · 灰格 = 无数据 · 峰值…"） |
| `dsh-usage.heatmap.levels` | `6` | 热力图强度分桶数（1..6，默认 6 = FILLS 满档） |

### dsh-btw（新命名空间 `dsh-btw`，宿主注册 BTW_SETTINGS_SCHEMA，4 键）

| 键 | 默认 | 行为 |
|---|---|---|
| `dsh-btw.ui.banner` | `true` | 侧聊运行横幅（SideChatSurface running banner）。`false` = 运行中也不显示 |
| `dsh-btw.ui.modelSelect` | `true` | 头部模型选择器可见性。`false` = 隐藏（模型保持当前值，不影响 setModel 通道） |
| `dsh-btw.ui.imageBadge` | `true` | 多图消息缩略图序号徽标。`false` = 隐藏 |
| `dsh-btw.vision.autoTransform` | `true` | 图片自动转文本（vision-adam）：`true` = 模型不声明图片输入时自动转文本（现状）；`false` = 不自动转，文本模型发图返回可读错误拒绝发送 |

键名与 schema：宿主 `lib/index.js` `Config`（usage）、`src/index.ts` `BTW_SETTINGS_SCHEMA`（btw）
均为新增子键 + 默认值，只增不改；settings.yaml 无对应段/无键时解析为默认值 = 旧行为。**schema
本身是插件代码（改 schema 需一次重启/重载部署），部署后值级热载无需重启**（见 §4）。

---

## 2. 改动清单（逐文件）

### dsh-usage（`.workspace/dsh-usage-src/`，6 个文件）

| 文件 | 改动 |
|---|---|
| `lib/index.js` | `Config` 从 `z.object({}).default({})` 扩展为 ui/heatmap 行为开关 schema；`settings.register("dsh-usage", Config)` |
| `lib/charts.js` | `heatmapGrid(days, cell, opts)` 支持 `opts.levels`（整数 1..6 钳制，默认 6）；JSDoc 更新 |
| `lib/client.js` | 内联 `heatmapGrid` 同步 `levels`；`inject` += `"settingsScope"`；`apply` 防御性 bind scope（不可用回退默认）；新增 `usageSettingsOf(snapshot)` 解码（缺失键/不可用 → 默认）；`UsageCard` 订阅 scope 快照（useState+useEffect，热载重渲染）；`TrendChart` 加 `tooltip` prop、`HeatmapChart` 加 `tooltip/peakRing/monthLabels/legendNote/levels` props；渲染条件化（tooltip 关 = 不挂 onMouseMove/不渲染浮层；peakRing 关 = 峰值格不画环；monthLabels 关 = 不渲染月份行；legendNote 关 = 不渲染说明行；levels 传给 heatmapGrid + legend 只显示 1..levels 档） |
| `package.json` | `dsh.client.inject` += `@deepseek-ai/dsh-client-ui-settings`（settingsScope 服务提供者，vision-adam 同款先例） |
| `dev/verify-inline.mjs` | optsList 增加 `levels` 变体（1/3/6/0/99/2.5/组合），用例 182→273；geom/render token 表新增 P0-b token |
| `README.md` | 新增「行为开关（P0-b）」小节：键表 + 示例 + 热载说明 |

### dsh-btw（`dsh-btw/`，源码 + 测试 + 元数据）

| 文件 | 改动 |
|---|---|
| `src/index.ts` | `BTW_SETTINGS_NS = settingsNamespace('dsh-btw')` + `BTW_SETTINGS_SCHEMA`（ui.banner/modelSelect/imageBadge + vision.autoTransform，全默认 true）；`apply` 内 `ctx.inject(['settings'], …register)` |
| `src/host/vision.ts` | 新增 `readBtwSettings(ctx)`（读 `dsh-btw` 段，缺失/异常回退 `{}`，调用方按默认处理） |
| `src/host/side-chat-service.ts` | `send()` 图片分支 else（vision-adam 转文本路径）前：`vision.autoTransform === false` → 返回 `invalid-input` 可读错误，不分析、不发送、requestId 不落（可重试） |
| `src/client/btw-settings.ts`（新增） | `BtwSettingsSection` 类型、`BTW_SETTINGS_DEFAULTS`、`decodeBtwSettings`、`btwSettingsOf`、`bindBtwSettings`（防御性 bind）、`useBtwSettings`（useSyncExternalStore，快照稳定引用，热载重渲染） |
| `src/client/index.ts` | `inject` += `'settingsScope'`；`installSideChat` 绑定 scope（结构类型读取，服务缺失回退 undefined）；scope 传入 presentation 构造 + shell.overlay 注入 |
| `src/client/presentation.tsx` | `SideChatPresentation` 构造可选项 `settingsScope?`；`BetterSidebarSideChat` 透传 → `SideChatSurface` |
| `src/client/SideChatDrawer.tsx` | `SideChatDrawerInjected.settingsScope?`（可选，测试兼容）；透传 → `SideChatSurface` |
| `src/client/SideChatSurface.tsx` | props 加 `settingsScope?`；`useBtwSettings`；banner / modelSelect / imageBadge 三处渲染条件化 |
| `package.json` | `dependencies` += `@deepseek-ai/schemastery`（宿主 schema 用，farm 已有该包）；`dsh.client.inject` += `@deepseek-ai/dsh-client-ui-settings` |
| `package-lock.json` | root `dependencies` 同步 `@deepseek-ai/schemastery`（node 条目 lockfile 本就存在 v3.18.2，仅提升为直接依赖） |
| `tsdown.config.ts` | host `neverBundle` += `@deepseek-ai/schemastery`、`@deepseek-ai/dsh-settings`（保持外部解析，运行时由 farm 提供） |
| `tests/host-image.spec.ts` | harness `settings.get` 支持 `dsh-btw` 段；新增测试：`vision.autoTransform=false` → 拒绝发送（invalid-input + 文案含 autoTransform）、零 vision-adam 调用、零 followup、transcript 空、requestId 可重试 |
| `tests/side-chat-surface.spec.tsx` | 新增测试：`ui.banner=false` 且 running → banner 不渲染（fake scope 稳定快照） |
| `README.md` | 新增「Settings behavior switches (P0-b, hot-reload)」小节：键表 + 示例 + 热载说明 |

> 注：`dsh-btw` 的 git diff 还包含**本档之前已存在的未提交能力检测工作**（`src/host/vision.ts`
> 的 modelAcceptsImage/resolveAgentRoute、`prompt-transform.ts`、`side-chat-service.ts` 部分、
> `tests/capability-detect.spec.ts` 与 `tests/host-image.spec.ts` 直传测试、`lib/` 旧构建产物）——
> 主代理部署时 diff 请以「P0-b 增量」为准核对，勿把既有未提交工作归入本档。

---

## 3. 验证摘要

### dsh-usage（`cd .workspace/dsh-usage-src`）
- `node --check lib/charts.js` ✅ `node --check lib/client.js` ✅ `node --check lib/index.js` ✅（node v22.23.2）
- `node dev/verify-inline.mjs` ✅：**273/273** 功能等价（heatmapGrid 143 例含 levels 变体 + scale/bar 130 例）；geom/render token 奇偶全 ok（新增 `opts.levels`、`levels >= 1`、`Math.min(6, opts.levels)` 等）
- `node dev/verify-hit.mjs` ✅：**72/72**（命中/防溢出/formatTokens 不变）
- schema 形状实测（farm schemastery）：空段 → 全默认；`{heatmap:{levels:4,peakRing:false}}` → 正确合并；levels=99 → schema 校验抛错（保持 last-good）

### dsh-btw（`cd dsh-btw`，因 pnpm 无网依赖状态检查失败，全部直接调二进制执行）
- oxlint（`node node_modules/oxlint/bin/oxlint src tests tsdown.config.ts vitest.config.ts`）✅ 0 warnings / 0 errors
- typecheck（3 个 tsconfig 项目）✅
- vitest ✅ **24 files / 218 passed / 2 skipped**（新增 2 个开关测试全过；既有 216 个无回归）
- tsdown build ✅（host ESM + client CJS ModuleLoader bundle 生成）
- smoke-build ✅（build artifacts consistent）
- publint `--level error` ✅ All good（check 脚本标准；`--strict` 的 `./client` CJS/ESM 提示为 ModuleLoader bundle 既有设计，HEAD 基线同样存在，非本档回归）
- 构建产物加载实测 ✅：`lib/index.js` import 成功，`BTW_SETTINGS_SCHEMA()` 空段 → `{ui:{banner:true,modelSelect:true,imageBadge:true},vision:{autoTransform:true}}`；部分段正确合并

---

## 4. settings 热载生效路径（写进两份 README，部署后值级生效）

**改 `~/.dsh/settings.yaml` → 值级热载 → 行为变化，无需重启**：

1. `dsh-settings-file`（chokidar watch 默认开）收到文件变更 → `refresh()` → `reconcileFromDisk()` → `publish(doc)`；
2. 每个已注册命名空间（`dsh-usage` / `dsh-btw`）按 schema 默认 + user 段重新 resolve；
3. **deep-equal commit**：仅当解析值与上次不同才提交 → 宿主发 `settings/updated`（host 端 watch 回调）+ `settings/document-updated`（revision 变化）；
4. 客户端：`dsh-client-ui-settings` 的 `SettingsDescribeMirror` 收到 document-updated → `mirror.load()` → 各 `settingsScope.bind` 快照替换 → `subscribe` 触发 → 卡片/面板重渲染；
5. 宿主侧：`readBtwSettings`/`settings.get('dsh-btw')` 每次调用时读当前解析值，下一次 `send()` 即用新值。

无该段/无键 = schema 默认值 = 与旧版行为完全一致（旧配置兼容）。schema 只增不改，旧文档永不过期。

**前提**：schema/代码改动需随插件部署一次（重启或重载插件）——本档只改工作区/仓库源码，
部署由主代理执行（见 §5）。

---

## 5. 部署注意点（主代理执行）

### dsh-usage
1. 备份部署位后，**同时**替换：`~/.dsh/profiles/node_modules/@local/dsh-usage/lib/{index.js,charts.js,client.js}` ← 工作区同名文件；`package.json`（`dsh.client.inject` 新增 `@deepseek-ai/dsh-client-ui-settings`）。
2. `lib/client.js` 为浏览器 bundle：替换 + 刷新页面即生效；宿主 `index.js`（schema）需插件重载一次（重启 web 或重挂插件），此后 settings 值热载。
3. `package.json` `dsh.client.inject` 变更属客户端元数据（pkgMeta 缓存）→ 需重启 web 一次使注入生效（与 schema 重启同批）。

### dsh-btw
1. `dsh-btw/lib/` 已在仓库内重建（tsdown 产物含本档改动）；部署 = 备份后把 `lib/` + `package.json` + `package-lock.json` 同步到 `~/.dsh/profiles/node_modules/@local/dsh-btw/`。
2. 新依赖 `@deepseek-ai/schemastery`：farm 根 node_modules 已有该包（v3.18.2），运行时解析无需额外安装；`tsdown.config.ts` 已把 schemastery/dsh-settings 列入 host neverBundle（外部解析）。
3. 客户端注入 `@deepseek-ai/dsh-client-ui-settings` 已加入 `dsh.client.inject` → 重启 web 一次生效；此后 `ui.*` 三键热载。
4. `vision.autoTransform` 为宿主侧键：部署后改 settings 即热载（下次 send 生效），无需重启。
5. **开发机提示**：`dsh-btw` 内 `pnpm run *` 会先跑依赖状态检查（需网络，本机 registry 无授权会失败并可能把 peer 依赖挪进 `.ignored`）；离线开发请直接调二进制（本档验证即如此）：`node node_modules/oxlint/bin/oxlint …`、`node node_modules/typescript/bin/tsc …`、`node node_modules/vitest/vitest.mjs run`、`node node_modules/tsdown/dist/run.mjs`、`node scripts/smoke-build.mjs`、`node node_modules/publint/src/cli.js --level error`。

---

## 6. 自复核 + 自裁决

**自裁决：PASS。**

逐项核对：
- **键名与 schema** ✅ 两插件 schema 与客户端解码键名一致（usage: ui.tooltip / heatmap.peakRing / monthLabels / legendNote / levels；btw: ui.banner / modelSelect / imageBadge / vision.autoTransform），默认值全 = 现状。
- **旧配置兼容** ✅ 无段/无键 → schema 默认 → 旧行为；`usageSettingsOf`/`decodeBtwSettings` 对缺失键、非对象段、scope 不可用全部回退默认；settings.yaml 现有 `dsh-usage:`/`dsh-btw:` 段不存在（实测 settings.yaml 无这两段），即使有旧段也只增不改不破坏。
- **默认值 = 现状** ✅ 实测两 schema 空段解析 = 全默认（usage 5 键全 true/6；btw 4 键全 true）；关闭开关时各渲染分支回到开关引入前形态（tooltip 关 → 无浮层但 `<title>` 兜底在；peakRing 关 → 峰值格普通样式；autoTransform 关 → 拒绝而非静默分析）。
- **无安全/路由误伤** ✅ 未碰 tool-policy / READ_ONLY / 会话路由 / 模型路由选择本身；`modelSelect:false` 只隐藏选择器、setModel 通道不受影响；`autoTransform:false` 仅对"文本模型 + 图片"拒绝发送（模型声明支持图片的直传路径不变），不改变任何安全边界。
- **热载路径** ✅ 客户端 useBtwSettings/useState+useEffect 订阅 scope、宿主 readBtwSettings 调用时读，均为值级热载（§4）。
- **验证** ✅ §3 全绿（usage: 语法 + 273/273 + 72/72；btw: lint + 3×tsc + 218 tests + build + smoke + publint-error）。

### 问题清单（非阻塞，供主代理知悉）
1. **btw 新增依赖 schemastery**：部署无需额外安装（farm 已有），但若未来 farm 清理需重装；`dsh-settings` 运行时仅类型级引用（settingsNamespace 是纯 branding 函数，已外部化）。
2. **`heatmap.levels` 非整数**：schema 只 min/max 不强制 int（schemastery 无 `.int()`），客户端与 charts.js 均钳制（isInteger + 1..6），越界整数由 schema 拒绝（保持 last-good）；小数被客户端归一为默认 6。如需严格整数可后续加 validate（超出本档范围）。
3. **pnpm 无网开发**：`dsh-btw` 的 `pnpm run` 依赖状态检查需网络；本档验证全部直调二进制。主代理 CI/部署脚本若离线，需沿用直调方式或配 `--config.verify-deps-before-run=false` + 先确保 node_modules 完整（防止 peer 依赖被挪进 `.ignored`）。
4. **`modelSelect:false` 语义**：隐藏选择器不重置模型，用户仍可经其他通道（如 headless setModel）切换；README 已注明。
5. **客户端 settingsScope 依赖 settings UI 已挂载**：两插件均在服务不可用时回退默认（= 现状），无白屏/回归风险；settings UI 为 web app 常驻包，实际总会挂载。
6. **usage client 是 build-free bundle**：无构建步骤，替换文件即产物；`dsh.client.inject` 变更需要一次 web 重启（pkgMeta 缓存），与 schema 重启同批。
