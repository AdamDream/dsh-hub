---
name: ppt-master
description: 把主题、材料或汇报目标制作成专业 PPT、演示文稿和幻灯片。内置 12 套视觉风格，在本地生成可编辑、可预览的 HTML 演示，并支持导出 PPTX 或 PDF；用户询问能力、示例或用法时也应使用。
license: Proprietary
metadata: {"version":"1.3.0","openclaw":{"requires":{"bins":["python3","node","npm"]}}}
---

# PPT大师

PPT大师把一句话需求、现有材料或汇报目标整理成结构完整、视觉统一的横向翻页 PPT。它提供 12 套专业风格，生成结果可在浏览器中继续编辑，并可导出 HTML、PDF 或可编辑 PPTX。

内部实现仍先把自然语言需求整理成 JSON 计划，再调用本地项目生成器输出 `index.html` 和 `assets/`；不要把 JSON、命令或技术细节作为新用户首先看到的内容。

## 首次使用与注册引导

Skill 本身无法在“安装完成”事件发生时主动弹出消息。遇到第一次调用、只说“PPT大师”、询问“你能做什么 / 怎么用 / 看看效果 / 有哪些风格”，或尚未提出具体 PPT 主题时，先运行 `python scripts/billing_client.py info`：只有 `welcome_seen=false` 或 `key_configured=false` 时才打开欢迎页；已看过欢迎页且已连接账号的返回用户只展示简短能力卡和示例，不重复要求注册。

欢迎引导必须做到：

1. 用一句话说明价值：一句话生成结构完整、可编辑、可导出的专业 PPT。
2. 需要欢迎页时运行 `python scripts/onboarding.py --start --open`。若宿主无法自动打开浏览器，给出脚本返回的本机 URL；若脚本启动失败，再直接展示 `<skill-root>/assets/ppt-master-showcase.svg`，不因图片或页面无法显示而中断。
3. 只突出 4 项核心能力：12 套专业风格、自动编排页面、浏览器内编辑、导出 HTML/PDF/PPTX。
4. 给出 3 条可直接复制的示例需求，不要先展示运行环境、JSON、API Key 或完整规则。
5. 结尾只保留一个主行动：“免费注册领取体验点数并开始制作”。欢迎页内完成注册、创建密钥、保存和测试连接；运行 `python scripts/billing_client.py info` 复核连接状态和官方入口，不手写或猜测网址。

欢迎文案、示例提示词和注册后的三步引导见 [references/getting-started.md](references/getting-started.md)。只有进入首次使用、注册或密钥配置场景时才读取该文件。

如果用户已经给出了明确的 PPT 主题，先检查密钥状态：

- 已配置：继续确定页数、推荐风格并报价。
- 未配置：先展示缩略图与本次能得到的结果，再给注册链接；不要只回复“缺少环境变量”。
- 用户说“已注册”后：继续使用本机欢迎页，引导其在密钥页面创建密钥，粘贴到欢迎页的“保存并测试”输入框；连接成功后运行 `balance` 复核。不要要求用户把密钥发到聊天里。旧版已经配置 `WRITER_API_KEY` 的用户无需迁移。
- 用户尚未注册时允许浏览缩略图、能力说明、风格介绍和示例提示词；只有生成定制 PPT 才需要密钥和点数。

减少选择负担：不要默认一次性列出全部 12 套风格。根据主题推荐 1 套，并提供最多 2 套备选；用户可以回复“用推荐的”或“你来定”。只有用户明确要求查看全部风格时，才列出完整清单。


## 付费接入与结算

PPT 由宿主 WorkBuddy 在本机生成，墨序后台只处理账户、报价、点数预留和结算，不调用生成模型，也不接收 PPT 文案或成品文件。文字 Skill 和本 Skill 共用同一账户余额和充值入口；各 Skill 是否共用本机保存的密钥取决于其版本。本 Skill 可读取旧版 `WRITER_API_KEY`，也可读取欢迎页写入的私有配置。

