# @local/dsh-wallpaper 移植报告：0.1.1-rc.2 → 0.1.5-rc.2

## 结论摘要

web2 启动失败根因是 `lib/index.js:17` 静态 import 了 0.1.5 已删除的
`settingsNamespace` 导出。该 helper 在旧版只是"校验并原样返回字符串"的
branding 函数（与新版 `register` 内部 `parseSettingsNamespace` 的校验规则
完全相同，`/^[a-z][a-z0-9-]*$/`），因此移植等价于：删除 import、
把常量改为裸字符串 `"wallpaper"`。客户端 `lib/client.js` 的
`@deepseek-ai/dsh-client-store` 改法经核验与 0.1.5 官方用法一致，无需改动。

## 修改文件（仅 web2 副本，共享层与 web/ 未触碰）

| 文件 | 改动 |
|---|---|
| `/home/CNS2026495165/.dsh/profiles/web2/node_modules/@local/dsh-wallpaper/lib/index.js` | 删除 `import { settingsNamespace } from "@deepseek-ai/dsh-settings"`；`WALLPAPER_NAMESPACE = settingsNamespace("wallpaper")` → `"wallpaper"`（附注释）；register 调用处补 0.1.5 签名注释。其余逻辑（媒体路由、上传/导入/清理、schema、apply 流程）零改动 |
| `/home/CNS2026495165/.dsh/profiles/web2/node_modules/@local/dsh-wallpaper/lib/client.js` | **未改动**（核验通过，见下） |

## 旧→新 API 映射

### settingsNamespace 的所有使用点（宿主 index.js，共 2 处 + 1 处注册）

1. `import { settingsNamespace } from "@deepseek-ai/dsh-settings"`（旧 line 17）
   → **删除整行**。0.1.5 的 `SettingsProvider.register()` 自己解析/校验 ns
   字符串，宿主无需再导入 dsh-settings 的任何符号。
2. `const WALLPAPER_NAMESPACE = settingsNamespace("wallpaper")`（旧 line 30）
   → `const WALLPAPER_NAMESPACE = "wallpaper"`。
   - 旧实现（web 侧 0.1.1 dsh-settings lib/index.js:87-90）：
     `settingsNamespace(v)` 仅做 `NAMESPACE_PATTERN` 校验后**原样返回**，
     TS 层是 branded type，运行时就是普通字符串。
   - 新实现（web2 0.1.5 dsh-settings lib/index.js:82-86）：register 内部
     `parseSettingsNamespace(ns)` 用同一正则校验，不合规直接
     `TypeError`。字符串契约完全等价。
3. `settingsCtx.settings.register(WALLPAPER_NAMESPACE, WallpaperSettingsSchema)`
   （旧 line 167）→ **调用本身零改动**。
   - 新签名 `register(ns, schema, options?)` 返回 owner scope
     （`{get, watch, update, replace}`），旧签名相同。
   - `options.base` 语义（新 lib/index.js:281-315, 509-513）：
     `resolve(schema, base, section) = schema(mergeLayers(base, section))`，
     即解析顺序为 **schema 默认值 → options.base → 用户文档 section**。
   - 本插件**不传 base**（与旧版一致）：`WallpaperSettingsSchema` 内
     `global.default(DEFAULT_GLOBAL)`、`pages.default({})` 即全部非用户层，
     解析结果与旧版逐字节等价。settings.yaml 中文档键仍为 `wallpaper`，
     跨版本数据（含 web 旧服务写入的存量数据）无需迁移。
   - `ctx.inject(["settings"], ...)` 模式在 0.1.5 仍有效，与现成范本
     `dsh-tool-subagent/lib/model-selection-settings.js:64-74` 一致
     （范本用的是 `installSection`——那是"带 composition base 的可选消费方"
     路径，本插件是纯命名空间注册，用 `register` 正确）。

### 客户端 specifier 映射（旧→web2 现状）

- 旧（共享层 0.1.1 client.js:15）：`require("@deepseek-ai/dsh-client-runtime/client")`
- web2 现状：`require("@deepseek-ai/dsh-client-store")`
- `dsh-client-runtime` 在 0.1.5 已不存在（web2/node_modules/@deepseek-ai 下
  无该包，仅 dsh-taste 注释里提及其名），`dsh-client-store` 是 0.1.5 的
  运行时虚拟模块，改法正确且必要。

## 客户端验证结论（重要）

1. **`@deepseek-ai/dsh-client-store` 是合法 specifier（虚拟模块）**：
   - 官方 0.1.5 包自用：
     `web2/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js:29`
     `require("@deepseek-ai/dsh-client-store")`，
     line 2709 `(0, _deepseek_ai_dsh_client_store.defineStore)({ init, persist, actions })`。
   - `web2/node_modules/@deepseek-ai/` 全目录列表**无 dsh-client-store 实体包**
     → 确认由 DSH 运行时在浏览器侧虚拟提供。
   - 插件自身 `package.json` 的 `dsh.client.inject` 已含
     `"@deepseek-ai/dsh-client-store"`，打包注入与该 require 匹配。
2. **wallpaper client.js 用法与官方一致**：
   - `const runtime = require("@deepseek-ai/dsh-client-store")` +
     `runtime.defineStore({ init: () => ({...}), actions: { sync: (draft, snapshot) => {...} } })`（client.js:15, 306-318）。
   - 与官方 store 形状一致：`init` 返回初始 state，`actions` 以
     `(draft, ...args)` 就地改 draft。区别仅是官方额外传 `persist` 键，
     wallpaper 的 store 由 settingsScope 镜像驱动、无需持久化，不传正确。
3. **结论：client.js 改法在 0.1.5 下正确，无需再改。**

## 验证输出

```
$ node --check lib/index.js && node --check lib/client.js
index.js syntax OK
client.js syntax OK

$ cd /home/CNS2026495165/.dsh/profiles/web2 && node --input-type=module \
    -e "await import('file:///.../lib/index.js').then(()=>console.log('import OK'))"
import OK
```

- 宿主 import 冒烟为**解析 + 顶层执行**双重通过：0.1.5 下模块可解析
  （不再有缺失导出），顶层无业务副作用（`apply()` 未调用，
  ensureMediaRoot/register/webServer 只在 apply 内执行），因此 import OK
  即确认解析层已修复；注册与路由副作用留待 web2 实际启动时生效。

## 遗留风险

1. **仅做了宿主 import 冒烟**：`register` 在真实 `ctx.inject(["settings"])`
   生命周期内的行为（含存量 section 校验）需在 web2 启动后确认
   （启动日志应出现 wallpaper 命名空间注册成功，无
   `settings namespace ... is already registered` 或 schema 校验报错）。
2. **客户端为静态核验**：`defineStore` 虚拟模块的真实解析只能由浏览器端
   bundle 加载验证；本机无浏览器自动化，若 0.1.5 的虚拟模块实现有
   init/actions 之外的隐式约束，需在 web2 GUI 中打开设置页观察壁纸面板。
3. **共享层副本未动**（`profiles/node_modules/@local/dsh-wallpaper` 仍为
   0.1.1 写法，仅供线上旧服务使用）；若未来旧服务下线，可考虑把新副本
   回灌共享层，但**不要**在本任务范围内做。
4. 插件 `package.json` 的 peerDependencies 仍写
   `"@deepseek-ai/dsh-settings": ">=0.1.1-rc.2 <0.2.0"`、`dsh-client-store` 同
   范围——0.1.5 落在该范围内，无需改；若后续 0.2.0 破坏兼容再收紧。
