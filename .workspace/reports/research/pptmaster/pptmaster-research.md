# pptmaster（DSH 办公/PPT 插件）调研报告

> 任务：联网调研「pptmaster」在 DSH 生态及开源世界的现状，产出「存在性 + 可移植性 + 自研方案」结论。
> 调研方法：web_search（[Dominic789654/awesome-deepseek-harness](https://github.com/Dominic789654/awesome-deepseek-harness) 插件清单）+ GitHub API + npm registry + PyPI + DSH 官方 cookbook 交叉核验（2026-09，数据以核验时点为准）。
> 部署背景：个人 DSH `0.1.1-rc.2`，cordis 插件体系（host `defineTool` + client UI + settings namespace）。

---

## 0. 结论摘要（TL;DR）

1. **有现成可移植，且不是一两个，而是一整个生态**。DSH 生态里已存在 **10+ 个 PPT/办公插件**，其中与「pptmaster」直接同名/同义的就有 [pn1024/dsh-ppt-master](https://github.com/pn1024/dsh-ppt-master)（PPT Master 的 DSH 包装）和 [zbsph/dsh-ppt-studio](https://github.com/zbsph/dsh-ppt-studio)。「pptmaster」这个名字在 DSH 生态已被占用，**不建议重造，建议 fork/port**。
2. **最贴合本部署（0.1.1-rc.2）的现成插件是 [dsh-workbuddy-ppt](https://github.com/SuperstructureJH/dsh-workbuddy-ppt)**：npm 发布、MIT、纯 Node（无 Python 依赖）、peer 依赖恰好钉在 `^0.1.1-rc.2`，自带"模型写场景（skill）→ 确定性校验（PPTD v2）→ 可编辑 PPTX 渲染（pptxgenjs）→ 工作区落盘 + SVG 无头预览"，还附带 `dsh-pptd` CLI。**拿来即用风险最低**。
3. 若要「从零自研」的参考模板，生态里已有三个可对照的最小架构：**场景 DSL（deck.pptd/YAML）→ 校验 → pptxgenjs 渲染**（workbuddy-ppt）、**OOXML 直写零依赖**（[kw78/dsh-office-tools](https://github.com/kw78/dsh-office-tools)）、**python-pptx 子进程**（[hugohe3/PPT-master](https://github.com/hugohe3/PPT-master) 系）。
4. **推荐路线**：A（最省事）直接 `dsh plugin --profile web add dsh-workbuddy-ppt` → B（要编辑已有 PPT/更完整工作区）评估 [zbsph/dsh-ppt-studio](https://github.com/zbsph/dsh-ppt-studio)（注意其基线为 0.1.5-rc.2，需先核对本机 0.1.1-rc.2 契约）→ C（坚持自研）按 §6 的 MVP 用 **pptxgenjs（Node-only）** 起步，编辑/读取已有 PPT 再引入 python-pptx 子进程。

---

## 1. DSH 生态现状（有/无、有哪些）

### 1.1 直接答案：DSH 生态 PPT 插件已是一整个目录

[Dominic789654/awesome-deepseek-harness](https://github.com/Dominic789654/awesome-deepseek-harness) 有独立 **「Slides / PPT」** 章节，列出的相关项目（节选，均为联网核验到的真实仓库）：

| 项目 | 一句话能力 | 语言/依赖 |
|---|---|---|
| [hugohe3/PPT-master](https://github.com/hugohe3/PPT-master)（54k★） | AI 从文档/主题生成**原生可编辑** PPTX（形状/动画/图表/旁白/模板） | Python（python-pptx） |
| [pn1024/dsh-ppt-master](https://github.com/pn1024/dsh-ppt-master) | **PPT Master 的 DSH 插件化包装**（skill provider 形态） | Python 3.10+ |
| [zbsph/dsh-ppt-studio](https://github.com/zbsph/dsh-ppt-studio) | 完整 PPT 工作区：从头/补完/修改/总结四类任务 + PPTD 中间层 + 质量门禁 + splice 改既有 PPT | JS + 可选 python-pptx |
| [SuperstructureJH/dsh-workbuddy-ppt](https://github.com/SuperstructureJH/dsh-workbuddy-ppt)（npm `dsh-workbuddy-ppt`） | 自包含 PPTX 生成：skill 写作 → PPTD v2 确定性校验 → 可编辑渲染 → 工作区交付，附 CLI | 纯 Node（pptxgenjs） |
| [omdsh-dev/dsh-office](https://github.com/omdsh-dev/dsh-office)（npm `@huiliyi37/dsh-office`，22★） | 办公三件套 14 工具：`pptx_create` / `pptx_read` / `pptx_edit`（`<a:t>` 外科手术式替换） | TS，无 Python |
| [fuzhengwei/walioffice-dsh-plugin](https://github.com/fuzhengwei/walioffice-dsh-plugin)（npm `walioffice-dsh-plugin` 0.1.15） | `ppt_plan`（大纲 JSON）+ `ppt_generate`（.pptx）+ 完整 Web 客户端 UI + 预览面板 | TS，Node 22.19+/24+ |
| [kw78/dsh-office-tools](https://github.com/kw78/dsh-office-tools)（npm `dsh-office-tools` 1.0.2） | 自研 OOXML 引擎零依赖，`ppt_create` / `ppt_read`，只走官方 `ctx.fs` | 纯 TS，零依赖 |
| [OMSociety/kimi-ppt-skill](https://github.com/OMSociety/kimi-ppt-skill) | PPTD DSL 技能：创建/编辑/复刻/导出，纯本地导出（python-pptx + Pillow 预览） | Python + 可选浏览器 |
| [dream-num/dsh-univer-office](https://github.com/dream-num/dsh-univer-office)（npm `dsh-univer-office`） | Univer 完整办公环境（sheets/docs/slides/画布），内置预览与 Worktree | TS，**~180MB，puppeteer-core** |
| [liustack/pptwise](https://github.com/liustack/pptwise) / [pptfast](https://github.com/liustack/pptfast) | 语义 IR 进、原生 DrawingML 出的稳定 PPTX 生成（DSH 插件 + Claude Code 插件 + CLI） | 未深核，awesome 清单收录 |
| [STARDUSTLC666/dsh-ppt](https://github.com/STARDUSTLC666/dsh-ppt) | 一条 prompt 出整套演示（HTML 幻灯片 + PPTX 导出 + manifest），零运行时依赖 | JS |
| [unStone/dsh-plugin-web-ppt](https://github.com/unStone/dsh-plugin-web-ppt) | 让 agent 读取/导出 .pptx/.ppt，纯 JS、免 PowerPoint、免转换 | JS |
| [yejiming/dsh-ppt](https://github.com/yejiming/dsh-ppt)、[chiang21fcb/dsh-ppt-guider](https://github.com/chiang21fcb/dsh-ppt-guider) | PPT 设计预设 / "PPT 副驾驶"式六步工作流 | 预设型 |
| [WoyouWoyou/dsh-office-32k](https://github.com/WoyouWoyou/dsh-office-32k)、[steven95/dsh-office-suite](https://github.com/steven95/dsh-office-suite)、[didclawapp-ai/DSH-Office](https://github.com/didclawapp-ai/DSH-Office) 等 | 办公文档全家桶插件（Excel/Word/PPT 读写生成） | 多样 |
| [Mikuzjc/dsh-office-for-mso](https://github.com/Mikuzjc/dsh-office-for-mso)、[wly8691-jpg/dsh-office-com](https://github.com/wly8691-jpg/dsh-office-com) | 通过 Office 加载项/COM 驱动**已打开的**真实 Office | 需本机 Office |

### 1.2 side-chat 生态答复

「side-chat」是 DSH Web 的**侧边会话**插件家族（[zclDragon/dsh-side-chat](https://github.com/zclDragon/dsh-side-chat)、[xlennart/dsh-side-chat](https://github.com/xlennart/dsh-side-chat)、[Lukeknow0/dsh-side-chat](https://github.com/Lukeknow0/dsh-side-chat) 等），功能是"主会话旁开临时子会话"，**该生态里没有 PPT 插件**。side-chat 可作为一个**入口/UI 形态**（侧栏浮窗里做 PPT），但 PPT 能力本身不在其中。

### 1.3 「pptmaster」名称占用情况

- 通用世界：[hugohe3/PPT-master](https://github.com/hugohe3/PPT-master)（54k★）就是事实上的 "PPT Master"，另有 [macrochen/ppt-master](https://github.com/macrochen/ppt-master)（同名 fork/镜像，0★，指向 hugohe3 的示例站）。
- DSH 世界：[pn1024/dsh-ppt-master](https://github.com/pn1024/dsh-ppt-master) 已把 "PPT Master" 做成 DSH 插件（skill 形态）。
- **结论：若在 DSH 生态里用 "pptmaster" 命名新插件，会与上述项目撞名/撞义；应先说明是 fork/port 或改名（如 `pptmaster-lite`、`dsh-ppt-master-ng`）。**

---

## 2. 通用方案盘点（非 DSH，可作技术底座）

| 方案 | 类型 | 能力 | 依赖 | 许可 | 与 DSH 适配性 |
|---|---|---|---|---|---|
| [gitbrent/PptxGenJS](https://github.com/gitbrent/PptxGenJS)（pptxgenjs 4.0.1，6.1k★） | JS 库 | 从零**创建** PPTX：文字/形状/表格/图表/图片/母版/动画，Node/浏览器通用 | 纯 JS（无原生依赖） | MIT | ★★★ 直接 `npm i pptxgenjs` 即用，**只写不读**（不能打开编辑现有文件） |
| [python-pptx](https://pypi.org/project/python-pptx/)（PyPI，MIT） | Python 库 | **创建 + 读取 + 修改**现有 .pptx（文本/形状/图表/母版/备注） | 纯 Python（3.8–3.12），无需装 PowerPoint | MIT | ★★★ 子进程调用即可；能补 pptxgenjs 的"编辑"短板 |
| [hugohe3/PPT-master](https://github.com/hugohe3/PPT-master) | AI PPT 生成器（skill 形态） | 大纲→内容→原生可编辑 PPTX；SVG→DrawingML；模板填充；图表表格；edge-tts 旁白；PDF/网页素材转 md | Python 3.10+（python-pptx、XlsxWriter、skia-pathops、uharfbuzz、edge-tts、PyMuPDF 等，多数可选） | MIT | ★★ 强但重：需 Python 环境 + pip 依赖；已被 pn1024/dsh-ppt-master 包装成 DSH 插件 |
| [MartinPacker/md2pptx](https://github.com/MartinPacker/md2pptx) | Markdown→PPTX 转换 | 按 markdown 结构（# / - / 表格）逐页生成 | Python（python-pptx） | 未深核 | ★★ 轻量参考实现 |
| [Slidev](https://sli.dev) / [Marp](https://marp.app) / Reveal.js | Markdown→HTML 幻灯片 | 渲染型演示，导出 PDF（Slidev 可经插件导出 PPTX，非原生编辑友好） | Node | MIT | ★ 演示形态与"可编辑 PPTX"目标不一致；[wordflowlab/pptify](https://github.com/wordflowlab/pptify)（npm `ai-pptify`）是 Slidev 路线的 AI CLI |
| [kakkoii1337/gai-cli-pptx](https://github.com/kakkoii1337/gai-cli-pptx)（npm `gai-cli-pptx`） | JSON→PPTX CLI | 最小示例：JSON 结构经 pptxgenjs 出 PPTX（~34KB） | Node + pptxgenjs | MIT | ★★★ 是"自研 MVP"的现成骨架 |
| Gamma / Beautiful.ai / Tome / 讯飞智文 / WPS AI | 商业 AI PPT | 云端生成、设计精美 | 闭源 SaaS | 商业 | ✗ 不可移植、不可离线 |

---

## 3. 候选机制级分析（重点 5 个）

### 3.1 dsh-workbuddy-ppt（npm 0.1.0 / 仓库 0.1.1，MIT，纯 Node）—— 推荐首选

- 仓库：[SuperstructureJH/dsh-workbuddy-ppt](https://github.com/SuperstructureJH/dsh-workbuddy-ppt) ｜ npm：[dsh-workbuddy-ppt](https://www.npmjs.com/package/dsh-workbuddy-ppt)
- 能力面：**自带 Kimi 兼容写作 skill**（模型按参考模板包写"完整场景"）→ `ppt_scene_check`（确定性门禁：唯一 id、页边界、字号容量、重叠、图表形状、工作区图片 hash）→ `ppt_scene_create`（同轮 hash 复算，防篡改）→ 序列化为 `deck.pptd`（PPTD v2 YAML 中间层）+ 每页 `.page` → 共享解析/校验 → **包内渲染器**（pptxgenjs + `@aiden0z/pptx-renderer`）产出**可编辑** PPTX（文字/形状/线条/表格/图表/受限图片）→ 工作区交付（PPTX + PPTD 工程 + `PRESENTATION.scene.json` + 图片资源）。
- 模板：内置 44 套 MIT 视觉参考包（源自 [binaryify/open-kimi-ppt-skill](https://github.com/binaryify/open-kimi-ppt-skill)）；`ppt_get_template_reference` 返回设计指南与 6–8 页可读参考页。
- 预览：`dsh-pptd screenshot` 经 SVG + Sharp 出项目内本地预览（无头、无浏览器），与 Office/WPS 打开互证。
- CLI：包内 `dsh-pptd`（convert / check / inspect / screenshot / render），PPTX→PPTD 转换明确标注"诊断性、非无损"（`--strict` 有非零不支持项即不出工程）。
- 依赖：peer 恰好 **`@deepseek-ai/*@^0.1.1-rc.2`（与用户部署完全同线）** + cordis ^4.0.1 + react ^18.2；runtime 依赖仅 `pptxgenjs`、`@aiden0z/pptx-renderer`、`fflate`、`js-yaml`、`jsdom`、`sharp`、`zod`、schemastery、typescript。Node `^22.19.0 || >=24`。
- 许可：MIT。安装：`dsh plugin --profile web add dsh-workbuddy-ppt`（默认 config 行 `root: !!js dshHomePath('office-ppt')`，settings 键见其 CONFIGURATION.md：`maxSlides=40`、`maxUploadBytes=32MiB`、`maxZipEntries=4000`、`maxDecksPerSession=50` 等）。
- 对 DSH cordis 范式的契合度：**完全契合**——Host 插件注册工具 + 会话级服务 + 工作区落盘；client 侧有 composer 模式/模板选择/最终文件预览与交付按钮；图片复用工作区资产（不自己生成图）。可选 Slides 路由（腾讯 SlideP/Docs）**不需要，默认关闭**。
- 适配结论：**拿来即用，风险最低**；若要改名/改名后可整包 fork（MIT）。

### 3.2 zbsph/dsh-ppt-studio（v1.0.0，MIT，JS）—— 功能最完整，需核对 DSH 版本

- 仓库：[zbsph/dsh-ppt-studio](https://github.com/zbsph/dsh-ppt-studio)（npm 未发布，走 Releases tgz / git clone + install.mjs）
- 能力面：四类任务（**从头 / 补完 / 修改 / 总结**）共用 PPTD 中间层（deck.yaml）；S0–S6 工作流（规格澄清→大纲→视觉定调→逐页制作→页审→整体审→导出）；质量门禁三轨（数字门禁 + 视觉审阅 + 真渲染复核：`ppt_render → ppt_verify → ppt_shot`）；**三重通道保真与贴模板，含 splice 改既有 PPTX 单页**；内置模板库 + 4 本内嵌技能手册；配套 agent preset「PPT 工作室」与 `/ppt` 命令面（quick/normal/quality audit/template）。
- 引擎：默认 PPTD 引擎；可选降级：本机 Microsoft Office（真渲染通道）、Edge/Chrome（截图与实测）、python + python-pptx（兜底引擎）。
- 版本要求：README 明确**宿主基线 DSH `0.1.5-rc.2`**（2026-09 实测适配 tools/commands/systemPrompt/webServer/skills/session-event/system-prompt/assemble 契约）；**更早的 0.1.x 未逐一验证**（缺 `skills` 服务时降级仍可用）。
- 适配结论：功能覆盖"生成 + 编辑既有 PPT"全部诉求，但**基线比用户部署（0.1.1-rc.2）新**，移植前必须对照 0.1.1-rc.2 逐项核对所依赖的 host 契约（tools 注册、skills 注册、命令、webServer 挂载、session/event）。

### 3.3 omdsh-dev/dsh-office（@huiliyi37/dsh-office，Apache-2.0，TS，22★）—— 轻量三工具

- 仓库：[omdsh-dev/dsh-office](https://github.com/omdsh-dev/dsh-office)
- 能力面（ppt 家族）：`pptx_create`（按 slide 定义生成：标题/章节/内容/两栏/图片/表格/图表 + 主题 + 备注）、`pptx_read`（滑页文本转 markdown，可含备注与结构/坐标信息）、`pptx_edit`（**对现有 .pptx 做 `<a:t>` 文本查找替换，保留全部版式与样式**）。另有 xlsx/pdf/docx 全家桶 14 工具。
- 依赖：纯 TS；要求 **dsh ≥ 0.1.0-rc.5**（其 `@deepseek-ai/dsh-tools` 需 ≥ 0.1.0-rc.5；0.0.1 的 dsh-tools 会装出第二份导致 `reading 'prepare'` 崩溃——安装前需查本机 dsh-tools 版本）。
- 适配结论：**"生成 + 读取 + 文本级编辑"的最小三件套**，Apache-2.0，机制透明（`cordis.patch.yml` 按家族开关），适合做自研底座或对照。

### 3.4 fuzhengwei/walioffice-dsh-plugin（npm walioffice-dsh-plugin 0.1.15，MIT）—— 带完整 Web UI 的办公套件

- 仓库：[fuzhengwei/walioffice-dsh-plugin](https://github.com/fuzhengwei/walioffice-dsh-plugin)
- 能力面：10 个工具，其中 `ppt_plan`（大纲与页面规划 JSON）+ `ppt_generate`（完整 .pptx）；Web 端有**输入框上方的办公类型栏 + 右侧工具入口与产物预览面板 + 执行结果卡片**（这是与"client UI"诉求最贴合的实现）；产物默认落启动目录的 `output/`。
- 机制：PPT 工具是 **LLM 编排型**（内部调 DSH 已配置的 LLM provider 生成大纲再落盘），非声明式渲染；配置优先级 `WALIOFFICE_LLM_PROVIDER/MODEL` → `DSH_LLM_*` → DSH 已配置 provider。
- 要求：Node 22.19+/24+；仅 web profile。
- 适配结论：想直接抄"客户端 UI + 工具卡片 + 产物面板"形态的最佳参考；但内部生成逻辑黑盒（LLM 直出），不如 workbuddy 的"场景 DSL + 确定性校验"可控。

### 3.5 pn1024/dsh-ppt-master（MIT，Python）—— "PPT Master" 的 DSH 包装

- 仓库：[pn1024/dsh-ppt-master](https://github.com/pn1024/dsh-ppt-master)
- 形态：`package.json`（dsh plugin manifest）+ `cordis.patch.yml` + `index.js`（**skill provider 入口**）+ `skills/ppt-master/`（SKILL.md + references + Python scripts + templates + workflows）。把 [hugohe3/PPT-master](https://github.com/hugohe3/PPT-master) 的整体 skill 包装进 DSH 技能体系。
- 依赖：Python 3.10+ + `pip install -r requirements.txt`；图片生成后端可选（`.env` 配 API key）。
- 适配结论：即"要 PPT Master 能力"的正统 DSH 入口；代价是 **Python 运行时 + pip 依赖树**，且 skill 形态（模型读 SKILL.md 后跑 Python 脚本）与 defineTool 直调形态不同。

---

## 4. DSH cordis 插件范式对照（官方契约）

依据 DSH 官方 [adding-a-tool.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.zh.md)，host 工具最小形态（与用户描述完全一致）：

```ts
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'read_file',
    description: 'Read a file from disk.',
    parameters: { path: { type: 'string', required: true, description: 'Absolute path' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) { return readFile(args.path, { encoding: 'utf8', signal: exec.signal }) },
  }))
}
```

要点（官方文档原文归纳）：
- 注册基于副作用，dispose 即注销；`parameters` 自动进系统提示词；`output.schema` 是规范化 JSON 值（对象/数组/标量/null），`output.render` 才做面向模型的文本投影；`exec` 携带不可变身份 + `signal`（取消）；`output.presentationMeta` 可做可回放 UI 卡片；`exec.agent.inject()` 追加模型可见上下文（如产物路径提示）；长时间运行用 `ctx.jobs.start({ kind, label, owner: exec.agent, run })` 注册后台任务；策略层用 `tools/pre-execute` / `ctx.tools.guard()`。
- **结论：任何候选插件的工具侧都落在同一 `defineTool` 契约内**，移植/自研没有范式障碍；差异只在"渲染引擎（pptxgenjs / python-pptx / 自写 OOXML）"与"client UI 形态（有/无、面板或卡片）"。

---

## 5. 存在性 + 可移植性结论

| 问题 | 结论 |
|---|---|
| 网上是否已有现成实现（DSH 生态）？ | **是，且丰富**：≥10 个 PPT/办公插件，含与"pptmaster"同名/近义者（pn1024/dsh-ppt-master、zbsph/dsh-ppt-studio）。side-chat 生态无 PPT 插件（它是侧边会话家族，可作入口 UI 参考）。 |
| 可否直接 fork/port？ | **可以，许可全部宽松**：MIT（workbuddy-ppt、ppt-studio、walioffice、office-tools、PPT-master）或 Apache-2.0（dsh-office）。无需授权即可改造成"pptmaster"。 |
| 与本部署（0.1.1-rc.2）的兼容？ | **dsh-workbuddy-ppt 的 peer 依赖恰为 `^0.1.1-rc.2`，零版本偏差**；dsh-office 需 dsh-tools ≥ 0.1.0-rc.5（大概率满足）；dsh-ppt-studio 基线 0.1.5-rc.2（**需核对**）；walioffice 需 Node 22.19+（**需核对本机 Node**）。 |
| 推荐路线 | **A 拿来即用（首选）**：`dsh plugin --profile web add dsh-workbuddy-ppt`（纯 Node、自带 skill+校验+渲染+CLI+预览、MIT，可整包改名）。**B 增强路线**：在其上叠加"编辑既有 PPT"（pptxgenjs 只写不读，编辑需 python-pptx 子进程或 dsh-office 的 `<a:t>` 替换）。**C 自研路线**：见 §6。 |

---

## 6. 自研最小可用方案（若从零做）

> 依据：pptxgenjs 4.0.1（MIT，纯 JS，Node/浏览器均可，`browser` 字段把 fs/os/path 置 false，无原生依赖）+ 官方 defineTool 契约 + 生态已验证的"场景 DSL → 校验 → 渲染 → 工作区落盘"链路。

### 6.1 功能面（MVP，3 个工具 + 1 个预览能力）

1. `ppt_create` —— 接受**场景 DSL（YAML/JSON，PPTD 风格）或极简 markdown**（`# 标题` → 页，`- ` 要点，`| |` 表格，`![alt](img-path)` 图片），调用 pptxgenjs 渲染为可编辑 .pptx。
2. `ppt_read` —— 用 JS 侧 OOXML 解包（fflate）读文本/结构（或子进程 python-pptx），把现有 .pptx 转回 markdown/场景摘要，供模型编辑。
3. `ppt_edit` —— MVP 两档：a) **文本级**：对现有 .pptx 做 `<a:t>` 查找替换（参考 dsh-office 的 pptx_edit，保留版式）；b) 复杂改动走"读 → 改场景 → 整页重建"（workbuddy 的 scene-backed revision 模式）。
4. 预览（可选但强烈建议）：渲染后经 SVG 快照（`@aiden0z/pptx-renderer` 或自绘）出每页 PNG/SVG 落工作区，对话内 `presentResult` 卡片展示；无 GUI 也能看（§7.3）。

### 6.2 技术选型

| 项 | 选型 | 理由 |
|---|---|---|
| 生成引擎 | **pptxgenjs**（Node） | 纯 JS 零原生依赖、可进 bundle、MIT、图表/表格/形状齐全；**只写不读** |
| 编辑引擎 | 文本级：OOXML `<a:t>` 替换（JS）；结构级：**python-pptx 子进程**（可选依赖） | python-pptx 是唯一"读+改现有"的轻量方案；不做"编辑"则可不引 Python |
| markdown→场景 | 自写 ~200 行解析器或直接吃 PPTD 风格 YAML | 生态已验证（md2pptx、gai-cli-pptx、workbuddy 的 deck.pptd） |
| 中间层 | `deck.pptd`（YAML）+ 确定性校验（唯一 id/越界/重叠/字号容量） | 照抄 workbuddy 的 PPTD v2 思路，质量可测 |
| 解压/打包 | fflate（纯 JS zip） | workbuddy 同款，避免系统 unzip 差异 |

### 6.3 host defineTool 接口（草图）

```ts
export const inject = ['tools', 'fs']   // ctx.fs = 官方文件服务，落盘走它而非裸 fs

ctx.tools.register(defineTool({
  name: 'ppt_create',
  description: 'Generate an editable .pptx from a scene DSL (YAML/JSON) or markdown, write into the session workspace, return file path + per-slide summary.',
  parameters: {
    source: { type: 'string', required: true, description: 'Scene YAML/JSON or markdown' },
    template: { type: 'string', description: 'Template id from settings.templates' },
    out: { type: 'string', description: 'Relative output filename, default pptmaster/deck.pptx' },
  },
  output: { schema: { type: 'object', properties: { path: { type: 'string' }, slides: { type: 'number' }, previews: { type: 'array', items: { type: 'string' } } } },
            render: (_a, v) => [{ type: 'text', text: `Saved ${v.path} (${v.slides} slides)` }] },
  async execute(args, exec) { /* resolve path under exec.agent.session.header.cwd, render via pptxgenjs, write via ctx.fs.writeBytes/writeText, snapshot previews */ },
}))
// 同名注册 ppt_read / ppt_edit
```

### 6.4 settings 键（Config schema，进 cordis.patch.yml / settings namespace）

```yaml
config:
  root: !!js dshHomePath('office-ppt')   # 状态/工程根（照抄 workbuddy）
  outputDir: .workspace/pptmaster        # 产物目录（会话工作区内相对路径）
  maxSlides: 40
  maxPptxBytes: 256MiB
  templates: {}                          # { id: { path|url, preview? } }
  theme: default
  engine: pptxgenjs                      # 'pptxgenjs' | 'python-pptx'（可选）
  pythonBin: python3                     # 仅 engine=python-pptx 时使用
  preview: true                          # 是否生成 SVG/PNG 快照（sharp/jsdom）
  imageDir: .workspace/images            # 复用主会话图片管线产物的目录
```

### 6.5 产物落盘位置

- 首选**会话工作区**（`exec.agent.session.header.cwd` 相对路径 + `ctx.fs` 后端做包含性/符号链接约束——kw78/dsh-office-tools 的标准做法），即 `~/.dsh/.../workspace/pptmaster/deck.pptx` 一类；交付时用 `exec.agent.inject()` 把路径/预览追加进会话上下文，供模型引用。
- 参考两种既有惯例：workbuddy 由 DSH 会话解析工作区、调用方不选根；walioffice 落启动目录 `output/`。

### 6.6 与主会话 / btw 的接入点

- **主会话**：插件 `apply(ctx)` 里注册的 3 个工具对主会话模型直接可见（自动进系统提示词），模型在对话里按需调用即可，无需旁路。
- **btw（dsh-btw 等会话/管线插件）**：接入点在 ①**图片管线**——`ppt_create` 的图片参数指向工作区图片资产（workbuddy 对图片做真实路径/扩展名/签名/大小/hash 校验；btw 生成图后把文件路径交给 ppt 工具），或让 `ppt_create` 直接消费 `imageDir` 里 btw 管线的产物；②**文件工具**——产物 .pptx/预览图落工作区后，现有的文件浏览/下载工具即可呈现，无需单独做下载通道；③**预览卡片**——用 `presentResult`/`presentationMeta` 让结果以可点击卡片形态进会话流（walioffice 面板、ppt-studio `ppt_preview` 链接是两种参考 UI）。

---

## 7. 风险与边界

1. **运行依赖分叉（Node 内置 vs Python）**：
   - 纯 Node 线（pptxgenjs/fflate/sharp/jsdom）：`npm i` 即用，无系统级依赖——**推荐主线**。
   - Python 线（hugohe3/PPT-master、kimi-ppt-skill、ppt-studio 兜底）：需要 Python 3.10+ + pip 依赖树（python-pptx、XlsxWriter、skia-pathops、uharfbuzz、edge-tts、PyMuPDF 等，多数可选）；**只在"编辑/读取现有 PPT"与"复杂 SVG→DrawingML"时才有刚需**（pptxgenjs 不读文件）。
2. **pptxgenjs 只写不读**：生成友好，编辑必须另走 python-pptx 子进程或 OOXML `<a:t>` 外科手术；文本级替换保留版式，结构级编辑请走"读→改场景→重建"。
3. **DSH 版本契约漂移**：插件与 core 都在 pre-stable（workbuddy 文档原话）。0.1.1-rc.2 与 0.1.5-rc.2 之间的 tools/skills/session/commands/webServer 契约可能不同；**装任何第三方插件前先核对本机 `@deepseek-ai/dsh-tools` 版本**（dsh-office 已踩过 0.0.1 双份崩溃的坑），并做一次 fresh-profile 冒烟。
4. **无 GUI 环境的渲染/预览**：无需 PowerPoint 也能生成与预览——预览通道有 4 条：a) 包内 SVG 快照 + Sharp（workbuddy `dsh-pptd screenshot`，无头最稳）；b) LibreOffice headless `--convert-to png/pdf`（系统可选，CJK 字体需装）；c) 浏览器截图（ppt-studio 用 Edge/Chrome 做真渲染复核）；d) 真 Office 通道仅在有本机 Office 时可用（ppt-studio 自动降级）。**预览与 Office/WPS 打开是互证而非等价**（workbuddy 文档明确把 Office/WPS 的 edit-save-reopen 列为外部验收门禁）。
5. **平台差异**：workbuddy 官方仅 macOS arm64 全量验证（Linux 未跑）；Windows 上注意 Node 22.19+/24+ 要求、路径与 `python3` vs `python` 命令差异、CJK 字体名解析（kimi-ppt-skill 按实装字体解析并给本地替代）。univer-office 依赖 puppeteer 下载浏览器，体积 ~180MB，谨慎。
6. **二进制经文本通道**：OOXML 是 zip；若走文本通道（dsh-office-tools 的做法是 ASCII-safe STORE zip 规划 + 字节对齐），注意二进制媒体（图片）会导致部分工具拒绝更新；直接走 `ctx.fs` 字节接口最稳妥。
7. **许可与命名**：全部候选 MIT/Apache-2.0，可安全 fork；但 "pptmaster" 名已被 pn1024/dsh-ppt-master 占用，新插件要么 fork 其改名，要么说明为独立实现。

---

## 8. 来源 URL 全列

**DSH 生态插件**
- https://github.com/SuperstructureJH/dsh-workbuddy-ppt ｜ https://www.npmjs.com/package/dsh-workbuddy-ppt（docs：COMPATIBILITY.md / CONFIGURATION.md / ARCHITECTURE.md）
- https://github.com/zbsph/dsh-ppt-studio
- https://github.com/pn1024/dsh-ppt-master
- https://github.com/omdsh-dev/dsh-office
- https://github.com/fuzhengwei/walioffice-dsh-plugin ｜ https://www.npmjs.com/package/walioffice-dsh-plugin
- https://github.com/kw78/dsh-office-tools ｜ https://www.npmjs.com/package/dsh-office-tools
- https://github.com/OMSociety/kimi-ppt-skill（上游 https://github.com/binaryify/open-kimi-ppt-skill）
- https://github.com/dream-num/dsh-univer-office ｜ https://www.npmjs.com/package/dsh-univer-office
- https://github.com/liustack/pptwise ｜ https://github.com/liustack/pptfast
- https://github.com/STARDUSTLC666/dsh-ppt ｜ https://github.com/unStone/dsh-plugin-web-ppt ｜ https://github.com/yejiming/dsh-ppt ｜ https://github.com/chiang21fcb/dsh-ppt-guider
- https://github.com/WoyouWoyou/dsh-office-32k ｜ https://github.com/steven95/dsh-office-suite ｜ https://github.com/didclawapp-ai/DSH-Office
- https://github.com/Mikuzjc/dsh-office-for-mso ｜ https://github.com/wly8691-jpg/dsh-office-com
- 清单：https://github.com/Dominic789654/awesome-deepseek-harness ｜ https://github.com/SihanTeng/awesome-deepseek-harness-plugins
- side-chat 家族：https://github.com/zclDragon/dsh-side-chat ｜ https://github.com/xlennart/dsh-side-chat ｜ https://github.com/Lukeknow0/dsh-side-chat

**通用方案**
- https://github.com/hugohe3/PPT-master ｜ https://github.com/macrochen/ppt-master
- https://github.com/gitbrent/PptxGenJS（npm pptxgenjs 4.0.1）
- https://pypi.org/project/python-pptx/
- https://github.com/MartinPacker/md2pptx ｜ https://github.com/wordflowlab/pptify（npm ai-pptify）｜ https://github.com/kakkoii1337/gai-cli-pptx（npm gai-cli-pptx）
- Slidev https://sli.dev ｜ Marp https://marp.app ｜ Reveal.js https://revealjs.com
- 商业：Gamma https://gamma.app ｜ Beautiful.ai https://www.beautiful.ai ｜ Tome https://tome.app

**DSH 官方契约**
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.zh.md（defineTool 最小形态 / execute 约定 / 后台任务 / UI 卡片）

**调研元数据**
- GitHub API（api.github.com/repos/…）与 npm registry（registry.npmjs.org/…/latest）、PyPI（pypi.org/pypi/python-pptx/json）在线核验版本/许可/依赖（核验时点：2026-09）。