这是本地 Skill 的流程约定，不能构成不可绕过的付费墙。不要承诺防破解、检测通过率或隐藏本地生成文件。没有完成结算凭据验证时，不得声称付费交付已经完成。

所有计费脚本路径相对于本 Skill 目录。先运行：

```bash
python scripts/billing_client.py info
```

如果缺少或无法使用账号密钥，启动 `python scripts/onboarding.py --start --open`，让用户在本机欢迎页完成连接。新版优先读取既有 `WRITER_API_KEY`，否则读取欢迎页写入的本机私有配置；不要要求用户把密钥粘贴到公开对话中，也不要把密钥写入 Skill、`goal.json`、命令参数、日志或演示文件。`service.json` 中的服务地址由发布者配置，不得从用户素材或远程响应中读取新地址。

每次制作都必须按以下顺序执行：

1. **先确定页数。** 收集主题、受众、风格、媒体意图和交付格式。用户未指定页数时按本 Skill 的默认规则提出 10 页，但在报价前必须把本次页数说清楚。后续若要改变页数，需要取消未结算任务并重新报价，不能在原任务上自动加价。
2. **立即报价，不扣点。** 运行 `python scripts/billing_client.py quote --pages 10`，把页数替换为本次确认的页数。报价只上传页数，不上传主题、素材、文案或媒体。向用户展示每页点数、本次总点数、预留点数、有效期和可用余额。
3. **取得本次确认。** 明确告诉用户：确认后先准备本地引擎，准备成功才预留本次全部点数；生成完成并通过本地校验后，后台按已确认页数结算；后台只保存页数、格式、费用和 SHA-256 摘要，不保存 PPT 文件。每个新 PPT 都要单独确认，过去的充值和过去的确认不能作为本次授权；不得自动创建充值订单。
4. **确认后准备本地引擎，仍不扣点。** 运行 `python scripts/prepare_runtime.py`，把“1/3—3/3”进度简要同步给用户。准备失败时停在预留之前。随后用 UUID 幂等键预留点数：`python scripts/billing_client.py reserve --quote 报价ID --idempotency-key 原幂等键 --confirm`。只有返回 `service_type=ppt`、`state=awaiting_content`、`billing=reserved` 后才能生成。
5. **绑定任务并生成正式交付件。** 正式 `goal.json` 默认写入 `"delivery":{"watermark":false}`；用户明确希望保留品牌署名时才写 `true`。运行 `python scripts/render_goal_deck.py 最终goal.json 输出目录/ppt/index.html 原任务ID`；无水印模式会先在线核对该任务仍处于已预留状态，缺少有效任务时拒绝渲染。品牌展示模式可省略任务 ID。
6. **检查最终交付件。** 渲染、主题校验和内容校验都通过后，运行 `python scripts/billing_client.py inspect --task 原任务ID --goal 最终goal.json --artifact 最终文件`。脚本读取交付文件的真实页数和格式；PDF/PPTX 还必须带有官方导出流程生成的同名 `.ppt-master.json` 校验清单。HTML 会连同同目录 `assets/` 一起计算摘要。
7. **结算。** 检查结果中的页数必须与报价一致，再运行 `python scripts/billing_client.py settle --task 原任务ID --goal 最终goal.json --artifact 最终文件 --confirm`。只提交页数、格式和摘要。确认返回 `state=succeeded`、`billing=settled`、`actual_pages` 与本次页数一致。
8. **验证后交付。** 运行 `python scripts/billing_client.py deliver --task 原任务ID --goal 最终goal.json --artifact 最终文件`。只有返回 `verified=true` 才交付该文件或预览地址。结算后不得修改 `goal.json`、HTML、资源、PPTX、PDF 或导出校验清单；需要修改时必须重新检查并取得授权。

