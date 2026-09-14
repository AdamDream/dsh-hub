# subagent 多开卡顿修复 — 部署与验证 Runbook

> 依据：`.workspace/lag-audit-mechanism.md`（机制审计）、`.workspace/lag-audit-diff.md`（差异审计）、`.workspace/lag-fix-exec.md`（执行报告，产物在 `.workspace/deploy-lag/`）。
> 用户裁决：全量部署（3 补丁 + mux/FrameQueue 加固 + settings 990000）；FrameQueue 丢最旧帧 + **应答帧（approval/question）永不丢弃**；重放脚本固化防重装再清。
> 部署位：live 全局树（`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`，即当前实际运行底座）+ `~/.dsh/settings.yaml`。

## 阶段 0：部署（主代理执行，需 danger-full-access 提权）

```bash
cd /home/CNS2026495165/dsh/.workspace/deploy-lag
bash replay-lag-fix.sh            # 备份 -> 应用 3 补丁 -> u4/u5 加固 -> settings 改写+断言
# 可先 bash replay-lag-fix.sh --dry-run 再执行；--rollback 可一键还原
```

预期输出：前置校验通过 → 备份完成（`backup-<时间戳>/`）→ U-1..U-3 PASS（node --check + 锚点）→ U-4/U-5 PASS（订阅过滤 + MAX_QUEUED_FRAMES×2）→ U-6/7/8 settings 三条断言 PASS → 「全部单元 PASS」。

## 阶段 1：部署后静态核验（主代理/用户任一方）

```bash
AL=~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
grep -c isSubagent "$AL/dsh-agent-loop/lib/index.js"            # 期望 >=2
grep -cE 'formatTokensPerSecond|decodeTokensPerSecond' "$AL/dsh-client-ui-subagent/lib/client.js"  # >=2
grep -c 'x-opencode-session' "$AL/dsh-web-search-deepseek/lib/index.js"                            # >=1
grep -c 'MAX_QUEUED_FRAMES' "$AL/dsh-host-apiproxy/lib/index.js"                                    # >=2
grep -n '990000' ~/.dsh/settings.yaml                            # 期望 3 处（adam/opencode-go/vision-adam）
```

## 阶段 2：重启 + 复现验证（用户执行）

1. 重启 DSH：`npx @deepseek-ai/dsh web`（宿主侧改动 agent-loop/host-apiproxy/settings 需重启生效；ui-subagent 客户端补丁刷新浏览器即生效）。
2. **多开复现**：同时开 3-4 个 subagent（含一个产出大文档/长工具结果的），观察：
   - 子代理会话事件：**0 条 `assistant/chunk`、每轮仅 1 条 `assistant/message`**（非流式落盘恢复）——在子代理会话详情里确认；
   - 主会话打字机流式**照常**（depth=0 仍逐 chunk）；
   - UI 不再冻结/掉帧；多开时输入与滚动流畅（mux 订阅过滤 + FrameQueue 有界 + 应答帧守卫生效）；
   - 子代理界面恢复 tok/s 显示（U-2）；web-search 请求带 x-opencode-session 头（U-3）。
3. 设置页模型列表：deepseek-v4-flash（adam）与 deepseek-v4.1-flash（opencode-go）maxTokens 均显示 990000。
4. 若异常：`cd /home/CNS2026495165/dsh/.workspace/deploy-lag && bash replay-lag-fix.sh --rollback && npx @deepseek-ai/dsh web` 一键还原后反馈。

## 阶段 3：抗重装

任何 `npm i -g @deepseek-ai/dsh…`（全局重装）会再抹这 4 个被改包；重装后重跑 `bash replay-lag-fix.sh` 即恢复（脚本幂等，已应用单元自动 SKIP）。tgz 与脚本均在全局树外，安全。

## 已知边界（执行报告遗留）

- adam 网关对 `max_tokens=990000` 的服务端硬上限未实测（0.99M < contextWindow 1M 自洽；若网关拒绝会请求报错，届时把该模型 maxTokens 调回网关接受值即可，仅影响该模型请求）。
- FrameQueue 丢帧仅影响实时推送，会话日志完整；浏览器缺帧可刷新/历史回拉补齐。
- vision-adam 插件当前在 cordis.patch.yml 为 disabled（插件恢复线处理），settings 段写入不受影响。
