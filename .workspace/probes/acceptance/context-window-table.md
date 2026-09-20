# adam provider 46 条缺 `contextWindow` 条目 —— 逐条目取值决策表

> 产出档：acceptance-probe 取值表档（**只读**，仅写本报告）。生成时间：2026-09-17。
> 本报告**未修改** `~/.dsh/settings.yaml`，未重启，未 install，未发起除 `/v1/models` 外的任何网关调用。

---

## 0-A. ⚠️ 取证期间 `settings.yaml` 被**其它进程**改动（必须知悉）

本档取证期间发现 `~/.dsh/settings.yaml` **被本档之外的进程写入过**（mtime `2026-09-17 18:06:44`，晚于最新备份 `18:04:06`）。同机另有一个正在运行的加压探测进程（`ps` 实测）：

```
3484987 四 9月 17 18:05:23 2026 bash -c cd /home/CNS2026495165/dsh && bash .workspace/acceptance-probe/probe-context-window.sh 2>&1
3486104 四 9月 17 18:05:47 2026 curl ... https://llmapi.roboscience.xyz/v1/chat/completions
```

**本档未做任何写入**（仅 `read` + 只读 shell）。与最新备份 `settings.yaml.acceptance-20260917-180406.bak` 相比，**当前盘面有 3 处外部改动**：

```bash
$ diff ~/.dsh/backups/settings.yaml.acceptance-20260917-180406.bak ~/.dsh/settings.yaml
76c76
<       baseURL: https://llmapi.roboscience.xyz/v1/
---
>       baseURL: https://llmapi.roboscience.xyz/v1
134a135
>           contextWindow: 1000000          # ← deepseek-v4.1-flash 被补值
144c145
<   model: deepseek-v4.1-flash
---
>   model: deepseek-v4-flash            # ← agent-default-model.model 被改
```

**对本次任务的影响 —— 一条需要主代理留意的旁证**：
`agent-default-model.model` 现值 **`deepseek-v4-flash`**（备份期是 `deepseek-v4.1-flash`）。而 `deepseek-v4-flash` **正是 adam 里原本就声明了 `contextWindow: 1000000` 的条目** —— 即该改动本身**已经绕开了本次故障模型**（默认模型从"缺声明"的那个换成了"有声明"的那个）。`vision-adam.model` 仍为 `deepseek-v4.1-flash`（第 147 行），**仍带 `contextWindow: 1000000`**。

**主表行号口径**：因该改动在 `134` 行后插入 1 行，**`134` 行之后的条目行号相对第 1 节主表所依据读取的版本整体 +1**（例如 `deepseek-v4-flash-vision-exp` 从 L139 → **L140**）。**id 顺序与缺失判定未变**（复核命令与结果见 §1 末尾）。

---

## 0. 前置校正：当前实际缺值是 **45** 条，不是 46 条

任务书写"50 个模型条目中 46 个没有声明 `contextWindow`"。实测**当前盘面是 45 条**：

```bash
$ python3 -c "..."  # 解析 ~/.dsh/settings.yaml adam 块
adam entries: 50
missing contextWindow: 45
declared: [('deepseek-v4-flash', 78), ('glm-5.3', 89), ('glm-5.3-flash', 92), ('gpt-6-astra', 112), ('deepseek-v4.1-flash', 134)]
```

差异来源已取证：**`deepseek-v4.1-flash` 是"46 → 45"的那一条**，它在最近一次改动中**刚被补上** `contextWindow: 1000000`。

```bash
$ grep -n "deepseek-v4.1-flash" ~/.dsh/backups/settings.yaml.acceptance-20260917-180406.bak   # 18:04:06 快照
134:        - id: deepseek-v4.1-flash
$ sed -n '134,138p' ~/.dsh/backups/settings.yaml.acceptance-20260917-180406.bak
        - id: deepseek-v4.1-flash
          input:
            - text
            - image
# ↑ 备份里无 contextWindow
$ sed -n '134,138p' ~/.dsh/settings.yaml        # 现值
        - id: deepseek-v4.1-flash
          contextWindow: 1000000
          input:
            - text
            - image
# ↑ 现值已声明 1000000
```

**结论**：本次需补的是 **45 条**。已声明的 5 条（`deepseek-v4-flash: 1000000`、`glm-5.3: 1000000`、`glm-5.3-flash: 1000000`、`gpt-6-astra: 1000000`、`deepseek-v4.1-flash: 1000000`）**不在交付范围内**，本表不覆盖。

---

## 1. 主表（45 行，按 settings.yaml 文件顺序）

**本表在报告收尾时已对**当前盘面（`sha256=547e3c595c8ac3963c6a5d9d71d3703bd9ecd9918418c05eeaccb147766dc0ee`，mtime `18:06:44`）**重新复核，结果与下表完全一致**：

```bash
$ python3 -c "..."   # 重新解析当前 settings.yaml
adam entries: 50 | missing: 45
declared: ['deepseek-v4-flash', 'glm-5.3', 'glm-5.3-flash', 'gpt-6-astra', 'deepseek-v4.1-flash']
missing list: ['deepseek-v4-pro', 'glm-5.1', ..., 'deepseek-v4-flash-vision-exp']   # 与下表 45 行逐项一致
```

