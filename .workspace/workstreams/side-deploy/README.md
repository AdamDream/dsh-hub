# side-deploy — usage + session-board 部署包（支线收尾）

> 生成：2026-09-12。执行+复核一体（用户裁决，未走独立审计）。部署位在 `~/.dsh`（工作区外），
> 由**主代理**在部署期应用本目录产物；本目录只读 `~/.dsh`、只写工作区。

## 产物清单

| 路径 | 说明 |
|---|---|
| `usage/` | `@local/dsh-usage` v0.1.0 完整包（与 web2 `web2/node_modules/@local/dsh-usage/` 逐字节一致） |
| `session-board/` | `@deepseek-ai/dsh-session-board` v0.1.0 完整包（与源码目录逐字节一致，含 install.sh / CONTRACT.md） |
| `deploy-side.sh` | 部署脚本：备份 → 拷贝两包 → 幂等追加 insert；`--dry-run` 演练；`bash -n` 通过 |
| `cordis-insert-usage.yml` | usage 的 cordis.patch.yml insert 片段（对齐 web2 用法） |
| `cordis-insert-session-board.yml` | session-board 的 insert 片段（挂载 id `session-status-board`） |
| `usage-compat-011.diff` | **可选**：usage 适配 web profile（0.1.1-rc.2）RPC API 的 1 行补丁（见 REVIEW.md P0） |
| `DEPRECATED-web2.md` | web2 废弃标记文本（主代理单独放入 `~/.dsh/profiles/web2/`） |
| `REVIEW.md` | 复核报告：verdict pass/rework + 问题清单 + 部署注意点 |

## 部署步骤（主代理执行）

1. **裁决 usage 兼容问题（必读 REVIEW.md P0）**：usage v0.1.0 按 0.1.5 API 编写，
   在 0.1.1-rc.2 上 `connection.register(ctx, '/usage', handle)` 会 TypeError。
   二选一：
   - 原样部署（usage 在 web profile 将加载失败——仅 usage 受影响，不影响其他插件）；或
   - 先 `git apply usage-compat-011.diff`（或手工改 `usage/lib/rpc.js` 一行）再部署，usage 可正常加载。
2. `bash deploy-side.sh --dry-run` → 核对动作清单。
3. `bash deploy-side.sh`（正式部署，含备份 `*.bak-<TS>`）。
4. 把 `DEPRECATED-web2.md` 放入 `~/.dsh/profiles/web2/`（**本脚本不碰 web2**）。
5. 重启 dsh web（运行位 0.1.1-rc.2）→ 新会话生效；`usage` 界面在设置页 `dsh-usage` 卡片。

## 边界（脚本绝不触碰）

web2 / `@local/dsh-btw`·`dsh-wallpaper` / live 全局树（卡顿修复区）与 `~/.dsh/settings.yaml` /
`session-board` 官方重链区——脚本只写两个目标目录 + web 的 `cordis.patch.yml`（+ 就地 `.bak-<TS>` 备份）。

## settings 键结论

两插件均在运行时自注册 settings 命名空间（usage → `dsh-usage` 空 schema；session-board →
`session-status-board` 默认 Config），**无需 profile 级 settings 键**（与 web2 用法一致）。
