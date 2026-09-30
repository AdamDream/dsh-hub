> **本工单不含会话正文、密钥、原始会话 id。** 会话一律以 `<session>` 占位，凭据只出现 env 变量名。
> 本工单由「只读汇编」产生：未修改任何既有报告、未改产品代码、未写 `~/.dsh/**` 与 `~/.dsh-017/**`、未启动监听端口、未发起模型请求、未使用 `sandbox_permissions`。

# STAGE2-WORK-ORDER —— DSH 0.2.0 迁移阶段二执行工单

**版本**：v1（汇编档，去重 + 裁决 + 依赖排序）
**目标版本**：`@deepseek-ai/dsh@0.2.0-rc.1`（npm `next`；**不存在稳定 0.2.0**）
**现役保护**：`3080`（0.1.1-rc.2）全程不动；本工单**不含任何切换现役的动作**。
**权威上位件**：`MIGRATION-ASSESSMENT.md`（裁决）→ `RUNBOOK-020.md`（执行底座）→ 本工单（去重后的单元与批次）。
**冲突消解原则**：① `MIGRATION-ASSESSMENT.md` 的裁定优先；② 部署件实测优先于源码树口径；③ 二者都不覆盖时，按「文件边界 + 独立实测」就地裁决并写明被否一方。

---

## 0. 本工单的读取顺序与使用方式

1. 先读 **§1 执行前置**（含 3 条**本工单新增的前置裁决**，未确认不得开工）。
2. 再读 **§2 工单总表**（逐单元一行；`[条件]` 标记的单元须先满足其前置裁决才派工）。
3. 按 **§3 批次** 派发；每批结束**必须**跑 **§4 该批停止条件**，未过不得进下一批。
4. **§5 不派工清单**里的面**一律不派**（等用户裁决）。
5. **§6 未验证项**是证据缺口台账；执行档不得用推测填充，缺证据就回问协调者。

---

## 1. 执行前置

### 1.1 必须已完成的裁决（开工闸门）

| # | 必须已完成的事 | 状态依据 | 未完成时的处置 |
|---|---|---|---|
| G0-1 | **目标版本锁定 `0.2.0-rc.1`**（`dist-tags.next`；无稳定 0.2.0） | `MIGRATION-ASSESSMENT.md` §1 | 停；若上游已发稳定 0.2.0，替换 Runbook `VERSION` 变量后重跑全部闸门 |
| G0-2 | **现役 3080 / 隔离 3097 未被触碰**，且已取当前配置指纹 | Runbook §1.3 | 停；先取指纹 |
| G0-3 | **现场备份完成且 `SHA256SUMS` 行数与文件数一致** | Runbook §2.1–2.4 | 停；先备份 |
| G0-4 | **隔离根在工作区内**（家目录只读 EROFS，`~/.dsh-020` 不可用） | Runbook §0 | 若在真实宿主 shell 执行，允许 `~/.dsh-020` 同形布局；Runbook §0 已给说明 |
| G0-5 | **已跑通一次 0.2.0 组合**（`assembly-020` 即该实证组合） | Runbook 附「已实测通过的部分」：`--dump-config` 199 条、启动成功、HTTP 401/303、`disabling` 6→0 | 未跑通则先按 Runbook §3–§7 复现 |
| G0-6 | ★**本工单新增**：**插件来源根裁决**（见 §1.3-A） | 本工单实测（§1.3-A 证据段） | **停**；取错根会把已修插件退回未修状态（7 个插件而非 3 个） |
| G0-7 | ★**N17 选项 (c) 的数据面纪律已并入执行前提**（用户 2026-09-29 明示「选c」） | `MIGRATION-ASSESSMENT.md`（末章「✅ 用户裁决：选项 (c)」）+ `.workspace/audit-020/reports/{CUTOVER-PLAN-dual-instance.md, OPTION-C-VERIFICATION.md}` | **停**；四条纪律见 §5-1，其中**「0.2.0 新根不得承载历史语料」直接废止 Runbook §8.3 的"复制会话到隔离根"动作**（命令见 §4.1 `V-1.7`） |

### 1.2 已由协调者实测裁定、**不得重开**的事项（照录，直接采纳）

以下 4 条为**结论性裁定**，执行档**不得重新论证**，只能按此落地：

**(1) N10 = 采纳方案 B（丢弃私有依赖岛）。** 三条前提已查清：
- ① cordis 4.0.4 **允许** `ctx.set` 顶掉官方已 provide 的服务（后注册者胜，child fiber 的 set 会覆盖根）；
- ② `dsh.client.inject` 是**信息性字段**（`dsh-package-manifest/lib/types/types.d.ts:79` 原文 "Informational package-name dependencies, not Cordis service injection"；`dsh-client-modules/lib/index.js:66-67` 走 `optionalStringArray`，不校验包是否存在），**缺包名不导致加载失败**；
- ③ 私有岛**随包分发、不被安装期重建**，岛内钉死 `0.1.1-rc.2`（`dsh-workspace-enhancement` **66** 项、`@local/dsh-pptmaster` **23** 项）⇒ 保留岛＝永久 0.1.1 语义 + 无法满足 0.2.0 新契约 ⇒ **必须丢弃**。

**(2) 口径纪律（三条，全文强制）**
- 凡「**是否变化**」一律以 **`lib/` 逐文件**为准；整树口径**只能**用于「发布物是否重打」。
- 本节及总表须为**每一条单元**注明依据类型：`[lib全等推定]` / `[源码实读]` / `[部署件实测]`。
- 凡「契约点是否可用」，仅 `[源码实读]` 与 `[部署件实测]` 可单独支撑改造结论；`[lib全等推定]` 只能用于**缩小排查面**（`T26 §8.0` 的 A/B 分级）。

**(3) 部署件优先级（关键，直接决定工作量）**
- `btw` / `ssh-gui` / `wallpaper` / `workerspace` 四个插件的**部署件已在上轮改造过**，**不得按源码树派重复劳动**；
- settings 断层（N1）**只阻塞 3 个**：`@local/dsh-subagent-model`、`@deepseek-ai/dsh-session-board`、`@deepseek-ai/dsh-vision-adam`；
- `dsh-taste` 图标已由协调者修好（`OutlineRegular`）。

**(4) N17 会话面 —— ⚠️ 用户已裁决为「选项 (c)：双实例并存、零数据改写」（2026-09-29 明示「选c」）。**
原三项待裁决（保留 0.1.1 / 自研映射器 / 报官方）**已收敛**。已实测的量化事实（**不得重开**）：0.2.0 下仅 **3%** 旧会话可读；修 descriptor `2→3` 后到 **60%**；余 **40%** 卡在 0.1.1 的**顶层打包行**（`text-chunks`/`reasoning-chunks`/`tool-call-chunks`）——机制根因是 packing 实现**从 `dsh-session` 顶层行迁移到 `dsh-llm` 的 `event.data.stream`，且旧位置解码器被移除**。
**⇒ 在 (c) 形态下，本面不再是「等待裁决」，而是 4 条强制数据面纪律（见 §5-1 与 G0-7）**；另有 1 项并行动作 **(b2) 报官方 issue**（唯一能让未来任意版本都读得懂历史的路径）。**本工单不派「会话迁移/正规化」单元。**

### 1.3 本工单新增的前置裁决（3 条，均由本档独立实测得出）

> 这 3 条**不是重开**已裁定事项，而是把已裁定的口径**钉到具体制品/具体路径**上，否则执行档会照错的对象施工。

#### A. ★插件来源根裁决：必须从「已迁移件」复制，**不得**从 `~/.dsh/profiles/node_modules` 复制

**实测（本档，只读）**：同一插件在两棵「部署根」上是**不同制品**，且改造状态相反：

| 插件 | 已迁移组合 `assembly-020/home/profiles/node_modules/…`（我实测） | 0.1.1 现役根 `~/.dsh/profiles/node_modules/…`（T04 §9.4b / T17 §4.1-4.2 实测） |
|---|---|---|
| `@local/dsh-btw` | `lib/index.js` = `64435358eec0`；无 settings 具名导入 | `lib/index.js` = `9634c6eac09b`；**import `settingsNamespace` + `settings.register()`** |
| `@local/dsh-ssh-gui` | `lib/index.js` = `e060db973451`；符号命中**全在块注释内** | `lib/index.js` = `ccb51fafbdf4`；真 import，动态复现 `SyntaxError: does not provide an export named 'installSettingsSection'` |
| `@local/dsh-workerspace` | `lib/index.js` = `839116b37531`；符号命中**全在块注释内** | `lib/index.js` = `4362201dacb9`；真 import，同型 `SyntaxError` |
| `@local/dsh-web-search-sse` | `lib/index.js` = `5947d0909550`（**已修版**） | `lib/index.js` = `88d6387e351a`（**坏副本**；T04-A1 要求替换） |
| `@local/dsh-wallpaper` | `client.js` = `e3000eeb6dfa`，`Outline16`=0，`dsh-client-runtime` 命中 1（**注释**） | T28：仍是 0.1.1 时代产物（`settingsScope` + `dsh-client-runtime` 双双存在）⇒ 直接复制**必然整插件加载失败** |
| `@local/dsh-pptmaster` | `client.js` = `d21906483454`，`Outline16`=0 | `e2b5d28b…`（旧图标时代） |

**⇒ 裁决**：
1. **「N1 只阻塞 3 个」成立于「已迁移件」口径**（`assembly-020` / U 组合），与 `PLUGIN-MATRIX.md` §口径声明一致；
2. **Runbook §2.3 / §4.2 / §4.4 的复制源写的是 `~/.dsh/profiles/...`（0.1.1 现役根）**，按该路径复制会把 `btw`/`ssh-gui`/`wallpaper`/`workerspace`/`usage`/`web-search-sse` **退回未修状态**（T04 §9.4b 实测爆炸半径为 **7/9**）；
3. ⇒ **执行档开工第一件事**：确认 `<新home>/profiles/node_modules/` 下的 13 个插件与 `assembly-020`（或等价的已迁移件树）**逐文件一致**；命令见 §4-批次1 停止条件 `V-1.x`。
4. **`~/.dsh/profiles/node_modules/@local/dsh-web-search-sse` 无论走哪条路都必须换成 `5947d0909550`**（T04-A1，坏副本是现役部署面事实）。

#### B. ★btw 迁移基线裁决：**工作区源码 ≠ 已迁移部署件，二者已分叉**

**实测（本档，只读）**：

| 制品 | `lib/client.js` sha256(前12) | `Outline16` 命中 | `dsh-client-runtime` 命中 | `lib/index.js` | `settingsNamespace` |
|---|---|---|---|---|---|
| 工作区 `dsh-btw/` | `078ef49d3940` | **18** | **14**（`src/`）+ **2**（`lib/`） | `75e7416f27ed` | `src/index.ts` 2 处 |
| 已迁移部署件 `assembly-020/…/@local/dsh-btw` | `606f53f13f61` | **0** | **0** | `64435358eec0` | 无 |

**⇒ 裁决**：
- `MIGRATION-ASSESSMENT` §「协调者实测更正」判「**N16 中客户端图标与 `dsh-client-runtime` 两项已不成立**」——该判定**只对已迁移部署件成立**（我复核：0/0 ✅）。**工作区源码上这两项仍然成立**（18/14，我实测）。
- `T30 §1.4` 判「**迁移基线必须取工作区源码，不是部署件**」——该判定**未被 `MIGRATION-ASSESSMENT` 采纳**，且与「部署件优先级」纪律冲突。
- **本工单裁决**：**btw 基线 = 已迁移部署件（`606f53f1…`）**，理由：① 它是 `assembly-020` 实证组合里真实加载并通过宿主半 import 的件；② 它已含上一轮改造，符合「部署件优先、不得派重复劳动」；③ 工作区源码的 `lib/client.js` 与部署件**互不相等**，回灌方向未定，不能默认工作区为超集。
- **被否一方**：`T30 §1.4`（"工作区是超集、部署件落后 40 小时"——该结论是对**0.1.1 现役部署根**对账得出的，**不适用于已迁移组合件**）。
- ⇒ 影响：`T30-U02/U03/U13/U14` 与 `T04-A4(btw 部分)/A5(btw 部分)` 全部降级为 `[条件]`（见 `B-08`）；`T30-U05/U06/U16`（settings 面）同样降级为 `[条件]`（见 `B-02`、`B-10`）。
- **未验证（必须补）**：工作区 `dsh-btw/` 与部署件 `606f53f1…` 的**双向差集**未做（补齐方式见 §6-UV-02）；若执行档选择「工作区源码」路线，必须先把 `B-08` 的两项做掉，不能跳过。

#### C. ★`dsh-client-runtime` 残留的精确形态：**部署件里的残留全是注释，不是 `require`**

**实测（本档，只读）**：
- `@local/dsh-wallpaper/lib/client.js:17` → `// C-R5: 0.1.7 dropped the '@deepseek-ai/dsh-client-runtime' package entirely;`（注释）
- `@deepseek-ai/dsh-taste/lib/client.js:185` → 注释中引用 `dsh-client-runtime lib/client.js:9233` 作为行号出处（注释）
- 两者 `grep 'require("@deepseek-ai/dsh-client-runtime'` 均 **0 命中**。

**⇒ 裁决**：
1. `MIGRATION-ASSESSMENT` 表里 wallpaper「`dsh-client-runtime` 残留 1（待修）」**是注释**，**不构成加载风险**；真正的待修项在 `package.json` 的 `dsh.client.inject`（T28-MU1 / T28-MU5）。
2. **新增发现（本档）**：`@deepseek-ai/dsh-taste/lib/client.js` 亦存在 **1 处同类注释残留**，`MIGRATION-ASSESSMENT` 的残留表**未登记 taste**。该残留**同样无功能影响**，只影响 T26-U3（可选声明清理）的计数口径。
3. ⇒ 任何以「`grep dsh-client-runtime` 命中数」作判据的验收，必须**排除注释行**，否则会重复计入 2 个假阳性。

### 1.4 依据类型标注表（全文使用）

| 标记 | 含义 | 判定力 |
|---|---|---|
| `[lib全等推定]` | 该包 `<pkg>/lib` 在 0.1.7↔0.2.0 逐文件 sha256 相同 | ❌ 不可单独支撑改造结论，只用于缩小排查面 |
| `[源码实读]` | 直接读 0.2.0 的 `lib/**` 源码 / 类型 / 导出名集合得出结论 | ✅ 可单独支撑 |
| `[部署件实测]` | 对本组合**部署件**（`assembly-020`）或现役制品逐文件实测 | ✅ 可单独支撑，且**优先于源码树口径** |
| `[未核]` | **本档未亲自读到该出处**（多为 T07/T31 原文） | ❌ 不得据此派工，须先补读 |

> **诚实披露**：本档的 0.2.0 源码行号**全部转引自被汇编的报告**，本档未重新打开 0.2.0 安装树逐行复核。凡标 `[源码实读]` 者，指「该出处报告的作者实读了源码」，出处已逐条给出。**本档亲自实测**的部分一律标 `[部署件实测]` 或在工作区路径下实测并注明。

---

## 2. 工单总表

### 2.0 计数（去重前 → 去重后）

| 来源档 | 自报交付单元数 | 编号体系 | 本工单处置 |
|---|---|---|---|
| `T30-btw-compat-020.md` | **21** | U01–U21 | 合并为 15（`B-01..B-15`），其中 6 条降级 `[条件]` |
| `T24-workspace-enhancement-units.md` | **19** | U01–U19 | 原样保留（`W-01..W-19`），+3 条 T17 合并项 |
| `T17-ssh-remote-workspace-020.md` | **8** | U-1–U-8 | 3 条并入 T24（`W-20`）/ 1 条撤销（`W-23`）/ 2 条独立（`W-21/W-22`）/ 2 条并入批次 2 |
| `T26-taste-compat-020.md` | **7** | U1,U1b,U2–U6 | 合并为 6（`T-01..T-06`），U1 已闭环 |
| `T28-wallpaper-theme-compat.md` | **5** | MU1–MU5 | 原样保留（`WP-01..WP-05`） |
| `T04-plugin-api-compat.md` | **7** | A1–A7 | 拆并入 `P-01..P-06`；A4/A5 降级 `[条件]` |
| `T04-plugin-api-compat.md` §1.4 键漂移 | **6** | 6 处 entry id ≠ 命名空间 | 合并为 1 条（`P-06`） |
| `T13-subagent-model-routing-compat.md` | **20** | A1–A11 + P1–P9 | 并入 `P-01/P-02/P-07` 与 `C-05/C-10/C-11` |
| `T15-office-feature-020.md` §5.3 | **5** | 最小动作集 1–5 | 合并为 `O-01/O-02/O-03`+`O-04`；图标项撤销 |
| `T06-proposed-cordis.patch.020.yml` | **16** | 生效条目 | 拆为 `C-04..C-11`；`C-14` 为条件项 |
| `MIGRATION-ASSESSMENT.md` §N13（T07 派生） | **6**（本档归纳） | — | `G-01..G-06`（**`[未核]`**：T07 原文未读） |
| **去重前合计** | **120** | | |
| **去重后合计** | **82** | `C-01..C-14` / `P-01..P-08` / `B-01..B-15` / `W-01..W-23` / `WP-01..WP-05` / `T-01..T-06` / `O-01..O-04` / `G-01..G-06` / `D-01` | 合并/撤销 **38** 组 |
| 其中：**派工单元** | **76** | | |
| 其中：**登记/否决/已闭环（不产生动作）** | **7** | `C-14`、`W-23`、`T-01`、`T-02`、`T-06`、`O-04`、`D-01` | |

**冲突裁决条数 = 10**（逐条见 **§2.7 冲突裁决台账**；其中 9 条已就地裁决，第 10 条登记待用户裁决）。

### 2.1 批次一览（先看这里）

| 批次 | 主题 | 含单元 | 可否并行 | 前置 |
|---|---|---|---|---|
| **批次 1** | 组合层与装配层（patch / config / compatibility / 插件来源根） | 14 | ❌ 必须最先且串行 | G0-1…G0-6 |
| **批次 2** | settings 断层 + 声明面（3 插件 / 键漂移 / web-search-sse / N2） | 8 | ✅ 与批次 3、4 并行 | 批次 1 的 `C-05`/`C-04` |
| **批次 3** | `@local/dsh-btw` 宿主与客户端面 | 15 | ✅ 与批次 2、4 并行 | 批次 1 + §1.3-B 裁决 |
| **批次 4** | `dsh-workspace-enhancement` + ssh 族 | 23 | ✅ 与批次 2、3 并行 | 批次 1 + `W-20` 基线裁决 |
| **批次 5** | wallpaper + taste + office + 工具链/文档 收尾 | 22 | ⛔ 内部再分 4 条互不重叠的并行子链 | 批次 1–4 全绿 |

**全局终验（非批次）**：Runbook §11 的 V1–V12 逐条 + 本工单 §4-终验。**已按 N17 选项 (c) 修订**：Runbook 的 `V9`（会话逐字节 diff）**已废止**；`V12`（老会话可继续）**只在 0.1.1 侧有意义**，**不得**在 0.2.0 侧宣告。**具体替代判据见 §4.6 终-5。**

### 2.2 工单总表 — 批次 1｜组合层与装配层

> 文件边界：`<新home>/profiles/web/{cordis.patch.yml, package.json, compatibility.json}` + `<新home>/profiles/node_modules/**`。**本批是全工单唯一写入 patch 层的地方**，批次 2–5 不得改 patch（只读引用）。

