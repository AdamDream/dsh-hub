# pptmaster 的 **skill 形态** 调研报告（skill vs 插件合并结论）

> 任务：用户指出「还有一个叫 pptmaster 的 **skill**」——上一轮（`pptmaster-research.md`，2026-09-14）只调研了 PPT **插件生态**；本轮专门把 **skill 形态** 的 pptmaster 查清（GitHub / npm / SkillHub 市场上 SKILL.md 形态的 PPT 生成 skill），并与插件路线合并成最终结论。
> 调研方法：本机 `~/.dsh/`、DSH 官方包源码（`@deepseek-ai/dsh-skill-filesystem` / `dsh-skill` / `dsh-tool-skill` 的 README 与 lib）+ web_search + GitHub raw/codeload + npm registry + SkillHub 公开 API（api.skillhub.cn）+ **真实克隆三个仓库并实跑完整性门禁**（2026-09，数据以核验时点为准）。
> 部署背景：DSH `0.1.1-rc.2`（`dsh --version` 实测）、Node v22.23.2、Python 3.12.3 + pip 24.0（**未装 python-pptx**）、无 LibreOffice/Office、pypi 可达（200）、默认 preset 为自建 `standard-glm`（含 `skill-filesystem` + `tool-skill` 两行，见 `~/.dsh/.agent-presets/standard-glm/agent.cordis.yml` L83-87）。
> 本报告产出物：仅本文件；调研中间产物在 `.workspace/tmp-ppt-research/`（克隆与下载缓存，可清理）。

---

## 0. 结论摘要（TL;DR）

