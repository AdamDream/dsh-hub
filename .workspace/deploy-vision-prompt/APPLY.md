# APPLY.md — 识图提示词「完整转录 + 审美/设计合理性分析」部署与回滚

> 2026-09-14 · 修订执行复核一体档产出 · 路由 adam/deepseek-v4-flash
> 需求（用户裁决，全落点都改）：识图提示词改为「尽可能完整转录图片内容 + 附审美与设计合理性分析」。

## 本包内容（deploy-vision-prompt/）

| 文件 | 说明 |
|---|---|
| `index.js` | 改后完整副本（= `.workspace/dsh-vision-adam-src/lib/index.js`，sha256 `54ac2548ff3215b0837185de6949c6bd796e0de637877997f5fb5587cffe8ae8`） |
| `vision-adam-index.js.diff` | unified diff（部署位 → 新副本，a/ b/ 相对路径，`patch -p1` 可直接应用；已实测 dry-run 通过、应用后与新副本逐字节一致），两处 hunk：`analyzeImageBytes` 提示词（:149-153）、`defineTool description`（:238） |
| `smoke-test-output.txt` | 实测输出存档（v4f-test.png 经新提示词 2 分支 + 旧版对比） |

## 改动清单（全落点）

1. **vision-adam `analyzeImageBytes` 提示词**（`lib/index.js:149-153`，默认图片分支 + 视频分支 + question 前缀模板）：
   - 默认分支：`Describe the attached image in detail.` → 完整转录（文字逐字、布局、颜色、元素位置、对象、说明文字）+ 若为 UI/截图附审美与设计合理性分析（配色/视觉层级/对齐/可读性/具体改进建议）。
   - 视频分支：同步措辞（逐字转录 + 随时间变化 + 同上审美分析）。
   - question 分支：在 question 后追加同一转录 + 审美分析指令（`In any case, transcribe …`）。
2. **工具 description**（`lib/index.js:238`）：追加一句「返回的描述优先完整转录可见内容（文字/布局/颜色/元素位置）并在适用时附审美/设计合理性评估」。
3. **btw 默认 question**（`dsh-btw/src/host/vision.ts:46` `VISION_DEFAULT_QUESTION`）：改为中文完整转录 + 审美/设计合理性分析要求（源码改动，走 btw 构建流）。

## 应用（部署位：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js`）

```bash
# 0) 备份（沿用 9-12 的 .bak 惯例）
cp ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js \
   ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js.bak-vision-prompt-$(date +%Y%m%d-%H%M%S)

# 1) 校验语法
node --check .workspace/deploy-vision-prompt/index.js

# 2) 应用（等位校验 sha256）
cp .workspace/deploy-vision-prompt/index.js \
   ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js
sha256sum ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js
# 期望：54ac2548ff3215b0837185de6949c6bd796e0de637877997f5fb5587cffe8ae8

# 3) 重启 dsh web 使插件生效（部署位直改，重启加载）
```

btw 侧（`VISION_DEFAULT_QUESTION`，走 btw 构建/部署流，与 vision-adam 独立）：

```bash
# dsh-btw: src/host/vision.ts:46 已改 → tsdown build → 同步部署位 → 重启 web
cd dsh-btw && pnpm run build   # 产出 lib/（含 vision 模块编译结果）
# 按 btw 既定部署 runbook 同步 ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/ 并重启
```

## 回滚

```bash
# 恢复备份（用步骤 0 生成的备份名替换占位）
cp ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js.bak-vision-prompt-<时间戳> \
   ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js
# 重启 dsh web；btw 侧回滚 vision.ts:46 常量并重新构建/部署
```

## 验证记录（本档已实测）

- `node --check` 通过；btw `tsc -p tsconfig.json --noEmit` 通过。
- 真实 API 冒烟（opencode.ai/zen/go，deepseek-v4.1-flash，v4f-test.png，key 走 `~/.dsh/.credentials.yaml` 的 `OPENCODE_GO_API_KEY`）：
  - 新默认分支 → 逐字转录 `V4F-73` + 元素位置/颜色表 + 完整审美与设计合理性分析（配色/层级/对齐/可读性/4 条具体改进建议）。
  - 新 question 分支（btw 新 question）→ 中文完整转录 + 审美/设计分析 + 改进建议。
  - 旧默认分支 → 仅 3 句简述（对比基线）。
- 影响面：`analyze_image` 工具（主会话模型调用）与 btw 图片管线（共享 `analyzeImageBytes`）同时生效；systemPrompt（:229-233）不进 vision 模型、未改。
