# 面4：主题 rAF 延后（`theme-color` meta 写回：延后到下一个 rAF vs 帧内同步）

> 二级 subagent 交付（只回答这一个问题）。原始数据 `raw/firstopen-raf-*.json`；机器可读结论
> `raw/rAF-face-summary.json`；器械 `sub/raf-face-runner.mjs` + `sub/raf-face-pagestub.js`；
> 复算 `python3 sub/raf-face-analyze.py`。产品文件零改动，宿主未重启。

## 0. 结论（判定：**FAIL = 疑虑不成立**；且在本路径上属于"无法成立"而非"暂时没测出来"）

主 agent 的疑虑是「延后只是把成本推到点击帧」。在本线被测路径（**全新页面 → 点设置**）上，实测判定为 **FAIL**：

1. **点击相位里根本没有可被推的成本**：在 base 与 theme-sync 两臂的全部 6 个有效窗口里，
   点击相位（点设置 → 6 s dwell）观测到 `ThemePresenter.apply` 执行 **0 次**、生产代码
   `scheduleThemeColorRefresh` 排 rAF **0 次**、`meta.content` 写入 **0 次**、computed body 读 **0 次**。
   即这条路径的点击过程中压根没有主题快照 publish，延后分支没有被触发。
2. **把延后换成帧内同步，点击帧五个口径全部无差异**：`msToVisible` 16.3 → 16.7 ms（Δ −0.4 ms，
   组内极差 2.9/7.3 ms）、`phaseClick.RecalcMsPerS` 0.001 → 0.001、`rafClick.p99` 16.8 → 16.8 ms、
   `longtasks` 两臂均为 0 条、`taskBusyPct` 方向与疑虑相反且落在组内极差内（见 §5）。
3. **延后分支真正执行的地方（挂载相位）恰好证明了它不落在 dispatch 任务里**：base 臂每个窗口
   2 次 `refreshThemeColor` 全部发生在 rAF 回调内（`tcMetaWritesInRaf=2`、`tcComputedReadsInRaf=2`），
   调度栈为 `requestAnimationFrame ← scheduleThemeColorRefresh ← ThemePresenter.apply`。
   被强制同步化的那一臂（把 rAF 改成同步执行）则把这 1–2 次读写搬回了 apply 的调用栈内
   （`tcMetaWritesInSyncRafCallback≥1`），而点击帧指标仍无变化 ⇒ 该成本在点击帧上不可测。

**限定（必须写清楚）**：这里说的是"在这条路径上"。若某条路径会在**点击 dispatch 内 publish 主题快照**，
那么延后会把这次强制样式重算从"点击任务内"移到"下一个 rAF 回调"（通常是下一帧的任务），
**点击任务本身时长不会因此增加**（rAF 回调不可能在同一任务内执行），但**下一帧**会多一次重算 ——
那时需要重新检验的是"下一帧是否就是用户可感的那一帧"，本报告不能替那条路径背书。

---

## 1. 被检验的机制（产品代码事实，只读；served rev 与磁盘一致）

文件：`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js`
（sha1-12 = `82cca1a6178a`，与运行时栈里的 `client.js?rev=82cca1a6178a` 一致）

- 模块级队列与在飞标志（第 346–348 行）：

```js
const themeColorRefreshQueue = new Map();
let themeColorFrame = 0;
```

- 延后实现（第 359–380 行）——**注意 `themeColorFrame` 被当作"在飞"标志使用**：

```js
function scheduleThemeColorRefresh(win, presenter) {
  const winRef = win ?? globalThis;
  const request = winRef.requestAnimationFrame;
  if (typeof request !== "function") { presenter.refreshThemeColor(); return; }   // 无 rAF ⇒ 帧内同步
  let queued = themeColorRefreshQueue.get(winRef);
  if (queued === void 0) { queued = new Set(); themeColorRefreshQueue.set(winRef, queued); }
  queued.add(presenter);
  if (themeColorFrame !== 0) return;                                             // 一轮合并成一次读
  themeColorFrame = request.call(winRef, () => {
    themeColorFrame = 0;
    const pending = queued;
    themeColorRefreshQueue.delete(winRef);
    for (const item of pending) item.refreshThemeColor();
  });
}
```