| 单元号 | 归属插件/面 | 文件·位置 | 现状 | 改为 | 依据类型与出处 | 验收标准 | 依赖单元 | 风险 |
|---|---|---|---|---|---|---|---|---|
| **C-01** | 组合层 / OTel | `<profile>/cordis.patch.yml`（或 profile `package.json` 的 `dsh.profile.bundles`） | 0.1.7/0.1.1 组合无 `otel` 行 | 新增 `- id: otel` / `name: '@deepseek-ai/dsh-otel'`；确认 `session-telemetry-otel` 的 `inject` 能解析到它 | `[源码实读]` MIGRATION-ASSESSMENT §4-A1（我实读）；`[部署件实测]` 我实测 `assembly-020` 已含 `dsh-otel` | `--dump-config` 条目数 = 199；`grep -c '^- id: otel'` ≥ 1；启动无 service 解析失败 | — | **高**：漏挂是**加载失败**而非静默降级 |
| **C-02** | 组合层 / 遥测观测 | `--dump-config` 输出核对；`<profile>/cordis.patch.yml` 无需改 | 默认端点 `harness-telemetry.deepseeksvc.com`；无 `maxRequestBytes` | 记录新默认 `dsh-otel-collector.deepseeksvc.com` 与新键 `maxRequestBytes`；**本机离线执行必须显式 `DSH_TELEMETRY_MODE=DISABLED`** | `[源码实读]` MIGRATION-ASSESSMENT §4-A2 + §N4（我实读） | `dump-config` 中 `session-telemetry-otel.exporter.url` 指向 collector；启动前 env 含 `DSH_TELEMETRY_MODE=DISABLED` | C-01 | 中：**卸载/drain 时点是潜在外呼点** |
| **C-03** | 组合层 / Web 组合 | `<profile>/cordis.patch.yml` | 0.1.7 组合含 `time-context` / `schedule` / `ui-schedule` 三行 | 撤 3 增 3：删三行；增 `otel`、`desktop-product-telemetry`（desktop 门控）、`product-analytics`（desktop 门控）、`ui-settings-session-log`（Web **无条件**启用） | `[源码实读]` MIGRATION-ASSESSMENT §4-A3 + `dump-017/020.txt` diff（Runbook §5.1） | `diff -u dump-017.txt dump-020.txt` 的差异面**恰好**是上述 6 项 | C-01 | 中：脚本化「自动化任务」升级后默认不可见 |
| **C-04** | 组合层 / 本地插件挂载 | `<profile>/cordis.patch.yml` 的 `insert` 段 | 现役 patch 的 insert 行 | 按 T06 §A 落 `btw` / `wallpaper` / `usage` / `ssh-gui` / `logfile`（含 `logfile.config` 四键）等 insert 行 | `[源码实读]` `T06-proposed-cordis.patch.020.yml:24-44`（我实读）；`[部署件实测]` `assembly-020` patch 636 行 | 每行 `id`/`name` 在 `--dump-config` 中可见；`grep -c 'row .* not found'` = 0 | C-13 | 中：`config` 是**整体替换**，覆盖须复述全键 |
| **C-05** | 组合层 / preset 注册表 | `<profile>/cordis.patch.yml` 的 `- id: agent-presets` 行 | 旧 id `agent-presets`（0.1.1 写法） | 改为 `- id: agent-preset-registry` / `name: '@deepseek-ai/dsh-agent-preset-registry'` / `config: {default: standard-glm}` | `[源码实读]` MIGRATION-ASSESSMENT §N3-2 + `T06:48-52` + `T13 §6.1-P2`（我实读三处） | 启动无 `patch: entry 'agent-presets' not found` warn；`defaultId` 解析为 `standard-glm`；花名册该项 `isDefault: true` | C-10 | **高**：旧 id 静默不命中 ⇒ `default: standard-glm` 失效、回落官方 `standard` |
| **C-06** | 组合层 / 定向覆盖 | `<profile>/cordis.patch.yml` 的 5 条 `- id: …` 定向行 | 0.1.7 层写法 | 逐行覆盖并**复述该行全部键**：`ui-settings-general.welcomeNoticeVersion`、`ui-theme.preference: light`、`agent-default-model.{provider,model}`、`web.{searchProvider,fetchProvider}`、`web-search-deepseek.{apiKeyEnv,baseURL,maxUses,model}` | `[源码实读]` `T06:53-80`（我实读，含"`config` 整体替换"语义与 `apiKeyEnv` 必须补回） | 5 条 id 全部命中；覆盖后**未被截断的键**仍具原值（尤其 `web-search-deepseek.apiKeyEnv`） | — | **高**：漏复述键 ⇒ 该键静默丢失 |
| **C-07** | 组合层 / connection 行 | `<profile>/cordis.patch.yml` 的 `- id: connection` | 静态 `inject` 为 `["credentials"]`，web-app 层覆盖为 `[webRuntime]` | 本层写 `inject: [webRuntime, webServer]`（entry 层与静态层取并集，**故不写 credentials**） | `[源码实读]` `T06:93-99`（我实读） | `dump-config` 中 `connection.inject` 含 `webServer` | — | 中：影响 `/dsw`、`/ssh-gui` 等前缀通道可用性（**与 §5-3 的 405 悬置项联动**） |
| **C-08** | 组合层 / 目录选择器 | `<profile>/cordis.patch.yml` 的 `directory-picker` 段 | 现役：`:72-73` 禁官方 `directory-picker`；`:74-76` insert `directory-picker-browse`；`:79-80` 禁自己的 `directory-picker-ssh` | 保留三条 disable 命中（被禁 id 在 0.2.0 **仍存在**）；逐条确认三条部署决策是否仍需保留 | `[源码实读]` `T06:82-91` + `T24-U19` + `T17 §4.4`（我实读三处） | 启动后 `ctx.directoryPicker` **只有 1 个注册者**；SSH 目录浏览 UI 可用 | — | 中：重复注册会报错 |
| **C-09** | 组合层 / llm-pi-ai | `<profile>/cordis.patch.yml` 的 `- id: llm-pi-ai` | 46 个 providers 的 config | **逐字照抄** 0.1.7 层全部 46 个 providers（整体替换语义） | `[源码实读]` `T06-proposed-cordis.patch.020.yml:200-419`（我实读章节标题与语义说明） | `dump-config` 中 providers 数 = 46，逐项与 0.1.7 层一致 | — | 中：漏抄一项即静默丢 provider |
| **C-10** | 组合层 / 自建 preset | `<profile>/cordis.patch.yml` 的 `- insert: preset-standard-glm` | 目录式 preset `~/.dsh/.agent-presets/standard-glm/`（`config.text:` 非法字段） | 改为声明式条目：`name: '@deepseek-ai/dsh-agent-preset'`；`config.id = standard-glm`；**`order: 5`**（避开官方 `ptc=2` 并列）；基线取 **0.2.0 官方 `standard` 的 19 行**（含 `present`/`command-goal`/`tool-plugin-manager`）；`persona` 用 **`prefix`（必填）**；`workflow-worker-thread` → **`workflow-ptc`**；`tool-subagent` / `tool-subagent-fork` 钉 `agentOptions: {provider: adam, model: deepseek-v4-pro}` | `[源码实读]` `T06 §G`（我实读，含 `agentOptions` 两处）+ `MIGRATION-ASSESSMENT §N3` + `T13 §6.1-P6/P7/P8` + `T13 §6.2-B` | 无 `agent preset <id>: <diagnostic>` warn；`persona` 不因缺 `prefix` 报错；`workflow-worker-thread` 无残留引用；`subagent`/`subagent_fork` 行的解析 `agentOptions` = `{adam, deepseek-v4-pro}` | C-05 | **高**：`text:` 不改则 preset **激活直接失败** |
| **C-11** | 组合层 / preset 退役 | `<profile>/cordis.patch.yml` + `~/.dsh/.agent-presets/` | 旧 id 行 + 旧目录仍在 | ① 退役旧 id 写法（0.2.0 只给 warn 并丢弃）；② `C-05`/`C-10` 验收通过**后**再删旧目录 | `[源码实读]` `T06 §D` + `T13 §6.3-V5`（我实读） | `~/.dsh/.agent-presets/` 在 V1–V4 通过后才移除 | C-05, C-10 | 低：删除过早会丢回滚材料 |
| **C-12** | 组合层 / peer 闸门 | `<profile>/compatibility.json`（或各插件 `package.json` 的 24 处 peer 声明） | 0.2.0 下 6 条被 preflight 静默 disable | **二选一**（勿混用）：(1) 写 `compatibility.json` 精确版本豁免（Runbook 默认，不改制品）；(2) 把各插件 peer 上界 `>=0.1.1-rc.2 <0.2.0` 放宽为 `<0.3.0`（共 **24 处**声明，改制品） | `[源码实读]` `MIGRATION-ASSESSMENT §N15` + Runbook §6 | `grep -c 'disabling profile plugin row'` = **0**（须捕获 **stderr**） | — | **高**：官方稳定 `0.2.0` 一发布即 deny 整行；**必须在稳定版发布前选定一条路** |
| **C-13** ★ | 装配层 / 插件来源根 | `<新home>/profiles/node_modules/**`（13 个本地插件） | Runbook §4.4 从 `~/.dsh/profiles/node_modules` 复制（**0.1.1 现役根**） | 改为从**已迁移件**（`assembly-020/home/profiles/node_modules`，或等价的已迁移树）复制；`zod` 显式软链 | `[部署件实测]` **本档独立实测**（见 §1.3-A 五插件 hash 对照表） | 见 §4-批次1 `V-1.5`：13 个插件的 `lib/index.js` 与 `lib/client.js` sha256 与已迁移件**逐一致**；且 `grep` 三插件真 import 命中数 = 0 | — | **极高**：取错根 ⇒ 7 个插件加载失败，回退成上一轮的未闭缺口 |
| **C-14** | 组合层 / 日程自动化（**登记**） | profile `package.json` 的 `dsh.profile.bundles` 或 patch insert | 0.1.7 官方组合含三行（均 `disabled: true`），0.2.0 收进新包 `@deepseek-ai/dsh-experimental-schedule-bundle`（**不在**本 profile bundles 内） | **默认裁剪（不启用）**。若启用二选一：bundle 级加入 bundles；或 patch 级 insert 三行（**禁止**只写 `- id: schedule` + `disabled: false`，那只会得到 `entry 'schedule' not found` warn） | `[源码实读]` `T06 §C2`（我实读） | 若裁剪：`dump-config` 中无 `time-context`/`schedule`/`ui-schedule`；升级后无报错 | C-03 | 低：现役 0.1.1 组合本就无这三行，**相对现役无行为退化** |

### 2.3 工单总表 — 批次 2｜settings 断层与声明面

> 文件边界：`<新home>/profiles/node_modules/@local/dsh-subagent-model/**`、`@deepseek-ai/dsh-session-board/**`、`@deepseek-ai/dsh-vision-adam/**`、`@local/dsh-web-search-sse/**`，以及各插件 `package.json`。**与批次 3、4 的插件目录零重叠，可并行。**
> **统一范式（T04 §9.5，仓内已有 1 份已验证实现可直接照抄）**：删 `dsh-settings` 具名 import → `Config` 字段加 `.volatile()` → 命名空间改字面量 → `apply` 内改 `config.X.get()`。

| 单元号 | 归属插件/面 | 文件·位置 | 现状 | 改为 | 依据类型与出处 | 验收标准 | 依赖单元 | 风险 |
|---|---|---|---|---|---|---|---|---|
| **P-01** | `@local/dsh-subagent-model` 宿主半 | `lib/index.js`（`:19` import；`:22`/`:26`/`:46` 调用；`:39-41` Config；`:46-51` 回调；`:29` DEFAULT_ROUTE） | import `installSettingsSection`+`settingsNamespace`；命名空间自注册 `dsh-subagent`；`setSource`/`onChange` 回调式热源；`DEFAULT_ROUTE.model = deepseek-v4.1-flash`（**取值已失真**） | 删 import 与 `settingsNamespace`；`Config` 两字段加 `.volatile()`；`apply` 改为注册 cordis 服务 `subagentDefaultRoute`（`class … extends Service` + `current()`），字段读 `this.config.<f>.get()`；`DEFAULT_ROUTE` 与 `C-10` preset 的 `agentOptions` **对齐为同一值** | `[源码实读]` `T13 §4 A1–A5` + `T04 F-4` + `T04 §9.5`（我实读三处）；`[部署件实测]` 我实测部署件 `lib/index.js` = `e93de18da406`，仍含 6 处真命中 | import OK（无 `SyntaxError`）；`typeof svc.current === 'function'`；`DEFAULT_ROUTE` 与 preset 值字符串相等 | C-10 | **高**：命名空间须与挂载行 `id` 一致，否则设置页读不到 |
| **P-02** | `@local/dsh-subagent-model` 客户端半 | `lib/client.js`（`:295` inject；`:300` bind）；`package.json`（`dsh.client` / `peerDependencies`） | `inject = ["slots","settingsScope"]`；`ctx.settingsScope.bind({namespace:"dsh-subagent"})`；peer `dsh-settings >=0.1.1-rc.2 <0.2.0` | `inject` 去 `settingsScope`，改 `settings.section` slot + `ctx.configForms`（含 revision 冲突处理）；`llm-pi-ai` 模型清单来源按新 API 重定位；peer 放宽至 `<0.3.0` 或 `0.2.0-rc.1`；按需补 `dsh.client.inject` 项 | `[源码实读]` `T13 §4 A7/A8/A9` + `T04 F-2` + `T04 §1.2③`（我实读） | 客户端插件 fiber **ACTIVE**（不再永久等待 `settingsScope`）；设置页出现子代理条目且可读写 | P-01, C-12 | **中**：`configForms` 需 `dsh-client-ui-settings` 先激活 |
| **P-03** | `@deepseek-ai/dsh-session-board` | `lib/index.js`（`:8` import；`:30` 调用） | import `installSettingsSection`+`settingsNamespace`（真 import） | 同 §9.5 范式；命名空间改 profile 条目 id `session-status-board` | `[源码实读]` `PLUGIN-MATRIX`（`:50` 列为 FAIL）+ `[部署件实测]` **我实测部署件仍 8 处真命中** | `await import('@deepseek-ai/dsh-session-board')` 返回 OK；宿主启动后该行被激活（不再进「未激活」清单） | C-04 | 中：同上 |
| **P-04** | `@deepseek-ai/dsh-vision-adam` | `lib/index.js`（`:3` import；`:81` 调用） | import `installSettingsSection`+`settingsNamespace`（真 import） | 同 §9.5 范式；命名空间改 profile 条目 id `vision-adam` | `[源码实读]` `PLUGIN-MATRIX:51` + `[部署件实测]` **我实测部署件仍 8 处真命中** | `await import('@deepseek-ai/dsh-vision-adam')` 返回 OK；**且**导出 `analyzeImageBytes`/`resolveOptions`/`resolveApiKey` 三个符号仍在 | C-04 | **高**：btw 的 `/sideChat` 图片路径依赖它（见 `B-15`） |
| **P-05** | `@local/dsh-web-search-sse` | `lib/index.js`（整文件，399 行）；`<profile>/cordis.patch.yml` 的挂载行 `id` | 部署件 `88d6387e351a`（**坏副本**，import 已消失符号）；entry id `web-search-sse` ≠ 命名空间 `web-search-deepseek-sse` | ① 换成 `5947d0909550`（已验证的 §9.5 范式实现）；② 对齐 entry id 与命名空间（改 patch 的 `id` 为 `web-search-deepseek-sse`，**或**反之并把段名对齐）；③ **不要**引入上游 `dsh-web-search-deepseek`（新增 `dsh-deepseek-account` peer 与新 HTTP 栈，本机 fork 无此需求） | `[源码实读]` `T04 §1.2⑤`、`§9.4`、`§9.5`、`§9.6`（我实读四段）；`[部署件实测]` **我实测 `assembly-020` 内已是 `5947d0909550`** | `lib/index.js` sha256 前 12 = `5947d0909550`；迁移后**实跑一次搜索**验证 SSE 组装路径 | C-04 | 中：SSE 路径未实跑 = 唯一未闭环处 |
| **P-06** | 7 插件的 entry id 与命名空间对齐（**合并 T04 的 6 处键漂移 + T13-A2**） | 各 `<profile>/cordis.patch.yml` 的 `insert` 行 `id` 与 `<新home>/settings.yaml` 段名 | 6 处名不一致：`usage`≠`dsh-usage`、`btw`≠`dsh-btw`、`ssh-gui`≠`dsh-ssh-gui`、`workerspace`≠`dsh-workerspace`、`dsh-subagent-model`≠`dsh-subagent`、`web-search-sse`≠`web-search-deepseek-sse`（`wallpaper` 已对齐） | **采纳「命名空间随 entry id」方向（≠ T04-F-3 推荐的方案 a）**：**保持现有 entry id 不动**（部署件已成既定事实，见 §2.7 冲突 9）；因此旧 `settings.yaml` 段名 `dsh-ssh-gui:` / `dsh-workerspace:` / `dsh-subagent:` / `dsh-usage:` / `dsh-btw:` **不会自动落位** ⇒ 必须**由单一写入者**把需保留的值显式写进对应 entry 的 `config:` 行（或接受一次性迁移并记录丢失清单）；**唯一例外 = `web-search-sse`**（部署件上仍与命名空间 `web-search-deepseek-sse` 不一致，须按 `P-05` 修） | `[源码实读]` `T04 §1.4`（我实读）+ `T13-A2`（命名空间 ≡ profile 条目 id）；`[部署件实测]` **本档我实测**：patch 行 id = `btw`/`wallpaper`/`usage`/`workerspace`/`ssh-gui`/`web-search-sse`，且插件内字面量 = `BTW_SETTINGS_ENTRY_ID="btw"` / `WS_ENTRY_ID="workerspace"` / `SSH_GUI_ENTRY_ID='ssh-gui'` ⇒ **已一致**，唯独 `WEB_SEARCH_SSE_SETTINGS_NAMESPACE="web-search-deepseek-sse"` 与行 id `web-search-sse` **仍不一致** | 逐段对照表落盘：每一段都有明确去向（**「无用户值可搬」的空段须显式标注**，如 `dsh-workerspace: {}`）；`dsh-subagent:` 段若保留则**逐字保留**；`dump-config` 中 7 个 id 均 PRESENT | C-04, C-05 | **高**：**静默失效**——段读不到不报错，只退回默认值；**被否一方 = `T04-F-3` 的推荐方案 (a)**（改 entry id 去对齐旧段名），因其会**撤销上一轮已落地的 id 决定**并牵动行序/引用；`dsh-subagent` 失效会让子代理静默回 preset 路由 |
| **P-07** | 子代理模型路由（**N2**） | `<新home>/…/dsh-tool-subagent/lib/index.js`（宿主补丁）**或** preset（零补丁） | 现役靠**73 行本地补丁**（`effectiveConfiguredAgentOptions()`，读取点 `settings.get("dsh-subagent")`）；上游两树 grep **0 命中** ⇒ 该逻辑**本就是本地补丁** | **二选一（须裁决，见 §5-9）**：(A) 对 0.2.0 文本**重新落补丁**（读取源改为 `P-01` 注册的服务；**不可字节复制 0.1.1 补丁**——0.2.0 `execute()` 已用 `runtimeCtx.subagents.resolveMaxDepth(config.maxDepth)` 等，上下文不同）；(B) **零宿主补丁降级**：只由 `C-10` 的 preset `agentOptions` 钉死 | `[源码实读]` `MIGRATION-ASSESSMENT §N2` + `T13 §7.2 方案A/B` + `T13 §7.3`（我实读三处）；**两处上位件倾向相反** ⇒ 见 §2.7 冲突 10 | 方案 B：preset 两行的 `agentOptions` = `{adam, deepseek-v4-pro}`（**零宿主补丁**）；方案 A：补丁后 invariant 检查仍通过，且读取源为本地服务 | C-10, P-01 | **高**：方案 B 下「改模型需编 preset、生效面 = 新会话」，**不是**改完下一次派发即生效 |
| **P-08** | `dsh-vision-adam` 能力边界（跨档：T30-U04） | `dsh-btw/src/host/vision.ts:132-142`（`loadVisionAdam`） | 断言 `analyzeImageBytes`/`resolveOptions`/`resolveApiKey` 三导出，失败话术为「部署副本缺导出」 | 保留断言，但把失败话术改为「与 0.2.0 不兼容」并写入 `P-04` 的判定结果；若 `P-04` 判定不可用，给出**降级路径**（文本模型拒绝图片 + 明确报错，而非抛「部署副本缺导出」） | `[源码实读]` `T30 U04` + `T30 U-1`（我实读） | 未装/不可用时：纯图片消息得到**可读中文错误**且不崩侧聊；可用时图片照常转文本 | P-04 | 中：需先有 `P-04` 的运行态结论 |