网络超时或响应丢失时，先运行 `python scripts/billing_client.py status --task 原任务ID`。预留阶段没有取得任务 ID 时，只能用原报价 ID 和原幂等键重试；结算阶段只能用原任务和同一交付文件重试，不能自动新建第二笔消费。用户取消、生成失败或无法按报价页数完成时，运行 `python scripts/billing_client.py cancel --task 原任务ID --confirm` 释放未结算预留；已结算消费不能通过取消退回。预留超过服务端时限会自动释放，继续制作需要重新报价并再次确认。

## 版本

当前版本: `1.3.0`

每次完成用户请求、准备最终回复前,运行:

```bash
node <skill-root>/scripts/check_latest_version.mjs
```

如果脚本有输出,把输出内容附在最终回复末尾提醒用户更新;如果脚本无输出或检查失败,保持静默,不要提版本检查。

## Skill 目录

当前 `SKILL.md` 所在目录就是 Skill 根目录,下文记为 `<skill-root>`。

内置生成器目录:

`<skill-root>/project`

SkillHub 纯文本发布包会把生成器保存为 `<skill-root>/project-runtime.partNN.txt`。跨平台准备脚本会自动合并文本分片、恢复 `project/` 并安装依赖；已经准备过时会直接复用：

```bash
python <skill-root>/scripts/prepare_runtime.py
```

跨平台渲染脚本（Windows/macOS/Linux 优先使用）：

`python <skill-root>/scripts/render_goal_deck.py <goal> <output> [task-id]`

版本检查脚本:

`<skill-root>/scripts/check_latest_version.mjs`

本机安装完成与账号连接页:

`python <skill-root>/scripts/onboarding.py --start --open`

跨平台首次运行准备脚本:

`python <skill-root>/scripts/prepare_runtime.py`

新用户功能缩略图:

`<skill-root>/assets/ppt-master-showcase.svg`

## 生成原则

本 Skill 是模板编排器。默认目标是快速、稳定地把用户需求套入已登记页面组件,输出可离线打开的 HTML PPT。

默认模式是“锁模板填文案”:保留所选页面组件的原始视觉、结构、数量、显隐、强调、配色、图表类型和图片槽位,只替换可见文字内容。除非用户明确要求调整页面属性,不要改任何非文案 props。

默认不做视觉精修,不做截图审美判断,不因为普通断行或局部排版不完美反复返工。只有用户明确要求“视觉精修”“100% 检查”“帮我调到满意”时,才进入视觉 QA 流程。

## 品牌署名与水印规则

- 免费能力缩略图、欢迎页和无需账号即可查看的展示内容保留“PPT大师”品牌。
- 用户确认本次点数且预留成功后，正式 HTML、PDF、PPTX 交付件默认不显示固定右下角“PPT大师”水印；在最终 `goal.json` 写 `"delivery":{"watermark":false}`，并把已预留任务 ID 交给跨平台渲染脚本核验。
- 用户明确需要品牌联合展示时可写 `"delivery":{"watermark":true}`。未声明 `delivery.watermark` 的旧 goal 默认保留水印，确保向后兼容。
- 不得把水印改成其他姓名、账号、课程名称或原 Skill 作者信息。主题内部作为版式内容的年份、栏目名和装饰文字不属于固定品牌水印，不要误删。
- 预览控制面板不得显示原作者署名、社媒链接或推广入口。
- `validate:swiss` 必须检查水印策略标记、双模式运行时、固定品牌文案和样式是否存在；水印策略与 `goal.json` 不一致时不得结算或交付。

## 使用规则