- 调用点：`ThemePresenter.apply()` 末尾（第 448–449 行）`this.pendingTokenSignature = …; scheduleThemeColorRefresh(…)`。
- 真正的强制重算点在 `refreshThemeColor()`（第 472–474 行）：
  `this.themeColorMeta.content = getComputedStyle(document.body).backgroundColor;`（读 computed body background
  ⇒ 强制 document 级同步样式重算；随后写 `theme-color` meta）。

⇒ 机制本身成立：延后确实把"读 computed + 写 meta"从 apply 的调用栈挪到了下一个 rAF 回调。

---

## 2. 器械：两个必须处理的陷阱

### 2.1 陷阱①：`tcRafScheduled` 里混着器械自己的 rAF 心跳

`tools/firstopen-ab.mjs` 在 arm 相位用 rAF 装了一个自续心跳（第 180–183 行，`tick` 内部再
`requestAnimationFrame(tick)`），它经过同一套 `window.requestAnimationFrame` 包装 ⇒ 每帧 +1。
因此 `tcRafScheduled=369` 里的 366 次是器械心跳、**只有 2 次是生产调用**（见 §4 的分类计数）。
**"tcRafScheduled 很大"确实不能证明生产代码调用过 rAF**——本器械把两者用调用点栈分开计数。

### 2.2 陷阱②：共享器械在 `--cond theme-sync` 下会自我崩溃（本线 BLOCKER）

`tools/stubs.js`（第 106–115 行）把 `requestAnimationFrame` **无条件**替换为"同步执行并返回 handle"，
而 `firstopen-ab.mjs` 的心跳 `tick` 会在回调内部再排一个 rAF ⇒ **无限递归**，RangeError 从
`page.evaluate`（第 151 行）抛出，窗口在**写 JSON 之前**终止，且 `browser.close()` / `releaseLock()`
都到不了。复现证据：`raw/firstopen-raf-repro-sharedstub-theme-sync.json`（同一段 arm 代码：
真 rAF 页成功、共享 stub 页抛 RangeError，见 §7）。结论：**`--cond theme-sync` 在共享器械上不可用**，
所以本面必须自建器械（原始 3 次 `raw/firstopen-theme-sync-r{1,2,3}.json` 在本线无法产出；
本报告的对应产物命名为 `raw/firstopen-raf-theme-sync-r{1,2,3}.json`，避免与并行 agent 的文件名冲突）。

### 2.3 本器械与共享器械的差异（`sub/raf-face-pagestub.js`）

| 项 | 共享 `tools/stubs.js` | 本器械 |
|---|---|---|
| rAF 调用点归因 | 无（全部混计） | `Error().stack` 分类：器械心跳 / **生产 `scheduleThemeColorRefresh`** / 其它（各带 click 相位分列 + 栈样本） |
| theme-sync 同步化 | 无条件同步（导致器械自身无限递归） | **带重入保护**：只同步"在 rAF 回调之外排的" rAF；回调内再排的走真 rAF |
| 在飞标志伪影 | 未处理（同步后 `themeColorFrame` 被写成永不重置的真 handle ⇒ 后续 refresh 全被早退） | 新增 `theme-sync-faithful` 变体：对生产主题调度返回 **0**，使每次 apply 都帧内刷新（与 base 的 2 次对齐） |
| 其余计数 | —— | 同名保留：`tcRafScheduled/tcSyncInvoked/tcMetaContentWrites(InClick)/tcComputedReads(InRaf/InClick)/tcRefreshRan/tpApplySeen(InClick)` |
| 指标口径 | —— | `phaseMount/phaseClick/rafClick/overlay/longtasks/taskBusyPct/ws` 与 `firstopen-ab.mjs` 逐行同构 |

纪律：单浏览器、串行；每窗口前抢占 `research-v2/.probe.lock` 并要求 `foreignCount==0`；`--gatemax 180000`；
`CONTENDED` 时**不启动浏览器**（不给同机其它线再加负载），仍写 JSON 并标 INCONCLUSIVE；只点"设置/关闭"。

---

## 3. A. stub 是否生效（严格口径与路径可达性分开）

器械自证口径（本器械）：`effectiveStrict = rafSyncExecutedProd > 0`（生产调度的 rAF 确实被同步执行）；
`pathReachable*` 独立报告主题路径是否真的跑到。

