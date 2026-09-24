# B档审计 · btw 问答卡片：文档现状 / 部署生效链路 / 交付面

> 作者：审计档（**只读**）。本职范围 = ①文档现状 ②部署/生效链路 ③测试面与交付面；**不深挖 React 状态根因**（另一档负责）。
> 时点：2026-09-23 03:1x–03:2x UTC（= 本机 11:1x–11:2x）。仓库 `/home/CNS2026495165/dsh`。
> 证据分级：**【已验证】**=本档实读文件/实跑只读命令所得；**【推断】**=由已验证事实直推；**【未验证】**=本档未取到证据。
> 本档未改任何代码/文档/配置，未重启服务，未 kill 进程；未跑构建（`tsdown` 会写 `lib/`），未跑测试。

---

## 0. 一句话结论

**文档侧：`docs/` 里关于「btw 问答卡片」几乎为零。** 全 `docs/` 对「问题卡 / 问答 / questionCard / btw_ask_user」的命中**只有 `docs/runbooks/verify-runbook.md` 两行**（`:18` 验收步、`:41` 排查项）；「问答工具卡片与主会话不一致」这一现象在文档里**没有任何记录**，其设计性根因只写在源码注释里（`src/client/SideChatToolRow.tsx` 的 "Layer B ToolRow approximation … the full per-tool card models are out of scope"）。
**部署侧：`~/.dsh/profiles/node_modules/@local/dsh-btw` 是实体拷贝（非符号链接）**，其 `lib/` 当前与仓库 `dsh-btw/lib/` **逐字节相同**（md5 `6c29b98b645d…`，361 702 B），且与 `curl` 到的被服务字节一致 ⇒ **改 `src/**` 不会自动上线，必须 build + 拷 `lib/`**；客户端面改动**无需重启 dsh**，刷新（或等 HMR）即生效。

---

## 1. 文档现有记录（逐条 file:line + 短引）

### 1.1 与「问答卡片 / 问答工具卡片」**直接**相关的唯一记录

| file:line | 原文短引 | 该行说了什么 / 没说什么 |
| --- | --- | --- |
| `docs/runbooks/verify-runbook.md:18` | 「问一个含糊问题诱导反向提问 → 面板弹**问题卡**（选项/多选/自定义）→ 选择后回传 → 模型继续。」 | **全 `docs/` 唯一把「问题卡」写进验收的地方**；判据只到"能弹、能回传"，**没有**"选中态可见/保持"、**没有**任何样式或"与主会话一致"判据 |
| `docs/runbooks/verify-runbook.md:41` | 「反向提问无问题卡：确认面板打开了 btw（`btw_ask_user` 只在侧聊子代理内注册）。」 | 只覆盖"卡片完全不出现"的排查；不覆盖"出现但选中态不对" |

**验证方式【已验证】**：`grep -rn "问题卡\|问答\|questionCard\|btw_ask_user" docs/` 仅命中上述 2 行。

### 1.2 `docs/program-notebook.md`（本轮用户要求查阅的 notebook）

| file:line | 原文短引 | 与本修复的关系 |
| --- | --- | --- |
| `:170`（§5.1 自装插件表 `dsh-btw` 行） | 「`dsh-btw/` \| `@local/dsh-btw` \| host + client \| 侧边对话：贴图经 vision-adam 转文本、子代理树/项目总览跳转、面板对齐；默认/清单每次调用热读」 | 一句话职责里**只提"面板对齐"**，未细分"工具行/问题卡"；若修复改变职责口径需改此行 |
| `:191`–`:197`（§5.3 专项摘要） | `:195`「…btw 点 X 关闭「不卡了」（74.8% → **0.3%** 掉帧、fps 19 → **59**…）」；`:197`「五条跨线重大发现：HMR 热刷新时序缺陷（写客户端插件会打断界面，**已修**）…」 | §5.3 只记 btw 的**关闭卡顿**与 HMR 缺陷，**无一字**涉及问答卡片 |
| `:249` D4 | 「**btw 备份 ≠ live 态**：现有备份不含后续单元，`--rollback` 会连带退掉后续改动」 | **与本次部署强相关**：回滚前必须新取 pre-image（见 §3.6） |
| `:256` D11 | 「**btw vitest 存在负载敏感 flake**（已加固为首跑 1 failed / 隔离 10/10、全量复跑 3/3 全绿）——不得写成"测试全绿"或"存在回归"」 | 测试面口径（§4.3 核实） |
| `:263` D18 | 「**HMR 热刷新时序缺陷**：写任一客户端插件的 `lib/client.js` ⇒ 宿主经 SSE 推 `rebuilt` 帧 ⇒ `reload()` 先清 `entry.fiber`…⇒ 该插件 UI 整体不渲染…**已修并落地**」 | **决定"改完 client 是否要刷新"**（§3.4） |
| `:267` D22 | 「**btw 每次打开抽屉都发一条不可见的 `sideChat/listTree`**…**已修**（U4 加 `jumpOpen` 守卫；U3 把 `viewStore.clear()` 提到 `await close()` 之前）」 | 与问答卡片无关，但证明 btw 客户端批次的既有落点形态 |
| `:279`–`:286`（§8 未验证项 3） | 「**已确证（2026-09-23）**：浏览器收到 client bundle `rebuilt` SSE 帧后**会自动热重载**…修复后仍需"写客户端 ⇒ 刷新一次"的批次化习惯。」 | 与 §3.4 合读：HMR 自动重载**是真的**，但纪律仍是刷新一次 |
| `:291`–`:300`（§9 维护触发条件） | 「缺陷被修复或被推翻 → 更新 §7…」「数据流、状态机、协议、异步任务所有权变化 → 更新 §1/§3 与 `docs/architecture/01`」… | 本次"必须同步文档"的判定依据（§2） |

