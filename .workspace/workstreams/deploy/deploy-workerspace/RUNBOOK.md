# RUNBOOK：dsh-workerspace 部署（底座 + 薄插件）

> 目标宿主：`@deepseek-ai/dsh` 0.1.1-rc.2 / cordis 4.0.2 / node ≥22 / profile `web`。
> 交付物：`.workspace/deploy-workerspace/`（staging，不碰部署位；本 Runbook 是操作指引）。
> 全程约束：修改 `~/.dsh` 前先备份；任何一步失败可走第 6 节回滚。

## 0. 前置核对（可选，建议）

```bash
node base/peer-deps-check-patched.mjs     # 底座 13 deps + 2 peers 对本机 strict ✓
node base/load-test2.mjs                  # 底座 12 host 模块静态加载（client.js FAIL 属预期）
node --test "dsh-workerspace/test/**/*.test.mjs"   # 薄插件 42 用例（目录裸参在 node 22 不可用，用 glob）
node --check dsh-workerspace/lib/*.js
```

## 1. 部署（两条路径选一）

### 路径 A（推荐）：deploy.sh 一键
```bash
bash deploy.sh          # 先 dry-run 看全量计划（不写 ~/.dsh）
bash deploy.sh --apply  # 目标机人工确认后执行：
                        #   底座拷贝 + ssh2 + patch 3 disable/3 insert
                        #   薄插件拷贝 + insert 行
                        #   settings.yaml dsh-workerspace 段
```

### 路径 B：手工（等价步骤，便于核对）
```bash
FB="$HOME/.dsh/profiles/node_modules"
# 底座（适配版，含 4 行 package.json 放宽）
rm -rf "$FB/dsh-workspace-enhancement"
cp -r base/patch/dsh-workspace-enhancement-0.1.2-rc2 "$FB/dsh-workspace-enhancement"
(cd ~/.dsh/profiles/web && pnpm add ssh2@^1.16.0)
# 薄插件
mkdir -p "$FB/@local"
cp -r dsh-workerspace "$FB/@local/dsh-workerspace"
# profile patch（备份后追加，内容见 base/cordis-insert.md 与 deploy.sh plan_*）
# settings.yaml 追加 dsh-workerspace 段（示例见 dsh-workerspace/README.md）
```

> 底座也可走 `dsh plugin --profile web add "file:.../base/patch/dsh-workspace-enhancement-0.1.2-rc2"`
> （bundle patch 自动合成）；本地拷贝路径等价且可控，两者任选，不要混用。

## 2. cordis patch 追加内容（核对清单）
- 3 个 `disabled: true`：`directory-picker` / `subprocess` / `fs-sandbox`（底座接管缝）；
- 3 个 insert：`ssh-remote`（name `dsh-workspace-enhancement`）、`directory-picker-ssh`
  （`.../picker`）、`ssh-web-channel`（`.../web`）；
- 1 个 insert：`workerspace`（name `@local/dsh-workerspace`）。
⚠️ 语义提示：disable 官方 3 行 = 对部署装配的接管（ctx.subprocess/ctx.fs 由底座混合 provider
接管，本地路径仍走本地实现）；如需保留官方缝，只插 3 行 insert 不 disable（风险自负）。

## 3. settings.yaml 段（键面见 dsh-workerspace/README.md 第三节）
- `serial.*`、`flash.templates[]`（白名单模板）、`artifacts.dir`、`security.*`、`hosts[]`；
- 密钥一律 credential-ref（如 `hosts[].keyRef: SSH_KEY_SOC`），值经 `~/.dsh/.credentials.yaml`
  （0600）由 dsh-credentials 解析，**明文永不进 settings / 模型上下文 / 浏览器**。

## 4. 重启
```bash
# 停掉当前 dsh web 进程，再启动（host 装配变更不随 HMR 生效）
npx @deepseek-ai/dsh web
```

## 5. 验证（装后必须，按序）

| # | 检查 | 期望 | 失败怎么办 |
|---|---|---|---|
| 5.1 | 启动日志无插件树加载错误 | 无 `dsw:` 相关异常；无 `Module not found` | 看日志定位：底座 load-test2 已证 12 host 模块可加载；多半是 ssh2 未装（`pnpm add ssh2@^1.16.0`）或 patch 条目格式错 |
| 5.2 | 工具列出 | 模型可见 `sw_status/sw_connect/sw_pick_workspace/sw_exec`（底座）+ `ws_serial_list/ws_serial_open/ws_serial_send/ws_serial_read/ws_serial_close/ws_flash`（薄插件） | GUI 会话里让模型调 `ws_serial_list`；工具缺失查 profile patch insert 行 |
| 5.3 | 串口探测 | `ls -l /dev/ttyUSB* /dev/ttyACM* /dev/serial/by-id/*` 列出 SoC 板串口；`ws_serial_list` 返回同款端口 | 无输出 = 板子未插/USB 枚举失败，与插件无关 |
| 5.4 | 底座冒烟（真 boot 项） | GUI 工作区选择器出现 SSH 远端目录入口；settings.section 出现 dsh-workspace-enhancement 设置页；浏览器控制台无 `missed the module table` | 见 base/client-slots.md；slot 全在 rc.2，问题多在 patch 装配 |
| 5.5 | 烧录 dry-run（拒绝未授权模板） | 调 `ws_flash` 传 `templateId=nope` → 报「unknown flash template …」；或配置一个 `command: rm …` 模板 → 报「not in the command allowlist」 | 若放行 = 白名单逻辑被绕过（回归测试），立即回滚并上报 |
| 5.6 | 高危确认模态 | 配一个 `dangerous: true` 模板并调用 → 应触发审批（allowed-once 才执行；rejected/cancelled/unavailable 均 fail-closed） | 未弹确认 = approval 服务不可达或 policy=never；确认 `security.confirmDangerous: true` |
| 5.7 | 日志落盘 | `~/.dsh/workerspace/` 下出现 `flash-<id>-<ts>.log`；`serial/` 下出现 `serial-<port>-<ts>.log` | 目录 0700 权限问题 |

真机项（有硬件才做）：`ws_serial_open` → `ws_serial_send/read`（SoC console 交互）→
`ws_flash`（真实烧录，人工确认模态）。

## 6. 回滚
```bash
bash deploy.sh --rollback
# 或手工：
#   1) 还原 cordis.patch.yml：cp ~/.dsh/profiles/web/cordis.patch.yml.bak-dsw-* 覆盖
#   2) rm -rf ~/.dsh/profiles/node_modules/dsh-workspace-enhancement \
#             ~/.dsh/profiles/node_modules/@local/dsh-workerspace
#   3) (cd ~/.dsh/profiles/web && pnpm remove ssh2)   # 确认无其他插件依赖
#   4) 还原 settings.yaml（.bak-dsw-*）或手工删除 dsh-workerspace 段
#   5) 重启 dsh web
```

## 7. 遗留风险（诚实清单）
1. 底座 0.1.2 是作者已退场的「历史正确版」（0.1.3/0.1.4 跳线），无上游维护 → 装后 5.1/5.4 必须真 boot 冒烟；
2. 薄插件 stty 后端面向 Linux（GNU stty `-F`）；macOS 未适配；
3. 真机串口/烧录行为未实测（本交付为纯逻辑 + 静态加载验证）；
4. 烧录超时中止依赖 AbortSignal 进程树终止，个别顽固进程可能残留（模板 timeoutMs 可调大）；
5. ws_flash 仅本机 USB；远程烧录明确走底座 sw_exec（薄插件不实现）。
