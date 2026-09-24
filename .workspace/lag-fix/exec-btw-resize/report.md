# report.md — btw 抽屉可拖拽调宽/调高（修订执行复核一体档）

> ## ✅ 收口状态（2026-09-22 17:20，协调者收窄通知后）
>
> | 项 | 状态 |
> |---|---|
> | **同档自复核** | **PASS**（Phase 1 真机 41/41 全 PASS；Phase 2 交付物准备完备、未落地） |
> | **可落地候选** | **`candidates/R2/lib/client.js`**，sha256 **`ca6cc0ec4f992f0edd89b0e3a6fbba73f24d0231d147ee22486d292770f67cec`**（361651 B）。⚠️ 必须用 R2：R1（`9aa82dc5…`）会回退 a11y 线 16:55 的线上改动（详见 §0bis） |
> | **落地前提** | 先**重取 pre-image**（`preimage/` 台账是 16:00 前的 live `28ccb37a…`，已过期 ⇒ drift 闸门会按设计拒绝）；`apply-BtwResize-v1.mjs --apply --confirm-apply` → `--verify`（期望 served **响应体** sha256 = `ca6cc0ec…`，`?rev=` 不是内容哈希）。**热面，无需重启** |
> | **已落盘的证据** | `raw/verify-20260922T091553Z.json`（**41/41 PASS**，跑在 R2 上）、`raw/b2-parity-*.json`（3456 例 0 差异）、`raw/phase2-schema-preflight.json`、`logs/*.log`、`shots/*.png`、`preimage/`（含 `SHA256SUMS.txt`/`META.txt`） |
> | **本档未做（明确 BLOCKED / 未做，**不塞未真跑断言**）** | ① **C3「宿主重启后尺寸仍保持」**：BLOCKED — 缺一次重启窗口（机制上成立：root 作用域持久键不被清理；**未实测**；C2 刷新保持已实测 ✓）。② **Phase 2 落地与重启**：按指令不做。③ **`data-pane` 语义标记加固**（审计 I6）：未做（不在单元范围）。④ **"手柄常显"专项截图**：放弃（收尾期探针锁被占 20+ min，按纪律不回收他人锁）——手柄存在/命中面积/a11y 由真机 DOM 量测 + out-of-tree DOM spec 支撑。⑤ 多标签同步：已接受不做（审计 C8/R10）。 |
> | **锁纪律** | 最后一次真机运行**持锁完成**（`censusAfter own=1 / foreign=0`）。收尾阶段那次**可选**的「手柄常显」截图运行**始终未取得锁**（被他线连续占用）⇒ 已放弃，**全程没有并发跑浏览器**；也**从未回收任何未确证死亡的锁**。 |
> | **纪律** | 全程未重启宿主、未发信号、未 pkill 任何浏览器；未写 `~/.dsh` 之外的部署位（deployed 写入交协调者） |


- **线**：`w10-btw-resize` / 执行档 `exec-btw-resize`
- **独占目录**：`.workspace/lag-fix/exec-btw-resize/`
- **上游契约**：`.workspace/lag-fix/program/w10-btw-resize/audit.md`（631 行；单元 U-BTW-R1…R8）
- **宿主**：PID 301709（本档**全程未重启、未发信号、未 pkill 任何浏览器**）
- **器械**：自有 `headless Chrome 153.0.8010.52`（Playwright `channel:'chrome'`）；候选字节经 `context.route`
  就地替换真实 bundle URL（**不写部署位**，与 exec-mask 线同一先例）
- **职责边界**：Phase 1 = 实现 + 构建 + 候选件 + 部署脚本 + 真机验证；**deployed 写入由协调者执行**。
  Phase 2 = **只准备候选与脚本，不落地**。

---

## 0. 裁决摘要

| 项 | 结果 |
|---|---|
| **单元完成度** | **U-BTW-R1…R8 全部落地为可交付物**（R1–R6 = Phase 1 热面代码；R7/R8 = Phase 2 候选 + 锚点补丁脚本，未落地） |
| **Phase 1 候选（应部署的就是它）** | `candidates/R2/lib/client.js` — **361651 B**，sha256 **`ca6cc0ec4f992f0edd89b0e3a6fbba73f24d0231d147ee22486d292770f67cec`** ⚠️ **必须用 R2，不要用 R1**（原因见 §0bis：R1 会回退 a11y 线的 U-A11Y3 线上改动） |
| Phase 1 候选 R1（**已被 R2 取代**，仅供参考） | `candidates/R1/lib/client.js` — 361191 B，sha256 `9aa82dc52c9529a3846d1a52cbd003f935635d8ba55b3147bef5cebd6a72ac63`；**真机 38/40 判据就是在这份字节上跑出来的**（R2 只多了 a11y 线的一处源码改动，我的代码路径逐字节未变） |
| **pre-image（部署位，从 live 取）** | sha256 `28ccb37a360e16e924e934665ed9c06094dbdbb73491d3b07938a4856df234d3`（335348 B）；台账 `preimage/SHA256SUMS.txt` + `META.txt` |
| **旧面未被动过** | 构建仓库 `lib/` **不改变 served bytes**（实测：构建前后 `curl` sha256 均 `28ccb37a…`）⇒ 部署位确实是独立目录拷贝，**本档没有顺手热部署** |
| **B1 既有 spec 一字不改** | `tests/overlay-placement.spec.ts` 与 `tests/overlay-measurement.spec.tsx` **与 HEAD 逐字节相同**（sha256 相等，见 §2.2）且全绿 |
| **B2 非显式路径等价** | 对拍 **3456 例 × 11 字段**，**mismatch = 0**；同一对拍证明显式分支**确实不同**（非空洞） |
| **B3 结构守卫** | 显式分支单点守卫 `input.explicitSize === true`；新增测试 `tests/overlay-placement-explicit.spec.ts` 12 例全绿 |
| **构建纪律** | 走**路线 B**（改源码 → 重建 → **只拷 `lib/`**）；CSS 内联进 bundle ⇒ 必须重建（已重建 3 次：初版 → `setSize` 单写 → 键盘步长修复；候选为最终字节） |
| **Phase 2 预检** | 真实 `@deepseek-ai/schemastery` 实跑：**审计建议的 `null` 哨兵在 schema 层不生效**（缺键时键被静默丢弃）⇒ 改用 `z.number().default(0)`（0 = 自动）。原始证据 `raw/phase2-schema-preflight.json` |
| **Phase 2 候选验证** | 独立影子树（`phase2/verify-tree/`）应用候选后：`tsc` 全通过 + **245 passed / 2 skipped**（与主树同数） |
| **真机验收** | 自有 headless Chrome 153 实跑 **41/41 项判据全 PASS**（跑在**最终并集候选 R2** 上，`ca6cc0ec…`）；用户验收 ①–⑧ 全部满足：**D1/D2 拖拽窗内观察者/监听器增量全为 0**、RunTask 通道以 120.185 ms 阳性对照自证可活、LoAF/帧通道同窗对照无 >50 ms 帧 |
| **out-of-tree DOM spec** | `phase1-shadow` 影子树 **8/8 PASS**（a11y 信封、pointerup 才提交、D1/D2 结构口径、A4 模式恒定、键盘全表、顶部锚定、Escape 不最小化、pointercancel 回滚）；并**当场抓出并修复**一个真实缺陷（键盘步长 ×16） |
| **同档自复核** | **PASS**（附 2 项执行档级判断与 1 项环境限制，见 §4/§5） |

### 0bis. 🔴 部署位冲突（**协调者落地前必读**）

| 时间 | 事件 | 证据 |
|---|---|---|
| 16:22:27 | 本档冻结 **R1** 候选（`9aa82dc5…`，361191 B），从当时的源码构建 | `candidates/R1/lib/client.js` |
| 16:55:55 | **a11y 线（`dsh-exec-a11y` / U-A11Y3）把部署位就地打补丁**（route A）：部署位变成 `d2bdd4c3…`（335993 B，=我的 pre-image + 一处插入 `/*<<dsh-exec-a11y:U-A11Y3:v1*/` + `window.__dshA11yBtwChord='U-A11Y3:v1'`）；**同一时刻他们把同一改动写进了源码 `src/client/index.ts`** | 部署位 mtime 16:55:55；`src/client/index.ts` mtime 16:55:55；部署位与 pre-image 逐字节 diff = 单点插入 |

**后果与处置**：

