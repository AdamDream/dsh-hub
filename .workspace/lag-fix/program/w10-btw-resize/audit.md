# audit.md — btw 侧边对话抽屉「可拖拽调宽/调高」可行性审计与最小方案

- **线**：`w10-btw-resize`
- **日期**：2026-09-22
- **性质**：**只读可行性审计 + 方案设计**（本轮**未落地**，未写任何产品文件、未重启任何进程、未动 PID 301709）
- **用户直接诉求**：btw（侧边对话）目前的栏目**无法调整左右宽度和高度**，希望可以拖拽调整
- **必读依据**：`.workspace/lag-fix/exec-audit/BATCH-PLAN.md` §五 + `.workspace/lag-fix/incident2/VERDICT.md` + `docs/architecture/02-plugin-system.md`

## 路径简写

| 简写 | 实际路径 |
|---|---|
| `$R/` | `/home/CNS2026495165/dsh` |
| `$H/` | `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai` |
| `$D/` | `/home/CNS2026495165/.dsh`（运行时装单位 / settings） |

---

## 0. 结论摘要（先说判定）

| # | 问题 | 判定 | 一句话依据 |
|---|---|---|---|
| 1 | 抽屉尺寸从哪来 | **已确证** | 完全由**插件自己的客户端代码**算出，经内联 CSS 变量 `--side-chat-*` 落到 `.drawer`（`$R/dsh-btw/src/client/use-overlay-placement.ts:345-355` + `side-chat.module.css:46-48`） |
| 2 | 槽位是否固定尺寸、是否因此不可行？ | **不可行性不成立（可行）** | `shell.overlay` 的槽契约是 `{kind:'list', scope:'root'}`，**整套槽契约没有"几何字段"这个概念**（`$H/dsh-client-ui-slots/lib/types/index.d.ts:111-122`、`$H/dsh-client-ui-layout/lib/client.js:534-537`）；宿主浮层容器是 `position:absolute;inset:0`，对子元素**只设 `pointer-events`**（`$H/dsh-client-ui-layout/lib/client.js:56`） |
| 3 | 是否已有 resize 机制/先例可借鉴？ | **有，共 3 处；但都不能 import**，须自带实现 | ① layout 三栏列宽（指针、无 a11y、**不持久化**）；② **trajectory details 面板（功能最全：`role=separator`+`tabIndex:0`+方向键+双击复位，但同样不持久化）**；③ **`defineStore({persist})` → localStorage 是现成的持久化通道** |
| 4 | 生效面 | **热面（刷新浏览器即生效）**，**无需重启宿主** | 改的是 `$D/profiles/node_modules/@local/dsh-btw/lib/client.js`；`02-plugin-system.md:145`；且 `serveBundle` 每请求读盘 + `dsh-client-hmr` 在跑（子档实测 served rev `374dca63f9aa` == 部署位 sha1[:12]） |
| 5 | 是否需要改宿主/槽位 | **不需要** | 尺寸自绘 + 持久化走客户端 localStorage；**若**要把尺寸放进 `settings.yaml`（跨浏览器共享）**才**需要插件的**宿主**代码改动 ⇒ 那才是**冷面、需重启**（见 §6） |
| 6 | 主要工程风险 | **1 条硬风险 + 3 条中风险** | 硬风险：`useOverlayPlacement` 的 effect 依赖数组含 `desiredWidth`（`:340`）⇒ 拖拽期间**每帧重建 ResizeObserver/MutationObserver/监听器**（见 §4.5，必须解决） |

> **一句话答复用户诉求**：btw 抽屉的宽高**现在没有任何机制可调**，但它是**插件自绘的覆盖层尺寸**，不受槽位限制；加拖拽手柄 + localStorage 持久化是一处**纯客户端改动（热面，刷新即生效，零宿主改动、零重启）**，工程量集中在「几何求解器增加显式尺寸模式」与「避免拖拽期 effect 抖动」两点上。

---

## 1. ① 读懂现状：宽度/高度从哪来（全链 file:line）

### 1.1 挂载链（谁把抽屉放上去）

| 环节 | 位置 | 关键内容 |
|---|---|---|
| 槽注册 | `$R/dsh-btw/src/client/index.ts:57-79` | `ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name:'shell.overlay', id:'dsh-btw.drawer', order:100, locale:NS, inject:() => ({controller, viewStore, presentation, settingsScope, parentSessionId, onMinimize, onEnd}) }, SideChatDrawer))` |
| 槽宿主 | `$H/dsh-client-ui-layout/lib/client.js:234-238` | AppFrame 内：`jsx("div", { className: overlayLayer, "data-shell-overlay": true, children: renderSlot("shell.overlay", {}) })` |
| 槽锚点 | ui-renderer `SlotOutlet`（`ANCHOR_STYLE = {display:"contents"}`） | `[data-slot="shell.overlay"]` **不生成盒子** ⇒ 不可能是包含块 |
| 抽屉根 | `$R/dsh-btw/src/client/SideChatDrawer.tsx:60-95` | `<div ref={placementRootRef} className={css.placementRoot} data-dsh-btw-root data-placement-mode={placement.mode} style={overlayPlacementStyle(placement)}> … <aside className={css.drawer} data-dsh-btw-drawer role="complementary">` |

### 1.2 尺寸来源链（5 层，**没有任何一层来自槽位或 shell**）

```
① 调用点      SideChatDrawer.tsx:45   useOverlayPlacement(placementRootRef, { enabled: visible })
                                     └─ 未传 desiredWidth / minWidth / safeMargin
② 默认值      use-overlay-placement.ts:195-197 / 249-251
                                     desiredWidth = options.desiredWidth ?? 448
                                     minWidth     = options.minWidth     ?? 360
                                     safeMargin   = options.safeMargin   ?? 12
③ 几何求解    overlay-placement.ts:431-435  computeOverlayPlacement(input)
                                     = chooseRight(...) ?? chooseSheet(...)
                 chooseRight :230-271  宽 = floorQuantum(input.desiredWidth)；高 = work 全高（rect.bottom = work.bottom，:242）
                 chooseSheet :319-429  高 = sheetHeight(work) = round(available*0.48) 夹在 [min(280,available), 560]（:273-280）
                 finish      :205-228  产出 {left,top,right,bottom,width,height,maxHeight,degraded,reason}
④ CSS 变量    use-overlay-placement.ts:345-355  overlayPlacementStyle(placement)
                                     --side-chat-left/top/right/bottom/width/height/max-height
⑤ 消费        side-chat.module.css:40-59
                 .drawer{position:absolute; top:var(--side-chat-top); left:var(--side-chat-left);
                         box-sizing:border-box; width:var(--side-chat-width); height:var(--side-chat-height);
                         max-height:var(--side-chat-max-height); min-width:0; overflow:hidden; pointer-events:auto}
```

**实测结论**：
- 宽度**已经**是一个可调参数（`desiredWidth`），只是**没有任何 UI 把它接出来**——调用点是硬编码不传；
- 高度**连参数都没有**：`OverlayPlacementInput`（`overlay-placement.ts:15-23`）只有 `desiredWidth` / `minWidth`，**没有** `desiredHeight` / `minHeight`；`chooseRight` 的 rect 恒为 `top:work.top → bottom:work.bottom`（`:238-243`）⇒ **高度恒等于工作区全高，无法表达"矮一点"**；
- 常量表 `overlay-placement.ts:56-65`：`REGULAR_CONTENT_PEEK=320`、`COMPACT_CONTENT_PEEK=240`、`MODE_RESERVE=16`、`COMPACT_PREFERRED_WIDTH=400`、`BOTTOM_SHEET_RATIO=0.48`、`BOTTOM_SHEET_MIN_HEIGHT=280`、`BOTTOM_SHEET_MAX_HEIGHT=560`、`BOTTOM_SHEET_MAX_WIDTH=720`、`NARROW_SHEET_BREAKPOINT=480`。

### 1.3 为什么"现在不能调"（根因，三条）

1. **无手柄 UI**：`grep onPointerDown|setPointerCapture|pointermove|touch-action|onMouseDown|PointerEvent` 于整个 `$R/dsh-btw/src` ⇒ **0 命中**（子档 A 独立复核；主 agent 复核 `.tsx` 亦 0 命中）。抽屉里**完全没有拖拽代码**。
2. **无高度输入**：见 §1.2，`overlay-placement.ts` 的输入类型里根本没有高度参数。
3. **无持久化**：`$D/settings.yaml` 当前**连 `dsh-btw:` 段都没有**（子档 D 实测：顶层仅 12 个键，`grep -in btw` 无匹配）⇒ btw 全跑代码默认值；客户端也没有任何尺寸记忆。

> **顺带**：上游亦无此功能。`$R/dsh-btw/CHANGELOG.md` 0.1.0→0.4.0 **无任何 resize 条目**；0.2.0 反而把定位从 viewport-fixed 改成 collision-aware 自动放置（"Replace viewport-fixed positioning and z-index competition with collision-aware AppFrame-relative placement"）。⇒ 这是**新增能力**，不是恢复既有能力。

---

## 2. ② 可行性：槽位/布局是否允许插件自行调整尺寸

### 2.1 槽位判定：**不限制**（三条独立证据）

**证据 A：槽契约里没有"几何/尺寸"这个概念**

`$H/dsh-client-ui-slots/lib/types/index.d.ts:111-122` —— `SlotSpec` 的字段只有 `{kind, scope, inject?}`；`grep resizable|geometry|fixed|size` 于 `dsh-client-ui-slots` 类型 ⇒ 零命中（子档 A 实测）。
`shell.overlay` 的完整定义：`$H/dsh-client-ui-layout/lib/client.js:534-537`

```js
"shell.overlay": { kind: "list", scope: "root" }
```

**尺寸**在整套槽体系里只出现在 **`sidebar` 槽的 owner props** 上（`renderSlot("sidebar", { collapsed: sidebarCollapsed, width: cols.sidebar })`，`client.js:230-233`）——**`shell.overlay` 没有**。

**证据 B：宿主浮层容器对子元素只设 pointer-events**