列含义：
- **值** = 建议写入的 `contextWindow` 整数。
- **等级**：`E1` = 同 provider（adam）已声明 或 同文件 `opencode-go` 块同名条目；`E2` = **非本仓库的厂商/第三方规格证据**（细分 `E2-cat` = 随本部署安装的 pi-ai 内置模型目录 `@earendil-works/pi-ai/dist/providers/data/*.json`，`E2-com` = 厂商公开规格常识）；`E3` = 无证据，**按用户裁决兜底 1000000，非实测**；`N/A` = 非对话模型，不适用。
- **置信度**：两位小数，主观刻度（E1≈0.9-1.0 / E2-cat 0.8-0.9 / E2-com 0.55-0.7 / E3 0.3-0.4）。

| # | model id | 建议值 | 等级 | 证据原文 / 来源 | 置信度 |
|---|----------|-------:|:----:|-----------------|:------:|
| 1 | `deepseek-v4-pro` | 1000000 | E1 | `settings.yaml:25-28` opencode-go 同名条目 `contextWindow: 1000000`；旁证 pi-ai `deepseek.json` `"deepseek-v4-pro":{...,"contextWindow":1000000}` | 1.00 |
| 2 | `glm-5.1` | 202752 | E1 | `settings.yaml:29-32` opencode-go `glm-5.1` → `contextWindow: 202752`；旁证 `opencode-go.json` 同名 202752 | 0.95 |
| 3 | `glm-5.2` | 1000000 | E1 | `settings.yaml:33-36` opencode-go `glm-5.2` → `1000000`；旁证 6 个目录同名均 1000000 | 1.00 |
| 4 | `glm-4.7` | 1000000 | E2-cat | pi-ai `zai.json`/`zai-coding-cn.json` `glm-4.7 cw=204800`；adam 已声明同族 `glm-5.3/5.3-flash=1000000`。**注意：204800 是唯一厂商目录证据，1000000 来自同 provider 同族外推** | 0.60 |
| 5 | `glm-5` | 1000000 | E2-cat | pi-ai `opencode.json` `glm-5 cw=204800`、`qwen-token-plan.json` `202752`。同上：**外推至 1000000，非该 id 的直接证据** | 0.60 |
| 6 | `kimi-k3` | 1048576 | E1 | `settings.yaml:49-52` opencode-go `kimi-k3` → `1048576`；旁证 `moonshotai.json`/`moonshotai-cn.json` 同名 1048576 | 1.00 |
| 7 | `qwen3.7-max` | 1000000 | E1 | `settings.yaml:13-16` opencode-go `qwen3.7-max` → `1000000` | 1.00 |
| 8 | `qwen3.7-plus` | 1000000 | E1 | `settings.yaml:17-20` opencode-go `qwen3.7-plus` → `1000000` | 1.00 |
| 9 | `qwen3.8-flash` | 1000000 | **E3** | 全库无该 id（`grep -rl "qwen3.8-flash" .../providers/data/` 空）。**按裁决兜底 1000000，非实测**（目录只有 `qwen3.8-max-preview cw=1000000`） | 0.35 |
| 10 | `qwen3.8-max` | 1000000 | **E3** | 全库无该 id。**按裁决兜底 1000000，非实测**（近邻 `qwen3.8-max-preview` 目录值 1000000，但非同名） | 0.40 |
| 11 | `claude-haiku-4-5-20251001` | 1000000 | E2-cat | pi-ai `anthropic.json` **同名精确命中** `claude-haiku-4-5-20251001 cw=200000 max=64000`。**但本表取 1000000**（见下方"E2 说明 §A"冲突处理） | 0.70 |
| 12 | `claude-opus-4-5-20251101` | 1000000 | E2-cat | `anthropic.json` **同名精确命中** `claude-opus-4-5-20251101 cw=200000 max=64000`。同上按 1000000 取值 | 0.70 |
| 13 | `claude-opus-4-6` | 1000000 | E2-cat | `anthropic.json` 同名 `claude-opus-4-6 cw=1000000 max=128000`（cloudflare/opencode/github-copilot 一致） | 0.90 |
| 14 | `claude-opus-4-7` | 1000000 | E2-cat | `anthropic.json` 同名 `claude-opus-4-7 cw=1000000 max=128000` | 0.90 |
| 15 | `claude-opus-4-8` | 1000000 | E2-cat | `anthropic.json` 同名 `claude-opus-4-8 cw=1000000 max=128000` | 0.90 |
| 16 | `claude-opus-5` | 1000000 | E2-cat | `anthropic.json` 同名 `claude-opus-5 cw=1000000 max=128000` | 0.90 |
| 17 | `claude-sonnet-4-5-20250929` | 1000000 | E2-cat | `anthropic.json` **同名精确命中** `claude-sonnet-4-5-20250929 cw=1000000 max=64000`（注意 bedrock 同族显示 200000，见 §A） | 0.80 |
| 18 | `claude-sonnet-4-6` | 1000000 | E2-cat | `anthropic.json` 同名 `claude-sonnet-4-6 cw=1000000 max=128000` | 0.90 |
| 19 | `claude-sonnet-5` | 1000000 | E2-cat | `anthropic.json` 同名 `claude-sonnet-5 cw=1000000 max=128000` | 0.90 |
| 20 | `gpt-5.4` | 1000000 | E2-cat（**冲突**） | `openai.json`/`openai-codex.json` `gpt-5.4 cw=272000`；`azure-openai-responses.json` **1050000**；`github-copilot.json` **1000000**。取中间档 1000000，**该模型厂商目录自相矛盾** | 0.55 |
| 21 | `gpt-5.4-mini` | 1000000 | E2-cat（**冲突**） | `openai.json` `gpt-5.4-mini cw=400000`。取 1000000 系上浮，**非该 id 的直接证据** | 0.55 |
| 22 | `gpt-5.4-openai-compact` | 1000000 | **E3** | 全库无 `compact` 任何条目（`grep -rl "openai-compact"` 空）。**按裁决兜底 1000000，非实测** | 0.30 |
| 23 | `gpt-5.5-openai-compact` | 1000000 | **E3** | 同上，无 `compact` 条目。**按裁决兜底 1000000，非实测** | 0.30 |
| 24 | `gpt-5.6-sol` | 1000000 | E2-cat（**冲突**） | `openai.json`/`openai-codex.json` `gpt-5.6-sol cw=272000`；`azure`/`cloudflare`/`github-copilot`/`opencode` **1050000**。取 1000000 | 0.55 |
| 25 | `gpt-5.6-terra` | 1000000 | E2-cat（**冲突**） | 同上：272000（openai/openai-codex）vs 1050000（azure/cloudflare/github-copilot/opencode） | 0.55 |
| 26 | `gpt-5.5` | 1000000 | E2-cat（**冲突**） | `openai.json`/`openai-codex.json` `gpt-5.5 cw=272000`；`azure`/`cloudflare`/`github-copilot`/`opencode` **1050000** | 0.55 |
| 27 | `gpt-5.6-luna` | 1000000 | E2-cat（**冲突**） | 同上：272000 vs 1050000 | 0.55 |
| 28 | `gemini-3.1-flash-image-preview` | 1048576 | **N/A** | 见 §2"不适用"节 —— 图像生成模型；下游结论：建议**不填**或与 `gemini-3.1-flash-lite` 同值（1048576） | 0.40 |
| 29 | `gemini-3.1-flash-image-preview-2k` | — | **N/A** | 同上（`-2k` 为分辨率档，全库无该 id） | — |
| 30 | `gemini-3.1-flash-image-preview-4k` | — | **N/A** | 同上（`-4k` 分辨率档，全库无该 id） | — |
| 31 | `gemini-3.1-flash-lite` | 1048576 | E2-cat | `google.json`/`google-vertex.json` **同名** `gemini-3.1-flash-lite cw=1048576 max=65536` | 0.90 |
| 32 | `gemini-3.1-pro-preview` | 1048576 | E2-cat | `google.json`/`google-vertex.json` **同名** `gemini-3.1-pro-preview cw=1048576` | 0.90 |
| 33 | `gemini-3.5-flash` | 1048576 | E2-cat | `google.json`/`google-vertex.json`/`opencode.json` 同名 1048576（`github-copilot.json` 例外 200000） | 0.85 |
| 34 | `gemini-3.5-flash-lite` | 1048576 | E2-cat | `google.json`/`google-vertex.json`/`opencode.json` 同名 1048576 | 0.90 |
| 35 | `gemini-3.6-flash` | 1048576 | E2-cat | `google.json`/`google-vertex.json`/`opencode.json` 同名 1048576 | 0.90 |
| 36 | `gemini-3-flash-preview` | 1048576 | E2-cat | `google.json`/`google-vertex.json`/`opencode.json` 同名 1048576 | 0.90 |
| 37 | `gemini-3-pro-image-preview` | 1048576 | E2-cat | 该 id 目录无命中，但同族 `gemini-3.1-pro-preview`=1048576、`gemini-3-pro-preview`=1048576；**图像预览档，取值属外推** | 0.55 |
| 38 | `gemini-3-pro-image-preview-2k` | 1048576 | E2-cat | 同上（分辨率档，全库无该 id），**外推** | 0.50 |
| 39 | `gemini-3-pro-image-preview-4k` | 1048576 | E2-cat | 同上（分辨率档，全库无该 id），**外推** | 0.50 |
| 40 | `gemini-3-flash` | 1048576 | E2-cat | `google.json`/`google-vertex.json`/`opencode.json` 同名 1048576 | 0.90 |
| 41 | `kimi-k2.7-code` | 262144 | E1 | `settings.yaml:45-48` opencode-go `kimi-k2.7-code` → `262144`；旁证 6 目录一致 (`github-copilot.json` 例外 256000) | 0.95 |
| 42 | `kimi-k2.7-code-highspeed` | 262144 | E2-cat | `moonshotai.json`/`moonshotai-cn.json` **同名精确命中** `kimi-k2.7-code-highspeed cw=262144` | 0.85 |
| 43 | `veo3.1-fast` | — | **N/A** | 见 §2"不适用"节 —— 视频生成模型 | — |
| 44 | `veo3.1-pro` | — | **N/A** | 见 §2"不适用"节 —— 视频生成模型 | — |
| 45 | `deepseek-v4-flash-vision-exp` | 1000000 | **E3** | 全库无 `vision-exp`。旁证仅同族 `deepseek-v4-flash`（adam 已声明 `1000000`）。**该 id 本身无任何证据，按裁决兜底 1000000，非实测** | 0.40 |