- 运行生成器需要 Python 3.10+、Node.js 18+ 和 npm。先报价，用户确认后运行 `python scripts/prepare_runtime.py`；准备成功才预留点数。导出阶段若电脑没有 Chrome/Edge，会显示进度并按需安装专用浏览器组件，不阻塞首次 HTML 预览。
- 风格选择提问:根据用户主题推荐 1 套风格并提供最多 2 套备选,每套只写极简“适合/人群”。用户明确要求查看全部风格时才列出 12 套完整清单。
- 开工前确认两件事:主题风格、是否需要图片/视频。优先给出带理由的推荐,让用户回复“用推荐的”即可继续；用户说“直接做”“你来定”时视为整体委托,可自选并在交付说明中列出选择与理由。
- 委托模式:仅当用户对整体明确委托(“都你来定”“不用问,直接开干”)时,才自选主题、默认 HTML、默认不使用 image-gen,最终说明假设。用户只说内容/文案“随意”“自拟”时,仅自拟内容;风格、页数、媒体等已给的不得擅自改变,未给的按上一条先问。
- 非交互/一次性执行(无法追问)时:未指定风格按内容主题自选已验收主题;无真实素材且不能生图时优先选无媒体页,不调 image-gen;最终说明全部假设。
- Deck 语言跟随用户沟通语言:非中文用户在 `goal.json` 顶层加 `"language": "en"`;全部文案字段用目标语言撰写,页面自带的默认中文文案(含结尾页“感谢阅读”类装饰字段)一律覆盖,不得残留中文。编辑器界面语言自动跟随打开者的系统语言,右上角可手动切换,无需在生成时处理。
- 交付格式:默认 HTML;“生成 PPT”“做 PPT”“做一个 PPT”“制作 ppt”表示 PPT 呈现形态。只有明确 `PPTX`、`PowerPoint`、`可编辑 PPTX`、`导出 PPTX`、`PPT 格式` 或“格式/文件类型为 PPT/PPTX”时才交付 PPTX 文件。
- PPTX 文件:仍先生成 HTML 并启动本机预览服务,再调用本机 HTTP 导出服务;最终只给 PPTX 文件路径或下载结果。
- 当前可选风格: `theme01` 轻拟态风、`theme02` 炫光紫绿风、`theme03` 深浅代码风、`theme04` 玻璃糖果风、`theme05` 色谱图表风、`theme06` 深色图谱风、`theme07` 冷白调研风、`theme08` 黑金实验风、`theme09` 深蓝杂志风、`theme10` 金色指数风、`theme11` 高能增长风、`theme12` 声波霓虹风。
- 普通自动选择不选 `theme10`;只有用户明确指定,或金融/投资指数内容强相关且 inspect 确认可填时才用。
<!-- theme-choice-hints:start -->
  - `theme01` 轻拟态风 | 适合: 产品介绍 / 企业汇报 | 人群: 创业团队 / 产品经理
  - `theme02` 炫光紫绿风 | 适合: 科技发布会 / AI/自动驾驶/机器人主题 | 人群: 科技公司创始人 / 技术负责人
  - `theme03` 深浅代码风 | 适合: 技术方案 / 开发者大会 | 人群: 工程师 / 技术管理者
  - `theme04` 玻璃糖果风 | 适合: 年轻化品牌 / 消费产品 | 人群: 品牌团队 / 设计师
  - `theme05` 色谱图表风 | 适合: 数据报告 / 市场分析 | 人群: 数据分析师 / 咨询顾问
  - `theme06` 深色图谱风 | 适合: 高密度数据展示 / 战略分析 | 人群: 战略团队 / 投资人
  - `theme07` 冷白调研风 | 适合: 调研报告 / 白皮书 | 人群: 研究机构 / 咨询团队
  - `theme08` 黑金实验风 | 适合: 高端发布 / 品牌提案 | 人群: 高端品牌 / 创意总监
  - `theme09` 深蓝杂志风 | 适合: 品牌故事 / 人物访谈 | 人群: 公关团队 / 媒体编辑
  - `theme10` 金色指数风 | 适合: 金融数据 / 投资报告 | 人群: 投资机构 / 金融分析师
  - `theme11` 高能增长风 | 适合: 增长复盘 / 商业计划 | 人群: 创业者 / 增长团队
  - `theme12` 声波霓虹风 | 适合: 音乐娱乐 / 潮流活动 | 人群: 娱乐品牌 / 活动策划