`$H/dsh-client-ui-layout/lib/client.js:56`（AppFrame 内联 CSS 字面量，逐字）：

```css
.pI_x6G_frame{...;height:100%;...;display:grid;position:relative;overflow:hidden}
.pI_x6G_overlayLayer{z-index:20;pointer-events:none;position:absolute;inset:0}
.pI_x6G_overlayLayer>*{pointer-events:auto}
```

⇒ 容器**没有** `width/height/contain/container-type/max-width`；对子元素**只**设 `pointer-events:auto`。唯一几何事实是「浮层容器 == frame 框」+「frame 有 `overflow:hidden`（裁剪到 app 框）」。
⇒ **子元素尺寸完全自由**（这也是 btw 今天能自绘 448×全高 的前提）。

**证据 C：抽屉已在自己写绝对定位几何**

`.placementRoot{position:absolute;inset:0;pointer-events:none}`（`side-chat.module.css:13-17`）+ `.drawer{position:absolute;top/left/width/height:var(--side-chat-*)}`（`:40-59`）。
定位父级链：frame（`position:relative`）→ `.overlayLayer`（`position:absolute;inset:0`）→ `[data-slot]`（`display:contents`，**不生成盒子**）→ `.placementRoot`（`absolute;inset:0`）→ `.drawer`。
⇒ 包含块 = `.overlayLayer`，与 frame 框重合；**不存在"无处安放 absolute 子元素"的问题**。

### 2.2 既有 resize 机制与先例（3 处，逐个评价）

#### 先例 1：`ui-layout` 三栏列宽拖拽（**最接近本场景，但不完整**）

`$H/dsh-client-ui-layout/lib/client.js`：

| 内容 | 行号 | 摘录要点 |
|---|---|---|
| `DragHandle` 组件 | `:105-156` | `setPointerCapture(e.pointerId)`（`:122`）、`e.preventDefault()`、rAF 节流 `frame.current ??= requestAnimationFrame(...)`（`:128-135`）、`onPointerUp` 里补最后一次 `onDrag`（`:136-146`）、渲染 `jsx("div",{className:handle, style:{left}, "data-side", "data-dragging", onPointerDown/Move/Up})`（`:148-155`） |
| 挂载 | `:239-252` | sidebar 手柄 `left: cols.sidebar`；details 手柄 `left: viewport - cols.details`，仅在 `cols.details > 0` 时渲染 |
| dx 语义 | `:212-217` | `onSidebarDrag = dx => actions.setSidebar(base + dx)`；`onDetailsDrag = dx => actions.setDetails(base - dx)` |
| clamp | `:21-23` `clampWidth(px,min,max)`；`:286-291` | sidebar **264–420**；details **300–520**（另 `computeColumns` `:34-53` 二次钳制） |
| CSS | `:56` | `.pI_x6G_handle{cursor:col-resize;z-index:2;touch-action:none;width:8px;...;position:absolute;top:0;bottom:0}` |

**边界（不可照抄的部分）**：
- **只有左右两个方向**——手柄是 `top:0;bottom:0;width:8px` 的**竖条**，**没有水平手柄、没有角手柄** ⇒ 表达不了"调高"；
- **只有指针**——`div` 无 `role`、无 `tabIndex`、无方向键（该文件内 grep `role:|tabIndex|aria-valuenow|separator|onKeyDown|onDoubleClick` ⇒ 除一条无关注释外 **0 命中**）；
- **完全无持久化**——store 注释自陈 `The root entry's transient layout store`（`:258-261`），`createLayoutStore()`（`:277-292`）的 `defineStore({init, actions})` **没有 `persist` 字段** ⇒ **刷新即回契约默认 280 / 300–520**。

#### 先例 2：`ui-trajectory` details 面板手柄（**功能最全，最佳样板**）

`$H/dsh-client-ui-trajectory/lib/client.js:4899-4957`（主 agent 逐行复核）：

```js
jsx("div", {
  className: TrajectoryTable_module_css_default.detailsResizeHandle,
  role: "separator",
  "aria-label": "Resize event details",
  "aria-controls": "trajectory-detail-panel",
  "aria-orientation": "vertical",
  tabIndex: 0,
  title: "Drag to resize. Double-click to reset.",
  onDoubleClick: () => { setDetailsWidth(null); setToolRequestOffset(null); },        // ← 双击复位到 null(=auto)
  onPointerDown: (event) => {
    if (event.button !== 0) return;                                                   // ← 只认主键
    ... detailsResizeDrag.current = { pointerId, startX: event.clientX, startWidth: details.getBoundingClientRect().width, splitWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  },
  onPointerMove: (event) => {
    const drag = detailsResizeDrag.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    const nextDetailsWidth = clampDetailsWidth(drag.startWidth + drag.startX - event.clientX, drag.splitWidth);  // ← :4931
    setDetailsWidth(nextDetailsWidth);
  },
  onPointerUp:   (event) => { ...releasePointerCapture... },
  onPointerCancel: () => { detailsResizeDrag.current = null; },
  onKeyDown: (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const direction = event.key === "ArrowLeft" ? 1 : -1;                              // ← :4952 附近
    const nextDetailsWidth = clampDetailsWidth(currentDetailsWidth + direction * DETAILS_RESIZE_STEP, splitWidth);
    setDetailsWidth(nextDetailsWidth);
    event.preventDefault();
  }
})
```

配套常量与钳制（`:3264-3267`、`:3302-3305`）：

```js
const DETAILS_MIN_WIDTH = 320;
const DETAILS_MAX_WIDTH = 720;
const TABLE_MIN_WIDTH = 280;
const DETAILS_RESIZE_STEP = 16;
function clampDetailsWidth(width, splitWidth) {
  const maxWidth = Math.max(DETAILS_MIN_WIDTH, Math.min(DETAILS_MAX_WIDTH, splitWidth - TABLE_MIN_WIDTH));
  return Math.round(Math.min(Math.max(width, DETAILS_MIN_WIDTH), maxWidth));
}
```

手柄 CSS：`.Y0dWHa_detailsResizeHandle{z-index:6;cursor:col-resize;touch-action:none;user-select:none;background:0 0;border:0;width:8px;padding:0;position:absolute;top:0;bottom:0;left:-4px}`

**为什么这是最佳样板（三点关键同构）**：
1. **宽高语义与 btw 完全一致**：`startWidth + startX - clientX` = **向左拖 ⇒ 变宽**，因为都是「**右锚定面板的左边缘手柄**」。btw 抽屉正是右锚定（`chooseRight` 用 `lane.end - desiredWidth → lane.end`，`overlay-placement.ts:238-243`）⇒ **公式可逐字照抄**。
2. **`null` 哨兵 = 恢复自动**：`detailsWidth === null` 时面板宽度回落到 CSS 的 `width:clamp(320px,38%,440px)`；btw 可用同一哨兵表示「回到 §1.2 的自动放置」。
3. **a11y 完备**：`role="separator"` + `aria-orientation` + `aria-controls` + `tabIndex:0` + 方向键 + `title` 提示「拖拽调整，双击复位」。

**仍需自己补的三点**：① 它**只做宽度**（垂直 separator 只有左右键），btw 要做高度 ⇒ 需**第二个 `role="separator"` + `aria-orientation="horizontal"` + 上下键**；② 它**无 `aria-valuenow/min/max`**（两处先例都缺）⇒ 建议补齐；③ 它**不持久化**（`detailsWidth` 是 `useState(null)`，`:4295`）⇒ btw 需接持久化通道。
**且它也不可 import**：`ui-layout` 只导出 `{LayoutController, apply, inject}`（`client.js:564-566`），`DragHandle` 私有；`ui-primitives` 48 条导出里无 resize/separator/drag 原语（子档 A 实测）⇒ **手柄须自带实现**。

#### 先例 3：`defineStore({persist})` → localStorage（**现成的持久化机制**）

| 环节 | 位置 | 内容 |
|---|---|---|
| 类型 | `$R/dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/types/store.d.ts:34-38` | `interface StoreSpec<T,A> { init: () => T; persist?: string; actions: A }` —— 注释：「optional **persistence key (mechanical, framework-run)**」 |
| 实现 | `$H/dsh-client-runtime/lib/client.js:5472-5478` | `const persistKey = decl.persist === undefined ? undefined : scopeKey === undefined ? decl.persist : \`${decl.persist}.${scopeKey}\``；`createSnapshotStore(decl.init(), persistKey !== undefined ? { persist: { name: persistKey } } : undefined)` |
| 落盘 | `$H/dsh-client-runtime/lib/client.js:5429-5448` | `attachPersistence(api, name)`：`localStorage.getItem/setItem(name, JSON.stringify(state))`；注释：「Failure modes (quota, private mode) only disable persistence, **never break the store**」 |
| 宿主自用先例 | `$H/dsh-client-runtime/lib/client.js:8954` | `this.selection = createSnapshotStore({}, { persist: { name: "dsh.sessions.current" } })` |
| 另一先例 | `$H/dsh-client-ui-trajectory/lib/client.js:40-42` | 键 `dsh.trajectory.duration` |
| **root 作用域不会被清理** | `$H/dsh-client-runtime/lib/client.js:163-172` | `pruneStoreScope(sessionId){ for(...){ if (record.scope !== "session") continue; (...).clearPersisted(); } }` —— 注释明写「**root-scoped records are untouched**」；全树 `grep clearPersisted` 只有这一个调用点 ⇒ **root 持久化键在插件重载/刷新/宿主重启后都保留** |
| 座位挂法 | `$H/dsh-client-ui-slots/lib/types/index.d.ts:413-421` | `store?: H` ——「Store seat: a shared handle (apply-constructed) or an exclusive factory (framework-called per entry x scope)」 |
| 运行时先例 | `$H/dsh-client-ui-layout/lib/client.js:540` | `store: createLayoutStore`（**宿主自己的面板宽度 store 就是走这个座位**）；`AppFrame({ useStore, useSessions, actions, renderSlot })`（`:158`）确实收到 `useStore`/`actions` ⇒ **端到端已被宿主证明可用** |
| props 组合 | `$H/dsh-client-ui-slots/lib/types/index.d.ts:350-366` | `ComposedProps = … & PropsStore<H> & InjectFace<I> & …`；`PropsStore<H> = { useStore: SnapshotSelectorHook<T>; actions: BakedActions<T,A> }`（`:101-104`）；root 作用域槽的 inject 工厂收到 `[actions]`（`:366`） |