---

## 2. E2 / E3 分组说明（诚实红线：常识 ≠ 实测）

### §A. E2-cat（pi-ai 内置模型目录）—— 是"本机安装的第三方规格数据"，**不是本仓库/网关实测**

**证据性质声明**：`E2-cat` 值的来源是随本部署安装的 npm 包 `@earendil-works/pi-ai@*/dist/providers/data/*.json`（`@deepseek-ai/dsh-llm-pi-ai` 的依赖）。这是**厂商/上游规格数据打包**，**不是** gate 端点的实测、也不是 `settings.yaml` 的声明。**凡 E2-cat 值均不得称为"实测"或"仓库证据"。**

```bash
$ ls /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@earendil-works/pi-ai/dist/providers/data/ | wc -l
37
$ python3 -c "import json;d=json.load(open('.../anthropic.json'));print(d['anthropic-messages']['claude-haiku-4-5-20251001'])"
```

**为什么 E2-cat 不能升格为 E1**：pi-ai 的解析优先级是 `entry.contextWindow ?? base?.contextWindow ?? request.defaultContextWindow`，`base` 来自**被请求 provider 自己的**目录键。`adam` 是手写 provider（`settings.yaml:73-76` 的 `api: openai-completions` + 自建 `baseURL`），**不在 pi-ai 的 provider 目录里**（`grep -rl "adam" providers/data/` 无命中），所以 `base` 恒为 `undefined` —— 目录值**永远不会**成为 adam 的解析来源。因此 E2-cat 只是"该模型家族在别处的规格"，不是"adam 上的真值"。