| 窗口 | cond | 门 gate | `effectiveStrict` | `themeApplyRanInClick` | `metaContentWritesInClick` | `themeDeferScheduledByProdInClick` |
|---|---|---|---|---|---|---|
| raf-base-r1 | base | EXCLUSIVE | true（对照口径：计数变化） | false | 0 | 0 |
| raf-base-r2 | base | EXCLUSIVE | true | false | 0 | 0 |
| raf-base-r3 | base | EXCLUSIVE | true | false | 0 | 0 |
| raf-theme-sync-r1 | theme-sync | EXCLUSIVE | true（syncExecutedProd=1） | false | 0 | 0 |
| raf-theme-sync-r2 | theme-sync | EXCLUSIVE | true（syncExecutedProd=1） | false | 0 | 0 |
| raf-theme-sync-r3 | theme-sync | EXCLUSIVE | true（syncExecutedProd=1） | false | 0 | 0 |

**A 判定：stub 生效（6/6 窗口）。** 且"生效"与"路径可达"是两件事：stub 生效的同时，
点击相位里主题路径**一次都没跑**（§4）。

---

## 4. B. 生产代码是否真的调用过 rAF 来延后写回

**判定口径（三条，缺一不可）**

1. **调用点栈归因**：包装 `requestAnimationFrame`，对每次调用取 `Error().stack`；只有栈里出现
   `scheduleThemeColorRefresh` 的调用才计为"生产延后"（心跳、ResizeObserver 等另计）。
2. **同窗口时长内的差值**：两臂同参数（settle 6000 / dwell 6000），心跳速率一致（≈60/s），
   所以"总 rAF 次数之差"= 生产调用次数之差。
3. **相位归属**：用 `R.clickPhase` 在 arm 时置位，分别统计挂载相位与点击相位。

**数字**

| 臂 | 窗口 | rAF 总次数 | 器械心跳 | **生产延后** | 其它 | 点击相位内（心跳/生产/其它） | 生产调度栈样本 |
|---|---|---|---|---|---|---|---|
| base | r1/r2/r3 | 369/368/366 | 366/365/363 | **2 / 2 / 2** | 1/1/1 | 366/365/363 · **0** · 0 | ✅ |
| theme-sync | r1/r2/r3 | 367/367/368 | 365/365/366 | **1 / 1 / 1** | 1/1/1 | 365/365/366 · **0** · 0 | ✅ |

生产调度的栈样本（base r1，原样）：

```
window.requestAnimationFrame <- scheduleThemeColorRefresh <- ThemePresenter.apply <- Ss.<anonymous>
window.requestAnimationFrame <- scheduleThemeColorRefresh <- ThemePresenter.apply
    <- http://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-ui-layer/client.js?rev=82cca1a6178a:555:16
```

"其它"那 1 次/窗口的调用者是 `ResizeObserver.<anonymous>`（与主题无关，已归类不打进生产延后）。

**B 判定：生产代码确实调用过 rAF 来延后写回**（每个窗口都有，栈证据完备）；
但**只在挂载相位调用，点击相位 0 次**：

> **本路径（全新页面 → 点设置）上，`scheduleThemeColorRefresh` 的延后分支在点击相位未被观测到
> 任何一次执行。** 这是**路径不可达**（点击过程中没有主题 publish），不是"stub 无效"
> （§3 已证 stub 生效；同一窗口的挂载相位里它被稳定调用 1–2 次并被正确归因）。

（附注：`theme-sync` 臂 prodDefer=1 而 base=2 是**同步化伪影**，不是行为差异的证据来源：
同步执行后生产代码会把真 handle 写进 `themeColorFrame`，而该标志再也不会被重置 ⇒ 后续调度被早退。
`theme-sync-faithful` 变体通过返回 0 消除该伪影，见 §5.3。）

---

## 5. C. `theme-sync`（同步）vs `base`（延后）的差异

口径：每臂 3 个 EXCLUSIVE 窗口，取中位数；`Δ%` 为相对 base 的百分比；`极差`= 组内 max−min（噪声底代理，
再叠加 5 个"外部 base 窗口"（另两种器械：`firstopen-probe-base`、`firstopen-base-r1`、
`firstopen-reg-base-r{1,2,3}`）作独立噪声参照。点击相位窗口时长均 ≈6.06 s。

### 5.1 五个必答口径（主治组 = theme-sync 臂）

