# report.md — exec-blurfix（**修订执行复核一体**档）：模糊载体通用修法（U-BLUR1/2/3）

- 线：`.workspace/lag-fix/exec-blurfix/`（独占）
- 宿主：PID **301709** `dsh web`，GUI `http://127.0.0.1:3080`（全程 survived；**未重启、未 pkill、未改任何产品文件**）
- 上游契约：`program/w29-blur-survey/audit.md`（449 行）+ `raw/MEASUREMENTS.json` + `program/w11-mask-look/audit.md` + `program/w28-btw-close/audit.md`
- 本档性质：**按已完成的普查落地，不重新拆解、不扩范围**；同档自复核见 §10
- 日期：2026-09-22

---

## 0. 一句话结论 + 自裁决

> **U-BLUR1 完成并通过全部验收（6/6），U-BLUR3 完成，U-BLUR2 两条载体如实标 INCONCLUSIVE。**
>
> 交付了**一个通用 M1 控制器**（`dsh-blurfix/1`）：**任一全视口模糊遮罩可见时，暂停其背后的无限动画与非必要过渡；遮罩消失即恢复**。
> 证据（全部同窗同页、对照同窗）：**真实壳层 Modal 女载体 `._mask_15u5s_14` + 真实驱动**：`>33ms` **71.1% → 0.3%**（LoAF 52→1）；忠实复刻驱动：**69.4% → 3.8%**（负对照 57.4%）；真实驱动：**21.5% → 3.8%**；`blur(10px)` 拖拽层：**17.5% → 0.0%**。
> **观感**：遮罩在、控制器介入时，**点阵之外整页逐字节相同（max=0，NULL control = 0）**；点阵区内的差异**恰好等于该动画自身某一相位**（相位对齐最优差 mean=0、max=0）。
> **本档自裁决：PASS**（§10 列出 3 条必须随交付一起传达的限定，其中 1 条是对审计前提的**修正**）。

---

## 1. 交付物清单

| 类别 | 文件 | sha256（前 20） | 说明 |
|---|---|---|---|
| **候选件（deployed post-image）** | `candidates/theme.client.js` | `33216710f957e319e587` | 117,156 B；**10 次实验全部用这一份字节**（§2.4 逐条核对） |
| **候选块（可读）** | `candidates/blurfix-controller.js` | `310980f8df3f4a44e050` | 37,041 B；由 `tools/gen-registry.mjs` + `tools/build-candidate.mjs` 装配，`node --check` PASS |
| 手写源码 | `candidates/blurfix-controller.src.js` | — | 含 `__REGISTRY__` 占位符的逻辑主体（复审入口） |
| **补丁脚本** | `apply-BlurFix-v1.mjs` | — | dry-run 默认 / `--apply` 写 / `--out` 出候选 / `--rollback` / `--json`；沙箱彩排已验（§1.3） |
| 登记表生成器 | `tools/gen-registry.mjs` → `raw/registry.json` | — | 19 个 keyframes（14 pause / **5 never-pause**），逐条带 file+byte offset 来源 |
| 探针（6 个） | `tools/blurfix-{smoke,lab,audit2,look,negctl,real,carriers,lightbox}.mjs` | — | 全部落盘原始 JSON |
| 原始数据 | `raw/{smoke-s1,lab-c1,audit2-a2,look-l2,negctl-n1,real-r1,carriers-c1,lightbox-lb1,lightbox-lb2}.json` + `raw/SUMMARY.md/json` | — | 含阳性/阴性对照、作废件登记 |
| 截图 | `shots/look-l2/**`（含差图 ×8 与 1:1 裁剪）、`shots/carriers-c1/**`、`shots/real-r1/**`、`shots/lightbox-lb*/**` | — | 遮罩期 / 关闭后 / 差图 |
| 二级子代理产物 | `raw/modal-callsites.{json,md}`、`raw/onboarding-carrier.md`、`raw/blur2-triggers.{json,md}`、`raw/blur2-opacity-verdict.md` | — | 19 处 Modal 调用点枚举、载体 2 定性、三载体触发配方（`tools/verify-offsets.py` 复核 46+19 个偏移 0 不符） |
| 落地说明 | `DEPLOY.md` | — | **含"落地后必须强刷"** 与 HMR 风险 |

### 1.3 补丁脚本彩排（沙箱内真跑，未碰 deployed）
```
cp deployed → .sandbox/theme.client.js      （pre 86f6ae4775ca）
node apply-BlurFix-v1.mjs --apply --target .sandbox/theme.client.js --tag .sandbox
  ⇒ 锚点唯一命中 offset 0；patched 117156 B sha 33216710f957；node --check PASS；pre-image + manifest 落盘
node apply-BlurFix-v1.mjs --apply ... （第二次） ⇒ already-applied，writes=0（幂等）
node apply-BlurFix-v1.mjs --rollback --tag .sandbox        ⇒ 还原为 86f6ae4775ca（与 pre 逐字节相同）
```
另：`--apply` 在工作区之外**必须**加 `--allow-outside-workspace`（deployed 写入由协调者执行）。

---

## 2. 前提承接与被本档修正的部分

| 上游结论（w29） | 本档处置 |
|---|---|
| M1 是"任何配置都有效"的修法；"只停驱动"≈"全停"（3.4% vs 3.8%）⇒ 不必停 spinner | ✅ **独立复现**：3.8%（只停驱动）/ 负对照 57.4%（介入但不停）/ 真实载体 0.3% |
| `_dsh-state-dot-chase` 是主凶（8 个 2×2 `<rect>`，只动 opacity） | ✅ **真实驱动复现**：R4 21.5% → R5 3.8%；且控制器**确实**抓到这 8 条（`pausedNames` 含该名） |
| 降半径 / 放慢 / `will-change` / `contain` 无效 | ✅ 未重试（遵守"不要重试 M3"） |
| "遮罩背后的 2×2 脉冲不可见"（协调者裁决前提） | ⚠️ **修正（有数据）**：见 §5.1 —— 是**被衰减 8.7×**且**没有引入任何新画面**，但不是字面意义的"逐字节 0" |
| `.VOzbGW_ring` 已被 w11 覆盖 | ✅ **不重复**：本线只在它上面做了一次 **M1 叠加**观测（§4.5），未改它的环带 |
| btw「X = 结束 btw」确认框归 `exec-btwclose` | ✅ **不重复**：本线只给通用机制 + 其余载体；未碰 btw 的确认框逻辑 |
| 载体 2 `._onboardingMask_1cfrq_10` = C 类（无法判定） | ✅ **由二级子代理结案**：`OnboardingSurface` 在整棵树里**只有定义与导出两处引用、0 个消费者** ⇒ 死代码；实际 onboarding 走的是 `primitives.Modal`（= **载体 1**）⇒ 归 B（即便挂载也被不透明 stage 遮住）——见 `raw/onboarding-carrier.md` |