### 2.3 可行性结论

> **dsb 槽位不构成限制。** 抽屉尺寸是插件自绘的覆盖层几何，`shell.overlay` 是 `list/root` 自由挂载点，槽契约无几何字段，宿主容器对子元素只设 `pointer-events`。**既有先例（trajectory 手柄 + layout store 座位 + defineStore persist）三者相加已覆盖本需求所需的全部机制，且全部由宿主自己使用**，只是没有一处把它们组合成"可拖拽 + 可调高 + 可持久化 + 无障碍"的抽屉。
> ⇒ **判定：可行，且是纯客户端改动（热面）。**

### 2.4 对照：如果**非要**"改槽位"（**不推荐，仅在需求升级时才走**）

用户要求"若槽位限制导致不可行，明确说明并给出改槽位的源码级方案与风险"。**本场景不适用**（§2.3），但为完整性给出对照方案：

| 方案 | 源码级改法 | 风险 |
|---|---|---|
| **S-槽1：给 `shell.overlay` 加尺寸 owner props** | 让 AppFrame 把浮层可用框作为 owner props 传给 `renderSlot("shell.overlay", { frame: {...} })`，即 `$H/dsh-client-ui-layout/lib/client.js:234-238` | ① 改的是**宿主官方包**（`~/.npm-global/.../dsh-client-ui-layout/lib/client.js`，已被本工作区主题批 U-TP0/1/2 打补丁）⇒ **冷面（宿主 lib 改需重启）**；② 与主题批共用同一文件 ⇒ **写入者冲突**（BATCH-PLAN §三bis.5 单一写入者纪律）；③ 对 btw 是"给了它已经能自己算的东西"，**零收益** |
| **S-槽2：新增一个 `shell.panel` 槽并声明 `defaultSize/min/max`** | 新增槽定义（`slotMap` 扩充）与 owner 侧的尺寸 store | ① 属**宿主槽契约扩展** ⇒ 冷面 + 需重启 + 影响所有槽消费者；② 把"抽屉的事"变成"框架的事"，与既有 `shell.overlay` 的"自由挂载点"设计意图相反；③ btw 需同时兼容新旧槽 ⇒ 双路径维护 |
| **S-槽3：让 btw 用 `details` 槽（`{kind:'single', scope:'session'}`）替代 `shell.overlay`** | 把 `SideChatDrawer` 注册到 `details` 槽 | ① `details` 是 `single` + `session` 作用域，**同一时刻只能有一个注册者**，会与宿主自己的详情面板**互相遮蔽**（`kind:'single'` 的 shadowing 选举）；② `details` 宽度受宿主 `setDetails` 钳制 **300–520**（`client.js:289-291`）且**不与插件共享写入口**；③ 语义错误（btw 是覆盖层，不是第三栏）⇒ **否决** |

---

## 3. ③ 最小方案设计

### 3.1 总体形状（改动面一览）

| 层 | 文件 | 改动 | 生效 |
|---|---|---|---|
| 几何输入类型 | `$R/dsh-btw/src/client/overlay-placement.ts` | `OverlayPlacementInput` 增 `desiredHeight?` / `minHeight?` / `explicitSize?`；`chooseRight` 增显式尺寸分支；`chooseSheet` 增显式高度 | 热（bundle） |
| 放置 hook | `$R/dsh-btw/src/client/use-overlay-placement.ts` | options 增 `sizeRef` / `minHeight`；导出 `remeasure`；**把尺寸从 effect deps 移除**（见 §4.5） | 热 |
| 抽屉组件 | `$R/dsh-btw/src/client/SideChatDrawer.tsx` | 接 store 座位（`useStore`/`actions`）、挂手柄、传 `sizeRef`、调用 `remeasure` | 热 |
| 手柄组件（新） | `$R/dsh-btw/src/client/SideChatResizeHandle.tsx`（建议新建） | `role="separator"` × 2 + 角手柄，pointer 拖拽 + 键盘 + 双击复位 | 热 |
| 样式 | `$R/dsh-btw/src/client/side-chat.module.css` | 新增手柄类（**必须自带 `pointer-events:auto`**，因 `.placementRoot` 是 `pointer-events:none`） | 热（**CSS 被内联进 bundle，必须重建**） |
| 文案 | `$R/dsh-btw/src/client/locales.ts` | 新增 `drawer.resizeWidth` / `drawer.resizeHeight` / `drawer.resizeCorner` / `drawer.resizeHint`（**`zh` 与 `en` 两套都要加**） | 热 |
| 尺寸 store（新） | `$R/dsh-btw/src/client/index.ts` | `defineStore({ init, persist:'dsh.btw.drawerSize', actions })`，作为 `store:` 座位传给既有 `shell.overlay` 注册 | 热 |
| 测试 | `$R/dsh-btw/tests/` | 新增 `overlay-placement-explicit.spec.ts` + 手柄组件测试；**既有 `overlay-placement.spec.ts` / `overlay-measurement.spec.tsx` 必须一字不改全绿** | — |

**无需改动**：任何宿主/官方包、任何槽定义、`package.json` 的 `dsh.client` 声明、`$R/dsh-btw/src/index.ts`（宿主插件）——**只要走 §4.6 的通道 A**。

### 3.2 尺寸模型：`null = 自动`（与 trajectory 先例同构）

```ts
/** 0 值哨兵：null/undefined 表示"未显式指定 ⇒ 走既有自动放置"（= 今天的行为，逐字节不变） */
interface DrawerSizeState {
  width: number | null    // px，已 round；null = auto（448 起算的碰撞感知放置）
  height: number | null   // px，已 round；null = auto（工作区全高）
}
defineStore({
  init: () => ({ width: null, height: null }),
  persist: 'dsh.btw.drawerSize',
  actions: {
    setWidth:  (d, px: number | null) => { d.width  = px === null ? null : clampStored(px, MIN_WIDTH,  MAX_WIDTH_ABS) },
    setHeight: (d, px: number | null) => { d.height = px === null ? null : clampStored(px, MIN_HEIGHT, MAX_HEIGHT_ABS) },
    reset:     (d) => { d.width = null; d.height = null },
  },
})
```

**三条不变式**：
- **INV-1（默认等价）**：`{width:null, height:null}` 时，`computeOverlayPlacement` 的输入与今天**逐字段相同** ⇒ 引擎输出与今天**逐字段相同**；
- **INV-2（只钳渲染，不改偏好）**：视口变窄时**只**在渲染路径钳制，**不覆写** store 里的偏好值（否则一次窄窗会把用户设置永久压小）。落盘时只做"防荒谬"钳制（`MAX_WIDTH_ABS = 10000`）；
- **INV-3（显示值 = store 值的钳制投影）**：`aria-valuenow` 等展示口径一律用**钳制后**的值。

### 3.3 拖拽手柄（左右 / 上下 / 角）

| 手柄 | 位置 | 语义 | 生效模式 |
|---|---|---|---|
| **左边缘** | `.drawer` 内左侧，`position:absolute; left:0; top:0; bottom:0; width:8px`（**不可像 trajectory 那样放 `left:-4px` 外侧，因为 `.drawer` 是 `overflow:hidden`**，`side-chat.module.css:50`） | 水平：**向左拖 ⇒ 变宽**（`nextWidth = startWidth + (startX - clientX)`，与 trajectory `:4931` 同式） | `right` / `compact-right` / `bottom-sheet` 全模式 |
| **远侧竖边** | `right`/`compact-right` 模式 = **下边缘**（`bottom:0; left:0; right:0; height:8px`）；`bottom-sheet` 模式 = **上边缘**（`top:0`） | 垂直：**向外拖 ⇒ 变高**（`nextHeight = startHeight ± (clientY - startY)`，符号随锚定边） | 全模式（锚定边随 `placement.mode` 切换） |
| **角手柄** | 左边缘 与 远侧竖边 的**交角**（`right` 模式 = 左下角，需注意 `.drawer` 有 `border-radius:16px`（`:54`）⇒ 角手柄内缩 ≥6px 以避开圆角） | 同时改宽与高（一次 pointer 手势写两个 action） | 全模式 |

**pointer 语义（逐条，全部取自先例 1/2 的实测写法）**：
1. `onPointerDown`：`if (event.button !== 0) return`（trajectory `:4911`）→ 记录 `{pointerId, startX, startY, startWidth, startHeight, workFrame}`（**从 `placement` 或 `placementRootRef` 的 rect 取，不重复测 DOM**）→ `event.currentTarget.setPointerCapture(event.pointerId)` → `event.preventDefault()`。
2. `onPointerMove`：`if (dragRef.current?.pointerId !== event.pointerId) return`；**rAF 节流**（`frameRef.current ??= requestAnimationFrame(...)`，layout `:128-135`）；算出 `nextW/nextH` → 写 `sizeRef.current` → 调 `remeasure()`。
3. `onPointerUp`：`releasePointerCapture`；**补一次最终计算**（layout `:136-146` 的做法）→ **提交到 store**（`actions.setWidth/setHeight`）⇒ 一次拖拽 = **1 次 localStorage 写**。
4. `onPointerCancel`：清 `dragRef`，并把 `sizeRef` **回滚到拖拽前的值** + `remeasure()`（避免中断留下未提交的半态）。
5. `touch-action: none`（必须，否则触屏/触控板手势被浏览器吞）；`user-select: none`。
6. **新手柄必须显式 `pointer-events: auto`**——`.placementRoot` 是 `pointer-events:none`（`:13-17`），只有 `.drawer`(`:57`) 与 `.mobileScrim`(`:31-38`，其中 `pointer-events:auto` 在 **`:37`**) 恢复了它；手柄若放在 `.drawer` 内会继承 auto，**但若日后把手柄移出 `.drawer` 会静默失效** ⇒ 写进 CSS 注释与验收项。