### 2.4 工单总表 — 批次 3｜`@local/dsh-btw`（宿主与客户端面）

> 文件边界：`dsh-btw/**`。**与批次 2、4 零重叠。**
> **前置**：§1.3-B 的基线裁决（`[条件]` 单元在裁决前一律不派）。

| 单元号 | 归属插件/面 | 文件·位置 | 现状 | 改为 | 依据类型与出处 | 验收标准 | 依赖单元 | 风险 |
|---|---|---|---|---|---|---|---|---|
| **B-01** | btw / 构建依赖 | `package.json:85-108`（deps+peer）、`:109-138`（devDeps）、`:86`（schemastery） | peer 全 `<0.2.0`；devDep 钉 `0.1.1-rc.2`；`schemastery ^3.18.1` | peer 改 `0.2.0-rc.1`（或 `>=0.2.0-rc.1 <0.3.0`）；devDep 同步钉 `0.2.0-rc.1`；`schemastery` 对齐 `~3.18.4` | `[源码实读]` `T30 U01`（我实读） | `typecheck` 不再报 `TS2307` 类模块缺失；`npm ls` 无 peer 失配 | — | 低：机械项 |
| **B-02** `[条件]` | btw / settings 承载面 | `src/index.ts:5-6,13,22-76`；`src/host/vision.ts:144-192` | import `settingsNamespace`；`BTW_SETTINGS_NS = settingsNamespace('dsh-btw')`；`ctx.settings.register(NS, SCHEMA)` | ① 删具名导入与 NS 品牌面；② 改为插件自带 `Config`（`export const Config = z.object({…})`）+ `apply(ctx, config)`；③ 需自定义页时 `ctx.settings.configure({auto:false}, ctx.fiber)`；④ 宿主侧读 `Config` 引用，**保留 `?.` 防御但加显式 warn**（把静默失效变可见） | `[源码实读]` `T30 U05/U06`；`[部署件实测]` **我实测部署件无该导入**（§1.3-A） | btw fiber **ACTIVE**（无 `register is not a function`）；设置页出现 `btw` 条目；改 patch 中 `btw` 行 `config:` **值级热生效** | §1.3-B, C-04, P-06 | 中：**不得删 `SideChatService.static inject` 里的 `'settings'`**（0.2.0 settings 服务仍在，只是方法面全变；删 inject 是错解） |
| **B-03** | btw / 事件读面（**唯一需重新设计**） | `src/host/side-chat-service.ts:209-213`（`completedTurnSeed`）、`:296-313`（`parentTitleOf`）、`:374-445`（`progressDigestLines`）、`:513-686`（`transcript`）、`:1370-1386`（`hydrateImageRefs`）、`:939`（`entry.seedLength`） | 全部读 `session.events` / `header.seedLength` / 手扫 `session/title` 事件 | ① `Session.events` → **`sessionQuery.readSession(id)`**（推荐，返回 `SessionLogSnapshot{events, inheritedEventCount}`，避开 `@deprecated`）；② `header.seedLength` → `session.inheritedEventCount`（0.2.0 拆成 `header.isSeeded` + `inheritedEventCount` + `firstLiveSeq` 三者，须分别取用）；③ `parentTitleOf` → `sessionQuery.readTitle(parentId)`；④ 实时增量改订阅 `'session/event'`（带 `dsh-scope` 作用域过滤） | `[源码实读]` `MIGRATION-ASSESSMENT §N16` + `T30 U07`（**唯一需先定案再落地的单元**，我实读） | 三档 `tsc` 零 `TS2339 'events'`、零 `TS2339 'seedLength'`；真机：侧聊转录**不含**父会话历史、进度摘要行数正确、父会话标题正确 | §5-2（读面选型，已在 §5 列为需确认） | **极高**：`Session.events` 访问器被**整个删除**；替代品 `snapshotEvents`/`ownEvents` 已标 `@deprecated`「new calls are prohibited」⇒ 用它们收尾会立即背技术债 |
| **B-04** | btw / 子会话创建 | `src/host/side-chat-service.ts:219-227`、`:789`（`childSessionMeta(parent, childDepth, seed.length)`）、`:786-796`、`:923-931` | 第三参传 `forkSeq: number`；`agents.create` **未传** `inheritedEventCount` | 第三参改 `isSeeded: boolean`（`seed.length > 0`）；精确前缀长度改由 `agents.create` 的 `inheritedEventCount: SessionLogOffset(seed.length)` 传（品牌类型，**直接传 number 编译不过**）；`:923-931` 的 `agents.resume` 同查 | `[源码实读]` `T30 U08/U09` + `T30 H-17/H-18`（我实读） | 新建侧聊不抛 `session header isSeeded must be a boolean`；子会话 header 的 `isSeeded` 是 **boolean**；`tsc` 无 `SessionLogOffset` 报错 | B-03 | **高**：运行期把 number 落进 `isSeeded` 会让 0.2.0 header 校验**硬抛** |
| **B-05** | btw / typert 描述符 | `src/remote-descriptors.ts:25-34`（工厂体）、`:37-48`（10 条）；`src/typert.host.ts:1-28` | `codec: {mode:'strict', typeSymbol, schema: <zod>}` | 改为 `codec: {mode:'strict', typeSymbol, create: () => schema}`（**`create` 必须是函数**）；同步 `sourceLocation.line` | `[源码实读]` `T30 U10` + `T30 H-6`（0.2.0 是**注册期硬抛**，非 0.1.7 的「首次 RPC 才炸」） | 插件能 **apply 通过**（不再抛 `has no create() factory`）；`smoke-build.mjs` 的 `invocations.length === 10` 仍过；`sideChat/start` 一次真机 RPC 往返成功 | — | **高**：不改则**整个插件在 apply 期抛错** |
| **B-06** | btw / 图片转文本缝 | `src/host/prompt-transform.ts:1-123`（整文件）；`src/index.ts:8,75` | 注册 `session/prompt-image-transform` waterfall | **推荐 (a)**：删除该文件与 `registerPromptImageTransform`，主会话图片交回官方闸门（`dsh-api-session-controller/lib/index.js:873` 内建 `inputModalities` 闸门）；(b) 改走 `dsh-compaction-image-offload`（覆盖面**更窄**）；(c) 另寻 `agent/request` waterfall（**未验证，不要直接上**） | `[源码实读]` `T30 U11` + `MIGRATION-ASSESSMENT §N16 硬闸 4`（承载包 `dsh-host-apiproxy` **整包消失**） | 主会话图片路径**不再依赖不存在的包**；`tsc` 零错误；真机：支持图片的模型原图直传、不支持的模型给**可读错误**（非静默失败） | — | 中：这是**减法**，需产品确认「主会话图片在 0.2.0 上降级为官方闸门」可接受 |
| **B-07** | btw / 图片能力检测与拒绝文案 | `src/host/vision.ts:90-99`、`:72-81`；`src/host/side-chat-service.ts:1221-1253` | 读 `ctx.get('llm').resolveModelInfo(...).inputModalities` 与 `ctx.get('agentDefaultModel').currentSelection()`；逻辑保留但闸门语义与 `B-06` 不一致 | 结构读**保留**；把「闸门」语义改为**只服务侧聊内部决策**（自建子会话的模型能否吃图），不再声称能拦主会话；统一拒绝文案；补一条：子会话模型不支持图片时 `read_image` 工具是兜底（`shared/tool-policy.ts:27` 已列） | `[源码实读]` `T30 U12/U19`（我实读） | 贴图到侧聊：支持→原图直传；不支持且开关开→转文本成功；开关关→**可读中文拒绝**、消息不发送、`requestId` 未记录（可重试） | B-06, P-04 | 中：文案与语义须一并改，否则两处口径互相矛盾 |
| **B-08** `[条件]` | btw / 客户端运行时 | 10 处 import `@deepseek-ai/dsh-client-runtime/client`：`src/client/{index.ts:1,2, controller.ts:1, presentation.tsx:2, btw-settings.ts:2,4, SideChatDrawer.tsx:2, SideChatJumpList.tsx:2, SideChatSurface.tsx:5, drawer-size-store.ts:17}`；`package.json:74`；`tsdown.config.ts:14-24` | 全部指向**已整包消失**的包；工作区 `lib/client.js` 仍有 `require(...dsh-client-runtime/client)` 与 2 处注释命中 | 按符号分别改源：`ClientContext` → `@deepseek-ai/cordis` 的 `Context`；`SessionId` → `@deepseek-ai/dsh-session/types`；`ISessions`/`SessionFace` → `@deepseek-ai/dsh-api-session-controller/client`；`defineStore` → 0.2.0 可 `require` 的 client 行（形状 `{init,persist,actions}` **逐字未变**，只换来源包）；`SettingsScope` → **无对应物**（见 `B-10`）；同步 `dsh.client.inject` 与 `tsdown` external | `[源码实读]` `T30 H-7/H-8/H-9/H-10/H-11` + `T30 U02/U03/U13/U14`；`[部署件实测]` **我实测部署件 `606f53f1…` 残留 0/0** ⇒ **条件成立才派** | `tsc -p tsconfig.client.json` 零 `TS2307`；重建后 `lib/client.js` 不再出现 `require("…dsh-client-runtime…")`；抽屉尺寸在刷新/重载/重启后保持 | §1.3-B | **高（若走工作区源码路线）**：走部署件路线时本单元**已由上一轮完成**，派工即重复劳动 |
| **B-09** | btw / 客户端导航 | `src/client/controller.ts:109-131, 415-459`（`:429` `openSubagent`、`:432` `open`、`:455` `subagentsByParentOf`） | 用 `ISessions.open(id)` / `openSubagent(id)` / `list.getSnapshot().subagentsByParent` | ① `open`/`openSubagent` → `retain(target, options)` + `using(...)`；② `subagentsByParent` → `ISessions.subagentAddress(id)`（或 `scope(id)`/`scopeOf(ctx)`/`sessionOf(ctx)`）；③ 导航落点**未判定** | `[源码实读]` `T30 U15` + `T30 H-12/H-13/H-14`；`T30 §6.4-U-6` 明写「navigation belongs to view owners」但**未读**导航实现 ⇒ **本轮未判定** | `tsc` 零 `TS2339 open/openSubagent`；真机：JumpList 点父会话能切过去，**或**给出可读的「不支持」提示（**不得静默无反应**） | §5-2 | **高**：这是 0.2.0 相对 0.1.7 的**新引入**难点；若找不到插件可用的切会话入口，JumpList 只能降级为「只展示不跳转」 |
| **B-10** `[条件]` | btw / 客户端设置读面 | `src/client/btw-settings.ts:1-124`（整文件）；`src/client/index.ts:2,18,33-36,78`；`presentation.tsx` 的 `settingsScope` prop 全链 | 依赖 `settingsScope` 客户端服务 + `SettingsScope<BtwSettingsSection>` | **(a) 推荐**：宿主侧走 `B-02` 的 `Config`，客户端**不再跨进程读设置**（行为开关由 `sideChat/read` 返回体携带）；(b) 必须客户端直读时用 `dsh-client-ui-settings` 的 `SettingsDescribeMirror` + `remote.settings.mutate()` | `[源码实读]` `T30 U16` + `T30 H-11`（全 0.2.0 树 grep `SettingsScope` **零命中**） | 客户端插件 fiber **ACTIVE**（不再永久等待 `settingsScope`）；`banner`/`modelSelect`/`imageBadge` 开关改配置后**热生效** | B-02 | 中：与 `B-08`、`P-02` 同型，可共用实现经验 |
| **B-11** | btw / 抽屉避让几何 | `src/client/use-overlay-placement.ts:90-101, 155-176, 423` | 认 `[data-pane="sidebar"/"details"]`、`.sidebarCol`/`.detailsCol`、`[data-details-collapsed]` | 更新为真实帧结构：列类名 `sidebarCol`/**`rightbarCol`**；折叠属性 `data-sidebar-collapsed`/**`data-rightbar-collapsed`**（`data-dragging` 不变）；`data-pane`/`detailsCol` 已不存在 ⇒ 删该分支或改按列序+类名双轨；`[data-shell-overlay]`、`[data-slot="shell.overlay"]` **保留** | `[源码实读]` `T30 U17` + `T30 S-4`（我实读） | 真机：抽屉在侧栏展开/折叠、右栏展开/折叠、窗口缩放三态下**都不与原生面板重叠**；`data-placement-degraded` 不常驻 | — | 中：不抛错，只变丑（**可能被误判为通过**） |
| **B-12** | btw / 部分文本流 | `src/host/side-chat-service.ts:355, 416-429`、`:549-558` | 读 `assistant/chunk` 的 `chunk.type === 'text-delta'/'reasoning-delta'` 与 `chunk.text` | 改读 **`assistant/attempt`** 的 `data.stream: AssistantStreamRecord[]`：`'text-chunks'`/`'reasoning-chunks'` 的 `texts[]` 拼接；`'chunk'` 记录里的 `StreamChunk` 才是原形状；`tool-call-chunks` 按需映射为工具摘要 | `[源码实读]` `T30 U18` + `T30 H-15`（`assistant/chunk` 删、`assistant/attempt` 增） | 真机：侧聊「正在生成」的**部分文本**能实时出现（不是等 `assistant/message` 落地）；`tsc` 零 `TS2367` | — | 中：静默退化（只是「生成中」体验变差） |
| **B-13** | btw / 客户端 UI 原语面 | `src/client/SideChatSurface.tsx` / `SideChatDrawer.tsx` / `SideChatToolRow.tsx` / `SideChatButton.tsx` | 依赖 `dsh-client-ui-primitives` 与 `dsh-client-ui-slots` 的组件/类型 | 逐个符号复核 `primitives` 在 0.2.0 的导出面（本轮只验证了包存在与 `PropsLocale` 等类型位可用）；缺什么补等价组件 | `[源码实读]` `T30 U20` + `T30 §7 U-5`（我实读） | `tsc -p tsconfig.client.json` 零 `TS2305 无导出` 类错误 | B-08 | 中：`dsh-client-ui-slots` 的 `register` 泛型已收紧 |
| **B-14** | btw / 测试与行号收尾 | `src/remote-descriptors.ts:33`（`sourceLocation`）、`scripts/smoke-build.mjs:16-19`、`tests/*`（15 个 spec，其中 10 个与部署件 hash 不同） | 描述符行号指向旧版；`smoke-build` 断言 10 条 invocation | 同步行号；把 `B-02`–`B-12` 的新契约写进 spec（`create()` codec、`inheritedEventCount`、`assistant/attempt`、`sessionQuery.readTitle`）；`smoke-build` 断言改为「10 条 invocation **且每条 codec 有 `create` 函数**」 | `[源码实读]` `T30 U21` + `T30 §7 U-9`（**A 档全档 tsc 基线未取**，执行档须先取） | `pnpm run test` 全绿；`pnpm run smoke` 全绿；三档 `tsc` 全绿；**先落盘全档 tsc 基线**再动手 | B-02…B-13 | 中：无基线则无法判定「改完是否更差」 |
| **B-15** | btw / 基线裁决（**登记型，见 §1.3-B**） | `dsh-btw/**` 与 `<新home>/profiles/node_modules/@local/dsh-btw/**` | 工作区 `lib/client.js` = `078ef49d3940`（18/14 处残留）；部署件 = `606f53f13f61`（0/0） | 采纳部署件为基线；若坚持工作区源码路线，**必须先执行 `B-08` 的两项**，并把部署件那份的改造回灌到工作区源 | `[部署件实测]` **本档独立实测**（§1.3-B 表） | 双向差集报告落盘（命令见 §4-批次3 `V-3.1`）；基线版本在工单签署页显式写明 | — | **极高**：基线选错 ⇒ 要么做重复劳动，要么重造已修好的件 |

### 2.5 工单总表 — 批次 4｜`dsh-workspace-enhancement` + ssh 族

> 文件边界：`.workspace/workstreams/research/repos/dsh-workspace-enhancement/**`、`@local/dsh-ssh-gui/**`、`@local/dsh-workerspace/**`。**与批次 2、3 零重叠。**
> **基线**：`W-20` 裁决前，本批**不得开工**（`T24` 取 tag `v0.1.2`，`T17` 判 0.1.2 不可迁 —— 见 §2.7 冲突 6）。

| 单元号 | 归属插件/面 | 文件·位置 | 现状 | 改为 | 依据类型与出处 | 验收标准 | 依赖单元 | 风险 |
|---|---|---|---|---|---|---|---|---|
| **W-01** | WE / 子进程 provider | `src/subprocess.ts`（`SshSubprocessRuntime` 类声明 `:181`） | 只实现 `resolveExecutable`/`spawn`/`spawnTerminal` | 新增 `async terminalEnvironment(signal?)`：经 `ctx.ssh` 远端执行 `uname -s` 探测平台、经 `$SHELL`/`getent passwd` 解析登录 shell | `[源码实读]` `T24 U01`（`dsh-subprocess/lib/types/index.d.ts:94` **新增抽象方法**） | `tsc --noEmit` 通过；`typeof inst.terminalEnvironment === 'function'`；posix 远端返回 `platform === 'posix'` | W-20 | 中 |
| **W-02** | WE / 子进程 facade | `src/mixed.ts`（`MixedSubprocessRuntime` `:101-103`/`:169/174/183`） | 只转发三个方法 | 新增 `terminalEnvironment(signal?)`；无可判定 cwd 时**默认转发本地分支**，保留 `remoteRouteFromCwd` 判定分支 | `[源码实读]` `T24 U02` | `tsc` 通过；`ctx.set('subprocess', mixed)` 后调用不抛 `TypeError` | W-01 | 中 |
| **W-03** | WE / 子进程句柄 | `src/process.ts`（`SshSubprocessHandle`） | 暴露 `pid`，不暴露 `control` | 新增 `readonly control: Duplex \| undefined = undefined`；并对 `spec.control === 'pipe'` **显式拒绝**（抛错，不得静默返回 `undefined`） | `[源码实读]` `T24 U03`（`types.d.ts:164`） | 类型检查通过；`control` 存在且为 `undefined`；传 `control:'pipe'` 时抛错而非静默 | — | 中：`control` 通道**永久缺失**（L7，需专门设计） |
| **W-04** | WE / 终端句柄 | `src/terminal.ts`（`SshTerminalHandle`） | 无 `resize` | 新增 `async resize(cols, rows)`，用 `ssh2` 的 `stream.setWindow(rows, cols, 0, 0)`；非正整数入参抛错 | `[源码实读]` `T24 U04`（`types.d.ts:255`；消费者 `dsh-api-terminal-controller/lib/index.js:428`） | `tsc` 通过；`resize(120,30)` 已连接时不抛（未连接时抛明确错误） | — | 中 |
| **W-05** | WE / 终端句柄 | `src/terminal.ts` | 无 `inspectActivity` | 新增 `async inspectActivity()`，返回 `{state:'idle'\|'busy'\|'unknown', revision}`；无法可靠观测时**必须返回 `'unknown'`** | `[源码实读]` `T24 U05`（`types.d.ts:265`；消费者 `dsh-api-terminal-controller/lib/index.js:341`） | `tsc` 通过；无 prompt 证据时返回 `'unknown'` | — | 低 |
| **W-06** | WE / PTY | `src/subprocess.ts` + `src/terminal.ts`（`spawnTerminal` → `spawnSshTerminal`） | 未读 `spec.terminalType` | 透传到远端 `pty` 请求（`ssh2` 的 `pty(term, …)` 或远端 `export TERM=`）；`spec.shellActivity === true` 时记入句柄状态供 `W-05` 用 | `[源码实读]` `T24 U06`（`types.d.ts:210` **必填** `terminalType`） | 类型检查通过；远端 `echo $TERM` 等于传入值 | W-05 | 中 |
| **W-07** | WE / 文件系统 | `src/filesystem.ts`（`SshFileSystemEngine` `:230`、`SshFileSystem` `:631`） | 只有 `readBytes`（前缀读），无窗口读 | 两处各新增 `readByteRange(target, {offset,length}, signal?)`：SFTP `createReadStream({start, end})`，**不得整文件缓冲**；`offset ≥ size` 返回空；负值/非整数抛 `FsError`；中止抛 `FS_ABORTED` | `[源码实读]` `T24 U07`（`dsh-fs/lib/types/index.d.ts:197` `abstract readByteRange`） | `tsc` 通过；`readByteRange(t,{offset:2,length:3})` 返回第 3-5 字节；不读取超 `length` 字节 | W-20 | **高**：远程文件预览/下载（L2）直接按此恢复 |
| **W-08** | WE / 文件系统 facade | `src/mixed.ts`（`MixedFileSystem` `:317`/`:201`） | 无 `readByteRange`、未覆写 `watch` | **方案 B 下退化为一行转发**（本地分支用宿主官方 0.2.0 fs；远端分支调 `W-07`）；接口面同步加声明 | `[源码实读]` `T24 U08` + `T24 §6.2`（方案 B 下「退化为一行转发」，本地官方 fs 已实现） | `tsc` 通过；本地/`ssh://` 两分支分别命中（可断言分支计数） | W-07 | 中 |
| **W-09** | WE / 文件监视 | `src/mixed.ts`（`MixedFileSystem`） | 未覆写 ⇒ 继承 0.2.0 基类**无条件 reject** `FsError('Filesystem watching is not supported…')` | 覆写 `watch`：本地分支委托本地 delegate；远端分支**显式** reject 带 `FS_IO_ERROR` | `[源码实读]` `T24 U09` + `T24 §6.2`（方案 B 下同样退化为一行转发） | `tsc` 通过；本地 `watch` 返回可用 close；远端拒绝且**不影响**其他能力 | W-08 | 中：本地文件监视（L3）由此恢复；远程监视 **L4 永久缺失** |
| **W-10** | WE / `/dsw` 通道 | `src/web.ts:525`（`handle('/dsw', dispatch, {authority:'loopback'})`）；模块增强 `:56-69` | 3 参 `handle` + `{authority:'loopback'}` | ① 改 `handle('/dsw', dispatch)`（去第 3 参）；② `dispatch` 补第 4 形参 `peer: PeerScope`；③ **必须补一条显式的信任约束等价物**（用 `peer` 判定身份，或走 `connection.fetch.register` 精确 Fetch 路由）；④ 模块增强声明同步或删除 | `[源码实读]` `T24 U10` + `T17 §4.1-S3` + `T17 §10.2`（**两档对修法有分歧 — 见 §2.7 冲突 4**） | `tsc` 通过；`/dsw` 端点仍可调用；**验收记录必须写出「原 `loopback` 约束现由何处承担」，无此记录视为未通过** | §5-3 | **高**：第 3 参被 JS **静默忽略** ⇒ loopback 信任约束**静默失效、不报错不告警** |
| **W-11** | WE / RPC 信封 | `src/web.ts:36-38`（`ChannelResult`） | `details?:` 可选 | `details: object`（必填；失败分支统一填 `{}`）；成功分支保留（新增 `attachments?` 可选，不需支持） | `[源码实读]` `T24 U11`（`dsh-client-connection/lib/types/rpc.d.ts:13-17`） | `tsc` 通过；所有 `error` 返回点均带 `details` | — | 低 |
| **W-12** | WE / 宿主语言面（**本族唯一须改底座源码项**） | `src/locale/host.ts`（`HostLocaleSettings` `:32-35`、`hostLocaleOf` `:60-67`，`settings?.get('locale')` 于 `:61`） | `settings?.get('locale')?.preference`（依赖**已删除**的 `get()`） | ① 结构面改为 `{ describe(options?): ReadonlyArray<{ns, value}> }`；② `active()` 用 `describe()` 找 `ns === 'locale'`；③ **保留**「service 缺失 ⇒ fallback `'en'`」，加 `try/catch`，**绝不向上抛**；④（建议）把语言做成插件自身 Config 一等字段 | `[源码实读]` `T24 U12` + `T17 §4.3`（**动态复现** `TypeError: settings?.get is not a function`，0.1.2 与 0.1.4 两版都复现） | `tsc` 通过；`hostLocaleOf(ctx).t('rpc.invalidWorkdir', …)` **不抛**且返回字符串；`describe()` mock 抛错时仍返回 `'en'`；**9 个调用点全部走同一实现** | W-20 | **高**：`ctx.settings` 在正常 profile 下**必挂**（`dsh-base/cordis.patch.yml:101-103` 只在缺 `profileContext` 时禁用）⇒ 不是优雅降级而是**必然 TypeError**；触发点为首个会话首轮 prompt 组装 |
| **W-13** | WE / 后台任务面 | `src/exec-tools.ts`（`BackgroundJobs` `:509-517`、`run()` `:814-819`/`:934-939`、`incrementalRead` `:530`） | `spec.run(): {cancel, done, readOutput?()}`；`owner?: unknown` | 重写为 `{kind, label, owner?: string(SessionId), output?, run(job: {append, updateProgress})}`；`owner` 传 **session id 字符串**；`readOutput` 退场 ⇒ 改 `job.append(chunk)` 主动推送（或改用 `output?: JobOutputSource[]`，**二选一，不得两头都留**） | `[源码实读]` `T24 U13`（`readOutput` 已在 0.2.0 **删除**） | `tsc` 通过；后台 `sw-exec` 启动返回 job id；完成通知带输出；**`grep readOutput` 在插件源码内 0 命中** | W-20 | 中：`JobOutputSource` 契约未展开（`T24 §8 N7`）⇒ 实现前先读定义 |
| **W-14** | WE / 客户端目录能力 | `src/client/index.ts`（inject `:145`、`injected()` `:165`/`:166`、`ctx.get('workspaces')` `:214`） | `inject = ['slots','workspaces','sessions','locale']`；`ctx.workspaces.listDirectory/createDirectory` | inject 改 `['slots','uiWorkspace','sessions','locale']`；`:165`/`:166` 改走 `ctx.uiWorkspace.*`；`:214` 的徽标分组按 `IWorkspaces` 实际成员清单决定回退策略 | `[源码实读]` `T24 U14`（两方法已迁到 `dsh-client-ui-workspace/lib/types/client/navigation.d.ts:138/139`） | `tsc` 通过；inject 含 `uiWorkspace`；SSH 工作区添加流程中列目录/新建可用 | — | 中：`IWorkspaces` 成员清单未展开（`T24 §8 N8`） |
| **W-15** | WE / 客户端注入声明 | `package.json` 的 `dsh.client.inject`（6 项） | 含 **0.2.0 不存在**的 `@deepseek-ai/dsh-client-runtime` | 替换为 0.2.0 等价提供者集合（`dsh-client-connection`、`dsh-client-locale`、**`dsh-client-ui-renderer`**、`dsh-client-ui-conversation`、`dsh-client-ui-sidebar`、`dsh-client-ui-workspace`、`dsh-client-ui-settings`、`dsh-api-workspace-controller`、`dsh-api-session-controller`） | `[源码实读]` `T24 U15`；`MIGRATION-ASSESSMENT §N10-N1`（**信息性字段，缺包名不导致加载失败**——故本单元是**正确性**而非阻塞项） | 清单每项都能在 0.2.0 安装树解析到包；不再出现 `dsh-client-runtime` | — | 低（**不是**阻塞项，勿按阻塞排期） |
| **W-16** | WE / 私有依赖岛（**已裁定：方案 B**） | `package.json` 的 `dependencies`（15 项）+ `peerDependencies`；`src/plugin.ts:27-29`、`:81-120`（`installMixedProviders`） | 宿主包走 `dependencies` 并就地 `npm install` 生成钉死 `0.1.1-rc.2` 的私有岛（66 项）；`plugin.ts:93/111/117` 从旧岛 new 出旧版 provider 并 `ctx.set` 顶掉官方 | 方案 B：把 16 个 `@deepseek-ai/*` 从 `dependencies` 迁到 `peerDependencies`（`^0.2.0-rc.1` 或 `>=0.1.1-rc.2 <0.3.0`）；**删除旧岛**；`installMixedProviders` 改为「**读取宿主已挂载的官方 provider → 包一层路由**」（`ctx.get('subprocess')`/`ctx.get('fs')`），并把安装包在 `ctx.inject(['fs','subprocess'], …)` 内 | `[源码实读]` `MIGRATION-ASSESSMENT §N10`（**已裁定采纳 B**，我实读）+ `T24 U16` + `T24 §6.2` | 重新安装后插件目录 `node_modules/@deepseek-ai/` 不存在或版本 = `0.2.0-rc.1`；`plugin.ts:27-29` 解析到的实例上**存在** `terminalEnvironment`/`readByteRange` | W-20 | **高**：保留岛＝永久 0.1.1 语义；`R2` 风险（`ctx.set` 顶掉已 provide 服务）**已由 N10-N2 实测解除** |
| **W-17** | WE / 依赖范围与元数据 | `package.json` 的 `peerDependencies` / `engines` / `dsh.bundle.patch` | peer 仅 2 项（`^0.1.0-rc.6`）；自带 `cordis.patch.yml`（`dsh.bundle.patch`）含 **3 条 disable**（`directory-picker-auto`/`subprocess-local`/`fs-sandbox`） | 按 `W-16` 重建 peer 段；`engines.node` 保持 `>=22.0.0`；**必须摘除或改写 `dsh.bundle.patch`** | `[源码实读]` `T24 U17` + `T24 §6.2-R3` + `T17 §1-2`/`§3.4`（**「insert-only」的自我描述不成立**） | `npm ls` 无 peer 失配；`dsh plugin` 装载不触发版本闸门；**3 条 disable 不再生效** | W-16 | **高**：`dsh.bundle.patch` 若生效会关闭官方本 provider，**与方案 B 直接冲突** |
| **W-18** | WE / 本地客户端补丁回流 | `lib/client.js`（3 个 hunk，均带 `dsh-perf-fix K1-3` 注释）→ 对应 `src/client/*` | 3 处补丁**只存在于部署的构建产物**，未回写到 `src/`；重新安装（任何版本）都会丢失 | ① P1（标题索引去重 + `!== void 0` 守卫）回写 `src/client/row-badges.ts`；② P2（machines `refresh` 的 keep-alive 守卫）回写 `src/client/settings.tsx` 的 `useEffect`；③ P3（sessions 快照投影记忆化）回写对应投影闭包；④ 0.2.0 上重建后**逐条核对行为仍在**（用源码级断言，不用产物 diff） | `[源码实读]` `T24 U18` + `T24 §2.4`（我实读） | `src/` 中出现三处改动；浏览器中验证：同一标题多会话不串索引 / machines 卸载后不再 `setState` / 快照未变时不重建数组 | W-16 | **高**：**任何版本重装都会丢**，与 `W-20` 升版强耦合 |
| **W-19** | WE / picker 行启用决策 | `<profile>/cordis.patch.yml:72-80`（不在插件内） | 三条部署决策：禁官方 `directory-picker`；insert `directory-picker-browse`；禁插件自己的 `directory-picker-ssh` | 逐条确认三条是否仍需保留；若 0.2.0 官方 picker 行已能覆盖 SSH 场景，可整段删除并启用插件 picker | `[源码实读]` `T24 U19` + `T17 §4.4`；`[部署件实测]` **我实测** `assembly-020` patch 仍含这批行 | `ctx.directoryPicker` 只有 **1 个**注册者（无重复注册报错）；SSH 目录浏览在 UI 可用 | C-08 | 中：与 `C-08` 是**同一处 patch** ⇒ **文件边界重叠，必须由同一写入者串行** |
| **W-20** ★ | WE / 迁移基线版本（**前置裁决**） | `WSE-SRC`（`.workspace/workstreams/research/repos/dsh-workspace-enhancement`，HEAD `ee25ed1` = v0.1.4）vs tag `v0.1.2` | `T24` 取 tag `v0.1.2` 为基线（与部署件等价）；`T17` 判 **0.1.2「不确定，不建议」**（`/dsw` 走 `rpc.handle`、丢 loopback 豁免、缺 0.1.4 的会话连接/远程围栏/审批门） | **采纳 `T17`：基线升到 0.1.4+**，并加两条硬闸门：① Runbook 写入「插件 ≤0.1.3 + 宿主 ≥0.1.7 = **拒绝迁移**」；② 0.2.0 家族补一条 `upstream.yml` 哨兵通道（该仓库 L1 静态闸门 #6 要求「联合范围里每个家族都必须被点名 + 有对应通道」） | `[源码实读]` `T17 U-6/U-7` + `T17 §4.3` + `T17 §6.1`（我实读） | `npm run check` 的 #6 通过；0.2.0 通道上 typecheck + 单测 + `boot-smoke.mjs` 全绿（boot 冒烟须断言 `POST /api/dsw/connections.list → 200` 且 `result.ok=true`） | — | **高**：**被否一方 = `T24 §2.1/§5` 的 v0.1.2 基线选择**；升版会与 `W-18` 的 3 处本地补丁丢失问题**耦合**（升版前必须先回写） |
| **W-21** | `@local/dsh-ssh-gui` / 通道 | `lib/index.js:460`（`rpc.handle('/ssh-gui', dispatch, {authority:'loopback'})`） | 自挂前缀通道 + loopback 豁免 | 照抄 `WSE-SRC/src/web-channel.ts` 已验证形状：改 `ctx.connection.fetch.register(route)`（`path` = `/api/ssh-gui/<endpoint>`、`methods:['POST']`、`requestBody:'buffered'`）；服务端复用官方信封；客户端改 `call('/api', 'ssh-gui/<endpoint>', …)`；**loopback 豁免不可移植，但必须显式复核该通道的信任假设并写进插件安全说明**；对 `is already registered` 按 `WSE-SRC` 做法降级（热重载不抛） | `[部署件实测]` **本档我实测**：迁移后的 `@local/dsh-ssh-gui/lib/index.js:64` 注释仍写「host 依赖：web transport（**rpc.handle**）」⇒ **该单元在部署件上仍未做，成立**；`[源码实读]` `T17 U-3` + `T17 §8.10`（**本轨道最重要悬置项**） | 0.2.0 宿主启动后 `POST /api/ssh-gui/<只读端点>` → 200 且信封合法；热重载插件不抛 | W-10, §5-3 | **高**：`/dsw`-类通道「注册成败」在 **0.2.0 真机 boot 收敛前不得断言可用或不可用** |
| **W-22** | `@local/dsh-ssh-gui` / 侧栏席位 | `lib/client.js:1018`（`sidebar.workspaces.remoteHosts`） | 注册一个 **0.2.0 未声明**的槽位 | 重挂到 0.2.0 实际声明的入口：`sidebar.panellist`（新增）或 `sidebar.workspaces.session.row.action` / `sidebar.session.row.leading` / `sidebar.session.row.hover`；或退化为 `settings.section` 内的完整入口（`:739` 已有同 UX 的降级入口） | `[部署件实测]` **本档我实测**：迁移后 `lib/client.js` 仍有 **5 处** `sidebar.workspaces.remoteHosts` ⇒ **未重挂，单元成立**；`[源码实读]` `T17 U-4` + `T17 §4.1-S6` + `MIGRATION-ASSESSMENT §T17-1`（**该槽在 0.1.1 存在、0.1.5 线被删除 ⇒ 用户可感知回归**） | 0.2.0 GUI 中「分布式节点」入口**可见且可展开**；无静默丢失（用槽目录 diff 工具核对） | — | **高**：`slots.inject` 对未声明 key **不报错不告警** ⇒ UI **无声消失** |
| **W-23** | `@local/dsh-workerspace` + `@local/dsh-ssh-gui` settings 装配（**撤销**） | `lib/index.js`（workerspace `:30/41/123`；ssh-gui `:49/68/173`） | `T17 §4.1/§4.2` 判「真 import ⇒ ESM `SyntaxError` ⇒ 整行加载失败」（**已动态复现**） | **不派工**：迁移后的部署件上，这两个符号的命中**全部位于块注释内**（迁移说明），**无真 import** | `[部署件实测]` **本档我实测**：`assembly-020/…/workerspace/lib/index.js:41` 与 `ssh-gui/lib/index.js:65,69` 的命中均在 `/** … */` 注释内；`grep '^import'` 无 `dsh-settings` | 见 §4-批次1 `V-1.5`（真 import 命中数 = 0） | — | **极高（若误判会重复劳动）**：**被否一方 = `T17-U-1`/`T17-U-2`**；其证据取自 `~/.dsh/profiles/node_modules`（0.1.1 现役根），**不适用于已迁移件** |

### 2.6 工单总表 — 批次 5｜wallpaper + taste + office + 工具链/文档

> 文件边界：`dsh-wallpaper-local`/`@local/dsh-wallpaper/**`、`dsh-taste/**`、`office-handoff/**`、`.workspace/audit-020/tools/**`+guard 工具链、文档。**四条子链互不重叠，可完全并行。**

| 单元号 | 归属插件/面 | 文件·位置 | 现状 | 改为 | 依据类型与出处 | 验收标准 | 依赖单元 | 风险 |
|---|---|---|---|---|---|---|---|---|
| **WP-01** | wallpaper / 元数据 | `package.json`（`peerDependencies`、`dsh.client.inject`） | 4 条 peer 上界 `<0.2.0`；inject 含已无 import 的 `dsh-settings` | ① 4 条 peer 改 `<0.3.0`；② 删 `dsh-settings` peer；③ inject 保留 `dsh-client-store`，新增 `dsh-client-ui-renderer`（`ctx.slots` 实际提供者） | `[源码实读]` `T28 MU1` + `T28 §3.1-H12`；`[部署件实测]` **我实测**部署件 client.js 仅 1 处 `dsh-client-runtime`（**注释**，见 §1.3-C） | `evaluatePluginCompatibility(manifest, {}, "0.2.0-rc.1")` **且** `"0.2.0"` 均返回 `undefined`；启动日志无 `is incompatible with dsh`；`compatibility.json` **不出现**该插件 | — | **高**：`0.2.0-rc.1 < 0.2.0` 成立于 rc.1，但稳定版一发布即 deny 整行 |
| **WP-02** | wallpaper / 会话页信号（**本族唯一功能性不兼容**） | `lib/client.js:604-608`（`pageState.current = ctx.sessions.list.getSnapshot().current`） | 读 `SessionListState.current`（0.2.0 **已无该字段**）⇒ `currentPage()` 恒返回 `home` | 经可验证信号源维护 `pageState.current`：候选 (a) 在未被占用的 `session-maybe` 槽注册不渲染 DOM 的哨兵组件，读作用域 prop `sessionId`；候选 (b) `ctx.layout.panelInfo.activePanelId === null` 配合 (a)/(c)；选定后替换两处赋值与订阅 | `[源码实读]` `T28 MU2`（0.2.0 `SessionListState` = `{ids, byId, phase, projectionsBySession}`；0.1.1 曾有 `current`） | 三态实测：① home → 命中 `home` 覆盖；② 选中/新建会话 → 命中 `session` 覆盖（**0.1.7 移植档在此条必然失败，故这是回归判据**）；③ 设置 General → 命中 `settings`；④ 关闭设置回落到 ①/② 正确状态 | — | **高**：属 0.1.7 移植档遗留缺陷，须本轮一并修 |
| **WP-03** | wallpaper / 配置持久化 | `<新home>/profiles/web/cordis.patch.yml` 的 `wallpaper`/`ui-theme` entry `config:` | 0.1.7 那轮**没迁移**壁纸配置：profile patch 的 `wallpaper` 条目只有 id/name 而无 `config:`；`settings.yaml.imported` 仅 `{}\n` | **路径 A（推荐）**：先把 patch 里两 entry 准备成可配置状态，再投放 `~/.dsh/settings.yaml`，交由 boot 的 `importLegacyDocument()` 一次性导入；**路径 B**：手工写 patch 的 `config:`，**不投放** `settings.yaml` | `[源码实读]` `T28 MU3` + `T28 §4.3` + `MIGRATION-ASSESSMENT §N14`（我实读） | `<新home>/settings.yaml` 不再存在、`.imported` 存在且覆盖全部 section；bootstrap 日志**无** `section … was not imported into entry …` 警告；patch 中 `wallpaper.global.source` 指向迁移后图片 | WP-04 | **高**：`rename-first` **顺序不可颠倒**；任一 section 的 entry 不存在即**永久只留在 `.imported` 且不重试** |
| **WP-04** | wallpaper / 资源迁移 | `~/.dsh/wallpapers/37758c1c-….png`（2 334 260 B，sha256 `5fd2309b21d9…`）→ `<新home>/wallpapers/` 同名 | 0.1.7 隔离 home 的 `wallpapers/` **为空**（图片从未迁移） | `cp -p` 复制（保留权限）；**不改名、不转格式、不放其他目录** | `[源码实读]` `T28 MU4` + `T28 §4.2`（我实读） | ① 目标 sha256 == `5fd2309b21d9…`；② **源文件 sha256 不变**；③ `<新home>/wallpapers/` 文件集合 == 配置引用集合；④ 实例运行一段时间后源文件仍不变（证明 mediaRoot 未回落 `~/.dsh`） | — | **高**：若 root 服务缺失且 `$DSH_HOME` 未设，mediaRoot 会**回落到现役 `~/.dsh/wallpapers`**，而客户端 `/cleanup` 会删除未被引用的图片 ⇒ **`WP-04` 验收②④是保护现役的唯一判据** |
| **WP-05** | wallpaper / 安装脚本与元数据 | `install.sh`（`:28-30`、`:35`、`:37`、`:39`、`:82-89`、`:100`）、`README*.md` | `CLIENT_INJECT_PKGS` 含 `dsh-client-runtime`；`HOST_DEPS` 含 `dsh-settings`；`BROKEN_PKGS` 含已正常的官方包；默认路径写死 `~/.dsh`；注释仍写「配置走 `~/.dsh/settings.yaml`」 | ① `CLIENT_INJECT_PKGS` 换 `dsh-client-store`（按 `WP-01` 决定是否加 `ui-renderer`）；② `HOST_DEPS` 删 `dsh-settings`、保留 `schemastery`；③ `BROKEN_PKGS` 收窄；④ 默认路径支持 `$DSH_HOME`（**避免误装进现役 `~/.dsh`**）；⑤ 追加条目时写入 `WP-03` 的 `config:` 块并改注释 | `[源码实读]` `T28 MU5`（我实读） | 在隔离根用 `WALLPAPER_INSTALL_DEST`/`WALLPAPER_PROFILE_PATCH`/`WALLPAPER_CLIENT_MODULES` 覆盖执行，脚本成功结束；执行前后 `~/.dsh/wallpapers/*`、`~/.dsh/settings.yaml`、`~/.dsh/profiles/web/cordis.patch.yml` 的 sha256 **完全不变** | WP-01, WP-03 | **高**：脚本会 `rm -rf` 目标目录并追加 profile patch（**阶段二写操作**） |
| **T-01** | taste / 图标（**已闭环 + A/B 验证，登记**） | `dsh-taste/lib/client.js:298/383/706/707/708` + `test/client.test.js` 的对应 mock 键 | 5 处 `Icon*Outline16`（**0.1.1→0.1.7 就退役，非 0.2.0 引入**） | 已改为 `Icon*OutlineRegular`（**仅改标识符，`size` 实参不变**；`Regular` = 1px 描边，与 16px 常规字重最接近）。修复前原件已移出 `lib/`，存 `.workspace/audit-020/taste-iconfix-backup/` | `[部署件实测]` **本档我实测**：`assembly-020` 内 taste `client.js` = `82b329979bc0`，`OutlineRegular` = **5**、`Outline16` = **0**；`[源码实读]` `MIGRATION-ASSESSMENT` 末章「N12 已闭环并 A/B 验证」 | `grep -n "Outline16" lib/client.js` → **0 命中**；`node --check lib/client.js` 通过；5 个替换名**逐一**在 0.2.0 `primitives` 的 `export {}` 名单中**存在**（**不得**用字符串包含判定——`IconTrashOutline` 是 `IconTrashOutlineRegular` 的前缀，会产生假阳性）；**A/B 实测**：已修 202 pass / 16 fail，回退修复前 201 pass / 17 fail ⇒ **净收益 +1、无新失败** | — | 低：**协调者已修好并通过 A/B**；剩余 16 个失败为**既有夹具/环境问题**，与本修复无关 |
| **T-02** | taste / 测试同步（**已随 T-01 一并完成**） | `test/client.test.js:34-38`（5 个 mock 键）、`:204-205`（2 处字符串门） | 原断言旧图标名 | **已随 `T-01` 一并改名**（协调者同批处理） | `[源码实读]` `MIGRATION-ASSESSMENT` 末章（"5 处图标标识符 + 测试夹具 `test/client.test.js` 的对应 mock 键"） | `test/client.test.js`（唯一触及图标的套件）单跑 **7 pass / 0 fail** | T-01 | 低：**已闭环** |
| **T-03** | taste / 声明与依赖（**合并 T26-U3+U4**） | `package.json`（`dsh.client.inject`、`peerDependencies`） | inject 含 `@deepseek-ai/dsh-client-runtime`；7 条 peer = `^0.1.1-rc.2` | ① 删失效 inject 项（可选补 `dsh-client-ui-primitives`/`dsh-client-store`）；② 7 条 peer 改 `^0.2.0-rc.1` | `[源码实读]` `T26 §8.5-U3/U4` + `MIGRATION-ASSESSMENT §N10-N1`（信息性字段，静默跳过）；`[部署件实测]` **我实测**残留仅为注释（§1.3-C） | 面板加载与槽位注册行为**无变化**（回归对照）；若走 pnpm 路径无 unmet peer 警告 | — | 低：**纯清理，不修也能正常迁移** |
| **T-04** | taste / 测试夹具（可选） | `test/learner.test.js:31/208/288`、`test/backfill.test.js:31/409`、`test/index.test.js:44` | fake `assistant/message` 事件未带 `stream`（0.1.7 起 `AssistantOutputFold.push` 无条件调 `joinAssistantStreamText(event.data.stream)`） | 每个 fake 事件 `data` 补 `stream: []` | `[源码实读]` `T26 §8.5-U2` | 0.2.0 依赖树上 `node --test test/*.test.js` → **≥215 pass**；剩余 3 项环境性失败需**另择不在任何 git 仓库内的 TMPDIR** 后才应归零 | T-01 | 低：**不改则不得把套件绿灯作为验收依据** |
| **T-05** | taste / CSS overlay 顶距（可选，**0.2.0 新增面**） | `lib/client.js:21`（`.ts_root`） | `top:12px`；`grep overlayTopMargin\|--dsh-frame` → 0 命中（**完全未跟随官方约定**） | `top: max(12px, var(--dsh-frame-overlay-top, 12px))`，与官方 5 个消费方写法一致 | `[源码实读]` `T26 §8.4-2` + `§8.5-U5`（我实读） | Linux 上渲染前后**像素级无差异**（变量缺失回退 12px）；`grep -n "dsh-frame-overlay-top"` 命中 **1** 处；Windows 或置 `data-windows-titlebar` 的仿真下顶部不再侵入标题栏拖拽带 | — | 低：**Linux 无影响**；由「是否支持 Windows 桌面」决定是否执行 |
| **T-06** | taste / 明确**不改**（否决登记） | `lib/client.js` 的 `z-index`；自建 store | — | **不抬高** taste 面板 `z-index` 以压过 `plugin-manager` 的失败 toast；**不**引入官方 `dsh-client-store` 替换自建 store | `[源码实读]` `T26 §8.4-1` + `§8.5-U6`（`shell.overlay` 本就是共享 **list** 槽位；plugin-manager toast 无 `order`/`priority` ⇒ 同序且 `pointer-events:none` 不拦截点击；**仅插件刷新失败时短暂出现**） | —（否决项，仅需在评审中保持不改） | — | 低：抬高 `z-index` 会**反向遮挡**官方失败提示与 workspace 的重命名/归档对话框 |
| **O-01** | office / turn 尾卡注册 | `@local/dsh-pptmaster` 的 `conversation.chat.turnTail` 注册处 | 0.1.1 时该槽是 **`chain`**（含 `select` 的注册可用）；**0.1.7 与 0.2.0 是 `list`** ⇒ 含 `select` 的注册在**注册期**必然失败、缺 `id` 会抛 `requires options.id` | **必须在隔离实例实跑**确认是否抛；若抛则在同一注册处补 `id`（官方先例：`@deepseek-ai/dsh-client-ui-deliverables`） | `[源码实读]` `T15 §10.1`（**归因更正：漂移发生在 0.1.1→0.1.7，非「0.1.7 起」**）+ `T15 §5.3-2` + `T15 §7 U-1` | 客户端 console 断言：无 `list slot "…" requires options.id`、无 `slot entry crashed in 'conversation.chat.turnTail'` | — | 中：属**存量债**（对 1.7→0.2.0）但对「0.1.1 直迁 0.2.0」是新增债 |
| **O-02** | office / pptmaster 私有依赖岛（**N10 方案 B 的延伸**） | `@local/dsh-pptmaster/node_modules/@deepseek-ai/`（**23 项**，`primitives` 钉 `0.1.1-rc.2`） | 该嵌套树是**旧图标符号存活的唯一原因**，也是版本漂移风险源；现役靠它兜住 `IconBrowseOutline16` | 与 `MIGRATION-ASSESSMENT §N10-N3` 同源：**丢弃岛**，改 `peerDependencies` + 让解析落到共享树 0.2.0；`T15-K5` 要求「提升/去嵌套必须与图标改名同批」 | `[源码实读]` `MIGRATION-ASSESSMENT §N10-N3`（我实读，实测 pptmaster 岛 = **23** 项）+ `T15 §5.1-K5` + `T15 §7 U-3/U-10` | 解析目标实例上**无** `Outline16` 依赖；`grep Outline16` 在插件 `lib/client.js` = 0；客户端模块 `require` 失败数 = 0 | WP/B 无关，独立 | **中**：N10 的裁定文字聚焦 WE；**pptmaster 岛的去留属本工单新增的延伸确认项**（见 §6-UV-01） |
| **O-03** `[条件]` | office / `office-handoff` 锁标记 | `~/.dsh/office-handoff/`（本地自研独立 CLI 接收器 `dsh-office-handoff@0.1.0`）；锁标记记录 | 标记记录的是 **0.1.1** 的 `dsh-atomic-write`（`da4f2c9f…`，**今天仍有效**），而 0.1.7/0.2.0 的是 `5f07978e…` ⇒ 原地覆盖/移除会抛 `lock-module-changed`、**退出码 10、明令不降级** | **必须重录锁标记**，且 `install.sh` 前必须显式设 `DSH_OFFICE_HANDOFF_ATOMIC_WRITE=<0.2.0 路径>`（`lockStatus()` 优先级 env > 记录 > PATH；**不设 env 会把 0.1.1 旧指针原样再记一遍 = 等于没修**） | `[源码实读]` `MIGRATION-ASSESSMENT §N11`（我实读） | 重录后写路径不再抛 `lock-module-changed`；`env` 变量在 `install.sh` 前显式导出（可在脚本里 `grep` 到） | **§5-4（Route A/B 裁决）** | **中**：本单元**只在选定 Route 后才有意义**（若放弃接收器则整块不派） |
| **O-04** | office / 裁剪与退役（**登记**） | `<profile>/cordis.patch.yml`；`workbuddy-reverse-proxy/**` | — | ① **保留 5 条**（K1–K5）；② **裁剪 3 条**（C1 官方 office 技能默认不启用；C2 **明确禁止**把 `dsh-sdk-app` 加进 bundles；C5 官方 docx/xlsx 按需）；③ **退役 4 条**（C3 反代部分维持退役；C4 历史档只作证据；R1 退役「官方取代自建 PPT 链」预期；R2 退役「为官方 office 技能准备新 settings 段」） | `[源码实读]` `T15 §5.1` + `§5.2` + `§6.3`（我实读） | 不作任何配置改动；`office-to-pdf` 随 `dsh-web-app` bundle **自动挂载**，无需改动 | — | 低：**默认裁剪，不产生动作** |
| **G-01** `[未核]` | guard 工具链 / 口径来源 | `lib/dbfold.mjs:18,24` | 把口径来源插件**写死为现役 0.1.1 绝对路径**，且是模块顶层 `await import()` ⇒ 0.2.0 下会**静默测错对象**（测的是 0.1.1 落库语义） | 最小改造 = 一个 **env 覆盖** | `[未核]`（**T07 原文未读**）——出处为 `MIGRATION-ASSESSMENT §N13`（我实读其转述） | `env` 覆盖后工具链测的是 0.2.0 对象（输出中含 0.2.0 路径） | — | **高**：静默测错对象 ⇒ 全部绿灯无意义 |
| **G-02** `[未核]` | guard 工具链 / **N-1 静默安全缺口（必踩）** | `run-p7-restore-drill.mjs` 的 `FORBIDDEN_PREFIXES` | 前缀与真实库清单**全部由 `$HOME` 派生**，且只列到 `~/.dsh`/`~/.dsh-017`/`~/.npm-global*` —— **没有 `~/.dsh-020`（也没有工作区内隔离根）**。实测：`HOME=<伪 home>` 时真实库断言**整段消失**，退出码**仍为 0（PASS）** | 把隔离根**追加**进 `FORBIDDEN_PREFIXES`，并对**「断言条数为 0」显式判 FAIL** | `[未核]`（T07 原文）——出处 `MIGRATION-ASSESSMENT §N13`（我实读） | 伪 HOME 下退出码**非 0**；断言条数 ≥ 基线值 | — | **极高**：0.2.0 隔离迁移的天然姿势就是改 `HOME` ⇒ **必踩** |
| **G-03** `[未核]` | guard 工具链 / v4 支持 | 16 行代码（24 处字面量）把「高代」写死为 `session.v3.jsonl.zstd` / `generation: 3`；`header-contract.mjs` | 工具链**从未验过 v4**，而 0.2.0 产的就是 v4；`header-contract.mjs` 对 v4 工件**实测直接判红**（`version-not-3`，exit 2） | 支持 v4（高代改为 v4） | `[未核]`（T07 原文）——出处 `MIGRATION-ASSESSMENT §N13`（另有 `[源码实读]` 旁证：`~/.dsh-017/sessions` 已有 **8 个** `session.v4.jsonl.zstd`） | 对 v4 工件 `header-contract.mjs` 不再判 `version-not-3` | — | 高 |
| **G-04** `[未核]` | guard 工具链 / 白名单重冻结 | `expected.mjs`、`select.mjs` | 条目**不携带机制依据**（A329 仍未落实 `mechanism` 字段）；匹配**禁通配**（严格 index+type 全等）；`declaresNoDifference` 恒 false | 新样本下**整份重冻结**；`select.mjs` 新增机制类 `stale-generation-id-remint`（判据已给出、**仍禁 glob**） | `[未核]`（T07 原文）——出处 `MIGRATION-ASSESSMENT §N13` | 重冻结后 `run-all.sh` ALL GREEN | G-03 | 中：`kind`/`bytesDelta`/`timeDelta` **从未被任何断言读取** ⇒ 机制注释可**静默漂移** |
| **G-05** `[未核]` | guard 工具链 / 编排完整性 | `run-all.sh` | **只编排 5 步**；`run-p7-restore-drill.mjs` 与 `run-a329-attribution.mjs` **不在其内** ⇒ 只看 `ALL GREEN` 会漏掉「预映像可恢复」与「A329 机制复算」 | 把两者并入 `run-all.sh` | `[未核]`（T07 原文）——出处 `MIGRATION-ASSESSMENT §N13` | `run-all.sh` 步数 ≥ 7；含 p7 与 a329 | G-02 | 中 |
| **G-06** `[未核]` | guard 工具链 / 口径纪律 | 历史 seal 引用 | guard `4c159098…` = **迁移副本** seal（`_migration/usage-v4-017/lib/ingest-dsh.js`）；PPT `d2190648…` = 迁移副本（`_migration/ppt-017/dsh-pptmaster/lib/client.js`）；而**现役** `@local/dsh-pptmaster/lib/client.js` 实为 `e2b5d28b…`、现役 `@local/dsh-usage/lib/ingest-dsh.js` 实为 `f735185e…`（guard **未部署**） | 引用 seal 时**必须连口径一起写**；不得把「迁移副本 seal」当作「部署件 seal」 | `[未核]`（T07 原文）——出处 `MIGRATION-ASSESSMENT §N13` | 文档/seal 注释中口径标注齐全 | — | 中：混口径会产生假阴性 |
| **D-01** `[未核]` | 文档收口（**登记**） | `T31-docs-impact-inventory.md` 的 **30 个**交付单元 / **209 处**硬编码版本与路径断言 / **17 份**文档 | 迁移后文档中的版本/路径断言全部过期 | 按 T31 清单更新 | `[未核]`（**T31 原文未读**）——出处为 `RUNBOOK-020.md §14-4`（我实读） | —（**须先补读 T31 原文**再决定是否派工） | 批次 1–4 完成后 | 低：不影响运行 |

### 2.7 冲突裁决台账（**10 条**）

> 规则：两档对同一单元给出不同结论时，以 `MIGRATION-ASSESSMENT.md` 的裁定 + **部署件实测**为准；**被否一方逐条写明**。

| # | 冲突主题 | 甲方主张 | 乙方主张 | **裁决** | 被否一方 | 影响单元 |
|---|---|---|---|---|---|---|
| **1** | pptmaster 图标改名是否「必须」 | `T15 §5.3-1`：**必须**改 4 处（`IconBrowseOutline16`→`Regular` ×3、`IconInspectOutline12`→`Regular` ×1），依据其分析的 0.1.1 原始部署件 `e2b5d28b…` | `MIGRATION-ASSESSMENT §协调者实测更正`：**N12 的图标项已不成立**（部署件 `d2190648…` 残留 **0**） | **采纳乙方**。本档实测复核：`assembly-020/…/@local/dsh-pptmaster/lib/client.js` = `d21906483454`，`Outline16` = **0** ⇒ 上一轮已做 | `T15 §5.3-1` 的图标项 | `O-02` 的图标部分（撤销）；`O-01` 不受影响 |
| **2** | btw 的迁移基线 | `T30 §1.4`：**必须取工作区源码**（"工作区 112 文件 ⊃ 部署件 89 文件，部署件落后约 40 小时"） | 部署件优先级纪律（§1.2-3）：不得按源码树派重复劳动 | **采纳乙方**。本档实测：工作区 `lib/client.js` = `078ef49d3940`（`Outline16`=18、`dsh-client-runtime`=14+2），已迁移部署件 = `606f53f13f61`（0/0）⇒ **二者已分叉，工作区不是超集** | `T30 §1.4`（其结论是对 **0.1.1 现役部署根**对账所得，不适用于已迁移组合件） | `B-02`、`B-08`、`B-10`（降为 `[条件]`）、`B-15` |
| **3** | workerspace / ssh-gui 的 settings 具名导入 | `T17-U-1`/`U-2` + `T17 §4.1/§4.2`：真 import ⇒ ESM `SyntaxError` ⇒ **整行加载失败**（**已动态复现**） | `PLUGIN-MATRIX`（口径声明）：`btw`/`ssh-gui`/`wallpaper`/`workerspace` **已迁移**、无具名导入、`import` **OK**；settings 断层**只阻塞 3 个** | **采纳乙方**。本档实测仲裁：`assembly-020` 的 `workerspace/lib/index.js:41` 与 `ssh-gui/lib/index.js:65,69` 的命中**全部位于 `/** … */` 块注释内**，`grep '^import.*dsh-settings'` = **0** ⇒ 无链接期失败 | `T17-U-1`、`T17-U-2`（其证据取自 `~/.dsh/profiles/node_modules`，即 **0.1.1 现役根**） | `W-23`（撤销）；批次 2 的工作量由「7 插件」收敛为「**3 插件**」 |
| **4** | `/dsw` 通道的修法 | `T24-U10`：**改为 2 参 `handle`，去掉第 3 参即可** | `T17 §10.2`：该修法**既恢复不了 loopback 豁免、又预设了未验证的「注册本来就成功」**；落点应改用 `connection.fetch.register` | **采纳乙方**（并加前置闸门）。`T24` 的修法**降级为条件**：须以 `T17 §8.10` 的真机 boot 实验为前置闸门 | `T24-U10` 的「去掉第 3 参即可」表述 | `W-10`、`W-21`（→ §5-3） |
| **5** | `rpc.handle` 是否**必抛** | `T24` E-1：`dsh-client-connection` 的 `inject` 由 `["webServer","credentials"]` 收紧为 `["credentials"]` ⇒ `rpc.handle` **必抛** | `T17 §2.3` 最小复现（`cordis@4.0.4`）：`owner.webServer` **无论 inject 如何都解析成功**（服务值落在 root fiber store），**不抛**；仅当 `webServer` 完全未挂载时才失败 | **采纳乙方**。确定的变化只是**第 3 参被静默丢弃 ⇒ loopback 信任豁免消失** | `T24` E-1 的「必抛」归因（`T17 §10.3` 已确认其**事实描述**部分一致、仅归因被否） | `W-10` |
| **6** | WE 的迁移基线版本 | `T24 §2.1/§5`：基线 = tag **`v0.1.2`**（与部署件等价），按此拆 19 个单元 | `T17 §4.3` + `U-6/U-7`：0.1.2 **「不确定，不建议」**（`/dsw` 丢 loopback 豁免、缺 0.1.4 的会话连接/远程围栏/审批门）；须**先升 0.1.4+**，并写入「插件 ≤0.1.3 + 宿主 ≥0.1.7 = 拒绝迁移」闸门 | **采纳乙方**：基线升 **0.1.4+**，并加 `upstream.yml` 哨兵通道（L1 闸门 #6） | `T24 §2.1/§5` 的 `v0.1.2` 基线选择 | `W-20`（前置）；与 `W-18`（3 处本地补丁回流）**耦合** |
| **7** | `sidebar.workspaces.remoteHosts` 是否算迁移回归 | `T16`（`:499,668`）：该槽"在 0.1.1 的 48 项目录里**不存在**，0.2.0 也不存在 ⇒ **既有失效**"，判 `dsh-ssh-gui` 为「需改（**小**）· 1 处席位迁移」 | `T17 §10.1` 实测：该槽 **在 0.1.1-rc.2 存在**（`dsh-client-ui-workspace` 的 `slots.d.ts` + `client.js`），在 **0.1.5 线被删除** ⇒ 0.2.0 上**静默消失**，是**用户可感知的迁移回归** | **采纳乙方**（`MIGRATION-ASSESSMENT §T17-1` 已据此定：**必须写入切换前知情告知**）。本档实测复核：迁移后 `ssh-gui/lib/client.js` 仍有 **5 处**注册 | `T16` 的「历史死项」判定与「工作量小」估计 | `W-22`；§5-5 裁决项 |
| **8** | 客户端图标 / `dsh-client-runtime` 残留计数 | `T15`：pptmaster 部署件**仍是旧图标**；`T16`：`dsh-btw` 有 **9 个**退役图标 + **3 个**插件客户端 `require` 已消失的 `dsh-client-runtime`；并称「两份 profile 里完全相同、**未重建过**」 | `MIGRATION-ASSESSMENT §协调者实测更正`：新组合客户端件**逐字节等于 0.1.7 组合（U）**、**全部不等于现役 0.1.1 的件** ⇒ **上一轮确实重建过**；退役 `*16` 图标在 6 个 bundle 中均为 **0**；`dsh-client-runtime` 残留**只有 wallpaper 1 处** | **采纳乙方**。本档实测复核：btw **0/0**、pptmaster **0/0**、usage **0/0**、ssh-gui **0/0**、wallpaper **0 / 1（注释）**、taste **0 / 1（注释）** ⇒ 并**修正 `MIGRATION-ASSESSMENT` 表**：taste 的 1 处残留**未登記**，且 wallpaper/taste 的残留**均为注释、非 `require`** | `T15`/`T16` 的客户端断言（`MIGRATION-ASSESSMENT` 已明令：**落地前必须以部署件实测复核每一条客户端断言，不得直接按报告条目派工**） | `B-08`、`T-01`、`O-02`、`WP-01`；新发现见 §1.3-C |
| **9** ★ | entry id 与命名空间的对齐方向 | `T04-F-3` 推荐**方案 (a)**：**改 entry id** 与 `settings.yaml` 旧段名对齐（`usage`→`dsh-usage`、`ssh-gui`→`dsh-ssh-gui`、`workerspace`→`dsh-workerspace`、`btw`→`dsh-btw`、`web-search-sse`→`web-search-deepseek-sse`），理由是**保住现网配置且不动插件逻辑** | 上一轮迁移已在部署件里**反向定案**：保持行 id，让**命名空间随 entry id**（插件内已写字面量 `SSH_GUI_ENTRY_ID='ssh-gui'`、`WS_ENTRY_ID="workerspace"`、`BTW_SETTINGS_ENTRY_ID="btw"`，并注释「旧 ns ↔ 新 id **不等**；值面由单一写入者在 patch 写 `- id: <新 id>` 的 id 定向 `config:` 行」） | **采纳乙方**（部署件既定事实 + 部署件优先级纪律）。⇒ 旧段名**不会自动落位**，必须显式把值写进对应 entry 的 `config:` 行。**唯一例外**：`web-search-sse` 的命名空间（`web-search-deepseek-sse`）与行 id 在部署件上**仍不一致** ⇒ 该一处仍须修（`P-05`） | `T04-F-3` 的推荐方案 (a)；`T17-U-2` 的「命名空间由 `dsh-ssh-gui` 改为 profile 行 id `ssh-gui`」表述（方向正确但单元已撤销） | `P-06`、`P-05` |

| **10** ★ | N2 的处置方向（重打宿主补丁 vs 零补丁降级） | `RUNBOOK §10-N2` + `§14-2`：处置 = **重新施加补丁**（宿主半）+ 插件两端重写 + settings 数据迁移（"目标文件哈希已变，**不可直接套用旧 diff**"） | `T06 §B` + `MIGRATION-ASSESSMENT §F`：`@local/dsh-subagent-model` 的**消费侧是本地改造过的 `dsh-tool-subagent`**（现役 695 行 vs pristine 296 行；0.1.7/0.2.0 官方包均**无读取点**）⇒ 在全新 0.2.0 上单装该插件只会得到一个**无人消费的设置页**；**建议退役**，改由 preset 的 `agentOptions` 钉死（与 `N2 方案 B` 一致） | **不裁决，登记待用户裁决**（见 §5-9）：两条都是**自洽**的，差异是**行为取舍**——方案 A 恢复「settings 面可调 + 改完对后续派发热生效」，方案 B 接受「改模型 = 重开会话 / 需编 preset」，但**零宿主补丁、零 0.2.0 源码特化**。**执行档不得自行拍板。** | 不适用（无被否方，属产品取舍） | `P-07`、`P-01`、`P-02`、`C-10`、`C-04` 的 `dsh-subagent-model` insert 行 |

**附注（两条「未判定项」已被实测消解，非冲突）**：
- `T24 §8-N2`（`ctx.set` 能否顶掉官方已 provide 的服务）⇒ `MIGRATION-ASSESSMENT §N10-N2` 用 `cordis 4.0.4` 最小复现：**允许**，后注册者胜。
- `T24 §8-N3`（私有岛重装是否会被重建）⇒ `MIGRATION-ASSESSMENT §N10-N3` 实测：**不会**，岛随包分发；因此保留岛 = **永久 0.1.1 语义** ⇒ 方案 A 不是「保守」而是「半吊子」。

---

## 3. 依赖图与批次

### 3.1 依赖图

```
[批次 0｜前置闸门 G0-1..G0-6]（含 §1.3-A 插件来源根裁决）
        │
        ▼
