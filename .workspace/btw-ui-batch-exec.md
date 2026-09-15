# btw UI 批：① 运行横幅改绿 ② 图片序号徽标 ③ 放大 lightbox 修复 — 修订执行复核一体档报告

> 执行档子代理（adam/deepseek-v4-flash），两阶段闭环的「修订执行复核一体」档，同一档内完成实现 + 自复核（自裁决 **pass**），不另派独立复核。
> 依据：用户裁决需求（三 UI 项）+ 只读审计（`.workspace/btw-usage-ui-audit.md` §1 横幅样式点、§2a 图片块/Modal/徽标=不存在、§2b 官方放大机制不可复用结论）+ 执行基线（`.workspace/btw-ui-exec.md`：面板对齐实现）。
> 红线遵守：只改 `/home/CNS2026495165/dsh/dsh-btw/` 与 `.workspace/btw-ui-previews/` 与报告；未改 ~/.dsh 任何文件；未使用 sandbox_permissions（会话禁用审批，未发起任何提权）；官方包（dsh-client-ui-attachment 等）未改动。

---

## 0. 总裁决：**通过（pass，自复核）**

- 三项需求全部落地；lightbox 根因排查给出三处证据链（见 §2-3）。
- 八步验证全绿：oxlint 0/0、tsc×3 零错、vitest **23 文件 / 199 passed / 2 skipped**（基线 22/193 → 净增 1 文件 +6 断言，存量全保）、tsdown 构建成功（client.js 331.8KB）、smoke **10 断言**保持、publint（目录 lint）All good。
- 渲染预览已产出（PNG + 可交互 HTML），供主代理目检。

---

## 1. 动手前核对现状（执行要求 1）

| 核对项 | 结果 |
|---|---|
| P0 已并入源码（side-chat-service.ts:594-601 materialize 路径） | ✓ 确认：`recoverParent`（cold persisted parent 恢复）→ `completedTurnSeed` → resume/index 流程在 :594-601 附近原样存在 |
| 测试基线 22 文件 193 passed/2 skipped | ✓ 实测 `vitest run`：22 files / 193 passed / 2 skipped |
| lib 已部署 | ✓ `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js` 与工作区 `dsh-btw/lib/client.js` diff 逐字节 SAME |

---

## 2. 需求 1：运行横幅改侧聊浅绿色系 — ✅ 完成

- **改动面（纯 CSS，TSX 未动）**：`src/client/side-chat.module.css`
  - `.runningBanner` :235 边框：`color-mix(in srgb, var(--dsw-static-deepseek-500) 24%, …)` → `color-mix(in srgb, #b7e85b 24%, var(--dsw-alias-border-l1))`
  - `.runningBannerText` :245 文字渐变：`var(--dsw-static-deepseek-500/200)` 蓝阶 → `#b7e85b 0% 40% / #d9f39a 50%（更浅绿阶）/ #b7e85b 60% 100%`
  - 保留：sticky 置顶、`background-clip: text` + `color: transparent`、`250% 100%` shimmer、`btw-banner-shimmer 1.8s`、`prefers-reduced-motion` 降级——全部原样。
  - 每处加 `2026-09-14 btw-ui` 注释。
- **浅绿阶取值说明**：审计给出 `color-mix(#b7e85b 45%, transparent)` 或 `#d7f39a 类近似` 二选一；取**实心 `#d9f39a`**（#b7e85b 同色相浅阶），与官方 TurnStatus 用实心浅蓝 `#d3e2ff` 的中段表现一致，深浅主题下渲染都稳定。
- **测试**：新增 `tests/banner-theme.spec.ts`（3 断言）——直接读 `side-chat.module.css` 源码断言 `.runningBanner` 边框与 `.runningBannerText` 渐变含 `#b7e85b`、不含 `--dsw-static-deepseek`，且 shimmer 机制（background-clip/animation）保留。

## 3. 需求 2：图片缩略图左上角序号徽标（白底黑字）— ✅ 完成

- **JSX**（`SideChatSurface.tsx` 图片块 :442-462 附近）：`message.images.map((ref, index) => …)`，`<button>` 内**首子元素**加
  `<span className={css.messageImageBadge} aria-hidden="true">{index + 1}</span>`，外层包 `images.length > 1` 条件。