**冲突处理（重要，请主代理裁定）**：本表对 **Claude Haiku 4.5 / Opus 4.5 / Sonnet 4.5** 采用了 **1000000**，而其目录同名条目是 **200000**：

| id | 目录同名证据 | 本表取值 | 理由 |
|---|---|---|---|
| `claude-haiku-4-5-20251001` | 200000（`anthropic.json`） | 1000000 | 用户裁决"确证不了的按 1000000"；且该网关为第三方聚合，常开路由级长上下文 |
| `claude-opus-4-5-20251101` | 200000 | 1000000 | 同上 |
| `claude-sonnet-4-5-20250929` | 1000000（`anthropic.json`）/ 200000（bedrock 同族） | 1000000 | 已与目录一致 |

**这是本表最大的取值主观点**：Haiku 4.5 / Opus 4.5 取 1000000 属**上浮**，若该网关忠实转发 200k 窗口，这两条会进入"声明高于真实"的高风险区（§3）。若主代理偏好保守，可改为 200000。

**GPT 系 5 条的目录自相矛盾**：`gpt-5.4 / 5.4-mini / 5.5 / 5.6-sol / 5.6-terra / 5.6-luna` 在 `openai.json`、`openai-codex.json` 是 **272000/400000**，在 `azure-openai-responses.json`、`cloudflare-ai-gateway.json`、`github-copilot.json`、`opencode.json` 是 **1050000/1000000**。本表统一取 1000000（裁决兜底档）。**这 6 条是 E2 里置信度最低的一批（0.55）**。

### §B. E2-com（厂商公开规格常识）—— 本表实际**未使用**该等级

按用户定义，`E2-com` 应覆盖"如 Claude 系 200k、Gemini 系 1M/2M 档"这类**厂商公开常识**。实测中，所有本可用常识覆盖的条目都**恰好**在 pi-ai 目录里有同名或近邻条目（Anthropic 9 条、Gemini 9 条），因此本表把它们的证据等级记为 **`E2-cat`（有具体可引用的本机数据）而非 `E2-com`（凭常识）**。
**但请主代理注意**：对第三方聚合网关（`llmapi.roboscience.xyz`）而言，`E2-cat` 的证据力**并不显著强于** `E2-com` —— 两者都是"该模型别处的规格"，都不是该网关的实测。**二者在"声明值是否等于网关真实窗口"这一关键问题上等价地不可靠。**

### §C. E3（按裁决兜底，非实测）—— 主表 **5** 条 + 数值外推 **3** 条

**严格 E3（完全无证据档：全仓库 + 全 pi-ai 目录都查不到该 id 或其近邻）—— 5 条：**

```bash
$ for t in "qwen3.8-flash" "glm-5.3" "gpt-6" "openai-compact" "vision-exp"; do
    printf "%-16s: " "$t"; grep -rl "$t" .../providers/data/ | tr '\n' ' '; echo; done
qwen3.8-flash   :
glm-5.3         :
gpt-6           :
openai-compact  :
vision-exp      :
```