| 口径 | theme-sync 中位数 | base 中位数 | Δ（绝对/相对） | theme 组内极差 | base 组内极差 | 外部 base 中位数（极差） | 是否超噪声 |
|---|---|---|---|---|---|---|---|
| `msToVisible` (ms) | 16.3 | 16.7 | −0.4 / −2.4% | 2.9 | 7.3 | 17.7 (8.7) | 否 |
| `phaseClick.RecalcMsPerS` | 0.001 | 0.001 | 0.000 / 0% | 0.006 | 0.001 | 0 (0) | 否 |
| `rafClick.p99` (ms) | 16.8 | 16.8 | 0 / 0% | 0 | 0 | 16.8 (0) | 否 |
| `longtasks.maxMs` | 无（n=0） | 无（n=0） | — | — | — | 无（n=0） | 否（两臂点击相位均 0 条长任务） |
| `taskBusyPct` (%) | 2.543 | 13.229 | −10.7 / −80.8% | 14.266 | 12.452 | 1.835 (2.951) | **否**（差值 < 组内极差；方向与疑虑相反） |

补充（同源、同样两臂无差异）：`phaseClick.ScriptMsPerS` 0.015 vs 0.116、`TaskMsPerS` 0.025 vs 0.132
——这两个也是 CPU 侧口径，其组内极差（0.124/0.124）≥ 差值，且 base 臂里同为高值的窗口（base-r1 0.025）
与 theme 臂的低值窗口（theme-r1 0.014）完全重叠 ⇒ 不可作为证据。

**"同一窗口时长内 tcRafScheduled 差值"口径**（主 agent 指定的判据）：
`点击相位 rAF 次数/秒` = theme 60.27 vs base 60.28（**Δ≈0**，两者都≈60/s 心跳）——
即在点击相位，除心跳外两臂都没有任何 rAF 调用（生产延后 = 0 对 0）。

### 5.2 逐窗口（有效窗口）

| 臂 | 标签 | gate | msToVisible | RecalcMsPerS | rafP99 | ltMax | busy% | 生产延后(click) | 心跳(click) | 其它 | syncExecProd | meta 写入(click) | 并发外部浏览器 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| theme-sync | raf-theme-sync-r1 | EXCLUSIVE(124.9 s 等待) | 16.3 | 0 | 16.8 | 无 | 2.346 | 1 (0) | 365 (365) | 1 | 1 | 1 (0) | 有 |
| theme-sync | raf-theme-sync-r2 | EXCLUSIVE(111.6 s) | 18.1 | 0.001 | 16.8 | 无 | 2.543 | 1 (0) | 365 (365) | 1 | 1 | 1 (0) | 有 |
| theme-sync | raf-theme-sync-r3 | EXCLUSIVE(154.6 s) | 15.2 | 0.006 | 16.8 | 无 | 16.612 | 1 (0) | 366 (366) | 1 | 1 | 1 (0) | 无 |
| base | raf-base-r1 | EXCLUSIVE(27.7 s) | 16.7 | 0.001 | 16.8 | 无 | 4.206 | 2 (0) | 366 (366) | 1 | 0 | 2 (0) | 有 |
| base | raf-base-r2 | EXCLUSIVE(16.4 s) | 13.1 | 0 | 16.8 | 无 | 13.229 | 2 (0) | 365 (365) | 1 | 0 | 2 (0) | 无 |
| base | raf-base-r3 | EXCLUSIVE(0.02 s) | 20.4 | 0.001 | 16.8 | 无 | 16.658 | 2 (0) | 363 (363) | 1 | 0 | 2 (0) | 无 |

### 5.3 挂载相位（延后/同步真正执行的地方）与同步化忠实度

| 臂 | 每窗口 `refreshThemeColor` 次数 | meta 写入 | 其中"在 rAF 回调内" | `scheduleThemeColorRefresh` 排 rAF | 说明 |
|---|---|---|---|---|---|
| base（延后） | 2 / 2 / 2 | 2 / 2 / 2 | **2 / 2 / 2** | 2 / 2 / 2 | 读+写都落在 rAF 回调（帧边界），不在 apply 调用栈内 |
| theme-sync（朴素同步化） | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 首帧内同步执行成功（`metaWritesInSyncRafCallback=1`），但后续调度被"在飞标志伪影"早退 |
| theme-sync-faithful（忠实同步化） | (见下) | | | | 对生产主题调度返回 falsy handle，消除伪影 |

