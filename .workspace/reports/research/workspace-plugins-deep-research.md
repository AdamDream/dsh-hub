# DSH 插件深调研（第二轮）：dsh-workspace-enhancement / dsh-remote 及其家族 —— 面向「远程主机 + Linux SoC 嵌入式」

- 调研日期：2026-09-14（全部联网查询、registry 实测、tarball 源码核验当日完成）
- 调研方式：npm registry 直查（`registry.npmjs.org/<name>`、`/-/v1/search`）+ 8 个关键包 **tarball 下载展开源码级核验** + 本部署（DSH 0.1.1-rc.2）**机制级只读核查** + semver 7.8.5 实机测试 + 3 路 subagent 并行深挖（`dsh-remote` 依赖链 / `dsh-workspace-enhancement` / 全家族全景）。
- 目标部署：`@deepseek-ai/dsh` **0.1.1-rc.2**，`@deepseek-ai/cordis` **4.0.2**，node v22.23.2，profile `web`（`~/.dsh/profiles/web/`，`nodeLinker: hoisted` + `autoInstallPeers: false`）。
- 约束遵守：全程只读 + 联网；npm 缓存目录只读，改走 `npm_config_cache=/home/CNS2026495165/dsh/.workspace/npm-cache`；未使用 sandbox_permissions。
- 产物：本文 + 三份子报告（`research/family-panorama.md`、`research/audit-dsh-remote.md`、`research/audit-workspace-enhancement.md`）+ 机制核查 `research/local-facts.md`。

---

## 0. TL;DR（结论式摘要，含对上轮的 3 处重要修正）

1. **【修正 1 · semver】上一轮「peer ^0.1.0-rc.6 ✓ 本部署」的系统性判定是错的。** 用本机 DSH 自带的 semver 7.8.5 实测：`0.1.1-rc.2` **不满足** `^0.1.0-rc.6`、`^0.1.0-rc.8`、`^0.1.2-rc.1`、`^0.1.5-rc.1`，甚至不满足 `*`（npm 预发布规则：范围里必须有**同一 [major,minor,patch] 元组**的预发布比较器；`^0.1.1-rc.2` / `>=0.1.1-rc.2 <0.2.0` 才满足）。**但**本部署 profile 显式配置 `autoInstallPeers: false` + `nodeLinker: hoisted`，且 `dsh plugin` 只是 pnpm 薄转发器（`dsh/lib/plugin-9h8shc4d.js`，DSH 自身零 peer 校验）→ **peer 越界在本部署只是 pnpm 警告，不阻断安装**。真正的准入门槛是**运行期 API 是否存在**——本轮对每个候选做了逐符号核验（见 §4/§5）。
2. **【修正 2 · slots/primitives】两个包的悬空软链「不补也能跑」，且 npm 上 0.1.1-rc.2 版本存在、可装。** 源码级证据：`dsh-client-modules/lib/index.js` 只对 **cordis loader entry 的名字**做 `require.resolve`（失败→静默跳过该行，不阻断启动），`dsh.client.inject` 只透传浏览器；浏览器端由 web shell 内置**平台种子表**提供 `@deepseek-ai/dsh-client-ui-slots`/`-primitives`（`dsh-web-frontend/dist/assets/index-*.js` 中 `function Jd(){return{...,"@deepseek-ai/dsh-client-ui-slots":…,"@deepseek-ai/dsh-client-ui-primitives":…}}`）。任何插件 client bundle 在浏览器里 `require()` 它们都能命中种子表，**与 node_modules 无关**。只有插件把这两个包名**自己当作 cordis entry**（极罕见）才需要磁盘副本。registry 实测：两包都有 **0.1.1-rc.2**（2026-08-21 发布，MIT），但 `latest` dist-tag 停在 0.0.1-rc.1（BSD-3-Clause）→ 要装必须显式 `@0.1.1-rc.2`。
3. **【修正 3 · dsh-remote 版本线】dsh-remote 存在「rc.2 时代的无 better-sidebar 版本线」。** 0.7.2 之前（0.5.0–0.7.1）**不依赖** `dsh-better-sidebar`；0.7.2–0.8.14 依赖 `^0.14.0`（其 host 半只 import dsh-settings/dsh-tools，**rc.2 全有**）；0.8.15 升到 `^0.18.1` → 其 `lib/index.js:16` 静态 `import { SessionLogOffset } from "@deepseek-ai/dsh-session"`，而 rc.2 的 dsh-session **26 个导出里没有它**（实测）→ **整个插件树加载失败**（项目 README 自述：0.8.15+ 内嵌侧栏要求 dsh ≥ 0.1.2-rc.1）。**落地路径：0.8.15 + `overrides: dsh-better-sidebar: 0.18.0`（0.18.0 是唯一不含 SessionLogOffset 且其余 4 个导入在 rc.2 全存在的版本），或直接降 0.8.14，均零源码改动。**
4. **dsh-workspace-enhancement：0.1.2 是 rc.2 的正解版本（<50 行即可装）；0.1.4 反而需要 200–500 行 backport。** 核验：npm 0.1.0–0.1.4 五版里，**0.1.1 / 0.1.2 就是面向 rc.2 家族发布的**（0.1.2 的 13 个 `@deepseek-ai` deps 全部 `^0.1.1-rc.2`，与本机同 tuple 天然满足）。**0.1.2/0.1.3 的源码接缝逐项对上 rc.2**：host 用 `rpc.handle('/dsw')`（rc.2 存在）、client 用 `ctx.workspaces.listDirectory`（rc.2 官方 browse picker 正是此 API）、5 个目标 slot 在 rc.2 的 48 条 slot 目录里全部存在、`systemPrompt.section/context` / `setSandboxMode` / `session/created` / `assembleContextFor(scope=agent)` 逐一核对存在；静态 import 的 18 个 `@deepseek-ai/*` 符号在 rc.2 全部存在；client inject 的 6 个包（connection/locale/runtime/conversation/sidebar/workspace）**全部已装**。唯一安装拦点 = 2 个 peer `^0.1.0-rc.6`（按 §1.1 仅警告）。→ **装 `dsh-workspace-enhancement@0.1.2` 基线：改动面 <50 行（2 行 peer 放宽 + 少量类型修正），无架构改动**。**0.1.4 不可在 rc.2 跑**（硬依赖 rc.2 不存在的 `ctx.connection.fetch.register`——rc.2 只有 handle/intercept 且 `intercept('/api')` 被 dsh-api-gateway 单占位；client `uiWorkspace` 服务 rc.2 全库零命中）→ backport 约 200–500 行（通道换轨回 `/dsw` + 本地目录 API 回退 + peer 13 项放宽）。
5. **推荐结论（任务 #5）**：**「底座（现成插件）+ 自研 SoC 薄插件」** 是正解，但「底座」本身要选对：
   - **远程主机底座首选 `@dsh-ssh/dsh-ssh@0.1.3`（MIT）**：peer 9 个包在 rc.2 全部存在（client-ui-primitives 为浏览器种子词无需磁盘包）、host 只 import cordis/dsh-fs/dsh-sandbox/dsh-shell/dsh-tools、`engines.node>=22` ✓、纯官方公开契约、不改 core。语义即「把 DSH 工作区放到远端」（bash/read/write/edit/read_image/glob/grep 七工具远端执行 + 后台任务远端化 + TOFU + 断线重连 + 原子写）。
   - **工具面最广备选 `dsh-remote@0.8.14`（或 0.8.15+override better-sidebar 0.18.0，MIT）**：21 个 `rw_*` 工具 + 双向 SFTP 镜像同步 + 本地/反向端口转发 + OS 钥匙串 + TOFU；host 半只 import dsh-tools + schemastery。
   - **SoC 面必须自研（已证实全家族空白）**：串口仅 3 候选且无一能在 rc.2 顺畅（最强 `@infinitepersistence/dsh-serial-console` 的 peer 显式 `<0.1.0` 排除 rc.2，且 `serialport` 只在其 devDependencies —— 发布物漏带，需手工补装）；**烧录（esptool/openocd/dfu/rockusb/uuu/fastboot）0 个**；**交叉编译 0 个**；调试仅通用 DAP 路径（`@hy-sde-org/dsh-dap`，peer ^0.1.2-rc.1 不合 rc.2）。薄插件规模估计：串口工具组 ~150–300 行 host + 可选 xterm 面板 ~200–400 行；烧录封装 ~200–400 行。
   - **不建议**：「直接装某个现成插件就完事」——没有任何一个现成插件覆盖串口+烧录+交叉编译；把多个插件拼起来又会互相抢侧栏/设置命名空间。