| # | id | 值 | 兜底理由 |
|---|----|---:|---------|
| 9 | `qwen3.8-flash` | 1000000 | 无该 id；近邻 `qwen3.8-max-preview`=1000000（非同名） |
| 10 | `qwen3.8-max` | 1000000 | 无该 id；近邻同上 |
| 22 | `gpt-5.4-openai-compact` | 1000000 | 无任何 `compact` 条目 |
| 23 | `gpt-5.5-openai-compact` | 1000000 | 无任何 `compact` 条目 |
| 45 | `deepseek-v4-flash-vision-exp` | 1000000 | 无该 id；同族 `deepseek-v4-flash`=1000000 |

**数值外推（主表标为 E2-cat，但"证据值 ≠ 取值"，主代理若要求严格按证据须下调）—— 3 条：**

| # | id | 本表值 | 目录证据值 | 说明 |
|---|----|-------:|-----------:|------|
| 4 | `glm-4.7` | 1000000 | **204800** | `zai.json` / `zai-coding-cn.json` 同名精确命中。取值来自 adam 同族 `glm-5.3/5.3-flash`=1000000 外推 |
| 5 | `glm-5` | 1000000 | **204800**（`opencode.json`）/ 202752（`qwen-token-plan*.json`） | 同上外推 |
| 21 | `gpt-5.4-mini` | 1000000 | **400000**（`openai.json`） | 上浮外推 |

> **诚实声明**：上表 5 条**全部**标注为 **"按裁决兜底 1000000，非实测"** —— 它们**没有**任何一条有本仓库或网关侧证据支持。
> 下面 3 条更准确地说是"**目录证据存在但与取值不符**"，若主代理要求"按证据值"，应分别改为 **204800 / 204800 / 400000**；本表按用户裁决（确证不了按 1000000）取上浮值，并把它们同时列入 §5.2 高风险清单。

**主表等级统计（已用脚本逐行复核 45 行）：`E1 = 7` / `E2-cat = 28` / `E3 = 5` / `N/A = 5`，合计 **45**。可用条目（E1+E2+E3）= **40**。**


---

## 3. 不适用 / 无法判定（单列，不硬填）

**5 条非对话生成模型**，其"上下文窗口"语义与对话模型的窗口不同（它们接受 prompt 但输出图像/视频，"窗口"不驱动 agent 上下文压力判定）：

| id | 类型判断依据 | 建议 |
|----|-------------|------|
| `gemini-3.1-flash-image-preview` | 名称含 `image`；pi-ai 目录无此 id，仅有 `gemini-3.1-flash-lite-image cw=65536`（图像变体显著低于文本变体 1048576）—— 说明**图像变体的窗口可能是 65536 而非 1048576** | **无法判定**：建议填 1048576（保守上限）或直接留空；**两侧都可能错** |
| `gemini-3.1-flash-image-preview-2k` | 同上 + `-2k` 为分辨率档 | **不适用** |
| `gemini-3.1-flash-image-preview-4k` | 同上 + `-4k` 为分辨率档 | **不适用** |
| `veo3.1-fast` | Veo = Google 视频生成模型；pi-ai 全库 `grep -i veo` 无任何命中 | **不适用**（视频模型，无对话窗口语义） |
| `veo3.1-pro` | 同上 | **不适用** |

> `gemini-3-pro-image-preview` / `-2k` / `-4k` 本表按 1048576 填了（与文本同族一致），但它们同属"图像预览"档，**同样存在上面 `flash-image-preview` 的歧义**（文本 1048576 vs 图像 65536）。若主代理偏好严格，这 3 条也应移入本"无法判定"节。
>
> 另：`gemini-3.1-flash-image-preview*` 与 `veo3.1-*` 共 5 条**不在网关 `/v1/models` 的 40 条列表里**（见 §4），说明它们可能是**未真正上架/透传验证过的条目**，进一步支持"不适用"判断。

---

## 4. 网关元数据取证（一次 `/v1/models`，只读）

**实时拉取（唯一一次网关调用）：**

```bash
$ curl -sS -m 25 -w '\n[HTTP %{http_code}]\n' https://llmapi.roboscience.xyz/v1/models
{"error":{"code":"","message":"Invalid token (request id: 202609171004271576770768268d9d6JRRcK0wh)","type":"new_api_error"}}
[HTTP 401]
```

**结论一（关键）**：实时 `/v1/models` **需要鉴权**。本档为只读档、且 `ADAM_API_KEY` 不在本进程环境（`env | grep -o '^ADAM_API_KEY'` 返回空，exit 1），**未从 `.credentials.yaml` 提取密钥**（避免越权）。因此**实时响应无法取得**。

**结论二（同样关键，且有缓存实证）**：该端点**即使成功也不暴露上下文窗口字段**。工作区内已有一份 40 条的成功响应缓存（前序档产出）：

```bash
$ python3 -c "import json;d=json.load(open('.workspace/models_fresh.json'));print('count',len(d['data']));... "
count 40
union keys: ['created', 'id', 'object', 'owned_by', 'supported_endpoint_types']
# 逐条 extras：全部为 {} —— 无 context_length / max_context / context_window
```

**逐字段核验**：40 条模型的字段并集**只有** `created / id / object / owned_by / supported_endpoint_types`，**没有任何 `context_length`、`max_context`、`context_window` 字段**。