[批次 1｜组合层与装配层]  C-13 ──> C-01 ──> C-02 ──> C-03 ──> C-04 ──┬─> C-05 ──> C-10 ──> C-11
                            └─> C-06 / C-07 / C-08 / C-09 / C-12 / C-14（互不依赖，可并行）
        │                                                                    │
        ├──────────────────────────────┬───────────────────────────────┬─────┘
        ▼                              ▼                               ▼
[批次 2｜settings 断层]         [批次 3｜btw]                   [批次 4｜WE + ssh 族]
 P-01 ──> P-02                  B-15（基线裁决）                W-20（基线升版，前置）
 P-03  ┐                         ├─> B-01 ──> B-08 ──> B-13     W-16 ──> W-17 ──> W-18
 P-04 ─┴─> P-08                  │            └─> B-10          W-01 ──> W-02
 P-05（独立）                     ├─> B-05（独立）                W-03 / W-04 / W-05 ──> W-06
 P-06 ──> C-04/C-05              ├─> B-06 ──> B-07 ──> P-04      W-07 ──> W-08 ──> W-09
 P-07 ──> C-10 / P-01            ├─> B-03 ──> B-04              W-10（§5-3 闸门）──> W-21
                                 ├─> B-09（未判定）              W-11 / W-12 / W-13 / W-14 / W-15
                                 ├─> B-11 / B-12                W-19（与 C-08 同文件，串行）
                                 └─> B-14（全档 tsc 基线先行）   （W-23 撤销）
        │                              │                               │
        └──────────────┬───────────────┴───────────────┬───────────────┘
                       ▼                               ▼
              [批次 5｜四条并行子链]
              子链 5a：WP-01 ──> WP-03 ──> WP-05 ；WP-04（独立，但 WP-03 依赖其文件已就位）
              子链 5b：T-01 ──> T-02 ；T-03 / T-04 / T-05 / T-06
              子链 5c：O-02（独立）；O-01（需实跑）；O-03（待 §5-4 裁决）；O-04（登记）
              子链 5d：G-03 ──> G-04 ──> G-05 ；G-01 / G-02（独立，最高优先）；G-06
                       ▼
              [全局终验：Runbook §11 V1–V12（已按 N17 选项 (c) 修订）+ §4-终验]
              （V9 废止；V12 只在 0.1.1 侧有意义）
