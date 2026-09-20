# plugin-restore 恢复包（web profile 0.1.1-rc.2）

> 产出时间：2026-09-12。由恢复执行+复核一体（用户裁决：不走审计、不走独立复核）。
> 约束落实：全程只读 `~/.dsh`、只写 `.workspace/plugin-restore/`；未使用 sandbox_permissions；
> web2（0.1.5 残留）零改动（应用脚本硬性拒绝 web2 路径，见下）。

## 1. 恢复结论（每插件一行）

| 插件 | 盘面状态（web profile） | 为何不在 boot | 恢复动作 | 证据 |
|---|---|---|---|---|
| taste | 包在：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-taste`（真实目录，lib 12 文件，可解析 v0.1.0） | `cordis.patch.yml` L39-41 `disabled: true`（dsh-fix 06:44:42Z 写入，0.1.5 尝试期残留） | 删除 disabled 条目 | 盘面 + boot 图 0 命中 |
| wallpaper | 包在：`~/.dsh/profiles/node_modules/@local/dsh-wallpaper`（真实目录，lib 3 文件，可解析 v0.5.0；媒体文件 `~/.dsh/wallpapers/37758c1c-….png` 存在） | `cordis.patch.yml` L27-29 `disabled: true`（06:31:35Z 残留） | 删除 disabled 条目 | 同上 |
| vision-adam | 包在：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam`（真实目录，lib/index.js，可解析 v0.2.0；settings 键在） | `cordis.patch.yml` L31-33 `disabled: true`（06:32:30Z 残留） | 删除 disabled 条目（恢复启用） | 同上 |
| subagent-model-selection-settings | 0.1.1 全局树无此 id（`dsh-tool-subagent/lib/` 仅 index.js/invariant.js/types；该 id 是 0.1.5 的 `lib/model-selection-settings.js` 子插件） | `cordis.patch.yml` L35-37 `disabled: true`；id 不存在 → 条目本身 inert | 删除 disabled 条目（纯清理） | web2 树含该文件，0.1.1 树不含 |
| usage | web profile 盘面无（`@local/dsh-usage` 从 web profile 解析 MODULE_NOT_FOUND；web patch 无 insert、settings 无键）；**仅存在于 web2 flat layer**（9/12 12:50 部署，v0.1.0） | web profile 从未部署 | **不在 web profile 恢复范围**（web2 冻结不动）；如需在 web profile 启用 = 新部署，另立任务 | 盘面 find 结果 |
| session-board | 任何 profile 盘面均无（find `~/.dsh`/`~/.npm-global` = 0）；仅工作区源码 `~/dsh/session-board/dsh-session-board/` | 从未部署 | 无恢复动作（非"被禁用"，是"未部署"） | 盘面 find 结果 |
| better-sidebar | 全盘无证据（无包、无源码、无 insert、无 settings 键） | 盘面无此物 | 无恢复动作；标「未确认」（疑与其他名称混淆，如官方 dsh-client-ui-sidebar） | 盘面 find 结果 |

## 2. 产物清单

| 文件 | 说明 |
|---|---|
| `cordis.patch.yml` | **完整修正版（新文件）**：= 运行盘面 − 4 条 disabled 残留；含注释标明删除项与保留项；btw 条目原样；vision-adam 恢复启用。语义与 9/11 升级前备份（`~/dsh-upgrade-backup/dsh-home-config.tgz`）结构全等（pyyaml 比对 5/5 条目相等） |
| `apply-restore.sh` | 应用脚本：`--dry-run`（默认，预览+模拟校验）/ `--apply`（备份→锚点删除→校验→包解析校验）/ `--verify`；幂等（已恢复 → no-op）；`RESTORE_TARGET` 支持工作区测试；硬性拒绝 web2 路径 |
| `plugin-restore-exec-review.md` | 执行+复核报告（本包自验结论 pass） |
| `_ref/` | 从 `dsh-home-config.tgz` 解出的升级前基线（只读参照） |
| `_test/` | 工作区内的应用测试副本（apply/幂等/verify 均已跑通） |

