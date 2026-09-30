# T29 — 0.2.0 官方版本情报与破坏性变更（审计轨道）

状态：审计完成（只读轨道，未改动任何产品代码或现役资产）
采集时间：本轮实测（2026-09-29，本机）
采集方式：npm registry 元数据 + GitHub 官方 release 页/tag 页/git 协议提交史 + 官方 GitHub Pages 文档站 + 官方仓库 `docs/`、`.agents/notes/` + 本机已解包的 0.1.7-rc.2 / 0.2.0-rc.1 产物逐字节/逐行核对

> 本报告的每条外部声明都同时标注：**可信度等级**（官方文档明示 / 官方源码明示 / 社区二手信息 / 推测）与**本机可验证性**（含文件+行号，或明写「无法本机验证」）。

---

## 1. 结论摘要

1. **0.2.0-rc.1 的官方发行物确实存在，且是 GitHub 上的正式（Pre-release）Release。**
   - git tag：`dsh-v0.2.0-rc.1`，commit `4878cdabd87d4041bdaff61d04c966883b9fd07a`，commit time `2026-09-28 19:48:10 +0800`，commit subject `release(dsh): 0.2.0-rc.1 (#5387)`。
   - GitHub Release 发布时间 `2026-09-28T12:36:21Z`（与 npm 发布 `12:34:03.181Z` 相差约 2 分 18 秒），页面标记 **Pre-release**。
   - npm：`@deepseek-ai/dsh@0.2.0-rc.1`，dist-tag `next`，tarball integrity `sha512-F6hKNVoGgBDIzSiyRaIlobq4UD6cwxUjh+nwXqcDmufDh87TE1izsYzs8L5cZNpF2JmPnFM1mXRNnRJ0cs43ng==`，`dist.shasum 205c35227b6e923956dc767a02e2605f7d5fe840`，发布者环境 `npm 11.19.0 / node 24.21.0`。**无稳定 0.2.0**，`latest` 仍为 `0.1.7-rc.2`（与协调者给定事实一致，本轮独立复核通过）。

2. **仓库没有 CHANGELOG.md / RELEASES.md / 迁移指南。** 全仓库 15962 个路径中，文件名含 `CHANGELOG` 的 **0 个**（本轮实测，递归 tree 全量枚举）。0.2.0 的「发布说明」唯一官方载体是 **GitHub Release 正文**；深度技术理由的载体是 **`.agents/notes/implemented/**`（Agent Note）**。

3. **官方明示的破坏性/行为变更共 3 条**（1 条来自 README 的总纲声明 + 2 条来自 0.2.0 release 正文的「⚠️ 其他变更」）：
   - **[B1] 定时任务（Schedule）由内核内置行改为可选插件包（opt-in optional bundle）** — 官方 release 正文 + Agent Note + 源码三处互证。
   - **[B2] 「工作过程展示」默认值变更** — 官方 release 正文一句带过；**本轮在本机源码中定量还原为 Web 默认 `standard → detailed`**（桌面仍为 `standard`）。
   - **[B0] 工程总纲：README 明示 "THERE WILL BE COMPATIBILITY-BREAKING CHANGES."**（developer preview 声明）。

4. **本轮最重要的反直觉发现（对迁移动作影响最大）：单看「0.2.0 相对 0.1.7 的增量」，它是一个异常克制的 RC。**
   - 伞包**已发布依赖集合**：0.1.7-rc.2 为 81 个，0.2.0-rc.1 为 82 个；**新增仅 1 个**（`@deepseek-ai/dsh-experimental-schedule-bundle`），**移除 0 个**。
   - **会话格式没有升代**：两版 `SESSION_FORMAT_VERSION = 4`，且 `dsh-session-format`、`dsh-session-format-catalog`、`dsh-session-persistence-jsonl`、`dsh-session-format-v0-to-v1`、`dsh-session-format-v3-to-v4` 五个包的本机 `lib/**/*.js` **逐字节哈希相同**。
   - 167 个非合并提交中，**没有任何 `BREAKING CHANGE` 标记**，grep `break/remove/drop/deprecat/rename/migrat` 仅命中 7 条且全部是与兼容性无关的文档/命名整理。
   - **⇒ 本迁移的真实风险重心不在「内核数据面破坏」，而在「宿主版本号抬升 + 插件 peer 闸门 + profile 解析规则」三者叠加产生的静默降级**（见第 5 节 R03/R04）。

5. **社区情报（二手，但与本机源码交叉印证后强烈指向真实）**：0.2.0 上线后最伤用户的不是数据损坏，而是 **peer 版本闸门静默禁用基础层 storage 行，导致「工作区/会话列表全空」而磁盘数据完好**（discussion #8166）；以及 **插件安装被 bundle 自身 disabled 的兼容垫片行拒绝并整体回滚**（discussion #8220）。两条的根因代码在本机 0.2.0 源码中**均已定位到具体函数与行号**。

6. **对协调者给定背景的一处纠错**：背景中「0.2.0 相对 0.1.7 新增依赖：`dsh-tool-subagent-control`」**不成立** —— `@deepseek-ai/dsh-tool-subagent-control@0.1.7-rc.2` 已存在于 0.1.7 伞包 `dependencies` 中（本轮 npm registry 实测）。0.2.0 净新增依赖只有 `dsh-experimental-schedule-bundle` 一个。

---

## 2. 检索到的来源清单

### 2.1 官方一手来源（可信度：官方文档明示 / 官方源码明示）