### 1.3 `docs/architecture/05-performance-and-ux-program.md`

| file:line | 原文短引 | 说明 |
| --- | --- | --- |
| `:32` / `:59` | 「体感③ btw 点 X 关闭很卡」→「确认框全视口 blur + 背后 2x2px 无限追灯动画」 | 只把 btw 当"关闭卡顿"载体 |
| `:75`（§3 a11y 行） | 「a11y 1/2/3 \| layout / workspace / **btw(profile)** \| 弹窗 Tab×40 逃逸 **16 → 0**…」 | btw 的**键盘/aria** 改动记录；问答卡片属交互控件，若改选中态需在此口径下补 a11y 判据 |
| `:80`（§3 btw 批） | 「**btw 批** \| profile 挂载位 `6c29b98b645d`（361 702 B） \| 拖拽调宽高…+ 复活竞态 + 消掉每次开抽屉那条最长 22 237 ms 的隐形 `listTree`」 | **当前 live 指纹的书面出处**；本次部署后该指纹会变，此表**必须**更新 |
| `:157`（§7 客户端热面行） | 「客户端（热面）\| …\| 各自 `apply-*-v1.mjs --rollback`；**改完需刷新一次页面**」 | "热面"定义 |
| `:165` | 「③ **被服务的 btw 是 profile 挂载位**，不是仓库 `lib/`」 | 与 §3.2 实测一致 |
| `:166` | 「④ 该资源**无 `Cache-Control`/`ETag` 且改内容不改名** ⇒ 必须硬刷新；`?rev=` **是内容哈希但不是有效缓存键**」 | **口径需按实测拆分**：壳层 `/assets/index-ClqxG24t.js` 确实**无** `Cache-Control`（必须硬刷新）；但**插件 bundle `/plugins/@local/dsh-btw/client.js` 实测带 `cache-control: no-cache`** ⇒ 普通刷新即可。`?rev=` 实测**确为内容哈希**（见 §3.3） |
| `:303`–`:308`（§9 维护触发条件） | 「任一落地项被**回滚、替换或推翻** → 更新 §3 表格与 §7 地图」；「宿主主干或**客户端渲染链发生结构性改动** → 更新 §2 与 §6 口径」 | §2 判定依据 |

### 1.4 `docs/architecture/01 / 02 / 04`

| file:line | 原文短引 | 说明 |
| --- | --- | --- |
| `01:62` | 「`dsh-btw/` \| `@local/dsh-btw` · `0.4.0-btw.1` \| host + client \| 侧边对话：…、面板对齐 \| `@deepseek-ai/schemastery`、`zod`」 | 模块一句话职责；改"工具卡片渲染来源"时要改 |
| `01:78` | 「本仓库根级只有 **3 个** `cordis.patch.yml`：`dsh-btw/`、`dsh-usage/`、`dsh-wallpaper-local/`」 | 与本次无关 |
| `01:183` | 「`dsh-btw/lib/index.js`（约 65 KB）…内部结构未逐行通读——…属**声明级**而非**实现级**结论」 | 明示 btw host 面**文档本就只有声明级** |
| `02:66` | 「要启用 client 面：在 `package.json` 增加 `dsh.client` 声明（含 `platform: "web"` 与 `inject` 列表）；**改后需重启 web 一次**」 | **冷面判据**（§3.7） |
| `02:88` | 「非 settings 槽先例：…`conversation.session.header.actions`（`dsh-btw`）」 | btw 用过的槽名 |
| `02:119` | 「`- insert: [{id, name, config?}]` …\| `- id: btw` / `name: '@local/dsh-btw'`」 | 挂载条目语义 |
| `02:131` | 「官方 `ClientModuleRegistry` 扫描活动 loader 条目的 `package.json`，把有 `dsh.client` 的包编成图」 | client bundle 进浏览器机制 |
| `02:144` | 「`~/.dsh/settings.yaml` 的**值**（…btw 默认模型）\| **热②**」 | settings 值级热载 |
| `02:146` | 「`package.json` 的 `dsh.client` 声明变更 \| **冷（需重启）** \| p0a §3（pkgMeta 缓存）」 | 冷面判据 |
| `02:182` | 同 `01:183`（btw host 未逐行通读，声明级） | — |
| `04:184` | 「🟡 \| btw 现存两个备份**都不等于 live 当前态**，回滚会连带退掉后续单元 | 回滚指引必须保留该警告」 | 回滚警告（与 notebook D4 同源） |
| `04:194` | 「`dsh-btw` \| `vitest run` \| **24**（`tests/**/*.spec.{ts,tsx}`）\| **唯一在 `package.json` 声明 test 脚本的插件**…`passWithNoTests: false`」 | **数字已漂移：实测 25 个 spec 文件**（§4.1） |
| `04:202` | 「⚠️ **不得写成"测试全绿"或"存在回归"**：btw 全量 vitest 首跑曾 1 failed，但隔离复跑 10/10、全量复跑 3 次全绿 ⇒…负载敏感 flake 且已加固」 | D11 的正文出处 |

### 1.5 只在**源码注释**里、文档完全没有的「已知限制」（本次不一致的关键）

