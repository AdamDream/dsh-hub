# plugin-restore 执行 + 复核报告（恢复包自验）

> 任务：插件恢复（紧急路径，用户裁决：不走审计、不走独立复核，执行+复核一体）。
> 目标实例：当前运行 web profile 0.1.1-rc.2（:3080，boot 43 个插件条目，含 `@local/dsh-btw`）。
> 约束：只读 `~/.dsh`、只写 `/home/CNS2026495165/dsh/.workspace/`、web2 零改动、禁止 sandbox_permissions（全程未用）。
> 产出：`.workspace/plugin-restore/` 恢复包 + 本报告。日期：2026-09-12。

---

## 0. 结论（verdict）

**PASS（恢复包自验通过，可交主代理部署）。**

- 恢复动作全部基于真实盘面证据（每插件证据见 §1，均含 file:line）。
- 自验覆盖：yaml 解析、与备份基线结构 diff、逐插件恢复条目核对、应用脚本（dry-run/apply/幂等/verify/包解析/web2 守卫）实测。
- 无越界：本次会话对 `~/.dsh` 仅读；写操作全部落在工作区；web2 零改动（脚本硬性拒绝）；未使用 sandbox_permissions。
- 问题清单（均不阻断恢复，见 §6）：usage 归属待主代理裁决；better-sidebar 无盘面证据（未确认）；52 个陈旧断链符号链接属既有遗留，本次不动。

---

## 1. 逐插件：禁用原因 + 恢复动作 + 证据

### 1.1 taste —— 恢复（删除 disabled 条目）
- **禁用原因**：`~/.dsh/profiles/web/cordis.patch.yml` L39-41：
  `# dsh-fix: disabled entry "taste" at 2026-09-12T06:44:42.256Z` / `- id: "taste"` / `  disabled: true`。
  9/12 14:44 写入（0.1.5 尝试期 dsh-fix 操作，lag-audit-diff.md §0/§4 判定为尝试期残留；9/11 升级前备份基线中无此条目）。
- **恢复动作**：删除该 disabled 条目；insert（L14-16 `id: taste` / `name: '@deepseek-ai/dsh-taste'`）保留。
- **证据**：包在场且可解析——`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-taste/`（真实目录，lib 12 文件，v0.1.0）；node resolve OK；boot 图（`.workspace/.tmp-boot3080-plugin-restore.html`）taste 0 命中。

### 1.2 wallpaper —— 恢复（删除 disabled 条目）
- **禁用原因**：`cordis.patch.yml` L27-29：`disabled entry "wallpaper" at 2026-09-12T06:31:35.260Z`（0.1.5 尝试期残留）。
- **恢复动作**：删除该 disabled 条目；insert（L23-25 `@local/dsh-wallpaper`）保留。
- **证据**：包在场且可解析——`~/.dsh/profiles/node_modules/@local/dsh-wallpaper/`（真实目录，lib 3 文件，v0.5.0）；settings 键在场——`settings.yaml` L143-146 `wallpaper.global`，其 source `/dsh-wallpaper/media/37758c1c-….png` 映射 `MEDIA_ROOT=~/.dsh/wallpapers`（插件 lib/index.js L19-20），目标文件 `~/.dsh/wallpapers/37758c1c-9ca8-47d2-bade-3048ab825fb6.png`（2.3MB，9/12 11:47）**实测存在**；boot 0 命中。

### 1.3 vision-adam —— 恢复启用（删除 disabled 条目）
- **禁用原因**：`cordis.patch.yml` L31-33：`disabled entry "vision-adam" at 2026-09-12T06:32:30.396Z`（0.1.5 尝试期残留）。
- **恢复动作**：删除该 disabled 条目；insert（L4-6 `@deepseek-ai/dsh-vision-adam`）保留 → **恢复启用**。
- **证据**：包在场且可解析——`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/`（真实目录，lib/index.js，v0.2.0）；settings 键在场——`settings.yaml` L135-137 `vision-adam: {model: glm-5.3-flash, maxTokens: 100000}`（与升级前备份一致，未丢失）；boot 0 命中。
- **边界**：`settings.yaml` 的 `vision-adam` 段 990000 更新由另一条线负责，本包不写 settings.yaml、不重复该段（§4）。