---

## 1. 本部署机制真相（本轮 3 项实测，纠正上轮判定基础）

### 1.1 `dsh plugin` = pnpm 薄转发器，DSH 不校验 peer
- 证据：`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/lib/plugin-9h8shc4d.js` 全文（59 行）—— `runPlugin()` 直接 `spawnSync("pnpm", args, {cwd: profileDir})`，装完只做 `reconcilePlugins()`（把声明了 `dsh.bundle.patch` 的依赖加入 `dsh.profile.bundles` 层栈）。lib 目录 grep `peerDependencies` **零命中**。
- profile 配置：`~/.dsh/profiles/web/pnpm-workspace.yaml` = `nodeLinker: hoisted` + **`autoInstallPeers: false`**；pnpm 默认 `strict-peer-dependencies=false` → **peer 版本不满足 = 警告，安装照常成功**。
- ⇒ **「peer 越界 ⇒ 不能用」必须改写为「peer 越界 ⇒ 无版本契约保护，需逐 API 核验」**。上轮兼容矩阵里所有「✓ peer 兼容」条目（如 @dsh-ssh/dsh-ssh）按 semver 其实不成立，但按本部署安装语义依然成立——只是理由不同。

### 1.2 semver 预发布规则实测（semver 7.8.5，npm 同源）
```
0.1.1-rc.2  ^0.1.0-rc.6       NOT satisfied   ← 上轮「✓」的地方
0.1.1-rc.2  ^0.1.0-rc.8       NOT satisfied
0.1.1-rc.2  ^0.1.1-rc.1       SATISFIED
0.1.1-rc.2  ^0.1.1-rc.2       SATISFIED
0.1.1-rc.2  ^0.1.2-rc.1       NOT satisfied
0.1.1-rc.2  ^0.1.5-rc.1       NOT satisfied
0.1.1-rc.2  >=0.1.1-rc.2 <0.2.0  SATISFIED
0.1.1-rc.2  >=0.1.0-rc.6 <0.2.0  NOT satisfied
0.1.1-rc.2  ^0.1.0            NOT satisfied
0.1.1-rc.2  *                 NOT satisfied
4.0.2       ^4.0.1            SATISFIED
3.18.2      ^3.18.1           SATISFIED
intersects('^0.1.0-rc.6','0.1.1-rc.2') = false
```
- **推论**：整个第三方家族「peer 满足 rc.2」的只有三种写法：`^0.1.1-rc.x`（@captain1275/dsh-ssh、dsh-workbench-ecs）、`*` 通配（dsh-remote-ssh@0.2.4）、无 peer（dsh-ssh-ops 等）。其余（0.1.0-rc.x / 0.1.2-rc.x / 0.1.5-rc.x 线）全部在纸面上不满足——但按 §1.1 仅警告。

### 1.3 client 模块机制：slots/primitives 是「平台种子词」，不是磁盘依赖
- `dsh-client-modules` host 半（`lib/index.js:274-276,377-404,429`）：`createRequire(ctx.baseUrl)` + 只对 **loader entry 名** `require.resolve('<name>/package.json')`；失败 → `resolveMeta` 返回 null → `processOne` **静默跳过该行**（客户端 UI 不出现，不阻断启动）。`dsh.client.inject` 只作为元数据进入 graph row（`graphRow` 第 157 行），host 不解析。
- 浏览器半（`lib/client.js:259`）：`require("<spec>") missed the module table — not a platform seed word, not a materialized module, and no registered package factory` → 说明存在**平台种子词**机制。
- web shell（`dsh-web-frontend/dist/assets/index-ClqxG24t.js`，399KB）内嵌种子表：
  ```js
  function Jd(){return{react:…,"react/jsx-runtime":…,"react-dom":…,"react-dom/client":…,"@deepseek-ai/cordis":…,"@deepseek-ai/dsh-client-ui-slots":g6,"@deepseek-ai/dsh-client-ui-primitives":Kd}}
  ```
  （该文件里两个包名各只出现 1 次，即此表；shell 自身不 `__ModuleLoader__.load` 任何模块。）
- 对照实例：本地插件 `dsh-btw` 的 `lib/client.js:9` 真实 `require("@deepseek-ai/dsh-client-ui-primitives")`，运行期由种子表解析；其自带 `dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-primitives@0.1.1-rc.2`（真实目录）只为 **TypeScript 构建期类型**。