| file:line | 原文短引 | 含义 |
| --- | --- | --- |
| `dsh-btw/src/client/SideChatToolRow.tsx:20-23` | 「Simplified variant-leading icon by tool name (**approximates** the official `VARIANT_ICONS` table; **the full per-tool card models are out of scope**).」 | **"问答工具卡片与主会话不一致"的设计性根因就在这句**：btw 故意用通用 `DisclosureRow` 近似官方 per-tool 卡片模型 |
| `dsh-btw/src/client/SideChatToolRow.tsx:34-39` | 「Layer B ToolRow approximation: a `DisclosureRow` … aligned with the official `GenericToolCard` structure. `data-state` mirrors the official running/error/ok convention」 | 渲染路径 = 近似层，不是官方卡片 |
| `dsh-btw/src/client/SideChatSurface.tsx:60` / `:586` | `function QuestionCard(...)` / `<QuestionCard pendingQuestion={state.pendingQuestion} controller={controller} t={t} />` | 问题卡本体位置 |
| `dsh-btw/src/client/SideChatSurface.tsx:70-88` | 「`pendingQuestion.questions.map(question => [question.id, { selected: new Set<string>(), custom: '' }])`」…「`const selected = new Set(draft.selected)` … `if (!multiSelect) selected.clear()`」 | 选中态是**组件本地 draft 状态**（`useState` 初始化自 `pendingQuestion`），**这是"选中态不持久"最可疑的落点**（细节归根因档，本档不裁决） |

**结论【已验证】**：`docs/` 与 `FEATURE-MAP.md` 均**未**记录"btw 工具卡片是官方卡片的近似层"这一已知限制；该限制目前**只存在于源码注释**。

### 1.6 `.workspace/` 里的既有实测结论（证据库，非正式文档）

| file:line | 原文短引 | 用途 |
| --- | --- | --- |
| `.workspace/lag-fix/exec-btwclose/report.md:316` | 「按既有路线**只对 `lib/` 双向拷贝**（仓库 `dsh-btw/lib/` ↔ `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/`），并核对 **sha256 + 响应体哈希**（`?rev=` 不是内容哈希）」 | **部署路线原文**。注意最后半句与实测冲突：`?rev=` 实测**就是**内容哈希（§3.3），此句需更正 |
| `.workspace/lag-fix/exec-btw-resize/report.md:83` | 「**部署必须落到 profile 挂载位**：`served bytes == ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js`（实测 md5/sha256 完全一致）」 | 判据：比对**响应体**哈希，不比对 rev |
| `.workspace/lag-fix/exec-btw-resize/report.md` §6.2（`:899` 附近） | 「**只拷 `lib/`**：部署位 `src/` 是旧快照（23 处差异、缺 5 个文件）⇒ `cp src` 无用；`.module.css` 内联进 bundle ⇒ CSS 改动**必须重建**」；「**重建后必须核对 served 响应体 sha256**（不是 `?rev=`）」；「重建仓库 `lib/` **不会**改变 served bytes（构建前后 `curl` 均为 `28ccb37a…`）⇒ 沙箱内构建是安全的、不会顺手热部署」 | **本档 Runbook 的直接依据**（已复核，见 §3.2/§3.5） |
| `.workspace/settings-lag/audit-rebuild.md:148-152` | 「官方提到的 `pnpm run dev:web` 在本部署**不可用**…该脚本属于**上游 monorepo 根 package.json**，本机安装树里…**没有任何 `dev:web` 定义**」 | 「客户端插件 HMR 免刷新只能在 `dev:web` 跑时成立」这一限制在本机**不适用**（本机根本没有 dev:web），但 HMR 链路另有宿主侧实现（§3.4） |
| `.workspace/reports/audits/btw/btw-upgrade-audit.md:230` | 「**dev watcher 是否在跑**：**没有**。`ps aux` 无 vite/tsdown/dev:web 相关进程…boot graph 中的 `dsh-client-hmr` 仅是浏览器侧接收器（且 `cordis.patch.yml` 里 hmr 被 `disabled: true`…）」 | 与 §3.4 的实测**部分冲突**：本档实测 `/plugins/events` SSE **活着**，且宿主侧 stat 轮询代码确在 `@deepseek-ai/dsh-client-hmr/lib/index.js` ⇒ 该审计结论**已过期**（置信度：高，见 §3.4 证据） |

---

## 2. 本次修复后**必须同步**的文档清单（按 `program-notebook` skill 的判定清单）

判定条款取自 skill「必须触发文档判断的变化」：**①**模块边界/入口点/公共 API/生命周期；**②**数据流或状态传播；**③**状态机/运行模式/错误处理/安全门；**④**配置来源/schema/默认值；**⑤**构建/部署/CI/测试架构；**⑥**已知限制、TODO/stub、已验证缺陷的新增/修复/推翻；**⑦**协议/驱动/关键外部依赖行为。并叠加 notebook `:291-300` §9 与 arch05 `:303-308` §9 的维护触发条件。

**归属判定【推断，取决于修复形态】**：无论修法如何，"问答卡片与主会话不一致 + 选中态不持久"都属于条款 **⑥（已验证缺陷的新增/修复）**⇒ **强制触发**；若修法触及 `src/client/SideChatSurface.tsx` 的 draft 状态生命周期则再中 **③**；若改为复用官方 per-tool 卡片/新增注入或槽则再中 **①/②/⑦**。

