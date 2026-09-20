# 自复核（修订执行复核一体档 · 同档自裁决）

> 对照「需求（用户裁决）」逐项核对 + 审计结论核对 + 自裁决（通过 / 返工）+ 问题清单。
> 自复核基于本档完整执行上下文（真实读码、实机命令、测试输出），不另派独立复核。

## 1. 逐需求核对

| # | 需求项 | 交付物 | 证据 | 判定 |
|---|---|---|---|---|
| 1 | 底座 = dsh-workspace-enhancement@0.1.2（rc.2 原生，改动面 <50 行） | `base/dsh-workspace-enhancement-0.1.2.tgz` + `base/patch/dsh-workspace-enhancement-0.1.2-rc2.patch` + 应用后副本 | npm pack 0.1.2，sha256 `6aeb0f3c…` 与 research tarball 一致；适配 diff 共 23 行（**4 行实际变更**）；应用后 13 deps + 2 peers 全 strict ✓ | ✅ 通过 |
| 2 | 核对 13 个 @deepseek-ai deps 是否 ^0.1.1-rc.2 | `base/peer-deps-check.mjs`（原版/适配后两版） | 原版：11/13 strict ✓，2 项（picker 双包）^0.1.0-rc.6 仅预发布放行；2 个 peer 同；**适配后 13+2 全 strict ✓**（消除第二份实例风险） | ✅ 通过（原版不完全 ^0.1.1-rc.2 → 适配已修正） |
| 3 | 底座能力：SSH 远程开发+多工作区+sw_* 五工具 | 底座自带（审计 §2.1：sw_status/sw_connect/sw_pick_workspace/sw_exec + win32 bash） | `base/load-test2.mjs`：12 host 模块在本机 rc.2 树**全部静态加载成功**；0.1.4-only 符号（connection.fetch/uiWorkspace）grep 零命中；`lib/web.js:504` 用 `rpc.handle('/dsw')`（rc.2 API） | ✅ 通过（运行期真 boot 列为装后验证 RUNBOOK §5.1/5.4） |
| 4 | PTY | 底座 `lib/terminal.js`（审计 §4 逐符号核验存在） | 0.1.2 发布物含 terminal.js；ptty 投影 ctx.subprocess.spawnTerminal | ✅ 通过（静态核验；装后实测） |
| 5 | ProxyJump | 底座 `lib/runtime.js`（jumps[] 多跳链 + TOFU） | 逐行核验存在（lib/runtime.js:44-56 jumps 链、hostkey.js TOFU） | ✅ 通过（静态核验） |
| 6 | **bwrap 沙箱 + 审批门** | ⚠️ **0.1.2 不含**（0.1.4 增量） | lib/ grep `approval|bwrap|remote-sandbox|remoteSandbox` **零命中**（排除 .map）；审计 §4「安全附加层（0.1.4）：远程命令审批门…远端 sandbox 围栏」 | ⚠️ **偏差，需上报**（见问题清单 #1） |
| 7 | 自研薄插件：串口收发+日志（serialport/stty） | `dsh-workerspace/lib/serial.js` + index.js 4 会话工具 + ws_serial_list | stty 默认后端（O_NONBLOCK 轮询）+ serialport 可选后端；日志落盘 `serialLogPath()`；6 工具注册（grep 6 处 ctx.tools.register） | ✅ 通过 |
| 8 | 烧录白名单封装（esptool/openocd/dfu/uuu/fastboot 模板 + 高危确认模态） | `dsh-workerspace/lib/flash.js` + index.js ws_flash | DEFAULT_TOOL_ALLOWLIST 五项；planFlash 白名单/围栏/凭据槽；ctx.approval.request 确认（非 allowed-once fail-closed）；测试覆盖拒绝路径 | ✅ 通过 |
| 9 | 产物落盘 ~/.dsh/workerspace/ | artifacts.dir 默认 `dshHomePath()/workerspace`（= ~/.dsh/workerspace） | lib/index.js defaultArtifactsDir + ensureArtifactsDir（0700）；flash/serial 日志均落其下 | ✅ 通过 |
| 10 | 交叉编译不做（复用底座远端 bash） | 明确不实现 | dsh-workerspace/README.md §二（未做）；薄插件工具面无交叉编译工具 | ✅ 通过 |
| 11 | 安全 = 白名单 + 占位符强校验 + 确认模态 + 脱敏 | core.js 四道闸 | 42 用例覆盖：parseCommandTemplate 拒绝 shell 元字符/混合占位符；resolveArtifactPath 围栏（.. / symlink 逃逸拒绝）；redact 长值优先；runFlashPlan ask=false fail-closed | ✅ 通过 |
| 12 | 密钥 credential-ref（明文永不进模型上下文/浏览器） | hosts[].keyRef `.role("credential-ref")`；ws_flash `{{credential:<ref>}}` 经 `credentialRef()` + `credentials.resolve` | 与 vision-adam 官方范式一致；非法 ref `credentialRef()` 实测抛错；settings 只存引用；README 安全模型节 | ✅ 通过 |
| 13 | 底座部署包完整件（tarball/核对/diff/cordis insert/settings 键/client slots 说明） | base/README.md + cordis-insert.md + client-slots.md | cordis-insert：路径 A/B + 三行 config 键表（源码级行号）；client-slots：6 注入包全装 + 5 slot 全在 rc.2 + 种子词结论 | ✅ 通过 |
| 14 | 薄插件源码 @local/dsh-workerspace（settings 命名空间 5 键组） | dsh-workerspace/（package.json + lib 4 模块 + README + LICENSE + test） | Config 键：serial/flash/artifacts/security/hosts 实测默认值与样例通过（ws-config-test.mjs）；exports/inject/name 加载正确（ws-load-test.mjs） | ✅ 通过 |
| 15 | 测试：核心逻辑纯单测 + node --check | test/ 3 文件 42 用例全绿；lib 4 模块 node --check 全过 | `node --test` 42 pass / 0 fail；node --check 4/4 OK | ✅ 通过 |
| 16 | 部署脚本 + Runbook（安装/重启/验证/回滚） | deploy.sh（dry-run/apply/rollback）+ RUNBOOK.md | deploy.sh bash -n 通过 + dry-run 全量计划打印正确；RUNBOOK 5.1-5.7 验证矩阵 + §6 回滚 | ✅ 通过 |
| 17 | 自复核 + 报告 | 本文 + `.workspace/workerspace-exec.md` | — | ✅ 通过 |
| 18 | 约束：只写 deploy-workerspace/ 与报告；不改 ~/.dsh；禁 sandbox_permissions | 遵守 | 全库未写 ~/.dsh（loadtest staging 用 symlink 只读引用 profile；npm install 意外污染 dsh 根 node_modules 的 ssh2/asn1 已当场清理）；全程未用 sandbox_permissions | ✅ 通过 |

