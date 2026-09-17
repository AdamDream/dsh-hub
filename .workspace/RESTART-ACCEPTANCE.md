# 重启验收 Runbook（2026-09-17 批次）

一键重启 + 逐项验收本批次全部宿主改动。**所有命令可直接复制到终端执行**。

## 0. 本批次改了什么（为什么需要重启）

| 改动 | 冷/热 | 原因 |
|---|---|---|
| goal P0-A（pause 中止在飞轮）+ 方案 A（pending-subagent 防空转） | **冷** | 宿主 lib 代码（`dsh-goal-round-driver`） |
| btw 侧聊默认模型 → `deepseek-v4.1-flash` + legacy 映射 + `model.default/options` 热读 | **冷（首次）** | 宿主 lib 代码（`@local/dsh-btw`）；重启后改 `dsh-btw.model.default` 即热 |
| preset `standard-glm` 子代理模型 → `deepseek-v4.1-flash` | **冷** | 宿主启动装配面（preset 组合） |
| subagent 模型 settings 层 + 设置页 GUI | **冷（首次）** | 宿主 lib 代码 + `dsh.client` 声明变更 |
| vision 声明 `input: [text,image]`、vision-adam 换 adam 网关 | **已热生效** | settings 值级热载（已实测：贴图直传） |
| P0-b 行为开关（usage 5 / btw 4 键） | **已热生效** | settings 值级热载 |

## 1. 重启

```bash
npx @deepseek-ai/dsh web
# 预期：dsh web: http://127.0.0.1:3080 ，浏览器自动打开
```

## 2. 验收矩阵

### 2.1 子代理模型 = adam/deepseek-v4.1-flash

主会话里派一个后台 subagent（任意小任务），然后：

```bash
# 取最新子代理会话的 descriptor，核对 agentModel
S=$(ls -t ~/.dsh/sessions/--home-CNS2026495165-dsh--/*/session.jsonl.zstd | head -5 | xargs -I{} sh -c 'zstd -dc {} 2>/dev/null | head -1 | grep -q subagent/descriptor && echo {}' | head -1)
zstd -dc "$S" | head -3 | grep -o '"agentModel":"[^"]*"'
# 预期： "agentModel":"deepseek-v4.1-flash"
```

### 2.2 子代理模型热载（**本批次核心新增能力**）

重启后**不需要再重启**即可换子代理模型。写入 settings 段 → 派发 → 核对：

```bash
# 1) 写入覆写（临时改成 glm-5.3 做验证）
python3 - <<'PY'
p='/home/CNS2026495165/.dsh/settings.yaml'; s=open(p).read()
if 'dsh-subagent:' not in s:
    open(p,'w').write(s.rstrip()+'\ndsh-subagent:\n  provider: adam\n  model: glm-5.3\n'); print('已写入 dsh-subagent 覆写')
else: print('已存在 dsh-subagent 段，请手动改')
PY

# 2) 派发一个后台 subagent（任意小任务），3 秒后核对子代理实际模型
sleep 5
S=$(ls -t ~/.dsh/sessions/--home-CNS2026495165-dsh--/*/session.jsonl.zstd | head -5 | xargs -I{} sh -c 'zstd -dc {} 2>/dev/null | head -1 | grep -q subagent/descriptor && echo {}' | head -1)
zstd -dc "$S" | head -3 | grep -o '"agentModel":"[^"]*"'
# 预期： "agentModel":"glm-5.3"   ← 覆写生效且无需重启

# 3) 清空段 → 回退 preset 默认
python3 - <<'PY'
p='/home/CNS2026495165/.dsh/settings.yaml'
s=open(p).read()
i=s.find('dsh-subagent:')
if i>=0:
    j=s.find('\n', i+15)
    s=s[:i]+'dsh-subagent: {}\n'+s[j+1:] if j>0 else s[:i]
    open(p,'w').write(s); print('已清空 dsh-subagent 段')
PY
# 再派一个 subagent → 预期 agentModel 回到 deepseek-v4.1-flash
```

> GUI 等价路径：设置 →「子代理模型」→ 选 provider/model → 保存（原子写 settings.yaml）。

### 2.3 btw 侧聊默认模型热载