> **→ 网关元数据路径对本次任务无产出**。值的来源只能是 (a) 同文件 `opencode-go` 同名条目、(b) adam 自身已声明项、(c) 厂商规格（含 pi-ai 目录）、(d) 裁决兜底。这与 `rootcause-context-overflow.md:424`（"网关真实窗口的取证尝试与边界 [部分实测 / 无法确证]"）及 `:681`（"网关真实窗口的上界 [无法确证]（`/v1/models` 不暴露 `context_length`）"）的既有结论一致。

**附：adam 50 条 vs 网关 40 条的差集**（引用缓存 `models_fresh.json`，非本次实测）：

```
gateway 有 40 条；adam 列出 50 条
adam 有而 gateway 无（10 条）: deepseek-v4-flash-vision-exp, deepseek-v4.1-flash, gpt-5.4,
  gpt-5.4-mini, gpt-5.4-openai-compact, kimi-k2.7-code, kimi-k2.7-code-highspeed, kimi-k3,
  veo3.1-fast, veo3.1-pro
gateway 有而 adam 无: 无
```

**注意**：差集里的 `gpt-5.4` / `gpt-5.4-mini` / `gpt-5.4-openai-compact` / `kimi-k3` **是本表 E3/低置信条目的集中区** —— 它们在网关模型列表里不存在，可能已下架或从未上架，**填任何值都不会产生实际效果；但也意味着一旦被调用，声明值与真实值的一致性完全无保障**。

**`kimi-k2.7-code` / `kimi-k2.7-code-highspeed` 也不在网关列表内**，与其在 pi-ai 目录里存在同名条目（262144）形成对照 —— 目录证据不能替代网关上架事实。

---

## 5. 风险提示

### 5.1 风险方向定义

- **高风险 = 声明值 > 真实窗口**：客户端护栏失效（`isContextOverflow` Case 2 不再触发），请求改为在**网关侧**以 400 / 静默截断失败，且**失去 compaction 兜底**。
- **低危 = 声明值 < 真实窗口**：只会导致**过早压缩**（安全，代价是浪费窗口）。这正是本次故障的方向（262144 << 504264）。

### 5.2 高风险条目清单（10 条 —— 请主代理重点复核）

| id | 建议值 | 风险来源 |
|----|-------:|---------|
| `deepseek-v4.1-flash` **（已声明，不属本次 45 条，但风险最高）** | 1000000 | **[实测确证] 真实窗口仅证到 ≥ 504,264 token**（`rootcause-context-overflow.md:413,447`）。1000000 是已证下界的约 **2 倍**，50 万～100 万区间**无客户端护栏** |
| `claude-haiku-4-5-20251001` | 1000000 | pi-ai 目录**同名**条目为 **200000**；本表上浮 5 倍 |
| `claude-opus-4-5-20251101` | 1000000 | 目录同名 **200000**；上浮 5 倍 |
| `glm-4.7` | 1000000 | 目录证据 **204800**；上浮约 4.9 倍 |
| `glm-5` | 1000000 | 目录证据 **204800 / 202752**；上浮约 4.9 倍 |
| `gpt-5.4` | 1000000 | 目录**冲突**，`openai.json` 侧为 **272000**；若真值为 272000 则上浮 3.7 倍 |
| `gpt-5.4-mini` | 1000000 | 目录 **400000**；上浮 2.5 倍 |
| `gpt-5.5` | 1000000 | 目录冲突，`openai.json` 侧 **272000** |
| `gpt-5.6-sol` | 1000000 | 目录冲突，`openai.json` 侧 **272000** |
| `gpt-5.6-terra` | 1000000 | 目录冲突，`openai.json` 侧 **272000** |
| `gpt-5.6-luna` | 1000000 | 目录冲突，`openai.json` 侧 **272000** |

（**实际 11 条** = 本次 45 条中 **10 条**（上表第 2-11 行）+ 已声明且**不属本次范围**的 `deepseek-v4.1-flash` **1 条**。）

**另需标注（盲目区间）**：主表 **5 条严格 E3 兜底项**（`qwen3.8-flash`、`qwen3.8-max`、`gpt-5.4-openai-compact`、`gpt-5.5-openai-compact`、`deepseek-v4-flash-vision-exp`）**在"是否高于真实窗口"上完全未知** —— 它们**既不算安全也不算已知危险**。另加 §C 的 3 条外推项（`glm-4.7`、`glm-5`、`gpt-5.4-mini`），共 **8 条**处于无证据/证据被上浮的区间。这是本次批量补齐**固有的、无法用本地证据消除**的风险。

### 5.3 低危条目（声明值 < 真实窗口 —— 安全）

以下条目取的是**厂商目录的保守低值**，若真实窗口更大只会导致过早压缩：

| id | 值 | 说明 |
|----|---:|------|
| `glm-5.1` | 202752 | 目录同名 202752（`opencode.json` 侧 204800，取更低者） |
| `kimi-k2.7-code` | 262144 | 与 `opencode-go` 声明一致（`github-copilot.json` 侧 256000，取更高但仍在保守档） |
| `kimi-k2.7-code-highspeed` | 262144 | 目录同名 262144 |
| `deepseek-v4-pro` | 1000000 | E1，`opencode-go` 明确声明，同族 `deepseek-v4-flash` 亦 1000000 |

