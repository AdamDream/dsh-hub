# PORT-NOTES —— dsh-pptmaster（dsh-workbuddy-ppt 0.1.0 本地 port）

## 来源与许可

- 上游：https://github.com/SuperstructureJH/dsh-workbuddy-ppt （npm `dsh-workbuddy-ppt@0.1.0`，MIT）
- 取源方式：npm registry tarball（`https://registry.npmjs.org/dsh-workbuddy-ppt/-/dsh-workbuddy-ppt-0.1.0.tgz`，sha512 `j6dB2av4AHEIXazbUBURRdN1GWEqvSdTD...`），2026-09-14 下载。
- 本 port 保留 LICENSE（MIT）与 README（上游署名），仅做标识符改名，不改任何功能逻辑。

## 改名映射（本次唯一改动）

| 项 | 原值 | 新值 | 位置 |
|---|---|---|---|
| 包名 | `dsh-workbuddy-ppt` | `@local/dsh-pptmaster` | `package.json` name |
| 插件 id（cordis insert） | `workbuddy-ppt` | `dsh-pptmaster` | `cordis.patch.yml` `- id:` |
| 插件 insert name | `dsh-workbuddy-ppt` | `@local/dsh-pptmaster` | `cordis.patch.yml` `- name:` |
| 插件身份（host apply name const） | `workbuddy-ppt` | `dsh-pptmaster` | `lib/index.js` L81942 |
| 客户端模块 id / CSS plugin 标记 | `dsh-workbuddy-ppt` | `dsh-pptmaster` | `lib/client.js`（5 处） |
| invariant 身份 | `dsh-workbuddy-ppt` / `workbuddy-ppt-invariant` | `dsh-pptmaster` / `dsh-pptmaster-invariant` | `lib/invariant.js` |
| 工具命名（6 个 defineTool + 全部引用） | `ppt_scene_check` / `ppt_scene_create` / `ppt_list_templates` / `ppt_get_template_pages` / `ppt_create` / `ppt_update_slide` | `pptmaster_scene_check` / `pptmaster_scene_create` / `pptmaster_list_templates` / `pptmaster_get_template_pages` / `pptmaster_create` / `pptmaster_update_slide` | `lib/index.js`（32 处）、`lib/client.js`（6 处）、`lib/types/tencent-skill.d.ts`（5 处）、`skills/workbuddy-ppt/SKILL.md`（5 处） |

## 明确不改（按"只做改名与 peer 核对，不改功能"）

- **内置 skill 名**：`workbuddy-ppt` / `ppt-design-systems` / `ppt-template-fidelity` / 动态 `ppt-style-*`、`tencent-pptx` 保持原名——改名清单只含包名/插件 id/工具名；且若把 `workbuddy-ppt` 改成 `pptmaster` 会与 pn1024 skill `ppt-master` 在目录里撞名，故保持。
- CLI bin `dsh-pptd`、config 键名（`workbuddyRuntimeRoot` 等）、RPC 路径 `/office-ppt`、状态根 `dshHomePath('office-ppt')`：运行时契约，不改。
- `package.json` 的 repository/homepage/bugs 仍指向上游（署名/溯源）；README.md / README.zh.md 为上游原文（安装命令已过时，以 Runbook 为准）。
- 工具行为、默认值、校验逻辑、渲染链：零改动。

## 变更后验证（2026-09-14 实测）

- `node --check` 通过：`lib/index.js`、`lib/client.js`、`lib/invariant.js`、`lib/pptd.js`、`lib/runtime-staging.js`、`lib/bin.js`。
- 残留扫描：`lib/` 与 `skills/` 中旧工具名（`ppt_scene_check` 等）0 处；`dsh-workbuddy-ppt` 仅剩 package.json 的溯源 URL 与 README。
- peer 核对：所有 `@deepseek-ai/*@^0.1.1-rc.2`（本机 0.1.1-rc.2 ✓）、`@deepseek-ai/cordis ^4.0.1`（4.0.2 ✓）、`react ^18.2.0`（18.3.1 ✓）、Node `^22.19.0 || >=24.0.0`（v22.23.2 ✓）。
- 运行时依赖缺口（部署期需补装，见 Runbook §3.2）：`pptxgenjs`、`@aiden0z/pptx-renderer`、`typescript` 不在 profile node_modules 中。

## 部署形态

- 插件目录即本 staging `plugin/dsh-pptmaster/`（含 cordis.patch.yml，`dsh.bundle.patch` 指向它）。
- 部署 = 拷入 profile（`dsh plugin --profile web add <路径>` 或手工放 `~/.dsh/profiles/node_modules/@local/dsh-pptmaster`）+ 依赖安装 + cordis.patch.yml 追加 insert 行（见 Runbook）。