### 3.4 几何求解器扩展：显式尺寸模式（`explicitSize`）

在 `overlay-placement.ts` 增一个**可选**输入，**默认关闭**，只有 store 里存在非 null 值时才开：

```ts
interface OverlayPlacementInput {
  frame, viewport, safeArea, occupied            // 不变
  desiredWidth: number; minWidth: number; safeMargin: number   // 不变
  /** 新增（全部可选，缺省 = 今天的行为） */
  desiredHeight?: number
  minHeight?: number
  explicitSize?: boolean
}
```

**`explicitSize === true` 时的求解规则**（`chooseRight`）：

```
W_avail = work.right - work.left ;  H_avail = work.bottom - work.top
if (W_avail < minWidth || H_avail < minHeight) → 退回非显式路径（既有行为，保证极端窄窗不崩）
wantW = clamp(desiredWidth,  minWidth,  max(minWidth,  W_avail - PEEK_MIN))     // PEEK_MIN = 240
wantH = clamp(desiredHeight, minHeight, max(minHeight, H_avail))
候选 rect：
  left   = 该 lane.end - wantW     （右锚定，同 :238-243）
  top    = work.top                （顶锚定，同 :241）
  right  = lane.end
  bottom = work.top + wantH        （← 与今天的 work.bottom 不同，这是"可调高"的全部差异）
lane 接受条件：wantW <= laneWidth - MODE_RESERVE          （**去掉 REGULAR_CONTENT_PEEK 要求**）
若所有 lane 都不接受 → 仍用"最宽 lane"（**不得**返回 null，**不得**退回 compact/sheet）
```

**三条设计理由（每条对应一个已识别的失败模式）**：
- **去掉 `REGULAR_CONTENT_PEEK`**：非显式路径要求 `laneWidth >= desiredW + 320 + 16`（`:235`）。若用户把宽度拖到超过 `lane - 336`，**保留该条件会让抽屉在拖拽中途从"用户宽度"跳回 `COMPACT_PREFERRED_WIDTH = 400`**（`:255`）——即"橡皮筋弹回"。`PEEK_MIN` 已经在 §3.7 的 `maxWidth` 里统一保证"主区至少留 240px"，**不需要再在 lane 过滤里重复一刀**。
- **不得返回 null**：`computeOverlayPlacement`（`:431-435`）是 `chooseRight(...) ?? chooseSheet(...)`，一旦返回 null 就会**在拖拽中途切换模式**（右栏 → 底部 sheet），造成视觉跳变与手柄锚定边互换 ⇒ 显式模式下 `chooseRight` **必须总有输出**。
- **顶锚定**：与今天一致（`:241` `top: work.top`）。若改成"底锚定"，用户拖动下边缘时抽屉会**整体上移**（顶部离开原位），与"拉伸手柄"的直觉不符。
  ⚠️ **待产品确认**：`right` 模式下"下边缘拖拽 = 改高、顶部不动"是本方案的取舍；若希望"底部不动、顶部下移"，只需把显式模式下的 `top` 改为 `work.bottom - wantH`（**一行**），但会与 `bottom-sheet` 模式的锚定语义相反，故默认取顶锚定。

**`chooseSheet`（`bottom-sheet` 模式）的显式化**：`sheetHeight(work)`（`:273-280`）换成 `clamp(desiredHeight, minHeight, H_avail)`；宽度用 `clamp(desiredWidth, minWidth, max(minWidth, W_avail - PEEK_MIN))`。其余（`candidateSheetTops` / `clean` / fallback）**不动**。

### 3.5 ⚠️ 硬风险：拖拽期间 effect 抖动（**本方案必须解决的核心工程问题**）

`$R/dsh-btw/src/client/use-overlay-placement.ts:340`：

```ts
  }, [desiredWidth, enabled, minWidth, rootRef, safeMargin, selectorKey])
```

该 effect 体内（`:254-339`）会**新建并注册**：`ResizeObserver`（`:267`）+ `MutationObserver`（`:299`）+ `window.resize` / `visualViewport.resize` / `visualViewport.scroll` 三个监听（`:326-328`）+ `document.body` 子节点观察（`:320`）+ `schedule()`（`:329`），并在 cleanup 里逐个断开。

**若把 `desiredWidth` 直接接上 store（`useStore(s => s.width)` 传入 options），则拖拽期间每个 rAF 帧都会：**
teardown 全部观察者 → 重建 `observe()` 集合 → 额外触发一次 `rAF` 测量 → `setPlacement` → 再渲染。
⇒ 每秒 ~60 轮「5 个观察者对象构造 + 十余次 `observe/disconnect` + 一次额外 rAF」。

**在本机（AMD Raphael 核显 + 4K@150% 分数缩放，见 `incident2/VERDICT.md` §一②）这属于会被用户直接感知的开销**，且与 BATCH-PLAN §五 的测量纪律（帧间隔/长任务）直接冲突。

**⇒ 强制设计（MUST）**：拖拽期间**不得**让该 effect 重跑。

**推荐形状（Shape 1：尺寸走 ref，暴露命令式 remeasure）**

```ts
// use-overlay-placement.ts
export interface OverlayPlacementOptions {
  avoidSelectors?: readonly string[]
  desiredWidth?: number          // 保留：仅作为"初始/自动"值
  minWidth?: number
  safeMargin?: number
  enabled?: boolean
  /** 新增：活体尺寸来源。measure() 内读 .current ⇒ **不进 deps** */
  sizeRef?: { current: { width: number | null; height: number | null } }
  minHeight?: number
}
export interface OverlayPlacementResult extends OverlayPlacement { remeasure(): void }

export function useOverlayPlacement(rootRef, options = {}): OverlayPlacementResult
```

- `measure()` 内读 `sizeRef.current`，折算成 `{desiredWidth, desiredHeight, explicitSize}` 传给 `computeOverlayPlacement`；
- effect deps **移除**尺寸项，改为 `[enabled, minWidth, minHeight, rootRef, safeMargin, selectorKey]`（`sizeRef` 是稳定引用，天然不入 deps）；
- 返回 `{...placement, remeasure}`，其中 `remeasure = schedule`（已 rAF 节流，`:293-296`）；
- `SideChatDrawer` 里 `sizeRef = useRef<DrawerSize>({ width: store.width, height: store.height })`；拖拽写 `sizeRef.current` + `remeasure()`；**pointerup 才** `actions.setWidth/Height`（一次 React 渲染 + 一次 localStorage 写）；
- **`reset()` / 外部 store 变更**（只在 reset 与初始挂载发生）同步写 `sizeRef.current` 再 `remeasure()`。

**零回归保证**：`sizeRef` 缺省（`undefined`）时行为与今天完全一致 ⇒ 既有测试不受影响。调用点只有 `SideChatDrawer.tsx:45` 一处（已核验），签名变更安全。

> **不接受 Shape 2**（"拖拽期用 JS 直接改 CSS 变量、pointerup 才 setState"）：会引入两份几何真值（求解器输出 vs 直接写入）、必须重复实现 clamp/锚定数学，且绕过 `samePlacement` 去重（`:231-241`）⇒ 更易发散。仅作为 Shape 1 受阻时的退路。

**验收时必须有量化证据**（见 §4.4·A7）：拖拽 1 秒内 effect 重跑次数 = **1**（挂载那次），观察者构造次数不随帧数增长。

### 3.6 尺寸持久化：**写哪里**（两条通道对比 + 推荐）

| | **通道 A：客户端 store + localStorage（推荐，Phase 1）** | **通道 B：`settings.yaml` via `settingsScope.set`（Phase 2，可选）** |
|---|---|---|
| 机制 | `defineStore({ persist:'dsh.btw.drawerSize', … })` 作为 `shell.overlay` 注册的 `store` 座位 | `settingsScope.set('ui', {…整个 ui 对象, width, height})` |
| 证据 | `ui-slots/.../store.d.ts:34-38`；`$H/dsh-client-runtime/lib/client.js:5429-5448,5472-5478`；root 不被清理 `:163-172`；宿自主用 `:8954` | `$H/dsh-client-runtime/.../settings-scope.d.ts:53-77`（`set`/`unset`）；`$H/dsh-client-ui-settings/lib/client.js:1015-1021`（`{op:'set', path:[field], value}`）→ `:1041` `api.settings.mutate`；宿主 `$H/dsh-settings/lib/index.js:430-443`（`mutate` 的 path 校验）+ `:459`（`ops.reduce(applyPathOp, current)`） |
| 落点 | 浏览器 `localStorage['dsh.btw.drawerSize']` | `$D/settings.yaml` 的 `dsh-btw:` 段 |
| **生效面** | **热面：改 `lib/client.js` + 刷新浏览器** | **冷面：需插件的宿主 schema/`lib/index.js` 改动 ⇒ 重启一次**（除非接受"未声明键"写法，见下） |
| 跨浏览器共享 | ✗（每浏览器独立；且 `attachPersistence` 只在 attach 时读一次，**同浏览器多标签不互同步**） | ✓ |
| 宿主改动 | **零** | 需在 `$R/dsh-btw/src/index.ts:24-51` 的 `BTW_SETTINGS_SCHEMA` 增字段（**冷**），否则字段属"未声明" |
| 每次拖拽的代价 | 1 次 `localStorage.setItem`（同步、极小 payload） | 1 次 RPC `settings.mutate` → **写盘 settings.yaml** → `bumpRevision` → `emitDocumentUpdated` → **整个设置 UI 重新 resolve**（`:459-512`） |
| 风险 | 配额/隐私模式失败 ⇒ **只丢持久化，不损坏 store**（实现注释明写） | revision 冲突（`SettingsConflictError`）+ 整棵 `ui` 子树替换（并发写 `ui.banner` 会被覆盖，靠 `recover()` 兜）；`mode:'memory'` 时（**非 loopback**）写入是**静默 no-op**（`$H/dsh-client-ui-settings/lib/client.js:1079`、`:1166`） |
| 结论 | **推荐，作为唯一必需通道** | 仅当用户明确要"换浏览器也保持"时才做；且**必须先声明 schema**（否则是欠账） |

