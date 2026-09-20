# doc-restructure-exec — dsh-hub 文档重构（修订执行复核一体档报告）

- 档位：修订执行复核一体（路由 adam/deepseek-v4-flash）
- 日期：2026-09-16
- 任务：按 Luxweft-doc 文档架构与语言风格重构 dsh-hub 文档——重构 README + 新建功能地图页 + 文档风格约定固化（用户裁决），同档自复核
- 范本：`.workspace/research-luxweft-doc/zh-cn/README.md`（导航中枢/从这里开始路由表/Tier 分层/两条规则/诚实边界/状态词汇）+ `01-overview.md`（归属表开头/普适规则/面包屑）
- 约束遵守：只写仓库根下 `README.md`、`FEATURE-MAP.md`、`DOC-STYLE.md` 与本报告；未改 `~/.dsh`、未改全局树；未使用 sandbox_permissions
- 自裁决：**通过**（死链 0、状态与落盘报告一致、Runbook 链接全部有效、DOC-STYLE 可执行；问题清单均为非阻断观察项）

---

## 0. 结论式摘要

三个产物 + 一份报告，全部落盘：

| 产物 | 路径 | 说明 |
|---|---|---|
| 重构后的导航中枢 | `README.md` | 保留个人定制化警示 + 仓库内容表；新增状态词汇/诚实边界、从这里开始路由表、两条规则、文档分层（Tier）、Runbook 索引（瘦身） |
| 功能地图 | `FEATURE-MAP.md`（新建） | 插件/补丁/热载三类 22 项能力的状态表，每项带状态（日期）+ 入口 + 一句话说明；未开放/条件性项如实列出 |
| 文档风格约定 | `DOC-STYLE.md`（新建） | Luxweft 风格清单 9 节，末尾明示「未来所有 dsh-hub 文档按此约定写」 |
| 本报告 | `.workspace/doc-restructure-exec.md` | 见下 |

## 1. 三产物关键结构

### 1.1 README.md（重构）

- **保留**：⚠️ 高度个人定制化警示（原文）、仓库内容表（补齐 `pi-taste-analysis/`，注明 `cc-switch-src/` 已 gitignore 移除不入库）、运行时依赖、方法论。
- **新增① 从这里开始路由表**（你的情况 | 路径，9 行）：首次接触 / 部署重启+验收 / 补丁重放 / 改代码生效（冷热判断）/ 改 settings 立即生效 / 查热载 / 写插件 / 回滚 / 查证据。
- **新增② 两条规则**（按事实提炼并注明来源）：
  1. **补丁归脚本，进程归 dsh-restart**（来源：`.workspace/deploy-lag/README.md` §0 分工表——补丁脚本管代码层、dsh-restart 管进程层，正交）；
  2. **配置与 UI 已热载，宿主代码改动需重启**（来源：p0a-patch-hmr-exec / p0b-settings-switch-exec 实测 + usage-tooltip-exec §5 生效方式）。
- **新增③ 状态词汇 + 诚实边界**（PREVIEW 式横幅）：五种状态标记带含义；诚实边界 = 不含通用发行版/官方包源码/密钥，条件性能力如实标状态。
- **④ Runbook 节瘦身**：删除原 README 内嵌的「部署与验证 Runbook」0–4 大节（原第 48–84 行），改为 14 行索引表（master-runbook + 各 deploy-*/RUNBOOK/APPLY/REPLAY + 重放脚本 + dsh-restart），全量以这些文件为准。
- **文档分层（Tier 0–3）**：导航表带「回答什么」列（Luxweft 模式）。

### 1.2 FEATURE-MAP.md（新建，README 链入）

- 面包屑 `> **Tier 2 · 能力** · [指南地图](README.md)` + 状态词汇表（可复判）+ 数据时点 2026-09-16。
- **一、插件（10 项）**：dsh-btw v2、dsh-usage tooltip、行为开关（9 键）、vision-adam 网关/提示词、识图设置页、图像能力检测（**条件**）、dsh-pptmaster、dsh-workerspace（**未真机**）、分布式控制 ssh-gui（**未真机**）、taste/wallpaper/session-board（简单状态）。
- **二、补丁（7 项含未采纳节）**：lag-fix 5 补丁+settings、0.1.5 借码批次（lean12 + 组A6 + 组B4 + 组C8）、goal 修复（P0-A + 方案 A）、槽位 B、btw P0 materialize、**未采纳/勿借节**（P0-B startsRequestSeries、流式/传输层整族、CallId→ToolCallId、S15/S16 workspace UI 顺延）。
- **三、热载能力（5 项）**：patch 条目级热载（实测）、settings 值级热载（实测）、client bundle 热载（机制）、dsh-restart（实测，真实重启待用户）、**纯函数热载 B 通道 = 尚不可用（闸门通过·未投产）**。
- **诚实边界节**：真机串口/烧录未实测、分布式真机面未实测、vision 直传条件性、B 通道未投产、S15/S16 顺延、P0-B 勿借、个人定制不通用。