1. **R1 绝不能直接落**：R1 构建于 16:22，**早于**他们的源码改动 ⇒ 部署 R1 会把 a11y 线**线上已生效**的 U-A11Y3 改动**静默回退**（同一部署位文件的单一写入者冲突）。
2. 本档随即**用当前源码重新构建**得到 **R2 = 两边改动的并集**（实测：`dsh-btw-handle`×2 **且** `__dshA11yBtwChord`/`U-A11Y3` 都在），并重跑单元与 DOM 判据（**245 passed / 2 skipped**；DOM spec **8/8**）。
3. **pre-image 台账已过期**：`preimage/SHA256SUMS.txt` 记录的是 16:00 之前的 live（`28ccb37a…`），而现在 live 是 `d2bdd4c3…`。因此 `apply-BtwResize-v1.mjs` 的 **drift 闸门会拒绝写入**（这是设计行为，不是故障）——协调者若要落 R2，请**先重新取一次 pre-image**（或显式放行 drift），再 `--apply`。
4. 本档**没有**去改他们的源码/补丁，也没有覆盖部署位（按分工与单一写入者纪律）。

> 一句话：**部署 `candidates/R2/lib/client.js`（`ca6cc0ec…`）**，它同时含本档的拖拽尺寸与 a11y 线的 U-A11Y3。

### 0ter. 产物哈希账（2026-09-22 17:20 实测）与 a11y 冲突核验

**核验结论（逐条回答协调者的 4 点）**：

1. **我没有覆盖/回退 a11y 的标记块**：我的流程是"改 src → 重建 → 只对 `lib/` 双向拷贝"，从不整文件替换 `src/`。
   源码 `src/client/index.ts` 现 md5 **`50ab701e0a62b8ae`**（与你给的完全一致），标记块 `:93` / `:114` 两处俱在。
2. ⚠️ **"重建后核验产物里含标记两处"这个要求，重建无法满足**——`tsdown` 的 minifier **会剥掉注释**：
   源码 2 处 → 仓库 `lib/client.js` **0 处**；profile 位仍有 2 处，**只因为 a11y 用的是文本锚点补丁（route A）**。
   因此我改用**行为级不变量**核验（这才是"块真的进去了"的判据）：

   | 判据 | 源码 | **仓库 lib（我的 R2 重建）** | profile 位（当前 served） |
   |---|---|---|---|
   | `isEditableTarget`（a11y 新增的输入元素豁免） | 2 | **2 ✅** | 2 |
   | `__dshA11yBtwChord`（a11y 的可观测钩子） | 1 | **1 ✅** | 1 |
   | `dsh-exec-a11y:U-A11Y3:v1`（**注释**标记） | 2 | **0（被 minifier 剥掉）** | 2 |
   | `dsh-btw-handle`（本档手柄） | — | **2 ✅** | **0 ❌** |
   | `dsh.btw.drawerSize`（本档 store 键） | 1 | **1 ✅** | 0 |

   ⇒ **a11y 的行为改动确实随重建进了产物**；只有注释标记没有。
   ⚠️ **提醒**：任何"grep 服务产物里有没有 `dsh-exec-a11y:U-A11Y3:v1` 注释"来判定产物身份的工具（例如别的线决定要不要再打补丁），
   **在我这份重建产物上线后会得到 0**，那是 minifier 的正常行为、不是改动丢失——请改用上面两条行为级判据。
3. **部署必须落到 profile 挂载位**：`served bytes == ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js`（实测 md5/sha256 完全一致），
   我的 `apply-BtwResize-v1.mjs` 的 `DEPLOY_LIB` 就是这条 profile 路径，并且 `--verify` 比的是**响应体 sha256**（不是 `?rev=`）。
4. **落盘前已记录当前 md5 / pre-image**（见下表与 `preimage-landing/`、`preimage-profile-1655/`）：
   - 你给的"仓库 lib = `d496eb83037514eb`" **= 我的 R1**（16:22 构建）⇒ 说明你那次测量发生在 **17:15 重建之前**，现已对账清楚；
   - 现在仓库 lib = **R2 = `bdc5c240566ecd50`**（含 a11y 行为 + 本档拖拽尺寸）。

| 产物 | md5 | sha256（前 16） | bytes | mtime | 说明 |
|---|---|---|---|---|---|
| 源码 `src/client/index.ts` | **`50ab701e0a62b8ae`** | `92c6e64754739522` | 5272 | 16:55:55 | 含 a11y 块（2 标记）+ 本档 store 座位 |
| 仓库 `dsh-btw/lib/client.js` | **`bdc5c240566ecd50`** | `ca6cc0ec4f992f0e` | 361651 | **17:15:06** | **本档 R2**（resize ✅ + a11y 行为 ✅） |
| 候选 `candidates/R2/lib/client.js` | `bdc5c240566ecd50` | `ca6cc0ec4f992f0e` | 361651 | 17:15:06 | 与仓库 lib 逐字节相同 |
| 候选 `candidates/R1/lib/client.js`（作废） | `d496eb83037514eb` | `9aa82dc52c9529a3` | 361191 | 16:22:27 | 早于 a11y 改动，**禁止部署** |
| **profile 挂载位（= served）** | **`6b3245b994574bde`** | `d2bdd4c3cc4ca256` | 335993 | **16:55:55** | a11y ✅ / 本档 ❌（用户目前看不到拖拽尺寸） |
| R0 pre-image（最初 live） | — | `28ccb37a360e16e9` | 335348 | — | `preimage/` |
| 当前挂载位快照（**回滚目标**） | `6b3245b994574bde` | `d2bdd4c3cc4ca256` | 335993 | 17:19:28 | `preimage-profile-1655/` = `preimage-landing/` |
| 原始 JSON 账 | — | — | — | | `raw/artifact-ledger.json` |

**给协调者的落地命令（已把 drift 闸门重新基准化，我未写 profile 位）**：

```bash
node .../exec-btw-resize/scripts/apply-BtwResize-v1.mjs              # dry-run：drift: none，计划只含 client.js
node .../exec-btw-resize/scripts/apply-BtwResize-v1.mjs --apply --confirm-apply
node .../exec-btw-resize/scripts/apply-BtwResize-v1.mjs --verify     # 期望 served 响应体 sha256 = ca6cc0ec…
```
`--resnapshot`（我已在本档目录内跑过一次，只写我的工作区、**不触碰 profile**）用于把他线后续写入重新基准化。
**若 `exec-btwclose` 在我这份之后还要改同一份产物 ⇒ 请按你的规则串行化**：我**不**再写 profile 位，也不与它并发。


---

## 1. 逐单元交付（对照审计 §7）

### U-BTW-R1 尺寸 store + 座位接线 ✅

| 项 | 落点 |
|---|---|
| 常量与类型 | **新建** `src/client/drawer-size.ts`（纯模块，**不引 runtime**，避免测试被拖进宿主 bundle） |
| 常量 | `MIN_WIDTH=360`、`MIN_HEIGHT=240`、`MAX_WIDTH_SOFT=960`、`MAX_WIDTH_ABS=10000`、`MAX_HEIGHT_ABS=10000`、`RESIZE_STEP=16`、`RESIZE_STEP_COARSE=64`、`HANDLE_MIN_VIEWPORT=720` |
| store | **新建** `src/client/drawer-size-store.ts`：`defineStore({ init: () => ({width:null,height:null}), persist: 'dsh.btw.drawerSize', actions: { setWidth, setHeight, setSize, reset } })` |
| 座位 | `src/client/index.ts`：`const drawerSize = createDrawerSizeStore()`（**apply 世界的共享句柄**，不导出模块级句柄）→ 传给**既有** `shell.overlay` 注册的 `store:` 字段；其它注册项一字未改 |
| 额外 action | `setSize(width, height)`：**角手柄单手势 = 单次 store 更新 = 单次 localStorage 写**（审计 A3 的量化要求；`setWidth`+`setHeight` 会产生 2 次订阅回调 ⇒ 2 次写） |

**依据**：`StoreSpec.persist` 是框架机制（`dsh-client-runtime/lib/client.js:5472-5478`）；`attachPersistence` 落盘形状为**裸 `JSON.stringify(state)`**（无 `{state:…}` 外壳）——审计 §8 I2 的 INCONCLUSIVE 项在本档由**真机实测**回答（见 §2.3）。

### U-BTW-R2 几何求解器显式尺寸模式 ✅

`src/client/overlay-placement.ts`：