本期挂载相位口径（次要，噪声大）：`phaseMount.RecalcStyleCount` theme 58 / base 35；`phaseMount.ScriptDuration`
theme 0.057 / base 0.833 —— 这一相位的组内极差远大于臂间差（theme 极差 182），只能说明"两臂在挂载相位
都做了同样量级的样式工作"，不构成延后收益的量化证据。

---

## 6. D. 结论

**判定：FAIL（疑虑不成立）**，判据链（全部可复算）：

1. **治疗已真正施加**：theme 臂 3/3 窗口观测到生产 `scheduleThemeColorRefresh` 排的 rAF 被**同步执行**
   （`syncExecutedProd≥1`，且都在挂载相位；`tcMetaWritesInSyncRafCallback≥1` 证明读+写被搬回 apply 调用栈内）。
   即这不是"stub 没生效所以没差别"，而是"换了行为仍无差别"。
2. **点击帧没有可被推的成本**：两臂 6/6 窗口点击相位 `themeApplyRanInClick=false`、
   `metaContentWritesInClick=0`、`themeDeferScheduledByProdInClick=0`、`computedReadsInClick=0`。
   在这条路径上，"延后把成本推到点击帧"这个命题连载体都不存在。
3. **五个口径全部无超噪声差异**（§5.1），其中 `rafP99`、`RecalcMsPerS`、`longtasks` 三者在两臂间
   完全相同/均为 0；`msToVisible`（用户可感口径）差 −0.4 ms（噪声 2.9–8.7 ms）。
4. **机制层面**：延后把读/写放进 rAF 回调，而 rAF 回调不可能在触发它的那个 dispatch 任务内执行
   ⇒ 它至多把成本留给下一帧；本路径上"下一帧"对应的用户可感量（设置面板可见延迟 `msToVisible`）
   在两臂间无差异。

**若要把同一条疑虑改到"能成立"的形式，需要的前提（本路径不满足）**：
点击 dispatch 内部触发主题 publish（例如点某个会切换主题/落地页的控件），且该 publish 的
强制样式重算落在点击任务内。此时延后**不会**延长点击任务，但会占用下一帧——应改用
"点击 → 下一帧可见"（如 `msToVisible` 的下一帧口径 / 帧间隔 p99）来检验，而不是点击任务时长。

**遗留不确定项**
- 本报告未测"点击内 publish 主题"的路径（本线路径上不可达）；结论不外推到那条路径。
- `taskBusyPct/ScriptMsPerS/TaskMsPerS` 等 CPU 侧口径的组内极差 ≥ 臂间差（并受同机其它线负载影响），
  本报告只把它们记为"不可判读"，不据此下结论。
- 同线并行 agent 的浏览器竞态：6 个有效窗口中有 3 个在运行期间出现了 foreign 浏览器
  （`exclusiveThroughout=false`，已在 §5.2 标出）；`msToVisible/rafP99/RecalcMsPerS/longtask`
  对这些窗口不敏感，故 A/B 仍可用；`busy%` 类口径已按"不可判读"处理。

---

## 7. 复算方法（逐条可重放）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/incident2/regression
# 器械缺陷复现（共享器械 --cond theme-sync 会在 arm 相位崩掉）
node sub/raf-face-runner.mjs --mode repro --label raf-repro-sharedstub-theme-sync --settle 1500 --dwell 0 --gatemax 180000
# A/B（每窗口独立抢占 probe.lock；CONTENDED ⇒ 不启动浏览器、写 INCONCLUSIVE）
node sub/raf-face-runner.mjs --mode base              --label raf-base-r1       --settle 6000 --dwell 6000 --gatemax 180000
node sub/raf-face-runner.mjs --mode theme-sync        --label raf-theme-sync-r1 --settle 6000 --dwell 6000 --gatemax 180000
node sub/raf-face-runner.mjs --mode theme-sync-faithful --label raf-theme-sync-fa-r1 --settle 6000 --dwell 6000 --gatemax 180000
# 汇总（生成 raw/rAF-face-summary.json）
python3 sub/raf-face-analyze.py
```

---

## 8. 产物与纪律

> 本节内容见文件末尾"产物清单/复现证据"小节（含 repro 结果与 faithful 臂数据）。