| 文档 | 必须更新？ | 理由（触发条款） | 具体落点 |
| --- | --- | --- | --- |
| `docs/program-notebook.md` | **必须** | ⑥（缺陷修复）+ §9「缺陷被修复或被推翻 → 更新 §7」 | §7 新增一条 D 条目（**实测当前最大编号 = D28 ⇒ 新条目应为 D29**，实施前复核），写"现象 / 根因 / 状态 / 证据(file:line)"；并在状态列按现规范附当前证据 |
| `docs/architecture/05-performance-and-ux-program.md` | **必须（至少 §3/§7）** | §9「任一落地项被回滚、替换或推翻 → 更新 §3 表格与 §7 地图」 | §3「btw 批」行（`:80`）与 §7「btw（profile 挂载位）」行（`:158`）的**指纹 `6c29b98b645d` 会失效**，必须换成部署后的新 md5/字节数；若修复属渲染链结构调整，另按 §9 复核 §6 判据口径 |
| `docs/runbooks/verify-runbook.md` | **必须** | ⑥ + 该文件本就是 btw 验收面 | §1 第 5 步（`:18`）补"选中态可见且**保持**"判据；§3（`:41`）补"卡片出现但选项选中态丢失/样式与主会话不一致"的排查项 |
| `FEATURE-MAP.md` | **必须（轻量）** | ⑥，且该文件"每项能力带日期"的规范 | `:25`「dsh-btw 侧边对话 v2」行补日期与"工具卡片/问题卡"口径；`:56` 时序断言行若随本次测试面变化也需对齐 |
| `docs/architecture/01-architecture-overview.md` | **条件必须** | ①/② | 仅当修复改变模块边界或数据流（例如"工具卡片改为复用官方渲染/新增注入"）⇒ 更新 `:62` 一句话职责、必要时 `:134` 附近数据流图；若只是组件内状态修复则**不必** |
| `docs/architecture/02-plugin-system.md` | **条件必须** | ①/⑦ | 仅当新增 client 注入/槽（`dsh.client.inject` 列表变化或新槽名）⇒ 先注意 `:146`：**`dsh.client` 声明变更属冷面（需重启）**，并更新 `:88` 槽表与 `:66` 契约表述 |
| `docs/architecture/04-ops-deploy.md` | **建议同时修（与本次无关的既有漂移）** | ⑤ | `:194` 写"**24** 个测试文件"，**实测为 25**；`:202` 的 flake 口径需补当前版本号（vitest 4.1.8）与行号（见 §4.3） |
| `dsh-btw/README.md` / `README.zh.md` | **条件必须** | ⑥ | 若行为变化对用户可见（卡片不再与主会话不一致），README 的能力列表应同步；注意 `tests/sign-contract.spec.ts:120` 会**断言 README 原文串**，改 README 需同步该 spec（**这是本次修复的隐藏耦合，务必提请执行档注意**） |
| `docs/architecture/03-model-routing-gateway.md` / `DOC-STYLE.md` / `docs/runbooks/port-*.md` | **不必** | — | 与问答卡片无关 |

**判定结论**：至少 4 份（notebook §7、arch05 §3/§7、verify-runbook §1/§3、FEATURE-MAP `:25`）**必须**同步；另有 2 份（arch01/arch02）与 1 份 README **按修法条件触发**。

---

## 3. 部署 / 生效链路事实

### 3.1 挂载条目【已验证】

- `~/.dsh/profiles/web/cordis.patch.yml:22-24`：
  `- insert:` / `    - id: btw` / `      name: '@local/dsh-btw'`
  ⇒ `name` 是 **bare 包名**（符合 `docs/architecture/02-plugin-system.md:119` 的硬约束）。
- 组合顺序（`02` §4.1）：bundles（`~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` = `@deepseek-ai/dsh-base` → `@deepseek-ai/dsh-web-app`）→ profile 自身层 → home 层 → `--patch`。【已验证：`~/.dsh/profiles/web/package.json`】
- `~/.dsh/profiles/web/cordis.yml` 只有 `[]`（空条目表，注释明说"Edit cordis.patch.yml, not this file"）⇒ **不要试图从 cordis.yml 反推组合**。【已验证】

### 3.2 部署位 = **实体拷贝，不是符号链接**【已验证】

| 判据 | 实测 |
| --- | --- |
| `ls -la ~/.dsh/profiles/node_modules/@local/` | `dsh-btw` 是 `drwxrwxr-x` **目录**（非 `lrwxrwxrwx`） |
| `readlink -f ~/.dsh/profiles/node_modules/@local/dsh-btw` | 返回**自身** `/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-btw` ⇒ **非符号链接** |
| `diff -rq dsh-btw/lib ~/.dsh/profiles/node_modules/@local/dsh-btw/lib` | 无差异（`IDENTICAL_TREE`） |
| `md5sum` 两侧 `lib/client.js` | 均为 `6c29b98b645df00b8bc3e9279d6df93e`，361 702 B；inode 不同（31720323 vs 34768523）⇒ **两份独立文件，内容相同** |
| `diff -q` 两侧 `package.json` | 相同（`PKG_SAME`） |
| 部署位 `src/` | **存在但为 09-08 旧快照**（`ls -la` 显示 `src` mtime `9月 8 16:34`）⇒ `cp src` **无用**（与 `.workspace/lag-fix/exec-btw-resize/report.md` §6.2 一致） |

> **运维含义**：仓库 `dsh-btw/lib/` 与线上**没有任何链接关系**；`pnpm build` **不会**自动上线（resize 报告已实测："重建仓库 `lib/` 不会改变 served bytes"）。

### 3.3 入口字段与实际被加载的文件【已验证】

- `dsh-btw/package.json`：`"main": "lib/index.js"`；`exports["."]` → `./lib/index.js`；`exports["./client"]` → **`./lib/client.js`**；另有 `"./typert"` → `./lib/typert.host.js`、`"./remote"` → `./lib/typert.remote-client.js`。
- `dsh.client` = `{ inject: [7 项 @deepseek-ai/*], platform: "web" }`（**无 `immediately`**）。
- 实际被浏览器加载的是 **`lib/client.js`**：
  `curl -s http://127.0.0.1:3080/` 的 `__DSH_BOOT__.entries` 中
  `{"id":"@local/dsh-btw","url":"/plugins/@local/dsh-btw/client.js?rev=a0ba609897df","rev":"a0ba609897df","inject":[…7 项…]}`（共 50 个条目）。