- `OverlayPlacementInput` 增可选 `desiredHeight?` / `minHeight?` / `maxWidth?` / `explicitSize?`（**全部可选**）；
- 原 `chooseRight` 函数体**整体改名为 `chooseRightAutomatic`**（逐字未改），新 `chooseRight` 只做**单点分派**：
  `explicitSize === true ? chooseRightExplicit(...) : chooseRightAutomatic(...)` ⇒ **B3 结构守卫**；
- `chooseRightExplicit`：**最宽 lane** + 右锚定 + **顶锚定**，`bottom = work.top + wantHeight`（= 用户决定 ①：改高时顶部不动）；
  永不返回 `null`（只有"所有 lane 都托不住抽屉"时才交给 sheet 家族，避免拖拽中途模式跳变）；
- **模式标签与尺寸无关**：`explicitVerdict()` 只用 lane 宽度 + 固定基线 `DEFAULT_DESIRED_WIDTH=448` 判定
  `right`/`compact-right`，**不看拖拽值** ⇒ `data-placement-mode` 在整个手势内恒定（审计 A4 的"无橡皮筋"）；
- `computeOverlaySizeBounds()`（新增、纯投影）：`maxWidth = max(minWidth, min(hardMax=workWidth−240, softMax=960))`
  —— **用户决定 ②**：软上限 960 与"主区至少留 240px"取较小者；
- `chooseSheet` 显式化：`sheetHeight(work, input)` 与 `sheetWidth(laneWidth, input, bounds)`，**非显式分支逐字保留**；
- 退化（`workWidth < minWidth || workHeight < minHeight`）⇒ `computeOverlayPlacement` 顶部**整体退回自动路径**（`explicitSize:false`），保证极端窄窗不崩。

### U-BTW-R3 放置 hook：尺寸走 ref + `remeasure` ✅

`src/client/use-overlay-placement.ts`：

- `OverlayPlacementOptions` 增 `sizeRef?` / `minHeight?` / `maxWidth?`；返回类型新增 `OverlayPlacementResult = OverlayPlacement & { bounds, remeasure }`；
- **effect deps 移除尺寸项**：`[enabled, minWidth, minHeight, maxWidth, rootRef, safeMargin, selectorKey]`；
  `desiredWidth` 与 `sizeRef` 走 ref（`desiredWidthRef` / `sizeRefLive`）在 `measure()` 内即时读取；
- `remeasure` = 稳定 `useCallback` → 内部转调 effect 内注册的 `schedule`（已 rAF 节流）；
- `bounds` 由 `collectOverlayGeometry(...).bounds()` 在同一测量中产出，**只在工作区尺寸变化时更新**（拖拽期不变 ⇒ 不额外渲染）；
- `sizeRef` 缺省（`undefined`）时行为与改造前**逐字段相同**（既有 `overlay-measurement.spec.tsx` 未改仍全绿）。

### U-BTW-R4 手柄组件 + 样式 + 文案 ✅

**新建** `src/client/SideChatResizeHandle.tsx`（一个组件三种 `kind`）：

| 需求 | 实现 |
|---|---|
| 左边缘 = 宽 | `.resizeWidth`（`top:0;bottom:0;left:0;width:8px`，`.drawer` **内部**——`.drawer` 是 `overflow:hidden`，trajectory 的 `left:-4px` 外侧写法在这里无效） |
| 远侧竖边 = 高 | `right`/`compact-right` ⇒ 下边缘；`bottom-sheet` ⇒ 上边缘（由 `placement.mode` 驱动，`.resizeHeightTop/Bottom`） |
| 左下角 | `.resizeCorner`：`left/bottom:6px`（**内缩 6px 避开 16px 圆角**），同手势写两个轴 |
| a11y | `role="separator"` ×2 + `tabIndex=0` + `aria-orientation`(vertical/horizontal) + `aria-controls="dsh-btw-drawer"` + `aria-label` + `aria-valuenow/min/max/valuetext` + `title`；角手柄 `aria-hidden` + `tabIndex=-1`（两轴均可由键盘到达，故不重复暴露） |
| pointer | `button!==0` 过滤 → `setPointerCapture` → `preventDefault` → rAF 节流写 `sizeRef` + `remeasure()` → `pointerup` **补最终值后一次性提交** → `pointercancel` 回滚到拖拽前 |
| 键盘 | `ArrowLeft/Right`=宽 ±16、`ArrowUp/Down`=高 ±16（符号随锚定边）、`Shift` ⇒ ±64、`Home/End`=极值、`Enter`/`Space`=复位、**`Escape` 取消拖拽** |
| `Escape` 不撞最小化 | 拖拽期间注册 **capture 阶段**的 `window` keydown：`preventDefault + stopPropagation` ⇒ 整条派发被截断，`SideChatDrawer` 的**冒泡阶段** window Escape→最小化**收不到**该事件 |
| 双击复位 | 三个手柄都绑 `onDoubleClick`（+ Enter/Space 键盘等价路径） |
| CSS 纪律 | `touch-action:none`、`user-select:none`、`pointer-events` 继承 `.drawer` 的 auto、`:focus-visible` **可见描边**（`outline:2px solid var(--dsw-alias-state-business-primary)`，**不照抄** 上游的 `outline:none` 反模式）、`:hover`/`[data-dragging]` 才显示把手、`prefers-reduced-motion: reduce` 下取消 transition |
| 文案 | `locales.ts` 增 `drawer.resizeWidth/resizeHeight/resizeCorner/resizeHint`（**zh + en 双份** + 键联合类型） |

### U-BTW-R5 抽屉接线 ✅

`src/client/SideChatDrawer.tsx`：

- 收 `useStore`/`actions`（`PropsStore<DrawerSizeStoreHandle>` 座位 props；**类型上可选**，以便 jsdom spec 直接以手搓 props 渲染时降级为"自动 + 无持久化"并 `console.warn`，**不修改任何既有 spec**）；
- `sizeRef = useRef<DrawerSize>({width,height})`；`useOverlayPlacement(rootRef, { enabled: visible, sizeRef, minHeight: MIN_HEIGHT, maxWidth: MAX_WIDTH_SOFT })`；
- store → ref 的同步走**独立 effect**（`[storedWidth, storedHeight, remeasure]`），**不会**在拖拽中途被 re-render 覆写（拖拽期 store 不变 ⇒ effect 不跑）；
- `<aside id="dsh-btw-drawer">` + 三个手柄；远侧竖边按 `placement.mode` 选边；
- **用户决定 ③**：`<720px` 由 CSS 隐藏手柄（`@media (max-width:719.98px)`），并在 hook 侧同步**不套用**显式尺寸 ⇒ 窄窗完全保持今天的 `bottom-sheet + mobileScrim` 语义（store 值**不被覆写**，窗口拉回即恢复）。

### U-BTW-R6 构建 / 部署 / 核对 / 回归 ⏳（脚本就绪，落地由协调者执行）

- 构建：`node node_modules/tsdown/dist/run.mjs` ✅ 已跑（`lib/client.js` 361167 B）；
- 部署脚本：`scripts/apply-BtwResize-v1.mjs`（dry-run / `--apply --confirm-apply` / `--verify` / `--rollback`）——
  含 **pre-image drift 闸门**、**sha256 双向核对**、**served bytes 核对**（并显式提示 `?rev=` 不是内容哈希）；
- 本档 dry-run/`--verify` 已跑：明确显示部署位仍是 pre-image（`28ccb37a…`）、候选为 `9aa82dc5…`。

### U-BTW-R7 / R8 Phase 2（冷面，只准备） ✅（候选 + 脚本，未落地）

见 §5。

---

## 2. 真跑证据

### 2.1 目录

| 证据 | 位置 |
|---|---|
| 单元/静态 | `logs/phase1-vitest.log`、`logs/phase1-tsc.log`、`logs/phase1-lint.log`、`logs/phase1-smoke.log`、`logs/phase1-unchanged-specs.log` |
| B2 对拍原始 JSON | `raw/b2-parity-*.json` |
| DOM/键盘/观察者纪律（out-of-tree 影子树 spec） | `dom-check/drawer-resize-dom.part.tsx` → `phase1-shadow/tests/drawer-resize-dom.spec.tsx`（**8/8 PASS**） |
| schema 预检原始 JSON | `raw/phase2-schema-preflight.json` |
| 真机验证原始 JSON / 日志 / 截图 | `raw/verify-*.json`、`logs/verify.log`、`shots/*.png` |
| 部署位 pre-image | `preimage/`（`SHA256SUMS.txt`、`META.txt`、逐文件副本） |