### 1.4 悬空软链数量与性质
- `~/.dsh/profiles/node_modules/@deepseek-ai/` 共 252 项，**52 项悬空**（200 项真实指向 bundled dsh node_modules）。悬空名单含 `dsh-client-ui-slots`、`dsh-client-ui-primitives`、**`dsh-client-ui-sidebar-right`**、`dsh-client-ui-chat`、`dsh-acp`、`dsh-sdk-*`、`dsh-session-format-*`、`dsh-util-*`、`dsh-webhook*`、`dsh-hooks-*`、`node-addon-system` 等 —— **这批名字是「另一条 DSH 版本线（已清理的 npx 缓存）」的指纹**，0.1.1-rc.2 打包树里没有它们。
- `dsh-client-ui-sidebar-right` 是 **0.1.5 线才有的包**（首版 0.1.5-alpha.1，2026-09-08）→ `dsh-better-sidebar@0.19.x` 需要它，**rc.2 上结构性不可能**（除非跨线 sidecar）。

---

## 2. 家族全景对比表（§ 表 1：远程主机/SSH 候选，按 rc.2 可用度排序）

> 版本/时间/license 均为 2026-09-14 registry 实测；「rc.2 判定」按 §1.1（安装语义：peer 只是警告）＋ §4/§5（运行期 API 逐符号核验）。☆=本轮重点。