### 2.1 用户硬约束的落实（"追求流畅不得牺牲观感"）
- **没有删除任何 blur**：7 个载体一个都没删；本线全部改动是"遮罩可见期内暂停**它背后的**动画"，遮罩一关立刻恢复。
- 未使用 `filter: blur()` 替代、未改半径、未放慢动画、未注入任何全局通配 CSS 规则（全部是逐元素内联样式 + 一个 `document` 级观察者）。
- **M2 未照搬**：`blur(10px)` 拖拽层实测 **alpha 0.702、无中央不透明块** ⇒ 环带法前提不成立 ⇒ 该处**只用 M1**（`raw/blur2-opacity-verdict.md` 静态结论 + 本档 P2 运行时读回一致）。

---

## 3. U-BLUR1：通用 M1 控制器（机制设计）

**一句话**：控制器把"暂停/恢复"做成 **DOM 可观测状态的函数**，而不是计数器的副作用。

| 设计点 | 做法 | 为什么这样做 |
|---|---|---|
| **载体识别（数据化，不硬编码类名）** | ① 快路：类名片段短名单 `mask/scrim/backdrop/overlay/lightbox/drop/ring/veil/dim`（**泛化片段**，覆盖全部 5 个真实 mask 类 + 环带）；② **节点新增的 mutation 一律允许走全量扫描**（遮罩形状未知）；③ 每 2 s 全量兜底扫描（先几何筛、只对"≥2% 视口"的元素读计算样式） | 决定权**只**在"计算 `backdrop-filter` 含 `blur(` + 可见 + 并集覆盖 ≥ `coverMin`(0.85)"这三条可观测量上；类名只是**廉价预筛** |
| **"全视口"判据** | 24×14 网格算**并集**覆盖比例（避免重叠重复计数）⇒ 环带 4 条合计 0.8929 也算"覆盖" | 实测：真实设置环带 union=**0.8929** ⇒ 控制器对**环带形态**同样介入（M2+M1 叠加） |
| **"在其背后"判据（观感安全的关键）** | 目标矩形中心被某载体覆盖 **且** 该载体**绘制在目标之上**（祖先链分歧点 + 有效 z-index + DOM 顺序的确定性近似） | 只停"看不见的那部分"：**遮罩上方的面板内容一律不碰**（实测 S1：上方元素 100% 保持运行、`abovePaused=0`） |
| **暂停什么（数据驱动）** | `getAnimations()` 枚举 → 必须 `iterations === Infinity`（或登记表标 `pause`）→ 才暂停；过渡（`CSSTransition`）按登记表分支冻结 | 登记表来自 **w29 普查生成物**（19 kf / 14 pause / 5 never-pause，逐条带 offset），**不是手打清单** |
| **5 个 spinner 排除（三条独立判据）** | ① 登记表 `never-pause`：`ts_spin`、`Tpxs2G_dshssh-rotate`、`lXshSW_todo-progress-spin`、`Y0dWHa_history-loading-spin`、`_spin_1ionb_47`；② **规则**：keyframes 只动 `transform/rotate` = spinner 签名；③ **规则**：名字含 `spin/spinner/rotat/loading/progress`。②③ 兜底方向是**默认拒绝暂停** | 最坏只可能"少省一点性能"，**不可能冻住 affordance**；验收 ④ 的断言就是 `pausedSet ∩ spinnerSet = ∅` |
| **成对恢复（机制保证，不靠自觉）** | 每一次扫描都从 DOM **重算**"当前可见遮罩集合"；**集合为空 ⇒ 无条件 `releaseAll()`**（即使内部账本认为已释放）；`releaseAll()` 幂等、逐条还原原本的**内联** `animation-play-state` 值与 priority（原本为空 ⇒ `removeProperty`），WAAPI 暂停的过渡回 `play()`；任何一条出错都继续还原其余 | 消灭 w29 c1 那种"漏恢复一次 ⇒ 动画永久静止"的路径：**恢复不由增减计数驱动** |
| **失败安全** | 整块 `try/catch` + 安装延后到宏任务；宿主模块求值**不可能**因为本控制器失败（不会出现"主题坏掉 ⇒ 整屏不可渲染"） | 上一批 a11y 的"整屏不可见"教训 |
| **作用域窄、可单条回滚** | 无全局通配 CSS；只有逐元素内联样式；文件级删除即回滚；另有**运行期 kill switch** `window.__DSH_BLURFIX__.setEnabled(false)`（立即 `releaseAll` 且停止扫描，不刷新即可整体停用） | 便于协调者单条回退 |
| **扫描开销** | 实测 `scanMsMax` **2.4–3.4 ms**、全量 sweep **1.9–3.0 ms**；快路节流 200 ms、已介入时 500 ms 复扫、2 s 兜底 | 自身不成为新的抖动源 |

**宿主选择（为什么是 `@deepseek-ai/dsh-client-ui-theme`）**：boot manifest（`GET /` 内 `__DSH_BOOT__`）50 条 entries 中仅 **11 条 `immediately:true`**，该 bundle 是其中之一 ⇒ **脚本在 boot 期必定执行**、一定先于任何遮罩就位；且它是 `--dsw-mask-blur` 这个 token 的定义者（语义上正是"遮罩模糊"的所有者）。**不新建插件**的原因有代码依据：`dsh-client-modules/lib/index.js:320-348` 的 `onRebuilt` 只对**既有 bundle 的内容变更**重哈希（热），插件行本身来自 boot 组合 `ctx.loader.entries()` ⇒ 新插件要重启宿主。

---