### 1.3 DOC-STYLE.md（新建）

Luxweft 风格清单 9 节：语言与受众 / 归属表开头（谁拥有什么，可复判）/ 普适规则可复判 / 导航表带「回答什么」列 / 状态词汇（五态统一，带日期，未真机须注明哪部分）/ 诚实边界 / 面包屑 + Tier 标注 / 表格扫读优先 / 来源与方法论（写作纪律：事实来自落盘报告不臆造、歧义上报）。末尾显式声明：**未来所有 dsh-hub 文档按此约定写**。

## 2. 状态表摘要（功能地图三类 × 状态）

| 状态 | 插件 | 补丁 | 热载 |
|---|---|---|---|
| 已实现·实测 | dsh-btw v2、dsh-usage+tooltip、行为开关、vision-adam 网关/提示词、识图设置页、pptmaster、taste/wallpaper/session-board | lag-fix 5 补丁、0.1.5 借码批次（终审 32 包全绿）、goal 修复、槽位 B、btw P0 materialize | patch 条目级、settings 值级、client bundle、dsh-restart（脚本级） |
| 已实现·未真机 | dsh-workerspace（串口/烧录）、分布式控制 ssh-gui（SSH/串口/serial-tcp） | — | — |
| 尚不可用 | 图像能力检测（**条件**：需声明 input，当前部署未生效） | — | 纯函数热载 B 通道（闸门通过·未投产） |
| 延期/勿借 | — | P0-B startsRequestSeries、流式/传输层整族、S15/S16 workspace UI、CallId 重命名 | — |

## 3. 自复核（同档）

| 复核项 | 结论 | 证据 |
|---|---|---|
| README 导航无死链（页名与实际文件一致） | ✅ | 脚本全量提取三文件 markdown 链接并逐个 `os.path.exists` 校验：README 24 链接、FEATURE-MAP 45 链接、DOC-STYLE 2 链接，**0 缺失**（DOC-STYLE 中的表格示例占位已改为纯文字，避免被解析为链接） |
| 功能地图状态与落盘报告事实一致（不臆造） | ✅ | 逐项对照来源报告：81/81（distributed-control-exec §1/§5）、42 单测（workerspace-exec）、48/48（slot-b-exec）、225 .js / 32 包（final-audit-a-patches）、六项启动修复（master-runbook §1）、S15/S16 为 P2 行与 P0-B 属 B10 勿借（upstream-015-diff §4 / goal-p0a-exec §1.3）、vision 直传条件性（vision-settings-capability-exec §3-3）等；条件性项全部如实标注 |
| Runbook 链接有效 | ✅ | 14 条 Runbook 索引全部指向存在的文件（master-runbook.md / lag-fix-runbook.md / btw-v2-runbook.md / combined-restore-runbook.md / deploy-ssh-gui/RUNBOOK.md / deploy-workerspace/RUNBOOK.md / deploy-pptmaster/04-Runbook.md / deploy-vision-settings/README.md / deploy-vision-prompt/APPLY.md / patch-official-015.sh / deploy-slots/REPLAY.md / deploy-p0/APPLY-P0.md / dsh-restart.sh / deploy-lag/README.md §9） |
| DOC-STYLE 可执行 | ✅ | 状态词汇与 README/FEATURE-MAP 完全一致（可复判）；「已实现·未真机」强制注明哪部分未测；每条规则附来源；归属表/导航表「回答什么」列有示例；Tier 划分与 README 文档分层一致 |
| 约束遵守 | ✅ | 仅写三产物 + 本报告；未触碰 `~/.dsh` 与全局树；未使用 sandbox_permissions；未做设计决策 |

## 4. 问题清单（非阻断，如实上报）

| # | 类型 | 内容 | 影响/处置 |
|---|---|---|---|
| 1 | 事实修正 | `port-taste.md` / `port-wallpaper.md` / `port-vision-adam.md` 位于**仓库根**（不在 `.workspace/`）——初稿曾按 `.workspace/` 引用，已改为仓库根相对路径（死链检查确认 0 缺失） | 已修正；根级旧报告为历史产物，未移动（超范围） |
| 2 | 观察项 | 根目录仍散落大量历史审计/执行报告（audit-btw.md、execute-*.md、review-*.md 等，未在仓库内容表列出）——它们是旧三阶段时期产物，未纳入新文档分层 | 主代理可裁决是否归档进 `.workspace/` 或加备注；本档未动（超范围） |
| 3 | 观察项 | `cc-switch-src/` 目录已不存在（gitignore 且已移除，见 git log 80ef4ec6），仓库内容表按实态注明「已 gitignore 移除，不入库」 | 与现状一致，无动作 |
| 4 | 记录决策 | vision-adam maxTokens 历史值存在 2000（lag-fix U-8 默认）与 393216（btw-v2-runbook 部署现值，opencode 网关硬上限）两处记录；功能地图设置页行只写「字段级读写、默认 2000」，README 方法论保留「网关实测 max_tokens 上限 393216」，避开冲突表述 | 如需精确现值以 `~/.dsh/settings.yaml` 为准 |
| 5 | 记录决策 | 两条规则为按事实提炼（deploy-lag/README.md §0 分工 + P0-a/P0-b 实测），并非 Luxweft 原文照搬；README 中已注明来源可复判 | 符合任务「你按事实提炼，注明」 |

