# adam 网关原生多模态实测（deepseek-v4.1-flash）

日期：2026-09-17 · 执行：主代理直测（真实 API 调用，非推断）
探针：`.workspace/mmt-probe/{probe-adam-multimodal.sh,probe-image.sh,probe-transcribe.sh}`
产物：`*.resp.json`（原始响应）、`probe.jpg`（768px 测试图）、`crop-statusbar.png`（2.2× 放大裁剪）

## 结论

| 模型（adam 网关） | 图像输入 | 实测判定 |
|---|---|---|
| **deepseek-v4.1-flash** | **接受且真实识图** | ✅ 原生多模态可用：HTTP 200、`finish=stop`、描述与真值吻合、大字/结构/色值逐字命中 **15/17** |
| deepseek-v4-flash | 接受但**未真正处理** | ❌ reasoning 自述"image_base64 truncated? 只看到 /9j/4AAQ 开头"→ `content` 空、`finish=length`（把图当文本串） |
| deepseek-v4-flash-vision-exp | **接受且真实识图** | ✅ 网关专有视觉实验模型，可用（描述与 v4.1-flash 同级） |

网关 `/v1/models` = 35 个模型，含 `deepseek-v4.1-flash`、`deepseek-v4-flash-vision-exp`、`gemini-3.1-flash-image-preview`、`gemini-3-flash`、`glm-5.3-flash`、`qwen3.8-flash` 等。

## 证据 1：图像输入被真实处理（非静默丢弃）

对插画图（三只拟人狼围绕地图）提问"完整转录文字 + 描述画面"，v4.1-flash 返回：
`无文字`；`3 个拟人化兽人角色`；`中间米黄色毛发，额头佩戴护目镜，身穿黄色外套，双手展开一张空白地图，头顶有包含三个点的对话气泡`；`左侧红棕色毛发，佩戴蓝色头带`；`右侧青蓝色毛发……深蓝色外套搭配白色条纹`。
→ 与人工真值（`analyze_image`）逐项吻合（气泡三点、护目镜、黄外套、持图、三色毛色），**排除"模型没看到图却编造"**（对照组 deepseek-v4-flash 在同一请求下自述看不到图、输出为空）。

## 证据 2：转录保真度（UI 截图，含中文小字）

测试图 `.workspace/btw-ui-previews/preview.png`（真实 UI 预览，1240×880）。对照真值取**源码权威串**（`.workspace/btw-ui-previews/render-preview.py` + `dsh-btw/src/client/locales.ts`）。

命中（v4.1-flash 逐字正确）：`btw 侧聊`、`输出中… 当前动作: read`、`这张图里有什么文字？`、`Shot A`、`Shot B`、`Shot A - original`、`max-width:min(1600px,94vw) · max-height:calc(100vh-80px)`、`#b7e85b`、`#b7e85b→#d9f39a`、`替代原 DeepSeek 蓝`、序号徽标/焦点还原等设计规则行 —— **15/17**。

未命中（10-11px 小字，全部为**语义替换式幻觉**）：

| 真值（源码） | v4.1-flash 读数 |
|---|---|
| `只读`（徽章） | `GPT-5` |
| `主任务运行中` | `任务多进行中` |
| `继承内容仅作参考` | `侧边内容仅作参考` |

### 关键交叉发现：放大裁剪是通用必需步骤

同一张图三种读法在小字处三方不一致；以**源码真值**裁决：

| 路径 | 小字准确率 |
|---|---|
| **整图 → vision 路径**（1240×880 直接送） | 1/3（徽章读成 `未读`） |
| **2.2× 放大裁剪 → vision 路径** | **3/3 全对** |
| adam v4.1-flash（740px 缩放整图） | 0/3（但大字区 15/17 全对） |

→ **小字保真度取决于输入分辨率，不取决于模型强弱**：整图送（尤其被缩小后）小字必丢；裁剪 + 放大后同一路径 3/3 正确。

## 对本部署识图管线的意义

1. **可直接省一跳**：在 `settings.yaml` 给 adam provider 的 `deepseek-v4.1-flash` 声明 `input: [text, image]` 后，能力检测（`modelAcceptsImage`）即判为原图直传——主会话/侧聊不再经 vision-adam（opencode）中转。
2. **但直传有质量代价**：adam 直传在**小字**上与 vision-adam 同级偏差（0/3 vs 1/3），而放大裁剪才 3/3。若启用直传，应同时补"小图/小字放大预处理"，否则会退化。
3. **建议保留回退**：vision-adam 设置页（模型/baseURL/apiKeyEnv/maxTokens）保留，作为直传不可用或质量异常的兜底。
4. **诚实边界**：本结论基于 2 张图（插画 + UI 截图）与单轮调用；超大图、多图同送、PDF/文档流的网关限制未测。

## 复现命令

```bash
# 文本基线 + 图像输入（插画图，三模型对照）
bash /home/CNS2026495165/dsh/.workspace/mmt-probe/probe-image.sh
# 转录保真度（指定图与模型）
bash /home/CNS2026495165/dsh/.workspace/mmt-probe/probe-transcribe.sh <图片路径> deepseek-v4.1-flash
# 预期：HTTP 200 + ACCEPTED；deepseek-v4-flash 对照项应出现 content 空 / finish=length
```