## 4. U-BLUR1：实测（全部同窗同页；锁 `held`；loadavg 3.65）

### 4.1 主判据（`raw/lab-c1.json`，每腿 6.0 s，播种 mark）
| 腿 | 配置 | `>33ms` | fps | p50 / p99 | LoAF | 介入 | 暂停元素/动画 | spinner 泄漏 |
|---|---|---|---|---|---|---|---|---|
| R0 | 无载体 + 复刻驱动 + 真实点 | **0.0%** (0/360) | 59.98 | 16.7 / 24.4 | 0 | — | 0 | 0 |
| **R1** | 载体 + 复刻驱动，**控制器停用** | **69.4%** (120/173) | 28.82 | 42 / 59.4 | 4 | 否 | 0 | 0 |
| **R2** | 载体 + 复刻驱动，**控制器介入** | **3.8%** (13/344) | 57.33 | 16.7 / 46.5 | 2 | 是 | **16 / 16** | **0** |
| R3 | **负对照**：介入但 `pauseInfinite=false`（什么都不停） | **57.4%** (105/183) | 30.49 | 43.9 / 59 | 8 | 是 | 0 | 0 |
| R4 | 载体 + **真实驱动**（侧栏真实状态点），停用 | **21.5%** (62/288) | 47.99 | 16.7 / 56.4 | 8 | 否 | 0 | 0 |
| **R5** | 载体 + **真实驱动**，介入 | **3.8%** (13/339) | 56.48 | 16.7 / 57.8 | 8 | 是 | **8 / 8** | **0** |
| R6 | 介入 +（遮罩上方无限动画 & 幕后 spinner） | **100.0%** | 22.16 | 44.6 / 63.7 | 5 | 是 | 16 | 0 |
| R7 | **阳性对照**：页内 `setTimeout` 忙循环 120 ms（窗口内） | 4.3% (10/232) | 54.55 | 16.7 / 61 | 8 | 是 | 16 | 0 |

**读数**：① 无载体时驱动本身**零代价**（R0）⇒ 与 w29 §3.3"静态代价≈0"一致；② **一加全视口载体就 69.4%**（R1）⇒ 复现"同类场景卡顿"；③ **M1 介入降到 3.8%**（R2），**负对照 57.4%**（R3）⇒ 收益**确由"暂停"造成**，不是设置顺序/负载造成的假象；④ 阳性对照按 w29 的修正方式（**窗口内**注入）被检出（LoAF 8、LongTask 1、p99 61）。

### 4.2 边界腿（`raw/audit2-a2.json`）——**R6=100% 的归因拆分**
| 腿 | 内容 | `>33ms` | fps | LoAF | 上方元素被暂停 | spinner 被暂停 |
|---|---|---|---|---|---|---|
| S0 | 只有载体（真实驱动被暂停） | 4.1% | 52.65 | 6 | 0 | 0 |
| **S1** | 载体 + **遮罩上方**一条无限 opacity 动画（按设计**不停**） | **100.0%** | 19.66 | 48 | 0 | 0 |
| **S2** | 载体 + **遮罩背后**一个旋转 spinner（按设计**不停**） | **97.8%** | 15.16 | 65 | 0 | 0 |
| S3 | S1+S2 复现（= R6） | 100.0% | 19.66 | 23 | 0 | 0 |
| S4 | 载体 + 复刻驱动（全部可暂停） | **3.8%** | 56.65 | 7 | 0 | 0 |

⇒ **M1 的适用边界（实测，不是推测）**：**只要遮罩"上方"或"背后不可暂停处"还有持续重绘，代价就压不下来**（~100%）。这不是控制器缺陷，而是"观感优先"的必然结果：那些东西**用户看得见**（上方）或**是 affordance**（spinner）⇒ 不许停。真实场景里最常见的组合（侧栏状态点/工具行扫掠在遮罩背后，且都可暂停）恰好落在 S4/R2，因此**主场景收益成立**。

### 4.3 观感（`raw/look-l2.json` + `shots/look-l2/**`）
方法：真实驱动（侧栏 8 个状态点，箱体 CSS `x23 y392 10×10`）+ 复刻全视口载体；同页同实例三相：`OFF`（控制器停用，驱动照跑）/ `ON`（驱动被暂停）/ `CLOSE`（拿掉遮罩，自动恢复）。每相 12 帧、间隔 120 ms（覆盖动画周期 1 s）。

| 指标 | 值 | 含义 |
|---|---|---|
| **NULL CONTROL**（ON 态逐帧两两比） | **全 0（逐字节相同）** | 冻结态渲染确定 ⇒ 后面的数字不是噪声 |
| 可见振幅（点阵裁剪，遮罩**在**）`OFF` | mean 0.70 / **max 12/255** / >2 的像素 8.87%（独立复算 ≈10.0%，见 §10.4） | 脉冲透过遮罩仍**残留**这么点可见幅度 |
| 同上 `ON` | **全 0** | 冻结 |
| 同上 `CLOSE`（无遮罩） | mean 1.33 / **max 104/255** | 无遮罩时它本来就有 104/255 ⇒ 遮罩把它衰减 **~8.7×** |
| **ON vs OFF 相位对齐最优差**（点阵裁剪） | **mean 0 / max 0** | **冻结帧与动画自身某一相位逐字节相同** ⇒ 暂停没有引入任何"新画面" |
| **整页 ON vs OFF：点阵区之外** | **max 0 / >2 的像素 0** | 除被暂停的 8 个 2×2 状态点之外，**整页逐字节不变** |
| 整页 ON vs OFF：点阵区内 | max 16/255 | 上界 ≤ 该动画自身可见幅度（104） |

**结论（含对前提的修正，见 §5.1）**：观感代价**只**出现在"被暂停的那 8 个 2×2 状态点"的脚印内，且**恰好等于动画停在某一相位**——不是模糊变了、不是布局变了、不是颜色变了。**遮罩之外/点阵之外的任何像素都没有变化。**