**通道 B 的两个致命细节（若执行档要做 Phase 2，必须遵守）**：
1. **`set(field)` 只支持顶层字段**：实现硬编码 `path: [field]`（`dsh-client-ui-settings/lib/client.js:1016-1020`）⇒ `set('ui.width', 520)` 会写出**字面键 `"ui.width"`**，**错**。正确写法是**读-改-写整个 `ui` 对象**：
   `const ui = scope.getSnapshot().value.ui; scope.set('ui', { ...ui, width, height })`（与 `dsh-wallpaper-local/lib/client.js:486-496` 的 `commitField` 完全同构：先查 `status==='ready' && writable` → 乐观镜像 → `set().catch()` 回滚）。
   或自行走深层 path（宿主与 wire **都支持**：`$H/dsh-settings/lib/index.js:430-443`、`dsh-host-apiproxy` 的 `settings.schema` 的 `path:['ui','width']`），但那要绕开 `SettingsScope` 抽象。
2. **`decodeBtwSettings` 逐字段重建**（`$R/dsh-btw/src/client/btw-settings.ts:47-70`，返回 `{ui:{banner,modelSelect,imageBadge}, vision:{…}, model:{…}}`）⇒ **不显式加字段就会把 `width/height` 丢掉**。Phase 2 必改三处：`BtwSettingsSection`（`:18-33`）、`decodeBtwSettings`（`:47-70`）、`BTW_SETTINGS_DEFAULTS`（`:41-45`）；宿主侧若声明 schema 还要同步 `src/index.ts` 的两处 `default`。

**schema 是否 strict（已实跑确证）**：`@deepseek-ai/schemastery` 的 `z.object` 是 **loose** —— 用 btw 真实 schema 实测 `S({ui:{width:5,height:7}})` → `{"ui":{"width":5,"height":7}}`，未知顶层键同样保留。⇒ 即使不声明，写入也能落盘并读回（**存在免重启的偷懒路径**）；但已声明键**类型错会在注册期抛 `ValidationError`** ⇒ **不要**给已有键改类型。**审计建议**：走通道 A，**不碰 schema**，把"声明 `ui.width/height`"作为独立的可选维护项。

### 3.7 边界约束与"与主区域争让"

| 约束 | 值 | 依据 / 理由 |
|---|---|---|
| `MIN_WIDTH` | **360** | 沿用既有 `minWidth` 默认（`use-overlay-placement.ts:196,251`），**不引入新的最小宽度**，避免与既有 `minWidth` 语义打架 |
| `MAX_WIDTH`（渲染期） | `max(MIN_WIDTH, workWidth - PEEK_MIN)`，`PEEK_MIN = 240` | **这是"与主区域争让"的唯一硬保证**：抽屉是覆盖层，**不 reflow**（§3.8），所以只能靠宽度上限保证主对话区至少留出 240px（复用既有 `COMPACT_CONTENT_PEEK = 240` 语义）。`workWidth` 取 `workArea()` 结果（`overlay-placement.ts:150-167`），已扣除 `max(12, safeMargin)` 与安全区 inset |
| `MAX_WIDTH_SOFT`（可选） | `960`（建议，**待产品确认**） | 4K 全屏下 `workWidth ≈ 3400` ⇒ `workWidth-240` 允许近全宽，抽屉会退化成"整页"。若产品不希望这样，加一个软上限。**本审计的默认建议：不加软上限**（用户诉求是"自由调整"），仅把常量留出来 |
| `MIN_HEIGHT` | **240** | `.drawerHeader` 是 `min-height:68px`（`side-chat.module.css:69-78`）+ `.parentStatus`（`min-height:36px`，`:175`）+ `.composer`（`min-height:74px`，`:358`）≈ 178px 不可压缩内容 ⇒ 240px 留出至少 1 行转录区；**避免出现"拖到完全看不见内容"的不可恢复态** |
| `MAX_HEIGHT`（渲染期） | `workHeight`（= 今天的自动行为） | 顶锚定 + 不得超高工作区；`workHeight` 已扣安全区与 margin |
| 存储期钳制 | `width ∈ [360, 10000]`、`height ∈ [240, 10000]` | 只防荒谬值；**真正的钳制在渲染期**（INV-2） |
| 键盘步长 | **16px**（`Shift` 时 64px） | 16 直接沿用 trajectory `DETAILS_RESIZE_STEP = 16`（`:3267`）的既有手感 |
| 量化 | 存入 store 前 `Math.round`；求解器内部已有 `floorQuantum/roundQuantum`（`QUANTUM=4`，`:56,81-83`） | 复用既有量化，不引入第二套网格 |
| 视口变化 | `width/height` **不覆写**，重新钳制后渲染 | INV-2；`useOverlayPlacement` 已在 `window.resize`/`visualViewport` 上重算（`:326-328`） |
| **不挤压主区域** | 无需额外处理 | 见 §3.8（覆盖层，无 reflow） |

**已识别的既有隐患（相关，不属本方案引入）**：`pane()` 首选 `[data-pane="sidebar"|"details"]`，但**核心零写入者**，实际靠 CSS-module 哈希类名子串匹配 `sidebarCol`/`detailsCol` 兜底（`use-overlay-placement.ts:63-78`）⇒ 宿主改类名会静默让"避让 sidebar/details"失效。**与本方案无关，但建议单独记一条加固项**（给列补 `data-pane` 语义标记）。

### 3.8 "与主区域争让"的实际行为：**避让，不挤压**

- 抽屉渲染在 `.overlayLayer` 内（`z-index:20; position:absolute; inset:0`，`$H/dsh-client-ui-layout/lib/client.js:56`），而主区域的宽度由 frame 的 `gridTemplateColumns = ${sidebar}px minmax(0,1fr) ${details}px` 决定（`:224`）——**浮层不参与 grid** ⇒ **改抽屉尺寸不会改变主区域宽度（零 reflow）**，只会**遮挡**。
- btw 的定位代码对宿主 DOM **只读不写**（`grep setProperty|.style.|removeProperty` 于 `use-overlay-placement.ts` ⇒ 零命中；独立的子档 A 复核同结论）⇒ 今天的行为本身也是"避让"而非"挤压"：把宿主 sidebar/details 收进 `occupied`（`:126-148,183-192`）后求水平 lane 补集（`overlay-placement.ts:191-203`），在空 lane 里放抽屉。
- **副作用（必须写进验收）**：抽屉变宽后会遮挡宿主 details 栏的**列宽拖拽手柄**（`.pI_x6G_handle` 的 `z-index:2` < 覆盖层 `z-index:20`；`$H/dsh-client-ui-layout/lib/client.js:56`），仅在与抽屉盒子重叠处失效（`.placementRoot` 的 `pointer-events:none` 让非抽屉区域仍可穿透）。⇒ 见验收项 A8。
- **`bottom-sheet` 模式**：`sheetHeight`（`:273-280`）与 `[data-placement-mode='bottom-sheet'] .drawer{border-radius:16px 16px 0 0}`（`side-chat.module.css:388-390`）。该模式下抽屉是**底锚定 + 右锚定**（`chooseSheet` 的 `rect` 用 `freeLane.end - width → freeLane.end` 与候选 `top`，`:354-359`）⇒ 手柄的"远侧竖边"要切到**上边缘**。
- **移动端**：`.mobileScrim` 只在 `@media (max-width:720px)` **且** `bottom-sheet` 模式显示（`side-chat.module.css:563-566`），是"点击遮罩即最小化"的模态语义 ⇒ **建议在 `max-width:720px` 下隐藏全部手柄**（窄屏拖拽与滚动手势冲突，且模态遮罩语义下"调整尺寸"无意义）。这是**产品取舍点，需确认**。

### 3.9 键盘可达（无障碍）

对手柄补齐 **两个** `role="separator"`（trajectory 只有宽度那一个）：

```tsx
// 宽度手柄（左边缘）
<div className={css.resizeWidth} role="separator" tabIndex={0}
     aria-orientation="vertical"
     aria-controls="dsh-btw-drawer"          // 需给 <aside className={css.drawer}> 加 id
     aria-label={t('drawer.resizeWidth')}
     aria-valuenow={shownWidth} aria-valuemin={MIN_WIDTH} aria-valuemax={maxWidthForA11y}
     aria-valuetext={`${shownWidth}px`}
     title={t('drawer.resizeHint')}          // 「拖拽调整 · 双击复位」
     onPointerDown={…} onPointerMove={…} onPointerUp={…} onPointerCancel={…}
     onKeyDown={onWidthKeyDown} onDoubleClick={onReset} />

// 高度手柄（远侧竖边）
<div className={css.resizeHeight} role="separator" tabIndex={0}
     aria-orientation="horizontal"
     aria-controls="dsh-btw-drawer"
     aria-label={t('drawer.resizeHeight')}
     aria-valuenow={shownHeight} aria-valuemin={MIN_HEIGHT} aria-valuemax={maxHeightForA11y}
     aria-valuetext={`${shownHeight}px`}
     title={t('drawer.resizeHint')} … />
```

| 键 | 宽度手柄 | 高度手柄 | 角手柄（可选） |
|---|---|---|---|
| `ArrowLeft` | **+16**（向左拖 = 变宽，与指针方向一致） | — | +16 宽 |
| `ArrowRight` | **−16** | — | −16 宽 |
| `ArrowUp` | — | `right` 模式 **−16**（向上拖 = 变矮）/ `bottom-sheet` 模式 **+16** | 同左 |
| `ArrowDown` | — | 与 `ArrowUp` 相反 | 同左 |
| `Shift + 方向键` | ±64（加速度） | ±64 | ±64 |
| `Home` / `End` | 最小 / 最大 | 最小 / 最大 | 宽度维 |
| `Enter` / `Space` | **复位（= 双击复位）** | 复位 | 复位 |
| `Escape` | 拖拽中：取消本次拖拽（回滚到拖拽前） | 同左 | 同左 |
| `PageUp/PageDown` | 可选 ±96 | 可选 ±96 | — |

