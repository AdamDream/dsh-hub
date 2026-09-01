# dsh-taste

DeepSeek Harness（DSH）的本地偏好学习（Taste）插件：每轮对话结束后由后台 Learner
代理从对话中学习你的持久偏好（编码风格、工具链、工作流、沟通方式），写入人类可读的
`taste.md`，并在后续轮次自动注入模型上下文。学习管线复刻 [pi-taste](https://github.com/LycanW/pi-taste)
（Command Code Taste 工作流），完全本地化，不训练模型权重。

## 工作原理

```
用户轮结束 → turn-stopping 钩子采集本轮可见文本（脱敏+限长）→ 单并发后台队列
  → Learner（inherit 主模型路由，经 ctx.agents.create 受限 Agent）
  → read/write/edit_taste_file 三工具（路径白名单 + 锁内读-改-写）写 taste.md
  → 后续轮次经 systemPrompt.context() 差异注入 <taste> 快照（sanitize {{，KV-cache 友好）
```

- 子代理（subagent/subagent_fork/workflow 派生）不学习、默认不注入
- Learner 失败熔断：连续 3 次失败冷却 10 分钟（`/taste status` 可见）
- 全部写路径原子写（0600）+ 跨进程文件锁；无凭据落盘

## 存储

- 全局：`~/.dsh/taste/taste.md`（+ `config.json`）
- 项目：`<git-root>/.dsh/taste/taste.md`（自动生成全拒 `.gitignore`，防私有状态入库）
- 格式（Command Code 兼容）：`- Prefers tabs over spaces. Confidence: 0.9`；某类 >5 条自动分类重组到 `<category>/taste.md`
- 兼容只读：`~/.commandcode/taste/**` 与 `<root>/.commandcode/taste/**` 并入注入，绝不写回

## 命令

| 命令 | 作用 |
|---|---|
| `/taste status` | 开关/注入/队列/熔断状态/偏好总数 |
| `/taste on` / `/taste off` | 学习+注入总开关（持久化） |
| `/taste list` | 列出全部偏好 |
| `/taste remember <text>` | 手动记录（零 LLM，置信度 1.0） |
| `/taste forget <n\|关键词>` | 移除一条 |
| `/taste paths` | 全局/项目路径 + 残留锁提示 |
| `/taste model` | 当前 Learner 路由（M0 固定 inherit 主模型） |

## 安装（本机已就绪环境）

```bash
# 1. 拷贝进 DSH 的持久模块目录（与 dsh-vision-adam 同链路）
mkdir -p ~/.dsh/profiles/node_modules/@deepseek-ai
rm -rf ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-taste
cp -r /home/CNS2026495165/dsh/dsh-taste ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-taste

# 2. 在 ~/.dsh/profiles/web/cordis.patch.yml 的 insert 列表追加一行：
#    - id: taste
#      name: '@deepseek-ai/dsh-taste'

# 3. 重启 dsh（npx @deepseek-ai/dsh web），新会话输入 /taste status 验证
```

## 测试

```bash
cd /home/CNS2026495165/dsh/dsh-taste && node --test "test/*.test.js"
# 106/106 pass（storage/config/collector/queue/learner/learner-tools/index）
```

## 设计备注（复核裁定记录）

- **R5 判据偏差**：pi-taste 的 `meta.origin:"taste-learner"` 在 DSH 不可表达
  （dsh-session 拒绝一切非 "subagent" origin）；learner 身份以 origin="subagent" +
  parentSession + in-flight Set 三重表达，递归防护完整有效。
- `isSubagent` 第三判据对齐 dsh-subagent `delegationDepthOf`：`max(options.subagentDepth, header.delegationDepth) > 0`。
- 注入走 `systemPrompt.context()` 通道（内容变化才追加、compaction 后自动重注入），
  注入前 sanitize `{{` 防 interpolate 崩溃；均为专项单测钉死。
- 完整审计链见 `../pi-taste-analysis/`（方案 v2 + R0-R9 审计 + 终审 REVIEW.md）。

## 路线图

- **P1**：`/taste import`、move、custom 模型路由、abort 轮补扫、settings 界面
- **P2**：对话区活动卡片（taste/activity 事件 + slots 渲染）