### 4.4 成对恢复 / spinner 断言 / 整屏 / 阴性对照
| 项 | 方法 | 结果 |
|---|---|---|
| **验收③ 反例测试** | 连续 **10 次**"注入遮罩 → 等介入 → 移除遮罩 → 等恢复"，每次读内部账本 **和独立 DOM 查询**（`document.querySelectorAll('[style*="animation-play-state"]')`） | **每次介入都成立**（engaged=true 且 styleRecords>0）；**残留内联最大 0、残留账本最大 0、关闭后残留 paused 最大 0** ⇒ **PASS** |
| **验收④ 断言** | `spinnerLeakAudit()`：对**当前所有 paused 动画**独立重算"是否 spinner 形状" | 泄漏 **0**；**反例自证**：把那个 spinner 的 keyframes 换成纯 opacity 后**它被暂停了**（`counterfactualCaught=true`）⇒ 断言**不是恒真** ⇒ PASS |
| **过渡分支** | 遮罩背后起两条 3 s opacity 过渡 | 冻结中 `transPaused=2`；释放后 `transPaused=0`、元素 opacity 正常落位 ⇒ PASS（诚实标注：该分支的**边际性能收益未测出显著性**，它只在"遮罩期恰好有过渡在跑"时起作用） |
| **验收⑤ 整屏可渲染** | 容器存在 + 可见 `data-slot` + pageerror + 打开会话后会话区子树 | root 可见 **true**、body 可见 true、**playwright `pageerror` = 0**；**会话区子树 97 个后代且含真实消息文本**（点的是**行标签** `span.sg_title`「分布式节点」，不是行内按钮）。⚠️ **字面判据 `data-slot 可见面积>0` 不可满足**：运行时普查 28 个 `[data-slot]` **全部 `display:contents` ⇒ 面积恒为 0**（其**后代**才有布局）⇒ 本档改用"root 可见 + 会话区后代>0"作为等价可观测判据（`raw/audit2-a2.json` 的 `census` 逐条留证） |
| **验收⑥ 阴性对照** | A 不送候选字节（按真实 URL 送**原样** bundle）；B 页内故意抛错；C 请求不存在的插件 URL | A：`blurfix=false` 而 app 正常（nodes=584）⇒ "控制器已安装"这条证据**承重**；B：`pageerror` 0→**1** ⇒ 错误通道是活的；C：不存在插件 → **HTTP 404**、真实存在的 → 200/80114 B ⇒ **三条全 PASS** |

### 4.5 真实设置环带上的 M1 叠加（`raw/real-r1.json`）
真实设置弹窗（`@deepseek-ai/dsh-client-ui-settings-general`，w11 环带形态）：4 条环带 **union=0.8929** ⇒ 控制器**介入**并把侧栏 8 个真实状态点暂停（`dotsPaused=8`）。同窗 `>33ms`：停用 **0.0%** / 介入 **0.0%**（LoAF 均 0）⇒ **该窗口太闲，测不出显著性**（不是失败；w29 在重驱动窗口测得环带 9.7%）。⇒ 结论只写"环带形态也被控制器识别并介入"，**不声称收益数字**。

---

## 5. 对审计前提的两条修正（本档必须显式传达）

### 5.1 "2×2 状态点在遮罩背后不可见" —— 修正为"被衰减 8.7×、且不引入新画面"
- 数据：同一批点，**有遮罩**时周期内可见振幅 **max 12/255**（100×100 裁剪内 8.87% 的像素变化 >2/255）；**无遮罩**时 **max 104/255**。⇒ 遮罩确实把它压掉约 **8.7×**，但**不是零**。
- 但**暂停没有新增任何画面差异**：ON 的冻结帧与 OFF 的某一相位**逐字节相同**（mean 0 / max 0），且**点阵之外整页 max=0**。
- **协调者裁决（2026-09-22，已采纳）**：**接受"停在某相位"口径，不要求字面归零**；**不要**为此排除小 affordance（理由：字面归零要把收益从 ~70% 打到 ~20% 一档，不划算）。
- ⇒ 因此验收②的表述是："**暂停造成的差异 = 该动画停在某一相位**，且**只**发生在被暂停元素的脚印内（点阵之外逐字节不变）"，而**不是**"≤ 噪声地板（=0）"。本档按前者判定 PASS，并把后者作为**已知、已量化的观感代价**交给协调者裁决（可选收紧：把"状态点"这类小 affordance 从暂停集合里排除，代价是回到 ~20% 一档，见 R4/R5）。

### 5.2 M1 的适用边界（一句话 + 为什么）
> **M1 只消除「被可见全视口模糊遮罩盖住、且在它背后、且可以暂停」的那部分持续重绘**
> （实测：真实 Modal 女载体 **71.1% → 0.3%**、忠实复刻驱动 **69.4% → 3.8%**、真实驱动 **21.5% → 3.8%**、`blur(10px)` 拖拽层 **17.5% → 0.0%**）。
> **两类东西不在射程内**：① 遮罩**上方**的持续重绘（S1 实测 **100%**）；② 遮罩**背后但不可暂停**的 affordance，例如 spinner（S2 实测 **97.8%**）。

**为什么遮罩上方的元素不能碰（机制理由，不是口味）**：
- 可控性来自**绘制顺序**：只有"画在遮罩之下"的元素才被遮罩的压暗 + 模糊盖住，暂停它 ⇒ 用户看不到任何变化（S1 腿里 `abovePaused=0`，控制器**故意**放过它）。
- 反之，暂停遮罩**上方**的动画，等于让**用户此刻正在看的东西定格**——它不是"被遮住的代价"，而是**直接的观感退化**（同一个 1 s 无限动画，从"在动"变成"卡住不动"）。
- spinner 类 affordance 同理：它是"正在运行/加载中"的**状态信号**，停它 = 骗用户（w29 §5.1 判据表已把它列为 ❌ 不能停），所以本线用**三条独立判据**确保不停（见 §3）。
⇒ **对后续任何"再想压更多"的尝试，这是前置知识**：先证明自己没有动这两类，再谈收益。

---

## 6. U-BLUR2：剩余载体逐个实测判定