**两条必须处理的冲突**：
1. **`Escape` 冲突（已确证）**：`SideChatDrawer.tsx:47-56` 在 `window` 上监听 `keydown`，`Escape` → `onMinimize()`（最小化抽屉）。手柄上的 `keydown` 会**先于** window 冒泡 ⇒ 手柄处理器内**必须 `event.stopPropagation()`**，否则"Escape 取消拖拽"会变成"Escape 关闭抽屉"。
2. **方向键冲突**：抽屉内含 `<select className={css.modelSelect}>`（`SideChatSurface.tsx:448`）与 `<textarea>`（`:612` 起，`.composer` 容器 `:611`）⇒ 手柄的 `onKeyDown` 只在自己聚焦时触发，**不需要**全局拦截；但**必须**在方向键处理里 `event.preventDefault()`（trajectory `:4953` 的做法），避免页面滚动。

**焦点可见性**：两端先例都写 `outline:none`（trajectory 的 `.detailsResizeHandle:focus-visible{outline:none}`）——**这是 a11y 反模式，不要照抄**。btw 手柄应给 `:focus-visible` 一个可见描边，例如 `outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:-2px`（该变量族在本仓库被 `.Y0dWHa_historyLoadButton:focus-visible` 等使用）。

### 3.10 双击复位

- 三个手柄都绑 `onDoubleClick = onReset`；`onReset` = `actions.reset()`（`width=null, height=null`）+ 同步 `sizeRef.current` + `remeasure()` ⇒ **回到 §1.2 的自动放置**（INV-1），并**清除** localStorage 里的非默认值（写回 `{width:null,height:null}` 即可；无需 `clearPersisted()`）。
- **键盘等价路径**：聚焦手柄后 `Enter`/`Space`（§3.9）。**双击本身不是键盘可达的** ⇒ 必须同时提供 Enter，否则 a11y 不达标。
- **发现性**：`title={t('drawer.resizeHint')}` 与 `hover` 时的视觉把手（参考宿主 `$H/dsh-client-ui-layout/lib/client.js:56` 的 `.handle[data-side=details]:after` 悬浮显示 12×32 圆角把手的做法：`opacity:0 → 1` on `:hover` / `[data-dragging=true]`）。

---

## 4. ④ 验收标准

### 4.1 可用性（A 组）

| # | 判据 | 方法 |
|---|---|---|
| A1 | 鼠标拖左边缘 ⇒ 宽度连续跟随，**左拖变宽**（与指针同向，无反向/无滞后 >1 帧） | 手工 + 探针：记录 `pointermove.clientX` 与 `.drawer` 的 `getBoundingClientRect().width`，逐帧**同向**且 `|Δwidth − ΔclientX| ≤ 1px` |
| A2 | 拖远侧竖边 ⇒ 高度连续跟随；`right` 模式是下边缘、`bottom-sheet` 模式是上边缘 | 手工（分别在宽窗/窄窗触发两种 mode） |
| A3 | 角手柄同时改宽高，单手势一次提交（1 次 localStorage 写） | 计数探针包裹 `localStorage.setItem` |
| A4 | **无"橡皮筋弹回"**：从 448 连续拖到 `workWidth-240` 全程，宽度**单调不减**，中途**不发生** mode 切换（`data-placement-mode` 恒定） | 记录每帧 `data-placement-mode` 与 width 序列，断言单调 + mode 集合大小 = 1 |
| A5 | `MIN_WIDTH=360` / `MIN_HEIGHT=240` 下继续外拖 ⇒ 值被钳住但手柄不"脱手"；`MAX` 同理 | 手工 + 值断言 |
| A6 | 双击任一 Store ⇒ 回到自动（`data-*`/几何与"从未设置过"一致） | 与 A9 的基线快照逐字段比对 |
| A7 | 键盘：`Tab` 可聚焦两个手柄；方向键 ±16、`Shift` ±64、`Home/End` 到极值、`Enter` 复位；`Escape` **取消拖拽而不关闭抽屉** | 手工 + `aria-valuenow` 断言 |
| A8 | 抽屉变宽遮挡 details 列宽手柄时：**仅在重叠区**失效；移开或缩小抽屉后宿主手柄恢复可用 | 手工（宽窗 + 打开 details） |
| A9 | `prefers-reduced-motion: reduce` 下不出现新增动画 | 既有 `@media` 块已管 `.drawer` 的 `drawer-in`（`:570-575`），新增手柄动画要一并纳入 |

### 4.2 无布局回归（B 组，**最硬的一组**）

| # | 判据 | 方法 |
|---|---|---|
| B1 | **既有测试一字不改全绿**：`tests/overlay-placement.spec.ts`（纯几何，含 1600×900 / 800×700 / 640×800 及 obstacle 序列）、`tests/overlay-measurement.spec.tsx`（jsdom hook）、`tests/side-chat-surface.spec.tsx`、`tests/presentation.spec.tsx` | `cd $R/dsh-btw && node node_modules/vitest/vitest.mjs run`（或 `pnpm test`） |
| B2 | **默认态逐字段等价**：`width=null,height=null` 时，对同一组 `(frame, viewport, occupied, safeArea)` 输入，`computeOverlayPlacement` 输出与**改动前基线** `deepEqual`（含 `mode/left/top/right/bottom/width/height/maxHeight/degraded/reason` 全字段） | 新增对拍：在 `git stash` 前后的两份实现上跑同一批输入（≥ 既有 spec 的全部用例 + 边界矩阵），逐例比对；**必须同一实例/同一输入集** |
| B3 | `explicitSize:false` ⇒ 新字段被完全忽略（结构上不可达） | 类型 + 分支覆盖：显式模式的全部分支由 `explicitSize === true` 单点守卫 |
| B4 | 抽屉几何仍**只**由 `--side-chat-*` 驱动；`.drawer` 未被追加内联 width/height | 断言 `.drawer.getBoundingClientRect().width === parseFloat(getComputedStyle(placementRoot).getPropertyValue('--side-chat-width'))` |
| B5 | 宿主 frame 的 `gridTemplateColumns` 在拖拽全程**不变** | 探针在拖拽前后读取 `frame.style.gridTemplateColumns`，断言相等（证明**零 reflow**，§3.8） |
| B6 | 抽屉**不**覆盖 `.overlayLayer` 之外的宿主结构，且 `.placementRoot` 的 `pointer-events` 语义不变（非抽屉区可穿透） | 断言 `getComputedStyle(placementRoot).pointerEvents === 'none'`，且点击抽屉外空白仍能命中下层元素 |
| B7 | `narrow` 断点行为不变：`@media (max-width:720px)` + `bottom-sheet` 才出 `mobileScrim` | 断言遮罩 `display` 与视口宽度的关系 |
| B8 | 产物护栏：`scripts/smoke-build.mjs` 通过（断言产物不含 `dsh-side-chat` 等） | `node scripts/smoke-build.mjs` |
| B9 | 静态检查：`pnpm run lint` / `tsc -p tsconfig.client.json` 通过 | 同 `package.json` 的 `check` 脚本 |

### 4.3 持久化跨重启（C 组）

| # | 判据 | 方法 |
|---|---|---|
| C1 | 拖拽结束（pointerup）后 `localStorage.getItem('dsh.btw.drawerSize')` == `{"state":{"width":W,"height":H}}`（**确切形状以 `attachPersistence` 实现为准**，`$H/dsh-client-runtime/lib/client.js:5429-5448`） | 手工读 localStorage |
| C2 | **浏览器刷新（F5）** ⇒ 尺寸恢复 | 手工 |
| C3 | **宿主重启**（`dsh web` 进程重启）⇒ 尺寸恢复 | 手工（**注意**：不动 PID 301709 的前提下，本条需协调者安排独立重启窗口） |
| C4 | **插件重载**（HMR `rebuilt` 帧 / 换 `lib/client.js`）⇒ 尺寸恢复；判定依据 = 根作用域 store 的 `persistKey` 不经 `clearPersisted()`（`$H/dsh-client-runtime/lib/client.js:163-172` 的 `if (record.scope !== "session") continue`） | 手工 + 读 localStorage 键仍在 |
| C5 | 双击复位后 localStorage 回到 `{width:null,height:null}`；刷新后仍是自动 | 手工 |
| C6 | **视口变窄 ⇒ 视觉钳制，但 store 值不被改写**（INV-2）：把窗口缩小再拉回，尺寸回到原值 | 手工 + store 值断言 |
| C7 | `localStorage` 不可用（隐私模式/配额）⇒ **只丢持久化，功能与拖拽不损坏** | 手工（`Object.defineProperty(window,'localStorage',…)` 注入失败后拖拽仍工作） |
| C8 | **多标签不互同步**属已接受行为（`attachPersistence` 只在 attach 读一次）⇒ 写入 AUDIT 说明，**不得**当作缺陷 | 文档项 |

### 4.4 性能 / 无抖动（D 组，**针对 §3.5 硬风险**）

| # | 判据 | 方法 |
|---|---|---|
| D1 | **拖拽 1 秒内 `useOverlayPlacement` 的 effect 重跑次数 == 1**（仅挂载那次） | 在 effect 体首行打计数（临时探针，不入产品）；断言 `count === 1` |
| D2 | 同上期间 `new ResizeObserver` / `new MutationObserver` 构造次数 == 各 1 | 计数探针 |
| D3 | 拖拽期间 `setPlacement` 的调用次数 ≈ 帧数（**不是**帧数 × k），且不出现"每帧两次测量" | 计数 + 帧时间序列 |
| D4 | 目标行为**同窗对照**（BATCH-PLAN §四）：拖拽 2 秒窗口的 `rafP50 ≈ 16.7ms`、无 >50ms 帧显著增长；**必须自带页内阳性对照**（BATCH-PLAN §五·13：`Runtime.evaluate` 注入是 LongTask 盲区，须用页内 `setTimeout` 注入）；**必须写明引擎与版本**（§五·9） | 复用现有采集链（`capture6`）或 `exec-mask` 线的帧口径；**不得**用跨窗绝对数 |
| D5 | 拖拽期间 `drawer-in` 动画**不重放**（`getComputedStyle(drawer).animationName` 稳定，或视觉无闪回） | 手工 + 计算样式断言 |
| D6 | 交付说明中给出手柄命中面积的量化（8px 视口条 + 建议 ≥44px 的可视/隐式热区，触屏友好） | 手工 + CSS 断言 |