### 1.4 subagent-model-selection-settings —— 清理（删除 inert disabled 条目）
- **禁用原因**：`cordis.patch.yml` L35-37：`disabled entry "subagent-model-selection-settings" at 2026-09-12T06:32:30.980Z`。
- **性质**：该 id 不是独立包——是 0.1.5 `dsh-tool-subagent` 的子插件（web2 树 `~/.dsh/profiles/web2/node_modules/@deepseek-ai/dsh-tool-subagent/lib/model-selection-settings.js` 存在）；0.1.1 全局树 `dsh-tool-subagent/lib/` 仅 `index.js`/`invariant.js`/`types`，**无此子插件** → 该 disabled 条目禁用一个不存在的东西，**inert**；纯 0.1.5 残留。
- **恢复动作**：删除该 disabled 条目（使文件与基线一致；不产生任何包恢复动作）。
- **证据**：0.1.1 全局树 grep `model-selection-settings` = 0 命中；web2 树含该文件；boot 0 命中。

### 1.5 usage —— 不在 web profile 恢复范围（文档化）
- **盘面**：web profile flat layer **无** `@local/dsh-usage`（从 web profile 解析 `MODULE_NOT_FOUND`）；web `cordis.patch.yml` 无 usage insert；settings.yaml 无 usage 键。包**仅存在于 web2 flat layer**（`~/.dsh/profiles/web2/node_modules/@local/dsh-usage/`，9/12 12:50 部署，v0.1.0），且 web2 patch 有 `- insert: {id: usage, name: '@local/dsh-usage'}`。
- **结论**：usage 是 0.1.5 尝试期在 web2 侧的部署；web profile 从未部署、无从"恢复"。按"以盘面为准 + web2 冻结不动"，本包**不**把 usage 带入 web profile（那属新部署，需复制包 + 加 insert，另立任务）。
- **证据**：find 盘面 + node resolve 实测 + web2 patch 全文。

### 1.6 session-board —— 未部署（无恢复动作）
- **盘面**：任何 profile（web/web2）flat layer 均无 session-board；任何 cordis.patch.yml 历史（含 11 个 .bak 快照）无其 insert/disabled 记录；find `~/.dsh` + `~/.npm-global` = 0 命中。仅工作区源码 `~/dsh/session-board/dsh-session-board/`。
- **结论**：非"被禁用"，是"从未部署"→ 无恢复动作。如需部署另立任务。

### 1.7 better-sidebar —— 无盘面证据（未确认）
- **盘面**：全盘无此包、无源码目录、无 insert、无 settings 键（find 全盘 = 0）。
- **结论**：盘面无此物 → 无恢复动作；标**「未确认」**（疑与其它名称混淆，如官方 `dsh-client-ui-sidebar`，boot 图中在场且正常）。

---

## 2. 产物清单（`.workspace/plugin-restore/`）

| 文件 | 内容 | 状态 |
|---|---|---|
| `cordis.patch.yml` | **完整修正版（新文件）**：运行盘面 − 4 条 disabled；含注释标明删除/保留；btw 原样；vision-adam 恢复启用 | 已产出 |
| `apply-restore.sh` | 应用脚本（dry-run / apply / verify；备份+锚点删除+校验+幂等；RESTORE_TARGET 测试支持；web2 硬性拒绝） | 已产出，已测 |
| `README.md` | 恢复结论表、产物说明、应用方式、边界声明、遗留问题 | 已产出 |
| `_ref/profiles/web/cordis.patch.yml` + `_ref/settings.yaml` | 9/11 升级前备份基线（自 `~/dsh-upgrade-backup/dsh-home-config.tgz` 解出，只读参照） | 已产出 |
| `_test/live-copy/` | 应用测试副本（含 .bak 备份产物） | 已产出，已测 |
| 本报告 | 执行+复核结论 | 已产出 |

**b. 包/符号链接修复脚本：无（无缺失）**——4 个待恢复插件包全部在场且可解析（node resolve 实测 OK），不产出修复脚本。
**c. settings 键补充片段：无（无缺失）**——`vision-adam`/`wallpaper.global`/`agent-presets.default` 键均在 `settings.yaml` 在场（含 wallpaper 媒体文件实测存在）；taste 配置在 `~/.dsh/taste/config.json`（在场）。不写 settings.yaml（vision-adam 段归另一条线）。

---

## 3. 自验结果（复核一体）