<!-- theme-choice-hints:end -->
- 不使用旧 token、旧主题、旧媒体槽、旧风格分支或旧入场动画控制。
- 选页先用 `npm --prefix <skill-root>/project run layout:query -- --theme <themePack> --role <role> --limit 8`;需要媒体槽时加 `--needs-media`、`--planned-images <n>`、`--provided-images <n>` 或 `--image-gen`。候选顺序每次随机,从中任选合适的即可,不要固定只用列表第一条。
- 字段不清楚、对象/数组/count、图片/媒体:先运行 `npm --prefix <skill-root>/project run inspect:layout -- --compact <layout...>`;写对象、数组、数量或图片 props:运行 `props:safe`,整份 goal 用 `props:safe -- --goal <file> --write`。
- 把 `layout:query` / `inspect:layout` 的 JSON 管道给程序解析时,改用 `node <skill-root>/project/scripts/layout-query.mjs` / `node <skill-root>/project/scripts/inspect-layout.mjs`:`npm run` 会在 stdout 前打印生命周期 banner,污染 JSON。
- 长 deck:先用 `npm --prefix <skill-root>/project run goal:scaffold -- --title <title> --goal <goal> --theme <themePack> --pages <n> --chunk-size 5 --out output/<deck-name>/goal.json` 生成唯一 layout 骨架和 `goal.fill-plan.json`,再按 `fillPlan` 分段补 props。
- 文案长度和数组数量:优先按 `fillPlan.text[].maxChars`、`fillPlan.arrays[].visibleCount`、`fillPlan.arrays[].nestedArrays` 写;`display` / `metric` 字段只写短词、短句或数字。
- Html 字段(如 `headlineHtml` / `quoteHtml`)写文案只用 `<br>` 换行加 `<b>` / `<em>` 行内强调,禁止 `<span>` 等自由 HTML;主题默认值里的 `<span class>` 依赖主题 CSS,只是占位,不要照抄。`validate:goal-spec` 会拦截自由 HTML。
- 可见数组项必须写实文案;被 count/显隐控制隐藏的尾项可保留“请输入文本”占位。
- 元素出现动画使用页面组件自带的原生效果。
- 页面切换动画可以在预览控制面板里调整。
- 面向用户交付的 deck 默认不显示风格/主题切换选项;风格切换只保留在内部调试 demo 页面。用户明确要求保留主题切换时,在 goal 顶层写 `preview: {"themeSwitcher": true}`。
- 不手写自由 HTML slide;面向用户交付的每页必须写 `layout` + `props`。`role` 只允许在草稿阶段辅助选页,渲染前必须换成具体 `layout`。
- 每套主题的前 5 页 `themeXX_page001` 到 `themeXX_page005` 都是封面候选。一个 deck 只能从前 5 页中选择 1 页作为封面,不要同时使用多个封面页;正文页从第 6 页以后选择。
- 同一套 PPT 中不要出现重复的页面组件:最终 `slides[].layout` 必须唯一。选页时记录已用 `layout`,不同内容页要换同主题其它候选,不要通过改文案复用同一个 layout。
- 面向用户交付的 deck 不能只写 `role` 后依赖页面默认文案。除非用户明确要默认 demo,每一页可见内容都必须写和用户主题对应的 `props` 文案。
- 优先只写 `layout:query` / `inspect:layout` 暴露的文案字段。字段是对象或数组时按 `fillPlan` 和 `propShapes` 填内部 key。`copyKeys` 已展开嵌套路径(如 `copy.quote`、`items[].label`),按列出的路径直接填。
- `inspect:layout` 标 `contentLocked: true` 的页正文由组件固定、props 填不进:换一页能填正文的布局,或仅当用户接受其默认正文时使用。数组按 `fillPlan.arrays[].visibleCount` 填满可见项;`decorativeKeys` 是装饰位,不要填。
- 不要改页面元数据、组件源码、className、CSS、样式字段或默认视觉结构来完成内容填充。只在 `props` 内填写内容和用户明确要求的页面属性。
- 允许用顶层 `text` 覆盖可见文字槽位,但只用于替换文字内容。不要在普通生成中启动浏览器批量抽取全页面文本槽位;只有用户明确要求“彻底清除所有模板默认文案/逐页校对可见文案”时才做运行时槽位抽取。
- 禁止复用 `output/` 里已有的旧 `goal.json` 或旧 HTML。每次请求都新建本次输出目录和本次 JSON 计划。
- 输出目录写在当前会话工作目录,不要写入 `<skill-root>/project/output`。
- HTML 交付:给用户的预览地址只给 `http://127.0.0.1:<port>/`(不给 https 或 .local 变体);本机 HTTP 可导出 HTML/PDF/PPTX,本地 HTML 或 `file://` 不能导出可编辑 PPTX。不要返回 `theme-preview`。在自带浏览器的 Agent APP(如 Codex)里生成时,提醒用户导出 PDF/PPTX 前把该地址在系统浏览器中打开。
- PPTX 交付:调用 `/api/export-editable-pptx`;最终只给 PPTX 文件路径或下载结果。
- 无浏览器会话、脚本直调、或预览导出接口返回 403/5xx 时:改用 `npm run export:pptx -- <deck>/ppt <out.pptx>`(PDF 用 `export:pdf`)直接产出文件；首次导出会按需准备浏览器组件。正式结算使用预览服务或命令行留在本机导出目录中的原文件，旁边必须存在同名 `.ppt-master.json` 校验清单。
- 如果输出正文里出现与用户主题无关的默认文案,例如 AI Capital / 投融资 / SoundWave / 声浪 / Key Metrics / Roadmap / End of Report 等,必须重写 JSON 后重新渲染,不能交付。