### 2.2 静态与单元（全部在最终代码状态上重跑）

```
tests/overlay-placement.spec.ts        HEAD sha256 d3afac0bd449327e9b3bb6b857253c9030ab7faf96e2cf928fa74f2c5e6f3343
                                       live sha256 d3afac0bd449327e9b3bb6b857253c9030ab7faf96e2cf928fa74f2c5e6f3343   ← 逐字节相同
tests/overlay-measurement.spec.tsx     HEAD == live (6d9d171a4404…)                                      ← 也未改（强于要求）
vitest run                             Test Files 25 passed (25) / Tests 245 passed | 2 skipped (247)
tsc (client/host/tests)                ALL-TSC-OK
oxlint                                 0 warnings, 0 errors
node scripts/smoke-build.mjs           smoke ok: @local/dsh-btw build artifacts consistent
b2-parity (3456 例 × 11 字段)          mismatches = 0 ; explicitDiffers = true
```

### 2.3 DOM / 键盘 / 观察者纪律（影子树 spec，8/8 PASS）

不依赖浏览器与探针锁：影子树 `phase1-shadow/`（产品包的逐字节副本 + 本档新增 spec）中，
用真实 React 渲染 `SideChatDrawer` 并挂一个**假座位**（`useStore`/`actions`），逐条验证：

| 用例 | 结果 |
|---|---|
| 两个 `role="separator"`（vertical/horizontal）+ `aria-controls="dsh-btw-drawer"` + `aria-valuemin/max/now` + 角手柄 `aria-hidden`/`tabIndex=-1` | ✅ |
| 拖拽期只写 `sizeRef`、**`pointerup` 才提交且只提交一次**（`setSize(648, null)`，中途 0 次） | ✅ |
| **60 次 pointermove 的长拖拽后：`ResizeObserver`/`MutationObserver` 实例数不变、`disconnect` 调用数为 0、`window` 上零新增 `resize`/`scroll` 监听**（= D1/D2 的结构口径） | ✅ |
| 全手势 `data-placement-mode` 恒定（A4 无橡皮筋） | ✅ |
| 键盘：`ArrowLeft` 448→464、`Shift+ArrowLeft`→528、`ArrowRight`→512、`End`→960、`Home`→360、`Enter`→复位 448、双击→复位 | ✅ |
| 高度手柄：下边拖上 100px ⇒ 高度 876→776 且 **`--side-chat-top` 不变**（用户决定 ①） | ✅ |
| 拖拽中 Escape：**取消（尺寸回滚）且抽屉的 window Escape→最小化监听器一次都没被调用**；无拖拽时 Escape 仍照常触发该监听器 | ✅ |
| `pointercancel` ⇒ 回滚且不提交 | ✅ |

> ⚠️ 这一组**不是**走过场：它当场抓到一个真实缺陷（见 §3 第 3 项）。

### 2.4 真机（A/C/D 组）

原始 JSON：`raw/verify-20260922T091553Z.json`　引擎：`153.0.8010.52`　UA/DPR 见 JSON。

**41/41 项通过**

| 判据 | 结果 | 证据 |
|---|---|---|
| `0-drawer-open` | **PASS** | btw drawer mounted |
| `0-candidate-live` | **PASS** | 1 bundle interception(s), sha256=ca6cc0ec4f99 |
| `R1-store-seat-present` | **PASS** | console warnings: [] |
| `B-parity-auto-default` | **PASS** | auto drawer = 448x876 @y=12 (expected 448x876 @y=12) |
| `A6-a11y-HandleMeta` | **PASS** | [{"k":"width","role":"separator","o":"vertical","now":"448","min":"360","max":"960","ti":0,"disp":"block"},{"k":"height","role":"separator","o":"horizontal","now":"876","min":"240","max":"876","ti":0,"disp":"block"},{"k":"corner","role":null,"o":null,"now":null,"min":null,"max":null,"ti":-1,"disp":"block"}] |
| `A1-width-follows-pointer` | **PASS** | width=648 (expected ~648 = 448+200) |
| `A1-right-anchored` | **PASS** | right edge 1588 vs auto 1588 |
| `C1-persisted-after-pointerup` | **PASS** | localStorage dsh.btw.drawerSize = {"width":648,"height":null} |
| `A3-corner-both-axes` | **PASS** | corner drag (-60,-40): 648x876 -> 708x836 |
| `A3-single-write-per-gesture` | **PASS** | localStorage writes to dsh.btw.drawerSize during the corner gesture = 1 (all dsh.btw.* keys: ["dsh.btw.drawerSize"]) |
| `D1-effect-rerun-0` | **PASS** | observers/effect re-runs during 1 drag ≈ 1736ms: {"rs":0,"mo":0,"moObserve":0,"resize":0,"scroll":0,"resizeWindow":0,"scrollWindow":0} (all zero => the layout effect did not re-run; the mount-time counts were rs=3 mo=5) |
| `C2-persist-across-refresh` | **PASS** | before F5: width=480 stored={"width":480,"height":null} → after F5: width=480 stored={"width":480,"height":null} |
| `A2-height-follows-pointer` | **PASS** | height 876 -> 728 (expected ~726) |
| `②-top-anchored-on-height-change` | **PASS** | top 12 -> 12 (must be equal) |
| `C1b-height-persisted` | **PASS** | stored={"width":480,"height":726} |
| `③-soft-cap-960` | **PASS** | width after dragging far left = 960 (soft cap 960) |
| `③-hard-cap-respected` | **PASS** | width 960 <= frameWidth(1600) - 240 |
| `A5-min-width-360` | **PASS** | width after dragging far right = 360 (MIN_WIDTH 360) |
| `A5-aria-envelope` | **PASS** | aria-valuemin=360 aria-valuemax=960 |
| `⑤a-tab-reaches-width-handle` | **PASS** | Tab from element #17 (of 26) focused handle="width" |
| `⑤b-enter-resets-to-auto` | **PASS** | after Enter: width=448 stored={"width":null,"height":null} |
| `⑤c-arrow-step-16` | **PASS** | ArrowLeft: 448 -> 464 (step 16) |
| `⑤d-shift-step-64` | **PASS** | Shift+ArrowLeft: 464 -> 528 (step 64) |
| `⑤e-end-max` | **PASS** | End -> 960 (== soft cap) |
| `⑤f-home-min` | **PASS** | Home -> 360 (== MIN_WIDTH) |
| `⑤g-height-arrow` | **PASS** | height reset=876 ArrowUp=860 ArrowUp=844 ArrowDown x2=876 (clamped at the work height) |
| `⑤h-escape-cancels-not-minimizes` | **PASS** | mid-drag width=648 (grew), Escape -> 448 (rolled back to 448); drawer still mounted=true |
| `⑤i-escape-does-not-commit` | **PASS** | stored before={"width":null,"height":null} after={"width":null,"height":null} |
| `B5-zero-reflow` | **PASS** | frame gridTemplateColumns "280px minmax(0px, 1fr) 0px" -> "280px minmax(0px, 1fr) 0px" |
| `B6-pointer-events` | **PASS** | placementRoot=none overlay=none (drawer区外仍可穿透) |
| `④-handles-hidden-under-720` | **PASS** | 700px viewport: handle display = ["none","none","none"] |
| `④-narrow-restores-auto` | **PASS** | narrow width=364 (auto) while stored preference stays {"width":568,"height":null} |
| `C6-inv2-viewport-clamp` | **PASS** | back at 1600px: width=568 (was 568), store untouched={"width":568,"height":null} |
| `D1b-effect-rerun-0-perf-window` | **PASS** | {"rs":0,"mo":0,"moObserve":0,"resize":0,"scroll":0,"resizeWindow":0,"scrollWindow":0} |
| `⑧-positive-control` | **PASS** | planted in-page setTimeout 120ms busy-wait: frameMax=121ms gt50=1 loaf=1 loafMax=121ms longtask=1 \| RunTask max=120.185ms count=603 |
| `⑧-negative-control` | **PASS** | idle window 91 frames: gt50=0 loaf=0 runTaskGt50=0 |
| `D4-drag-frames` | **PASS** | drag window 4245ms: frames=166 max=17.30ms gt50=0 \| idle control frames=91 max=27.00ms gt50=0 (headless Chrome has no vsync: p50 is NOT a 16.7ms budget, only the relative comparison is claimed) |
| `D4-drag-runTask` | **PASS** | RunTask in the drag window: count=6965 max=4ms gt50=0 \| idle: count=1430 max=3.664ms |
| `⑧b-runTask-channel-live` | **PASS** | RunTask through the planted 120ms in-page block = 120.185ms (count=603) — proves the category set (含 disabled-by-default-devtools.timeline) is live |
| `D5-no-animation-replay` | **PASS** | drawer node identity kept=true, animationName SalQ5q_drawer-in -> SalQ5q_drawer-in, running animations after the drag=[] (before: []) |
| `A6-double-click-reset` | **PASS** | after dblclick: width=448 stored={"width":null,"height":null} |

