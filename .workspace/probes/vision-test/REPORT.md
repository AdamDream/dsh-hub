# `deepseek-v4-pro` 原生多模态能力测试报告

**结论（一句话）**：**`deepseek-v4-pro` 原生支持图片输入**，能力与 `deepseek-v4.1-flash` / `deepseek-v4-flash-vision-exp` 完全一致；三者与"看不见图"的 `deepseek-v4-flash` 判然有别。
**测试时间**：2026-09-20 · **方式**：`thinking:{type:disabled}`、`temperature=0`、串行 + 1.5s 限速（避免打断网关）

---

## 0. 为什么这个测试能证伪

- `200 OK` **不算证据**：网关可能收下图片却静默丢弃，模型照样礼貌作答。
- **无图对照已证**：不给图片时，模型会**自信地凭空编造**（`pro` 编出一份"企业标准化管理"文档、`4.1-flash` 编出"企业标准体系构建"、`vision-exp` 编出"若f(x)的图象关于点(1,0)对称…"）——所以"答得像"毫无判别力。
- 本测试的判据是**不可猜的随机 nonce**（`K7QX4` / `M3PZR`）+ **需要逐图跟踪的纯色** + **形状计数**：看不见图的模型在数学上不可能逐图答对。
- 另有**阴性对照**：`deepseek-v4-flash`（未声明图片能力，此前实测看不见图）必须答错，否则说明测试无效。

---

## 1. 结果矩阵

| 模型 | 纯红 | 纯绿 | 纯蓝 | nonce `K7QX4` | nonce `M3PZR` | 3 个圆 | 判定 |
|---|---|---|---|---|---|---|---|
| **`deepseek-v4-pro`** | 红 ✓ | 绿 ✓ | 蓝 ✓ | **K7QX4 ✓** | **M3PZR ✓** | 3 ✓ | **原生多模态** |
| `deepseek-v4.1-flash` | 红 ✓ | 绿 ✓ | 蓝 ✓ | K7QX4 ✓ | M3PZR ✓ | 3 ✓ | 原生多模态 |
| `deepseek-v4-flash-vision-exp` | 红 ✓ | 绿 ✓ | 蓝 ✓ | K7QX4 ✓ | M3PZR ✓ | 3 ✓ | 原生多模态 |
| `deepseek-v4-flash`（**阴性对照**） | 其它 ✗ | 红 ✗ | 其它 ✗ | 拒答 ✗ | 拒答 ✗ | 5 ✗ | **看不见图** |

阴性对照的原始回答（证明判据有效）：

```
nonce_1 → 很抱歉，我无法查看或识别图片中的文字。您提供的图片数据似乎不完整或无法解析。
nonce_2 → 很抱歉，我无法识别图片中的文字。您提供的图片内容似乎不完整或无法解析。
纯绿图 → 红        （三色跟踪完全失败）
3 个圆 → 5
```

## 2. 同栈证据（与"pro ≡ 4.1-flash"的既有结论一致）

| 观测 | `deepseek-v4-pro` | `deepseek-v4.1-flash` | `deepseek-v4-flash-vision-exp` | `deepseek-v4-flash` |
|---|---|---|---|---|
| 上游自报名 | `deepseek/deepseek-flash` | `deepseek/deepseek-flash` | `deepseek/deepseek-v4-flash-vision-exp` | `deepseek-v4-flash-0731` |
| 带图请求 `prompt_tokens`（同一图） | 208 / 200 / 197 | 208 / 200 / 197 | 208 / 200 / 197 | **111 / 108 / 105**（+53 差与既有发现一致） |

→ 带图时 `pro` 与 `4.1-flash` 的 token 计数**逐项相同**，且都走 `deepseek/` 渠道；`deepseek-v4-flash` 走另一渠道且计数不同。
**这再次印证了此前的结论：`deepseek-v4-pro` 与 `deepseek-v4.1-flash` 是同一个被服务的实体**——现在这条等价关系在**图片能力**上也成立。

## 3. 配置影响（可执行建议）

`~/.dsh/settings.yaml` 的 `adam` provider 模型清单里：

```yaml
- id: deepseek-v4-pro        # ← 目前没有 input 声明 → 按"能力声明优先"门禁走 vision-adam 转文本
  contextWindow: 1000000
- id: deepseek-v4.1-flash    # ← 已声明
  input: [text, image]
- id: deepseek-v4-flash-vision-exp   # ← 已声明
  input: [text, image]
```