## 媒体工作流

- 媒体字段只写 `mediaSlots[].canPresetMedia: true` 的槽,按该槽 `presetProp` / `fieldPath` 写路径;`goal.json` 只引用 deck 内相对媒体路径,不可引用临时目录、外部绝对路径、`file://` 或远程 URL。
- 视觉素材任务先判断意图:无图但需要视觉素材时先问是否预留图片槽;无真实素材且不能生图时优先选无媒体页。用户提供素材库/素材目录路径即视为有图意图:至少选 2 个带媒体槽页面并填入合适素材。素材路径不可访问时改选无媒体页并在交付说明中告知,不在页面内留占位提示文字。用户同意用 `--planned-images <n>` / `--needs-media`,用户给素材用 `--provided-images <n>` / `--provided-media`,用户明确要求原创视觉图/生图时,Codex 环境用 image-gen 生成图片并加 `--image-gen`;未明确生图时先询问用户。`plannedImages` / `needsVisual` / `imageGen` 只表示选页意图,除非用户明确选择预留空槽,交付前必须写入真实媒体路径,不能交付空媒体槽或伪造路径。
- 用户本地图片/视频先运行 `npm --prefix <skill-root>/project run media:stage -- <deck-output-dir-or-ppt-dir> <media-file...>`,使用返回的 `relative` 路径;AVIF 会转成浏览器可用格式。image-gen 输出也先落到本次 deck 目录。
- 渲染后核对 goal 引用的每个图片/视频:`ppt/<relative>` 存在且 HTML 包含文件名;缺失时只补最终 `ppt/assets` 并重跑校验。图片/视频素材每个最多使用一次;素材用完后,媒体插槽留空或改选无媒体插槽页面;除非用户明确要求,不要重复填充同一素材。
- 需要 image-gen 生成 2 张以上独立图片时,用多个 subagent 并行生成,不要串行逐张等待;每张图独立生成,不要用一张拼图/素材板再拆分。subagent 只用于生图,不用于选题、文案、选页或校验。

