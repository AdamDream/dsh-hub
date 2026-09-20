# 识图提示词「完整转录 + 审美/设计合理性分析」— 修订执行复核一体档报告

> 2026-09-14 · 路由 adam/deepseek-v4-flash · 修订执行复核一体（自复核，不另派独立复核）
> 需求（用户裁决，全落点都改）：识图提示词改为「尽可能完整转录图片内容 + 附审美与设计合理性分析」。
> 依据：`.workspace/btw-usage-ui-audit.md` §4（落点 :149-153/:236-279/:229-233、vision.ts:46/:70-78）。

## 一、改动清单（全落点，逐条对应）

| # | 落点 | 文件 | 改动 |
|---|---|---|---|
| 1a | 默认图片分支 | `dsh-vision-adam-src/lib/index.js:153` | `Describe the attached image in detail.` → 完整转录（全部可见内容：文字逐字、布局、颜色、元素位置、对象、说明文字）+ 若为 UI/截图附审美与设计合理性分析（配色/视觉层级/对齐/可读性/具体改进建议） |
| 1b | 视频分支 | `dsh-vision-adam-src/lib/index.js:152` | 同步措辞：逐字转录 + 内容随时间变化 + 同上审美分析（审计 §4-2「按需同步措辞」落实） |
| 1c | question 前缀模板 | `dsh-vision-adam-src/lib/index.js:149-150` | 在 question 后追加 `In any case, transcribe the entire visible content … aesthetic and design-rationale analysis …`（审计 §4-2「可在 question 之后追加同一指令」落实） |
| 2 | btw 默认 question | `dsh-btw/src/host/vision.ts:46` `VISION_DEFAULT_QUESTION` | 改为中文「请用中文尽可能完整转录这张图片的全部可见内容（文字逐字、布局、颜色、元素位置），并附审美与设计合理性分析（配色、层级、对齐、可读性、改进建议）。」——只动这一处常量文案 |
| 3 | 工具 description | `dsh-vision-adam-src/lib/index.js:238` | 追加一句：「The returned description prefers a complete transcription of the visible content (text, layout, colors, element positions) plus an aesthetic/design-rationale assessment when applicable.」 |

未改：systemPrompt（:229-233）——审计明确其不进入 vision 模型，仅引导主模型调用时机，不在本次需求范围。

## 二、产物（均在约束允许的写目录内）

- `.workspace/dsh-vision-adam-src/lib/index.js` — 工作区源副本（= 部署位 cp 后改，两处 hunk）
- `.workspace/deploy-vision-prompt/index.js` — 应用后完整副本（sha256 `54ac2548ff3215b0837185de6949c6bd796e0de637877997f5fb5587cffe8ae8`，与源副本逐字节一致）
- `.workspace/deploy-vision-prompt/vision-adam-index.js.diff` — unified diff（a/ b/ 相对路径，`patch -p1` 可直接应用；已实测 dry-run 通过、应用结果与源副本逐字节一致）
- `.workspace/deploy-vision-prompt/APPLY.md` — 备份/应用/回滚 runbook（含 btw 侧构建流）
- `.workspace/deploy-vision-prompt/smoke-test-output.txt` — 实测输出存档
- `.workspace/dsh-vision-adam-src/smoke-test.mjs` — 冒烟脚本（测试用；需临时 symlink profiles node_modules 方可 import，用后已删 symlink）

## 三、验证

1. **语法**：`node --check` 通过（改后 index.js）；btw `tsc -p tsconfig.json --noEmit` 通过（exit 0）。
2. **真实 API 冒烟**（opencode.ai/zen/go + deepseek-v4.1-flash；key 从 `~/.dsh/.credentials.yaml` 的 `OPENCODE_GO_API_KEY` 读取，未打印）：v4f-test.png（360×140 绿底 + 红方块 + 白字 V4F-73）走 `analyzeImageBytes`：
   - **新默认分支**（无 question）→ 逐字转录 `V4F-73`、元素位置表（背景满幅/红方块左上 ~5% 边距/文字位置）、配色近似 hex、对比度测算、视觉层级、对齐分析、可读性（WCAG 3.2:1 评价）、4 条具体改进建议——完整「转录 + 设计分析」风格。
   - **新 question 分支**（btw 新 VISION_DEFAULT_QUESTION）→ 中文完整转录（背景/色块/文字逐项 + 位置描述）+ 审美与设计合理性分析（配色逻辑/视觉层级/对齐合理性/可读性）+ 4 条改进建议——符合 btw 中文问答模型视角。
   - **旧默认分支**（对比基线）→ 仅 3 句简述（The image features a solid green background…），风格差异显著。
   - 结论：新提示词确实产出「尽可能完整转录 + 审美与设计合理性分析」风格，两分支均生效。
3. **diff 可应用性**：`patch --dry-run -f -p1` 通过；实际应用后与新副本逐字节一致（sha256 校验）。
4. **部署位未动**：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js` 未被写入（只读参考，sha256 校验仍为原值 `73fb8be8…`）；测试 symlink 已删除，无残留。

## 四、自复核（自裁决：**通过**）

**全落点覆盖**：① 默认分支 ✓ ② question 分支 ✓ ③ btw question（vision.ts:46）✓ ④ description ✓。视频分支为审计 §4-2 明示的「按需同步措辞」项，一并落实，未扩范围。
**无语法破坏**：node --check + tsc --noEmit 均过；两处 hunk 均为字符串字面量替换，无逻辑改动。
**影响面**：`analyzeImageBytes` 是 analyze_image 工具（主会话模型调用）与 btw 图片管线（side-chat 粘贴图入队前同步转文字，走 question 分支）的**共享代码路径**——两处同时生效（符合审计 §4 结论）；主会话图片展示/放大走官方 attachment 管线（`MessageImage`/`ImageLightbox`），不受影响；systemPrompt 未改、不影响 vision 模型输入。提示词变长对 token 开销影响：默认 max_tokens 2000 足够（实测输出 ~1.1KB 文本），无超限风险。

**问题清单（无阻断项；两条观察供主 agent 知悉）**：
1. 需求未要求、故未改动 btw `wrapImageDescriptions` 的标题文案（「以下为各图片的描述（vision-adam 生成）」）——若后续想体现「转录+分析」可在 btw 侧另行调整，属范围外。
2. btw 侧改动需走 tsdown build + 部署位同步 + 重启才生效（vision-adam 部署位直改重启即生效）；APPLY.md 已写明，但实际部署由主 agent 执行（本档按约束未改 ~/.dsh）。

## 五、结论

修订执行复核一体档：**通过**。三落点（vision-adam 提示词模板全分支、btw VISION_DEFAULT_QUESTION、工具 description）全部按用户裁决改到位，真实 API 实测验证输出为「完整转录 + 审美与设计合理性分析」风格，与旧版对比明显；产物包（diff/完整副本/APPLY.md/实测存档）齐备，部署与回滚路径已在 APPLY.md 给出。