### D3/D4 帧与长任务（同窗对照 + 页内阳性对照）

```json

{
 "idle": {
  "label": "idle",
  "wallMs": 3003,
  "frames": {
   "frames": 91,
   "intervals": 90,
   "first": 13774.79999999702,
   "last": 15267.89999999851,
   "wallMs": 1493.1000000014901,
   "p50": 16.699999999254942,
   "p95": 16.800000000745058,
   "p99": 27,
   "max": 27,
   "gt50": 0,
   "gt100": 0,
   "intervalsRaw": [
    9.800000000745058,
    16.699999999254942,
    16.600000001490116,
    16.600000001490116,
    16.699999999254942,
    16.699999999254942,
    16.699999999254942,
    16.699999999254942,
    16.600000001490116,
    16.600000001490116,
    16.699999999254942,
    16.800000000745058,
    16.5,
    16.699999999254942,
    16.699999999254942,
    16.699999999254942,
    16.600000001490116,
    27,
    6.399999998509884,
    16.699999999254942,
    16.700000002980232,
    16.599999997764826,
    16.699999999254942,
    16.700000002980232,
    16.799999997019768,
    16.5,
    19.800000000745058,
    13.5,
    16.600000001490116,
    16.699999999254942,
    16.699999999254942,
    16.699999999254942,
    16.700000002980232,
    16.599999997764826,
    16.800000000745058,
    16.399999998509884,
    16.700000002980232,
    16.699999999254942,
    16.599999997764826,
    16.800000000745058,
    16.600000001490116,
    16.699999999254942,
    16.699999999254942,
    16.699999999254942,
    16.600000001490116,
    16.699999999254942,
    16.699999999254942,
    16.600000001490116,
    16.600000001490116,
    19.199999999254942,
    16.199999999254942,
    15.300000000745058,
    16.300000000745058,
    16.399999998509884,
    16.800000000745058,
    16.599999997764826,
    16.600000001490116,
    16.699999999254942,
    16.699999999254942,
    16.600000001490116,
    16.699999999254942,
    16.600000001490116,
    16.699999999254942,
    16.600000001490116,
    16.699999999254942,
    16.599999997764826,
    16.800000000745058,
    16.600000001490116,
    16.699999999254942,
    16.600000001490116,
    16.699999999254942,
    16.699999999254942,
    16.699999999254942,
    16.600000001490116,
    16.699999999254942,
    16.600000001490116,
    17.299999997019768,
    16.100000001490116,
    16.600000001490116,
    16.699999999254942,
    16.800000000745058,
    16.5,
    16.699999999254942,
    16.699999999254942,
    16.699999999254942,
    16.600000001490116,
    16.699999999254942,
    16.699999999254942,
    16.699999999254942,
    16.600000001490116
   ]
  },
  "lt": {
   "longtask": 0,
   "loaf": 0,
   "loafMax": 0
  },
  "trace": {
   "count": 1430,
   "maxMs": 3.664,
   "gt50": 0
  }
 },
 "drag": {
  "label": "drag",
  "wallM

```

### D1/D2 拖拽窗口内观察者/监听器增量

```json

{
 "rs": 0,
 "mo": 0,
 "moObserve": 0,
 "resize": 0,
 "scroll": 0,
 "resizeWindow": 0,
 "scrollWindow": 0
}

```

### A3 角手柄（单手势单写）

```json

{
 "before": {
  "x": 940,
  "y": 12,
  "w": 648,
  "h": 876
 },
 "after": {
  "x": 880,
  "y": 12,
  "w": 708,
  "h": 836
 },
 "writes": {
  "btw": 1,
  "keys": [
   "dsh.btw.drawerSize"
  ]
 }
}

```

### ⑤ 键盘

```json

{
 "reset": {
  "rect": {
   "x": 1140,
   "y": 12,
   "w": 448,
   "h": 876
  },
  "stored": "{\"width\":null,\"height\":null}"
 },
 "arrowLeft": {
  "x": 1124,
  "y": 12,
  "w": 464,
  "h": 876
 },
 "shiftLeft": {
  "x": 1060,
  "y": 12,
  "w": 528,
  "h": 876
 },
 "end": {
  "x": 628,
  "y": 12,
  "w": 960,
  "h": 876
 },
 "home": {
  "x": 1228,
  "y": 12,
  "w": 360,
  "h": 876
 }
}

```

### ⑤ 键盘（高度）

```json

{
 "reset": {
  "x": 1140,
  "y": 12,
  "w": 448,
  "h": 876
 },
 "up": {
  "x": 1140,
  "y": 12,
  "w": 448,
  "h": 860
 },
 "up2": {
  "x": 1140,
  "y": 12,
  "w": 448,
  "h": 844
 },
 "down": {
  "x": 1140,
  "y": 12,
  "w": 448,
  "h": 876
 }
}

```

### ⑤ Escape 取消（不最小化）

```json

{
 "before": {
  "rect": {
   "x": 1140,
   "y": 12,
   "w": 448,
   "h": 876
  },
  "stored": "{\"width\":null,\"height\":null}"
 },
 "mid": {
  "rect": {
   "x": 940,
   "y": 12,
   "w": 648,
   "h": 876
  },
  "stored": "{\"width\":null,\"height\":null}"
 },
 "after": {
  "rect": {
   "x": 1140,
   "y": 12,
   "w": 448,
   "h": 876
  },
  "stored": "{\"width\":null,\"height\":null}"
 }
}

```

### ④ <720px 隐藏手柄 + 自动放置

```json

{
 "handles": [
  {
   "kind": "width",
   "display": "none",
   "rect": {
    "x": 0,
    "y": 0,
    "w": 0,
    "h": 0
   },
   "now": "364",
   "min": "360",
   "max": "436",
   "role": "separator",
   "orientation": "vertical",
   "controls": "dsh-btw-drawer",
   "tabIndex": 0
  },
  {
   "kind": "height",
   "display": "none",
   "rect": {
    "x": 0,
    "y": 0,
    "w": 0,
    "h": 0
   },
   "now": "876",
   "min": "240",
   "max": "876",
   "role": "separator",
   "orientation": "horizontal",
   "controls": "dsh-btw-drawer",
   "tabIndex": 0
  },
  {
   "kind": "corner",
   "display": "none",
   "rect": {
    "x": 0,
    "y": 0,
    "w": 0,
    "h": 0
   },
   "now": null,
   "min": null,
   "max": null,
   "role": null,
   "orientation": null,
   "controls": null,
   "tabIndex": -1
  }
 ],
 "rect": {
  "x": 324,
  "y": 12,
  "w": 364,
  "h": 876
 },
 "mode": "compact-right",
 "stored": "{\"width\":568,\"height\":null}"
}

```

### ③ 软/硬上限

```json

{
 "rect": {
  "x": 628,
  "y": 12,
  "w": 960,
  "h": 728
 },
 "stored": "{\"width\":960,\"height\":726}",
 "frameWidth": 1600
}

```

### ③ 最小宽度

```json

{
 "rect": {
  "x": 1228,
  "y": 12,
  "w": 360,
  "h": 728
 },
 "stored": "{\"width\":360,\"height\":726}"
}

```

### 自动放置基线（与改造前对拍）

```json

{
 "rect": {
  "x": 1140,
  "y": 12,
  "w": 448,
  "h": 876
 },
 "mode": "right",
 "handles": [
  {
   "kind": "width",
   "display": "block",
   "rect": {
    "x": 1141,
    "y": 13,
    "w": 8,
    "h": 874
   },
   "now": "448",
   "min": "360",
   "max": "960",
   "role": "separator",
   "orientation": "vertical",
   "controls": "dsh-btw-drawer",
   "tabIndex": 0
  },
  {
   "kind": "height",
   "display": "block",
   "rect": {
    "x": 1141,
    "y": 879,
    "w": 446,
    "h": 8
   },
   "now": "876",
   "min": "240",
   "max": "876",
   "role": "separator",
   "orientation": "horizontal",
   "controls": "dsh-btw-drawer",
   "tabIndex": 0
  },
  {
   "kind": "corner",
   "display": "block",
   "rect": {
    "x": 1147,
    "y": 863,
    "w": 18,
    "h": 18
   },
   "now": null,
   "min": null,
   "max": null,
   "role": null,
   "orientation": null,
   "controls": null,
   "tabIndex": -1
  }
 ]
}

```