| 载体 | 触发（真实、只读） | 运行时身份 | 停用 → 介入 | 判定 | M2 是否适用 |
|---|---|---|---|---|---|
| **4 `.BInVoG_mask`**（`blur(10px)`，半径最重） | 合成 `dragenter`（`dataTransfer.types=['Files']`，**从不 dispatch `drop`** ⇒ 不会上传任何文件；用 `window.dispatchEvent(new Event('dragend'))` 收尾） | `BInVoG_mask@share 1.0 / blur(10px)`；`background-color: var(--dsw-alias-bg-mask-drop)` **alpha 0.702**；中央只有文字/插图、**无任何不透明块** | **17.5% → 0.0%**（fps 45.66→60，LoAF 22→0） | **用 M1（实测通过）** | **不适用**（静态 + 运行时双证：无中央不透明块 ⇒ 环带法前提不成立） |
| **5 `.fNh4Da_mask`**（图片灯箱） | 点会话内图片（需含图会话） | — | — | **INCONCLUSIVE** | 静态：**条件性可用**（`img.fNh4Da_image` 背景 alpha=1，但脚印随图片尺寸变化）⇒ 上 M2 前必须运行时验 `getComputedStyle` + 脚印 + 核心像素差 |
| **6 `.SalQ5q_lightboxMask`**（btw 灯箱） | btw 面板内带图消息 | — | — | **INCONCLUSIVE** | **不适用**（静态：dialog/image 均无背景声明，占位 token `--dsw-alias-fill-tsp-secondary` 全文 0 定义 ⇒ 透明）⇒ 只能 M1 |
| **2 `._onboardingMask_1cfrq_10`** | 不可触发（本机已过 onboarding） | — | — | **结案：死代码（非 A 类）** | — |

**INCONCLUSIVE 缺什么（逐条写清）**：
- **载体 5**：缺"**可从侧栏打开、且含图片附件**的会话"。本档把侧栏**全部 18 个行标签**逐个打开扫描（`raw/lightbox-lb2.json` `rows` 逐行留证），**每个会话的大图数量都是 0**；二级子代理静态发现磁盘上有 39 个含图会话（如 `session-cb106ec3…`，12 个图片引用），但**它们不在侧栏可点行里**。要用真实会话测，需要协调者指定一个可打开的含图会话（或在允许的前提下用 RPC 直接打开该 session id）。
- **载体 6**：缺"**btw 面板内带图消息**"。btw 面板可以打开（`SalQ5q_drawer/surface` 均出现），但当前会话的 btw 是**空态**（`SalQ5q_emptyState`，`msgs=0 / imgs=0`）⇒ 没有 `.SalQ5q_messageImageButton` 可点。按 SA2 配方，需要打开"在 btw 里已经带图"的会话（`session-cb106ec3…` → 停放的子会话 10 个图片引用）。
- **不伪造数据**：两条都**没有**用页内伪造元素顶替真实载体去凑数字。
- **授权的"按 session id 打开"共尝试 5 轮（全部只读，全部失败）**，逐轮留证 `raw/session{,-s2,-s3,s4,s5,s6}.json`：
  | 轮 | 策略 | 结果 |
  |---|---|---|
  | s1 | 侧栏搜索框输入 `grill-me` | 输入成功、列表里出现关键词，但**没有点行**（当轮判据过松：把"列表出现关键词"误当作"会话已打开"，已修正为**必须出现大图**） |
  | s2 | 输入后按 label 匹配点击 | 点到的是**搜索树容器** `DIV.qDHVXG_searchTree`（不是会话行） |
  | s3 | 输入后点"最内层"节点 + 复放开会话帧 | 点到了正确的 `<button.YDXeBa_searchResultRow role=treeitem>`，但 **JS `.click()` 不切换会话**；WebSocket 帧数为 **0**（该版本开会话走 HTTP `/api/*`，不是 WS）⇒ 帧复放路径不适用 |
  | s4 | 改为 **Playwright 真实鼠标点击**（CDP 输入管线） | 侧栏搜索框当轮**未渲染**（60 s 等待后仍无）⇒ 0 行结果 |
  | s5/s6 | 等搜索框出现 + 真实键入 + **Enter 提交** | 搜索框出现且键入成功，但**结果行数恒为 0**（搜"grill-me"在 s3 曾出 3 行，且**全部属于 Dexterous_Hand 项目**，目标会话不在其中） |
  | s7 | **重启后新宿主**（`session.list` 已修好）+ 逐行真实鼠标点击侧栏会话行 | 侧栏可点行标签 **21 个**（当前项目会话行齐全），**逐个点开**后**没有任何一个会话的转写含 >40px 图片**（`bigImgs=0` ×21）；搜索行数仍为 **0**；btw 面板 `msgs=0/imgs=0/imgButtons=0` ⇒ 仍触达不到（`raw/lightbox2-l1.json`） |
  ⇒ **结论**：目标会话 `session-cb106ec3…` **不在侧栏搜索可达集合里**（该搜索只覆盖当前项目/最近会话），而 GUI **没有 URL/hash 深链**（壳层 bundle 内 `history.pushState`/`location.hash`/`/session/` 命中数均为 **0**）⇒ 在没有宿主级"按 id 打开"接口的前提下，**本档无法在不写数据的情况下打开它**。
- **但它们被覆盖的可能性是可判定的**：两者的 CSS 与载体 1 同形（`position:absolute; inset:0; backdrop-filter:var(--dsw-mask-blur)`，父层 fixed inset:0），而控制器的识别判据正是"计算样式含 blur( + 并集覆盖 ≥0.85 + 绘制在目标之上"——该判据已在**4 个载体**上实测成立（含 2 个真实载体）。⇒ 交付物对 5/6 的**识别**是同一套已测判据，"**帧收益未测**"这一点如实标注。

---

## 7. U-BLUR3：壳层 Modal **女载体**上的真实调用点 + 端到端实测

**调用点枚举**（二级子代理，两法互补，字节偏移已复核 46+19 处 0 不符；`raw/modal-callsites.{json,md}`）：
- **A1**：类名 `_mask_15u5s_14` 全树**只出现在 2 个壳层产物**（`index-C6eRlFa6.css` off 10027、`index-ClqxG24t.js` off 200380）——**没有任何插件 bundle 内联它** ⇒ 只靠类名**枚举不到调用点**。
- **A2**：插件统一 `require("@deepseek-ai/dsh-client-ui-primitives")` 复用壳层 `Modal` ⇒ **19 处调用点 / 9 个包**（17 处 `Modal` + 4 处 `RiskConfirmation`，后者在壳层 off 323469 处包裹 `Modal`）。
- **最佳安全实例**：`@deepseek-ai/dsh-client-ui-agent-preset` off 61309 —— **设置 → Agent 预设 → 行内「查看」**（只读查看器；页脚只有"关闭"；无任何写操作）。