| # | 来源 | URL | 要点 | 可信度 | 本机可验证 |
|---|---|---|---|---|---|
| S1 | GitHub Release 正文 `dsh-v0.2.0-rc.1` | https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.1 | 0.2.0 系列首个 RC，汇总自 `v0.1.7-rc.2` 以来的用户/开发者可见变更；三节：🎨 体验优化（10 条）/ 🐛 问题修复（7 条）/ **⚠️ 其他变更（2 条）**。Changelog 指向 compare 链接；贡献者 15 人；👍97/🎉17/🚀12。页面标记 **Pre-release** | **官方文档明示** | ✅ 可（本条即官方正文） |
| S2 | GitHub Release 正文 `dsh-v0.1.7-rc.2` | https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2 | 对照基线。含「✨新增：**启用定时任务后**，可创建和管理提醒、查看运行记录；重启后任务仍保留」；「⚠️调整：**Web 和桌面端默认关闭定时任务与时间上下文**，需要时可手动启用」；「Inspector 不再默认提供，需要单独安装」 | **官方文档明示** | ✅ 可 |
| S3 | Agent Note：Schedule 作为可选 bundle | https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/architecture/2026-09-24-schedule-opt-in-optional-bundle.md | 逐条说明：Web 组合**不携带** `time-context` / `schedule` / `ui-schedule` 三行；由 `@deepseek-ai/dsh-experimental-schedule-bundle` 通过自身 `cordis.patch.yml` 插入；`OPTIONAL_BUNDLES`（`packages/boot/app-boot/src/profile.ts`）登记；`apps/cli` 声明其为运行时依赖 ⇒ **每次安装都自带但默认关闭**；并给出 `patch: entry <id> not found` 的 loader 警告后果 | **官方文档明示** | ✅ 可，见第 4 节 V1/V2 |
| S4 | 仓库 README（master） | https://github.com/deepseek-ai/deepseek-harness/blob/master/README.md | 「DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**」；文档站 https://deepseek-harness.github.io/deepseek-harness/ | **官方文档明示** | ✅ 可（正文引用） |
| S5 | Agent Note：npm 发布序列 | `.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md` | dsh 家族单一版本线；`rc` 预发布映射到 npm dist-tag **`next`**，stable 才走 `latest`；tag 形如 `dsh-v<version>` | **官方文档明示** | ✅ 可（与 npm dist-tags 实测一致） |
| S6 | Agent Note：workspace 发布范围 | `.agents/notes/implemented/process/2026-09-22-workspace-release-ranges.md` | DSH 内部引用一律 `workspace:*` ⇒ 打包后为**精确版本**（非 caret）；vendor/native 用 `~` | **官方文档明示** | ✅ 可，见第 4 节 V6 |
| S7 | Agent Note：双发行安装布局工作预算 | `.agents/notes/implemented/process/2026-09-28-dual-release-install-layout-work-budget.md` | 2026-09-28 实测：**每次发行 277 个 DSH 包**、2524 条内部依赖边、其中约 3/4 为 peer 边；npm 图解析 137-205 s（空闲机） | **官方文档明示** | ⚠️ 部分（包数量级可本机核对，具体耗时无法复现） |
| S8 | 官方文档站 | https://deepseek-harness.github.io/deepseek-harness/ | 站点在线（HTTP 200，VitePress 构建）。本轮仅取到静态壳与资源清单，**未取到逐页正文**（见第 3 节缺口） | 官方文档明示（站点存在） | ⚠️ 内容未取到 |
| S9 | 官方 `docs/` 目录（master） | `docs/persistence-schema.json`、`docs/config-catalog.md`、`docs/subsystems/schedule.md`、`docs/subsystems/otel.md`（新增）、`docs/user/guide/schedule.md` | 0.1.7-rc.2→0.2.0-rc.1 间 `docs/**` 有实质改动：schedule 子系统与用户指南、新增 otel 子系统、persistence-schema 与 config-catalog 重生成 | **官方源码明示** | ✅ 可（本轮以 git diff 核对） |
| S10 | git 提交史（协议直取，非 API） | `git ls-remote` / `git log dsh-v0.1.7-rc.2..dsh-v0.2.0-rc.1` | 区间 **261 个提交（含合并）/ 167 个非合并提交**；tag `dsh-v0.1.7-rc.2`= `477b4f42…`（09-24 21:39 +0800），`dsh-v0.2.0-rc.1`= `4878cdab…`（09-28 19:48 +0800）；**无 BREAKING CHANGE 标记** | **官方源码明示** | ✅ 可（本机 bare 仓库已落盘） |
| S11 | npm registry 元数据 | `https://registry.npmjs.org/@deepseek-ai/dsh/0.2.0-rc.1`（及 `.../0.1.7-rc.2`） | 两版依赖集合 81→82；`bin.dsh=lib/bin.js`、`type=module`、`exports` 子路径（含 `./profile-boot`）**完全未变**；无 `engines`、无 `peerDependencies` | **官方源码明示** | ✅ 可 |

### 2.2 社区二手来源（可信度：社区二手信息）

