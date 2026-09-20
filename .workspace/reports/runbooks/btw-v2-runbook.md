# btw 升级 v2 — 主线部署与验收 Runbook

> 依据：`.workspace/btw-upgrade-impl-audit.md`（交付单元 U-A..U-N）、`.workspace/btw-upgrade-impl-exec.md`（执行+自复核 PASS：oxlint 0/0、tsc×3 零错、vitest 173 passed/2 skipped、tsdown 成功、smoke 10 断言、publint good）。
> 方法论：两阶段闭环（审计 → 修订执行复核一体，2026-09-12 用户裁决废止独立复核）。
> 部署已完成（主代理，备份：`.workspace/backup-btw-deploy-20260912*/`）；本 Runbook 供你重启 + 验收。

## 已部署内容

| 项 | 部署位 | 状态 |
|---|---|---|
| btw lib（v2：图片管线/跳转列表/项目总览/readImage 等 10 remote） | `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/`（整体替换，备份同前） | ✅ |
| host-apiproxy 官方补丁（`session/prompt-image-transform` waterfall + 门禁放行） | 全局树 `dsh-host-apiproxy/lib/index.js`（在卡顿修复加固之上叠加，hunk offset 17 锚点命中） | ✅ |
| vision-adam 配置化 lib（opencode + deepseek-v4.1-flash） | `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js` | ✅（此前已部署） |
| settings `vision-adam` 段 | `~/.dsh/settings.yaml` | ✅（`model: deepseek-v4.1-flash` / `baseURL: opencode` / `apiKeyEnv: OPENCODE_GO_API_KEY` / **`maxTokens: 393216`**（opencode 网关实测硬上限，勿改回 990000）） |

## 步骤 1：重启

```bash
npx @deepseek-ai/dsh web
```

## 步骤 2：静态核验（可选）

```bash
# btw 新 client rev（应与旧 049df2a5c3e3 不同）
curl -s http://127.0.0.1:3080/ | grep -o 'dsh-btw/client.js?rev=[a-f0-9]*' | head -1
# 补丁锚点
grep -c 'session/prompt-image-transform' ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js   # >=1
# btw remote
ls ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/ | grep -c remote
```

## 步骤 3：验收 6.4.a-f（GUI）

1. **主会话图片**：主输入框粘贴/截图图片 → 发送。预期：图片经 vision-adam（opencode deepseek-v4.1-flash）转文本 → 按 R1-9 模板包装（「用户附带了 N 张图片，以下为各图片的描述（vision-adam 生成）：… 用户原文」）进入对话；**不再被对话模型图片门禁拦截**；转录里能看到原图缩略图 + 分析文本。
2. **btw 侧聊图片**：侧聊输入框粘贴图片 → 同样管线；转录显示缩略图 + 分析文本。
3. **分析失败**：vision-adam 异常时 → 报错提示、不发送、可重试（不发原图给对话模型）。
4. **侧聊跳转列表**：抽屉内统一侧聊列表（可折叠），点击条目在主会话与各子代理 btw 侧聊间快速跳转；条目显示 label + lastActiveAt + 截断预览。
5. **项目总览**：抽屉内项目「全部」tab，点击 = 激活项目 + 跳转。
6. **模型路由**：侧聊模型选择器仍为三选项（deepseek-v4-flash 默认 / glm-5.3 / deepseek-v4-pro，provider adam），按对话持久化；主会话模型不受影响。

## 步骤 3b：面板呈现对齐验收（2026-09-12 新功能，实现自裁决 PASS：`.workspace/btw-ui-exec.md`）

7. **顶部运行横幅**：子代理回合进行中，侧聊面板顶部显示 TurnStatus 渐变横幅「输出中…·当前动作: <工具名>」（in-flight 工具）/「输出中…」（纯生成）；回合结束横幅消失、完整消息 ≤220ms 落地。
8. **工具调用块**：含工具调用的回合，消息下方显示工具行（IN/OUT 折叠卡，data-state running/error/ok + sweep）；运行中可见、结束后可展开看参数与结果摘要。
9. **消息块/布局回归**：用户/助手 MarkdownText 消息、图片缩略图+分析文本、抽屉跳转列表、项目「全部」tab 全部照旧（本功能只增不改）。

## 回滚（如异常）

```bash
# btw lib 回滚
rm -rf ~/.dsh/profiles/node_modules/@local/dsh-btw/lib
cp -r /home/CNS2026495165/dsh/.workspace/backup-btw-deploy-20260912*/dsh-btw/lib ~/.dsh/profiles/node_modules/@local/dsh-btw/lib
# host-apiproxy 回滚（恢复备份副本）
cp /home/CNS2026495165/dsh/.workspace/backup-btw-deploy-20260912*/host-apiproxy.index.js \
   ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js
# 重启
npx @deepseek-ai/dsh web
```

## 遗留（自复核报告，部署后人工验收）

- 审计未确认项 3/4/6（settings vision-adam 运行时可读性、主会话变换失败 agent-busy 展示、x-api-key 对 adam 网关兼容）→ 上述步骤 3.1/3.3 即覆盖前两项；vision-adam 真实 API 冒烟已在部署前独立通过（v4f-test.png 正确识别）。
- jump-list 等组件测试有 React act 警告（仅警告，不影响通过）。
- 工作区 node_modules 依赖部署位符号链接（本地验证用），日后重装依赖需完整 install。