- **CSS**（side-chat.module.css，加 `2026-09-14 btw-ui` 注释）：
  - `.messageImageButton` 补 `position: relative;`
  - `.messageImageBadge { position:absolute; top:4px; left:4px; z-index:1; pointer-events:none; background:#fff; color:#000; font-family:var(--ds-font-family-code); font-size:10px; line-height:14px; padding:0 4px; border-radius:6px; }`
- **测试**：side-chat-surface.spec.tsx +2——双图消息渲染 `1`/`2` 两个徽标且为按钮首子元素、`aria-hidden`；单图消息**无**徽标。
- **歧义客观说明**：需求文本只说"左上角新增序号徽标"，未指定单图是否显示；审计最小实现建议"`message.images.length > 1` 时才显示，避免单图噪音"。**按审计落地（单图不显示）**，主代理若要求恒显示，删 `images.length > 1 &&` 即可（一行）。

## 4. 需求 3：修复「点击缩略图放大没反应」— ✅ 完成

### 4.1 根因排查（三个怀疑面逐项取证）

| 怀疑面 | 证据 | 结论 |
|---|---|---|
| **imageCache 加载态** | 预取 effect 依赖 `[controller, imageCache, messages]`：每次 cache 写入 / poll 轮询（running 时 220ms、idle 700ms）新 messages 数组 → cleanup `cancelled=true` 取消全部 in-flight `readImage`；且 phase 未 `open` 时 `controller.readImage` 直接返回 `{ok:false}`（controller.ts:346-349），失败后**无重试机制**（占位 span 永不升级为 button，点击无任何反应） | **真实缺陷**，可造成占位块长期不可点击 → "点击没反应" |
| **click handler 绑定** | `onClick={() => setLightbox(ref)}`（:455 现状）绑定正确；thumb 仅在 cache 命中时渲染为 button | 非根因 |
| **Modal 条件** | ① `open={lightbox !== null}` 正常；② 但 primitives `Modal` 的 dialog CSS `width:min(380px,100%)`（Modal.module.css）+ body padding 24px → 放大图实际最大 **~332px**，视觉上远非"大图"；③ `{lightbox !== null && imageCache.has(…) && <img/>}` —— cache miss 时 body 为空（仅有标题栏） | **真实缺陷**：380px 上限 + 空 body 条件，放大观感≈没放大 |

### 4.2 修复（`SideChatSurface.tsx` + CSS + locales，均带 `2026-09-14 btw-ui` 注释）

1. **预取稳定化**（治 imageCache 加载态）：
   - 新增 `fetchStateRef`（attachmentId → 'loading'|'failed'）+ `disposedRef`；effect 去重跳过 loading 中 id，**取消 cleanup-cancel**（读取稳定落地进 cache），失败标记 'failed' 由下一轮 effect 重试（phase 转 open 或下次 poll 触发——依赖补入 `state.phase`/`state.chatToken` 原始值）。
2. **自绘 ImageLightbox**（治 Modal 条件/大图）：
   - 官方 `ImageLightbox`（dsh-client-ui-attachment:412）**只导出 apply/inject，不可 import**（审计 2b 结论复核一致）→ 保持自绘边界，但按审计建议升级为官方 ImageLightbox 交互模式：
   - body-portal overlay：全屏遮罩（点击关闭）+ **Esc 关闭且 `stopPropagation()`**（SideChatDrawer 的 window 级 Escape=最小化抽屉不会被误触发）+ 右上关闭钮（`IconCloseOutline16`）+ **大图** `max-width:min(1600px,94vw); max-height:calc(100vh-80px)`（对齐官方 :423-454 视觉）+ **关闭后焦点还原**到 opener 缩略图（`lightboxOpenerRef` 于点击时捕获 `event.currentTarget`）。
   - 移除原 primitives `Modal` lightbox 用法（confirmEnd Modal 保留不动）。
   - locales 新增 `drawer.lightboxClose`（en 'Close preview' / zh '关闭预览'）入 `SideChatLocaleKey`。
3. **CSS**：`.lightboxRoot/.lightboxMask/.lightboxDialog/.lightboxClose/.lightboxImage（大图尺寸替换原 560px/74vh）/.lightboxPlaceholder`，token 与 primitives Modal 同源（`--dsw-alias-bg-mask-1`/`--dsw-mask-blur`/`--dsw-shadow-lv3`）。

### 4.3 测试（side-chat-surface.spec.tsx +1 大用例）
点击缩略图 → dialog 打开（aria-label=图名、img 含 `lightboxImage` 类）→ 关闭钮关闭 + 焦点还原 opener → 重开 → **Esc 关闭且 window 级 Escape 监听未被调用**（stopPropagation 实证）→ 重开 → 遮罩点击关闭。