`gemini-3.x` 全系（9 条，1048576）与 Claude 4.6+ 全系（6 条，1000000）取的是**多目录一致的规格值**，风险中性偏低。

### 5.4 一句话整体评估

> **整体风险方向已从"过度压缩（已证故障）"翻转为"局部护栏缺失（未证风险）"，且危险面集中在 11 条把值顶到 1000000、而其厂商目录证据仅 20 万～40 万或干脆不存在的条目上——这批条目一旦真值偏低，会把一个"干净的客户端溢出 + compaction"故障，换成"网关侧报错 / 静默截断"的更难定位的故障。**

**推荐的安全化变体（零新增高风险版）**：把上述 **10 条**按目录证据值写 —— `claude-haiku-4-5-20251001: 200000`、`claude-opus-4-5-20251101: 200000`、`glm-4.7: 204800`、`glm-5: 204800`、`gpt-5.4: 272000`、`gpt-5.4-mini: 400000`、`gpt-5.5: 272000`、`gpt-5.6-sol: 272000`、`gpt-5.6-terra: 272000`、`gpt-5.6-luna: 272000`；其余按裁决 1000000。代价是这些模型会过早压缩，但**不会再产生任何新的"声明高于真实"风险**。本报告主表给出的是**用户裁决档（1000000 优先）**，是否切到保守档请主代理裁定。


---

## 6. 可直接落地的 YAML 片段（45 条）

**格式与 `settings.yaml:78-80` 的 `deepseek-v4-flash` 现有写法完全一致**：`- id: xxx`（8 空格缩进）+ 下一行 `          contextWindow: N`（**10 空格**）。**不含** `name:` / `maxTokens:`（现状其余条目亦无）。

```yaml
        - id: deepseek-v4-pro
          contextWindow: 1000000
        - id: glm-5.1
          contextWindow: 202752
        - id: glm-5.2
          contextWindow: 1000000
        - id: glm-4.7
          contextWindow: 1000000
        - id: glm-5
          contextWindow: 1000000
        - id: kimi-k3
          contextWindow: 1048576
        - id: qwen3.7-max
          contextWindow: 1000000
        - id: qwen3.7-plus
          contextWindow: 1000000
        - id: qwen3.8-flash
          contextWindow: 1000000
        - id: qwen3.8-max
          contextWindow: 1000000
        - id: claude-haiku-4-5-20251001
          contextWindow: 1000000
        - id: claude-opus-4-5-20251101
          contextWindow: 1000000
        - id: claude-opus-4-6
          contextWindow: 1000000
        - id: claude-opus-4-7
          contextWindow: 1000000
        - id: claude-opus-4-8
          contextWindow: 1000000
        - id: claude-opus-5
          contextWindow: 1000000
        - id: claude-sonnet-4-5-20250929
          contextWindow: 1000000
        - id: claude-sonnet-4-6
          contextWindow: 1000000
        - id: claude-sonnet-5
          contextWindow: 1000000
        - id: gpt-5.4
          contextWindow: 1000000
        - id: gpt-5.4-mini
          contextWindow: 1000000
        - id: gpt-5.4-openai-compact
          contextWindow: 1000000
        - id: gpt-5.5-openai-compact
          contextWindow: 1000000
        - id: gpt-5.6-sol
          contextWindow: 1000000
        - id: gpt-5.6-terra
          contextWindow: 1000000
        - id: gpt-5.5
          contextWindow: 1000000
        - id: gpt-5.6-luna
          contextWindow: 1000000
        - id: gemini-3.1-flash-image-preview
          contextWindow: 1048576
        - id: gemini-3.1-flash-image-preview-2k
          contextWindow: 1048576
        - id: gemini-3.1-flash-image-preview-4k
          contextWindow: 1048576
        - id: gemini-3.1-flash-lite
          contextWindow: 1048576
        - id: gemini-3.1-pro-preview
          contextWindow: 1048576
        - id: gemini-3.5-flash
          contextWindow: 1048576
        - id: gemini-3.5-flash-lite
          contextWindow: 1048576
        - id: gemini-3.6-flash
          contextWindow: 1048576
        - id: gemini-3-flash-preview
          contextWindow: 1048576
        - id: gemini-3-pro-image-preview
          contextWindow: 1048576
        - id: gemini-3-pro-image-preview-2k
          contextWindow: 1048576
        - id: gemini-3-pro-image-preview-4k
          contextWindow: 1048576
        - id: gemini-3-flash
          contextWindow: 1048576
        - id: kimi-k2.7-code
          contextWindow: 262144
        - id: kimi-k2.7-code-highspeed
          contextWindow: 262144
        - id: veo3.1-fast
          contextWindow: 1000000
        - id: veo3.1-pro
          contextWindow: 1000000
        - id: deepseek-v4-flash-vision-exp
          contextWindow: 1000000
```