- **`rev` 的定义实测**：`@deepseek-ai/dsh-client-modules/lib/index.js:147` 注释「sha1 content hash shortened to 12 hex chars (bundle rev / graph rev)」；实测 `sha1sum dsh-btw/lib/client.js` = `a0ba609897df9d93…` ⇒ **`rev` = sha1 前 12 位 = 内容哈希**。
  ⚠️ 因此 `?rev=` **是**内容哈希（与 `.workspace/lag-fix/exec-btwclose/report.md:316` 的"`?rev=` 不是内容哈希"表述相反；与 arch05 `:166` 的表述一致）。
- **被服务字节 == 部署位 == 仓库**：`curl -s .../plugins/@local/dsh-btw/client.js` → HTTP 200、`size_download=361702`、md5 `6c29b98b645df00b8bc3e9279d6df93e` ⇒ 与仓库/部署位 `lib/client.js` **逐字节一致**。
- 响应头：`cache-control: no-cache`（**无** `etag`）⇒ **普通刷新即取新字节**。
  对比：壳层 `/assets/index-ClqxG24t.js` 响应头**无** `cache-control`/`etag` ⇒ 壳层改动**必须硬刷新**（arch05 `:166` 的描述对壳层成立，对插件 bundle 不成立）。

### 3.4 客户端改动如何生效（HMR 链路）【已验证 + 一处口径修正】

- 浏览器侧接收器**已挂载**：boot entries 含 `{"id":"@deepseek-ai/dsh-client-hmr", …, "immediately":true}`。
- 宿主侧 watcher **就在同一个包里**：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-hmr/lib/index.js:16` 注释「stat-polls every graph row's client bundle」；`:28` `pollIntervalMs` **默认 500**；`:43` 变更时调 `ctx.clientModules.rebuilt(id)`；`:145` 订阅 `onRebuilt` 并对外提供 `/plugins/events` SSE（同文件 `:18` 注释）。`dsh-client-modules/lib/index.js:322-333` 的 `rebuilt()` 重算 sha1，rev 变化才广播。
- **实测该 SSE 通道活着**：`curl -N -m 3 http://127.0.0.1:3080/plugins/events` → `HTTP/1.1 200`、`content-type: text/event-stream`，首帧 `: connected`，随后 `data: {"type":"graph","graph":{"rev":"ce96c94c52e5",…}}`。
- 用户可感知行为已被既有审计抓帧确证：`docs/program-notebook.md:279-286`（§8.3）「浏览器收到 client bundle `rebuilt` SSE 帧后**会自动热重载**…修复后仍需"写客户端 ⇒ 刷新一次"的批次化习惯」；缺陷本体见 `:263`（D18，**已修并落地**）。
- ⚠️ **修正一条已过期的审计结论**：`.workspace/reports/audits/btw/btw-upgrade-audit.md:230` 称 "boot graph 中的 `dsh-client-hmr` 仅是浏览器侧接收器（且 `cordis.patch.yml` 里 hmr 被 `disabled: true`）" ⇒ 与本档实测冲突：`@deepseek-ai/dsh-web-app/cordis.patch.yml:22-23` 的 `- id: hmr / disabled: true` 指的是**通用 `@deepseek-ai/cordis-plugin-hmr`** 行（其日志 `dsh-host.jsonl` 有 `{"name":"hmr","msg":"watching []"}`），**不是** `dsh-client-hmr`；`dsh-client-hmr` 的宿主行实测在工作（SSE 200 + graph 帧）。**置信度：高**（两处代码 + 一次活体 HTTP + 一次日志）。
- **`pnpm run dev:web` 限制的适用性**：本机**不存在** `dev:web`（`.workspace/settings-lag/audit-rebuild.md:148-152`）⇒ 该限制对本部署**不构成约束**；本部署的客户端 bundle 热重载走**宿主侧 stat 轮询**，与我们手工拷 `lib/` 这一动作天然兼容。**置信度：中高**（代码路径 + SSE 实测；未做"拷文件→观察自动重载"的破坏性实验，只读档不做）。

### 3.5 构建方式与**确切命令**【已验证】

- `dsh-btw/package.json` scripts：`build = tsdown`、`typecheck = tsc -p tsconfig.json && tsc -p tsconfig.client.json && tsc -p tsconfig.tests.json`、`test = vitest run`、`check = lint→typecheck→test→build→smoke→publint`。
- `tsdown.config.ts` 导出**两个** config：
  1. node 面：`entry { index: 'src/index.ts', 'typert.host': 'src/typert.host.ts', 'typert.remote-client': 'src/client/remote.ts' }`，`outDir: 'lib'`，**`clean: true`**；
  2. browser 面：`entry { client: 'src/client/index.ts' }`，`format: 'cjs'`、`outputOptions.entryFileNames: 'client.js'`、`clean: false`，banner `window.__ModuleLoader__.load({ id: "@local/dsh-btw", factory: … })`，并内联 CSS（`inlineCssPlugin` 把 `.module.css` 编成注入 `<style data-plugin-css=…>`）⇒ **CSS 改动必须重建**。
- `tsconfig.client.json`：`include: src/client/**/*.{ts,tsx}` + `src/shared/**/*.ts` + `src/remote-descriptors.ts`（`jsx: react-jsx`）。
- **确切构建命令**（在 `dsh-btw/` 下）：
  ```bash
  cd /home/CNS2026495165/dsh/dsh-btw
  pnpm build
  ```
  - 工具链在位【已验证】：`which pnpm` → `/home/CNS2026495165/.npm-global/bin/pnpm`；`node_modules/.bin/` 内有 `tsdown` / `vitest` / `tsc` / `oxlint` / `publint`。
  - ⚠️ **必须整包 build，不能只 build 客户端**：第一个 config 带 `clean: true`，会清空 `lib/`；第二个 config 才写 `client.js`。分步跑会把宿主面产物删掉。
  - 前置安全核对【已验证】：`find src -newer lib/client.js -type f | wc -l` = **0** ⇒ 当前 `src/**` 没有晚于已构建 `lib/client.js` 的改动，**重建不会顺带带上无关的在途改动**（这条每次部署前都要重跑；仓库当前 `git status` 显示 `dsh-btw/src/client/*` 有未提交改动，属正常在途状态）。