> **口径纪律（摘自 BATCH-PLAN §五，本验收必须遵守）**：① 并发按"主浏览器进程"计数（`--remote-debugging-pipe` 且不含 `--type=`）；② 每窗口起止各采一次并发快照，`>1` 即 invalid；③ `monitorEventLoopDelay` **不得在阻塞前 `reset()`**；④ Gecko 上 LongTask 恒 0（API 缺失）⇒ 本项优先在 **Blink** 上做；⑤ 帧判据用「wall-clock rAF 间隔 + 窗口播种」，且**保留块前那一帧**；⑥ 依赖 §五·19 的连带要求：任何以帧计数为立柱的结论**不得**用 LongTask 作立柱。

### 4.5 热面 / 冷面判定（**必写**）

| 交付物 | 生效方式 | 依据 |
|---|---|---|
| `$R/dsh-btw/src/client/**`（含新组件、CSS、locales、store 定义、`index.ts` 的客户端注册） | **热面**：重建 `lib/client.js` → 部署位拷贝 → **刷新浏览器** | `02-plugin-system.md:145` |
| `$R/dsh-btw/lib/client.js` 替换 | **热面**；`serveBundle` 每请求读盘 + `cache-control:no-cache`，`rev = sha1[:12]` 随内容变化；`dsh-client-hmr` 在活体 boot graph 内推送 `rebuilt` | 子档 C 实测：served rev `374dca63f9aa` == 部署位 sha1[:12]；`$H/dsh-client-modules/lib/index.js:147-161,480,483,325-334` |
| **CSS 改动** | **必须重建 bundle**（`.module.css` 经 `lightningcss` 内联为产物单行 `const css="…"`） | `$R/dsh-btw/tsdown.config.ts:24-64`；子档实测 `lib/client.js:935` |
| `$R/dsh-btw/src/index.ts`（宿主 schema，**仅 Phase 2**） | **冷面、需重启** | `02-plugin-system.md:147-148,152-153` |
| `package.json` 的 `dsh.client` 声明 | **不涉及**（不做任何 inject 变更） | `02-plugin-system.md:146` |
| 任何宿主/官方包（`dsh-client-ui-*`） | **不涉及**（§2.4 的 S-槽方案均已否决） | — |

### 4.6 交付与验收口径

- **路线选择（沿用既有惯例）**：本工作区既有两条路线——A「锚点补丁 deployed 文件」、B「改源码 + 重建 + `cp lib/`」。本改动**横跨 `.ts` / `.tsx` / `.css` 且全部固化进单文件 bundle**，故**必须走路线 B**（锚点补丁对这种规模的横跨改动不可维护）。
- 构建：`cd $R/dsh-btw && node node_modules/tsdown/dist/run.mjs`（`package.json` 的 `"build": "tsdown"`）。
- 部署后必须核：**部署位 `lib/client.js` 与仓库 sha256 一致** + **served URL 的 rev == 部署位 sha1[:12]** + **`curl` served bytes 的 sha256 == 部署位文件**。
- 回滚：把 `$D/profiles/node_modules/@local/dsh-btw/lib/` 整个目录回退到 R0 快照（**部署位是真实目录拷贝，非符号链接**，`02-plugin-system.md:162`），刷新浏览器即可；**无冷面**、无需重启。
- ⚠️ **部署位 `src/` 是旧快照**（子档实测与仓库 `diff -rq` 有 23 处差异、缺 5 个文件）⇒ **运行时装单位只有 `lib/`，`cp src` 无用**；**只对 `lib/` 做双向拷贝**。

---

## 5. ⑤ 冷面 / 需重启 的明确标注

> **本方案（Phase 1，通道 A）全程热面，不需要任何重启。**

**唯一会落到冷面的情形**：若要把尺寸存进 `$D/settings.yaml`（通道 B / Phase 2），必须改**插件的宿主代码** `$R/dsh-btw/src/index.ts` 的 `BTW_SETTINGS_SCHEMA`（`:24-51`）。**为什么必须是冷面**：

1. **宿主模块原因**：`src/index.ts` 的产物是 `lib/index.js`（`tsdown.config.ts:66-76`，`platform:'node'`）。宿主侧插件模块在 `dsh web` 进程里被 **ESM 缓存**，改动只在进程启动时读取一次——`02-plugin-system.md:152-153` 明写：「条目热载只**重新应用配置**，不重读模块（ESM 缓存）。因此『改宿主 lib 代码』永远落在冷面——这是本仓库无数『改了没生效』问题的同一根因」。
2. **装配层原因**：`~/.dsh/settings.yaml` 的**值**是热②（`:144`），但**schema** 是冷（`:148`「`module.exports` / settings schema 变化 = 冷（随插件部署重启一次）」）；本轮实测进一步确认：schema 是 loose ⇒ 值可穿透；但**声明键的类型错误会在注册期抛错** ⇒ schema 改动是无法靠"值级热载"绕开的。
3. **可选规避**：若只想"持久化"，**不碰 schema**（通道 A 或"写未声明键"），则**免重启**。

**对照组**：`§2.4` 的 S-槽1/2/3 三个"改槽位"方案**全部落在冷面**（改的是 `$H/dsh-client-ui-layout/lib/client.js` 等宿主官方包），且 S-槽1 还需与主题批（U-TP0/1/2 已改同一文件）协调**单一写入者**——这是**本方案不采用它们**的第二个理由。

---

## 6. 风险与回滚

| # | 风险 | 等级 | 触发条件 | 缓解 | 回滚 |
|---|---|---|---|---|---|
| R1 | **拖拽期 effect 抖动**（每帧重建 5 个观察者 + 3 个监听） | **高** | 把 `desiredWidth` 直接接 store 而不过 `sizeRef` | §3.5 Shape 1（尺寸走 ref + `remeasure`）；D1/D2 量化验收 | 尺寸不进 deps = 结构上不可能发生 |
| R2 | **"橡皮筋弹回" / 拖拽中途 mode 切换** | 中 | 保留 `REGULAR_CONTENT_PEEK` lane 过滤（`:235`）或让 `chooseRight` 返回 null | §3.4：显式模式去掉 peek 过滤 + 保证非 null；A4 单调性验收 | 把 `explicitSize` 退回 `false` |
| R3 | **`localStorage` 隐私模式/配额** → 持久化失效 | 低 | 浏览器设置 | 实现本身"**never break the store**"（`$H/dsh-client-runtime/lib/client.js:5434`）；C7 验收 | 无（降级为会话内有效） |
| R4 | **默认行为回归**（自动放置被显式分支污染） | 中 | `explicitSize` 单点守卫不严 | B1 既有 spec 全绿 + B2 全字段对拍 + B3 结构守卫 | 回退 `overlay-placement.ts` 单文件 |
| R5 | **遮挡 details 列宽手柄** | 低 | 抽屉宽到与宿主手柄重叠 | 文档化（A8）；必要时引入软上限 `MAX_WIDTH_SOFT = 960` | 调常量 |
| R6 | **`Escape` 关闭抽屉而非取消拖拽** | 低 | 手柄未 `stopPropagation` | §3.9 冲突 1（必须写进实现单元） | — |
| R7 | **窄屏/触屏手势冲突** | 低 | `max-width:720px` 下拖拽与滚动争抢 | §3.8 建议 720px 以下隐藏手柄（**待产品确认**） | 加媒体查询隐藏 |
| R8 | **部署失误**（改了部署位 `src/` 而非 `lib/`；或只改仓库未同步部署位） | 中 | 部署位 `src/` 是旧快照 | §4.6 三项核对（sha256 + rev + served bytes）；**只对 `lib/` 双向拷贝** | 目录级回退 |
| R9 | **本机图形栈放大副作用**（核显 + 4K@150%） | 低 | 每帧几何写入本身很轻，但本机帧预算紧张 | D4 用同窗对照 + 页内阳性对照，避免误判 | — |
| R10 | **多标签不互同步** | 低（已接受） | 两标签同时开抽屉 | 文档化；如需同步可加 `storage` 事件（**不在最小方案内**） | — |

**回滚总策略**：`$D/profiles/node_modules/@local/dsh-btw/lib/` **目录级快照回退** → 刷新浏览器。**无冷面、无重启、无宿主影响**；R0 快照必须在改动前从**当前 live** 取（不得复用历史备份，纪律见 BATCH-PLAN §三ter 的 pre-image 教训）。

---

## 7. 分阶段交付单元（可直接交给执行档）

> 纪律：**每单元含 目标文件 / 具体改动 / 验收**；**单一写入者**（Phase 1 全部落在 btw 客户端面 + `tests/`，无跨文件竞争）；**不得扩范围**；单元有歧义时**上报审计澄清**，不自行拍板。

### Phase 1（热面，本审计推荐的全部必需项）

