# 迁移到 0.2.0-rc.2 完成

## rc.2 相对 rc.1 的改动（已核实）
- **发布**：`2026-09-29T09:56Z`（今天），且现已占据 **`latest` 与 `next`** 两个 dist-tag。
- **包集合无增删**：直接依赖 82 → 82，仅 **74 个依赖从 rc.1 升到 rc.2**。
- **CLI 结构一致**：`lib/` 仅 `bin.js` 与 3 个 `types/*.d.ts` 有差异（bundle 哈希换名 `plugin-DkYIj96-` → `plugin-BGnVfe_D`）。
- **与我们相关的特性**：新增「macOS/Windows 桌面端菜单栏管理 dsh 命令与插件」；「**macOS 和 Linux 从图形入口启动桌面端时加载登录 shell 环境**」（使工具路径/代理等用户环境配置可供会话使用）；模型选择器加搜索；插件安装引导精简。
- **⚠️ 破坏性项**：**pi-ai `0.85.1` → `0.87.1`，部分旧模型 ID 被移除**（release note 明示「已保存的选择可能需要重新选择」）。

### pi-ai 模型目录核对（本轮实测）
| 项 | 结果 |
|---|---|
| 候选 ID 数 | 0.85.1 有 277 → 0.87.1 有 **309**（净增） |
| **被移除**的 ID | `gemma-4-31b`、`glm-5v-turbo`、`google.gemma-3-27b-it`、`google.gemma-3-4b-it`、`kimi-k2-0711-preview`、`kimi-k2-0905-preview`、`kimi-k2-thinking`、`kimi-k2-thinking-turbo`、`kimi-k2-turbo-preview`、`mimo-v2.5-free`、`omen-alpha` |
| **我们配置的 15 个模型** | **15/15 全部仍在** ✅（含 `kimi-k3`、`glm-5.3`、`qwen3.8-max`、`deepseek-v4-pro` 等） |

⇒ 本部署**不受该破坏性变更影响**，无需重选模型。

## 迁移动作（5 项）
1. **安装 rc.2 到独立前缀** `prefix-cli-rc2/`（541 包 / 518M / 288 个 `@deepseek-ai`），**rc.1 前缀保留作回退**。
2. **重打 N2 宿主补丁**：`dsh-tool-subagent` 在 rc.2 与 rc.1 **逐字节相同**（sha `26a1e804…`），锚点俱在 ⇒ 补丁原样重打，662 → **691** 行。
3. **profile 农场切到 rc.2**：`@deepseek-ai` 288 个符号链接全部重指 rc.2 树（+3 个本地插件 = 291）。
4. **豁免文件升版**：`compatibility.json` 的 6 条豁免由 `["0.2.0-rc.1"]` 改为 `["0.2.0-rc.2"]`
   （原因：豁免值与运行时版本做 `includes` 精确比对，不更新则 10 个条目会被 peer 闸门静默禁用）。
5. **`profile package.json`** 的 `@deepseek-ai/dsh` 升至 `0.2.0-rc.2`。

## 验收（生产形态：**已去掉 `unshare -rn`**，浏览器可达）
| 判据 | 结果 |
|---|---|
| 版本 | **`0.2.0-rc.2`** |
| `--dump-config` | rc=0 / **200** 条目 |
| peer 闸门禁用 | **0** |
| 未激活插件 | **0** |
| **插件 import** | **13/13 成功**（rc.2 解析树下逐包实测） |
| HTTP 实测 | 带 token **303**（鉴权通过）/ 无 token **401** |
| WE | **0.2.2** |
| N2 补丁 | **691** 行（官方 662） |
| 停栈 | 端口 FREE |
| 现役未污染 | patch `513413e7…` / settings `0f19b0fe…` 与开工逐位一致；3080/3097 在线 |

## 启动命令（生产）

```bash
R=/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020
bash "$R/boot-web.sh" 3098
```
`boot-web.sh` 已改为生产形态（去掉 netns 隔离，保留 `env -i` 清空凭据 + `DSH_TELEMETRY_MODE=DISABLED`）。
内部 CLI 路径已指向 `prefix-cli-rc2`。

## 备份与回退
- rc.1 前缀完整保留：`prefix-cli/`（可随时切回）
- 原件备份：`planA-backup/`（含 rc.2 官方 `dsh-tool-subagent` 原件、`compatibility.json.rc1`）
- 回退方式：把 `boot-web.sh` 的 CLI 路径改回 `prefix-cli`，并把 `compatibility.json` 的值改回 `0.2.0-rc.1`

---

## 补充验收：真实 UI 已可服务（HTTP 层）
| 判据 | 结果 |
|---|---|
| `curl -L ?token=…` | **HTTP 200 / 37 326 bytes** |
| cookie 换取后再次访问 | **HTTP 200**（鉴权持久） |
| 无 token | **HTTP 401** |
| 页面内容 | `<!doctype html>` + `window.__ModuleLoader__`（真实 SPA 引导，非错误页） |
| 停栈 | 端口 FREE |

⇒ rc.2 实例**在 HTTP 层完整可用**。浏览器内的交互行为（各插件 UI 面板、会话看板渲染、识图工具、btw 侧聊）仍需人工目视确认。