**端到端 A/B（`raw/carriers-c1.json`）**：
| 腿 | 载体（运行时读回） | `>33ms` | fps | LoAF | 暂停 |
|---|---|---|---|---|---|
| P1 ctrlOFF | `._mask_15u5s_14@1.0/blur(2px)` **+ 4 条环带** | **71.1%** | 16.16 | 52 | 0 |
| P1 ctrlON | 同上 | **0.3%** | 59.16 | **1** | 8 个真实点 |
| P1 ctrlOFF（复测） | 同上 | **68.8%** | 15.99 | 61 | 0 |

⇒ **真实载体 + 真实驱动**：`>33ms` **71.1% → 0.3%**、LoAF **52 → 1**；关掉遮罩（Escape）后：`modalMask=false`、**残留内联 0**、8 个点**全部恢复 running**。
⇒ 这就是用户抱怨的那类场景（"打开设置/对话框，背后在动就卡"）在**真实载体**上的端到端修复。

---

## 8. 失败 / 作废 / 无效对照登记（诚实，不删数据）

| 项 | 状态 | 原因与处置 |
|---|---|---|
| `raw/look-l1.json`（第一次观感实验） | **作废（保留在册）** | 指标函数把"页面坐标的盒"错用在"裁剪图"上 ⇒ 越界读出 `undefined` ⇒ `NaN`，而 `max` 因 `NaN>0 === false` 而**伪报"全零 PASS"**。**本档自查发现**，已修：坐标空间改为"裁剪局部"+ 加**越界抛错** + 加 `finite` 字段；重跑为 `look-l2`（本报告只用 l2）。⚠️ 教训登记：**任何"全零 PASS"都必须先证"比较是有限数"**。 |
| `lab-c1.json` 的 A3 判据 | **REWORK → 已处置** | 该判据要求"关键 `data-slot` 可见面积>0"，实测 28 个 `[data-slot]` **全部 `display:contents`（面积恒 0）** ⇒ 判据本身不可满足（**假失败**），已由 `audit2` 普查 + 会话区子树实测替换为等价可观测判据（§4.4）。 |
| R6=100% 首轮读数 | **已归因，非控制器缺陷** | 由 `audit2` S1/S2 拆分证明是"上方/affordance 不可暂停"的边界（§4.2/§5.2）。 |
| `real-r1.json` 的 P1（Agent 预设「查看」） | **首次未触达** | 该轮按 textContent 找「查看」失败（该按钮是 **icon-only + `aria-label="查看: 标准模式"`**）；`carriers-c1` 改为按 `aria-label/title` 匹配后成功。两条都保留在册。 |
| `window.__W28.errs` 里的 `presence:Failed to execute 'observe'…` | **器械既存缺陷，与产品/本控制器无关** | 来自 w28 的 `init-probe.js:185`（它自己的 presence 通道捕获自身 MutationObserver 失败），在 **w28/w29 的既有原始数据里同样存在**（`program/w28-btw-close/raw/ab-close-ab4.json`、`program/w29-blur-survey/raw/{ab-carrier-c1,c2,c3,scan-r1}.json`）；本线所有 run 的 **playwright `pageerror` 均为 0**，且阴性对照 B 证明该通道是活的。 |
| `counts.skippedSpinner` 语义 | 标注 | 该计数是**跨扫描累加**（不是"每次扫描跳过数"）；判据只用**瞬时** `spinnerLeakAudit()`，不使用该累加值。 |
| 过渡分支的边际收益 | **未测出显著性** | 只在"遮罩期恰好有过渡在跑"时起作用；本档只证明它**行为正确且可成对恢复**，不声称性能收益（§4.4）。 |
| 绝对帧率跨窗口比较 | 禁止 | 本档所有判据都是**同窗同页相对对照**；w29 的 90.2% / w11 的数字只作**跨窗口数量级参照**，不直接相减。 |

---

## 9. 落地与回滚

见 **`DEPLOY.md`**（含：deployed 写入命令、**落地后必须强刷 Ctrl+Shift+R** 的理由与 HMR 风险、落地后复核链、回滚与 kill switch、以及"本次写入会触发 HMR rebuilt 帧 ⇒ 建议与其他客户端写入攒批"）。

---

## 10. 同档自复核（PASS / REWORK）

### 10.1 交付物 ↔ 实测字节一致性（承重检查）
10 次实验的 `raw/*.json` 里记录的 `candidate.sha256` **全部等于**当前交付件 `candidates/theme.client.js` 的 `33216710f957e319e587…`（逐条核对见 §2.4 附表的生成命令）⇒ **"测的就是交的"**；且每次运行都有 `served` 自证（候选字节确实按**真实 URL** 送达；`--no-route` 模式下改为抓取**被服务字节**比对 sha）。

### 10.2 逐条验收
| 验收 | 结果 | 依据 |
|---|---|---|
| ① M1 生效 `>33ms` ≤10%（对照 90.2%） | **PASS ×4** | 69.4→3.8；21.5→3.8；**71.1→0.3（真实载体）**；17.5→0.0（blur(10px)）；负对照 57.4% 证明因果 |
| ② 观感零代价（遮罩期/关闭后 1:1） | **PASS（口径已精确化）** | 点阵之外整页 **max=0**；NULL control 全 0；点阵内差异 = 动画自身某相位（mean 0/max 0）；关闭后振幅回到 104/255 量级 |
| ③ 成对恢复（10 次开关无残留） | **PASS** | 残留内联 0 / 残留账本 0；真实载体 Escape 后 8 点全部 running |
| ④ spinner 未被停（自动化断言） | **PASS** | 泄漏 0 + 反例自证断言活着 |
| ⑤ 整屏可渲染 | **PASS（判据已按实测修正）** | root/body 可见、pageerror 0、会话区后代 97（只点行标签）；字面 `data-slot` 面积判据不适用（28/28 `display:contents`） |
| ⑥ 阴性对照 | **PASS** | 三条全检出（无控制器即无证据 / 错误通道 +1 / 缺失插件 404） |

