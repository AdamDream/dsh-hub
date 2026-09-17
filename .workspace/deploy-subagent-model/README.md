# deploy-subagent-model — subagent 默认模型 settings 层 + 设置页部署包

审计契约：`.workspace/subagent-model-gui-audit.md`（§2.3 读取层选点、§3 四件套、§5 P0'/P0）。
执行报告：`.workspace/subagent-model-settings-exec.md`。

## 内容

| 文件 | 说明 |
|---|---|
| `dsh-tool-subagent.p0.diff` | **核心包 P0' 补丁**（`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js` 相对基线 diff）：execute 在 `requestedAgentOptions` 合并前插入 settings 默认层 `effectiveConfiguredAgentOptions`（读 `dsh-subagent` 命名空间 provider/model，settings 优先、preset agentOptions 兜底；读失败/缺失降级静态路由不报错） |
| `dsh-tool-subagent.index.js.patched` | 补丁后完整文件（可直接覆盖部署位） |
| `package.json` | 新插件 `@local/dsh-subagent-model` 包元数据（含 `dsh.client` 声明：platform web，inject `dsh-client-runtime` + `dsh-client-ui-settings`） |
| `lib/index.js` | 新插件宿主侧：`settings.register`/`installSettingsSection` 注册 `dsh-subagent` 命名空间（provider/model 均可选，composition base = 现 preset 路由 adam/deepseek-v4.1-flash） |
| `lib/client.js` | 新插件浏览器侧 bundle：设置页「子代理模型」（settings.section，order 70，id `@local/dsh-subagent-model`）；provider/model 下拉取自 `llm-pi-ai` 命名空间（同一 settings 事实源，热），不可用时退化为文本输入；保存走 settingsScope `set/unset`（原子写 settings.yaml），清空回退默认 |
| `smoke-client.mjs` | 客户端 bundle 冒烟（ModuleLoader 注册形状 + apply 双命名空间绑定 + 设置页注册 + 默认态/目录态两次渲染断言） |
| `settings.example.yaml` | `dsh-subagent` 段示例 |
| `evidence/` | 端到端实测原始证据（子代理会话记录抽取、settings.describe 观测、settings.mutate 写读回环、prompt、测试实例日志） |

## 部署步骤（主代理执行，需重启 web 一次）

```bash
# 1) 备份
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p ~/.dsh/backups
cp ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js ~/.dsh/backups/dsh-tool-subagent.index.js.bak-$TS
cp ~/.dsh/profiles/web/cordis.patch.yml ~/.dsh/backups/cordis.patch.yml.bak-$TS

# 2) 核心包 P0' 补丁（冷面：需重启生效）
cp .workspace/deploy-subagent-model/dsh-tool-subagent.index.js.patched \
   ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js

# 3) 新插件 @local/dsh-subagent-model（host + client + dsh.client 声明）
DST=~/.dsh/profiles/node_modules/@local/dsh-subagent-model
mkdir -p "$DST/lib"
cp .workspace/deploy-subagent-model/package.json "$DST/package.json"
cp .workspace/deploy-subagent-model/lib/index.js "$DST/lib/index.js"
cp .workspace/deploy-subagent-model/lib/client.js "$DST/lib/client.js"

# 4) cordis.patch.yml insert（本档已追加；若被回滚则补回）
#    - insert: [{id: dsh-subagent-model, name: '@local/dsh-subagent-model'}]

# 5) 重启 dsh web 一次（冷面：宿主 lib 代码 + 新插件宿主装载 + 新 dsh.client pkgMeta）
```

> 注：本档已在 `~/.dsh/profiles/web/cordis.patch.yml` 末尾追加 insert，并已在
> `~/.dsh/profiles/node_modules/@local/dsh-subagent-model/` 落盘（含备份
> `~/.dsh/backups/` 与 `.workspace/backup-subagent-model-*`）。主代理如已部署，第 2-4 步可跳过，
> 仅需重启。

## 热载语义（部署重启之后）

- 改 `~/.dsh/settings.yaml` 的 `dsh-subagent:` 段（或设置页保存）→ **无需重启**，下一次
  subagent / subagent_fork 派发即用新值；段缺失/清空 → 回退 preset 默认 `adam/deepseek-v4.1-flash`。
- 合并层序：工具显式选择（S21 休眠，无）> settings `dsh-subagent` > preset 静态 agentOptions > 父路由继承。
- 非法值（provider/model 不存在）→ 每次派发经 `preflightChildLlmRoute`（`llm.resolveCallConfig`）实时校验并抛清晰错误，不静默。

## 回滚步骤

```bash
TS=<备份时间戳>
# 1) 还原核心包（若需）：
cp ~/.dsh/backups/dsh-tool-subagent.index.js.bak-$TS \
   ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js
# 2) 移除新插件：
rm -rf ~/.dsh/profiles/node_modules/@local/dsh-subagent-model
# 3) 还原 cordis.patch.yml（去掉 dsh-subagent-model insert）：
cp ~/.dsh/backups/cordis.patch.yml.bak-$TS ~/.dsh/profiles/web/cordis.patch.yml
# 4) 重启 web。settings.yaml 无 dsh-subagent 段 = 默认路由 = 现状，无需清理。
```

## 验证

```bash
node --check ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js
node --check ~/.dsh/profiles/node_modules/@local/dsh-subagent-model/lib/index.js
node --check ~/.dsh/profiles/node_modules/@local/dsh-subagent-model/lib/client.js
cd .workspace/deploy-subagent-model && node smoke-client.mjs
```

端到端（已实测，见 `evidence/` 与报告 §4）：第二实例 8091（新代码）→ 写 settings.yaml
`dsh-subagent: {provider: adam, model: glm-5.3}` → 不重启 → 派发 subagent → 子代理会话记录
`subagent/descriptor`/`request/header` 显示 `adam/glm-5.3` → 清空段 → 再派发 → 回退
`adam/deepseek-v4.1-flash`。