### 2.4bis 帧/长任务口径（**双通道都用上了**）

**通道自证（每批次必带的阳性/阴性对照）**：

| 通道 | 空闲窗（阴性对照） | 拖拽窗 | **页内 `setTimeout` 120 ms 阳性对照** |
|---|---|---|---|
| wall-clock rAF 帧间隔（播种） | 91 帧 / max 27.0 ms / **>50 ms = 0** | 166 帧 / max **17.3 ms** / **>50 ms = 0** | max **121.3 ms** / >50 ms = **1** |
| **LoAF `duration`** | 0 条 | **0 条** | **1 条 = 121 ms** |
| LongTask | 0 条 | 0 条 | 1 条 |
| **CDP `RunTask`**（类别含 `disabled-by-default-devtools.timeline`） | 1430 条 / max 3.66 ms / gt50 = 0 | **6965 条 / max 4.0 ms / gt50 = 0** | **max 120.185 ms / gt50 = 1** |

⇒ **拖拽期没有可用仪器检出的卡顿**（三通道一致），且三通道都被"注入 120 ms 必被检出"的**页内阳性对照**证明是活的。

**探针口径修正记录（诚实留痕）**：首次跑出的 `D4-drag-runTask` / `⑧b-runTask-channel` 两个 FAIL（`count=55741`、`max=NaN`）
是**探针缺陷**：我原先在同一条长 trace 内用 marker 切片，而本环境这些类别**直到 `Tracing.end` 才一起投递**
（实测：`end` 前 0 条、`end` 后一次性 55741 条）⇒ 所有 marker 停在 0，切片等于整场会话；`max=NaN` 是因为部分 RunTask 事件没有 `dur`。
改成**每窗口独立 `Tracing.start/end`** 后即得上面的正确数字（并顺带证实该类别集合确实"活着"）。
**两次运行的原始 JSON 都在 `raw/` 里，未挑选、未删除。**

⚠️ **口径诚实声明**：headless Chrome **没有 vsync**，因此 `p50` 帧间隔不是 16.7 ms 预算读数（拖拽窗 p50 偏低是"无 vsync 连续投递"的产物）。
本档只主张**同窗相对结论**（拖拽窗 vs 紧邻空闲窗 + 阳性对照）。机器同期有并行线（`loadavg ≈ 7–12`），绝对 ms 不可移植。

## 3. 失败 / invalid / 未完成项（诚实清单）

| # | 项 | 状态 | 说明 |
|---|---|---|---|
| 1 | **部署位写入** | **未做（按协调者分工）** | 本档沙箱为 `workspace-write`（工作区 `/home/CNS2026495165/dsh`），运行时装单位在 `~/.dsh/...` 之外；协调者已明确"deployed 写入由我执行"。⇒ 真机验证用 `context.route` 把**候选字节**喂给真实 bundle URL（`/plugins/@local/dsh-btw/client.js`），页面里出现 `[data-dsh-btw-handle]` 即证明跑的是候选（旧字节无任何手柄代码）。**served 路径的端到端核对留给协调者的 `apply-BtwResize-v1.mjs --verify`。** |
| 2 | **C3 宿主重启后仍保持** | **未测** | 需要一次重启窗口（协调者排冷面批次时一并做）。Phase 1 的 localStorage 是 root 作用域持久键，`dsh-client-runtime` 只清理 session 作用域记录（`:163-172`）⇒ 机制上成立，但**本档没有实测**。已实测的是 **C2（F5 刷新后保持）**：`width=480` 刷新前后一致 ✓ |
| 3 | **首轮抽屉打不开（4 次无效运行）** | **已定位并修复** | 全新浏览器上下文停在首页（无 current session）。修法三步：① 先 `waitForSelector('[role="treeitem"]')`（侧栏要等 `session.list` 回来才渲染，本机 1.3–4.5 s）；② **递进遍历侧栏行**（单点工作区不会开会话，首页只列**工作区**不列会话）；③ 最终用运行时自己的持久键 `dsh.sessions.current`（`SessionManager` 读 `{sessionId}`）**播种一个真实存在的最小会话 id**（从 `~/.dsh/sessions/<ws>/<uuid>/` 挑字节最小的，只读加载）。**前几次无效运行的 JSON 全部保留在 `raw/`**（不挑不弃）。 |
| 3bis | **键盘步长 ×16 的缺陷（已自查抓出并修复）** | **已修复** | 首版 `SideChatResizeHandle` 的 `ArrowLeft/Right/Up/Down` 既传了 `±RESIZE_STEP` 又乘了步长 ⇒ 一次方向键跳 **256px**（448→704）。out-of-tree DOM spec（§2.3）**当场断言失败并暴露**，随后改为"回调只传方向、`step` 负责乘数"，修完重建候选（`21ffca87…` → `9aa82dc5…`）。⇒ 说明"只跑既有 spec"抓不到这类缺陷（既有 spec 完全不碰手柄）。 |
| 4 | **探针锁长期被占（7 次排队：最快 1 ms 拿到、最长等 65 s、另有一次 20 min 放弃）** | **已按纪律处理** | 全程用 `.workspace/lag-fix/lib/probe-lock.mjs`，**从未回收未确证死亡的锁**（有一次握手前发现 `w14-residual-env` 持锁即放弃）。最终一轮（并集候选 R2）拿到锁并跑完 **41/41**。 |
| 4bis | **D4 帧/长任务数字的机器状态** | **受污染，只用同窗相对值** | 本机同期有 6+ 条并行线（窗口普查 `foreign` 常 > 0、`loadavg ≈ 7–12`）⇒ 绝对 ms 不可移植、也不可作为"改进幅度"引用。判据只用同窗对照 + 页内 `setTimeout` 阳性对照。原始 census/loadavg 已写进 JSON。 |
| 5 | **`<720px` 不套用显式尺寸** | **执行档级判断（唯一一处自拍板）** | 见 §6.1。审计把 I5（窄屏隐藏手柄）列为待产品确认项，用户已拍板"隐藏"；本档据其**语义延伸**为"窄屏也不套用尺寸"，以免把宽窗拖出来的大尺寸硬套到窄窗上（会压掉手机端的 bottom-sheet + scrim 语义）。**store 值不被改写**，窗口拉回即恢复（INV-2 更强形式）。若产品不认，删掉 `explicitSizeInput` 里的 `wideEnough` 分支即可（2 行）。 |
| 6 | **角手柄仅指针可达** | 已知取舍 | `aria-hidden="true"` + `tabIndex={-1}`：两轴均可由键盘分别到达（两个 `role="separator"`），角手柄是冗余便利。审计 A7 只要求"Tab 可聚焦两个手柄"。 |
| 7 | **多标签互不同步** | 已接受（审计 C8/R10） | `attachPersistence` 只在 attach 时读一次；两个标签各持一份内存态。未实现 `storage` 事件同步（审计明确不在最小方案内）。 |
| 8 | **Phase 2 全部未落地** | **按指令"只准备"** | 候选 + 锚点补丁脚本 + schema 预检 + 影子树验证齐备；落地与重启由协调者排进冷面批次。 |
| 9 | **`?rev=` 不是内容哈希** | 已写进脚本提示 | `?rev=d2bdd4c3…` 之类是 `sha1[:12]`；判"浏览器拿到的是哪份字节"必须用**响应体 sha256**。 |
| 10 | **产品树里另有一条线的残留文件** | **未触碰（非本档产物）** | `dsh-btw/src/client/index.ts.a11y-stage`（15:29 出现，文件名自带 `a11y`，git 未跟踪）。它不被任何 import 引用 ⇒ 构建/测试均无影响，但会污染"干净工作树"类检查。**按单一写入者纪律没有碰它**，仅登记，建议 a11y 线自行清理。 |
| 11 | **`data-pane` 语义标记缺失（审计 I6/§3.7 加固项）** | 未做（不在本单元范围） | 与本次改动无关，保持不扩范围。 |
| 12 | **"手柄常显"专项截图未产出** | 放弃（锁纪律） | 见 §3bis 说明：手柄是 hover/拖动才显形的透明条，专项截图需要再取一次探针锁，而收尾阶段锁被 `w29-blur-survey` 连续占用 ⇒ 按纪律放弃。手柄的存在/命中面积/a11y 由真机 DOM 量测 + DOM spec 断言支撑。 |

