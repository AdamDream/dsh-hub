# adam 网关渠道故障诊断（2026-09-21）

## 结论

**错误 100% 产生于网关侧（new-api 渠道选择层），客户端（DSH 配置 / API key / 模型名）全部正常。**
且故障**正在恶化**：渠道在诊断期间被逐个禁用，已从 deepseek 一族蔓延到 claude / gemini 部分渠道。
建议尽快联系网关管理员（证据 request id 见下）。

## 故障时间线（UTC）

| 时间 | 事件 |
|---|---|
| 02:35 | 用户报错：deepseek-v4-flash `get_channel_failed`（request id `…9d6sCHf7QVH`） |
| 02:44 | 首轮探测：v4-flash / v4.1-flash / v4-flash-vision-exp 三款断；**v4-pro / glm-5.3 正常** |
| 02:44–02:47 | 三款失败模型各 3/3 稳定复现，非抖动 |
| 02:49 | `analyze_image`（vision-adam→v4.1-flash）端到端确认断 |
| 02:55 | **v4-pro 也断了**（10 分钟前还正常出内容）；claude-sonnet-5 / claude-opus-4-8 / gemini-3.6-flash 同样 `get_channel_failed` |

## 实测矩阵（raw curl，绕过 DSH）

### 文本请求

| 模型 | 02:44 | 02:55 |
|---|---|---|
| deepseek-v4-flash | ❌ ×3 | —（已判死） |
| deepseek-v4.1-flash | ❌ ×3 | — |
| deepseek-v4-flash-vision-exp | ❌ ×3 | — |
| deepseek-v4-pro | ✅ `"pong"` | ❌ get_channel_failed |
| glm-5.3 | ✅ | ✅ |
| gpt-6-astra | ✅ | ✅ `"pong"` |

### 真实图片请求（data:image/png base64，64×64 纯蓝图，问"什么颜色"）

| 模型 | 02:57 | 说明 |
|---|---|---|
| deepseek-v4-pro | ❌ get_channel_failed | |
| claude-sonnet-5 | ❌ get_channel_failed | |
| claude-opus-4-8 | ❌ get_channel_failed | |
| gemini-3.6-flash | ❌ get_channel_failed | |
| **gemini-3.5-flash** | ✅ 回答 `Blue` | 存活且可识图 |
| **gpt-6-astra** | ✅ 回答 `Blue` | 存活且可识图 |

证据 request id（样本）：
- v4-flash `202609210244457853379848268d9d6yPh80nj9`、v4.1-flash `20260921024449974932488268d9d6l4hAL2T3`、vision-exp `202609210244498847707458268d9d6dgzCVmNi`
- v4.1-flash（analyze_image）`202609210249282470478438268d9d6lhTNgXFb`
- v4-pro（02:55 复测）`202609210255043067098578268d9d60mdtGc0S`

## 机制（完整因果链）

new-api 收到请求后的处理链：

1. 令牌校验 → **通过**（否则 401，而实际是 500）
2. 按令牌分组（`auto`，即在用户可达分组中加权选路）在「渠道能力表」中
   查找服务该模型的**启用状态**渠道
3. 无可用渠道 → 多轮重试仍无 → `500 {"code":"get_channel_failed","message":"分组 auto 下模型 X 的可用渠道不存在（retry）"}`

关键推断：glm-5.3 / gpt-6-astra / gemini-3.5-flash 有可用渠道且正常出内容，说明**网关进程、
令牌、部分上游链路存活**；故障是**渠道级、渐进式、跨模型族**的丢失。最可能成因（按概率）：

1. 上游连续失败触发 new-api **自动禁用**（auto-ban）级联——与"渠道在十分钟内逐个死掉"的时间形态吻合
2. 管理员正在批量删除/重建/改组渠道
3. 多个渠道共用同一上游账号，上游账号级故障（欠费/限流/封禁）连带全部渠道被禁

区分需管理员控制台，客户端无法观测。

## 影响面与处置（当前部署）

| 路由 | 模型 | 状态 | 处置 |
|---|---|---|---|
| 主会话默认 | gpt-6-astra | ✅ | 用户已于诊断期间在 GUI 自行切换，实测健康 |
| 子代理（dsh-subagent） | gpt-6-astra | ✅ | 不受影响 |
| vision-adam 识图 | deepseek-v4.1-flash | ❌ | 曾临时切 v4-pro（获批），因渠道随后被禁，按用户裁决**已回退 v4.1-flash 等网关修复**；期间识图/图片输入不可用 |
| btw 侧聊默认 | deepseek-v4.1-flash | ❌ | 抽屉内可手动切 gpt-6-astra / glm-5.3 / gemini-3.5-flash |
| web 搜索 | opencode 中转 | ✅ | 不走 adam 网关，不受影响 |

## 修复路径（需网关管理员）

new-api 控制台：

1. **先看日志页**：确认是否 auto-ban（渠道禁用事件）及其触发原因（上游报错内容）
2. 渠道页按状态筛选「已禁用」：对 deepseek-v4-flash / v4.1-flash / v4-flash-vision-exp /
   v4-pro / claude-sonnet-5 / claude-opus-4-8 / gemini-3.6-flash 逐个「测试」，上游恢复后重新启用
3. 检查多个渠道是否共用同一上游账号（账号级故障会连带禁用）
4. 检查渠道分组是否覆盖 auto 可达分组
5. 修复后用下方复查命令验证四款 deepseek 全绿

## 复查 Runbook（可直接复制）

```bash
KEY=$(python3 -c "import re;print(re.search(r'ADAM_API_KEY[:\\s\"\']*([A-Za-z0-9_\-\.]{10,})',open('/home/CNS2026495165/.dsh/.credentials.yaml').read()).group(1))")
for m in deepseek-v4-flash deepseek-v4.1-flash deepseek-v4-flash-vision-exp deepseek-v4-pro glm-5.3 gpt-6-astra gemini-3.5-flash; do
  printf '%-28s ' "$m"
  curl -sS --max-time 30 https://llmapi.roboscience.xyz/v1/chat/completions \
    -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d "{\"model\":\"$m\",\"max_tokens\":8,\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}" \
    | python3 -c "import json,sys; r=json.load(sys.stdin); e=r.get('error'); print('OK' if not e else e.get('code'))"
done
# 预期（修复后）：deepseek 四款全 OK；其余三款保持 OK
```