```

### 3.2 批次 × 并行性 × 文件边界

| 批次 | 串行/并行 | 文件边界（**边界不重叠才可并行**） |
|---|---|---|
| **0** | 串行（必须最先） | 只读：`~/.dsh/**`（只读）、运行日志、dump 输出 |
| **1** | **全批串行**（同一文件 `cordis.patch.yml` + 同一棵 `profiles/node_modules/`） | `<新home>/profiles/web/**`、`<新home>/profiles/node_modules/**` |
| **2** | ✅ 与批次 3、4 **并行** | `@local/dsh-subagent-model/**`、`@deepseek-ai/dsh-{session-board,vision-adam}/**`、`@local/dsh-web-search-sse/**` |
| **3** | ✅ 与批次 2、4 **并行** | `dsh-btw/**` |
| **4** | ✅ 与批次 2、3 **并行**（**族内**：`W-16/W-17/W-18` 串行；`W-19` 与 `C-08` 同文件 ⇒ **必须由批次 1 的同一写入者串行处理**，不得并发） | WE 仓库 `/**`、`@local/dsh-ssh-gui/**`、`@local/dsh-workerspace/**` |
| **5** | ✅ 四条子链并行（5a/5b/5c/5d 边界互不重叠） | `@local/dsh-wallpaper/**`+`dsh-wallpaper-local`、`dsh-taste/**`、`office-handoff/**`+pptmaster、guard 工具链目录 |

**唯一写入者规则（强约束）**：
1. `cordis.patch.yml` —— **只有批次 1 可写**；批次 4 的 `W-19` 如确认要改，须**回排到批次 1**。
2. `compatibility.json` —— 只有 `C-12` 可写。
3. `<新home>/settings.yaml` 的投放 —— 只有 `WP-03` 可做，且**投放一次**（rename-first 不可重试）。
4. `dsh-btw/**` —— 只有批次 3 可写。
5. 三个失败插件目录 —— 只有批次 2 可写。

---

## 4. 每批次的停止条件与验收

> 所有命令沿用 Runbook §0 的变量：`ROOT` / `PORT` / `CLI` / `NATIVE`。
> **停止条件未过 ⇒ 不得进下一批**；记录**实际输出**（不是「应该通过」）。

### 4.0 批次 0｜前置闸门（只读，任一条不符**先停**）

```bash
cd /home/CNS2026495165/dsh
# V-0.1 现役仍 LISTEN
ss -ltn | grep -E ':(3080|3097) '
# 预期：两行 LISTEN。缺任一行 ⇒ 停。

# V-0.2 目标端口空闲（bind-only，不 listen）
node -e 'const net=require("net");const p=process.argv[1];const s=net.createServer();
s.once("error",e=>{console.log("PORT "+p+" => "+e.code);process.exit(0)});
s.listen(p,"127.0.0.1",()=>{console.log("PORT "+p+" => FREE");s.close();});' "$PORT"
# 预期：PORT 3098 => FREE

# V-0.3 现役配置指纹基线（活值，每轮必须重取）
sha256sum ~/.dsh/profiles/web/cordis.patch.yml ~/.dsh/settings.yaml
# 预期：记下两个值作为后续 V-8/V-12 的比对基准

# V-0.4 目标制品完整性
sha256sum /home/CNS2026495165/dsh/.workspace/dsh-020-pkg/deepseek-ai-dsh-0.2.0-rc.1.tgz
# 预期：ceb66bebe8117044e05f6932deaca15daea6a1ae1d0cffad079e33895f10d216

# V-0.5 备份清单行数与文件数一致
wc -l "$BK/SHA256SUMS"    # 预期 >100 且与备份文件总数一致
```

### 4.1 批次 1｜组合层与装配层 —— 停止条件

```bash
export CLI="$ROOT/prefix-cli/lib/node_modules/@deepseek-ai/dsh/lib/bin.js"
export NATIVE="$ROOT/prefix-cli/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai"
export PROF="$ROOT/home/profiles"

# V-1.1 组合可解析且条目数正确
env -i HOME="$ROOT/home" DSH_HOME="$ROOT/home" PATH=/usr/bin:/bin \
  node "$CLI" --profile web --dump-config | grep -c '^- id:'
# 预期：199（0.1.7 为 198）。为 0 或报错 ⇒ 组合未闭合。

# V-1.2 组合差异面恰好是 6 项（3 撤 3 增）
diff -u /home/CNS2026495165/dsh/.workspace/audit-020/dump-017.txt \
        /home/CNS2026495165/dsh/.workspace/audit-020/dump-020.txt | head -60
# 预期要点：新增 - id: otel / desktop-product-telemetry / product-analytics / ui-settings-session-log；
#          删除 time-context / schedule / ui-schedule；
#          session-telemetry-otel.exporter.url 默认值改为 dsh-otel-collector.deepseeksvc.com

# V-1.3 patch 未引用被删 id
grep -nE 'time-context|ui-schedule|^\s*- id: schedule' "$PROF/web/cordis.patch.yml" || echo "OK: patch 未引用被删 id"
# 预期：OK: patch 未引用被删 id

# V-1.4 旧 preset id 已退役、新 id 命中
grep -nE '^\s*- id: (agent-presets|agent-preset-registry)' "$PROF/web/cordis.patch.yml"
# 预期：只出现 agent-preset-registry（不得出现 agent-presets）
env -i HOME="$ROOT/home" DSH_HOME="$ROOT/home" PATH=/usr/bin:/bin \
  node "$CLI" --profile web --dump-config 2>&1 | grep -c "entry 'agent-presets' not found"
# 预期：0

# V-1.5 ★插件来源根闸门（本工单新增，§1.3-A）
#   (a) 13 个插件是否与「已迁移件」逐文件一致
A=/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/home/profiles/node_modules
for p in @local/dsh-btw @local/dsh-logfile @local/dsh-pptmaster @local/dsh-ssh-gui \
         @local/dsh-subagent-model @local/dsh-usage @local/dsh-wallpaper \
         @local/dsh-web-search-sse @local/dsh-workerspace \
         @deepseek-ai/dsh-taste @deepseek-ai/dsh-session-board @deepseek-ai/dsh-vision-adam \
         dsh-workspace-enhancement; do
  printf '%-34s ' "$p"
  if [ -d "$A/$p" ] && [ -d "$PROF/node_modules/$p" ]; then
    diff -rq "$A/$p" "$PROF/node_modules/$p" >/dev/null 2>&1 && echo SAME || echo "DIFF <-- 停，先对齐"
  else echo "ABSENT"; fi
done
# 预期：13 行全 SAME。出现 DIFF/ABSENT ⇒ 停（取错来源根，会退回未修状态）。
#   (b) 真 import 命中数必须为 0（注释命中不算）
for p in @local/dsh-btw @local/dsh-ssh-gui @local/dsh-workerspace @local/dsh-web-search-sse; do
  printf '%-28s settings真import=%s  ' "$p" \
    "$(grep -c '^import.*dsh-settings' "$PROF/node_modules/$p/lib/index.js" 2>/dev/null || echo 0)"
done; echo
# 预期：四行均为 0
#   (c) web-search-sse 必须是已修版
sha256sum "$PROF/node_modules/@local/dsh-web-search-sse/lib/index.js" | cut -c1-12
# 预期：5947d0909550

# V-1.6 peer 闸门豁免已就位（内容与格式）
node -e 'const c=require(process.argv[1]);
  const bad=Object.entries(c).filter(([k,v])=>!/^@?[\w@/.-]+@[^@]+$/.test(k)||!Array.isArray(v));
  console.log("entries:",Object.keys(c).length,"invalid:",bad.length)' "$PROF/web/compatibility.json"
# 预期：entries: 6 invalid: 0

# V-1.7 ★N17 选项 (c) 数据面纪律闸门（本工单新增，见 §5-1 与 G0-7）
#   (a) 新根**不得**承载历史语料
find "$ROOT/home/sessions" -type f 2>/dev/null | wc -l
find "$ROOT/home/attachments" -type f 2>/dev/null | wc -l
# 预期：两个数都远小于现役（现役为 2466 日志 / 991 附件）——**授权值 = 0**（新会话可能已产生少量新文件，须逐条核对归属）
#   若出现与现役同规模（>1000）⇒ 停：历史语料被误复制进 0.2.0 新根
#   (b) DSH_HOME 严格隔离（非空 + 绝对 + 落在隔离根内）
python3 - <<'PY'
import os
h = os.environ.get("DSH_HOME", "")
root = os.environ["ROOT"]
real = os.path.realpath(os.path.expanduser("~/.dsh"))
assert h.strip() != "", "FAIL: DSH_HOME 为空白 ⇒ 会静默回退真 ~/.dsh"
assert os.path.isabs(h), "FAIL: DSH_HOME 非绝对路径"
assert os.path.realpath(h).startswith(os.path.realpath(root)), "FAIL: DSH_HOME 未落在隔离根内"
assert os.path.realpath(h) != real, "FAIL: DSH_HOME 指向现役 ~/.dsh"
print("OK: DSH_HOME 隔离合规 ->", h)
PY
# 预期：OK: DSH_HOME 隔离合规
#   (c) 现役会话根未被写入（指纹与 §4.0 V-0.3 基线一致）
find ~/.dsh/sessions -type f -newermt "$(date -d '2 hours ago' '+%Y-%m-%d %H:%M:%S')" 2>/dev/null | wc -l
# 预期：仅现役自身仍在写的少量新会话（**不得**出现 0.2.0 侧的写入痕迹）
```

### 4.2 批次 2｜settings 断层与声明面 —— 停止条件

```bash
# V-2.1 三个插件不再 import 已消失符号
for p in @local/dsh-subagent-model @deepseek-ai/dsh-session-board @deepseek-ai/dsh-vision-adam; do
  printf '%-34s ' "$p"
  n=$(grep -c "installSettingsSection\|settingsNamespace" "$PROF/node_modules/$p/lib/index.js" 2>/dev/null || echo 0)
  echo "hits=$n  真import=$(grep -c '^import.*installSettingsSection' "$PROF/node_modules/$p/lib/index.js" 2>/dev/null || echo 0)"
done
# 预期：三行「真import=0」；hits 允许 >0 但必须**全部位于注释内**（人工确认）

# V-2.2 模块级加载级验证（不用起服务）
cd /home/CNS2026495165/dsh/.workspace/audit-020
node --input-type=module -e "
  const m = await import('$PROF/node_modules/@local/dsh-subagent-model/lib/index.js');
  console.log('IMPORT OK, exports:', Object.keys(m).sort().join(','));
"
# 预期：IMPORT OK（无 SyntaxError: does not provide an export named …）
# 对 dsh-session-board / dsh-vision-adam 各跑一次；vision-adam 额外断言三个符号仍在：
node --input-type=module -e "
  const m = await import('$PROF/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js');
  for (const s of ['analyzeImageBytes','resolveOptions','resolveApiKey'])
    console.log(s, typeof m[s] === 'function' ? 'OK' : 'MISSING');
"
# 预期：三行 OK

# V-2.3 键漂移逐条有去向（人工对照表 + 机器断言）
env -i HOME="$ROOT/home" DSH_HOME="$ROOT/home" PATH=/usr/bin:/bin \
  node "$CLI" --profile web --dump-config > /tmp/dc-020.txt
# 表内 id 采用「命名空间随 entry id」方向（§2.7 冲突 9）⇒ 除 web-search-sse 外，id 沿用现有行 id
for id in usage btw ssh-gui workerspace wallpaper web-search-deepseek-sse; do
  printf '%-26s ' "$id"; grep -q "^- id: $id$" /tmp/dc-020.txt && echo PRESENT || echo MISSING
done
# 预期：7 行全 PRESENT
#   —— 其中 web-search-deepseek-sse 是**唯一**需要改 id 的一处（P-05）；
#      其余 5 个沿用现有 id（btw/usage/ssh-gui/workerspace/wallpaper）。
#   —— `@local/dsh-subagent-model` 若按 P-07 方案 B 退役，则**不应**出现在该列表中（其 id 亦不得出现）。

# V-2.4 补丁后的 invariant 仍通过（仅方案 A 时）
node -e "require('$NATIVE/dsh-invariants')" && echo "invariants loadable"
```

### 4.3 批次 3｜btw —— 停止条件

```bash
cd /home/CNS2026495165/dsh/dsh-btw

# V-3.1 ★基线双向差集报告（本工单新增，§1.3-B）—— 必须先落盘
A=/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/home/profiles/node_modules/@local/dsh-btw
diff -rq "$A" . -x node_modules -x .git > /tmp/btw-baseline-diff.txt 2>&1 || true
wc -l /tmp/btw-baseline-diff.txt
sha256sum lib/client.js "$A/lib/client.js" | cut -c1-12
# 预期：报告落盘；两个 hash 明确记录（若走部署件基线，二者应一致；若走源码基线，报告用于证明「必须做 B-08」）

# V-3.2 构建与类型（三档）
pnpm run typecheck 2>&1 | tail -20
# 预期：0 error；若 >0，必须与 V-3.3 的基线对比后才能判定「是否更差」

# V-3.3 全档 tsc 基线（T30 §7 U-9，执行档必须先取）
#   在 .workspace/audit-020/ 内复制一份 btw 源码 + 指向 0.2.0 node_modules 的 tsconfig，
#   跑三档 --noEmit，把 error 数落盘作为闸门。
# 预期：基线落盘（数值本身不预设）

# V-3.4 关键契约点在产物中消失
grep -c 'has no create() factory' "$ROOT/logs/web-$PORT.log"   # 预期 0
grep -c "require(\"@deepseek-ai/dsh-client-runtime" lib/client.js   # 走源码基线时期望 0；走部署件基线时本项 N/A

# V-3.5 测试与冒烟
pnpm run test 2>&1 | tail -5
pnpm run smoke 2>&1 | tail -5
# 预期：全绿；smoke 断言「10 条 invocation 且每条 codec 有 create 函数」
```

### 4.4 批次 4｜WE + ssh 族 —— 停止条件

```bash
# V-4.1 私有岛已丢弃
ls "$PROF/node_modules/dsh-workspace-enhancement/node_modules/@deepseek-ai/" 2>/dev/null | wc -l
# 预期：0（目录不存在，或版本全为 0.2.0-rc.1）

# V-4.2 新抽象方法在宿主官方 provider 上存在（方案 B 的前提）
node --input-type=module -e "
  const fs = await import('$NATIVE/dsh-fs-local/lib/index.js');
  const sp = await import('$NATIVE/dsh-subprocess-local/lib/index.js');
  console.log('readByteRange:', typeof fs.LocalFileSystem.prototype.readByteRange);
  console.log('watch:', typeof fs.LocalFileSystem.prototype.watch);
  console.log('terminalEnvironment:', typeof sp.LocalSubprocessRuntime.prototype.terminalEnvironment);
"
# 预期：三行均为 function

# V-4.3 语言面不再抛（动态复现命令，取自 T17 §9 探针 4）
cd /home/CNS2026495165/dsh/.workspace/audit-020
node --input-type=module -e "
  const m  = await import('$PROF/node_modules/dsh-workspace-enhancement/lib/locale/host.js');
  const S  = (await import('$NATIVE/dsh-settings/lib/index.js')).default;
  const face = m.hostLocaleOf({ get: (n,d) => n==='settings' ? Object.create(S.prototype) : d });
  try { console.log('active() =>', face.active()); } catch (e) { console.log('THREW:', e.message); }
"
# 预期：active() => 'zh' 或 'en'（**不得**出现 THREW: settings?.get is not a function）

# V-4.4 目录选择器只有一个注册者
grep -c 'directoryPicker' "$ROOT/logs/web-$PORT.log"
# 预期：无重复注册报错；重复注册会有明确报错文案（人工判读）

# V-4.5 3 条 disable 不再生效（dsh.bundle.patch 已摘除）
grep -n 'dsh.bundle.patch' "$PROF/node_modules/dsh-workspace-enhancement/package.json" || echo "OK: 无 bundle patch 声明"
# 预期：OK: 无 bundle patch 声明
```

### 4.5 批次 5｜wallpaper / taste / office / 工具链 —— 停止条件

```bash
# V-5.1 壁纸资源迁移且现役未被越权改删
sha256sum "$ROOT/home/wallpapers/37758c1c-9ca8-47d2-bade-3048ab825fb6.png" | cut -c1-12
sha256sum ~/.dsh/wallpapers/37758c1c-9ca8-47d2-bade-3048ab825fb6.png | cut -c1-12
# 预期：两行均为 5fd2309b21d9（源不变 ⇒ 未被 /cleanup 删除）

# V-5.2 配置段逐条有去向、无静默丢失
grep -c 'was not imported into entry' "$ROOT/logs/web-$PORT.log"   # 预期 0
grep -nE 'source: /dsh-wallpaper/media/' "$PROF/web/cordis.patch.yml"   # 预期命中 1 处
grep -nE 'preference: light'          "$PROF/web/cordis.patch.yml"      # 预期命中 1 处

# V-5.3 taste 图标债已闭环
grep -c 'Outline16' "$PROF/node_modules/@deepseek-ai/dsh-taste/lib/client.js"   # 预期 0
grep -c 'OutlineRegular' "$PROF/node_modules/@deepseek-ai/dsh-taste/lib/client.js"  # 预期 5
node --check "$PROF/node_modules/@deepseek-ai/dsh-taste/lib/client.js" && echo "syntax OK"

# V-5.4 guard 工具链（在 T07 原文补读并落地后）
bash <guard>/run-all.sh 2>&1 | tail -10           # 预期 ALL GREEN，步数 ≥7（含 p7 与 a329）
# N-1 缺口回归：伪 HOME 下必须**非 0 退出**
HOME=/tmp/fakehome bash <guard>/run-p7-restore-drill.mjs; echo "exit=$?"
# 预期：exit != 0（修好后）；修好前它是 0 = **假 PASS**
```

### 4.6 全局终验（非批次，必须全过）

```bash
# 终-1 启动 + 三条验收判据（Runbook §7.2/§7.3/§7.4）
grep -c 'disabling profile plugin row' "$ROOT/logs/web-$PORT.log"   # 预期 0
grep -A3 'did not activate' "$ROOT/logs/web-$PORT.log"              # 预期仅 2 条（P-03/P-04 未完成时）
grep -o 'http://127.0.0.1:[0-9]*' "$ROOT/logs/web-$PORT.log" | head -1  # 预期 http://127.0.0.1:3098
TOKEN=$(grep -o 'token=[A-Za-z0-9_-]*' "$ROOT/logs/web-$PORT.log" | head -1 | cut -d= -f2)
unshare -rn bash -c 'ip link set lo up 2>/dev/null
  curl -s -o /dev/null -w "no-token: HTTP %{http_code}\n" "http://127.0.0.1:'"$PORT"'/"
  curl -s -o /dev/null -w "with-token: HTTP %{http_code}\n" "http://127.0.0.1:'"$PORT"'/?token='"$TOKEN"'"'
# 预期：no-token: HTTP 401 / with-token: HTTP 303

# 终-2 零外呼（S 级三叠加）
unshare -rn bash -c 'ip link set lo up; echo "routes: $(ip route | wc -l)"'   # 预期 routes: 0
# 且启动前 env 含 DSH_TELEMETRY_MODE=DISABLED，且**必须用 env -i 清空模型 key**
# （T22 实测：有 key + netns 隔离会走 TRANSPORT 重试最多 5 次 ⇒ 不能只靠 netns）

# 终-3 停栈干净
pkill -f "bin.js --profile web --port $PORT" ; sleep 3
node -e 'const net=require("net");const p=process.argv[1];const s=net.createServer();
s.once("error",e=>{console.log("port "+p+" => "+e.code);process.exit(0)});
s.listen(p,"127.0.0.1",()=>{console.log("port "+p+" => FREE (停栈干净)");s.close();});' "$PORT"
# 预期：port 3098 => FREE (停栈干净)

# 终-4 现役未污染（**必须与 §4.0 V-0.3 基线逐一相同**）
sha256sum ~/.dsh/profiles/web/cordis.patch.yml ~/.dsh/settings.yaml
ss -ltn | grep -E ':(3080|3097) '
# 预期：patch 与 settings 的 sha256 与基线一致；3080/3097 仍 LISTEN
# 注意：settings.yaml 是活值（现役自行改写），**不能单独用作未污染判据**；
#       须走带「易变路径排除表」的 manifest 校验（Runbook 附二.3）

# 终-5 会话面（**已按 N17 选项 (c) 重写，取代 Runbook §8.4**）
#   (c) 形态下**不做**「复制会话到隔离根」，因此 Runbook 的 V9（逐字节 diff 无输出）**已废止**。
#   (c) 形态下的判据改为三条：
#   (i) 新根 sessions/ 内不含历史语料（同 V-1.7(a)）
#   (ii) 现役 ~/.dsh/sessions 与 ~/.dsh/attachments 的**文件集合与大小分位未被 0.2.0 侧改动**
#        只读清点（不抄内容）：
find ~/.dsh/sessions -type f | wc -l        # 预期：≥ 基线（现役自身只增不减）
find ~/.dsh/attachments -type f | wc -l     # 预期：991（或现役自身增量）
#   (iii) **不得**以「旧会话可在 0.2.0 打开」作为验收项 —— 该能力在 (c) 下**由 3080 提供**。
# ⚠️ V10（能读）通过 ≠ V12（能继续）通过；且在 (c) 形态下 **V12 只在 0.1.1 侧有意义**，
#    **不得**在 0.2.0 侧宣告 V12。
```

---

## 5. 不派工清单（登记但等待用户裁决）

> 以下 **9 项**（**必列 4 项**：`5-1` N17 / `5-4` 办公入口 Route / `5-5` remoteHosts / `5-6` taste 语言基线；**本工单新增 5 项**：`5-2` btw 读面与导航 / `5-3` 405 悬置 / `5-7` btw 基线 / `5-8` pptmaster 岛 / `5-9` N2 方向）。
> **`5-1` 已由用户裁决（选项 c）**，其内容是**强制执行纪律**而非待裁决项；**其余 8 项一律不派工**。
> 每项写明：**需要什么裁决 + 裁决后影响哪些单元**。

### 5-1. **N17 会话面 —— ✅ 已由用户裁决为「选项 (c)：双实例并存、零数据改写」**（必列；2026-09-29 明示「选c」）

> **状态更新**：本面**不再是「等待裁决」**。以下 4 条为 **(c) 形态下执行档必须遵守的强制纪律**；本工单**不派**任何「会话迁移/离线正规化/chunk 映射器」单元。

| 项 | 内容 |
|---|---|
| **裁决** | **选项 (c)**：0.1.1 实例（3080）继续作为**历史会话的唯一读取入口**；0.2.0 只承载**新会话**。零数据改写。 |
| **为什么 (c) 是唯一 100% 保历史的路径（已双向实测坐实）** | 对**同一份真实文件**：**0.1.1** 侧 `decodeStorageRecord` **零错误展开 65 145 个打包行 → 1 364 372 个事件**（`reasoning-chunks 53 042` / `tool-call-chunks 7 593` / `text-chunks 4 510`），另 17 285 行为普通事件 ⇒ **完全可读**；**0.2.0** 侧裸 `JSON.parse`（无行解码）+ 未知类型拒绝 ⇒ 抽样 200 份仅 **3%** 通过、修 descriptor 后 **60%**。⇒ (c) 的价值不是「保守」，而是**唯一让历史 100% 可读**的路径。 |
| **强制纪律 1** | **现役 0.1.1 的 `~/.dsh/sessions` 与 `~/.dsh/attachments` 保持原地不动**（历史由它继续服务）。实测现役语料 **2 466 日志 / 21 工作区 / 991 附件（205 MB）**，且日志数在会话期间由 2 460 增至 2 466 ⇒ **现役仍在活跃写入**。 |
| **强制纪律 2** ★ | **0.2.0 新根不得承载历史语料**。协调者已把为 N17 验证而复制进新根的 2 460 份日志与 205 MB 附件副本**移出**至 `.workspace/audit-020/n17-evidence/`。理由：0.2.0 读不了它们（只有 3% 可读），留着只会造成「会话列表里有条目但打不开」的混乱，且会让新旧两套会话目录分叉。⇒ **本工单据此废止 Runbook §8.3「复制会话到隔离根」与该节的 `V9` 验收口径**；改为新闸门 `V-1.7`（见 §4.1）。 |
| **强制纪律 3** | **`DSH_HOME` 必须严格隔离**：0.2.0 用独立 `DSH_HOME`（工作区内），**不得指向 `~/.dsh`**。注意 `DSH_HOME="   "`（空白）会**静默回退**到真 `~/.dsh` ⇒ 启动闸门必须断言「**非空 + 绝对 + 落在隔离根内**」。 |
| **强制纪律 4** | **两实例的职责边界要写进用户可见文档**：历史会话 → 3080（0.1.1）；新会话 → 0.2.0 新端口。 |
| **并行动作（唯一可派项）** | **(b2) 向官方报 issue**：请求把 `reasoning-chunks` / `tool-call-chunks` / `text-chunks` 补进 `RELEASED_V0_EVENT_TYPES`（属**协议层遗漏**——这三个类型是 0.1.1 的**合法**功能且 0.2.0 依然支持，只是 v0→v1 的封闭事件清单没登记它们；官方修补成本低）。这是**唯一能让未来任意版本都读得懂历史**的路径（自研映射器属代偿）。**不属本工单代码单元**。 |
| **裁决后影响哪些单元** | ① **废止** Runbook §8.3 与 `V9`；② **新增** `V-1.7` 闸门（批次 1）；③ `V12`（老会话可继续）**在 (c) 形态下永久不适用于 0.2.0 侧**——老会话由 0.1.1 提供，`V12` 只在 0.1.1 侧有意义；④ **不再需要**任何 descriptor 正规化 / chunk 映射器单元；⑤ **双代际目录**（`dualgen.mjs`）与「高代是否低代超集」判定**仍须做**——但它现在只影响 **0.1.1 侧**的读取正确性（真实库已存在一例：v0 晚 5 天、内容约 10 倍），属**现役运维项**而非迁移项。 |
| **纪律** | **不得**在任何对外表述中把 (c) 说成「迁移后旧会话可用」；正确表述是「**历史由 0.1.1 继续服务，0.2.0 只承载新会话**」。 |

### 5-2. **btw 读面/导航面方案定案**（必列；源于 `T30 §5.1` 与 `MIGRATION-ASSESSMENT §N16`）

| 项 | 内容 |
|---|---|
| **需要什么裁决** | ① **`B-03`（T30-U07）读面选型**：`sessionQuery.readSession`（**推荐**）/ `'session/event'` 订阅 / 已废弃的 `snapshotEvents`/`ownEvents` 三选一。② **`B-09`（T30-U15）导航落点**：0.2.0 注释明说「navigation belongs to view owners」，但**未读** `dsh-client-ui-session`/`sidebar-right` 的导航实现 ⇒ 若找不到插件可用的切会话入口，**JumpList 只能降级为「只展示不跳转」**。 |
| **裁决后影响哪些单元** | `B-03`（本轮**唯一需要重新设计**的单元，工作量最大单点）、`B-09`、以及二者的下游 `B-04`、`B-14`。 |
| **为什么现在不做** | `MIGRATION-ASSESSMENT §N16` 明确要求「**建议拆 3 档执行，不建议单档**」并「**需先定案两处**」。本工单已把它排在批次 3 的**第一项闸门**。 |

### 5-3. **`/dsw` 与 `/ssh-gui` 类前缀通道的 405 悬置项**（必列；源于 `T17 §8.10`）

| 项 | 内容 |
|---|---|
| **需要什么裁决** | 需要一次**真机 boot 收敛实验**：在 0.2.0 隔离宿主里挂一个最小插件，`apply()` 内调用 `ctx.connection.rpc.handle('/probe', …)` 后断言 `GET/POST /probe/...` 的状态码；并在 0.1.7 隔离宿主上做同一实验作对照。 |
| **已确定 / 未确定** | **已确定**：第 3 参 `{authority:'loopback'}` 被**静默丢弃**，loopback 信任豁免**消失**（不报错不告警）。**已证伪**：「`inject` 收紧 ⇒ 必抛 `without inject`」（`cordis@4.0.4` 最小复现：`owner.webServer` **无论 inject 如何都解析成功**）。**悬置**：插件仓库记录 0.1.5-rc.2 上 `POST /dsw/connections.list → 405`（**运行时实测记录**），与上述预设矛盾。 |
| **裁决后影响哪些单元** | `W-10`（WE `/dsw` 修法）、`W-21`（ssh-gui `/ssh-gui` 改走精确 Fetch 路由）、`C-07`（connection 行 inject）。 |
| **纪律** | **在真机实验完成前，Runbook 不得把 `/dsw` 写成「确定可用」或「确定不可用」**；`T24-U10` 的「去掉第 3 参」修法**须以该实验为前置闸门**（`T17` 判它「既恢复不了 loopback 豁免、又预设了未验证的注册成功」）。 |

### 5-4. **办公入口 Route A/B 抉择**（必列；源于 `MIGRATION-ASSESSMENT §N11`）

| 项 | 内容 |
|---|---|
| **需要什么裁决** | 「零插件 Route A」在 0.1.7+ **结构性不再成立**。`T23` 给出 A/B/C/D 四个选项。其中「**读凭据存储自签 cookie**」会让接收器变成 cookie 伪造器、与其既有设计纪律冲突；**Route B（host 侧插件）是裁决重开**（`docs/architecture/office-handoff.md` §1 记载 Route B 曾被明确否决）。 |
| **三处独立破坏（已实测）** | ① `/api` 自 0.1.7 起变为**浏览器 cookie 鉴权门**（无 cookie 即 **401**，`Config` 无任何开关可关；接收器刻意只发 `content-type`⇒ 每次请求在进路由前就被拒）；② 端点命名**由点号改斜杠**，且 `workspace.list` 在 0.1.7/0.2.0 **已不存在**，未认领的 `/api/*` 一律 404；③ **锁标记陈旧**（详见 `O-03`）。 |
| **好消息** | 失效是 **fail-safe** 的：`probe()` 先跑，失败即「只入 spool + 桌面通知 + 退出码 9，零复制零登记」，**无中间态、无数据损坏**。 |
| **裁决后影响哪些单元** | `O-03`（锁标记重录，**只在选定 Route 后才有意义**）；若放弃接收器则 `O-03` 整块不派。另注：`journal.secret` **保留 journal 则必须与 `journal/` 一起迁移**（同目录、`0600`、长度须恰 **32 字节**、属主 == euid、父目录 `0700`；**不可重建**，重建会让既有记录 seal 全部失效）；但**版本升级本身不需要迁数据**（状态根由 `$DSH_HOME` 决定，与 DSH 版本无耦合）。 |

### 5-5. **`remoteHosts` 回归是否找回**（必列；源于 `MIGRATION-ASSESSMENT §T17-1` 与 `T17 §10.1`）

| 项 | 内容 |
|---|---|
| **需要什么裁决** | 是否要为 `@local/dsh-ssh-gui` 的侧栏「分布式节点」树找回入口 —— 即 `W-22` 是**必须做**还是**接受 UI 消失**。 |
| **实测事实（三方收敛）** | 该槽位在 **0.1.1-rc.2 存在**（`dsh-client-ui-workspace` 的 `slots.d.ts` + `client.js`），在 **0.1.5 线被删除**，0.1.7/0.2.0 全树 **0 命中**。本档实测：迁移后的部署件 `@local/dsh-ssh-gui/lib/client.js` **仍有 5 处**注册 ⇒ 迁移后该树会**静默消失**（`ctx.slots.inject` 对未声明 key **不报错不告警**）。 |
| **被否一方** | `T16` 判「该槽在 0.1.1 也从未声明 ⇒ 既有失效（静默）、迁移无损失」—— **实测不成立**（`MIGRATION-ASSESSMENT §T17-1` 与 `T17 §10.1` 均以其为准）。 |
| **裁决后影响哪些单元** | `W-22`。若找回：候选落点为 `sidebar.panellist`（0.2.0 新增）或 `sidebar.workspaces.session.row.action` / `sidebar.session.row.leading` / `sidebar.session.row.hover`，或退化为 `settings.section` 内完整入口。 |
| **知情告知（必须在切换前明确告知）** | 「迁移后侧栏『分布式节点』树会消失，无任何报错」——**不能按『历史死项』一笔带过**。 |

### 5-6. ★**taste 语言基线确认**（必列；源于 `MIGRATION-ASSESSMENT §N12`）

| 项 | 内容 |
|---|---|
| **需要什么裁决** | 确认「taste 语言基线 = **中文单轨**」这一事实性更正。 |
| **实测事实** | 现网 `~/.dsh/taste/taste.md` 与 `~/.dsh-017/taste/taste.md` **已是中文单轨**（**17002 B / 61 行 / 4482 CJK** 与 **16163 B / 58 行 / 4241 CJK**）；英文展示层 sidecar `display.zh.json` **已退役为空对象 `{}`**（3 字节），且**运行时无任何代码读取它**。taste **从未有**「把英文条目译成中文显示」的运行时逻辑 —— locale 词典（49 键 zh/en）**只翻 UI 骨架文案**，条目正文与真实分类名**逐字原样直显**。 |
| **裁决后影响哪些单元** | 不影响本工单任何单元（迁移只需 `cp` 两棵数据文件）；但**若按「保持英文」规划，会把现有 48 条中文条目误判为数据污染并触发错误回译**。⇒ **裁决结论必须写进执行档的迁移前置声明**。 |

**★本工单新增不派工项（3 条，非必列但必须登记）**：

| 项 | 需要什么裁决 | 裁决后影响 |
|---|---|---|
| **5-7. btw 迁移基线路线**（我实测发现，见 §1.3-B） | 采纳本工单裁决（**基线 = 已迁移部署件 `606f53f13f61`**）还是改走工作区源码路线？ | 决定 `B-08`/`B-02`/`B-10` 三个 `[条件]` 单元**是否派工**；也决定是否需要一个「部署件改造回灌工作区源码」的新单元 |
| **5-8. `@local/dsh-pptmaster` 私有依赖岛去留**（`O-02`；N10 方案 B 的延伸） | N10 方案 B 的裁定文字聚焦 WE，但 `MIGRATION-ASSESSMENT §N10-N3` 的实测表**明列了 pptmaster 的 23 项岛**。是否把方案 B 一并延伸到 pptmaster？ | 决定 `O-02` 是否派工；与 `T15-K5`（「提升/去嵌套必须与图标改名同批」）耦合 |
| **5-9. N2 的处置方向**（`P-07`；冲突 10） | 选 **方案 A**（重打 0.2.0 宿主补丁 + 重写插件两端 + settings 数据迁移 ⇒ 恢复「settings 面可调 + 改完对后续派发热生效」）还是 **方案 B**（零宿主补丁，只由 preset 静态 `agentOptions` 钉死 ⇒ 接受「改模型 = 重开会话 / 需编 preset」）？ | 决定 `P-01`/`P-02` 是否派工（方案 B 下 `@local/dsh-subagent-model` **整插件退役**，`C-04` 的对应 insert 行删除）；`C-10` 的 `agentOptions` 两种方案下都必须做。**执行档不得自行拍板。** |

---

## 6. 未验证项（证据缺口台账，**不得臆测填充**）

> 以下均为**本档在汇编过程中亲自发现的证据缺口**，逐条给出「缺什么 / 为什么缺 / 补法」。

| # | 缺口 | 为什么缺 | 补法（可执行） | 阻断哪些单元 |
|---|---|---|---|---|
| **UV-01** | `MIGRATION-ASSESSMENT §N10` 方案 B 的**适用范围是否含 `@local/dsh-pptmaster`** | 裁定文字聚焦 WE；`§N10-N3` 的实测表并列了 pptmaster（23 项岛），但**未对该包下结论** | 读 `@local/dsh-pptmaster/package.json` 的 `dependencies`/`peerDependencies` 与 `lib/index.js` 的 `@deepseek-ai/*` 解析目标；对照 WE 的方案 B 形状 | `O-02` |
| **UV-02** | 工作区 `dsh-btw/` 与已迁移部署件 `606f53f13f61` 的**双向差集**（我实测二者 `lib/client.js` 与 `lib/index.js` 均不同） | `T30 §1` 的对账基准是 **0.1.1 现役部署根**，**不是**已迁移组合件；`T30 §7 U-8` 自认「`~/.dsh-017` 的 btw 哈希未对账」 | `diff -rq` 两侧 + `git log` 溯源；命令见 §4.3 `V-3.1` | `B-15`、`B-02`、`B-08`、`B-10` |
| **UV-03** | `assembly-020` 的 13 个插件**具体来自哪棵源树/哪次构建** | 工单汇编时无构建日志；`MIGRATION-ASSESSMENT` 只说「上一轮迁移确实重建过客户端 bundle」 | 比对 `assembly-020` 与 `~/.dsh-017/profiles/node_modules`（只读）的逐文件 hash；`T04 §6 U-9/U-10` 的悬置问题（3097 是否真加载了那 6 个插件）在此一并收敛 | `C-13` 的来源根选择 |
| **UV-04** | `T07`（guard 工具链）**原文未读** | 本工单的必读输入清单**不含 T07**；`G-01..G-06` 全部转引自 `MIGRATION-ASSESSMENT §N13` | 读 `.workspace/audit-020/reports/T07-guard-toolchain-forward-compat.md`（513 行）后复核 `G-01..G-06` 的 6 条归纳 | `G-01..G-06`（**标 `[未核]`**） |
| **UV-05** | `T31`（文档影响面）**原文未读**，其「30 个交付单元 / 209 处断言 / 17 份文档」仅见于 `RUNBOOK §14-4` | 不在必读清单内 | 读 `.workspace/audit-020/reports/T31-docs-impact-inventory.md`（406 行） | `D-01`（**标 `[未核]`**） |
| **UV-06** | `T24 §8` 的 **N1–N9 运行期未判定项**（浏览器侧注入后果、`ctx.set` 顶替官方 provider 的边界、侧栏 DOM 适配度、`slots.register` 新增必填字段、`IWorkspaces` 完整成员、`JobOutputSource` 契约） | `T24` 硬约束禁止起服务/浏览器 | 隔离实例实跑 + 浏览器 console 断言 | `W-08/W-09/W-14`（依赖 `W-16` 的 `ctx.set` 路径）、`W-13`、`W-14`、`W-15` |
| **UV-07** | `T30` 的 **9 条未验证项**（`U-1` vision-adam 可加载性、`U-2` 槽位运行期校验、`U-3` `dsh-better-sidebar` 可加载性、`U-4` HMR 重建延迟、`U-5` primitives 导出面完整性、`U-6` `ISessions` 新导航入口、`U-7` `validateVolatilePlacement`、`U-8` 0.1.7 btw hash、`U-9` A 档全档 tsc 基线） | 未起 0.2.0 组合、未跑全档 tsc | 起隔离组合 + 三档 `--noEmit` 取基线（§4.3 `V-3.3`） | `B-09`、`B-13`、`B-14`、`P-08` |
| **UV-08** | `T28` 的 **8 条未验证项**（含 `U1` 会话页替代信号源 (a)/(b) 选型、`/cleanup` 实际删除范围、官方稳定 0.2.0 的 deny 行为） | 未起浏览器/服务 | 隔离实例浏览器实测三态 | `WP-02`、`WP-04` |
| **UV-09** | `T26` 的 **8 条未验证项**（含 U1 验收项 ④ 浏览器实测、`taste.md` 读写闭环、learner 真实链路） | 未起浏览器、零模型请求 | 隔离实例浏览器实测 | `T-01`（④）、`T-04` |
| **UV-10** | `T05` 的 **13 条未验证项** + `T21` 的 **12 条未验证项** | 零模型请求 + 不得起服务 + 只读纪律 | **已由用户裁决 (c) 收敛**：这些未验证项大多服务于「(b) 离线正规化」路径，(c) 下**不再需要**；剩余部分见 §5-1 与 `MIGRATION-ASSESSMENT §N17` | **§5-1**（已裁决，转为强制纪律） |
| **UV-11** ★ | `T04 §9.4b` 的**两个上报推论**未被 `MIGRATION-ASSESSMENT` 直接裁定：①「爆炸半径是 **7/9** 而不是 4/9」；②「3097 隔离实例的 `@local` 副本与 3080 现役**逐字节相同**（除 web-search-sse）⇒ 这 6 个插件在 3097 上**同样无法加载**」⇒ 协调者应据此复核「**3097 已端到端可用**」这一前提 | `T04` 不得启动服务，无法观测运行时加载结果 | 查 3097 的启动日志与插件 fiber 状态（`~/.dsh-017/logs/**`）；**须由有权启动服务的轨道执行** | `C-13`、`W-23`、整个批次 2 的工作量估计 |
| **UV-12** ★ | 本档 **0.2.0 源码行号全部转引**（未重新打开 0.2.0 安装树逐行复核）；标 `[源码实读]` 者指「出处报告的作者实读了源码」 | 汇编档定位为「只读汇总 + 写一份新文档」，未重跑源码核验 | 执行档在动手前对每个 `[源码实读]` 条目**至少抽验 1 条行号**（`sed -n '<line>p' <0.2.0 树>/<pkg>/<file>`） | 全部标 `[源码实读]` 的单元（抽验纪律） |

---

## 附录 A — 本档亲自实读的出处索引

| 出处 | 读取范围 |
|---|---|
| `.workspace/audit-020/reports/MIGRATION-ASSESSMENT.md` | 全文 726 行 |
| `.workspace/audit-020/reports/PLUGIN-MATRIX.md` | 全文 56 行 |
| `.workspace/audit-020/RUNBOOK-020.md` | 全文 643 行（§0–§14 + 附一/附二） |
| `.workspace/audit-020/reports/T30-btw-compat-020.md` | 全文 353 行 |
| `.workspace/audit-020/reports/T24-workspace-enhancement-units.md` | 全文 670 行 |
| `.workspace/audit-020/reports/T17-ssh-remote-workspace-020.md` | 行 1–70、300–620 |
| `.workspace/audit-020/reports/T26-taste-compat-020.md` | 行 400–734 |
| `.workspace/audit-020/reports/T28-wallpaper-theme-compat.md` | 行 285–469 |
| `.workspace/audit-020/reports/T28-ADDENDUM-theme-evidence-correction.md` | 行 1–70 |
| `.workspace/audit-020/reports/T04-plugin-api-compat.md` | 行 20–164、525–674、744–843 |
| `.workspace/audit-020/reports/T15-office-feature-020.md` | 行 170–357 |
| `.workspace/audit-020/reports/T13-subagent-model-routing-compat.md` | 行 206–365 |
| `.workspace/audit-020/reports/T06-proposed-cordis.patch.020.yml` | 行 1–200、419–585 |
| `.workspace/audit-020/reports/T05-session-format-delta.md` | 行 283–438 |
| `.workspace/audit-020/reports/T21-session-data-migration.md` | 行 22–116、556–603 |

**本档亲自实测（只读）的路径**：
`dsh-btw/{src,lib,package.json,tsdown.config.ts}`、
`.workspace/audit-020/assembly-020/home/profiles/{node_modules/**, web/cordis.patch.yml, web/compatibility.json}`。

**明确未读（标 `[未核]`）**：`T07-guard-toolchain-forward-compat.md`、`T31-docs-impact-inventory.md`、以及 `T*.md` 中本附录未列出的段落。

## 附录 B — 去重映射表（去重前单元 → 去重后单元）

| 去重前 | 去重后 | 处置 |
|---|---|---|
| `T06` 16 条生效条目 | `C-01`…`C-14` | 拆并；`A` 段 → `C-04`；`agent-preset-registry` → `C-05`；定向覆盖 → `C-06`；`connection` → `C-07`；`directory-picker` → `C-08`；`llm-pi-ai` → `C-09`；`preset-standard-glm` → `C-10`；`§D` 退役 → `C-11`；`§C` 条件 → `C-12`；`§C2` 日程 → `C-14` |
| `T30-U01` | `B-01` | 原样 |
| `T30-U02 + U03 + U13 + U14` | `B-08` | **合并**（同属「`dsh-client-runtime` 消失」面），并**降级 `[条件]`**（部署件 0 残留） |
| `T30-U04` | `P-08` | **跨档并入批次 2**（依赖 `P-04`） |
| `T30-U05 + U06` | `B-02` | **合并** + **`[条件]`** |
| `T30-U07` | `B-03` | 原样（最大单点） |
| `T30-U08 + U09` | `B-04` | **合并**（`childSessionMeta` 与 `inheritedEventCount` 同一改动点） |
| `T30-U10` | `B-05` | 原样 |
| `T30-U11` | `B-06` | 原样（推荐 (a) 删除） |
| `T30-U12 + U19` | `B-07` | **合并**（图片能力检测与拒绝文案） |
| `T30-U15` | `B-09` | 原样（未判定） |
| `T30-U16` | `B-10` | 原样 + **`[条件]`** |
| `T30-U17 / U18 / U20 / U21` | `B-11 / B-12 / B-13 / B-14` | 原样 |
| `T30 §1.4` 基线结论 | `B-15` | **降级为登记型**（本工单 §1.3-B 裁决否其结论） |
| `T24-U01`…`U19` | `W-01`…`W-19` | 原样保留编号 |
| `T17-U-1` | — | **撤销**（并入 `W-23`，部署件已修） |
| `T17-U-2` | — | **撤销**（并入 `W-23`，部署件已修） |
| `T17-U-3` | `W-21` | 独立（部署件实测仍未做） |
| `T17-U-4` | `W-22` | 独立（部署件实测仍未做） |
| `T17-U-5` | **并入 `W-12`** | 与 `T24-U12` 同单元（`T17 §10.3` 自认一致） |
| `T17-U-6 + U-7 + U-8` | `W-20` | **合并为基线升版闸门** |
| `T26-U1` | `T-01` | **已闭环**（协调者已修，本档实测 5/0） |
| `T26-U1b` | `T-02` | 原样（U1 附属必改项） |
| `T26-U3 + U4` | `T-03` | **合并**（同为 `package.json` 声明面） |
| `T26-U2 / U5 / U6` | `T-04 / T-05 / T-06` | 原样 |
| `T28-MU1`…`MU5` | `WP-01`…`WP-05` | 原样 |
| `T04-A1` | **并入 `P-05`** | 与 `§9.6` 的 entry id 对齐合并 |
| `T04-A2` | **并入 `P-01`/`P-03`/`P-04`** | 6 插件范式按插件拆分 |
| `T04-A3`（6 处键漂移） | `P-06` | **合并为 1 条** |
| `T04-A4`（图标债） | btw 部分 → `B-08`（撤销/条件）；pptmaster 部分 → `O-02`；taste 部分 → `T-01` | **按插件三分** |
| `T04-A5`（客户端债） | **并入 `B-08` / `W-15`** | 按插件分 |
| `T04-A6`（槽位重定位） | `W-22`（ssh-gui）+ `W-14`（usage 类） | 按插件分 |
| `T04-A7`（复核 3097 加载） | **`UV-03` / `UV-11`** | **降级为未验证项** |
| `T13-A1`…`A5` | **并入 `P-01`** | 逐条 |
| `T13-A6` | `P-07`（方案 A） | — |
| `T13-A7/A8/A9` | **并入 `P-02`** | — |
| `T13-A10/A11` | 无需改（成立项） | — |
| `T13-P1 + P5` | `C-11` | — |
| `T13-P2` | `C-05` | — |
| `T13-P3 / P4` | **并入 `C-10`** | — |
| `T13-P6 / P7 / P8 / P9` | **并入 `C-10`** | — |
| `T15 §5.3-1`（图标改名） | **撤销** | **被否**：部署件实测 `pptmaster/lib/client.js` = `d21906483454`，`Outline16` = **0** |
| `T15 §5.3-2` | `O-01` | — |
| `T15 §5.3-3 / 5.3-4` | **登记为「不变」** | 无动作 |
| `T15 §5.3-5`（`agent-presets` 旧 id） | **并入 `C-05`** | — |
| `T15 §5.1-K5` | `O-02` | — |
| `T15 §5.1-K1..K4 / C1–C5 / R1–R2` | `O-04` | **合并为裁剪/退役登记** |
| `MIGRATION §N13` 的 9/13/6 条 | `G-01`…`G-06` | **归纳为 6 组**，标 `[未核]` |
| `RUNBOOK §14-4`（T31 的 30 单元） | `D-01` | **登记，标 `[未核]`** |

---

**工单结束。** 未过 §1.1 闸门或 §1.3 三条新增裁决者，不得开工。
**本工单不含任何切换现役的动作；切换必须由用户单独确认。**