### 3.6 「改完 `dsh-btw/src/**` 之后让 http://127.0.0.1:3080 生效」分步 Runbook **草案**

> 前提纪律：本档**只写不跑**；下列命令由执行档在用户在场的安静窗口执行。全部命令无行尾空格。

**Step 0 — 判定面别（冷/热）【决定要不要重启】**
- 只改 `src/client/**`（含 `.tsx` / `.module.css`）⇒ **热面**：走 Step 1–4，**不重启 dsh**。
- 改了 `src/host/**`、`src/index.ts`、`src/shared/tool-policy.ts`、工具注册、settings schema、remote/typert 描述符、或 `package.json` 的 `dsh.client` ⇒ **冷面**：Step 4 之后**必须重启** `npx @deepseek-ai/dsh web`（依据 `docs/architecture/02-plugin-system.md:146`「`package.json` 的 `dsh.client` 声明变更 = 冷（需重启）」与 `:144`；宿主 `lib/*.js` 同为冷面）。
- **本修复大概率含冷面成分**：问答卡片若要与主会话一致、需新增 remote 字段或 typert 描述符，则属冷面 ⇒ 请根因档明确给出面别判定后再执行。【推断】

**Step 1 — 先取 pre-image（先于一切写入）**
```bash
mkdir -p /home/CNS2026495165/dsh/.workspace/btw-question/preimage-$(date +%Y%m%d-%H%M%S)
PRE=/home/CNS2026495165/dsh/.workspace/btw-question/preimage-$(date +%Y%m%d-%H%M%S)
cp -a /home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-btw/lib/. "$PRE"/
( cd "$PRE" && sha256sum * > SHA256SUMS.txt )
```
理由：notebook `:249`（D4）「btw 备份 ≠ live 态…回滚会连带退掉后续改动」+ arch04 `:184` 同警告 ⇒ **回滚目标必须现场取**，不得复用历史备份。

**Step 2 — 构建（在仓库内，写的是仓库 `lib/`，不碰线上）**
```bash
cd /home/CNS2026495165/dsh/dsh-btw
find src -newer lib/client.js -type f
pnpm build
sha256sum lib/client.js && md5sum lib/client.js && stat -c '%s %n' lib/client.js
```
第一步应**无输出**（无在途 src 改动）；若非空，先与用户确认是否一并上线。
构建后线上**仍未变**（resize 报告实测：重建仓库 `lib/` 不改变 served bytes）。

**Step 3 — 部署：只拷 `lib/`（双向拷贝纪律）**
```bash
cp -a /home/CNS2026495165/dsh/dsh-btw/lib/. \
      /home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-btw/lib/
```
不要拷 `src/`（部署位 `src/` 是 09-08 旧快照）；不要拷 `package.json`（除非确实改了 `dsh.client` 声明，那时属冷面且必须重启）。

**Step 4 — 生效（客户端面无需重启）**
```bash
curl -s http://127.0.0.1:3080/ | grep -o 'dsh-btw/client\.js?rev=[a-f0-9]*'
curl -s http://127.0.0.1:3080/plugins/@local/dsh-btw/client.js | md5sum
md5sum /home/CNS2026495165/dsh/dsh-btw/lib/client.js
```
- 第 2/3 行的 md5 **必须相等**（判据来自 `.workspace/lag-fix/exec-btw-resize/report.md:83`：`served bytes == 部署位 lib`）。
- 第 1 行的 `rev` 应**变成新 sha1 前 12 位**（`sha1sum lib/client.js | cut -c1-12`）——`?rev=` 就是内容哈希（§3.3），可作为"是否已换新字节"的最快判据。
- 然后**刷新浏览器一次**。宿主侧 stat 轮询（500 ms）可能已自动热重载（notebook §8.3 已抓帧确证），但按纪律**仍刷新一次**并把刷新次数批次化（arch05 `:157`「改完需刷新一次页面」）。
- 提示用户：刷新期间若出现 D18 形态的偶发空白，已知已修；仍建议在安静窗口操作。

**Step 5 — 行为自证 + 回滚钩子**
- 行为自证（可复制，命令与判据取自既有批次）：
  ```bash
  node -e "const h=require('fs').readFileSync('/home/CNS2026495165/dsh/dsh-btw/lib/client.js','utf8');console.log('has QuestionCard marker:', /pendingQuestion/.test(h))"
  ```
  （仅作冒烟；真正的行为验收在 GUI 侧，见 §4.4 建议清单。）
- 回滚：
  ```bash
  cp -a "$PRE"/. /home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-btw/lib/
  ```
  若改了宿主面或 `dsh.client`，回滚后需**再重启一次** `npx @deepseek-ai/dsh web`。

**每步置信度标注**

| 结论 | 证据 | 置信度 |
| --- | --- | --- |
| 部署位是实体拷贝，改 `src` 不自动上线，必须 build+拷 `lib/` | §3.2 五条实测 | **高** |
| 只拷 `lib/` 即可（`src/` 无用、CSS 需重建） | `.workspace/lag-fix/exec-btw-resize/report.md` §6.2 + 本档 `ls` | **高** |
| 客户端面改完**不需要**重启 dsh，刷新即生效 | arch02 `:144`/`:146` 冷热矩阵 + FEATURE-MAP `:69`「插件 `lib/client.js` 替换后刷新浏览器即生效，无需重启宿主」 | **高** |
| 插件 bundle 响应带 `cache-control: no-cache` ⇒ 普通刷新足够 | 本档 `curl -sI` 实测 | **高** |
| 宿主面 / `dsh.client` 声明变更**必须重启** | arch02 `:146`；notebook/arch 多处方 | **高** |
| `?rev=` = sha1[:12] 内容哈希（不是 md5） | `dsh-client-modules/lib/index.js:147` + 本档 sha1 实测 | **高** |
| 宿主侧 HMR watcher 在跑（500 ms stat 轮询） | 代码 + `/plugins/events` 200 实测 + notebook §8.3 抓帧 | **中高**（未做破坏性"拷文件观察自动重载"实验） |
| 本次修复是否含冷面成分 | 取决于修法 | **未验证**（需根因档判定） |