| 包名（作者） | 最新版 | 时间 | license | peer 关键约束（相对 rc.2） | 客户端注入需求 | 串口/烧录/交叉编译 | rc.2 判定 | 来源 |
|---|---|---|---|---|---|---|---|---|
| **`@dsh-ssh/dsh-ssh`**（org）☆ | 0.1.3 | 2026-08-21 | MIT | 9 项 peer 全 `^0.1.0-rc.6`（纸面不合，警告级）；**包全部在本机存在** | primitives（浏览器种子词✓） | 无 | ✅ **首选底座**：API 全在 | [npm](https://www.npmjs.com/package/@dsh-ssh/dsh-ssh) [repo](https://github.com/dsh-ssh/dsh-ssh) |
| **`dsh-remote`**（flymysql）☆ | 0.8.15 | 2026-09-12 | MIT | `^0.1.0-rc.6` 一批 + **`^0.1.2-rc.1`**（locale/renderer） | renderer/locale（已装✓） | 无 | ⚠️ 0.8.15 直装**必挂**（better-sidebar 0.18.1 的 SessionLogOffset）；**0.8.14 可装**；0.8.15+override 0.18.0 可装 | [npm](https://www.npmjs.com/package/dsh-remote) [repo](https://github.com/flymysql/dsh-remote) |
| **`dsh-workspace-enhancement`**（DobyChao）☆ | 0.1.4（**0.1.2 即 rc.2 线**） | 0.1.2=2026-08-31 | MIT | 0.1.2：deps 全 `^0.1.1-rc.2`（满足），peers `^0.1.0-rc.6`×2（仅警告） | connection/locale/runtime/conversation/sidebar/workspace（**全已装**） | 无 | ✅ **0.1.2/0.1.3 接缝全对上 rc.2（<50 行放宽）**；❌ 0.1.4 硬依赖 rc.2 缺的 `fetch.register`/`uiWorkspace`（200–500 行 backport） | [npm](https://www.npmjs.com/package/dsh-workspace-enhancement) [repo](https://github.com/DobyChao/dsh-workspace-enhancement) |
| **`@captain1275/dsh-ssh`** | 0.3.1 | 2026-08-22 | Apache-2.0 | **peer 全 `^0.1.1-rc.2`（rc.2 唯一显式命中）** | **slots `^0.1.1-rc.2`**（磁盘缺，种子词可解；类型构建需补装） | 无 | ✅ 纸面命中；⚠️ 停更（上游已 0.3.22，落后 20 版）；linxin666 代码 fork | [npm](https://www.npmjs.com/package/@captain1275/dsh-ssh) [repo](https://github.com/CAPTAIN1275/dsh-ui-web) |
| `dsh-remote-ssh`（Yan-Zero） | 0.2.4 | 2026-08-15 | Apache-2.0 | 官方包 peer 全 `*`（通配放行） | 无 | 无 | ⚠️ 可装但**放弃版本适配**，缝接口漂移运行时才炸 | [npm](https://www.npmjs.com/package/dsh-remote-ssh) [repo](https://github.com/Yan-Zero/dsh-remote-ssh) |
| `dsh-workbench-ecs`（nishuoyang） | 0.6.7 | 2026-09-12 | MIT | `dsh-tools ^0.1.1-rc.2`（**命中**） | 无 | 无 | ✅ 纸面命中（阿里云 Workbench CLI，非裸 SSH） | [npm](https://www.npmjs.com/package/dsh-workbench-ecs) |
| `dsh-ssh-ops`（caoyiwei850） | 0.3.5 | 2026-09-13 | MIT | **`{}` 无 peer** | client-runtime（已装✓） | 无 | ⚠️ 可装；deps 带 pg/mysql2/redis/mongodb 一堆数据库驱动（体积/攻击面）；右侧终端+SFTP+端口转发+DB 面板 | [npm](https://www.npmjs.com/package/dsh-ssh-ops) [repo](https://github.com/caoyiwei850/dsh-ssh-ops) |
| `@zhangfengshun/dsh-remote-ssh` | 2.4.4 | 2026-09-12 | MIT | `^0.1.0-rc.6`（locale/primitives/tools） | primitives（种子词✓） | 无 | ⚠️ 纸面不合（警告级）；类 VSCode Remote-SSH，51 版最活跃之一 | [npm](https://www.npmjs.com/package/@zhangfengshun/dsh-remote-ssh) [repo](https://github.com/ZhangFengshun/dsh-remote-ssh) |
| `@linxin666/dsh-ssh` | 0.3.22 | 2026-09-13 | Apache-2.0 | 仅 react/react-dom | locale/renderer/settings | 无 | ❌ **自设硬门槛 `dsh.engines.dsh >= 0.1.5-rc.1`** | [npm](https://www.npmjs.com/package/@linxin666/dsh-ssh) [repo](https://github.com/zhu1090093659/dsh-web) |
| `dsh-plugin-ssh`（techflag） | 0.1.0 | 2026-09-09 | MIT | `^0.1.2-rc.1 \|\| ^0.1.3-alpha.2` | 无 | 无 | ❌ 0.1.2+ 线 | [npm](https://www.npmjs.com/package/dsh-plugin-ssh) [repo](https://github.com/techflag/dsh-plugin-ssh) |
| `dsh-ssh`（UynajGI） | 0.3.0-pre | 2026-08-16 | MIT | **官方缝包写进 dependencies**（非 peer）`^0.1.0-rc.6` | 无 | 无 | ❌ 双实例风险（会装第二份 dsh-fs/subprocess）+ pre-release | [npm](https://www.npmjs.com/package/dsh-ssh) [repo](https://github.com/UynajGI/dsh-ssh) |
| `dsh-better-sidebar`（omdsh-dev） | 0.19.1 | 2026-09-11 | MIT | 0.18.1+ 需 `^0.1.2-rc.1` / 0.19.x 需 `^0.1.5-rc.1` | slots/primitives/conversation（种子词） | 无 | ⚠️ 仅 **0.14.0/0.18.0** 两个甜点版本可配 rc.2（host 只 import settings/tools） | [npm](https://www.npmjs.com/package/dsh-better-sidebar) [repo](https://github.com/omdsh-dev/DSH-better-sidebar) |
| `@hyzyn/dsh-tty` | 0.17.0 | 2026-09-13 | Apache-2.0 | `dsh-tools ^0.1.2-rc.1` | 无 | 无 | ❌ 0.1.2+ 线（Web 终端面板 + SSH 直连 + tmux） | [npm](https://www.npmjs.com/package/@hyzyn/dsh-tty) |
| `dsh-remote-plugin`（Blank-not-black） | 0.6.24 | 2026-09-05 | MIT | `{}` | **slots**（inject 无版本） | 无 | ⚠️ 可装；**「手机远程控制 DSH」≠「DSH 开发远程主机」**（需求方向相反，极易混淆） | [npm](https://www.npmjs.com/package/dsh-remote-plugin) [repo](https://github.com/Blank-not-black/dsh-Remote) |
| `@unieai/uad-remote-machine` | 0.1.21 | 2026-08-31 | MIT | `@unieai/uad-*` + `@unieai/cordis`（**私有 fork 命名空间**） | 无 | 无 | ❌ 非 `@deepseek-ai/*`，不可混用 | [npm](https://www.npmjs.com/package/@unieai/uad-remote-machine) |
| `@elinpf/dsh-ops` 套件（19 包） | 0.3.0 | 2026-09-14 | npm 声明 MIT，**仓库无 LICENSE 文件（404 已核实）** | 子包 `^0.1.0-rc.8` | 独立 client 包 | 无 | ⚠️ 聚合装会连带 rc.8 peer；`ops-tool-ssh` 单装无冲突 | [npm](https://www.npmjs.com/package/@elinpf/dsh-ops) [repo](https://github.com/Elinpf/dsh-ops-plugins) |

## 3. 专项表（§ 表 2：串口 / 嵌入式 / 调试 / 烧录）

| 包名 | 最新版 | license | 能力 | rc.2 判定 | 备注 |
|---|---|---|---|---|---|
| `@infinitepersistence/dsh-serial-console` | 0.1.0-rc.4（`latest` 却停在 alpha.1！） | MIT | **功能最强串口**：浏览器 xterm VT 终端 + 人机共享会话 + HEX 视图 + 审计导出 + 7 个 `serial_*` 工具 | ❌ peer `dsh-tools >=0.0.1-rc.1 <0.1.0` **显式排除 0.1.x**；且 **`serialport` 只在其 devDependencies（发布物漏带）**——装了还要手工 `pnpm add serialport` | 需改 peer 范围 + 补 serialport；`dsh-typert-protocol` 的 `Remote`/`TypertRemoteService` rc.2 **有**（逐符号核验） |
| `dsh-serial`（hgy043） | 0.1.0 | MIT | pyserial 脚本驱动，4 工具（scan/send/monitor/log），零原生依赖，README 点名适合「刷机命令发送」 | ⚠️ 无 peer 可装；完全不引用任何 `@deepseek-ai/*`（工具注册 API 漂移风险自担） | 需 Python3 + `pip install pyserial`；npm repository=null |
| `LTY-lty666/dsh-serial`（GitHub only） | 0.1.0 | MIT | Node `serialport` 6 工具，**peer 恰好钉 `dsh-tools 0.1.1-rc.2`** | ✅ 理论命中，**未发布 npm**（名被 hgy043 占） | 源码安装的唯一「peer 恰合 rc.2」的 Node 串口插件 |
| `dsh-embedded-workbench` | 0.8.9 | MIT | Keil MDK/ARMCLANG 技能 + 4 代理，**纯知识层，不调工具链二进制** | ❌ `^0.1.0-rc.6/rc.8` | 交叉编译的「流程文本」可参考，工具链仍需 bash 执行 |
| `@hy-sde-org/dsh-dap` + `dsh-tool-debug` | 0.1.2-rc.1 | MIT | 通用 **DAP 调试**（28 操作：launch/attach/断点/栈帧/变量/反汇编/内存）可接 GDB | ❌ `^0.1.2-rc.1` | 无 OpenOCD/JTAG 专属集成 |
| `dsh-adb` | 1.7.0 | MIT | ADB 设备运维（logcat/apk/push-pull/性能） | ⚠️ 无 peer 可装；**不含 fastboot 烧录** | npm repository=null，审计盲区 |
| `dsh-hdc-bridge` | 0.9.1 | MIT | 鸿蒙 hdc 设备调试 | ⚠️ 零依赖可装 | 非 Linux SoC |
| `dsh-embedded` / `dsh-ssh-tui` 等 | — | — | 占名包 / 「适合在 SSH 会话里跑的 TUI」（语义陷阱） | — | — |

---

## 4. dsh-workspace-enhancement 深挖（任务 #1）

### 4.1 仓库/包来源与版本线
- npm `dsh-workspace-enhancement`，5 版：0.1.0(08-26)→0.1.1(08-28)→**0.1.2(08-31)**→0.1.3(09-09)→0.1.4(09-13)，全部 MIT，repo [DobyChao/dsh-workspace-enhancement](https://github.com/DobyChao/dsh-workspace-enhancement)。tarball 内 LICENSE 存在（MIT）。
- **peer/依赖随版本迁移**（registry 实测）：
  | 版 | peers | deps（@deepseek-ai 部分） |
  |---|---|---|
  | 0.1.0/0.1.1 | dsh-tools `^0.1.0-rc.6`、dsh-system-prompt `^0.1.0-rc.6` | dsh-fs `^0.1.0-rc.6`、dsh-sandbox/dsh-fs-local/dsh-fs-sandbox/dsh-sandbox-policy/dsh-subprocess-local `^0.1.1-rc.2`、dsh-llm（0.1.1 精确钉 `0.1.1-rc.1`）、dsh-timeout/subprocess/host-directory-picker(-native) `^0.1.0-rc.6` |
  | **0.1.2** | 同 0.1.1 | **全 `^0.1.1-rc.2`**（fs/llm/sandbox/timeout/subprocess/sandbox-policy/subprocess-local/fs-local/fs-sandbox）+ picker `^0.1.0-rc.6` |
  | 0.1.3 | cordis `^4.0.2` + 13 项 `^0.1.2-rc.1` + schemastery `^3.18.2` | 仅 ssh2 |
  | 0.1.4 | 15 项 `^0.1.5-rc.1` | 仅 ssh2 |
- **「上轮所称 0.1.1 版」核实**：存在，且 **0.1.2 是更干净的 rc.2 目标版**（0.1.1 把 dsh-llm 精确钉到 0.1.1-rc.1，安装解析略麻烦）。两者即「npm 上曾经面向 rc.2 家族发布过」的证据。

### 4.2 功能面（它到底增强什么）
README 与源码（`lib/` 15 个模块；subagent 审计含全部文件:行号证据）：
- **SSH 远程开发 + 多工作区**：5 个模型工具 —— `sw_status` / `sw_connect` / `sw_pick_workspace` / `sw_exec` /（win32 专用）`bash`（定义于 src/tools.ts:434/472/536，注册于 src/tools.ts:573 + src/exec-tools.ts:1042/1228）；机器清单 + TOFU 主机密钥 + keychain 密码存 `~/.dsh`；
- **缝替换引擎**（核心卖点）：src/plugin.ts:98-151 把官方 `ctx.subprocess`/`ctx.fs` 换成 本地↔SSH 混合 provider（Mixed 实现，按 cwd 前缀路由远端）——**已经用 `ctx.subprocess`/`ctx.fs` 的工具无需改代码即可远程工作**（本地大脑、远端手脚，远端零装 DSH）；ssh2 是核心引擎：ProxyJump 多跳链 + SFTP 全操作 + exec + PTY（端口转发明确延后，ADR-0005）；
- **审批门**：`ctx.approval` 三态（off/human/ai，AI 白名单只读自动放权）；**bwrap 远端沙箱 runner**（fail-closed）；OS 钥匙串存密钥 + 凭据红线。
- **不是**「终端面板/文件管理器 UI 的增强」——它是**执行缝增强**。

### 4.3 架构（host 工具 / client 注入 / slot）
- host：bundle 型（`cordis.patch.yml` 插入 `ssh-remote` 聚合行 + 禁用的本地 provider 行 + picker 行），Service 继承自 cordis，依赖注入 `sandboxPolicy`。
- client：`dsh.client.inject = [connection, locale, runtime, client-ui-conversation, client-ui-sidebar, client-ui-workspace]`（**全部 6 个包在本机 0.1.1-rc.2 已装**）+ **5 个 slot 注册**（src/client/index.ts:201-241，含 `REMOTE_STATUS_SLOT` src/client/remote-status.ts:44）—— 5 个目标 slot 在 rc.2 的 48 条 slot 目录里**全部存在**。**不需要 slots/primitives 磁盘包**（种子词机制，§1.3）。

### 4.4 移植到本部署 0.1.1-rc.2 的具体改动面（API 差异清单）
**逐符号核验**：静态 import 的 18 个 `@deepseek-ai/*` 符号（dsh-tools 的 `defineTool`/`TOOL_ABORTED`/`parameterSchemaSpecToJsonSchema`、dsh-fs 的 `FileSystem`/`FsError`/`FsTargetKey`/`FsVersion`、dsh-llm 的 `HarnessError`、dsh-subprocess 的 `SubprocessRuntime`/`SENSITIVE_ENV_PATTERN`、dsh-sandbox-policy 的 `setSandboxMode`、dsh-subprocess-local 的 `LocalSubprocessRuntime`、dsh-fs-local 的 `LocalFileSystem`、dsh-fs-sandbox 的 `SandboxedFileSystem`、dsh-host-directory-picker 的 `DirectoryPicker`/`DirectoryPickerError`、dsh-host-directory-picker-native 的 `pickNativeDirectory`）**18/18 在 rc.2 存在**；运行期服务 `rpc.handle('/dsw')`、`ctx.workspaces.listDirectory`、`systemPrompt.section/context`、`setSandboxMode`、`session/created`、`assembleContextFor(scope=agent)` **逐一核对存在**；client 引用模块（api-gateway/client-file-upload/client-ui-conversation/dsh-jobs/dsh-tool-jobs/client-connection/client-ui-directory-picker-browse/client-ui-workspace）全部存在；cordis `Service` ✓。
- **基线推荐：0.1.2（或 0.1.3）→ 改动面 <50 行**：放宽 2 行 peer（`^0.1.0-rc.6` → `^0.1.1-rc.2`，或依赖 autoInstallPeers:false 的警告语义不动）+ 少量类型修正；**无架构改动**。装后必须真 boot 冒烟（作者 F1 教训：typecheck 全绿 ≠ 能启动）。
- **0.1.4 → 200–500 行 backport**：`ctx.connection.fetch.register`（rc.2 无 fetch，仅 handle/intercept，且 `intercept('/api')` 被 dsh-api-gateway 单占位）→ 通道换轨回 `/dsw`；client `uiWorkspace` 服务（rc.2 全库零命中）→ 回退到 `ctx.workspaces.listDirectory`；peer 13 项放宽。**不建议**（收益仅 cockpit 面板）。
- 风险：MIT 与仓库一致（版权归 dsh-ssh contributors）；**作者 2026-09-11 单方面退出 0.1.2 家族（0.1.3/0.1.4 跳线到 0.1.2-rc.1/0.1.5-rc.1）→ 0.1.2 是无人维护的「历史正确版」**；不侵入核心（仅标准 cordis patch 禁用官方 3 行）。

---

## 5. dsh-remote（flymysql）深挖（任务 #2）

### 5.1 它是什么
SSH 远程运维 + 远程工作区接入二合一（**不是**远程 DSH 节点、**不是**移动端控制台）。功能清单（子报告 audit-dsh-remote.md 逐条带行号）：
- **host 工具 20 个 `rw_*`**：`rw_info/rw_connect/rw_pick_workspace/rw_list_dir/rw_read_file/rw_write_file/rw_exec/rw_search/rw_download/rw_upload/rw_sync/rw_push/rw_disconnect` 等（注册于 lib/index.js:1483-2200）；
- 斜杠命令 3 个 + HTTP 路由 25 条（挂 host-webserver，lib/index.js:3266）+ 前端注入 Settings 页 + 2 个 directoryFlow 目录选择器插槽 + 可选 better-sidebar 远程文件树；
- 认证：密码/私钥/agent/keyboard-interactive/ProxyJump；TOFU 主机指纹；OS 钥匙串；`$DSH_HOME/remote-workspaces` 本地镜像 + **双向增量 SFTP 同步**（rw_sync/rw_push，size+mtime 跳过，单文件上限）；
- 本地 + 反向端口转发；Windows 主机 Git Bash 支持；跨平台 POSIX 命令。
- **无串口 / 烧录 / 交叉编译能力**；exec 非流式、无长驻 PTY 会话（嵌入式交互场景受限）；老 SoC 算法协商不可调（ssh2 无 algorithms 配置面）。

### 5.2 硬依赖核实
- `dsh-better-sidebar` 在 **dependencies（运行时硬依赖）**，且 `cordis.patch.yml:33-38` 以**独立 bundle 行**（id=`dsh-remote-sidebar`）挂载它（带防重复挂载守卫）。
- **代码层其实可选**：`lib/client.js:1909` `ctx.get('betterSidebar')||null`、`lib/client.js:1983` `ctx.inject(['betterSidebar'],…)`、`lib/client.js:1929/1950` try/catch+warn —— 三重守卫，**删依赖不需要改 lib/ 一行**。
- 版本线（registry 全量 53 版核对）：**0.7.2 引入** `dsh-better-sidebar@^0.14.0`；**0.8.15 升 `^0.18.1`**。
- peer 无任何版本覆盖 0.1.1-rc.2（`^0.1.0-rc.6` 一批 + `^0.1.2-rc.1` 两个）——按 §1.1 仅警告。

### 5.3 能否降级/去依赖适配 rc.2（源码级证据）
- **为什么 0.8.15 直装必挂**：`dsh-better-sidebar@0.18.1/lib/index.js:16` 静态 `import { SessionLogOffset } from "@deepseek-ai/dsh-session"`；rc.2 dsh-session **26 个导出无此符号**（实测）→ ESM 链接期硬失败 → **整个插件树加载失败**（项目自身 A/B 实测表：0.1.0-rc.8 + 0.8.15 + sidebar 0.18.1 = 启动失败）。
- **三条零源码改动落地路径**（按优先级）：
  1. **方案 A（推荐）**：0.8.15 + profile 加 `pnpm.overrides: { "dsh-better-sidebar": "0.18.0" }`。核验：bs-0.18.0 host 只 import `SettingsConflictError/defineTool/createUserMessage/snapshotSubagentDescriptor` 4 个符号，**rc.2 全部存在**，且无 SessionLogOffset。
  2. **方案 B（最保守）**：降 **0.8.14**（dep `^0.14.0` → 0.14.0；其 host 只 import dsh-settings/dsh-tools，rc.2 全有；`settingsNamespace` rc.2 仍在）。代价：丢 0.8.15 的 issue #30 修复。
  3. **方案 C（保底）**：0.8.15 + `cordis.patch.yml` 给 `dsh-remote-sidebar` 行加 `disabled: true`（保留 20 个 host 工具，放弃侧栏文件树）。
- 均**未实机启动验证**（本次只读范围）；列为装后验证项。

### 5.4 代码结构（哪些层触碰 DSH 核心）
- lib/ 仅 2 处 `@deepseek-ai/*` import：`lib/index.js:21-22`（schemastery + `defineTool`）→ **不 patch 核心、不用私有 API、不改 dsh-workspace**（README 明示）。分层表见子报告 §5.2（14 个模块逐一 vs rc.2 符号）。
- 发布物 = 源码（tarball 与 git tag v0.8.15 sha256 一致，子报告 §1.2）。
- 许可证：全 MIT 🟢；维护极活跃（29 天 53 版）🟢；侵入极低 🟢；`/dsh-remote/*` 路由无独立鉴权（靠 127.0.0.1）🟡。

### 5.5 与其它 dsh-remote 家族区分（防买错）
- npm `dsh-remote`（flymysql，0.8.15）≠ npm `dsh-remote-plugin`（Blank-not-black/dsh-Remote，0.6.24，「手机远程控制 DSH」）≠ GitHub-only `weisiren000/dsh-remote-ssh-ops`（三层 plugin/controller/hostd，无 LICENSE）≠ npm `@zhangfengshun/dsh-remote-ssh`（2.4.4，VSCode-Remote-SSH 式）≠ npm `dsh-remote-ssh`（Yan-Zero，0.2.4，缝替换）。全景报告 §6 有 7 组同名冲突完整对应表。

---

## 6. 家族全景（任务 #3）要点补充

子报告 `family-panorama.md` 覆盖 **26 个 npm 候选 + 11 个 GitHub-only 仓库**（共 ≥37）。除 §2/§3 表格外，本轮新发现：
1. **`@captain1275/dsh-ssh@0.3.1` 是 rc.2 唯一显式钉版**（peer 全 `^0.1.1-rc.2` 含 slots）——但它是 `@linxin666/dsh-ssh` 的 fork、2026-08-22 后停更（上游已 0.3.22，周下载 144 vs 36579）。功能同 linxin666：主机库 + 持久连接池 + exec/PTY Web 终端/SFTP/端口转发/集群执行 + `ssh_list/exec/upload/download/tunnel/cluster` 工具。密码明文存 `~/.dsh/dsh-ssh.json`（0600）——与 @dsh-ssh(org) 的 settings secret 机制相比信任模型较弱。
2. **GitHub-only 高相关**：`Yantingmo/dsh-ssh-terminal-sync`（Agent↔GUI 同屏 xterm，5 个 ssh_terminal_* 工具——对 SoC 交互场景很对口）、`hesiwen66/OctoOps`（SSH/Telnet + JumpServer 编排）、`telagod/dsh-ssh-workspace-manager`（自称含 sync）、`1692775560/dsh-Mimir-Academic-research`（370★，GPU 服务器 SSH 任务编排）、`LTY-lty666/dsh-serial`（Node serialport，peer 恰 rc.2）、`horizon105457/tsstream`（串口字节流可观测）。均未发布 npm。
3. **许可证问题**：`weisiren000/dsh-remote-ssh-ops` 与 `Elinpf/dsh-ops-plugins` **仓库无 LICENSE 文件**（raw 404 已核实；Elinpf 的 npm 包却声明 MIT——两者不一致）；`hzxwonder-dsh-plugins/dsh-plugin-ssh` 是 **LGPL-3.0-only**（与 techflag 的 MIT 同名异义）；`dsh-embedded` 占名包。
4. **客户端注入需求**：绝大多数候选要么不注入 client（纯 host），要么注入 `client-runtime`/`locale`/`renderer`/`settings`（本机全有），只有 6 个声明了 slots/primitives（§5.4 表：@captain1275=slots rc.2、@zseven-w=slots rc.6、@zhangfengshun=primitives rc.6、dsh-remote-server=两者 0.1.0-rc.6 精确、@artificialnotimbecile=slots 0.1.0-rc.8、serial-console=primitives rc.7+）——其中除 captain1275 外版本线都不合 rc.2。
5. **串口/烧录/交叉编译/调试**：见 §3 专项表与子报告 §4 缺口清单（烧录编排、工具链注入、OpenOCD 集成、增量 rsync 同步均为空白）。

---

## 7. 本部署障碍复核（任务 #4）：slots / primitives 悬空

| 问题 | 结论（源码级证据） |
|---|---|
| npm 有 0.1.1-rc.2 吗？ | **有**：两包 21 版本，0.1.1-rc.2 于 2026-08-21 发布（MIT）。`latest` dist-tag 停在 0.0.1-rc.1（BSD-3-Clause）→ **必须显式 `@0.1.1-rc.2`**，裸装会拿到最老的 rc.1 |
| 为什么本机没有？ | **正常形态**：0.1.0-rc.8 起它们被移出 `dsh-client-runtime` 的 dependencies（仅存官方 UI 包 devDependencies，构建期内联），`@deepseek-ai/dsh` 元包四代（0.1.1-rc.2→0.1.5-rc.2）dependencies 都不含它们 |
| 有没有被合并/改名？ | **没有**：独立发布到 0.1.5-rc.2，仓库目录仍是 `packages/client/ui-slots`、`ui-primitives` |
| 悬空软链要不要补？ | **客户端运行不需要**（web shell 种子表内置，§1.3）；**仅 3 种情况需要磁盘副本**：① 插件把包名当作自身 cordis entry；② 插件 host 半 import 它们；③ 本地构建/类型检查（如 dsh-btw 自带副本的用法）。**建议：保持现状，把悬空清单当「装插件前的核对清单」** |
| 若确需补齐怎么做？ | ① `cd ~/.dsh/profiles/web && pnpm add @deepseek-ai/dsh-client-ui-slots@0.1.1-rc.2 @deepseek-ai/dsh-client-ui-primitives@0.1.1-rc.2`（primitives 带 20 个依赖）；② 零网络：本机已有实物副本 `/home/CNS2026495165/dsh/dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-{slots,primitives}`（0.1.1-rc.2 原版），可 cp 覆盖软链 |
| 补齐后哪些候选变为可用？ | **技术上都已可用**（§4/§5 判定不依赖这两个包）；纸面上「peer 显式要求」的只有 `@captain1275/dsh-ssh`（slots rc.2）——补齐后其 peer 检查全绿，仅剩「停更」这一软肋 |

---

## 8. 推荐（任务 #5）：底座 + 自研 SoC 薄插件 vs 直接装现成

### 8.1 裁决：**「底座（现成插件）+ 自研 SoC 薄插件」**，且底座二选一

| 方案 | 覆盖 | 改动面估计 | 风险 |
|---|---|---|---|
| **A（推荐底座）：`@dsh-ssh/dsh-ssh@0.1.3`** | 远程主机登记 + 远端工作区 + bash/read/write/edit/read_image/glob/grep 七工具远端执行 + 后台任务远端化 + TOFU + 断线重连 + 原子写 | **0 行代码**（peer 9 包全在本机；唯一磁盘缺的 client-ui-primitives 是种子词，不需要）；验证项：dsh-shell/dsh-sandbox 运行期签名 | 🟢 MIT / 官方契约 / 不改 core；🟡 无 ProxyJump、远端仅 Linux/macOS（SoC 是 Linux ✓）；🟡 维护活跃度中等（0.1.3，08-21） |
| **B（备选底座）：`dsh-remote@0.8.14`（或 0.8.15+override better-sidebar 0.18.0）** | 21 个 rw_* 工具 + 双向 SFTP 镜像同步 + 端口转发 + TOFU + 钥匙串 + 设置页 UI | **0 行代码**（0.8.14 自带 ^0.14.0；0.8.15 需 profile `pnpm.overrides` 一行）；验证项：dsh-settings `settingsNamespace` 签名 | 🟢 MIT / 最活跃（29 天 53 版）；🟡 内嵌侧栏版本矩阵复杂（0.18.1+ 必挂）；🟡 无长驻 PTY |
| **C：`@captain1275/dsh-ssh@0.3.1`**（纸面唯一命中） | 同 linxin666 功能族（含 Web 终端） | 0 行代码 + `pnpm add @deepseek-ai/dsh-client-ui-slots@0.1.1-rc.2` | 🔴 **停更**（落后上游 20 版）；🔴 Apache-2.0 + 密码明文落盘 0600（信任模型弱）；仅作「peer 全绿强迫症」备选 |
| **D：`dsh-ssh-ops@0.3.5`**（无 peer 直接装） | 右侧交互终端 + SFTP + 端口转发 + 数据库面板 | 0 行代码 | 🟡 deps 自带 pg/mysql2/redis/mongodb 驱动（攻击面）；🟡 与底座 A/B 的侧栏/设置命名空间可能冲突 → **不要与 A/B 同装** |
| **E：自研薄插件 `dsh-workerspace`（SoC 面）** | `serial_list_ports/serial_connect/serial_send/serial_read/serial_expect/serial_mark` + 可选 xterm 面板 + 烧录模板（esptool/openocd/fastboot/rockusb/uuu 封装）+ 工具链探测/交叉编译命令模板 | host 串口工具组 ~150–300 行；xterm 面板 ~200–400 行；烧录封装 ~200–400 行（薄封装，调用系统 CLI + 进度/校验/回滚）；settings 命名空间 + credential-ref（复用 DSH 凭据槽） | 🟢 无第三方依赖（ssh2 都可不用，串口走 `serialport` 或 `stty`+pty）；🟡 需要自建安全门（命令白名单/高危确认，参考 dsh-ssh-ops 的确认模态与 weisiren000 的指纹/密钥托管） |

**组合建议**：A（或 B）+ E。A 覆盖「远程 Linux/SoC 主机日常开发」，E 覆盖「USB 串口 console + 烧录 + 交叉编译」——二者互不重叠（A 是 SSH 工作区缝，E 是 USB/工具链工具组），不抢侧栏与命名空间。

### 8.2 为什么不选「直接装一个现成插件完事」
1. **无单一现成插件覆盖三件套**（SSH 远程 + 串口 + 烧录/交叉编译）：最全的 dsh-remote 也无串口/烧录；最强的串口插件（serial-console）peer 显式排除 rc.2 且漏带 serialport；烧录/交叉编译全家族空白（§3）。
2. **多插件拼接互相踩踏**：better-sidebar 系（dsh-remote）与 sidebar 注入系（dsh-ssh-ops、@hyzyn/dsh-tty）同装会争 `/sidebar/api` 路由与设置命名空间（dsh-remote 自己的 patch 里就为此写了防重复挂载守卫）。
3. **版本线硬约束**：rc.2 上「peer 纸面命中」的候选只有 captain1275（停更）与 workbench-ecs（云 CLI），主流的 0.1.2/0.1.5 线插件要么等 DSH 升级、要么承担无版本契约的运行期漂移——把底座锁在「API 逐符号核验通过 + 无硬依赖」的 A/B 上是唯一低风险路径。

### 8.3 若要走 MCP 兜底（零插件代码）
本部署内置 `dsh-mcp-client`（stdio/streamable-http），可挂 `mcp-remote-access`（SSH+串口一体，AGPL，注意许可证）、`@yawlabs/ssh-mcp`、`jlink-mcp`/`openocd-mcp`（烧录调试）——代价：工具名带 `mcp__` 前缀、凭据经工具参数进模型上下文、60s 默认超时对烧录不够、串口只覆盖 MCP 进程本机 USB。适合「先跑通再自研」。

---

## 9. 证据与来源

**源码级证据（本机路径）**
- `research/local-facts.md` — 本部署机制核查（semver 实测、pnpm 配置、client 模块机制、悬空软链清单）
- `research/audit-dsh-remote.md`（701 行）— dsh-remote 0.8.15 全量审计（行号级；克隆于 `repos/dsh-remote`，HEAD 559e26c）
- `research/audit-workspace-enhancement.md` — workspace-enhancement 审计（行号级；克隆于 `repos/dsh-workspace-enhancement`，HEAD ee25ed19 = v0.1.4）
- `research/family-panorama.md`（526 行）— 家族全景（≥37 候选 + 同名冲突 + 专项）
- 本机 DSH 安装：`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/`
- tarball 展开：`research/tgz/x-*/`（workspace-enhancement 0.1.2/0.1.3/0.1.4、dsh-remote 0.5.10/0.7.1/0.8.14/0.8.15、better-sidebar 0.14.0/0.18.1/0.19.1、dsh-ssh(org) 0.1.3、serial-console 0.1.0-rc.4、captain1275/dsh-ssh 0.3.1）

**关键 URL**
- https://registry.npmjs.org/dsh-workspace-enhancement · https://github.com/DobyChao/dsh-workspace-enhancement
- https://registry.npmjs.org/dsh-remote · https://github.com/flymysql/dsh-remote · https://github.com/chai1110/dsh-ssh-remote
- https://registry.npmjs.org/dsh-better-sidebar · https://github.com/omdsh-dev/DSH-better-sidebar
- https://registry.npmjs.org/@dsh-ssh/dsh-ssh · https://github.com/dsh-ssh/dsh-ssh
- https://registry.npmjs.org/@captain1275/dsh-ssh · https://registry.npmjs.org/@linxin666/dsh-ssh · https://github.com/zhu1090093659/dsh-web
- https://registry.npmjs.org/dsh-ssh-ops · https://github.com/caoyiwei850/dsh-ssh-ops
- https://registry.npmjs.org/@zhangfengshun/dsh-remote-ssh · https://github.com/ZhangFengshun/dsh-remote-ssh
- https://registry.npmjs.org/@infinitepersistence/dsh-serial-console · https://github.com/InfinitePersistence/dsh-serial-console
- https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-slots · https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-primitives
- https://registry.npmjs.org/@hy-sde-org/dsh-dap · https://github.com/hy-sde/dsh-tool-debug
- https://registry.npmjs.org/@elinpf/dsh-ops · https://github.com/Elinpf/dsh-ops-plugins（无 LICENSE）
- https://github.com/weisiren000/dsh-remote-ssh-ops（无 LICENSE）· https://github.com/Blank-not-black/dsh-Remote（= npm dsh-remote-plugin）
- https://github.com/LTY-lty666/dsh-serial · https://github.com/hgy043/dsh-serial

## 10. 待核验项（诚实清单）
1. 所有「可装」判定均为**静态（安装语义 + 逐符号 API）结论**，未在 rc.2 上实机启动验证（本次只读范围）；落地第一步应各做一次 `dsh plugin add` + 重启冒烟。
2. `dsh-client-ui-renderer@0.1.1-rc.2/lib/client.js:14` 那处真实 `require("@deepseek-ai/dsh-client-ui-slots")` 在浏览器侧由种子表解析——**运行时未实测**（推测成立，因 GUI 当前运行正常且 btw 插件同模式工作）。
3. dsh-remote 0.8.15+override 0.18.0 / 0.8.14 两条路径的**运行期行为未实测**（子报告方案 A/B 为静态兼容结论）。
4. GitHub API 后段限流（403），GitHub-only 候选清单可能不完整；`dsh-adb` 无仓库可核。
5. 上一轮报告的 `dsh-workerspace-research.md` 中「74★」「48★」等 star 数本轮未逐一复核（GitHub API 限流），以官方仓库页面为准。