| # | 来源 | URL | 要点 | 可信度 | 本机可验证 |
|---|---|---|---|---|---|
| C1 | Discussion #8166 | https://github.com/deepseek-ai/deepseek-harness/discussions/8166 | **[Bug] 0.2.0 peer gate 静默禁用基础层 storage 行（profile 传递依赖劫持包解析）→ 工作区/会话列表全空**。DSH Desktop 0.2.0-rc.1 从 0.1.7-rc.1/rc.2 自动更新后：磁盘 184 个会话文件完好，UI 全空，渲染器仅一条 `typert gateway: session/control: active Service "sessionController" is unavailable`。根因：三方插件的传递依赖把 `dsh-storage-json@0.1.5-rc.2`/`dsh-storage-domain@0.1.5-rc.2` 带进 profile hoisted 树，0.2.0 组合按 Node 解析规则取到旧副本，peer 闸门判不兼容并**自动禁用**这两行（提示只写 stderr；桌面 App 不落盘）。最小复现：bundles 削到只剩 `dsh-base` + `dsh-web-app` 症状不变。**已验证 workaround**：在 profile 显式 `pnpm add` 三件套到内核当前版本。 | **社区二手信息** | ✅ **根因代码已本机验证**（V4/V5/V6），复现环境（桌面 asar）无法本机验证 |
| C2 | Discussion #8220 | https://github.com/deepseek-ai/deepseek-harness/discussions/8220 | **[Bug][0.2.0-rc.1] 插件安装被 bundle 自身 disabled 的行拒绝**。发帖者自述为 `dsh-tui` 核心维护者；Windows 官方桌面。安装 `dsh-tui@0.11.2` 失败并**回滚**，报错点名 `@deepseek-ai/dsh-code-runtime-worker-thread@0.1.5-rc.3`、`@deepseek-ai/dsh-agent-presets@0.1.5-rc.3`（既非已装、也非运行版本）。根因：`bundleComponentManifests` 收集**每一条** `row.name`，**不看 `disabled`、不求值 `!!js`**；而启动路径 `compatibility-preflight` 会跳过 `disabled === true` ⇒ **只有安装器会拒**。并指出 `evaluatePluginCompatibility` 拿单一 `getDshRuntimeVersion()` 比所有 `@deepseek-ai/dsh-*` peer，旧包名最后发布于 `0.1.5-rc.3` ⇒ `^0.1.5-rc.3` 永远不可能满足 0.2.0-rc.1，命中即判定失败。附可复现代码片段与逐条行号 | **社区二手信息** | ✅ **根因代码已本机验证**（V4/V7），Windows 桌面安装流程无法本机验证 |
| C3 | Discussion #7654 | https://github.com/deepseek-ai/deepseek-harness/discussions/7654 | 「从 0.1.5 到 0.1.7：升级恢复清单」。含 0.1.7 各版本「升级者视角」地图与症状对号：**失败的启动仍会吞掉 `settings.yaml`**、legacy 导入**先重命名再导入**、`settingsScope` 被静默移除、读时迁移拒绝若干已发布 v0 形态。核心纪律：**备份 `~/.dsh`（profiles/、会话库、settings.yaml、本地插件）、钉精确版本、不要在会话进行中升级**。修复优于回滚：迁移器**不改动 v0 原件**，被拒是可规范化的小集合 | **社区二手信息** | ⚠️ 部分（与 0.1.7 相关，本迁移相关面：备份/钉版本纪律） |
| C4 | Discussion #6779 | https://github.com/deepseek-ai/deepseek-harness/discussions/6779 | 0.1.1-rc.2 → 0.1.5-rc.2 实测：**256 条会话中 255 条打不开**（`failed to observe session …`）。两处由 0.1.1-rc.2 **自己写出**的已发布 v0 形态被迁移器名单遗漏：`subagent/descriptor` 的 `data.version: 2`（231/256，迁移器只认 3）、插件 source 带 `summary` 配非 `notice` form（223/256）。fail-fast 正确（原件 76081 个 zstd 帧 0 撕裂），但代价是近 90% 历史不可读。本地规范化后 256/256 通过 | **社区二手信息** | ⚠️ 部分（该代次已过去；结论「迁移器 fail-closed 名单可能漏形态」对本迁移是**方法论警示**） |
| C5 | Discussion #6676 | https://github.com/deepseek-ai/deepseek-harness/discussions/6676 | 升级后启动失败的三类自查：①插件声明 host 范围与新 harness 不匹配（`dsh plugin add` 对 `@deepseek-ai/*` peer 范围**不校验也不警告**）②profile 固定 bundle 仍指旧版 ③会话日志首帧损坏同样阻断启动。给出 `dsh --profile <name> --dump-config` 与 peer 范围比对的查法 | **社区二手信息** | ✅ 部分（`--dump-config`、peer 比对路径可本机验证） |
| C6 | Discussion #8186 | https://github.com/deepseek-ai/deepseek-harness/discussions/8186 | 「0.2.0-rc.1 版本，构建报错」（0.2.0 专属构建问题报告，本轮未取正文细节） | **社区二手信息** | ❌ 未验证 |
| C7 | Discussion #8199 | https://github.com/deepseek-ai/deepseek-harness/discussions/8199 | 「Major update strands third-party plugins: no batch update path, minimumReleaseAge silently blocks same-day adapter versions」—— 大版本升级使三方插件搁浅：无批量更新路径；`minimumReleaseAge` 静默拦截当天发布的适配版本 | **社区二手信息** | ⚠️ 部分（`minimumReleaseAge` 属 pnpm 配置，可本机核对但本轮未做） |
| C8 | Discussion #8202 | https://github.com/deepseek-ai/deepseek-harness/discussions/8202 | 「How to add MCP server? (`@deepseek-ai/dsh-mcp-client@0.1.0-rc.7` is incompatible with dsh **0.2.0-rc.1**)」—— 与 C2 同型的 peer 版本不兼容受害者 | **社区二手信息** | ⚠️ 部分（同 R04 机理） |
| C9 | Discussion #8175 | https://github.com/deepseek-ai/deepseek-harness/discussions/8175 | 「Issue with DSH 0.2.0 rc1 creating things in internet zone?」（沙箱/网络域行为疑问，未取正文细节） | **社区二手信息** | ❌ 未验证 |
| C10 | Discussion #8173 | https://github.com/deepseek-ai/deepseek-harness/discussions/8173 | `[Bug][Windows] Desktop 打包总是失败：vswhere: ProgramFiles(x86) is not set`（env 对象丢失大小写不敏感语义）—— 影响从源码构建 Windows 桌面包，与 npm 安装路径无关 | **社区二手信息** | ❌ 未验证 |

### 2.3 检索到但**判定为无关/低可信**的来源（明确排除）

| 来源 | URL | 排除理由 |
|---|---|---|
| `harness-deepseek.org` | https://harness-deepseek.org/ | 非官方域名，标题自称 "0.1.2-rc.1"，与官方版本线不符；第三方 SEO 站点 |
| `open-harness.net` | https://www.open-harness.net/ | 同上，非官方 |
| `harnessdeepseek.org` | https://harnessdeepseek.org/ | 同上，非官方 |
| `deepseekai.works/errors/` | https://deepseekai.works/errors/ | 非官方「报错百科」类站点，无 0.2.0 一手信息 |
| `HenryZ838978/deepseek-harness` | https://github.com/HenryZ838978/deepseek-harness | 同名第三方复刻项目（Python witness stack），**非** `deepseek-ai` 官方仓库 |
| `tylerbuilds/deepseek-harness`、`isaccanedo/deepseek-harness` | — | 同名第三方仓库/镜像，非官方 |
| Discussion #7540 | https://github.com/deepseek-ai/deepseek-harness/discussions/7540 | 标题含 "v0.2.0"，但内容是**第三方插件** `dsh-plugin-teamflow` 自己的版本号，**与 DSH 0.2.0 无关**（易误引，特别标注） |

---

## 3. 无法获取的信息（明确缺口）

| # | 缺口 | 具体情况 | 影响 |
|---|---|---|---|
| G1 | **官方 CHANGELOG.md 不存在** | 全仓库 15962 路径中文件名含 `CHANGELOG` 者为 0；`CHANGELOG.md` / `docs/CHANGELOG.md` / `RELEASES.md` / `docs/release-notes.md` 全部 HTTP 404 | 「按版本逐条读 CHANGELOG」这条常规路径**在本项目上不成立**；只能依赖 Release 正文 + Agent Note + git 提交史 |
| G2 | **无 0.1.7→0.2.0 专用迁移/升级指南** | 仓库无 `MIGRATION.md`/`UPGRADING.md`；`docs/` 下无 0.2.0 升级专章；官方 Release 正文亦未提供升级步骤 | 迁移步骤必须由本审计自行推导（第 5 节） |
| G3 | **GitHub API 在采集后段被限流** | 未认证 API 触发 `403 rate limit exceeded`，导致 `releases`/`tags` REST 端点未取到；已改用 HTML 页 + `git ls-remote`/`git fetch` 协议替代并成功拿到同等事实 | 不影响结论（已用替代路径闭环）；但 release 的 API 结构化字段（如 `prerelease` 布尔、assets 清单）仅由页面文本「Pre-release」推断 |
| G4 | **Release 资产清单未取到** | 页面显示 "Assets 3" 与 "There was an error while loading"，逐个资产 URL 未渲染（JS 失败） | 无法核对 zip/tar.gz 与源码包的对应关系（对 npm 迁移无影响） |
| G5 | **官方文档站正文未取到** | `deepseek-harness.github.io` 首页 HTTP 200，但正文为客户端渲染，本轮只取到静态壳与资源清单，未解析到逐页文档正文 | 若文档站有「0.2.0 迁移/升级」专页，本轮**未覆盖**；但仓库 `docs/` 同源内容已覆盖 |
| G6 | **`web_search` 工具在本会话严重不可靠** | 4 次调用中 2 次直接报错 `DeepSeek returned no web_search_tool_result blocks`，1 次超时，仅 2 次返回结果，且返回内容被非官方站点主导 | 本报告的事实主干**不依赖** `web_search`；关键的 0.2.0 专属情报（C1/C2/C6-C10）是通过 **GitHub 站内搜索页直取**获得的，`web_search` 未能发现 |
| G7 | **0.2.0 独有的「破坏性变更」总量不可穷尽** | 官方只给出 2 条「⚠️ 其他变更」；其余行为变更需由 git diff 反推，而 Release 正文显然不是完备清单（官方自身未承诺完备） | **这是最大信息缺口**：官方对 0.2.0 的破坏面**没有给出清单式承诺**，只能靠「官方 2 条 + 提交史反推 + 社区实测」拼装 |
| G8 | **未做运行时实测** | 本轨道禁止启动监听端口服务、禁止触碰现役 0.1.1/0.1.7；隔离 root 的 0.2.0 亦未运行 | 所有「实际行为」结论均为**静态源码证据**，未在任何运行实例上复现（C1/C2 的复现环境为桌面 App，本机无法搭建） |