---

## 4. 测试面现状与建议验证命令

### 4.1 盘面【已验证】

- `dsh-btw/tests/` 下 `*.spec.ts` / `*.spec.tsx` 共 **25 个文件 / 5 851 行**（`ls | wc -l` = 25）⇒ **`docs/architecture/04-ops-deploy.md:194` 写的"24"已漂移**（该行还引用了历史基线"24 files / 231 passed / 2 skipped"）。
- 配置：`dsh-btw/vitest.config.ts` = `{ test: { include: ['tests/**/*.spec.{ts,tsx}'], passWithNoTests: false } }`（**无 retry / 无 quarantine / 无 globals**）；`package.json` 的 `test` = `vitest run`；实测 vitest 版本 `^4.1.8`（devDependencies），`node_modules/.bin/vitest` 在位。
- 跑测试命令：
  ```bash
  cd /home/CNS2026495165/dsh/dsh-btw
  pnpm test
  ```
  或（既有批次用过、更可控）：
  ```bash
  cd /home/CNS2026495165/dsh/dsh-btw
  node_modules/.bin/vitest run --reporter=dot
  node_modules/.bin/vitest run tests/host-opening.spec.ts
  ```

### 4.2 关键用例覆盖了什么（与本次相关的两块）

| 文件 | 覆盖 | 与"问答卡片"的关系 |
| --- | --- | --- |
| `tests/tool-policy.spec.ts`（34 行 / 7 个用例） | `:9` 放行 `read/glob/grep/web_search/run_code`；`:10-13` **放行插件自有 `btw_ask_user`** 且 `READ_ONLY_TOOL_SET.has('btw_ask_user')`；`:14-16` 拒 `write/edit/bash/ssh_exec/subagent/mnemon_remember/**ask_user_question**`；`:18-20` `btw_ask_user` **不得**进全局候选表（scoped registration）；`:22-24` 候选无重复；`:29-32` `read_image` + `analyze_image` | **只覆盖"工具是否被允许调用"，完全不覆盖卡片渲染** |
| `tests/host-opening.spec.ts`（487 行） | 宿主侧打开/冷恢复/**admission 时序**：`:131` "acknowledges start before child creation settles" 等 | 与问答卡片 GUI 无关 |
| `tests/side-chat-surface.spec.tsx`（699 行 / 25 个用例，唯一 `describe('SideChatSurface controls')` 于 `:97`） | 与工具卡最近的两条：`:563`「renders tool digests as DisclosureRows with running state and IN/OUT fold」、`:595`「marks errored tool digests with an error summary」；其余为 composer/End 确认/焦点/图片 rail/banner/模型选择器 | **无任何 `QuestionCard`、`pendingQuestion`、选项点击、选中态保持的用例**（`grep -n "QuestionCard\|questionCard\|pendingQuestion" tests/side-chat-surface.spec.tsx` **零命中**） |
| `tests/controller.spec.ts:581-624` | 「surfaces the pending question from reads and submits answers through the answer remote」+ `:625`「rejects answers when no question is pending」 | **只测数据通道**（读 `pendingQuestion` / `answer()` 提交），**不测渲染与选中态** |
| `tests/remote-contract.spec.ts:36-47` | pendingQuestion 的 schema 投影 | 同上，数据层 |

**结论【已验证】**：**问答卡片的客户端渲染、选项点击与"选中颜色持久"在现有测试里零覆盖**。若本次修复改 `SideChatSurface.tsx` 的 `QuestionCard` / drafts 状态，**必须新增用例**（否则按 `dsh-btw/package.json` 的 `check` 门也拦不住回归）。

### 4.3 notebook D11「btw vitest 存在负载敏感 flake（已加固）」——**当前盘面核实**

| 核实项 | 结论 |
| --- | --- |
| 加固代码是否仍在 | **仍在**【已验证】：`tests/host-opening.spec.ts:146-153` 注释「Bound the wait by wall-clock, not by a fixed number of event-loop turns… observed once at 2026-09-17 17:54 under concurrent load, while 3/3 full-suite re-runs and 10/10 isolated runs passed」；`:153-156` `const settleDeadline = Date.now() + 10_000` + `while (!settled && Date.now() < settleDeadline) await new Promise(resolve => setImmediate(resolve))` |
| 「已加固」是否准确 | **准确**：断言已从"固定 100 tick 轮询"改为 wall-clock 10 s 条件等待，语义不变（注释明写 `child` stays pending throughout） |
| 行号是否漂移 | **漂移**：notebook `:256` 与 `FEATURE-MAP.md:56` 都写 `host-opening.spec.ts:145`，**现盘面相关行为 `:146-156`**（`:153` 是 deadline 行，也是历史上失败断言的行号） |
| 是否仍"负载敏感" | **是**【推断，未跑】：`vitest.config.ts` **无 retry**，加固只把窗口从"100 tick"放大到"10 s wall-clock"；若并发把一次 fs 往返拖过 10 s，仍会失败。因此"**不得写成测试全绿**"的口径继续有效 |
| 与 D11 正文的差异 | arch04 `:202` 的原始记录是"首跑 1 failed、隔离 10/10、全量复跑 3 次全绿"，与 `.workspace/reports/execs/acceptance/acceptance-exec.md:213-232` 一致（该节记录了 `Test Files 1 failed \| 23 passed (24)`、`Tests 1 failed \| 230 passed \| 2 skipped (233)` 与 `PASS=10 FAIL=0`）⇒ **D11 的口径是准确的、可复核的**，只是**文件数/行号需按现盘面更新**（24 → 25） |

**本档未跑任何测试**（只读纪律）；上述为**读配置 + 读用例**所得，不含实测结果。

### 4.4 建议的验证命令清单（交给执行/复核档）

```bash
# 1) 现状基线（改动前）
cd /home/CNS2026495165/dsh/dsh-btw && git status --porcelain . && ls tests/*.spec.* | wc -l
# 2) 静态门（lint + 三个 tsconfig 类型检查）
cd /home/CNS2026495165/dsh/dsh-btw && pnpm lint && pnpm typecheck
# 3) 新增用例应落在（按现有风格）
#    tests/side-chat-surface.spec.tsx —— 问答卡片渲染 + 选项点击后选中态保持
#    tests/controller.spec.ts —— 若 draft 状态上移到 controller/view-store
# 4) 全量 + 单文件隔离（D11 口径：报"隔离 X/X、全量 N/N"，不要写"全绿"）
cd /home/CNS2026495165/dsh/dsh-btw && node_modules/.bin/vitest run --reporter=dot
cd /home/CNS2026495165/dsh/dsh-btw && node_modules/.bin/vitest run tests/side-chat-surface.spec.tsx
# 5) 构建 + 部署 + 生效（见 §3.6 Step 1-4）
```

---

## 5. 未验证项（本档明确不声称）

1. **未跑测试、未跑构建**（只读纪律：`tsdown` 第一个 config `clean: true` 会清空 `lib/`，属写入）。§4 的"测试面"结论均为读配置与读用例所得。
2. **未能调用 `check_notebook`** —— 本会话工具清单里**没有**该工具（`program-notebook` skill 提到它，实际不可用）；故 §2 的判定是**基于 skill 条款 + notebook §9 原文**的人工判定，不是 `check_notebook` 报告。
3. **"问答工具卡片"的确切所指未确证**：可能是 `SideChatToolRow.tsx`（工具行近似层）或 `SideChatSurface.tsx:60` 的 `QuestionCard`（问题卡）。两者都在 `src/client/**` ⇒ **面别都是热面**，Runbook 的 Step 1–4 对两者同样适用；但若修法改动 remote/typert 描述符则会变成冷面。**需根因档给面别判定。**
4. **未做破坏性 HMR 实验**：没有"拷一份 client.js 观察是否自动热重载"。§3.4 的"自动热重载"来自代码路径 + SSE 活体探测 + notebook §8.3 的既有抓帧，**不是本档现场复现**。
5. **`dsh-client-hmr` 宿主行是否由某层 patch 显式启用未逐层解析**：`@deepseek-ai/dsh-web-app/cordis.patch.yml:22-23` 有 `- id: hmr / disabled: true`（本档判定它指向通用 `@deepseek-ai/cordis-plugin-hmr`，依据是同名日志 `dsh-host.jsonl` 的 `{"name":"hmr","msg":"watching []"}`——但"被 disabled 的行为何仍打日志"这一点**未解释**）。不影响 §3.4 结论（`/plugins/events` 实测 200 是决定性证据）。
6. **`rev` 与浏览器 HTTP 缓存的实际交互未测**：`cache-control: no-cache` 已在响应头实测，但"用户浏览器是否真的取到新字节"未做端到端复现（只做服务端 `curl`）。
7. **`docs/architecture/04-ops-deploy.md:194` 的"24"是否为笔误**未追溯；本档只如实报现盘面 **25**。
8. **notebook §7 下一个可用 D 编号**：本档实测最大编号 = **D28**（`grep -o "| D[0-9]* |" docs/program-notebook.md | sort -n | tail`）⇒ 新条目应为 **D29**；但若并行档同时新增条目会冲突，实施前须复核。

---

## 附：本档执行过的只读命令（可复核）

```bash
grep -rn "问题卡\|问答\|questionCard\|btw_ask_user" docs/
grep -n -i "btw" docs/program-notebook.md docs/architecture/*.md docs/runbooks/verify-runbook.md FEATURE-MAP.md
grep -n -A6 -B2 "btw" ~/.dsh/profiles/web/cordis.patch.yml
ls -la ~/.dsh/profiles/node_modules/@local/ && readlink -f ~/.dsh/profiles/node_modules/@local/dsh-btw
diff -rq dsh-btw/lib ~/.dsh/profiles/node_modules/@local/dsh-btw/lib
md5sum dsh-btw/lib/client.js && sha1sum dsh-btw/lib/client.js && stat -c '%i %h %s %n' dsh-btw/lib/client.js
curl -s http://127.0.0.1:3080/ | grep -o 'dsh-btw/client\.js?rev=[a-f0-9]*'
curl -s -o /tmp/served-btw-client.js -w '%{http_code} %{size_download}' http://127.0.0.1:3080/plugins/@local/dsh-btw/client.js
curl -sI http://127.0.0.1:3080/plugins/@local/dsh-btw/client.js
curl -sI http://127.0.0.1:3080/assets/index-ClqxG24t.js
timeout 3 curl -s -N http://127.0.0.1:3080/plugins/events
find dsh-btw/src -newer dsh-btw/lib/client.js -type f
ls dsh-btw/tests/*.spec.*; wc -l dsh-btw/tests/*
grep -n 'watching' ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis-plugin-hmr/lib/index.js
python3 -c "…解析 /tmp/boot-page.html 的 __DSH_BOOT__…"
```
（未执行任何写操作、未重启、未 kill；`curl` 全为 GET。）