| # | 单元 | 目标文件 | 改动内容 | 验收 |
|---|---|---|---|---|
| **U-BTW-R1** | 尺寸 store + 座位接线 | `src/client/index.ts`、新建 `src/client/drawer-size-store.ts`（或内联） | ① `defineStore({ init: () => ({width:null, height:null}), persist: 'dsh.btw.drawerSize', actions: {setWidth, setHeight, reset} })`；② 定义并导出 `MIN_WIDTH=360 / MIN_HEIGHT=240 / MAX_WIDTH_ABS=10000 / MAX_HEIGHT_ABS=10000 / PEEK_MIN=240 / RESIZE_STEP=16 / RESIZE_STEP_COARSE=64`；③ 把该 store 作为 `store:` 传给**既有** `shell.overlay` 注册（`index.ts:57-79`），**不改动**任何其它注册项 | store 句柄随注册创建；`localStorage['dsh.btw.drawerSize']` 在写入后存在；C1 |
| **U-BTW-R2** | 几何求解器显式尺寸模式 | `src/client/overlay-placement.ts` | ① `OverlayPlacementInput` 增 `desiredHeight?/minHeight?/explicitSize?`（全部可选）；② `chooseRight` 增显式分支（§3.4 的伪码：`PEEK_MIN` 统一上限、去 `REGULAR_CONTENT_PEEK` 过滤、保证非 null、`bottom = work.top + wantH`）；③ `chooseSheet` 的 `sheetHeight` 在显式模式换成 `clamp(desiredHeight, minHeight, H_avail)`；④ **非显式路径一字不改** | B2 全字段对拍逐例相等；新增 `tests/overlay-placement-explicit.spec.ts` 覆盖：宽/高单向、角、钳制、单调性（A4）、退化（`workW < minWidth`）回退 |
| **U-BTW-R3** | 放置 hook：尺寸走 ref + `remeasure` | `src/client/use-overlay-placement.ts` | ① `OverlayPlacementOptions` 增 `sizeRef?` / `minHeight?`；② `measure()` 内读 `sizeRef.current` 折算 `explicitSize`；③ **effect deps 移除尺寸项**，改 `[enabled, minWidth, minHeight, rootRef, safeMargin, selectorKey]`；④ 返回 `{...placement, remeasure: schedule}`；⑤ `samePlacement`（`:231-241`）需纳入 `width/height`（已含）**无需改** | D1/D2：拖拽 1s 内 effect 重跑 == 1、观察者构造 == 各 1；`tests/overlay-measurement.spec.tsx` 全绿 |
| **U-BTW-R4** | 手柄组件 + 样式 + 文案 | 新建 `src/client/SideChatResizeHandle.tsx`；`side-chat.module.css`；`locales.ts` | ① 手柄：`role="separator"` × 2（+ 角）+ `tabIndex:0` + `aria-orientation/controls/label/valuenow/min/max/valuetext` + `title`；② pointer：`button!==0` 过滤、`setPointerCapture`、`preventDefault`、rAF 节流、`pointerup` 补最终值 + 提交、`pointercancel` 回滚；③ 键盘：方向键 ±16/`Shift` ±64、`Home/End`、`Enter/Space` 复位、`Escape` 取消**且 `stopPropagation`**；④ `onDoubleClick` 复位；⑤ CSS：宽 8px 命中条 **放在 `.drawer` 内**（因 `overflow:hidden`）、`touch-action:none`、`user-select:none`、`:focus-visible` 可见描边（**不要照抄 `outline:none`**）、hover 显示把手；⑥ locales 加 `drawer.resizeWidth/resizeHeight/resizeCorner/resizeHint`（**zh + en 双份**，并同步 `NS` 的键联合类型 `locales.ts:4-19`） | A1–A3/A5–A7/A9；B4/B6；D5/D6 |
| **U-BTW-R5** | 抽屉接线（模式适配 + 复位） | `src/client/SideChatDrawer.tsx` | ① 收 `useStore`/`actions`（store 座位 props）；② `sizeRef = useRef({width, height})`；③ `useOverlayPlacement(rootRef, { enabled: visible, sizeRef, minHeight: MIN_HEIGHT })`；④ 按 `placement.mode` 决定远侧竖边（`right`→下边缘 / `bottom-sheet`→上边缘）；⑤ `<aside className={css.drawer}>` 加 `id="dsh-btw-drawer"`（供 `aria-controls`）；⑥ 渲染 `SideChatResizeHandle`（`max-width:720px` 下按 R7 决策隐藏或降级） | A2/A4/A6/A8；B5/B7；C2/C5/C6 |
| **U-BTW-R6** | 构建、部署、核对、回归 | —（命令） | ① `node node_modules/tsdown/dist/run.mjs`；② pre-image 快照（**从当前 live 取**）；③ `cp -a lib/ → $D/profiles/node_modules/@local/dsh-btw/lib/`；④ sha256 双向核对 + served rev/sha256 核对；⑤ 跑 `tests/` 全量 + `smoke-build.mjs` + lint/tsc | B1/B8/B9；§4.6 三项核对全过；出交付说明（含 D4 的同窗对照 + 引擎/版本 + 页内阳性对照） |

**Phase 1 明确不做**（防止范围蔓延）：多标签 `storage` 事件同步、拖拽吸附/网格、预设尺寸菜单、把尺寸暴露到设置页 UI、`MAX_WIDTH_SOFT` 之外的其它上限、任何宿主/槽位改动。

### Phase 2（**冷面，仅当产品明确要求"跨浏览器保持"才做**）

| # | 单元 | 目标文件 | 改动 | 生效 |
|---|---|---|---|---|
| **U-BTW-R7** | 把尺寸纳入 settings 命名空间 | `src/index.ts`（宿主，`:24-51` 增 `ui.width`/`ui.height` + 两处 `default`）、`src/client/btw-settings.ts`（`:18-33` / `:41-45` / **`:47-70` 逐字段重建必须加字段**） | 声明式 schema（**只增不改**；**不得**改已有键类型，否则注册期抛 `ValidationError`） | **冷面（需重启一次）** |
| **U-BTW-R8** | settings 通道与 localStorage 的双向选择 | `src/client/*` | 采用 §3.6 通道 B 的 `set('ui', {...整个 ui 对象, width, height})`（**不是** `set('ui.width', …)`）+ `status==='ready' && writable` 闸门 + 乐观镜像 + `.catch()` 回滚（照 `$D/.../dsh-wallpaper/lib/client.js:486-496`）；明确"哪个是权威源"（建议：**settings 为权威、localStorage 为快速缓存**，或**二选一**——**须产品裁决，不得自行拍板**） | 冷面（值热、schema 冷） |

---

## 8. INCONCLUSIVE / 待确认清单（诚实清单）

| # | 项 | 状态 | 说明 |
|---|---|---|---|
| I1 | `settingsScope` 在本会话的 `writable` **活体值** | **INCONCLUSIVE** | 未做活体探针。`dsh-client-ui-settings/lib/client.js:1166` 是 `connection.isLoopback ? 'host' : 'memory'`，本站 `127.0.0.1:3080` 满足 loopback ⇒ **推断为 `host`**，但**未实测**。**不影响 Phase 1**（不依赖该通道） |
| I2 | `localStorage` 中 `attachPersistence` 的**确切键/值形状** | **INCONCLUSIVE（形状）** | 已确证机制（`getItem/setItem(name, JSON.stringify(state))`，`$H/dsh-client-runtime/lib/client.js:5429-5448`），但**未实测**持久化后的 JSON 外壳（`{state:…}` vs 裸对象）⇒ C1 的断言文案须以实测为准 |
| I3 | 「下边缘=改高、左边缘=改宽」是否与用户直觉一致（**顶锚定 vs 底锚定**） | **待产品确认** | §3.4 已给出一行可切换的两条路线；**属产品决策，审计不拍板** |
| I4 | 是否要 `MAX_WIDTH_SOFT`（防"抽屉变整页"） | **待产品确认** | §3.7；默认建议不加 |
| I5 | `max-width:720px` 下是否隐藏手柄 | **待产品确认** | §3.8；建议隐藏 |
| I6 | `data-pane` 语义标记的写入者 | **INCONCLUSIVE** | 核心零写入者已确证；无法排除未安装/第三方插件注入（子档 A 自陈）。**与本方案无关**，单列为加固项 |
| I7 | 运行时验证（真实 DOM 上的拖拽/持久化） | **未做** | 本轮为**只读静态审计**：未 attach 浏览器、未抓真实 DOM、未跑任何探针。**全部几何结论来自源码与既有先例，非实测** ⇒ 执行档**必须**在真机复验 A/B/C/D 四组 |
| I8 | `useOverlayPlacement` 签名变更的**类型影响面** | **已核验（低风险）** | 调用点全树仅 `SideChatDrawer.tsx:45` 一处；`tests/overlay-measurement.spec.tsx:250` 也调用它 ⇒ 测试文件需同步（**该文件不是"既有 spec 一字不改"的对象**，B1 应把 `overlay-placement.spec.ts` 列为强约束，`overlay-measurement.spec.tsx` 允许**仅**补 `sizeRef` 缺省以保持行为等价——**此点需在执行档与审计确认后再定**） |
| I9 | 上游是否已有相关 issue/PR 可借鉴 | **未查** | 本轮未做网络检索（`CHANGELOG.md` 已确认 0.1.0–0.4.0 无 resize 条目） |

---

## 9. 证据索引

| 文件 | 内容 |
|---|---|
| `.workspace/lag-fix/program/w10-btw-resize/evidence/main-agent-excerpts.md` | 主 agent **亲自逐行核验**的 E1–E10 源码摘录（槽契约 / 宿主浮层 CSS / layout 先例 / store 座位与 localStorage / settings 写入通道 / schema loose 实跑 / 构建部署通道 / 现状几何 / 手柄位置 / 冷热边界） |
| `.workspace/lag-fix/program/w10-btw-resize/evidence/host-shell.md` | 子档 A（宿主/装配层）四节审计：槽形状（含 `[data-slot]` 与 `[data-shell-overlay]` 的属性归属、`display:contents` 锚点）、**trajectory 手柄先例的完整发现**、持久化通道、避让 vs 挤压、定位父级链、INCONCLUSIVE 清单 |
| `.workspace/lag-fix/program/w10-btw-resize/evidence/plugin-state.md` | 子档 B（插件自身侧）四节审计：手柄可达位置、**schema loose 的实跑确证**、客户端可写 settings 的完整链、**部署位/仓库 `lib/` 逐字节一致 + served rev 实证 + 构建命令 + CSS 内联机制**、btw 既有落地先例、现网 settings 段为空 |

**关键外部依据**（本轮复用的必读）：`.workspace/lag-fix/exec-audit/BATCH-PLAN.md` §五（测量协议 20 条）与 §四（验收通则）；`.workspace/lag-fix/incident2/VERDICT.md`（本机图形栈放大因子与仪器口径撤回清单）；`docs/architecture/02-plugin-system.md`（§3 settings 槽、§4 组合图装载、§5 冷热边界矩阵、§6 部署形态）。