**落地说明**：
1. 片段**按 settings.yaml 现有条目顺序**排列，可直接按序用"在 `- id: xxx` 行后插入一行"的方式逐条落地，**不会打乱文件顺序**。
2. `veo3.1-fast` / `veo3.1-pro` 两条在 §3 判为**不适用**，但为满足"46→45 条全补齐 + 裁决兜底"的要求仍在片段中给出 1000000。**主代理若采纳"不适用"判断，请删除这两条**（它们是视频模型，窗口值不影响 agent 判定，填了也无害）。
3. `gemini-3.1-flash-image-preview-2k/-4k` 若主代理采纳严格口径也可删除（同上，无害）。
4. **落地后请勿忘记**：`deepseek-v4.1-flash` 的现值 1000000 **已是"声明 > 已证真实下界 504264"的状态**，是本次故障点本身。若主代理希望根治"过量声明"，应把它降到 **500000**（已证下界的保守档）而非保留 1000000 —— 但降太低（如 262144）会复现原故障，**500000 是"不误判 + 不越界"的中间档**。
5. 45 条 + 已声明 5 条 = 50 条，全部条目补齐后 `DEFAULT_CONTEXT_WINDOW = 262144` 兜底路径在 `adam` 上**不再有触发点**。

---

## 附录：本报告用到的全部原始命令与出处

| 编号 | 命令 / 出处 | 用途 |
|---|---|---|
| A1 | `python3` 解析 `~/.dsh/settings.yaml` adam 块 | 确证 50 条中 45 条缺 `contextWindow` |
| A2 | `sed -n '134,138p' ~/.dsh/backups/settings.yaml.acceptance-20260917-180406.bak` | 确证 `deepseek-v4.1-flash` 刚被补值（46→45 的由来） |
| A3 | `read ~/.dsh/settings.yaml`（全文 173 行） | 取 opencode-go 17 条显式值 + adam 5 条已声明值 |
| A4 | `grep -n "contextWindow" ~/.dsh/settings.yaml` | 现存 20 处声明的位置清单（16 opencode-go + adam 4 现值） |
| A5 | `ls ~/.dsh/backups/` + 逐备份 `grep -c contextWindow` | 确认 4 份 settings 备份**均无**额外已声明值（历史快照无更优证据），旧备份（`settings.yaml.bak-ssh-gui-20260915115645`）**无 adam 块** |
| A6 | `diff <(sed -n '/^    adam:/,...' backup) <(sed -n '/^    adam:/,...' settings.yaml)` | 确证 adam 块在备份间除 `deepseek-v4.1-flash` 外无差异 |
| A7 | `sed -n '845,855p' .../@deepseek-ai/dsh-llm-pi-ai/lib/index.js` | 确证 `const DEFAULT_CONTEXT_WINDOW = 262144;`（第 849 行） |
| A8 | `python3` 遍历 `.../@earendil-works/pi-ai/dist/providers/data/*.json`（37 个文件） | E2-cat 全部取值来源；含同名精确命中判定 |
| A9 | `python3` 输出 `gemini-3.1-flash-lite-image cw=65536` | 图像变体窗口显著低于文本变体的关键反证 |
| A10 | `curl -sS -m 25 https://llmapi.roboscience.xyz/v1/models` → **HTTP 401** | 唯一一次网关调用；实时元数据不可得（需鉴权） |
| A11 | `python3` 解析 `.workspace/models_fresh.json` | 缓存证明 `/v1/models` **字段并集不含任何 context 字段** |
| A12 | `python3` 差集 `adam 50` vs `gateway 40` | 10 条差集清单（E3 集中区） |
| A13 | `grep -rn "contextWindow" .workspace/acceptance-exec.md` | `:83` 实测 `glm-5.3` 解析为 `contextWindow: 1000000`（adam 已声明值的运行时确证） |
| A14 | `grep -n "504264" .workspace/acceptance-probe/rootcause-context-overflow.md` | `:413` 实测 `6472 + 497792 = 504,264` → `stop` 却被判溢出；`:417` 真实窗口下界 ≥504264；`:447` 上界无法确证；`:681` `/v1/models` 不暴露 `context_length` |
| A15 | `stat -c '%y %s' ~/.dsh/settings.yaml` + `sha256sum` + `diff` vs 18:04 备份 | 发现**取证期间文件被其它进程改动**（3 处，见 §0-A）；并复核主表 45 条判定未变 |
| A16 | `ps -eo pid,lstart,cmd \| grep dsh` | 定位同机运行的加压探测进程（`probe-context-window.sh` + `chat/completions` curl） |

**只读合规声明**：本档**未修改** `~/.dsh/settings.yaml`（全程仅 `read` 与只读 shell：`grep`/`sed`/`diff`/`stat`/`ps`/`python3` 只读解析），未重启任何进程，未 install，除 `/v1/models`（HTTP 401，只读）外未发起任何网关调用（**未**发起 `chat/completions`，未消耗推理配额），**未从 `.credentials.yaml` 提取密钥**。唯一写入的路径是本文件 `.workspace/acceptance-probe/context-window-table.md`。

**外部改动免责**：§0-A 记录的 `settings.yaml` 3 处改动（含 `deepseek-v4.1-flash` 补值 1000000、`agent-default-model.model` 改为 `deepseek-v4-flash`）**由本档之外的进程写入，不是本档所为**。本档最后一次确认：文件 `sha256=547e3c595c8ac3963c6a5d9d71d3703bd9ecd9918418c05eeaccb147766dc0ee`，该状态下主表 45 条判定成立。

