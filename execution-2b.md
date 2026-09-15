# ②b 执行证据：dsh-agent-loop 子代理非流式落盘（loop 层缓冲）

## 改动（2 处，均 verified）
文件：`~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js`

> 位置说明（2026-09-15，审计 A §1 核验）：本档为 09-08 的执行证据，当时补丁落在
> `profiles/web/node_modules`；09-15 npm 遮蔽事故修复后该路径整目录已删除，live 打补丁副本
> 现位于全局树 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js`
> （运行时经 profiles 符号链接农场解析到该副本，无本地遮蔽）。

1. `step()` L611 后新增：
```js
const isSubagent = (this.options.subagentDepth ?? 0) > 0 || (this.session.header?.delegationDepth ?? 0) > 0;
```
2. L621 逐 chunk append 改为条件化：
```js
if (!isSubagent) chunkSeqs.push(this.session.append("assistant/chunk", { ... }).seq);
```

效果：子代理（delegationDepth>0）不再逐 token 写 `assistant/chunk`，只在一轮结束时写 1 条 `assistant/message`（L673 原本就有）；主会话/btw（depth=0）仍逐 chunk 流式，打字机体验不变。

## 安全验证（静态，全部通过）
- `node --check` ✅ 语法通过。
- `diff -u 备份 现文件` ✅ 仅上述 2 处改动，无其它副作用。
- 判定字段可达：`this.options.subagentDepth`（dsh-subagent resolveChildAgentOptions 写入，主会话 undefined/子代理≥1）+ `this.session.header.delegationDepth`（childSessionMeta 写入，header 常驻）。
- `sourceEventSeqs: []`：dsh-session L325 明确「empty 仅允许在 assistant/message 上」——子代理 chunkSeqs 变空后，L673/L632 的 `assistant/message` 带空 sourceEventSeqs 合法。
- 结果读取不破：`finalAssistantOutput`（dsh-subagent L84）读 `assistant/message`（保留）；`foldConsumedWork`（dsh-agent L218）不引用 chunk/message。
- 备份已做：`dsh-agent-loop.orig-20260908/`（完整目录拷贝，**该目录现已不存在**——09-15 事故修复
  删除 web profile node_modules 时一并移除；当前有效回滚路径见下方「回滚 Runbook」修正）。

## 回滚 Runbook（一键）

> **2026-09-15 修正（审计 L-3 文档漂移）**：旧命令引用的 `$PKG.orig-20260908` 已不存在
> （web profile 现无 node_modules），回滚改为 deploy-lag 备份 + 重放脚本：

```bash
# 当前有效回滚路径：deploy-lag 备份（backup-20260912-160759/160832，实测为补丁前基线：
# agent-loop isSubagent=0、apiproxy 加固锚点=0）+ 重放脚本 --rollback（还原 5 包 + settings.yaml）
cd /home/CNS2026495165/dsh/.workspace/deploy-lag && bash replay-lag-fix.sh --rollback
# 重启 DSH 后即恢复原行为
```

## 运行时验证 Runbook（重启后）
```bash
# 1) 确认改动已装入（进程内读到 isSubagent）
grep -n "isSubagent" ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js

# 2) 重启 DSH
npx @deepseek-ai/dsh web

# 3) 派一个 subagent 做调研，观察其会话事件：
#    期望：无 assistant/chunk 事件，只有 1 条 assistant/message（非流式落盘）
#    主会话：打字机流式不变（仍有 assistant/chunk）
```

## 待办 / 风险
- 运行时验证（重启 + 观测事件数）需用户重启，主代理进程内无法自重启验证。
- 若实测 I/O 削减不足，再评估 ②a（wire 非流式，改 3 核心包）。
- ① worker_threads 视 ②b 实测效果再决定是否投入（两审计均判定收益需实测）。

## 复核结论（独立复核 PASS）
- diff 仅 2 处、逻辑正确：`assembler.push(chunk)` 在 `if (!isSubagent)` 之外，最终 `assistant/message` 内容与改造前逐字一致。
- 判定等价：`a>0 || b>0` 与官方 `delegationDepthOf` 的 `max(a,b)>0` 对非负整数等价。
- 安全性：`sourceEventSeqs:[]` 仅允许在 assistant/message（dsh-session L325）；`finalAssistantOutput` 读 message、`foldConsumedWork` 不引用 chunk。
- 边界：主会话/btw（depth=0）逐 chunk append 保留；中断分支正确。
- 生效路径：`main: lib/index.js`（type:module）非 bundle，重启即生效。
- 无遗漏、无副作用。三阶段闭环：审计 → 修订执行 → 复核 全部通过。
