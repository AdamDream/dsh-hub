# dsh-taste

DeepSeek Harness（DSH）的本地偏好学习（Taste）插件：每轮对话结束后由后台 Learner
代理从对话中学习你的持久偏好（编码风格、工具链、工作流、沟通方式），写入人类可读的
`taste.md`，并在后续轮次自动注入模型上下文。学习管线复刻 [pi-taste](https://github.com/LycanW/pi-taste)
（Command Code Taste 工作流），完全本地化，不训练模型权重。

## 工作原理

```
用户轮结束 → turn-stopping 钩子采集本轮可见文本（脱敏+限长）→ 单并发后台队列
  → Learner（inherit 主模型路由或 custom 指定模型，经 ctx.agents.create 受限 Agent）
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
| `/taste model` | 当前 Learner 路由 + observer 预算（inherit 主模型 / custom 指定模型） |

## Web GUI（只读查看面）

在 DSH Web 壳（http://127.0.0.1:3080）侧边栏底部有「偏好库 (taste)」图标按钮，
点击打开浮层面板（Esc / 面板外点击 / 关闭按钮收起，文案跟随壳语言 zh/en）。

- **分源 Tab**：全局 / 项目 / Command Code（会话无 cwd 或项目 scope 不存在时，项目 Tab 灰显）
- **分类折叠**：分类目录 → 文件 → 条目两级折叠（`style/taste.md` 归入 style 类，根文件在「根目录」）
- **置信度可视化**：每条目 0–100% 水平条（≥0.7 绿、0.4–0.7 黄、<0.4 灰）
- **状态条**：学习开关 · 注入（≤N 字符）· 队列（pending/运行态）· 熔断（冷却/就绪）· 学习模型路由
- **轮询语义**：面板打开期间每 10s 并行拉取 `getTree` + `getStatus`；关闭/卸载即停；
  刷新按钮可随时手动拉取。无 WebSocket/SSE 推送（官方转发事件是编译闭集），轮询是唯一实时性手段
- **错误/空态**：加载失败显示 `error.load` + 错误详情；整库为空显示引导文案；单源为空显示占位

安全边界：面板数据经 host 半只读 RPC 通道 `ctx.connection.rpc.handle("/taste", …, {authority:"loopback"})`
提供——仅 `getTree`/`getStatus` 两个端点，读取全部走 storage 白名单（`listTasteFiles`/`readTasteFile`
→ `resolveTastePath`），只返回解析后的 `{statement, confidence}` 与 mtime/count 元数据。无路径直通、
无原始文件内容、无任何写操作（`forget`/`remember`/`on|off` 仍只在 `/taste` 命令）；`loopback` 权威
使非本机来源在 web server 层即被 403。

装机：与下方安装步骤相同——`package.json` 现含 `exports`（`"."`/`"./client"`/`"./package.json"`）
与 `dsh.client` 声明，`lib/client.js` 为免构建手写 bundle，由 dsh-client-modules 在重启时自动发现
并注入浏览器（`/plugins/@deepseek-ai/dsh-taste/client.js`），重启 dsh 后刷新浏览器即可见。

## Custom 路由（专门学习模型）

默认 `observer.modelMode` 为 `inherit`：Learner 跟随触发会话的主模型路由，不写
`config.json` 的用户行为与 M0 完全一致。若想给 Learner 配一个专门的学习模型，把
`~/.dsh/taste/config.json` 的 observer 节配成 custom（完整 §8 形状示例见仓库根目录
`config.example.json`）：

```json
{
	"observer": {
		"modelMode": "custom",
		"provider": "adam",
		"model": "deepseek-v4-pro",
		"maxInputChars": 16000,
		"timeoutMs": 120000,
		"maxTurns": 20
	}
}
```

字段说明：

- `modelMode`：`inherit`（跟随主模型，默认）或 `custom`（用下面的 `provider`/`model`）；其他值归一为 `inherit`
- `provider` / `model`：custom 时 Learner 的路由目标（provider + model 与主模型同网关同凭据即可复用现有凭据）；两者都非空才生效，缺任一项则**回退 inherit 路由并打日志警告**
- custom 不跟随主模型切换：主会话换模型不影响 Learner 的固定路由
- Learner 失败仍走既有熔断（连续 3 次失败冷却 10 分钟，`/taste status` 可见），不影响主会话

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
# 122/122 pass（storage/config/collector/queue/learner/learner-tools/index/bridge/client）
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

- **P1**：`/taste import`、move、abort 轮补扫、settings 界面
- **P2**：对话区活动卡片（taste/activity 事件 + slots 渲染）