| # | 自验项 | 方法 | 结果 |
|---|---|---|---|
| 1 | 修正版 yaml 解析 | pyyaml `safe_load` | ✅ 5 个顶层条目，解析通过 |
| 2 | 与备份基线语义 diff | 修正版 vs `_ref/profiles/web/cordis.patch.yml` 结构比对 | ✅ 5/5 条目逐项相等（`==` True），仅注释差异 |
| 3 | 逐插件恢复条目核对 | 脚本断言：4 条 disabled 不存在、4 条 insert 在场且 name 不变、btw 未被 disabled、agent-presets.default=standard-glm、与参照版结构一致 | ✅ 全部通过 |
| 4 | 应用脚本 dry-run（对 live 盘面，只读） | `apply-restore.sh --dry-run` | ✅ 命中 4 锚点；diff 仅删 4 块；模拟结果校验通过 |
| 5 | 应用脚本 apply（工作区副本） | `RESTORE_TARGET=…/cordis.patch.yml --apply` | ✅ 备份→删 4 锚点→校验→包解析 OK |
| 6 | 幂等 | 再次 `--apply` | ✅ no-op（"已恢复"），exit 0 |
| 7 | verify 模式 | `--verify` | ✅ exit 0 |
| 8 | web2 守卫 | `RESTORE_TARGET=…/web2/cordis.patch.yml --verify` | ✅ REFUSE，exit 2（web2 零改动硬约束） |
| 9 | 包解析（部署侧真实路径） | node `require.resolve` 4 包（从 `~/.dsh/profiles/web`） | ✅ vision-adam/taste/btw/wallpaper 全部 OK |
| 10 | boot 图实抓 | `curl :3080/` → 43 插件条目，taste/wallpaper/vision-adam/usage/subagent-model-selection-settings 0 命中、btw 在 | ✅ 与盘面 disabled 态一致 |
| 11 | 无越界复核 | 会话内 `~/.dsh` 仅读（无写命令）；写操作全部在 `.workspace/`；无 sandbox_permissions | ✅ |

---

## 4. 边界声明（与其它在途改动）

| 在途线 | 改动区域 | 本包触及 | 说明 |
|---|---|---|---|
| 卡顿修复线 | `~/.npm-global` 全局树 4 包 + `settings.yaml`（adam models / vision-adam 段） | 否 | 本包唯一写点 = `cordis.patch.yml`；settings.yaml 与全局树零写 |
| 主线 btw v2 | `dsh-host-apiproxy` lib + `vision-adam` lib + `btw` lib | 否 | 不碰任何 lib；btw insert 原样（脚本断言） |
| web2（0.1.5 残留） | 冻结 | 否 | 脚本硬性拒绝 web2（实测 exit=2） |
| vision-adam settings 990000 | `settings.yaml` `vision-adam` 段 | 否 | 只恢复启用，不重复写该段 |

原则落实：**cordis.patch.yml 只做恢复，不引入新机制**（无新 insert/config/path 引用；删除 = 精确锚点删除）。

---

## 5. 部署提示（主代理执行时注意）

1. 部署位 `~/.dsh` 在工作区外，由主代理执行：`--dry-run` 预览 → `--apply`（自动备份 `cordis.patch.yml.bak-plugin-restore-<ts>`）→ `--verify`。
2. **应用后需重启 DSH** 使插件组合对新会话生效（agent-presets 注释与 patch 层语义；重启最稳妥，hot-reload 声明不保证 host 侧组合变更即时生效）。
3. 若部署时盘面已被其它操作改动（4 条 disabled 已不在）→ `--apply` 判 no-op，不会覆盖其它改动。
4. 恢复完成后建议重抓 boot 图复核：预期 taste/wallpaper/vision-adam 出现在 boot 条目中，btw 仍在。

---

## 6. 遗留问题清单

| # | 问题 | 状态 | 建议 |
|---|---|---|---|
| 1 | usage：web profile 未部署（仅 web2 有）；若要在 web profile 启用 = 新部署 | 需主代理裁决 | 如启用：复制 `web2/node_modules/@local/dsh-usage` → `profiles/node_modules/@local/`，web patch 加 insert（注意与 btw v2 线隔离） |
| 2 | better-sidebar：全盘无证据 | 未确认 | 与用户核对名称（可能指官方 dsh-client-ui-sidebar） |
| 3 | `profiles/node_modules/@deepseek-ai/` 下 52 个断链符号链接（陈旧非闭包链接：指向已清除 npx cache 或 0.1.1 闭包外包名） | 既有遗留，与本次无关，不动 | 如需清理另立任务（DSH ensureSymlink 不剪枝，属正常语义） |
| 4 | host 进程实时解析/重启生效时点 | 未确认（沙箱无法观测宿主进程） | 部署后以 boot 图 + 功能实测为准 |

---

## 7. 一句话结论

**恢复包自验 PASS**：taste/wallpaper/vision-adam 恢复 = 删除 `cordis.patch.yml` 中 3 条 disabled 残留（包与 settings 键均在场无缺失）；subagent-model-selection-settings = 清理 1 条 inert disabled 残留；usage/session-board/better-sidebar 盘面非"被禁用"（未部署/无证据），不在本恢复范围。修正版与 9/11 升级前基线结构全等；应用脚本（备份+应用+校验+幂等+dry-run+web2 守卫）实测通过；全程只读 `~/.dsh`、只写工作区、未用 sandbox_permissions、web2 零改动。