### 10.3 我主动检查的副作用与遗漏
- **是否泄漏暂停**：10 次开关 + 真实载体 Escape + 每腿前后 `residualAudit` ⇒ 未发现残留。
- **是否误停"用户看得见的东西"**：`abovePaused=0`（S1/R6）、`spinPaused=0`（S2/R6）；`residualAudit.inlineCount` 在未介入时为 0（说明没有"到处贴内联样式"）。
- **是否注入全局样式**：无。全部为逐元素内联 + 一个 `document` 级 MutationObserver/定时器（`raw` 里 `counts` 有 `errors:0`）。
- **是否可能整屏不可渲染**：控制器只在宿主 bundle 头部追加一个自包含 IIFE，安装延后一个宏任务并全程 `try/catch`；实验里同时出现的唯一 `errs` 项来自 w28 器械（§8）。
- **是否与 `exec-btwclose` 重复**：未改 btw 的确认框代码；本线对 btw 只做了"面板打开 + 空态"的只读侦察（载体 6 未触达）。
- **是否改了产品文件**：**没有**。deployed 主题 bundle 至今仍是 `86f6ae4775ca…`（dry-run 复核过）；所有实验用 route 拦截或（阴性对照 A）只读比对。
- **残留风险（交协调者裁决）**：① §5.1 的"点阵内 max 12/255"是否可接受（若要归零则需排除小 affordance，收益回落到 ~20% 一档）；② 遮罩上方/affordance 的持续重绘仍会卡（§5.2，需产品侧另行决定是否停 affordance）；③ 载体 5/6 帧收益未测；④ Gecko 未测。

### 10.4 观感判据的**独立复算**（不依赖 `blurfix-look.mjs` 的内存指标）
```bash
node tools/verify-look-frames.mjs --stamp l2    # 直接从 shots/look-l2 的 36 张 1:1 帧解码重算
⇒ raw/verify-look-l2.json，VERIFY-LOOK PASS
```
| 复算项 | 结果 |
|---|---|
| 序列内部逐像素最大差 | `ON = 0`（NULL control 成立）；`OFF = 16`；`CLOSE = 144`（遮罩拿掉后动画照常在跑） |
| 每个 ON 帧 vs 全部 OFF 帧的最优匹配 | **全部为 0，且都指向同一帧 `OFF#2`** ⇒ 冻结态**逐字节等于动画自身的某一个相位**（比"mean=0"更强的陈述） |
| 逐像素振幅（亮度口径） | `OFF max 12/255`、`CLOSE max 104/255`；>2/255 的像素 `OFF` 887（工具口径，四舍五入后）／**1003**（本复算未四舍五入 ≈10.0% 的裁剪像素）、`CLOSE` 128 |
| 有限性 | 全部指标是有限数（防"NaN 伪通过"，见 §8） |

### 10.5 停止条件核对（任务书要求"遇到就停下上报"）
| 停止条件 | 是否触发 |
|---|---|
| 找不到"只停驱动且不碰 spinner"的可判定判据 | **未触发**：判据 = 登记表（生成物，19 kf/5 spinner）+ 三条独立 spinner 排除规则 + `iterations===Infinity` + 遮挡判据；并用反例自证断言活着（§4.4） |
| M1 无法做到成对恢复 | **未触发**：恢复由"可观测 DOM 状态"驱动（集合为空即无条件 `releaseAll`），10 次开关实测 0 残留（§4.4） |
| 需要全局通配样式且影响面不可控 | **未触发**：无任何全局 CSS 规则；作用域 = 逐元素内联 |
| 剩余载体无法安全实测 | **部分触发**：载体 5/6 **如实标 INCONCLUSIVE 并写明缺什么**（§6），未伪造数据；载体 4 已实测通过 |
| 其它 | 无 |

---

## 9.1 会话打开尝试的副作用登记（授权补测用）

- 三条"打开指定会话"的策略（侧栏搜索框 / 展开项目分组 / 复放应用自己的开会话帧）**都未能在本机把目标会话
  `session-cb106ec3…` 打开**，细节见 §6 与 `raw/session{,-s2,-s3,s4,s5}.json`：搜索框确实存在
  （`input.qDHVXG_searchInput`，placeholder「搜索会话…」）且能列出会话行（`button.YDXeBa_searchResultRow`），
  但**JS `.click()` 与 Playwright 真实鼠标点击都没有切换会话**（对话区后代数恒为 2376、页面 `img` 总数恒为 0）；
  目标会话**不在搜索结果里**（搜"grill-me"只返回 3 条 Dexterous_Hand 项目的会话）。
- **磁盘副作用实测为"几乎没有"**（每次运行前后对 `~/.dsh/btw/index.json` 与目标会话文件快照比对）：
  入口/条目**无增无删**；唯一一次变化是 `session-f280a6e9…`（**当前**会话）的 btw `lastActiveAt`
  从 `1790064664456` 刷到 `1790071721534`（因为点了"btw 侧聊"，等于打开该会话的 btw 面板），
  以及目标会话文件 `session.jsonl.zstd` **未被写入**（size/mtime 不变）。⇒ **只刷新已存在条目的 `lastActiveAt`，无增删**。
- s5/s6（键入但未点行/未开会话）的副作用：`btwLastActiveChanged = []`、`addedRemoved = {added:[],removed:[]}` ⇒ **零磁盘副作用**。
- s7（`lightbox2-l1`，新宿主：逐个真实点击侧栏会话行 + 点"btw 侧聊"）的副作用，**如实登记**：
  * `~/.dsh/btw/index.json` **新增 1 条**：键 `session-6eeba315-d5c7-422d-94b1-6c8c2a16edf2` → 子会话 `e5daea50-24a2-4807-8440-75839fc62fed`（`parentTitle="查询综测与体测班级排名"`、`parentCwd=/home/CNS2026495165/university`、`createdAt=lastActiveAt=1790072614710`）。这是**点"btw 侧聊"打开 btw 面板的既有行为**（为当前会话登记一个 btw 子会话）；**该子会话目录不存在、无消息文件**（`child dir exists: False`）⇒ **没有产生任何消息/内容**；**本轮无任何删除**。
  * `~/.dsh/storages/session_projcache.json` 的 mtime 变化（逐个打开会话会刷新投影缓存）——既有行为。
  * 目标会话与其它会话的 `session.jsonl.zstd` **均未被写入**（size/mtime 比对）。
  * 若需回退这一条 btw 登记：删掉 `entries["session-6eeba315-d5c7-422d-94b1-6c8c2a16edf2"]` 这一个键即可（本档**不擅自删**，因为删除不在授权动作内）。