```bash
python3 - <<'PY'
p='/home/CNS2026495165/.dsh/settings.yaml'; s=open(p).read()
i=s.find('dsh-btw:')
print('dsh-btw 段存在' if i>=0 else '请在 dsh-btw 段下加 model: {default: deepseek-v4-pro}')
PY
# 把 dsh-btw.model.default 改成 deepseek-v4-pro → 新开一条侧聊，选择器应显示 v4-pro（无需重启）
# 清空该键 → 回退 deepseek-v4.1-flash
```

### 2.4 goal 不再在等 subagent 时空转注入

激活一个 goal → 派发后台 subagent → 观察等待期会话框：**不应**再出现「检查 subagent 进度」这类无意义 goal 轮；subagent settle + notice 被消费后恢复自动轮询。

判据（session 事件）：等待期不应出现新的 `goal/changed` → `goal_round` 注入。

### 2.5 btw 侧聊默认模型 = v4.1-flash（目视）

打开 btw 侧聊抽屉 → 模型选择器应显示 `deepseek-v4.1-flash`（默认），下拉应为 `v4.1-flash / glm-5.3 / deepseek-v4-pro`；旧会话（曾持久化 `deepseek-v4-flash`）打开后应正常工作、不白屏（已 legacy 映射）。

### 2.6 vision 原图直传（主会话）

主会话粘贴一张截图发送，然后：

```bash
S=$(ls -t ~/.dsh/sessions/--home-CNS2026495165-dsh--/*/session.jsonl.zstd | head -1)
zstd -dc "$S" | grep -o '"type":"image"' | tail -1
# 预期：出现 "type":"image"（说明图作为 image part 进请求，未走识图转文本）
ls -t ~/.dsh/attachments/v1/request-images/*/* | head -3
# 预期：有新的请求图文件
```

### 2.7 设置页与面板

- 设置 → 「vision-adam 识图设置」存在，model/baseURL 显示 `https://llmapi.roboscience.xyz/v1`
- 设置 → 「子代理模型」（本批次新增，若已落地）可读写 provider/model，保存后**无需重启**即对新 subagent 生效
- 侧栏「分布式节点」可展开；顶部「节点」命令面板可打开
- usage 三图（面积/柱状/热力图）+ tooltip 正常

### 2.8 行为开关热载抽样（无需重启）

```bash
# 关掉 usage tooltip → 悬停不应再出现 tooltip；改回 true 恢复
python3 - <<'PY'
import yaml,io
p='/home/CNS2026495165/.dsh/settings.yaml'
s=open(p).read()
if 'dsh-usage:' not in s:
    s+= "\ndsh-usage:\n  ui:\n    tooltip: false\n"
    open(p,'w').write(s); print('已写入 dsh-usage.ui.tooltip=false')
else: print('已存在 dsh-usage 段，请手动改 ui.tooltip')
PY
```

### 2.9 启动健康

```bash
curl -s http://127.0.0.1:3080/ >/dev/null && echo 'GUI 存活'
find ~/.npm-global/lib/node_modules/@deepseek-ai ~/.dsh/profiles/node_modules -name '*.rej' -o -name '*.orig' | head   # 预期：空
```

## 3. 回滚

| 项 | 回滚 |
|---|---|
| goal 双补丁 | `cp ~/.dsh/backups/goal-round-driver.index.js.*.bak <包>/lib/index.js`（或 `patch -R`） |
| btw 模型 | `cp -r /home/CNS2026495165/dsh/.workspace/backup-btw-20260917-170146/* ~/.dsh/profiles/node_modules/@local/dsh-btw/` |
| preset 模型 | `cp ~/.dsh/backups/agent.cordis.yml.preset-*.bak ~/.dsh/.agent-presets/standard-glm/agent.cordis.yml` |
| subagent 模型补丁 | `cp ~/.dsh/backups/dsh-tool-subagent.index.js.bak-*.bak <包>/lib/index.js` |
| settings（vision 声明/网关） | `cp ~/.dsh/backups/settings.yaml.mmt-*.bak ~/.dsh/settings.yaml` |

回滚任一宿主项后同样需要一次重启生效。