既然 `deepseek-v4-pro` 已被实测证明原生多模态，**建议给它补上**：

```yaml
- id: deepseek-v4-pro
  contextWindow: 1000000
  input:
    - text
    - image
```

补上后，主会话/侧聊在该模型下的图片输入可**原图直传**，不再经 vision-adam 转文本（用户已知悉直传在小字保真度上的限制，且已裁决不做放大预处理）。
### 3.1 实施记录（2026-09-20 15:11，用户已裁决"补上声明"）

- **已改**：`~/.dsh/settings.yaml` 的 `llm-pi-ai.providers.adam.models[deepseek-v4-pro]` 现为
  ```yaml
  - id: deepseek-v4-pro
    contextWindow: 1000000
    input:
      - text
      - image
  ```
  改动经锚点唯一性断言（命中恰好 1 次）+ 改前改后 YAML 解析校验；备份：`.workspace/lag-fix/backup/settings.yaml.pre-image-decl-20260920-151144`（6,201 B）。
  仅改 `adam` provider 的这一条；`opencode-go` 下的同名条目**未动**（那是另一条网关路由）。
- **门禁代码位置**（本次实测确认）：`@deepseek-ai/dsh-llm-pi-ai/lib/index.js:1721`
  ```js
  if (containsImage && !model.input.includes("image"))
    throw new LlmError(`pi-ai model "${model.id}" does not support image input`, "UNSUPPORTED_CONTENT");
  ```
- **热载状态：未确证**。已尝试两条只读验证路径均不可用：
  - `llm.models` RPC 只暴露 `{id, name}`，**不含 `input`/能力位**（实测 `Object.keys` = `["id","name"]`）；
  - `settings.describe` 返回的是 schema + namespace 值，模型级 `input` 字段不可直接读取（其条目标注 `"applies":"live"`，但不足以证明运行时模型注册表已重建）。
- **判定方式（建议的最终确证）**：在主会话（当前即 `adam/deepseek-v4-pro`）**附一张截图直接发送**：
  - 若图片正常进入模型 ⇒ 已热载，无需重启；
  - 若报 `does not support image input (UNSUPPORTED_CONTENT)` ⇒ 声明需随那次宿主重启生效（重启已在计划内）。
- 相关事实：`deepseek-v4.1-flash` / `deepseek-v4-flash-vision-exp` 早在 2026-09-17 就已声明并在真实使用中生效（识图链路即走其中），说明该字段的消费路径是通的。

## 4. 原始证据

| 文件 | 内容 |
|---|---|
| `truth.json` | 六张测试图的地面真值 |
| `solid_red.png` / `solid_green.png` / `solid_blue.png` | 纯色图（RGB 真值已知） |
| `nonce_1.png`（K7QX4）/ `nonce_2.png`（M3PZR） | 随机 nonce 文字图（不可猜） |
| `shape_3circles.png` | 白底 3 个红圆 |
| `results.json` | 全部请求的原始响应（含 `model`/`prompt_tokens`/`content`） |
| `vision_probe.py` | 探针脚本（可复跑） |

**基准自检**：`nonce_1.png` 经 `analyze_image`（vision-adam → `deepseek-v4.1-flash`）独立读为 `K7QX4`，与地面真值一致 → 测试基准无误。

## 5. 复现命令

```bash
cd /home/CNS2026495165/dsh/.workspace/vision-test
python3 vision_probe.py                 # 全部四个模型
python3 vision_probe.py ds-pro          # 只测待测对象
```

## 6. 未验证 / 边界

- 只测了 `thinking` 关闭模式（为拿到干净 content）；**未测思考模式下的图片支持**是否一致。
- 未测多图、超大图、低分辨率小字、PDF/视频。
- 未测 `deepseek-v4-pro` 在**视觉推理难度**上的上限（本测试只证明"能看见并能读出内容"，不证明视觉推理强度与 pro 级模型相当——事实上它已被证明与 flash 实体同源）。
- 无图对照中的"编造"现象本报告按**模型幻觉**解释；未进一步验证是否存在上游跨请求图片缓存/串味（若要排除，需服务端配合观测）。