### 3bis. 截图与"手柄为什么在图上不明显"

| 文件 | 内容 |
|---|---|
| `shots/01-drawer-auto.png` | 打开抽屉的默认态（自动放置 448×876） |
| `shots/02-after-width-drag.png` | **拖拽结果**：左边缘拖 200px ⇒ 648px 宽（右侧锚定不动） |
| `shots/03-after-height-drag.png` | **拖拽结果**：下边缘拖上 150px ⇒ 高度 726px（**顶部不动**） |
| `shots/04-narrow-700-handles-hidden.png` | 窗口 700px：三个手柄 `display:none`、抽屉回到自动放置 |
| `shots/05-during-drag-window.png` | 性能窗口中的拖拽态 |
| `shots/06/07/08-…` | **未产出**：为拍"手柄常显"专门写了 `scripts/shots.mjs`（页内临时注入 CSS 让 `::after` 常显，**不改产品字节**），但探针锁在本档收尾阶段被 `w29-blur-survey` 连续占用 20+ 分钟 ⇒ 按纪律放弃，不回收他人锁。手柄的**存在/命中面积/a11y** 由第 2、3 条（真机 DOM 量测 + DOM spec 断言）替代支撑 |

⚠️ **为什么截图上"看不到手柄"是正常的**：手柄命中条是**透明 8px**，把手（`::after`）只在
`:hover` 或 `[data-dragging='true']` 时 `opacity:.55` 显形 —— 这正是审计 §3.10 要的"发现性"设计
（照宿主 `.handle[data-side=details]:after` 的做法）。因此：

1. 上面的拖拽结果截图**证明手柄真的可拖**（几何确实变了）；
2. 手柄的**存在与命中面积**由同一次真机 DOM 测量量化给出：
   宽手柄 `8×874 @ x=1141`、高手柄 `446×8 @ y=879`、角手柄 `18×18 @ (1147,863)`；
3. a11y 属性（两个 `role="separator"` + `aria-valuenow/min/max/controls`）与键盘全表均有断言。

## 4. 同档自复核

**裁决：PASS**（Phase 1，且真机判据 **41/41** 全通过）；Phase 2 交付物 **PASS（仅"准备完备"，未落地）**。

**上报主 agent 的 3 条待裁决项**：

1. **部署位冲突（最高优先）**：a11y 线 16:55 就地补丁了部署位并改了同一源码文件 ⇒ **只能落 R2（`ca6cc0ec…`）**，
   且落地前需**重取 pre-image**（我的 drift 闸门会拒绝已漂移的写入，这是设计行为）。详见 §0bis。
2. **Phase 2 的 `0` 哨兵**：审计建议的 `null` 哨兵在 schemastery 下**不生效**（实测），我改成 `0 = 自动`
   ——这是对审计的一处**事实性纠正**，请确认产品口径（settings.yaml 里 `width: 0` 表示"自动"）。
3. **`<720px` 不套用显式尺寸**：执行档级判断（§6.1），若产品否决只需删 2 行。

### 4.1 对照审计单元逐条核对

| 单元 | 对照点 | 结论 |
|---|---|---|
| R1 | store + `persist` 键 + 座位传入**既有**注册；常量齐备 | ✅ 全中（额外加 `setSize` 以满足 A3 的单次写） |
| R2 | 显式分支默认关、非显式路径一字不改、退化回退、保证非 null | ✅ 由 `b2-parity`（3456 例 0 差）+ 新增 12 例 spec 支撑 |
| R3 | 尺寸走 ref、deps 去掉尺寸项、暴露 `remeasure`、缺省等价 | ✅ 既有 measurement spec 未改仍绿；D1/D2 真机计数见 §2.3 |
| R4 | 三手柄 + 2×`role=separator` + 键盘全表 + `Escape` stopPropagation + CSS 纪律 + zh/en 文案 | ✅ 逐条落实（角手柄按 a11y 惯例 `aria-hidden`，两轴仍有键盘路径） |
| R5 | 座位 props、sizeRef、模式适配、`aria-controls` 目标 id、窄屏隐藏 | ✅ |
| R6 | 构建 + pre-image + 只拷 `lib/` + 三项核对 + 回归 | ✅ 脚本齐备并已 dry-run/`--verify`；构建 3 轮（初版 / `setSize` / 键盘修复）+ 第 4 轮并集重建；**落地由协调者执行**（已明确分工）。⚠️ pre-image 台账因 a11y 线 16:55 的就地补丁而**过期**，见 §0bis |
| R7 | 宿主 schema 只增不改 + 两处 default + 客户端逐字段重建三处 | ✅ 候选齐全；**并纠正审计的一个错误假设**（`null` 哨兵在 schemastery 不生效 ⇒ 用 0） |
| R8 | 读-改-写整个 `ui` 对象 + ready/writable 闸门 + 明确权威源 | ✅ 权威源按用户决定 ④ 定为 **settings 优先、localStorage 缓存**，并写进代码注释与 DEPLOY.md |

### 4.2 目标（用户四项硬约束）核对

| 约束 | 落点 | 证据 |
|---|---|---|
| ① 顶部固定、向下长 | `chooseRightExplicit` 的 `top = work.top`、`bottom = work.top + wantHeight` | 单元 spec「grows downward …top never moves」+ 真机 ② |
| ② 软上限 960（与 240 硬限制取较小） | `computeOverlaySizeBounds().maxWidth = max(minWidth, min(hardMax, softMax))`，`MAX_WIDTH_SOFT=960` 由抽屉传入 | 单元 spec 软/硬两个方向 + 真机 ③ |
| ③ `<720px` 隐藏手柄 | CSS `@media (max-width:719.98px)` + hook 侧 `HANDLE_MIN_VIEWPORT` 同步不套用显式尺寸 | 真机 ④ |
| ④ 持久化跟配置文件走 ⇒ Phase 2 | Phase 2 候选 + 锚点补丁脚本 + schema 预检 + DEPLOY.md；**未落地** | §5 + `raw/phase2-schema-preflight.json` |

### 4.3 自查到的副作用与处置

1. **既有 spec 会因缺 store 座位而崩** → 处置：座位在**类型上可选**，首帧锁定座位引用（hook 次数稳定），缺座位时降级为"自动 + 无持久化"并 `console.warn`；**未改动任何既有 spec**（`overlay-placement.spec.ts` 与 `overlay-measurement.spec.tsx` 与 HEAD 逐字节相同）。
   ⚠️ 遗留：该 `console.warn` 在 jsdom spec 里会打印 3 次（无害）；真机探针显式断言**不出现**该告警（`R1-store-seat-present`）。
2. **角手柄会产生 2 次 localStorage 写**（`setWidth`+`setHeight`） → 处置：新增 `setSize(w,h)` 单次更新；真机 A3 计数断言 = 1。
3. **拖拽期 hook 内 `setPlacement` 每帧一次 ⇒ 抽屉整棵子树每帧重渲染** → 这是审计 §3.5 既定 Shape 1 的一部分（`D3`），本档未引入额外渲染（`bounds` 只在工作区变化时更新）；性能影响由 D4 同窗对照量化。
4. **DOM 上新增 3 个绝对定位元素（含 2 个可聚焦）** → 会改变 Tab 顺序：手柄是 `.drawer` 的**前两个可聚焦元素**，即抽屉内最先被 Tab 到；未改动抽屉外任何元素的 tabindex。
5. **`<720px` 不套用显式尺寸**（执行档级判断，见 §6.1）——**这是本档唯一一处对审计未定项的自主拍板**，理由与影响面已写明。


---

## 5. Phase 2（冷面）交付与预检

### 5.1 交付物