1. **本机 `~/.dsh/skills/` 下没有 pptmaster（也没有任何 ppt/office skill）**，只有 `grill-me` 一个自装 skill（2026-09-05 落盘）。DSH 的 skill 加载机制在 0.1.1-rc.2 上完整可用，`~/.dsh/skills/<name>/SKILL.md` 是官方支持的用户级 skill 根。
2. **「pptmaster 的 skill 形态」在网上是真实存在的，且不止一个**，全部是 [hugohe3/PPT-master](https://github.com/hugohe3/ppt-master)（上游，MIT）的 skill 打包/包装：
   - **纯 skill 形态**：[opencentra/ppt-master-skill](https://github.com/opencentra/ppt-master-skill)（"package PPT Master as a skill for claude code"，SKILL.md 目录包，可平移进 DSH `~/.dsh/skills/`）；
   - **DSH skill-provider 插件形态**：[pn1024/dsh-ppt-master](https://github.com/pn1024/dsh-ppt-master)（v6.1.0，`ctx.skills.registerProvider` 包装同一 skill，engines `dsh>=0.1.1-rc.1` —— **与本机 0.1.1-rc.2 契约吻合**，实测完整性门禁 exit 0）；
   - **npm 发行形态**：[`@ljwei-stak/ppt-master-for-mgr`](https://www.npmjs.com/package/@ljwei-stak/ppt-master-for-mgr)（v6.3.3，peer 要求 `@deepseek-ai/dsh-skill-filesystem ^0.1.2-rc.1 || ^0.1.5-rc.1` —— **与本机 0.1.1-rc.2 版本冲突，装不上**）；
   - **同名仓库**：[luonghaianh1208/PPTmaster](https://github.com/luonghaianh1208/pptmaster)（越南语 fork，仓库名就叫 PPTmaster，SkillsMP 上显示为 creator `luonghaianh1208/pptmaster` + skill `ppt-master`——很可能是用户看到的那条）。
3. **SkillHub 市场上还挂着多个叫 "ppt-master" 的 skill，质量/许可参差**：有 MIT 薄包装、有 **Proprietary + 付费计费**（`@user_ecd462ed/ppt-master`"PPT可编辑大师"带 billing_client.py、注册引导、点数结算），npm 上 `pptmaster` 精确名不存在。**装市场 skill 前必须审查 SKILL.md 与 scripts（供应链风险）。**
4. **对比结论（本部署 0.1.1-rc.2）**：skill 形态 = 决策指引 + Python 脚本，能力面**最全**（生成 + 编辑既有 pptx + 模板填充 + 增强 + SVG 工作区预览），但确定性弱、token 重、依赖 Python 依赖树；插件形态（defineTool + client UI + settings）确定性渲染强（dsh-workbuddy-ppt 纯 Node、peer 恰好 `^0.1.1-rc.2`），但**只写不读**、无编辑既有 pptx 能力。
5. **最终建议 = C（组合），A 先行、B 并行**：A）装 pn1024 的 ppt-master skill（进 catalog 即用，编辑能力靠其 Edit Native PPTX route）；B）并行装 dsh-workbuddy-ppt 做确定性渲染/校验/预览兜底；两者以工作区 .pptx + 图片资产为衔接边界，btw 产图共用同一 imageDir。**明确排除**：ljwei npm 版（peer 版本不符）、SkillHub 付费 PPT大师（闭源计费）、zbsph/dsh-ppt-studio（基线 0.1.5-rc.2，需 port 核对）。

---

## 1. 本地 skills 核查（0.1.1-rc.2 实机证据）

### 1.1 `~/.dsh/skills/` 现状：无 pptmaster

```
$ ls -la ~/.dsh/skills/
drwxr-xr-x 3 CNS2026495165 CNS2026495165 4096 9月  5 11:17 grill-me   # 唯一自装 skill
$ grep -ril "pptmaster" ~/.dsh 2>/dev/null
# 仅 session-board 的 peers/storages 缓存里有历史会话提到 pptmaster，无实际 skill/插件文件
```

- 项目级根 `/home/CNS2026495165/dsh/.dsh/skills/` 与 `~/.agents/skills/` 也不存在/为空 → 本机无任何 ppt/office skill。
- 唯一 skill `grill-me` 是目录包形态：`~/.dsh/skills/grill-me/SKILL.md`（frontmatter 含 `name`/`description`/`disable-model-invocation: true`），与本会话 `skill` 工具目录一致 → **本地 skill 通道已验证可用**。

### 1.2 DSH skill 的目录结构与本机加载机制（官方包源码为准）

来源：`@deepseek-ai/dsh-skill-filesystem` README + `lib/index.js`（装在 `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/` 下，版本全部 `0.1.1-rc.2`）。

| 事实 | 值 | 证据 |
|---|---|---|
| 用户级根 | `$DSH_HOME/skills`（`$DSH_HOME` 默认 `~/.dsh`） | skill-filesystem README「Discovery」表，rank 400 |
| 项目级根 | `<最近 .git 祖先>/.dsh/skills`（rank 100）、`<项目>/.agents/skills`（rank 200） | 同上 |
| 其它根 | `Config.customSkillDirs`（rank 300）、`~/.agents/skills`（rank 500）、`$DSH_BUNDLED_SKILL_DIR`（内置，rank 600） | 同上 + `lib/index.js` L155-184 |
| 识别形态 | 仅一层：`<root>/<name>/SKILL.md` 目录包 或 `<root>/<name>.md` 平铺；**嵌套 SKILL.md 一律忽略** | README「Skill Format」「Known Limitations」 |
| frontmatter 必需 | `name`（kebab-case）+ `description`；可选 `whenToUse`/`metadata`/`disable-model-invocation`/`user-invocable`；其余键（如 `license`、`metadata` 嵌套对象）宽容处理 | `lib/index.js` L672-693（缺 name/description 的整包丢弃并 warn） |
| 热发现 | Chokidar watch，SKILL.md/目录增删与 frontmatter 变化即失效重发现；**无需重启**（vonweller/dsh-skillhub README 同述："picks them up without a restart"） | skill-filesystem README「Catalog Change Detection」 |
| 模型侧 | 会话首条前注入 `<available_skills>` 目录（name + 截断至 500 字描述）；`skill` 工具按精确 kebab-case 名加载，返回 `{name, provider, resourceBase, content}`，references/scripts 按需读 | `@deepseek-ai/dsh-tool-skill` README「Session catalog」+「Tool: skill」 |
| 插件内嵌注册 | 插件可用 `ctx.skills.registerProvider(...)` 注册自带 skill（`BUNDLED_SKILL_RANK=600`），如 pn1024/dsh-ppt-master 的 index.js | `dsh-skill/lib/index.js` L23、L147 |

> 结论：**任何 `<name>/SKILL.md` 目录包（含 references/scripts/templates/workflows 子目录）拷到 `~/.dsh/skills/` 即被识别**；子目录资源不进 catalog、不进 model 上下文，由 skill 正文按需引用（resourceBase 提供绝对目录）。

### 1.3 本机可用的 skill 来源（市场/仓库约定）

| 来源 | 说明 | 与本机 0.1.1-rc.2 兼容性 |
|---|---|---|
| [SkillHub（api.skillhub.cn）](https://www.skillhub.cn/) | 事实上的 DSH skill 市场（腾讯云），`GET /api/skills?keyword=` 搜索、`GET /api/v1/download?slug=&namespace=` 下载 zip | 下载产物就是 `<name>/SKILL.md` 包，直放 `~/.dsh/skills/` 即可 |
| [vonweller/dsh-skillhub](https://github.com/vonweller/dsh-skillhub) | Settings → Skill Market 面板，一键装到 `~/.dsh/skills` | README 写 "Requires DSH 0.1.2+"（未验证 0.1.1-rc.2） |
| [peiqi10086/dsh-skills-market](https://github.com/peiqi10086/dsh-skills-market) | 侧边栏面板 + SkillHub 商城 + `dsh_skillhub_search` 工具 | **明确标注已在 0.1.1-rc.2 验证**（README） |
| [pn1024/dsh-skill-market](https://github.com/pn1024/dsh-skill-market) | 聚合 SkillHub + ClawHub，聊天栏技能选择器 | 未标注基线 |
| [hackerFish/awesome-dsh-skills](https://github.com/hackerFish/awesome-dsh-skills) | 19 个自研 skill，格式校验 + 冒烟加载，"Copy, drop in, done" | 冒烟基线正好是 `dsh-skill-filesystem@0.1.1-rc.2`（README） |
| 仓库直拷 | 任意 GitHub 仓库里的 `<name>/SKILL.md` 目录包 | 见 §2 各仓库 |

---

## 2. 联网核查「pptmaster skill」全谱（逐个查清）

> 名源梳理：用户说的「pptmaster」大概率指 [hugohe3/PPT-master](https://github.com/hugohe3/ppt-master)（事实上的 "PPT Master"，MIT）的 **skill 打包**（opencentra 打包名就叫 "PPT Master skill"）；"pptmaster" 在 GitHub 上有同名仓库 [luonghaianh1208/PPTmaster](https://github.com/luonghaianh1208/pptmaster)；npm 精确名 `pptmaster` 不存在；SkillHub 上无精确 "pptmaster"，但有多个 "ppt-master"。

### 2.1 skill 形态发行谱（SKILL.md 内容要点 / 依赖 / 许可 / peer 约束）

| # | 仓库 / 包 | 形态 | 版本 | SKILL.md 要点 | 运行依赖 | 许可 | peer / engines 约束（对 0.1.1-rc.2） |
|---|---|---|---|---|---|---|---|
| 1 | [opencentra/ppt-master-skill](https://github.com/opencentra/ppt-master-skill)（"package PPT Master as a skill for claude code"） | **纯 skill 目录包**（`skills/ppt-master/SKILL.md` + references/scripts/templates/workflows，**带 `.claude-plugin/marketplace.json`（Claude Code 市场打包，raw 实测 200）**） | SKILL.md `metadata.version 4.5.0`（上游 **4.x 线，滞后**于 pn1024 的 6.1.0） | 路由式工作流：SKILL.md 只负责「全局纪律 + 路由选择」，7 条路由（Generate / Quick / Beautify / Image→PPTX / Create Template / Fill Native PPTX / Enhance Native PPTX）各读 `workflows/profiles/*.md`；强制先跑 `scripts/attribution_guard.py` 完整性门禁（非零即停，禁止绕行）；绝对路径 `SKILL_DIR`、串行执行、⛔ BLOCKING 门、角色切换模板。仓库整体 >100MB（docs assets + 完整 skill 资源，jsdelivr 因 >50MB 拒列目录） | Python 3.10+；`requirements.txt` 递归引用 `skills/ppt-master/requirements.txt`（python-pptx>=0.6.21、XlsxWriter>=3.0.0、skia-pathops、uharfbuzz、edge-tts、PyMuPDF，多数可选；requirements 自述"大部分工具仅用标准库"） | MIT（上游） | 无 DSH 依赖（Claude Code 目标宿主；DSH 下即 `~/.dsh/skills/ppt-master/` 直拷，受 DSH 一层发现 + frontmatter 规则约束——name/description 齐全、kebab-case，**可直接加载**；已核实 `skills/ppt-master/workflows/routing.md`、`scripts/attribution_guard.py`、`requirements.txt` 均在） |
| 2 | [pn1024/dsh-ppt-master](https://github.com/pn1024/dsh-ppt-master) | **DSH 插件包装 skill**（`index.js` 用 `ctx.skills.registerProvider` 注册 `skills/ppt-master/SKILL.md`，rank 600；另有 `cordis.patch.yml` 注册插件行） | 6.1.0（SKILL.md metadata 同 6.1.0，跟上 v6 线） | 同上路由式工作流；**含 `attribution_guard.py`**；SKILL.md 强调 `SKILL_DIR` 绝对路径、先跑 guard、不许 cd/猜路径 | Python 3.10+ + `pip install -r requirements.txt`；`.env` 可选（image_backends 的 API key） | MIT（含 LICENSE，guard 校验其摘要） | `dsh.engines.dsh >=0.1.1-rc.1`、node >=20、`peerDependencies` 无（零 npm 运行时依赖）。**本机 dsh-skill 0.1.1-rc.2 有 `registerProvider`（L147）与 `BUNDLED_SKILL_RANK=600`（L23）→ 契约吻合，可直接 `dsh plugin --profile web add <路径>`** |
| 3 | [`@ljwei-stak/ppt-master-for-mgr`](https://www.npmjs.com/package/@ljwei-stak/ppt-master-for-mgr)（repo [ppt-master-for-MGR](https://github.com/ljwei-stak/ppt-master-for-MGR)） | npm 包形态的 DSH skill 插件（79.7MB unpacked，`package/skills/ppt-master/` 同布局 + host adapter） | 6.3.3（上游 6.3.0） | 同上；另带 CLI `ppt-master-for-mgr doctor/setup`（Python 依赖安装器） | Python 3.10+（`setup` 跑 `pip install -r`，支持 `PPT_MASTER_PYTHON`/`--python-root` 管理根） | MIT | `peerDependencies: @deepseek-ai/cordis ^4.0.2`（本机 4.0.2 ✓）、**`@deepseek-ai/dsh-skill-filesystem ^0.1.2-rc.1 || ^0.1.5-rc.1`（本机 0.1.1-rc.2 ✗，npm strict peer 会拒绝；README 亦明言 "Use DSH 0.1.2-rc.1 or newer"，目标 DSH 0.1.5-rc.1）** |
| 4 | [luonghaianh1208/PPTmaster](https://github.com/luonghaianh1208/pptmaster)（SkillsMP 索引为 creator `luonghaianh1208/pptmaster` + skill `ppt-master`） | 越南语 fork 仓库（仓库名就叫 PPTmaster），含完整 skill | 6.3.2-vi.6 | 越南语规则 + Windows 一键安装 `CAI-DAT.bat` / `tools/vi/setup.sh`；核心同上游 | 同上游 Python | MIT（署名 Hugo He + Lương Hải Anh） | 无 DSH 特有约束；在 DSH 下同样走 `~/.dsh/skills/` 直拷路线 |

- **SKILL.md 内容要点（以克隆的 pn1024 6.1.0 实读为准）**：frontmatter `name: ppt-master` + `description`（kebab-case ✓，DSH 可解析）；正文 = 强制加载序（读 SKILL.md → 跑 guard → 读 `workflows/routing.md` → 选且仅选 1 条路由/profile）→ 全局执行纪律（串行、BLOCKING 门、禁止跨门打包、确定性路由、Owning-source 恢复、绝对路径）→ 通信规则（语言跟随、角色切换模板、赞助商信息默认不展示）。
- **依赖面（skill 内 `requirements.txt` 实读）**：核心导出硬依赖 `python-pptx>=0.6.21`（`scripts/svg_to_pptx/pptx_package/builder.py:26 from pptx import Presentation`）+ `PyYAML>=6.0`（register_template）；`XlsxWriter`（图表 workbook）、`skia-pathops`/`uharfbuzz`（合并形状/文本轮廓，ImportError 处有降级）、`edge-tts`（旁白）、`PyMuPDF`（PDF→md）均**可选**。
- **完整性门禁实跑**：`python3 skills/ppt-master/scripts/attribution_guard.py`（对**新克隆副本**，即等价于直拷进 `~/.dsh/skills/` 的状态）→ **exit 0 通过**。guard 校验：LICENSE 摘要（SHA256 `80cefc2…`）、9 个 gate 脚本存在、SKILL.md 含 guard 调用标记行。**含义：拷贝后不改文件即可用；任何本地改动（改 SKILL.md 标记行/改 gate 脚本/删 LICENSE）都会让 skill 自停。**

### 2.2 SkillHub / ClawHub 市场上 "ppt-master" 命名的 skill（api.skillhub.cn 实测）

| slug / namespace | 名称 | 下载量 | 许可/标签 | 形态备注 |
|---|---|---|---|---|
| `@user_ecd462ed/ppt-master` | PPT可编辑大师 | 9 017 | **Proprietary、requires_api_key=true** | 27 文件 5.1MB，SKILL.md 带 `billing_client.py`/`onboarding.py`，**付费点数结算**（墨序/WorkBuddy 计费）；本地 HTML 生成 + 导出 PPTX/PDF |
| `@user_922b1001/ppt-master-wrap` | Ppt Master Wrap | 6 298 | MIT 风格薄包装（tags: wrap/github/automation） | 仅 SKILL.md 527B + _meta.json，纯指示性（"Python提示词转PPT可编辑模板"） |
| `@user_741c61d8/ai-ppt-skill` | PPT master | 10 113 | requires_api_key=false | 20 图表类型、5 阶段交互工作流、可编辑 .pptx |
| `@clawhub_tianheihei002/yq-ppt-master` | Yq Ppt Master | 8 220 | clawhub 源 | 链接 https://clawhub.ai/tianheihei002/yq-ppt-master |
| `@user_2241deda/ppt-master-guide` | PPT制作大师指南 | 2 062 | - | 方法论/流程指南型，配合 create-ppt 使用 |
| `@user_c774f8e9/qiuye-html-ppt` | 秋叶PPT-html版 | 1 884 | 免费 | HTML 单页排版截图当 PPT 页 |
| `@clawhub_smallkeyboy/ppt-optimizer` | PPT智能优化助手 | 6 785 | 免费 | 优化型 |
| `@user_8e3169aa/super-all-around-ppt-master`、`@user_633c893d/md-format`、`@laoxi/ppt-craft-master`（enterprise，39 723 dl）等 | 各 "master" 系 | 数千~数万 | 多样 | 同义占位者众，**装前逐个审 SKILL.md/scripts** |

> 结论：SkillHub 上是「skill 形态的 pptmaster 生态已饱和」，但**官方（hugohe3 系、MIT）只有 opencentra/pn1024/ljwei/luonghaianh1208 四条通路**；其余同名项多为独立实现或付费闭源，**不推荐**。

### 2.3 版本与 peer 约束对账（本机 0.1.1-rc.2）

| 发行 | 约束 | 本机 | 判定 |
|---|---|---|---|
| pn1024/dsh-ppt-master | `dsh >=0.1.1-rc.1`；零 npm 依赖 | dsh 0.1.1-rc.2 ✓；cordis 4.0.2 ✓ | **兼容，可直接装**（guard 实测通过） |
| opencentra/ppt-master-skill | 无 DSH 约束（Claude Code 目标） | 一层发现 + frontmatter 均满足 | **兼容（纯 skill 直拷路线）** |
| @ljwei-stak/ppt-master-for-mgr | `dsh-skill-filesystem ^0.1.2-rc.1 \|\| ^0.1.5-rc.1`；目标 0.1.5-rc.1 | dsh-skill-filesystem 0.1.1-rc.2 | **不兼容（peer 冲突，npm 会拒装）** |
| zbsph/dsh-ppt-studio | 基线 DSH 0.1.5-rc.2（persona 配置 `prefix/suffix` 等新契约） | 0.1.1-rc.2（persona 还是 `text:`） | **不兼容，需 port 核对**（上一轮已述） |
| dsh-workbuddy-ppt | peer `@deepseek-ai/*@^0.1.1-rc.2`；Node ^22.19 或 >=24 | 全部 ✓；Node v22.23.2 ✓ | **兼容，拿来即用**（上一轮结论，仍有效） |

---

## 3. 对比：skill 形态 vs 插件形态（本部署 0.1.1-rc.2）

> 说明：用户描述的「插件形态」= host `defineTool` + client UI + settings（进 profiles），对应 dsh-workbuddy-ppt / walioffice / ppt-studio 一类；「skill 形态」= 决策指引 + 脚本，进 `~/.dsh/skills/`。**pn1024/dsh-ppt-master 是二者之间的第三种**：它是个插件，但注册的是 skill provider（不含 defineTool），装上后模型侧体验与纯 skill 相同。

| 维度 | skill 形态（ppt-master，opencentra 直拷 / pn1024 包装） | 插件形态（dsh-workbuddy-ppt 为确定性渲染代表） |
|---|---|---|
| 生成可编辑 PPTX | ✅ 有（SVG→DrawingML 原生导出，shape/chart/table 全原生，python-pptx 打包） | ✅ 有（PPTD v2 场景 → 确定性校验 → pptxgenjs 渲染，可编辑） |
| 编辑既有 PPTX | ✅ **有**：Edit Native PPTX route（`pptx_to_svg.py --roundtrip` 源保留式改造，未动页逐字节恢复；另 Fill Native PPTX / Enhance 路由） | ❌ **无**（pptxgenjs 只写不读；文档明示 PPTX→PPTD 仅诊断性） |
| 模板 / 填充 / 动画 / 旁白 | ✅ Create Template / Fill / Enhance / animations / edge-tts 旁白 | ⚠️ 模板 44 套 + 受限动画，无旁白/音频 |
| 预览 | ✅ SVG 工作区 + `scripts/svg_editor/server.py` 浏览器编辑预览（需浏览器/端口）+ visual review 阶段；无 Office 也能出 SVG/PPTX | ✅ `dsh-pptd screenshot`（SVG + Sharp 无头出 PNG）；GUI 文件工具可看 |
| 质量门禁 | attribution guard（完整性）+ svg_quality_checker / batch_validate / pptx_delivery_check 等脚本门禁，但**靠模型自觉按多文件规范执行** | **确定性**：`ppt_scene_check` 数字门禁（唯一 id/越界/重叠/字号容量/hash 防篡改） |
| 模型侧成本 | SKILL.md + routing + 1 条 profile + 触发 references —— 多文件长链，token 重、心智负担大 | 内置写作 skill 较短 + 工具自带 schema，确定性高 |
| 运行依赖 | Python 3.10+ + pip 依赖树（python-pptx 必需）；无 Office | 纯 Node（pptxgenjs/sharp/jsdom/fflate），`npm i` 即用 |
| 安装成本 | `cp -r`（直拷）或 `dsh plugin add`（pn1024） + `pip install -r`；116MB / 12 937 文件（pn1024 6.1.0 实测量） | `dsh plugin --profile web add dsh-workbuddy-ppt`（npm 发布） |
| 与 btw 图片管线配合 | skill 自带 image_backends/image_gen（需 API key，可选）；**更优做法：btw 产图落工作区 → skill 的 `images/` 本地文件校验**（skill 对本地图片做路径/扩展名/hash 校验） | workbuddy 图片同走工作区资产（真实路径/扩展名/签名/hash 校验），与 btw 衔接最顺 |
| 与文件工具配合 | 产物（.pptx / SVG 工作区 / design_spec）落会话工作区，DSH 文件浏览/下载直接呈现 | 同左 |
| 许可 / 供应链 | MIT（hugohe3 系）；市场同名项有 Proprietary+付费 —— 只取官方通路 | MIT |
| 版本契约（0.1.1-rc.2） | pn1024 ✓ / opencentra ✓（无约束）；ljwei ✗ | workbuddy ✓（peer 恰同线）；ppt-studio ✗（0.1.5-rc.2） |

---

## 4. 推荐：C（组合）——A 先行、B 并行，合并两条路线

按用户给定的三案裁决（A 装 skill + 轻量脚本；B 插件 port dsh-workbuddy-ppt；C 组合）：

- **A（纯 skill）**：能力面最全（含编辑既有 pptx 与模板/旁白），0.1.1-rc.2 兼容、guard 实测通过；但**代价是 Python 依赖树 + 模型驱动重工作流（token/心智）**，且更新=整体重拷（guard 禁本地改）。
- **B（workbuddy 插件）**：确定性渲染、零 Python、peer 全吻合、拿来即用；但**只写不读**，能力面窄（无编辑/模板填充/旁白），与"pptmaster"这个名头的完整能力不对等。
- **C（组合）＝ 最终建议**：两者不存在数据层互通（PPTD DSL ≠ PPT Master 的 SVG/design_spec 中间层），所以组合发生在**任务分流 + 工作区资产衔接**层面：
  1. **主线 A**：装 pn1024/dsh-ppt-master（或 opencentra 直拷）——承接"pptmaster 这个 skill"的全部原生能力（生成/编辑/填充/增强/预览），0.1.1-rc.2 契约吻合且 guard 实测通过；
  2. **辅线 B**：并行装 dsh-workbuddy-ppt——承接"确定性渲染/校验/无头预览"，在不需要 ppt-master 深度原生能力时（简单 deck、快速交付、环境不装 Python 的会话）作为干净通道；
  3. **衔接边界**：两路线产物统一落会话工作区（.pptx + 中间层工程 + 图片资产），btw 产图共用 `imageDir`；模型按任务类型选择通道（要求原生深度/编辑 → skill；要求确定性/轻量 → workbuddy）。
  4. **编辑既有 pptx 的兜底**：以 skill 的 Edit Native PPTX route 为主；若不想引 Python，可另接 [omdsh-dev/dsh-office](https://github.com/omdsh-dev/dsh-office) 的 `pptx_read`/`pptx_edit`（`<a:t>` 文本级替换，保留版式）作为轻量替代（Apache-2.0，上一轮已核）。
- **明确排除**：`@ljwei-stak/ppt-master-for-mgr`（peer 与 0.1.1-rc.2 冲突，装不上，升级 DSH 后再议）；SkillHub 付费 `PPT可编辑大师`（Proprietary + 计费脚本，供应链不透明）；`zbsph/dsh-ppt-studio`（基线 0.1.5-rc.2，作为未来升级后的备选，届时其内嵌 4 本 skill 手册形态可复用）。

### 4.1 最小落地步骤

```bash
# Phase 0 环境预检（已实测满足）
node --version            # v22.23.2 ✓（workbuddy 要求 ^22.19 || >=24）
python3 --version         # 3.12.3 ✓
python3 -m pip --version  # 24.0 ✓；pypi 可达（200）✓

# Phase 1 skill 主线（A）——二选一
#  方式 1（插件，推荐）：skill 进 catalog 且随插件更新
git clone --depth 1 https://github.com/pn1024/dsh-ppt-master ~/.dsh/plugins/dsh-ppt-master
dsh plugin --profile web add ~/.dsh/plugins/dsh-ppt-master   # engines dsh>=0.1.1-rc.1 ✓
#  方式 2（纯 skill 直拷）：watcher 热发现，无需重启
cp -r ~/.dsh/plugins/dsh-ppt-master/skills/ppt-master ~/.dsh/skills/

# Phase 2 Python 依赖（核心导出必需 python-pptx；建议 venv）
python3 -m venv ~/.venvs/ppt-master && source ~/.venvs/ppt-master/bin/activate
pip install -r ~/.dsh/skills/ppt-master/requirements.txt      # 或插件内同路径

# Phase 3 冒烟（guard 实测 exit 0）
python3 ~/.dsh/skills/ppt-master/scripts/attribution_guard.py && echo OK
python3 ~/.dsh/skills/ppt-master/scripts/svg_to_pptx.py --help | head

# Phase 4 插件辅线（B）
dsh plugin --profile web add dsh-workbuddy-ppt                # peer ^0.1.1-rc.2 ✓
# 核对 settings 键：maxSlides / maxUploadBytes / maxZipEntries / maxDecksPerSession（其 CONFIGURATION.md）

# Phase 5 验证 + 衔接
# 重启 dsh web 后新会话：<available_skills> 目录应含 ppt-master → skill 工具加载 → 提需求
# 图片衔接：btw 产图路径 → skill 工作区 images/（走本地文件校验，不配 .env API key）
```

### 4.2 风险与边界

1. **Python 依赖树**：`python-pptx`/`XlsxWriter` 为导出硬依赖；`skia-pathops`/`uharfbuzz` 有 manylinux wheel（pypi 可达）但属可选；装前备份环境或用 venv 隔离。本机当前无任何 pip 包 → Phase 2 是唯一系统级变更。
2. **无 GUI / 无 Office 环境的预览与字体**：Linux headless 缺 CJK 字体时 SVG 文本测量/预览可能偏差（需 fonts-noto-cjk 一类）；无 Office 不影响导出，但"Office 打开互证"验收门禁（workbuddy 文档）只能在有 Office/WPS 的机器执行。
3. **attribution guard 锁定内容**：pptm-master 系 skill 的 guard 校验 LICENSE 摘要 + 9 个 gate 文件 + SKILL.md 标记行——**任何本地定制都会使 skill 自停**；升级 = 整体重拷整目录（116MB / 12 937 文件，实测 pn1024 6.1.0）。
4. **目录体积与 watcher**：13k 文件放 `~/.dsh/skills/` 会让 chokidar 多盯一个大目录（skill-filesystem 只对直接增删/`SKILL.md` 变化失效，子目录资源不触发失效——README「Catalog Change Detection」；但首次发现/列表成本仍在）。
5. **模型侧成本**：skill 工作流是多文件长链（SKILL.md → routing → profile → 触发 references），token 与误操作风险高于 defineTool 工具；catalog 描述被截断到 500 字不影响加载，但模型对路由的选择依赖正文质量。
6. **双 DSL 并存**：PPTD（workbuddy）与 SVG/design_spec（ppt-master）不互通，组合只在"任务分流"层成立；不要让模型在同一 deck 上混用两套中间层。
7. **0.1.1-rc.2 pre-stable 契约漂移**：装任何第三方插件前先备份 `~/.dsh/profiles/web/cordis.patch.yml`（本机已有 `.bak-*` 惯例），装后 fresh 会话冒烟；升级 DSH 后再评估 ljwei/zbsph。
8. **市场供应链**：SkillHub 同名项含 Proprietary + 计费脚本（`PPT可编辑大师`）——只取官方 MIT 通路（opencentra/pn1024/ljwei/luonghaianh1208），市场安装前逐个读 SKILL.md 与 scripts。

---

## 5. 来源 URL 全列（联网证据）

**skill 形态仓库 / 包**
- https://github.com/opencentra/ppt-master-skill （SKILL.md: https://github.com/opencentra/ppt-master-skill/blob/main/skills/ppt-master/SKILL.md ；requirements: …/skills/ppt-master/requirements.txt）
- https://github.com/pn1024/dsh-ppt-master
- https://www.npmjs.com/package/@ljwei-stak/ppt-master-for-mgr ｜ https://github.com/ljwei-stak/ppt-master-for-MGR （docs/dsh-installation.md）
- https://github.com/luonghaianh1208/pptmaster
- https://github.com/hugohe3/ppt-master （上游；docs/getting-started.md、docs/zh/getting-started.md）
- SkillsMP 索引（creator `luonghaianh1208/pptmaster` → skill `ppt-master`）：https://skillsmp.com/creators/luonghaianh1208/pptmaster

**skill 市场 / 生态**
- SkillHub 站点 https://www.skillhub.cn/ ；API https://api.skillhub.cn/api/skills?keyword=ppt-master 、/api/v1/download?slug=&namespace= （实测）
- https://github.com/vonweller/dsh-skillhub ｜ https://github.com/peiqi10086/dsh-skills-market ｜ https://github.com/pn1024/dsh-skill-market ｜ https://github.com/hackerFish/awesome-dsh-skills ｜ https://github.com/wmengxiang/dsh-any-skills
- https://github.com/bruc3van/awesome-dsh-plugin （dsh-ppt-master / dsh-skill-hub 收录）｜ https://github.com/Dominic789654/awesome-deepseek-harness

**插件路线对照（上一轮已核，本轮再确认）**
- https://github.com/SuperstructureJH/dsh-workbuddy-ppt ｜ https://www.npmjs.com/package/dsh-workbuddy-ppt
- https://github.com/zbsph/dsh-ppt-studio ｜ https://github.com/omdsh-dev/dsh-office
- https://github.com/AdamPlatin123/awesome-dsh-plugins （"原生 DSH 插件：PPT 演示文稿专家，内置 PPTD DSL 引擎…Python-PPTX 高保真离线编译内核"）

**DSH 官方契约（skill）**
- 本机安装的官方包源码（权威）：`@deepseek-ai/dsh-skill-filesystem`（README「Discovery / Skill Format / Catalog Change Detection」+ lib/index.js）、`@deepseek-ai/dsh-skill`（lib/index.js：BUNDLED_SKILL_RANK=600、registerProvider）、`@deepseek-ai/dsh-tool-skill`（README「Session catalog / Tool: skill」）——路径 `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`
- 官方仓库 https://github.com/deepseek-ai/deepseek-harness （文档站 https://deepseek-harness.github.io/deepseek-harness/ ；defineTool 契约：docs/cookbook/adding-a-tool.zh.md）

**调研元数据**
- GitHub raw/codeload 与 `git clone --depth 1`（pn1024 6.1.0、zbsph v1.0.0、opencentra）实测克隆至 `.workspace/tmp-ppt-research/`；npm registry（`pptmaster`=404、`@ljwei-stak/ppt-master-for-mgr`=6.3.3、unpacked 79.7MB）；SkillHub API 分页实测（核验时点 2026-09）。

## 6. 本地证据文件路径全列

- `~/.dsh/skills/grill-me/SKILL.md`（唯一自装 skill，通道验证）
- `~/.dsh/.agent-presets/standard-glm/agent.cordis.yml`（L83-87：skill-filesystem + tool-skill 行）
- `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/package.json`（version 0.1.1-rc.2）
- `…/node_modules/@deepseek-ai/dsh-skill-filesystem/README.md` + `lib/index.js`（roots/frontmatter/热发现）
- `…/node_modules/@deepseek-ai/dsh-skill/lib/index.js`（L23 BUNDLED_SKILL_RANK=600、L147 registerProvider）
- `…/node_modules/@deepseek-ai/dsh-tool-skill/README.md`（catalog 注入与 skill 工具契约）
- `…/node_modules/@deepseek-ai/dsh-skill-filesystem/package.json`（0.1.1-rc.2，ljwei peer 冲突证据）
- 上一轮报告 `/home/CNS2026495165/dsh/.workspace/pptmaster-research.md`（插件生态全景，本轮在其上合并）
- 本轮调研缓存 `.workspace/tmp-ppt-research/`（pn1024-dsh-ppt-master 全量克隆 116MB/12 937 文件、zbsph-dsh-ppt-studio、SkillHub 下载的 `ppt-master-wrap`/`ppt-master` zip、raw 抓取、attribution_guard 实跑 exit 0）