## 5. 部署/收尾提示（主代理）

- 三文件已就绪，可 git add + commit（建议一条 `docs: README 重构（Luxweft 风格）+ 功能地图 + DOC-STYLE 约定`）。
- 后续新写 dsh-hub 文档一律按 `DOC-STYLE.md`；功能地图状态随部署演进更新（新增能力时在对应类别加行，状态带日期）。
- 若主代理/用户后续推进「examples/minimal-plugin 脚手架 + 写第一个插件」文档线，可在 README 从这里开始表加一行路由、在 DOC-STYLE 保持不动。

---

## 6. 追加四要素（第二轮，2026-09-16 用户指示）

| # | 要素 | 落实 | 位置 |
|---|---|---|---|
| ① | **fail-closed 普适规则** | 从落盘报告取 4 组事实并表述为 README 规则 3「应用失败即失败，绝不静默部分生效（fail-closed）」：补丁脚本校验失败 FAIL 退出非零不静默（lag-fix-exec.md U-9）+ `--rollback`；cordis 热载刷新失败整次回滚无残留（p0a-patch-hmr-exec.md §0/§1）；ws_flash 高危确认模态 fail-closed 未授权模板拒绝（workerspace-exec.md §1-2 四道闸）；能力检测未知声明保守回退 vision-adam（vision-settings-capability-exec.md §2）。规则节更名「三条能解释大部分行为的规则」 | README.md 规则 3；DOC-STYLE.md §3（fail-closed 为必写规则，附四组事实来源） |
| ② | **demo 代码块规范** | DOC-STYLE 新增 §4「代码块规范」：完整可复制 / 与真实命令逐字一致 / 带预期输出注释（`# 预期输出：…`）/ 可运行验证（`--dry-run` 零副作用先行）；README Runbook 索引下新增「补丁重放」示例代码块（命令与真实脚本逐字一致，已核对脚本名与预期输出行） | DOC-STYLE.md §4；README.md Runbook 索引示例块 |
| ③ | **实现参考（可执行规范）** | 仿 Luxweft「参考 Pack = 最接近可执行的规范」：README 新增「实现参考」节——`.workspace/` 各 exec 报告与 `deploy-*/patches/*.patch` 即可执行规范，patch 可直接 `patch -p1` 于包目录应用（应用后与 deploy-*/ 副本逐字节一致）；重放脚本是其可执行封装。DOC-STYLE §10 同步约定「实现参考即可执行规范」 | README.md「实现参考」节；DOC-STYLE.md §10；文档分层 Tier 3 补 patches 行 |
| ④ | **脚手架 examples/minimal-plugin/** | 新建 `examples/minimal-plugin/`（4 文件）：package.json（@local/dsh-minimal-plugin，peer 仅 cordis/dsh-tools/dsh-settings/schemastery）、lib/index.js（最小 host 插件：name/inject/apply + 1 个示例工具 minimal_hello + 可选 settings 段 + ctx.effect 清理）、lib/client.js（最小客户端骨架，头部注明**可选**——host-only 不需要；启用需 dsh.client 字段且 client 模块 id==包名）、README（拷贝 + cordis insert（bare 包名）+ 热载/重启二选一 + 验证 + 回滚 + 写插件纪律：id==包名、工具名前缀、高危走 approval fail-closed）。README「从这里开始」加「写第一个插件」路由（链接脚手架） | `examples/minimal-plugin/`（新建）；README.md 从这里开始路由表 + 仓库内容表 + 文档分层 Tier 1 |

**自复核（追加部分）**：全量死链复查 0 缺失（含新增脚手架 README）；`node --check` lib/index.js、lib/client.js 通过，package.json JSON 合法；命令块与真实脚本名逐字核对（replay-lag-fix.sh / patch-official-015.sh / patch-official-slots.sh --apply / dsh-restart.sh --yes）；fail-closed 四组事实全部来自落盘报告原文 grep 核实；脚手架以 @local/dsh-workerspace 薄插件为最小范本（package.json peer 面、exports、installSettingsSection/defineTool 形状、cordis insert YAML 形式均对照其部署包）。范围与约束不变：仍只写仓库根下文档/脚手架与本报告，未碰 `~/.dsh`/全局树，未用 sandbox_permissions。**自裁决：通过。**