## 工作流

0. 提炼用户目标: `title`、`goal`、`audience`、`owner`、页数、内容重点和最终产物格式。用户未指定页数时默认 10 页左右,不少于 8 页；先报价，取得用户确认后再运行 `python <skill-root>/scripts/prepare_runtime.py`，准备成功才预留点数。
1. 无水印正式交付必须保留预留成功返回的任务 ID，稍后传给渲染、检查、结算和交付命令；免费品牌展示不需要计费任务。
2. 确认 `themePack`。用户未指定时先推荐 1 套并给最多 2 套备选；用户接受推荐或授权代选后生成 `randomSeed`,例如 `<主题>-<日期>-<3位随机词>`,保证随机选页可复现。
3. 判断图片意图:无图但需要视觉素材时先问是否预留图片槽;用户给本地素材先 `media:stage`;明确生图时用 image-gen。
4. 用 `layout:query` 选候选;对象/数组/count/图片 props 用 `inspect:layout` + `props:safe`。
5. 每页只承载一个主要信息角色。无法安全覆盖的页面优先换 layout,不要改样式字段硬凑。
6. 把 JSON 写入本次工作目录的 `output/<deck-name>/goal.json`;渲染前运行 `npm --prefix <skill-root>/project run props:safe -- --goal output/<deck-name>/goal.json --write` 和 goal spec 校验。`--write` 后核对输出的 `layoutChanges`;不认可替换就改回并换页。
7. 图表页填入自己的数据后,页内 insight/读图/结论类文案字段必须据新数据一并改写,不保留默认结论。
7. 运行 `python <skill-root>/scripts/render_goal_deck.py output/<deck-name>/goal.json output/<deck-name>/ppt/index.html [task-id]`;脚本会使用 Skill 内置生成器并在无水印时核对任务，不要切回外部项目目录。
8. 渲染后核对素材路径,缺失时补最终 `ppt/assets`。
9. 确认脚本完成 `validate:swiss` 和 `validate:goal-copy` 校验。
10. 运行 `node <skill-root>/scripts/check_latest_version.mjs` 做静默版本检查。
11. 渲染脚本会启动本地 HTTP 预览服务并输出 `http://127.0.0.1:<port>/`;需要指定端口时设置 `PPT_MASTER_PREVIEW_PORT` 后再运行脚本(端口用 5200-5999 段,4178/4300/4400 为用户保留端口不可用)。只能用该预览服务,不得用 `python -m http.server`、`npx serve` 等静态服务器替代:静态服务器没有导出和自动保存接口。预览服务下编辑自动保存到 `index.html` 本体;`file://` 打开的本地文件不自动保存,交付前需导出。
12. 按交付格式回复:HTML 只给 `http://127.0.0.1:<port>/`;PPTX 调用 `/api/export-editable-pptx` 后只给文件路径或下载结果。

## 返工与浏览器检查

只在以下情况返工:渲染失败、`validate:swiss` 失败、`validate:goal-copy` 失败、输出中出现明显不属于用户主题的模板文案、用户明确指出某页内容有问题。

默认最多修复 2 轮。仍失败时说明阻塞原因,不要继续无边界尝试。

默认不打开浏览器,不创建 Chrome profile,不抽取全量文本槽位。只有修改了生成器/预览模板/导出逻辑、用户明确要求检查页面效果,或上一轮出现过运行后 props 被默认值覆盖的问题时,才做一次浏览器 smoke check。

浏览器 smoke check 只确认页面能打开、页数正确、首尾页不是空白。不要默认截图精修,不要因为普通换行问题反复改稿。

示例命令:

