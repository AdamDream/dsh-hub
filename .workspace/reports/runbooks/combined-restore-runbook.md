# 紧急恢复 — 合并 Runbook（一次重启，统一验证）

> 2026-09-12。部署已完成（主代理），本 Runbook 供你重启 + 复现验证。
> 详细参考：`.workspace/lag-fix-runbook.md`（卡顿修复）、`.workspace/plugin-restore/README.md`（插件恢复）。

## 已部署内容（均已落盘核验）

| 线 | 改动 | 部署位 | 备份 |
|---|---|---|---|
| 卡顿修复 | ②b 子代理非流式（isSubagent）、tok/s 补丁、x-opencode-session 补丁、apiproxy mux 订阅过滤、FrameQueue 有界（4096，丢最旧普通帧、**应答帧永不丢弃**） | 全局树 4 包（agent-loop / client-ui-subagent / web-search-deepseek / host-apiproxy） | `.workspace/deploy-lag/backup-20260912-160832/` |
| 上下文上限 | adam `deepseek-v4-flash` → `contextWindow: 1000000` + `maxTokens: 990000`（adam 网关实测接受 990000）；vision-adam 段 → `model: deepseek-v4.1-flash` / `baseURL: opencode` / `apiKeyEnv: OPENCODE_GO_API_KEY` / `maxTokens: 393216`（**opencode 网关实测硬上限 [1,393216]，990000 会被拒**；不得在 pi-ai providers 里登记该模型——2026-09-12 事故，见 `.workspace/incident-piai-model-selection.md`） | `~/.dsh/settings.yaml` | 同上 backup 内 settings.yaml |
| 插件恢复 | 删除 cordis.patch.yml 4 条 0.1.5 残留 disabled（taste/wallpaper/vision-adam/subagent-model-selection-settings）；taste/wallpaper/vision-adam 恢复启用 | `~/.dsh/profiles/web/cordis.patch.yml` | `cordis.patch.yml.bak-plugin-restore-20260912-160933` |
| vision-adam lib | 旧 v0.2.0（硬编码 adam 网关）→ 配置化新 lib（默认 opencode + deepseek-v4.1-flash + OPENCODE_GO_API_KEY + 三头认证） | `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js` | `index.js.bak-restore-20260912-161015` |

## 步骤 1：重启 DSH

```bash
npx @deepseek-ai/dsh web
```

## 步骤 2：插件恢复验证（重启后刷新 http://127.0.0.1:3080）

- 侧边栏应出现 **taste**、**wallpaper**（背景图生效）、vision-adam 工具可用；
- 设置-插件页：taste / wallpaper / vision-adam 不再显示禁用；
- boot 图复核：`curl -s http://127.0.0.1:3080/ | grep -o '"id":"[^"]*"' | grep -E 'taste|wallpaper|vision-adam|dsh-btw'`

## 步骤 3：卡顿修复验证（重点）

1. 设置页模型列表：adam `deepseek-v4-flash` 与 opencode-go `deepseek-v4.1-flash` 的 maxTokens 均显示 **990000**。
2. **多开复现**：同时开 3-4 个 subagent（含一个产出大文档/长工具结果的），观察：
   - 子代理会话：**0 条 `assistant/chunk`、每轮仅 1 条 `assistant/message`**（非流式落盘恢复，事件风暴消除）；
   - 主会话打字机流式**照常**；
   - UI 不再冻结/掉帧；多开时输入与滚动流畅（mux 订阅过滤 + FrameQueue 有界 + 应答帧守卫）；
   - 子代理界面恢复 tok/s 显示；web-search 请求带 x-opencode-session 头。
3. 静态核验（任选）：

```bash
AL=~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
grep -c isSubagent "$AL/dsh-agent-loop/lib/index.js"                                  # >=2
grep -c 'MAX_QUEUED_FRAMES' "$AL/dsh-host-apiproxy/lib/index.js"                      # >=2
grep -c isAnswerableFrame "$AL/dsh-host-apiproxy/lib/index.js"                        # >=3
grep -n 990000 ~/.dsh/settings.yaml                                                   # 3 处
```

## 步骤 4：vision-adam 功能验证（已完成 ✅）

- 主代理已用 `v4f-test.png` 真实调用 `analyzeImageBytes`（opencode deepseek-v4.1-flash，maxTokens 393216）：
  耗时 3.3s，正确识别"绿色背景、左上红色方块、白色文字 V4F-73"——全链路可用。
- GUI 中对任意图片调用 vision-adam 的 analyze_image 即可复验。

## 回滚（如异常）

```bash
# 卡顿修复回滚
cd /home/CNS2026495165/dsh/.workspace/deploy-lag && bash replay-lag-fix.sh --rollback
# 插件恢复回滚（还原备份 cordis.patch.yml）
cp ~/.dsh/profiles/web/cordis.patch.yml.bak-plugin-restore-20260912-160933 ~/.dsh/profiles/web/cordis.patch.yml
# vision-adam lib 回滚
cp ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js.bak-restore-20260912-161015 \
   ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js
# 回滚后重启 DSH
npx @deepseek-ai/dsh web
```

## 验证通过后

主线 btw 升级 v2（侧聊图片粘贴 / 跳转列表 / 项目总览 / vision 模型路由）续接中，交付其独立 Runbook。