## 5. 验证输出（/home/CNS2026495165/dsh/dsh-btw，直接二进制）

```
oxlint src tests tsdown.config.ts vitest.config.ts   → 0 warnings / 0 errors
tsc -p tsconfig.json                                  → 0 errors
tsc -p tsconfig.client.json                           → 0 errors
tsc -p tsconfig.tests.json                            → 0 errors
vitest run                                            → 23 files / 199 passed / 2 skipped
tsdown                                                → ESM + CJS(client.js 331.8KB) 构建成功
node scripts/smoke-build.mjs                          → smoke ok（invocations 仍为 10，断言数保持 10）
publint --level error --pack false                    → All good
```
（基线 22/193+2 → 现 23/199+2：净增 1 文件 `tests/banner-theme.spec.ts` + 6 断言通过；存量测试全部保持。smoke/package-contract 均未增方法，remote 契约未动。）

## 6. 渲染预览（执行要求 5）

- `.workspace/btw-ui-previews/preview.png`（1240×880，PIL 复刻：绿色运行横幅 + 双缩略图含 1/2 徽标 + 打开的大图 lightbox，遮罩压暗全场景）
- `.workspace/btw-ui-previews/index.html`（自包含可交互 HTML，CSS 逐条复刻 side-chat.module.css 真实值，可直接浏览器打开目检）
- `.workspace/btw-ui-previews/render-preview.py`（PNG 生成脚本，可复跑）

## 7. 自复核（逐需求核对 + 问题清单）

**需求/审计核对**：
- ① 绿系 ✓（#b7e85b 边框 + 绿 shimmer 渐变，TSX 未动，sticky/shimmer/文案保留）；② 徽标 ✓（左上角 absolute top/left 4px、白底黑字、小圆角、index 数据、样式入 css）；③ lightbox ✓（点击开、Esc/遮罩/关闭钮关、大图、焦点还原；官方组件不可复用结论遵守，官方包未动）。
- ②b/官方包未动 ✓（未改 node_modules、未 import dsh-client-ui-attachment 组件值；primitives Modal 仅保留 confirmEnd 用途）。

**副作用核对**：布局框架（抽屉/跳转/消息块/composer）未动；remote 契约/方法数未动；chunk/流式语义未动；controller 逻辑未动（仅新增读 cache 用的 ref）。

**遗留问题（如实）**：
1. **publint pack 步骤环境受限（非代码）**：`publint --level error` 的 pack 变体需 pnpm 打开 `~/.local/share/pnpm/store` SQLite，workspace-write 沙箱拒绝（同 btw-ui-exec §4-1 基线）；本次尝试 `--config.store-dir` 指向工作区临时目录的 PATH shim，因空 store 联网拉包超时（300s）终止，已清理。目录 lint `--pack false` **All good**，包内容同一。
2. **单图不显示徽标**：按审计"多图才显示"落地（§3），非需求硬性指定；一行可改。
3. **工作树并发状态**：`src/host/vision.ts` 含并行兄弟档（识图提示词全落点）的改动，**非本档所为**；本档 tsdown 重建的 `lib/index.js` 会连带包含该改动，部署以最终树状态为准。
4. **预取失败重试频率**：失败重试随 poll 触发（idle 700ms），无冷却；与旧实现重试语义等价，仅不再因取消而丢结果。
5. **深色主题下遮罩视觉**：真实 mask 有 blur+主题 token；预览 PNG 为目检清晰将遮罩加重（alpha 215），真实观感更轻。

**自裁决**：**pass**。

## 8. 部署注意点（主代理部署期）

1. **lib 拷贝**：`cp -r lib ~/.dsh/profiles/node_modules/@local/dsh-btw/`（client.js 331.8KB；先备份部署位）→ 重启 DSH host + 浏览器强刷。
2. **验收点（GUI）**：面板顶部运行横幅为绿色 shimmer（边框/文字均 #b7e85b 系）；多图消息缩略图左上角白底黑字序号（1/2/…）；点击缩略图弹出全屏大图（遮罩 + 右上关闭钮），Esc / 点遮罩 / 点关闭钮均可关，且 Esc 不再连带收起整个抽屉；关闭后焦点回到缩略图。
3. 快速复核：`node_modules/.bin/publint --level error --pack false`。