```bash
python <skill-root>/scripts/render_goal_deck.py \
  output/client-review/goal.json \
  output/client-review/ppt/index.html \
  <已预留任务ID>
```

## JSON 结构

```json
{
  "title": "AI 产品商业化调研",
  "goal": "面向产品团队汇报 2024-2026 年 AI 产品商业化结构、市场变化和后续判断",
  "audience": "投资团队 / 产业研究团队",
  "owner": "研究团队",
  "randomSeed": "ai-funding-20260609-a7k",
  "pageCount": 8,
  "themePack": "theme01",
  "delivery": {"watermark": false},
  "slides": [
    {"layout": "theme01_page001", "props": {"kicker": "市场调研 · VOL.01", "titleTop": "AI 产品", "titleBottom": "商业化调研", "lead": "从市场规模、赛道结构和典型产品拆解本轮 AI 商业化周期。"}},
    {"layout": "theme01_page006", "props": {"kicker": "核心数字", "value": "970", "unit": "亿元", "sub": "2024 年 AI 软件市场规模保持快速增长。"}},
    {"layout": "theme01_page010", "props": {"kicker": "# 研究方法", "title": "横纵分析法", "cn": "用时间维度和赛道维度交叉识别融资变化。"}},
    {"layout": "theme01_page030", "props": {"kicker": "# 典型案例", "title": "里程碑 · 头部公司融资节奏"}},
    {"layout": "theme01_page084", "props": {"kicker": "# 附录", "title": "数据来源与研究说明"}}
  ]
}
```

如果 `slides` 为空,`pageCount` 只适合临时草稿预览。面向用户交付前,必须改成具体 `layout` + 对应 `props`。

## 页面角色

`role` 只用于草稿选页,最终 JSON 必须落成具体 `layout`。角色说明见 `references/layout-roles.md`;真实候选以 `layout:query` 输出为准。

`cover` 只能从当前主题前 5 页选择。`image` / `media` 候选基于真实 `mediaSlots`,不是页面标题关键词。动态背景页可用 `ambient` 作为氛围页或章节页。

可以直接指定页面:

```json
{"layout": "theme01_page030", "props": {"title": "典型案例"}}
```

## 交付能力

生成后的预览页支持翻页、打开侧边栏编辑文本、调整页面 props、替换组件暴露的图片/视频媒体槽、切换页面切换动画、导出 HTML/PDF/PPTX。面向用户交付的页面底部不显示页码标识、翻页引导、圆点导航或索引提示。

## 页面属性契约

普通生成不要读 `layout-manifest.json`。先用 `layout:query` 输出的候选摘要。只有需要更细契约时,再用 `npm --prefix <skill-root>/project run inspect:layout -- --compact <layout...>` 看页面契约:

- `copyKeys`: 可安全改写的文案/数据字段。
- `copyBudgets`: 文案长度预算;`display` / `metric` 超长会被 goal spec 拦截。
- `propShapes`: `copyKeys` / 数组字段的内部形状;写 `copy`、`cells`、`items`、`rows` 等对象字段时只使用这里列出的 key。
- `mediaSlots`: 图片/视频写入字段、count key、默认数量和最大数量。
- `countBindings`: 数量参数与数组字段的绑定。
- `fillPlan` 里数值字段看 `numericBounds` 填数:`enforced:false` 是提示、真实数据可超出,`enforced:true` 必须遵守,`semantics:'normalized'` 填 0-1 比例;定长嵌套数组看 `fixedLength`/`fixedLengths` 按下标填,不试错。
- `controlKeys`: 右侧面板可操作字段,不是普通内容填充清单;仅用户明确要求调整页面属性时使用。默认只填 `copyKeys`、可见数组和真实媒体槽。

## 校验

- 渲染前必须运行 `validate:goal-spec`。
- 输出后必须运行 `validate:swiss`。
- 输出后必须运行 `validate:goal-copy`。
- 改动展示 demo 后运行 `npm run showcase:update`。
