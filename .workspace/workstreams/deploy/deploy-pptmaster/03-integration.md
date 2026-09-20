# 衔接说明（03-integration）：工作区 .pptx + 与 btw 共用 imageDir

> 落地对象：ppt-master skill（pn1024 6.1.0 直拷） + dsh-pptmaster 插件（dsh-workbuddy-ppt 0.1.0 port）。
> 数据时点：2026-09-14。所有路径均为本部署实机核查结果。

## 1. 与 btw 共用 imageDir 的约定

### 1.1 现状核查（实机证据）

- 当前部署的 btw 插件为 `@local/dsh-btw` **0.4.0-btw.1**（`~/.dsh/profiles/node_modules/@local/dsh-btw`，cordis.patch.yml `- id: btw`）。其 `src/host/` 只有 `btw-registry.ts` / `side-chat-service.ts`，**本机尚无 vision.ts、无 imageDir 键**（grep 全库无 `imageDir` 命中）。
- 上游 `SuperstructureJH/dsh-btw` main 分支同样没有 `src/host/vision.ts`（raw.githubusercontent 404 实测）。
- peer 会话（session-board 背景）有一条**未落地**的「vision-prompt 部署」计划（涉及给 btw 加 vision 能力），`.workspace/deploy-vision-prompt/` 尚不存在。
- 结论：**"btw host vision 产物路径"在本机尚无实现可读**。下方约定是面向该管线的落地契约（先定路径、后随管线部署生效）；当前立即生效的部分是"工作区图片资产"的消费侧能力（见 1.3）。

### 1.2 约定的 imageDir 路径

```
{session workspace root}/images/        # 建议：btw 产图统一写这里（btw 管线落地时按此约定实现）
```

- 备选（若 btw 未来沿用侧聊快照惯例）：`{session workspace root}/.workspace/images/`。
- **选型理由**：两通道（ppt-master skill 与 dsh-pptmaster 插件）都要求图片是**工作区内的真实文件**；根级 `images/` 最简、无 `.workspace` 前缀歧义，且 DSH 文件工具直接可见。
- 双向约束：
  - **btw 侧**（写）：产图（生图 / 截图 / 检索）完成后把文件落到该目录，并把**绝对路径 + 文件名**交给会话（供模型在场景里填 `source_path`）。
  - **pptmaster 侧**（读）：只接受工作区内真实路径；对工作区外路径、`..` 逃逸、绝对路径越界一律拒绝。

### 1.3 消费侧能力（本 port 源码实证）

`dsh-pptmaster` 插件（workbuddy port）的图片校验链（lib/index.js）：
- `source_path` 必须解析到会话工作区根之内：`relative.startsWith("..") || path.isAbsolute(relative)` → throw `OfficePptError("invalid-request", "asset ... is outside the active workspace")`（L6754）。
- 场景字节与工作区图片字节绑定 hash：check 与 create 之间字节变化 → `OfficePptError("conflict", "PPT scene or workspace image bytes changed after the successful check")`（L6326），防篡改。
- SKILL.md（bundled `workbuddy-ppt`）：图片先由可用的生图/检索工具**保存到工作区**，再在场景 `assets` 里传 `source_path` + 安全英文文件名；JSX 只允许 `resources/images/<safe-name>` 或 `icon://fa/<name>`（L4749）。

`ppt-master` skill 侧（pn1024 6.1.0，未改动）：
- 自带 `image_backends`/`image_gen`（需 `.env` 配 API key，可选）；**更优路径 = btw 产图落工作区 → skill 对本地图片做路径/扩展名/hash 校验后直接使用**（不需要任何 API key）。

## 2. 工作区 .pptx 落盘约定

### 2.1 dsh-pptmaster 插件（确定性通道）

- **最终产物**：会话工作区根下的可见目录 `{safeTitle}(-rN)/`（N 为冲突去重后缀，rN 为 revision）：
  - `{safeTitle}.pptx`（可编辑 PPTX）
  - `STORY.md` / `DESIGN.md`（当走 projectFiles 时）
  - `pages/`（每页 JSX 或 PPTD `.page`）
  - `resources/images/`（准入的图片资产拷贝）
  - 实现：`publishWorkspaceOutput(workspaceRoot, deck, bytes, projectFiles)`（lib/index.js L79900+）；workspaceRoot = 会话 `header.cwd`（RPC 由 `(sessionId) => ctx.sessions.get(sessionId)?.header.cwd` 解析，L82032）。
- **中间工程**：默认落在 `$DSH_HOME/office-ppt/`（config `root: !!js dshHomePath('office-ppt')`），按 session 隔离（sessionDirectory）。
- **不可写工作区时的行为**：`OfficePptError("invalid-request", "Office PPT generation requires an active workspace")` —— 需要会话有活动工作区。

### 2.2 ppt-master skill（深度通道）

- 按 SKILL.md 纪律：产物（`.pptx`、SVG 工作区、`design_spec` 等）由模型经 DSH 文件工具写入**会话工作区**（绝对路径纪律，不 cd 不乱猜）。
- 图片资产：btw 产图（1.2 的 `images/`）→ skill 本地文件校验后引用；无需配置 `.env`。

### 2.3 双通道边界（勿混用）

- 两套中间层**不互通**：PPTD/场景 DSL（插件） ≠ SVG/design_spec（skill）。同一 deck 只走一条通道。
- 任务分流：深度原生能力 / 编辑既有 PPTX / 模板填充 / 旁白 → **ppt-master skill**；简单 deck / 快速交付 / 确定性校验 / 无头预览 → **dsh-pptmaster 插件**。
- 产物落盘都在**同一会话工作区**：DSH 文件浏览/下载直接呈现，`imageDir` 图片两通道共用。

## 3. 待主代理注意的开放项

1. btw vision 管线未落地：1.2 的 `images/` 约定在 btw 加 vision 能力前是"契约待生效"状态；当前可直接生效的是"工作区图片资产"的消费侧（1.3）。
2. 若 btw 后续实际实现用了不同目录名，需回改 1.2（唯一耦合点）。