**b. 包/符号链接修复步骤脚本：无（无缺失）。** 4 个待恢复插件的包全部存在且可从 web profile 解析根解析（脚本内置 node 校验实测 OK）。不产出修复脚本，避免越界动作。

**c. settings 键补充片段：无（无缺失）。** 证据：`~/.dsh/settings.yaml` 中 `vision-adam`（L135-137）、`agent-presets.default`（L138-139）、`wallpaper.global`（L143-146，source 文件 `~/.dsh/wallpapers/37758c1c-….png` 实测存在）均在场；taste 配置在 `~/.dsh/taste/config.json`（在场）非 settings 键。
**明确不写** `vision-adam` settings 段——该段 990000 更新由另一条线负责，本包不重复写。

## 3. 应用方式（主代理执行，部署位 `~/.dsh` 在工作区外）

```bash
# 1) 预览（不落盘）
bash /home/CNS2026495165/dsh/.workspace/plugin-restore/apply-restore.sh --dry-run
# 2) 应用（自动备份 cordis.patch.yml.bak-plugin-restore-<时间戳> → 删除 4 条 disabled → 校验）
bash /home/CNS2026495165/dsh/.workspace/plugin-restore/apply-restore.sh --apply
# 3) 复核盘面（可随时再跑）
bash /home/CNS2026495165/dsh/.workspace/plugin-restore/apply-restore.sh --verify
```

**部署期注意**：
- 应用后**重启 DSH** 使插件组合对新会话生效（`cordis.patch.yml` 声明 hot-reload on long-lived surfaces，但重启最稳妥；agent-presets 注释亦要求重启后对新会话生效）。
- 应用脚本唯一写点 = `~/.dsh/profiles/web/cordis.patch.yml`（+ 同目录 .bak）；不写 settings.yaml、不写全局树、不写任何包目录、不写 web2。
- 如已有人先行手工恢复（盘面无 4 条 disabled）→ `--apply` 判 no-op，不会覆盖其它改动（删除动作是精确锚点删除）。

## 4. 边界声明（与其它在途改动）

| 在途线 | 改动区域 | 本包是否触及 | 说明 |
|---|---|---|---|
| 卡顿修复线 | `~/.npm-global` 全局树 4 包（dsh-agent-loop / dsh-client-ui-subagent / dsh-web-search-deepseek 等）+ `settings.yaml`（adam models / vision-adam 段） | **否** | 本包零写全局树与 settings.yaml；恢复只动 cordis.patch.yml |
| 主线 btw v2 | `dsh-host-apiproxy` lib + `vision-adam` lib + `btw` lib | **否** | 本包不碰任何 lib；`btw` insert 条目原样不动（脚本断言 btw 未被 disabled） |
| web2（0.1.5 残留） | 冻结 | **否** | 应用脚本硬性拒绝 web2 路径（实测 exit=2） |
| vision-adam settings 990000 更新 | `settings.yaml` 的 `vision-adam` 段 | **否** | 本包不写 settings.yaml，不重复该段 |

原则：**cordis.patch.yml 只做恢复，不引入新机制**（无新 insert、无新 config 键、无 path 引用）。

## 5. 遗留问题（部署期/主代理注意）

1. **usage 归属待裁决**：web profile 无 usage；web2（冻结）有 `@local/dsh-usage` v0.1.0 + insert。若主代理希望在 web profile 启用 usage，属**新部署**（复制包 + 加 insert + 可能加 settings 键），不在本恢复包范围。
2. **better-sidebar 无盘面证据**：全盘无此物，标「未确认」。
3. **52 个断链符号链接**（`~/.dsh/profiles/node_modules/@deepseek-ai/` 下）：全部为陈旧非闭包链接（指向已清除的 npx cache 或 0.1.1 闭包外包名，如 dsh-client-ui-chat / dsh-sdk-minimal / dsh-client-ui-slots 等），运行实例不受影响（boot 43 插件正常、包解析 OK）；DSH `ensureSymlink` 不剪枝属既有语义，**本次不动**。
4. **session-board 未部署**：工作区有源码（`~/dsh/session-board/dsh-session-board/`），如需部署另立任务。