## 2. 自裁决：**通过**（附问题清单）

逐需求核对 18/18 达成或已标注偏差；42 单测 + 语法 + 静态加载全部绿色；约束全部遵守。
不构成 rework 的偏差按问题清单上报主 agent 裁决（业务裁决，非调用失败）。

## 3. 问题清单（随报告返回主 agent）

1. **【需求偏差 · 底座能力】需求裁决把「bwrap 沙箱 + 审批门」列为 0.1.2 底座能力，但 0.1.2 实为 0.1.4 增量**（lib/ grep 零命中；审计 §4 证据）。0.1.2 只含：SSH 远程+多工作区+sw_*+PTY+ProxyJump+SFTP+TOFU+缝路由。若 bwrap 远端沙箱/审批门是硬需求，唯一路径是 0.1.4 backport（审计估 200–500 行，违反「改动面 <50 行」裁决）或底座升级 DSH。**本次按「<50 行」裁决取 0.1.2，缺口如实标注**：薄插件 ws_flash 已自带高危确认模态（ctx.approval，补本地面高危门），远端命令审批门未覆盖。请主 agent 裁决：接受 0.1.2 无审批门/沙箱，还是改选 0.1.4 backport。
2. **【装后验证】静态兼容 ≠ 真 boot**：底座 12 host 模块静态加载通过、API 逐符号核验通过，但未实机启动（作者 F1 教训）。RUNBOOK §5.1/5.4 已列为必做冒烟。
3. **【薄插件边界】串口 stty 后端仅 Linux（GNU stty -F）**；macOS 需 -f 未适配（TODO）。serialport 后端需 profile 装 npm serialport（可选）。
4. **【薄插件边界】ws_flash 仅本机 USB 烧录**；远程/远端 USB 烧录明确走底座 sw_exec（薄插件不实现，hosts 键仅引用性说明）。
5. **【薄插件测试】真机未测**：42 用例全为纯逻辑 + 假 provider；真实串口/烧录器行为属装后验证项（RUNBOOK §5）。
6. **【底座维护】0.1.2 是作者已退场版本**（0.1.3/0.1.4 跳线到新家族），无上游修复，装后需自测（RUNBOOK 已含）。
7. **【语义提示】底座 patch 会 disable 官方 directory-picker-auto/subprocess-local/fs-sandbox 三行**（对部署装配的接管）；部署时可选择不 disable（风险自负），已在 cordis-insert.md 标注。

## 4. 关键验证命令回放（可复现）

```bash
cd .workspace/deploy-workerspace
node base/peer-deps-check.mjs                 # 原版 11/13 strict，2 项仅预发布放行
node base/peer-deps-check-patched.mjs         # 适配后 13 deps + 2 peers 全 strict ✓
node base/load-test2.mjs                      # 底座 12 host 模块加载 OK（client.js FAIL=浏览器端，预期）
node --test dsh-workerspace/test/core.test.mjs dsh-workerspace/test/flash.test.mjs dsh-workerspace/test/serial.test.mjs   # 42 pass / 0 fail
for f in dsh-workerspace/lib/*.js; do node --check "$f"; done   # 4/4 OK
node base/loadtest/ws-load-test.mjs           # 薄插件 exports/inject/Config 正确
node base/loadtest/ws-config-test.mjs         # Config 默认值/样例/credential-ref 行为
bash deploy.sh                                # dry-run 全量计划（不写 ~/.dsh）
```