| 文件 | 内容 |
|---|---|
| `phase2/apply-phase2.mjs` | 锚点补丁脚本：`--emit`（渲染候选）/ `--apply --confirm-apply`（写仓库，含 pre-image 闸门）/ `--rollback`；每个锚点**必须唯一命中**，且**全量先渲染后落盘**（无部分写入）；落盘后对 `lib/*.js` 跑 `node --check` |
| `phase2/candidate/src/index.ts` | 宿主 schema：新增 `ui.width/height`（`z.number().default(0)`），两处 `.default` 同步；**只增不改** |
| `phase2/candidate/src/client/btw-settings.ts` | `BtwSettingsSection.ui` + `BTW_SETTINGS_DEFAULTS` + `decodeBtwSettings`（逐字段重建必须显式加字段） |
| `phase2/candidate/src/client/drawer-size-settings.ts` | 新增 `useDrawerSizeSettings`：ready+writable 闸门、**读-改-写整个 `ui` 对象**、0↔null 哨兵转换、`clampStored*` |
| `phase2/candidate/src/client/SideChatDrawer.tsx` | settings 为权威 / localStorage 为缓存的接线（播种 effect + 提交时双写） |
| `phase2/preimage/PREIMAGE.json` | 三个目标文件的 pre-image sha256（`--apply` 漂移闸门基准） |
| `phase2/verify-tree/` | 影子树：候选应用后 `tsc` 全通过 + `vitest` **245 passed / 2 skipped**（与主树同数） |

### 5.2 schema 预检（真实 schemastery 实跑，**不需要重启**）

**纠正审计的一处错误假设**：审计建议 `null = 自动` 的哨兵并给了 `z.number()` 形态；实测
**`z.union([z.number(), z.const(null)]).default(null)` 的默认值不生效**——当 `ui` 以部分键出现时，
`width/height` 会**从解析结果里静默消失**（即使对象级 `default` 里写了这两个键）。
⇒ Phase 2 候选改用 **`z.number().default(0)`，`0`/负数 = 自动**（真实尺寸恒 ≥ 360，哨兵无歧义）。
其余实测结论：显式 0/负数/超大值/浮点**均被接受**（不会因 yaml 数值而注册期抛错，范围钳制在客户端）；
**类型错误（`width: "520"`）会抛 `ValidationError`** —— 已写入 DEPLOY.md 的运维注意。
原始证据：`raw/phase2-schema-preflight.json`。

### 5.3 为什么必须冷面（写进 DEPLOY.md §2）

1. `src/index.ts` → `lib/index.js`（`platform:'node'`），宿主模块在 `dsh web` 进程里被 **ESM 缓存**，只在启动时读一次（`02-plugin-system.md:152-153`）；
2. schema 变化属装配层冷面（`02-plugin-system.md:148`）；本档实测复证"loose schema 允许值穿透，但**声明键的类型错会抛**" ⇒ 无法靠值级热载绕开。

### 5.4 权威源（U-BTW-R8 的裁决项）

按用户决定 ④（"持久化要跟配置文件走"）实现为：

```
settings.yaml `dsh-btw.ui.width/height`  = 权威（跨浏览器、跨重启）
localStorage `dsh.btw.drawerSize`（Phase 1）= 快速缓存 / 降级兜底
```
仅当 `status === 'ready' && writable === true` **且原始 user 层携带该字段**时才播种缓存；
`memory` 模式（非 loopback）写入是静默 no-op ⇒ 此时缓存即唯一真相（等价于 Phase 1 行为）。


---

## 6. 给协调者的落地清单

1. **Phase 1（热面，随时可落）—— 用 R2，不要用 R1**：
   ```bash
   # ① 因为 a11y 线 16:55 已就地改过部署位，先重新取 pre-image（否则 drift 闸门会拒绝）
   cp -a /home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-btw/lib/. \
         /home/CNS2026495165/dsh/.workspace/lag-fix/exec-btw-resize/preimage/
   ( cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-btw-resize/preimage && sha256sum *.js *.d.ts > SHA256SUMS.txt )
   # ② 候选 = R2（含本档拖拽尺寸 + a11y 线 U-A11Y3）
   cp -a .../candidates/R2/lib/client.js /home/CNS2026495165/dsh/dsh-btw/lib/client.js   # 或直接用仓库当前 lib（已等于 R2）
   node .../scripts/apply-BtwResize-v1.mjs            # dry-run：先看计划 + drift
   node .../scripts/apply-BtwResize-v1.mjs --apply --confirm-apply
   node .../scripts/apply-BtwResize-v1.mjs --verify
   ```
   期望 served sha256 = **`ca6cc0ec4f992f0edd89b0e3a6fbba73f24d0231d147ee22486d292770f67cec`**；之后刷新浏览器即生效。
   自证两步：`[data-dsh-btw-handle]` 出现（本档）、`window.__dshA11yBtwChord === 'U-A11Y3:v1'`（a11y 线）——**两者必须同时成立**。
2. **Phase 2（冷面，需与其它冷面项同批重启）**：按 `DEPLOY.md` §2.2 顺序执行；schema 变化是唯一必须重启的原因。
3. 若只想要 Phase 1 而不要 Phase 2：**跳过 §2 即可**，Phase 1 完全不依赖 settings 通道。


---

## 6bis. 执行档级判断与遗留提示

### 6.1 `<720px`：不仅隐藏手柄，也不套用显式尺寸（唯一自拍板项）

- **决策**：`useOverlayPlacement` 的 `explicitSizeInput()` 在 `window.innerWidth < HANDLE_MIN_VIEWPORT(720)` 时
  返回 `explicitSize:false` ⇒ 窄窗走**完全自动**的放置（`bottom-sheet` + `mobileScrim`，与改造前逐字节同路径）。
- **理由**：用户决定 ③ 的语义是"窄窗不可调尺寸"；若只隐藏手柄而仍套用宽窗拖出的尺寸，
  窄窗会出现"右侧半宽抽屉 + 无遮罩"的错配（丢掉了移动端模态语义），且用户无法用手柄纠正（手柄已隐藏）。
- **代价**：INV-2 的"视图变窄只钳渲染"变成了"视图变窄**不渲染**显式尺寸"——更保守、更可恢复；
  **store 值不变**，窗口拉回即恢复原尺寸。
- **若产品否决**：删掉 `explicitSizeInput()` 里的 `wideEnough` 判断（2 行），其余不动。

### 6.2 落地时最容易踩的三件事

1. **只拷 `lib/`**：部署位 `src/` 是旧快照（23 处差异、缺 5 个文件）⇒ `cp src` 无用；
   `.module.css` 内联进 bundle ⇒ CSS 改动**必须重建**。
2. **重建后必须核对 served 响应体 sha256**（不是 `?rev=`），且本档实测证明
   "重建仓库 `lib/` 不会改变 served bytes"（构建前后 `curl` 均为 `28ccb37a…`）⇒ 沙箱内构建是安全的、不会顺手热部署。
3. **既有 spec 不能改**：`tests/overlay-placement.spec.ts`（以及 `overlay-measurement.spec.tsx`）与 HEAD 逐字节相同；
   若有人为了让新代码通过而改动它们，那是**返工信号**而非修复。

---

## 7. 产物索引

```
exec-btw-resize/
├── report.md                     ← 本文件
├── DEPLOY.md                     ← Phase 1 热面 + Phase 2 冷面 落地手册（含三项核对、回滚、预检）
├── preimage/                     ← 部署位 R0 快照（从 live 取）+ SHA256SUMS.txt + META.txt
├── candidates/
│   ├── R2/lib/client.js          ← **应部署的候选**（sha256 ca6cc0ec…，含 a11y U-A11Y3 并集）
│   └── R1/lib/client.js          ← 早期候选（9aa82dc5…，真机 38/40 跑在它上面；**已被 R2 取代**）
├── phase2/
│   ├── apply-phase2.mjs          ← 锚点补丁脚本（--emit / --apply / --rollback）
│   ├── candidate/                ← Phase 2 候选源码（4 个文件，含审查副本）
│   ├── preimage/PREIMAGE.json    ← Phase 2 三目标 pre-image sha256
│   └── verify-tree/              ← 影子树（应用候选后 tsc + vitest 全绿）
├── scripts/
│   ├── verify.mjs                ← 真机验收探针（候选经 route 替换，不写部署位）
│   ├── recon2.mjs                ← 抽屉打开策略侦察
│   ├── b2-parity.mjs             ← B2 对拍（基线 vs 当前）
│   ├── preflight-schema.mjs      ← Phase 2 schema 预检
│   ├── apply-BtwResize-v1.mjs    ← Phase 1 部署/回滚/校验
│   └── lib/{lock,census,counters.init}.mjs|js
├── raw/ · logs/ · shots/         ← 原始 JSON / 日志 / 截图
```