---

## 4. 外部声明与本机源码交叉印证表

| ID | 外部声明（来源） | 可信度 | 本机验证结论 | 证据（文件 + 行号） |
|---|---|---|---|---|
| V1 | 「`OPTIONAL_BUNDLES` 在 `packages/boot/app-boot/src/profile.ts` 中登记该包」（S3） | 官方文档明示 | ✅ **成立，且给出精确增量** | `extracted/deps017/…dsh-app-boot-0.1.7-rc.2/lib/index.js:552-556` = 3 项；`extracted/deps020/…dsh-app-boot-0.2.0-rc.1/lib/index.js:552-557` = **4 项**，第 4 项为 `"@deepseek-ai/dsh-experimental-schedule-bundle"` |
| V2 | 「Web 组合不携带 `time-context`/`schedule`/`ui-schedule` 三行」（S3） | 官方文档明示 | ✅ **成立** | `t11/bundles/x/deepseek-ai-dsh-web-app-0.2.0-rc.1/package/cordis.patch.yml` 中 `grep -nE 'time-context\|schedule\|ui-schedule'` **零命中**；而 0.1.7 同名文件在 `:121`(`time-context`)、`:125`(`schedule`)、`:370`(`ui-schedule`) 三处存在 |
| V3 | 「0.1.7 Web 端默认关闭定时任务与时间上下文」（S2） | 官方文档明示 | ✅ **成立，且比官方措辞更强**：0.1.7 那三行**不是靠默认值关闭，而是硬编码 `disabled: true`** | `…web-app-0.1.7-rc.2/…/cordis.patch.yml:121-129`（`time-context` + `disabled: true`）、`:125-129`（`schedule` + `disabled: true`）、`:370-373`（`ui-schedule` + `disabled: true`）。**推论：从 0.1.7 的「以 `disabled: true` 随包发出」到 0.2.0 的「完全不出现在组合里、改由可选 bundle 插入」，对 `dsh web` 的净效果是「仍然默认关闭」，因此 B1 对纯 Web 安装并非回归**；受影响的是「靠 profile patch 的行 id 覆盖来开启」的用法——0.2.0 下这些 patch 会命中 `patch: entry <id> not found` |
| V4 | 「0.2.0 新增 peer 版本闸门」（C1） | 社区二手信息 | ⚠️ **修正：闸门不是 0.2.0 新增的** —— 同一函数、同一错误文案在 **0.1.7-rc.2 已存在且行号几乎一致**（017:286 / 020:286；错误文案 017:322 / 020:322）。**真正的变化是「运行版本从 0.1.x 抬到 0.2.0」，使所有 peer 钉在 `^0.1.*` 的插件从「通过」翻转为「不兼容」。所以 C1 描述的伤害是真的，但归因应改为「版本抬升触发既存闸门」而非「0.2.0 新装闸门」** | 017 `dsh-app-boot/lib/index.js:286,322`；020 同行号 |
| V5 | 「`evaluatePluginCompatibility` 拿单一 `getDshRuntimeVersion()` 比所有 `@deepseek-ai/dsh-*` peer；命中即判不兼容」（C2） | 社区二手信息 | ✅ **成立** | `work/closure020/…/dsh-app-boot/lib/index.js:286-300`：只放行 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-` 前缀，`semver.satisfies(runtimeVersion, requirement, {includePrerelease:true})` 不满足即入 `peers`；`getDshRuntimeVersion()`（`:271-276`）读的是 **app-boot 自身 package.json 的 version** ⇒ 即内核版本 |
| V6 | 「`dsh-base` 基础层行按 Node 解析规则从 profile 树取包，会被三方插件的传递依赖劫持」（C1） | 社区二手信息 | ✅ **机理成立（本机可核对的强证据）**：0.2.0 的 storage 三件套 peer 为**精确版本**而非 caret ——`dsh-storage-json@0.2.0-rc.1` 的 `peerDependencies` = `{"@deepseek-ai/dsh-storage":"0.2.0-rc.1"}`。**精确 peer 使得「旧副本被解析到时必然判定不兼容」成为构造性事实，与 C1 描述完全吻合** | `iso-020-t09/npm-global/…/@deepseek-ai/dsh-storage-json/package.json`、`…/dsh-storage-domain/package.json`（两者 peer 均钉精确 `0.2.0-rc.1`）；范围策略来源见 S6 |
| V7 | 「`bundleComponentManifests` 收集每一条 `row.name`，不看 `disabled`、不求值 `!!js`；而启动路径 `compatibility-preflight` 跳过 `disabled === true` ⇒ 只有安装器会拒」（C2） | 社区二手信息 | ✅ **本机 0.2.0 源码逐字证实前半，后半部分证实** | 020 `dsh-plugin-manager/lib/index.js:404-424`：`visit()` 只检查 `typeof row.name === "string"` 与前缀/冒号过滤，**全文无 `disabled` 判断、无 `!!js` 求值**（`grep -c disabled` = 4，均不在该函数内）。020 `dsh-app-boot/lib/index.js:2093` 存在 `if (row.disabled === true && !row.group) continue;`（跳过 disabled 行） |
| V8 | 「会话日志首帧必须是恰好一行 `session` header，否则阻断启动/会话列表」（C5） | 社区二手信息 | ⚠️ **无法本机验证**（属 0.1.7 时代报告；本轮未定位到对应校验代码） | — |
| V9 | 「storage 三件套数据格式（workspace.json v2）在 0.1.7 → 0.2.0 间并未变化」（C1，用于论证应降级为警告） | 社区二手信息 | ⚠️ **无法本机完全验证**；但**间接支持**：会话格式 `SESSION_FORMAT_VERSION` 两版均为 `4`，且会话相关五包逐字节相同（见 V10）⇒ 「0.2.0 未引入持久化代次跃迁」这一更大结论成立 | 见 V10 |
| V10 | （本审计新增，非外部声明）**0.2.0 未引入会话格式代次跃迁** | 官方源码明示 | ✅ **成立**：`SESSION_FORMAT_VERSION = 4` 两版一致；`dsh-session-format`、`dsh-session-format-catalog`、`dsh-session-persistence-jsonl`、`dsh-session-format-v0-to-v1`、`dsh-session-format-v3-to-v4` 的 `lib/**/*.js` 排序后摘要哈希**两版完全相同**（例：`dsh-session-format-v0-to-v1` = `b0ea3f934337`，`dsh-session-format-v3-to-v4` = `974ba2be1d2f`）。**但 `dsh-session` 本身 DIFF**（`69e36c213256` → `e6601d37c427`，均 13 个文件） | `work/closure017/…` 与 `work/closure020/…` 对应包 `lib/` 目录 |
| V11 | 官方 release 正文「调整工作过程展示在不同初始化路径的默认值」（S1，⚠️ 其他变更第 2 条） | 官方文档明示 | ✅ **成立，并定量还原为官文未给出的具体值**：Web/非桌面默认由 **`standard` → `detailed`**；桌面（`"dshDesktop" in globalThis`）显式钉为 `"standard"` | `work/closure017/…/dsh-client-ui-chat/lib/index.js:29` 与 `lib/client.js:11852` = `"standard"`；`work/closure020/…/lib/index.js:29` 与 `lib/client.js:11971` = `"detailed"`；020 `lib/client.js:12393` = `new TranscriptViewPolicy(chatSettings, "dshDesktop" in globalThis ? "standard" : DEFAULT_TRANSCRIPT_VIEW_MODE)`；`lib/types/chat-settings.d.ts:21` 注释「Default work details for non-Desktop Web clients.」 |
| V12 | 背景给定「0.2.0 新增依赖 `dsh-tool-subagent-control`」 | （协调者给定，非外部来源） | ❌ **不成立** | npm registry 实测：`@deepseek-ai/dsh-tool-subagent-control@0.1.7-rc.2` **已存在于 0.1.7 伞包 dependencies**（且在 0.2.0 升为 `0.2.0-rc.1`）。0.2.0 **净新增依赖仅 1 个**：`@deepseek-ai/dsh-experimental-schedule-bundle` |
| V13 | 官方 release 正文 Changelog 链接（S1） | 官方文档明示 | ⚠️ **compare 页为客户端渲染，静态 HTML 无提交正文**；已改用 git 协议取得**权威提交区间**：261（含合并）/167（非合并）提交，且**无 `BREAKING CHANGE` 标记** | `git rev-list --count dsh-v0.1.7-rc.2..dsh-v0.2.0-rc.1` = 261；`--no-merges` = 167；`git log --grep` 无命中 |
| V14 | C1/C2 的「桌面 App 不把 disabling 提示落盘」 | 社区二手信息 | ❌ **无法本机验证**（无桌面 App 运行环境） | — |
| V15 | C7 的「`minimumReleaseAge` 静默拦截当天发布的适配版本」 | 社区二手信息 | ⚠️ **无法本机验证**（未核对 profile 的 pnpm 配置） | — |
| V16 | 官方 release 正文「修复部分 Linux 环境在缺少可选原生预构建包时的 npm 安装失败」（S1） | 官方文档明示 | ⚠️ **部分成立/部分无法验证**：musl 包确为 `optionalDependencies`（`sharp@0.35.5` 25 个可选依赖），且实测**离线缺失 optional 包会被静默跳过、不导致安装失败**（探针 C，退出码 0）⇒ 「缺可选包即失败」在**修复后的 0.2.0** 上不成立；但**原始故障环境无法构造**，修复本身未验证 | `iso-020/npm-global/node_modules/sharp/package.json`（25 个 optionalDependencies）；自有探针 `.workspace/audit-020/work/t29-net/probe-musl/proj{C}`；详见第 5-bis 节 |
| V17 | 背景补充「0.2.0 闭包新增 musl 变体可选原生包，断网缺失是否导致安装失败」（协调者插播） | （实测假设，非外部来源） | ❌ **证伪（就"导致失败"而言）**：optional 依赖不可得时 npm 静默跳过、退出码 0；但**新发现**一个更精确的风险——`npm ci --offline` 会**照锁文件物化 musl 包到 glibc 树中**（探针 A），故跨 libc 复用锁文件/缓存会产出混合树 | 探针 A/B/C 三组对照；`package-lock.json` 中 4 个 musl 条目、x64 两个已物化 |

---

## 5. 0.2.0 预期风险清单（含关联迁移动作）

风险等级：**H** = 可导致「迁移后主功能不可用」（数据完好但读不出）；**M** = 可导致插件/配置能力静默丢失；**L** = 体验或可解释性退化。

### R01 [H] peer 闸门静默禁用基础层 storage 行 → 工作区/会话列表全空
- **性质**：宿主版本抬升（V4）+ 精确 peer（V6）+ profile hoisted 解析被传递依赖劫持（C1）三者叠加。
- **触发条件**：隔离 profile 的 `node_modules` 中存在任何三方插件，其传递依赖把 `@deepseek-ai/dsh-storage*` 等**内核基础设施包**解析到旧版本（如 `0.1.5-rc.2`）。**与三方插件自身的行无关，最小组合（仅 `dsh-base` + `dsh-web-app`）即可复现。**
- **为何对本次迁移特别危险**：本迁移**正是**从 0.1.7 起在带三方插件的 profile 上做跨大版本升级——命中概率高；且症状伪装成「数据丢失」（实际磁盘完好）。
- **关联迁移动作**：
  1. **迁移前**在隔离 profile 执行依赖树体检：`pnpm why @deepseek-ai/dsh-storage @deepseek-ai/dsh-storage-json @deepseek-ai/dsh-storage-domain`，记录其版本与引入者；对**所有** `@deepseek-ai/dsh-*` 传递依赖做同样扫描（不限于 storage）。
  2. **迁移后首启**必须捕获 **stderr**（`disabling profile plugin row "…": Plugin … is incompatible with dsh 0.2.0-rc.1`）——GUI 可能零提示。**验证步骤**：启动后立即 `--dump-config`（或等价诊断）并 grep `disabling`，**有输出即判 R01 命中**，不得以「GUI 看起来正常」结案。
  3. 若命中，采取已由社区验证的修复（C1 workaround）：在 profile 中把基础设施三件套**显式钉到内核当前版本**（`pnpm add @deepseek-ai/dsh-storage@0.2.0-rc.1 @deepseek-ai/dsh-storage-json@0.2.0-rc.1 @deepseek-ai/dsh-storage-domain@0.2.0-rc.1`），并**记录在 Runbook 中作为「下次大版本需重做」的已知债务**（C1 已指出该钉子在下个内核大版本会自我失效）。
  4. **验收标准**：工作区数量与迁移前一致、历史会话可打开、stderr 无 `disabling … storage` 行。

### R02 [H] 插件安装被 bundle 自身 disabled 的兼容垫片行拒绝并整体回滚
- **性质**：安装器与启动路径的判定不一致（V7）。
- **触发条件**：装/升级任何在自身 `cordis.patch.yml` 中带**旧包名垫片行**（如 `@deepseek-ai/dsh-agent-presets`、`@deepseek-ai/dsh-code-runtime-worker-thread`）的插件；这些名字最后发布于 `0.1.5-rc.3`，`^0.1.5-rc.3` 在构造上永不满足 0.2.0-rc.1（V5）。
- **关联迁移动作**：
  1. 迁移后**逐个**重装本地插件时，逐条判读失败信息里点名的包**是否为用户显式请求的包**；若点名的是「用户没要求装、也不是当前运行版本」的旧包（C2 的典型签名），**判定为 R02 命中**而非「插件真不兼容」。
  2. 规避：优先使用不携带历史垫片行的插件版本；或在迁移窗口内**先不重装**该插件，把其兼容性列为已知缺口。
  3. **验收标准**：插件安装/更新不再出现「点名非请求包 + 整体回滚」。

### R03 [M] 「工作过程展示」Web 默认由 `standard` 变为 `detailed`
- **性质**：官方明示的行为变更（S1），本机定量还原（V11）。
- **影响**：Web 端默认展示的工作过程细节**变多**（`ChatPresentationPolicy`：`foldCompletedTurns` / `stepGrouping` / `liveProcessDetail` / `settledReasoningPreview`），进而影响 UI 密度与**模型可见上下文**；桌面钉在 `standard` 不受影响。
- **关联迁移动作**：
  1. 迁移验收时**显式决定**是否接受新默认（对存量用户是「未设置即变化」的静默切换）。
  2. 如需保持旧观感，在 `ui-chat` settings 命名空间写入 `transcriptView: "standard"`（**命名空间与字段名两版一致**，可直接沿用）。
  3. **验收标准**：Web 首启的实际展示模式 = 决策期望值；`transcriptView` 取值在 `compact|standard|detailed|verbose` 之内（legacy `normal`/`expanded` 仍可读、回读为 `detailed`）。

### R04 [M] 定时任务（Schedule）能力的可用路径改变，存量 patch/overlay 失效
- **性质**：官方明示的 opt-in 化（S1/S3），本机三处互证（V1/V2/V3）。
- **精确影响面（本审计修正）**：`dsh web` **仍然默认关闭** Schedule（0.1.7 是靠 `disabled: true` 关闭，0.2.0 是靠「行不在组合里」关闭）⇒ **纯 Web 用户无功能回归**。真实受影响的是：
  - (a) 通过 **profile patch / `--patch` overlay 按行 id 覆盖**来启用 `schedule`/`time-context`/`ui-schedule` 的用法——0.2.0 下这些 id 不存在，loader 会警告 `patch: entry <id> not found`（S3 明示）；
  - (b) 需要在 0.2.0 上**重新启用** Schedule 的用户——必须改为启用可选 bundle（Plugins 页开关，或在 profile 的 `dsh.profile.bundles` 中列出该包）。
- **关联迁移动作**：
  1. 迁移前 grep 隔离 profile 的 patch 层（`~/.dsh-*/profiles/*/cordis.patch.yml` 及 `--patch` 参数）是否出现 `time-context` / `schedule` / `ui-schedule` 三个 id。
  2. 若有：迁移后改为 `dsh.profile.bundles` 列出 `@deepseek-ai/dsh-experimental-schedule-bundle`，或经 Plugins 页启用；**确认该包确实随安装自带**（本机实测：隔离 0.2.0 root 中该包存在，版本 `0.2.0-rc.1`，依赖 `dsh-client-ui-schedule`/`dsh-schedule`/`dsh-time-context` 各 `0.2.0-rc.1`）。
  3. 迁移后**检查 loader 日志中是否出现 `patch: entry <id> not found`**（这正是 (a) 的探针）。
  4. 注意副作用（S3 明示）：启用后每个 live root Agent 增加 **4 个 tool schema**，每个 eligible step 增加 **1 条 durable clock 消息**（可回放、可压缩、出现在导出日志中）。

### R05 [M] 三方插件 peer 范围整体失效（版本抬升的普遍效应）
- **性质**：C2/C8 显示的普遍现象——所有 peer 钉 `^0.1.*` 的 `@deepseek-ai/dsh-*` 在 0.2.0 上都不满足（V4/V5）。
- **关联迁移动作**：
  1. 迁移前对全部本地/三方插件跑一次 peer 预检，输出「插件 / 声明的 peer 范围 / 与 0.2.0-rc.1 是否相容」三列表（C5 给了可比对方法）。
  2. 对判为不相容者，二选一：升级到 0.2.0 适配版本；或使用 **exact-version exemption** 显式接受风险（两版均提供 `dsh plugin allow-version` 与 `setProfileVersionExemption`，本机 0.2.0 源码 `dsh-app-boot/lib/index.js:421` 及错误文案 `:322` 证实）——**注意豁免是「按 插件名@版本 + 内核版本」精确键**，内核版本再变即失效。
  3. **验收标准**：无插件在启动或安装阶段被静默禁用；被豁免项有书面记录。

### R06 [L] 配置/settings 面新增：会话日志上传偏好与新 UI 行
- **性质**：官方 release 正文未列，由提交史与 bundle diff 反推（S10 + web-app patch diff）。
- **证据**：0.2.0 web-app patch 新增 `ui-settings-session-log` 行（`…/cordis.patch.yml:396-397`，包 `@deepseek-ai/dsh-client-ui-settings-session-log`）；对应提交 `7ded036fdb feat(web): add Session Log upload preference in General settings (#5337)`；另新增文档 `docs/subsystems/otel.md` 与包 `@deepseek-ai/dsh-client-product-analytics`，以及提交 `3dd52bfd9b fix(telemetry): own byte-bounded session request scheduling`。
- **关联迁移动作**：迁移后在 `ui-settings-general` 等命名空间比对新增键的默认值；**确认遥测/上传类新增能力在隔离环境的默认关闭状态符合预期**（涉及数据外发，须显式裁决）。
- **可验证性**：⚠️ 新增行的存在可验证（已证）；其默认值本轮**未逐项核对**，列为待验项。

### R07 [L] 存档/回滚纪律（跨版本通用，非 0.2.0 特有，但由 0.1.7 血泪清单强烈支持）
- **来源**：C3/C4（0.1.7 与 0.1.5 时代的真实事故）。
- **要点**：失败的启动**仍可能消费/重命名 `settings.yaml`**；`settingsScope` 曾被静默移除；读时迁移 fail-closed 会拒绝「由已发布旧版自己写出」的合法形态（C4 实测 255/256 不可读，且**迁移器不改动原件**）。
- **关联迁移动作**：
  1. 迁移前备份**整个** `~/.dsh-*`（profile、会话库、`settings.yaml`、本地插件），并**在 `~/.dsh` 之外另存一份 settings 副本**（因为 legacy 导入会先重命名原文件）。
  2. 记录精确版本号与 `npx @deepseek-ai/dsh@<精确版本>` 回退路径。
  3. **不在会话进行中升级**。
  4. 若出现「历史读不出」，**先不要回滚/删除**：判定是否为已知形态拒绝（原件完好），再决定就地规范化或回滚（C3 结论：修复优于回滚）。

### R08 [L] 0.2.0 专属的构建/环境类缺陷（未验证，仅登记）
- C6 「0.2.0-rc.1 构建报错」、C10「Windows 桌面打包 `vswhere: ProgramFiles(x86) is not set`」、C9「internet zone 行为疑问」、C7「无批量插件更新路径 + `minimumReleaseAge` 静默拦截」。
- **关联迁移动作**：迁移 Runbook 中登记为「如遇构建/打包失败，先按此清单排查」；本迁移若走 npm 安装路径（非源码构建、非 Windows 桌面打包），C10 不适用。

---

## 5-bis. 插播实测取证：musl 可选原生包与离线安装语义（2026-09-29 追加）

协调者插播要求核实「官方修复『部分 Linux 缺可选原生预构建包时 npm 安装失败』」与「0.2.0 闭包新增 musl 变体可选原生包」的关系。以下为本轮**独立实测**（自有目录 `.workspace/audit-020/work/t29-net/probe-musl/`，冷缓存 + `--offline`，未触碰 `iso-020/npm-global/`，未起服务）。

> 轨道边界声明：与离线闭包导出、`npm ci --offline` 全量重建、Runbook 相关的**交付物属 T27**；本轮只产出与 T29「外部声明 × 本机交叉印证」口径一致的可复核结论，**未写入任何 T27 产物**。

### 事实 1 — musl 包确实是「可选」，且由 `sharp` 声明
- `@deepseek-ai/dsh@0.2.0-rc.1` 闭包中的 `sharp@0.35.5` 声明了 **25 个 `optionalDependencies`**，覆盖 `@img/sharp-linux-*`（glibc）、`@img/sharp-linuxmusl-*`（musl）、`darwin`/`win32`/`wasm32` 全平台变体；`@img/sharp-linuxmusl-x64` 亦以 `optionalDependencies` 声明 `@img/sharp-libvips-linuxmusl-x64`。
- ⇒ **结论（回答协调者问题 3 第一问）：musl 包在本机 glibc 环境下是 `optionalDependencies`，不是必装依赖。**
- 平台约束字段：`@img/sharp-linuxmusl-x64` → `os:["linux"] cpu:["x64"] libc:["musl"]`；`@img/sharp-linux-x64` → `libc:["glibc"]`。
- 本机 libc 实测：`ldd 2.39 (Ubuntu GLIBC 2.39-0ubuntu8.5)`，`process.report` glibc 2.39。

### 事实 2 — 但本次闭包里 musl 变体**已被实际落盘**（锁文件驱动的跨平台物化）
三重独立核对（`find` / shell glob / node `readdirSync`）一致：`iso-020/npm-global/node_modules/@img/` 下实有 6 项，其中 **`sharp-linuxmusl-x64`、`sharp-libvips-linuxmusl-x64` 两个 musl 包真实存在**（另 4 项为 `sharp-linux-x64`、`sharp-libvips-linux-x64`、`colour`、`sharp-wasm32`）；跨平台变体（`darwin-*`、`win32-*`、`linux-arm*`、`linuxmusl-arm64` 等 24 项）**未落盘**。
`package-lock.json` 中 musl 条目共 4 个，其中 **x64 两个被物化、arm64 两个按 `cpu` 被正确过滤**。

**判读**：`cpu` 约束被过滤、`libc` 约束未被过滤 ⇒ **npm 在此路径上没有按 `libc` 过滤**。实测成因见事实 3。

### 事实 3 — 实测判定：`npm install` 按 libc 拒装，而 `npm ci --offline` 按锁文件"照单物化"
三个最小探针（均为冷缓存 + `--offline`）结果：

| 探针 | 主依赖 | optional 依赖 | 结果 | 退出码 |
|---|---|---|---|---|
| A | —（`file:` 指向本地 tgz） | — | `npm install` 先建锁文件（"up to date"）；随后 **`npm ci --offline` 成功物化 2 个 musl 包** | 0 |
| B | **musl 变体（`file:` tgz）** | musl-arm64（不可得） | **`npm install` 报 `EBADPLATFORM notsup`：`libc` 要求 musl、实际 glibc ⇒ 硬失败** | **1** |
| C | glibc 变体（`file:` tgz） | musl-arm64（不可得） | **成功，`added 2 packages`；不可得的 optional 包被静默跳过，不影响整体** | **0** |

**两条决定性结论**：
1. **`libc` 约束在同一次安装内的行为不一致**：`npm install` 会把「musl-only 包作为**非可选**依赖」判为 `EBADPLATFORM` 并硬失败（探针 B）；但**只要它被声明为 `optionalDependencies`，或安装走 `npm ci` + 已生成的锁文件，同样的 `libc` 不匹配就不会阻断**（探针 A/C）。⇒ **闭包里出现 musl 包本身不是 glibc 机器的安装障碍**，也不会被强制使用（Node 运行时按平台解析，musl 二进制不会被 glibc 进程加载）。
2. **⇒ 回答协调者问题 3 第二问（断网时缺失这些包是否导致安装失败）：不会。** 实测 optional 依赖在离线且冷缓存不可得时被 npm 静默跳过，退出码 0（探针 C）。**因此「musl 可选包缺失导致断网离线重建失败」在本机不成立**。真正会致失败的是**非可选**依赖不可得——这是 `npm ci --offline` 的通用前提，应作为 T27 离线重建 Runbook 的唯一硬前提记录（而非针对 musl 包特别处理）。
3. **对 T27 的直接风险提示（比协调者原假设更精确）**：**不得让「在 glibc 上、且锁文件已含 musl 条目」的状态被当成预期基线**。`npm ci` 会忠实物化锁文件中的 musl 包（探针 A），所以跨 libc 复用同一份锁文件/缓存会产出「glibc 树里混入 musl 二进制」的结果。若 T27 以本机现有 `package-lock.json` 为准做离线重建，会复现这一混合；**建议 T27 明确记录该现象并在 Runbook 中区分「必需闭包」与「可选平台变体」，而不是把 530 个包一律视为必需。**

### 事实 4 (L) 对官方 release note 的印证与边界
- 官方 0.2.0 正文列出修复项「**部分 Linux 环境在缺少可选原生预构建包时的 npm 安装失败**」。本机实测的是**已成功安装后的完整闭包**，**不具备**「缺少可选预构建包」的残缺环境，故**无法在本机复现该原始故障，也无法验证该修复是否生效**——本轮只验证了修复后的语义（事实 3）。
- ⇒ 若 T27 需要验证该修复，**其验证条件是构造一个「可选原生包不可得」的离线环境**（例如只投放部分平台变体 tgz），而非在完整闭包上重复安装。

### 事实 5 (L) `got@14.6.6` / OpenTelemetry 变更的本机核对结果
- `iso-020/npm-global/node_modules/got/package.json` → version **`14.6.6`**，确认新第三方 HTTP 栈存在。
- 与本报告第 4 节已证事实合并，0.2.0 相对 0.1.7 的依赖面变更应表述为：**净新增 1 个 `@deepseek-ai/*` 伞包依赖（`dsh-experimental-schedule-bundle`）+ 新增第三方 `got` 栈 + 移除 `@opentelemetry/exporter-logs-otlp-http` + 新增 `@img` musl 变体**。协调者基线第 3 节（503 → 530 包）与本报告 V12 的口径不冲突：前者是**闭包包总数**，后者是**伞包 `dependencies` 条目数（81→82）**，两者不可混用。
- ⚠️ `@opentelemetry/exporter-logs-otlp-http` 的移除与新增 `dsh-otel` / `dsh-host-product-telemetry-otel` / `dsh-session-telemetry-otel` 同批（基线第 3、4 节），**指向 0.2.0 自建 OTel 导出路径替换官方 exporter**；本轮**未验证**其行为等价性与遥测数据面影响，列为待验项（见第 6 节新增项 11）。

---

## 6. 未验证项（明确声明）

1. **任何运行时行为均未实测**：本轨道禁止起服务/触现役实例（G8）。R01/R02 的复现环境为桌面 App 与 Windows 安装流程，本机无法搭建；其**根因代码已证（V5/V6/V7），触发过程未实测**。
2. **R06 的新增 settings 默认值未逐项核对**（仅证明了新行/新文档/新包的存在）。
3. **`settings.yaml` legacy 导入行为在本迁移窗口的具体表现未验证**（C3 属 0.1.7 时代；0.2.0 是否已修复未知，本轮未定位对应代码）。
4. **C1 声称的「storage 三件套数据格式未变」未直接验证**（V9 仅给出间接支持：会话格式代次未变、会话五包逐字节相同）。
5. **官方文档站正文未取到**（G5），文档站若另有 0.2.0 升级专页则本报告未覆盖。
6. **Release 资产清单未取到**（G4）。
7. **`minimumReleaseAge` 与本机 profile 的 pnpm 配置未核对**（V15）。
8. **C4/C5/C6/C9/C10 的正文细节未逐条取全**（C6/C9 仅有标题级信息）。
9. **V4 对 C1 的归因修正是本审计的独立判断**（基于两版逐行对比），与 C1 原帖「0.2.0 新增 peer 版本闸门」的措辞不一致 —— 采用本审计版本（闸门既存，版本抬升触发）。
10. **167 个非合并提交未被逐条人工判读**：本报告的关键词检索（`break/remove/drop/deprecat/rename/migrat`、`schedul`、`setting/config/schema`）已覆盖，但**不能排除**存在未命中关键词的静默行为变更 ⇒ 与 G7 同源，建议由后续轨道用 `docs/config-catalog.md` / `docs/persistence-schema.json` 的机器可读 diff 做穷尽比对。
11. **（2026-09-29 追加）OTel 数据面变更未验证**：`@opentelemetry/exporter-logs-otlp-http` 移除 + 新增 `dsh-otel` / `dsh-host-product-telemetry-otel` / `dsh-session-telemetry-otel`，其**行为等价性、默认开关、外发端点与数据面内容均未核对**（基线显示 `dsh-session-telemetry-otel` 的 `lib/` churn 达 100%，属高风险改动面）。涉及数据外发，建议单列轨道核实默认关闭状态。
12. **（追加）musl 包「不得被强制使用」只做了静态与安装面判读**：本轮证实 musl 包为 optional、且 `npm ci` 会照锁文件物化，但**未实测 0.2.0 运行时是否会误加载 musl 二进制**（需实际启动 sharp 相关路径，本轨道禁止起服务）。Node 按平台解析 `libc` 变体的行为为通用机制，**未在本项目内验证**。
13. **（追加）官方「缺可选预构建包时安装失败」修复的原始故障不可复现**：本机是完整闭包，不构成残缺环境（见 5-bis 事实 4），故该修复是否生效**未验证**。

---

## 附：本轮实测关键命令与产物落点（可复核）

- 工作目录：`.workspace/audit-020/work/t29-net/`
  - `rel_020.html` / `rel_017.html`：两版 Release 页面原始 HTML；`release_notes_020.txt` / `release_notes_017.txt`：提取正文
  - `tree.json`：master 全量递归 tree（15962 条目，`truncated: false`）
  - `reg_0.1.7-rc.2.json` / `reg_0.2.0-rc.1.json`：npm registry 元数据
  - `gitrepo/`：bare 仓库（含两版 tag 与完整提交史）；`range_subjects.txt`：167 条非合并提交标题
  - `disc_6779.html` / `disc_7654.html` / `disc_6676.html` / `d8166.html` / `d8220.html` / `d8199.html` / `d8202.html`：社区讨论原始页
  - `s_*.html`：GitHub 站内搜索页（0.2.0 专属讨论的发现入口）
- 本机比对所用已解包产物：`.workspace/audit-020/work/closure017/`（0.1.7-rc.2）、`work/closure020/`（0.2.0-rc.1）、`t11/bundles/x/…`（bundle 包）、`extracted/deps01{7,0}/`（app-boot 等）、`iso-020-t09/npm-global/`（隔离 0.2.0 完整安装树，288 个包）