## 9.2 落地后复核：**deployed 字节**（`--no-route`，协调者已落地）

协调者已把本线候选件写入 deployed。本档随即用**不拦截 URL** 的模式复核"被服务的字节"（`raw/lab-post1.json`）：

| 项 | 值 |
|---|---|
| 服务端实际下发 | **sha256 `33216710f957e319e587fc6430c37cf245957cc094132d3c660550cf601a31d2`、117,156 B、status 200**（探针内 `env.served.matchesCandidate = true`；另用 `curl` 独立复核，与 `candidates/theme.client.js` 逐字节相同） |
| 页面自证 | `blurfix=true`、`tag="dsh-blurfix/1"`、`registry.census={filesScanned:60,keyframes:19,pause:14,neverPause:5}` |
| ① 主判据（deployed 字节） | R1 ctrlOFF **73.3%** → R2 ctrlON **3.6%**；负对照 R3 **56.9%**；真实驱动 R4 **35.5%** → R5 **3.9%**；阳性对照 R7 检出（LT=1、LoAF=2） |
| ③ 成对恢复 | A1 **PASS**（10 次开关：残留内联 0 / 残留账本 0 / 每次均介入） |
| ④ spinner 断言 | A2 **PASS**（泄漏 0 + 反例自证活着） |
| 边界（复现） | R6 **100%**（上方无限动画 + 幕后 spinner ⇒ 与前文 §5.2 完全一致） |
| ⑤ 整屏 | root 可见、`pageerror` **0**、会话区子树 >0；`data-slot` 字面判据同前（28/28 `display:contents`）⇒ 判据已按 §4.4 修正 |
| 环境 | 该轮 **宿主 PID 301709 已不在**（`hostPid.alive=false`，协调者已重启），GUI 仍 200/13 ms ⇒ 复核跑在**重启后的活体宿主**上（服务路径更强）；锁：回收的是一个**已确证死亡**的旧锁（`liveness=DEAD`、age 292 s），未触碰任何存活锁 |

⇒ **"测的就是被服务的字节"成立**；验收 ①③④ 在 deployed 字节上**复现通过**。

### 9.3 重启后新宿主上的复核（`raw/lab-post2.json`，协调者告知新宿主 pid 2988915）

| 项 | 值 |
|---|---|
| 服务端下发 | **sha256 `33216710f957…`、117,156 B、200**，`env.served.matchesCandidate = **true**`（**不拦截 URL** 模式，直接抓被服务字节） |
| 页面自证 | `blurfix=true`、`tag="dsh-blurfix/1"`、registry census 正确；**playwright `pageerror` = 0** |
| ① 主判据 | R1 ctrlOFF **46.4%** → R2 ctrlON **3.5%**；负对照 R3 **47.7%**；阳性对照 R7 检出（LongTask=1） |
| ③ 成对恢复 | A1 **PASS**（残留内联 0 / 残留账本 0 / 每次均介入） |
| ④ spinner 断言 | A2 **PASS**（泄漏 0 + 反例自证活着） |
| 边界复现 | R6 **98.9%**（上方无限动画 + 幕后 spinner）——与 §5.2 一致 |
| ⚠️ 本轮作废的两条腿 | **R4/R5（"真实驱动"腿）本轮无效**：`env.boot.anims = 0` ⇒ 这个窗口里**侧栏真实状态点根本没在动**（无驱动），所以 R4 3.9% / R5 4.5% 只反映"无驱动时的环境底噪"，**不作为真实驱动的证据**；真实驱动证据仍以 §4.1 的 R4 21.5%→R5 3.8%（c1 窗口）与 §7 的真实载体 71.1%→0.3% 为准 |
| ⚠️ 存活门禁口径 | 我的报 gates 检查的是**旧宿主 pid 301709**（已不存在 ⇒ 显示 `alive:false` 属正常），新宿主 pid **2988915** 由协调者提供、探针不检查它；本轮宿主存活以 **HTTP 200 / 15 ms** 为证据 |

## 附录 A：本档使用的探针与复现命令

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-blurfix
node tools/gen-registry.mjs > raw/registry-literals.js   # 登记表（来自 w29 普查）
node tools/build-candidate.mjs                            # 装配 + node --check
node apply-BlurFix-v1.mjs --out candidates/theme.client.js # 生成候选件（不碰 deployed）
node tools/blurfix-smoke.mjs --stamp s1                   # 冒烟（安装/介入/恢复）
node tools/blurfix-lab.mjs --stamp c1 --dur 6000           # 主判据 + 反例 + 断言 + 整屏
node tools/blurfix-audit2.mjs --stamp a2                   # 边界/过渡/DOM 普查/只点行标签开会话
node tools/blurfix-look.mjs --stamp l2                     # 观感像素级（含 NULL control 与差图）
node tools/blurfix-negctl.mjs --stamp n1                   # 验收⑥ 三条阴性对照
node tools/blurfix-real.mjs --stamp r1                     # 真实环带/真实调用点侦察
node tools/blurfix-carriers.mjs --stamp c1                 # 真实载体 P1(Modal)/P2(blur10px)/P3/P4
node tools/blurfix-lightbox.mjs --stamp lb2                # 逐行扫会话找图片灯箱
node tools/summarize.mjs                                   # 汇总 raw/SUMMARY.{json,md}
```

## 附录 B：跨窗口参照（**不可与本档数字直接相减**）
- w29 `H2`（全视口 + 忠实驱动）**90.2%**、`H5`（M1 只停驱动）**3.4%**、`D2/D4`（整屏运动层）99.0%→0.0%；
- 本档同窗参照为 **R1 69.4% → R2 3.8%**（不同窗口、不同驱动条数、不同负载）；
- 反映同一结论：**M1 把"遮罩背后的持续重绘"这一项代价压到 ~0–4%，与具体窗口无关**。
