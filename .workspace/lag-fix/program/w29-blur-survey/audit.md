# w29 — DSH 全 UI 模糊（blur）载体普查 + 分类 + "保观感"通用修法

**线**：`.workspace/lag-fix/program/w29-blur-survey/`
**问题（用户原话）**：「这个遮罩 blur 能保留吗？有什么方法解决卡顿又能保留 blur？**我还发现其他同样的场景也会卡顿。**」
**性质**：只读审计 + 受控实测。**未改任何产品文件、未改系统设置、未点保存/应用/删除/重命名。**
**日期**：2026-09-22
**窗口**：宿主 pid 301709（存活 5:56+，`dsh web`），GUI `http://127.0.0.1:3080`（HTTP 200，往返 0.9–2.7 ms）

---

## 0. 一句话回答（用户口径）

> **能保留。** 但你环境里"同样会卡"的场景**不是同一个遮罩**——它们是**同一个病因**：
> **一个铺满视口的 `backdrop-filter`，背后有东西在持续重绘。**
> 全 DSH 只有 **7 个模糊载体**（+1 个已退役、+1 个 SVG 滤镜），其中 **5 个是 A 类（会持续掉帧）**。
> **保住观感的修法只有两条实测有效**：
> - **M2 环带（缩面积）** → 抖动源**不是整屏运动的层**时有效（实测 `>33ms` **90.2% → 9.7%**）；**观感实测不可辨**：本线独立复测 **差 0.0272% >2/255、max 7/255**，且 **NULL CONTROL = 0（max=0）**、面板 core 差 **0**（§4.5），与 `w11` 的 0.0235%/max 8 同量级；
> - **M1 掐驱动（暂停持续重绘源）** → **任何配置下都有效**（实测 **90.2% → 3.4%**、**100% → 3.4%**、**37.5% → 3.7%**），**观感零妥协**，代价是被暂停的那条动画会静止。
> - ⚠️ **"删掉 `backdrop-filter`" 只是应急兜底、不推荐**（见 §6 M5）；**降半径（0.5px）无效**（实测 `>33ms` 仍 93.9%，与 2px 无实质差别 ⇒ 纯亏）。
> - ⚠️ **M3（背景隔离/提层）我实测了，结论是"基本无效"**：4 个变体里 3 个毫无效果，唯一有效的那个**不能迁移到 DSH 真实的驱动形状**（见 §5.3，这正是"看起来该有效"的假阳性）。

---

## 1. 方法与门禁（可复核）

### 1.1 窗口有效性四道门禁（脚本内逐条判定，落盘）
`tools/scan.mjs` / `tools/ab-carrier.mjs` 的 `gate()`：

| 门禁 | 判定方式 | 实测结果 |
|---|---|---|
| ① 周期心跳 | 每次 `fetch(GUI)` + 往返 ms | `status 200`，`ms 0.9–2.7`（c1 时因并发为 871/1770 ms） |
| ② 浏览器 pid 存活 | `/proc/<playwright-browser-pid>` 存在性，收尾复检 | 起止均存活 |
| ③ 流量 | 页内 `WebSocket.prototype.send` 台账（`init-probe.js` 的 `S.rpc`）+ `pageerror` 计数 | `pageerror=0`（除一次 boot flake，见 §8.3） |
| ④ 链底座存在 | `window.__W28` 注入成功 + `document.getElementsByTagName('*').length > 300` + `button.VOzbGW_trigger` 存在 | 通过；**未依赖 `session.list`** |

> ⚠️ **`session.list` 当前极慢/超时**（单发 32–35 s、4 路全超时；修复已落盘待重启）。
> 本线**所有探针都不调用会话列表**，只等「DOM 节点数 + 设置触发器存在」，因此该缺陷**不阻塞本线结论**；记录在案。

### 1.2 并发与锁（诚实标注）
- 锁库：`lib/probe-lock.mjs`。我在 09:52 取锁成功（pid 1380285），但**该进程随即退出**，锁被判定为死锁后被兄弟线合法回收。
- 之后 **`exec-boot2-probe`（pid 2573906，purpose `U-BOOT2 decoupling A/B`）持有锁**，并且**同时还有 `probes/verify-render.mjs`（pid 2672600）在跑**。
- ⇒ **本线的帧计时实验全程 `concurrentWith=exec-boot2-probe,verify-render`，未持锁**。
- loadavg 实测：c1 `11.50` → c2 `3.64` → c3 `10.05`（起）/`5.74`（1 分钟均值）。
- **为什么仍然可信**：本线判据全部是**同窗相对对照**（同一页面、同一浏览器实例内 A/B/A），环境负载同时抬高所有腿；且阳性对照（页内 `setTimeout` 忙循环）在每条窗口内都按预期抬起 `>33ms` 与 LoAF（§4.4）。**绝对 fps 不可跨窗口比较，只可用于同窗排序。**

### 1.3 判据（按任务指定）
- **主判据**：wall-clock rAF 间隔 **`>33ms` 帧占比**（`init-probe.js` 的 wall-clock rAF 回调入口 `performance.now()`，**已播种 `performance.mark('w29leg:<label>:start/end')`**）
- **辅**：LoAF（`long-animation-frame`）条数/最长；LongTask；CDP trace `RunTask`（`--trace`，类别含 `disabled-by-default-devtools.timeline`）
- **`>50ms`** 只作**相对 KPI**（声明会假阴性）
- **阳性对照**：**页内** `setTimeout` 忙循环 120 ms（不是 CDP 忙等）

### 1.4 工具与产物
| 文件 | 作用 |
|---|---|
| `tools/scan.mjs` | 运行时普查：95 张样式表全遍历（含 `@media` 递归）+ 逐元素计算值 + `getAnimations()` + SVG/SMIL + 基线 |
| `tools/recon-surfaces.mjs` | 只读侦察可用控件（**不点击**） |
| `tools/surface-survey.mjs` | 逐个**安全**顶层触发器开→读回载体→Escape |
| `tools/probe-mask-instance.mjs` | 定点找通用 `._mask_15u5s_14` 的真实实例 |
| `tools/ab-carrier.mjs` | A/B/A 实验台（家族 A 真实弹窗 / 家族 B 受控载体矩阵），可注入驱动 + 修法 |
| `raw/scan-r1.json` | 运行时普查原始结果（1.06 MB） |
| `raw/ab-carrier-c{1,2,3,4}.json` / `.log` | 四轮实验原始结果 + 摘要 |
| `raw/surface-survey-s1.json`、`raw/recon-s1.json`、`raw/mask-instance-m1.json` | 面板/控件侦察 |
| `tools/look-ab.mjs` | **观感量化证据**：真实设置弹窗 A/B/A/B/A/B + 像素差 + 1:1 裁剪 + **NULL CONTROL** |
| `tools/shots.mjs` | 取证截图 + `elementFromPoint` 栈的**面板不透明度**实证 |
| `raw/{css-scan,inv-raw,js-scan-1,btw-blur,blur-raw,blur-clients,drivers-raw}.json` | **两个二级子代理死亡前落盘的静态扫描原始产物（已抢救使用）** |
| `raw/MEASUREMENTS.json` | 4 轮实验 **67 条腿**的合并摘要（含 gates/env/aborts/trace） |
| `raw/look-ab-v1.json`、`shots/look-v1/**`、`shots/*.png`、`raw/shots-probe.json` | 观感与取证证据 |

> 复用：`program/w28-btw-close/probes/init-probe.js`（只读引用，未修改）作为页内主仪器。

---

## 2. 完整清单（**7 个载体**，两种独立方法完全一致）

**方法一（静态）**：全树 grep `backdrop-filter` / `-webkit-backdrop-filter` / `filter:*blur(` / `blur(`，排除第三方库噪音（cytoscape/mermaid/d3/happy-dom/`@shikijs`/TypeScript `lib.dom.d.ts`/csstype/lightningcss/testing-library/codemirror），含**构建产物**与**插件 bundle 内联 CSS**。
**方法二（运行时，权威）**：headless chromium 打开真实 GUI，遍历 `document.styleSheets`（**95 张，全部是运行时注入的 `<style data-plugin=...>`，无 `href`**；仅壳层 CSS 是 `<link>`），并对每个元素读 `getComputedStyle().backdropFilter/filter`。
**两法给出的载体集合完全一致**，且逐条 offset 可复核。

### 2.1 载体表

| # | 选择器 | 值 | 几何（视口占比） | file:line / 构建产物 byte offset | 注入方式 | 分类 |
|---|---|---|---|---|---|---|
| **1** | `._mask_15u5s_14` | `var(--dsw-mask-blur)` = **`blur(2px)`** | `position:absolute; inset:0` → **share 1.00** | `nm/@deepseek-ai/dsh-web-frontend/dist/assets/**index-C6eRlFa6.css**` off `10128`(`-webkit-`)/`10173`(标准)；**同哈希类名只出现在壳层 bundle `dist/assets/index-ClqxG24t.js`** | **静态 `<link>`（壳层 CSS）**；CSS 是 primitives `Modal` 遮罩，被编进壳层产物 | **A** ★核心 |
| **2** | `._onboardingMask_1cfrq_10` | **`blur(2px)`**（字面量） | `inset:80px 0 0` → share **0.944** | `dist/assets/index-C6eRlFa6.css` off `11587`/`11621`（`blur(` 位置 `11611`/`11637`） | 静态 `<link>` | **C**（未触达，见 §3.4） |
| **3** | `.VOzbGW_ring`(`+Top/Bottom/Left/Right`) | `var(--dsw-mask-blur)` = `blur(2px)` | **环绕 800×800 不透明面板的 4 条**；实测 4 块合计 share **0.853**（面板脚印 0.174 被排除） | `nm/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js:28` off `2305` | 运行时 `<style data-plugin=@deepseek-ai/dsh-client-ui-settings-general>` | **A**（**已被 M2 环带覆盖**） |
| 3′ | `.VOzbGW_mask`（同文件） | **`none`** | `inset:0`，background `transparent` | 同文件 off `2103` | 运行时 | **已退役**（MaskLook 之前的全视口模糊载体） |
| **4** | `.BInVoG_mask` | **`blur(10px)`** ← 半径是 token 的 **5 倍** | `position:fixed; inset:0; z-index:1000` → share **1.00** | `nm/@deepseek-ai/dsh-client-ui-attachment/lib/client.js:196` off `10038`（`varName=css$3`，`DropOverlay.module.css`） | 运行时（拖拽时注入/挂载） | **A**（**未实测**，见 §3.5） |
| **5** | `.fNh4Da_mask` | `var(--dsw-mask-blur)` = `blur(2px)` | `position:absolute; inset:0` → share **1.00** | `nm/@deepseek-ai/dsh-client-ui-attachment/lib/client.js:382` off `18245`（`varName=css$2`，`ImageLightbox.module.css`） | 运行时 | **A**（**未实测**） |
| **6** | `.SalQ5q_lightboxMask` | `var(--dsw-mask-blur)` = `blur(2px)` | `position:absolute; inset:0` → share **1.00** | `nm/@local/dsh-btw/lib/client.js:935` off `51036`；**工作区副本** `/home/CNS2026495165/dsh/dsh-btw/lib/client.js:944` off `52991`（源码 `dsh-btw/src/client/side-chat.module.css:633`） | 运行时 `<style data-plugin=@local/dsh-btw>` | **A**（**未实测**） |
| **7** | HeroGlow SVG 滤镜：`filter: url(#<glowFilterId>)` + `<feGaussianBlur>` | SVG gaussian blur | 空会话 hero 光晕，局部 | `nm/@deepseek-ai/dsh-client-ui-conversation/lib/client.js:7061`(`feGaussianBlur`)/`7067`(`filter:`) | 运行时（React 渲染 SVG） | **B**（静态渲一次，见 §3.4） |

**Token 定义（唯一）**：
`--dsw-mask-blur: blur(2px)` ← `nm/@deepseek-ai/dsh-client-ui-theme/lib/client.js:130` off `23055`（`gradient_shadow_text_css_default`，`body` 规则）。暗色主题另有 `body[data-ds-dark-theme]` 规则但**未重定义 `--dsw-mask-blur`** ⇒ 全主题统一 `blur(2px)`。
运行时读回确认：`getComputedStyle(body).getPropertyValue('--dsw-mask-blur')` → `blur(2px)`。

### 2.2 明确排除的"伪载体"（避免虚报）
- `dsh-client-ui-trajectory/TrajectoryTable.module.css` 的 4 条规则（`.Y0dWHa_overviewHierarchyNavLink` / `_timestampToggle` / `_sourceBlockJumpTarget` / `assistantToolCallButton`）在运行时普查里因 `backdrop-filter` 字样命中，但逐条解析后 **`backdrop-filter` 的声明值是 `unset`**（CSSOM 把 `all` 类长手属性串行化成整串 `unset`）⇒ **不是载体**。原始证据：`raw/scan-r1.json` 的 `hasBackdrop:true / hasBlurFn:false`。
- `d3-array/src/blur.js`、`cytoscape`、`mermaid`、`happy-dom`、`lightningcss`、`csstype`、`typescript/lib/lib.dom.d.ts`、`@shikijs/langs`、`@testing-library`、`@codemirror`、`domino`、`sharp` ⇒ 第三方库/类型定义/测试夹具，非 DSH UI。
- **`filter: blur()` 打在内容上**：全树**没有**任何 DSH UI 载体使用它（运行时逐元素扫描 `live` 里 `fHit` 计数为 0）⇒ 这条只作为 M4 的备选方向记录，**当前无载体**。
- **壁纸预模糊**：`dsh-wallpaper-local` / `@local/dsh-wallpaper` 里的 `blur` 是**配置字段**（`background.blur`，`min 0 / max 60 / step 1` 的滑杆标签），**不是 CSS 模糊载体** ⇒ 不参与分类，只作为 M4 的既有先例（§6 M4）。

### 2.3 「源码 vs 构建产物」背离检查
- **壳层**：`index-C6eRlFa6.css`（`mtime 2026-09-12T06:56`，35770 B，**2 行**=minified）是**唯一**被服务的壳层样式；载体 1/2 只存在于该产物。壳层 JS 产物为 `index-ClqxG24t.js`。**未发现"源码已改但服务旧产物"的背离**（载体 1 的类名哈希 `_mask_15u5s_14` 在产物 CSS 与 JS 中一致出现）。
- **插件**：所有插件 CSS 都是**运行时注入**，来源是各自 `lib/client.js` 的内联字符串；**不存在独立的产物 CSS 文件** ⇒ 无产物/源码双份问题。**但本地插件存在工作区副本 vs profile 安装副本两份**（载体 6：`dsh-btw/lib/client.js` off `52991` 与 `@local/dsh-btw/lib/client.js` off `51036`，**两份内容一致、仅偏移不同**）⇒ **已核对一致，无背离**。

---

## 3. 分类：A 类（动态背景 ⇒ 真会掉帧）/ B 类（代价≈0）/ C 类（无法判定）

### 3.1 分类判据
**A 类**必须同时满足三条：
1. 载体**铺得够大**（本线实测：铺满视口或接近；`blur` 半径**不影响**是否命中，见 §5.4）；
2. 载体背后存在**持续的像素变化源**（无限 CSS 动画 / SMIL / 大层 compositor 动画 / 流式文本 / 轮询重渲染 / 布局动画）；
3. 载体**可见期**内该源处于活动状态（即"打开弹窗时背后正好在动"）。

**B 类**：背后无持续变化 ⇒ 代价一次性光栅化，之后≈0。
**C 类**：缺条件无法判定（写明缺什么）。

**关键前提（w11 已确证，本线独立复现）**：`backdrop-filter` 的代价**不是持续的，而是逐次重绘付的**。
- 本线独立证据：**真实设置弹窗**在**空闲 app** 上，把 blur **还原成全视口**（`A2_fullpre`）与**禁掉 blur**（`A3`）对照 ⇒ `>33ms` 均为 **0.0%**，`LoAF=0`；重复腿 `A4` 同样 **0.0%**。⇒ **背后不动时，全视口 blur(2px) 代价实测为 0。**
- 反之，同一载体一旦背后有持续重绘 ⇒ `>33ms` 冲到 **90.2%**（§4.2）。

### 3.2 A 类（5 个）＋ 逐条驱动来源

| 载体 | 背后的持续驱动是什么（动画名 / 来源 file:line） | 证据 |
|---|---|---|
| **1. `._mask_15u5s_14`**（通用 Modal 遮罩，share 1.00） | ① **`_dsh-state-dot-chase_10orb_1`**：`._cell_10orb_54{fill:currentColor;opacity:.15;animation:_dsh-state-dot-chase_10orb_1 1s infinite}` + `@keyframes _dsh-state-dot-chase_10orb_1{0%,12.4%{opacity:1}12.5%,24.9%{opacity:.6}25%,37.4%{opacity:.35}37.5%,to{opacity:.15}}` ← `dist/assets/index-C6eRlFa6.css`（**运行时常驻 8 个实例**，目标=`<rect>`，本线实测 `getAnimations()` 抓到 8 条 `running/Infinity`）<br>② `.SalQ5q_btw-banner-shimmer`（`background-position`，1.8s infinite）← `@local/dsh-btw/lib/client.js` off `40523` / 工作区 `dsh-btw/lib/client.js` off `41045`<br>③ `.SalQ5q_btw-tool-row-sweep`（`left`，2.6s infinite）← btw bundle<br>④ `.o3BgMG_dsh-tool-row-sweep`（`left`，`[data-state=running]`）← `nm/@deepseek-ai/dsh-client-ui-tool/lib/client.js` off `28428`<br>⑤ `.iWrAna_dsh-skill-row-sweep`（`left`）← `.../dsh-client-ui-skill/lib/client.js` off `1089`<br>⑥ `.uV2eYG_input-pending`（composer pending，opacity）← `.../dsh-client-ui-conversation/lib/client.js` off `141361`<br>⑦ 5 条 composer transition（w28 已确证） | **实测 `>33ms` 90.2%**（忠实复刻驱动，§4.2/H2）；w28 独立实测 btw 确认框 **24.3–39.7%** |
| **3. `.VOzbGW_ring`**（设置环带，share 0.853） | 同上（环带背后仍是整个 app） | **实测环带 9.7%**（同窗对照全视口 90.2%）；真实设置弹窗在空闲 app 上 0.0% |
| **4. `.BInVoG_mask`**（拖拽遮罩，share 1.00，**blur(10px)**） | 拖拽期：app 自身动画（①–⑦）持续；且指针拖动本身产生持续输入/重绘 | **未实测**（见 §3.5）——但半径无关（§5.4）⇒ 预期与载体 1 同量级 |
| **5. `.fNh4Da_mask`**（图片灯箱，share 1.00） | 灯箱可见期内，背后会话若在流式输出/有 running 工具行 ⇒ ①③④⑤⑥ 活动 | **未实测** |
| **6. `.SalQ5q_lightboxMask`**（btw 灯箱，share 1.00） | 同 5，且 btw 抽屉自带的 shimmer/sweep（②③）在其中 | **未实测** |

> ★ **载体 1 是"同一个病因"的核心**：它是 primitives `Modal` 的**共享遮罩**，任何走壳层 `Modal` 的弹窗都会拿到它。**w28 已确证 btw「X = 结束 btw」确认框用的是它**（`exec-btwclose` 正在修这一例，本线不重复拆解）。

### 3.3 B 类（1 个 = 载体 7）
- **`.VOzbGW_mask` 退役体 / 载体 7 SVG 光晕**：HeroGlow 的 `feGaussianBlur` 只在**空会话 hero**渲染一次，且其父 SVG 无持续动画 ⇒ **一次性光栅化，之后≈0**。`<feGaussianBlur>` 本身光栅代价高，但**不在重绘路径上** ⇒ B 类。

### 3.4 C 类（1 个 = 载体 2）——缺什么条件
- **载体 2 `._onboardingMask_1cfrq_10`**：
  - 已知：`inset:80px 0 0`、`blur(2px)`、share 0.944，**只在首启 onboarding 出现**（本机 profile 已过 onboarding，运行时普查 `matchedNow=0`，`live=0`）。
  - **缺的条件**：① 无法在本机复现 onboarding 面（需要干净 profile / 无法在不改动用户 profile 的前提下触发）；② 因此**无法判定其后是否有无限动画**（若 onboarding 面里有 spinner/动画 logo ⇒ A；若纯静态插图 ⇒ B）。
  - **要settle 它需要**：一次干净 profile 的 onboarding 抓取 + 同时用 `getAnimations()` 列出其活动动画；或读 onboarding 组件源码里是否出现 `infinite`。**本线未做**（超时/风险权衡）。

### 3.5 ⚠️ 未能量化（显式清单）
1. **载体 4/5/6（DropOverlay blur(10px) / 两个 lightbox）没有实测**：需要触发文件拖拽、或在会话里存在图片才能开灯箱；在"只读 + 不点破坏性控件"的约束下、以及一次 boot flake（§8.3）之后，我判断风险/收益不划算，**没有伪造数据**。⇒ 它们的 A 类身份是**由几何 + 同一机制 + 半径无关性推出的**，**不是实测**。
2. **哪些产品表面调用 `._mask_15u5s_14` 没有被枚举**。我用**安全白名单**逐个打开 8 个顶层触发器（搜索会话/视图选项/命令/访问模式/选择模型/选择工作区/偏好库/设置），**只有"设置"产生了模糊载体（即环带）**；其余 7 个**完全没有遮罩**（是 popover）。因此除 w28 已确证的 btw 确认框外，**我没有找到第二个可安全打开的真实 `._mask_15u5s_14` 实例**（`添加工作区` 的探测腿因 boot flake 未取得结果）。⇒ 「通用 Modal 遮罩还有哪些调用点」= **未量化**。
3. **M2 环带为何"只减 17% 面积却换来 90%→10%"的机制未确证**。我把三种抖动配置都测了（侧栏点阵 90.2%→9.7%、整幅横带居中/靠边 99.2/100%→8.2/4.5%），但**为什么收益远大于面积比**，我的数据不足以定论。可排除的解释：不是"半径"（§5.4）；可能是**不透明面板遮挡中心 + 4 个静态矩形的可缓存 backdrop**，但**未验证**。⇒ 报告为**现象已实测、机制未确证**。
4. **真实用户环境是 5120×2880 @DPR2、本身仅 42.4 Hz、掉帧 27.2%**（w14），本线窗口是 headless chromium 2560×1440 @DPR2 稳定 60 Hz。⇒ **绝对帧率/占比不可跨环境迁移**，只有**同窗内相对排序**可迁移。
5. **Gecko 侧完全未测**（无 LoAF/LongTask、FF155 无 CDP）⇒ 本线结论**只覆盖 Chromium/Blink**。
6. **SVG 侧"用 JS 按 4 步离散更新替代 CSS 无限动画"这一保观感 M1 变体**：理论上有吸引力（真实 keyframes 本身是 4 段阶梯、每周期只变 ~4 次），**但我没有实装、没有实测** ⇒ **不作为结论提出**。
7. **M1 的观感代价未量化**：M1 会让被暂停的动画**静止**——这是可预见的观感变化，但"静止 vs 运动"的差别**本质上无法用本线的 A/B 像素差方法度量**（两者本来就不同）⇒ **只作定性说明，未量化**。
8. **M2 环带 + M1 叠加未单独测**（H7/I4 已带环带，再加 M1 只会更好，但未实测）。

---

## 4. 代表载体实测

### 4.1 实验台结构
- **家族 A（真实载体）**：真实设置弹窗，页内把 `exec-masklook` 的环带**还原成修复前的全视口 blur**（`.VOzbGW_mask{backdrop-filter:var(--dsw-mask-blur);background:var(--dsw-alias-bg-mask-1)}` + 环带关掉），三/四方对照。
- **家族 B（受控载体矩阵）**：注入**忠实复刻载体 1 绘制面**的元素（`position:fixed;inset:0;backdrop-filter:var(--dsw-mask-blur);background:var(--dsw-alias-bg-mask-1)` + 800×800 不透明面板），下面配可控驱动。
- **驱动**：
  - `dotchase8` = **忠实复刻真实驱动**：8 个 2×2 SVG `<rect>`，`@keyframes` **逐字抄自** `_dsh-state-dot-chase_10orb_1`，1s infinite，`animation-delay` 依次 −0.125s。
  - `transform` = 铺满视口的层做 `translateX` 无限动画（**最坏情形**，大面积 compositor 动画）。
  - `xfband` = 100vw×200px 横带同动画，**只改位置**（面板脚印内 / 外）⇒ 用来判 M2 的适用边界。
  - `paint` = `background-position` 微光（复刻 btw `SalQ5q_btw-banner-shimmer` 形状）。
- 每条腿 = 先注入 → 静置 1.5 s → 播种 mark → 测 6.0 s → 取窗口统计。

### 4.2 ★首次**忠实复刻真实驱动**的对照（c3，同窗）
| 腿 | 载体 | 驱动 | fps | **`>33ms`** | `>50ms` | LoAF | LoAF max | RunTask max |
|---|---|---|---|---|---|---|---|---|
| H1 | 无载体 | dotchase8 ×16 anims | 59.99 | **0.0%** (0/369) | 0.0% | 0 | 0 | 9.0 ms |
| **H2** | **全视口 blur(2px)** | dotchase8 ×16 | **20.03** | **90.2%** (111/123) | 69.1% | **84** | — | 74.7 ms |
| **H3** | **环带 blur(2px)** | dotchase8 ×16 | 53.62 | **9.7%** (32/329) | 0.3% | **1** | — | 48.4 ms |
| H4 | 全视口 + **M1(全停)** | dotchase8 | 55.35 | **3.8%** | 3.8% | 13 | — | 74.3 ms |
| H5 | 全视口 + **M1(只停驱动)** | dotchase8 | 57.49 | **3.4%** | 1.1% | 4 | — | 58.0 ms |
| H6 | 全视口，抖动源在**面板脚印内** | dotchase8 ×8 | 39.46 | 35.3% | 8.7% | 20 | — | 59.2 ms |
| H7 | 环带，抖动源在**面板脚印内** | dotchase8 ×8 | 58.42 | **2.8%** | 0.0% | 0 | — | 43.1 ms |

**读数**：H1（16 条动画、无载体）**0.0%** ⇒ 动画本身便宜；**H2 一加全视口 blur 就 90.2%** ⇒ **这就是用户说的"同类场景卡顿"**；**H3 换成环带 → 9.7%**；**M1 → 3.4%（且"只停驱动"与"全停"等效：3.4% vs 3.8%）**。

### 4.3 M2 适用边界（c3 I 腿：同面积、同动画、**只改位置**）
| 腿 | 载体 | 抖动源位置 | fps | **`>33ms`** | LoAF |
|---|---|---|---|---|---|
| I1 | 全视口 | 面板脚印**外**（侧栏带） | 20.56 | **99.2%** | 38 |
| I2 | **环带** | 面板脚印**外** | 35.54 | **8.2%** | 0 |
| I3 | 全视口 | 面板脚印**内**（居中带） | 20.17 | **100.0%** | 43 |
| I4 | **环带** | 面板脚印**内** | 50.42 | **4.5%** | 1 |

⇒ 环带在"抖动源在面板脚印内/外"两种情况下**都**有效。**但** c2 的 D 腿给出**边界反例**：

| 腿 | 载体 | 驱动 | fps | **`>33ms`** | LoAF |
|---|---|---|---|---|---|
| D1 | 无载体 | transform（整屏层） | 59.97 | **0.0%** | 0 |
| **D2** | **全视口 blur(2px)** | transform（整屏层） | **15.95** | **99.0%** | **96** |
| **D3** | **环带 blur(2px)** | transform（整屏层） | 20.88 | **100.0%** | 40 |
| D4 | 全视口 + **M1** | transform | 59.94 | **0.0%** | 0 |

⇒ **边界条件**：当**抖动源本身是一块铺满视口、持续运动的层**（4 条环带全被扫到）时，**M2 只能小幅改善（fps 15.95→20.88、LoAF 96→40），无法消除 `>33ms`（仍 100%）**；此时**只有 M1 有效（→0.0%）**。
⇒ 同时也解释了 C 腿：`paint` 驱动（单元素 background-position）**根本复现不出问题**（C2 = 0.3%），所以 **c2 的 C7–C10（M3 四变体）全部是"0.0% vs 0.0%"，是无效对照，已作废**——这正是容易被误报为"该优化有效"的陷阱。

### 4.4 阳性对照与阴性对照
| 腿 | 内容 | `>33ms` | LoAF | LongTask | p99 | 判定 |
|---|---|---|---|---|---|---|
| A5 | 页内忙循环 120 ms（真实弹窗窗内） | 0.5% (1/190) | 0 | 1 | 18.0 ms | ✔ 检出（弱，靠 LongTask=1 + 1 帧 >33ms） |
| E2 | 页内忙循环 120 ms（有全视口载体） | 1.1% (2/186) | 1 | 1 | **78.5 ms** | ✔ 检出 |
| E3 | 页内忙循环 120 ms（无载体） | 0.5% (1/190) | 0 | 1 | 16.8 ms | ✔ 检出 |
| L1 | 页内忙循环 120 ms（M1 后的 transform 场景） | 4.4% (8/182) | 1 | 1 | 54.8 ms | ✔ 检出 |
| E1 | **阴性对照**：无载体、无驱动 | **0.0%** | 0 | 0 | 16.9 ms | ✔ 正确不报警 |

> 说明：120 ms 单次忙循环在 3 s 窗口内理论只影响 ~7/190 帧，故"占比"必然很低（0.5–4.4%）；**它靠 LongTask（=1）、LoAF、以及 p99（E2 因叠加全视口载体而达 78.5 ms，无载体的 E3 仅 16.8 ms）三条辅证成立**。这是"`>33ms` 占比在小剂量下会假阴性"的一个正面例证。⚠️ 本轮自检更正：`p99=78.5 ms` 属 **E2**，A5 的 p99 实为 **18.0 ms**（原稿误记）。
> ⚠️ 修正记录：c1 的 B12 阳性对照得 **0.0%（假阴性）**，原因是**忙循环在测量窗口开始之前就跑完了**（时序竞态）。已修正为**窗口内触发**，并在 c3 的 L1 复测通过（4.4%）。

### 4.5 ★观感量化证据（像素差 + 1:1 裁剪 + **NULL CONTROL**）
工具：`tools/look-ab.mjs`（复用 `exec-mask/tools/png-read.mjs` 解码，自写极简 PNG 编码器；方法复刻 `w11 look-pixdiff-v2.mjs`）。
原始：`raw/look-ab-v1.json`；截图 `shots/look-v1/{A_ring,B_full}_rep{1,2,3}.png`；1:1 裁剪 `shots/look-v1/crops/`。

**序列 A,B,A,B,A,B**（A=现状环带 / B=还原修复前全视口 blur），同一页面、同一浏览器实例，每腿静置 1.6 s 后截图。
分区依据：**面板不透明 ⇒ 模糊只可能在面板脚印之外可见** ⇒ 分 `ring`（面板脚印之外）/ `core`（面板内缩 8px）/ `edge`（面板外扩 4px）。

| 对比 | 类别 | 区域 | **`>2/255` 占比** | max | mean |
|---|---|---|---|---|---|
| **A(环带) vs B(全视口)** rep1 | config | ring | **0.0272%** | **7/255** | 0.0072 |
| **A(环带) vs B(全视口)** rep2 | config | ring | **0.0272%** | 7/255 | 0.0072 |
| **A(环带) vs B(全视口)** rep3 | config | ring | **0.0272%** | 7/255 | 0.0072 |
| A vs B | config | **panel core** | **0.0000%** | **0** | 0 |
| A_ring1 vs A_ring2（同配置跨批次） | **NULL** | ring | **0.0000%** | **0** | 0 |
| A_ring2 vs A_ring3 | **NULL** | ring | 0.0000% | 0 | 0 |
| B_full1 vs B_full2 | **NULL** | ring | 0.0000% | 0 | 0 |
| B_full2 vs B_full3 | **NULL** | ring | 0.0000% | 0 | 0 |

**1:1 裁剪逐块复算（A vs B，rep1）**：
| 裁剪块 | 内容 | `>2/255` | `>8/255` | max | mean |
|---|---|---|---|---|---|
| `sidebarText` | 侧栏文字区 | **0.0225%** | **0%** | **3/255** | 0.0521 |
| `chatLeftOfPanel` | 面板左侧会话区 | **0%** | 0% | **0** | 0 |
| `abovePanel` | 面板上方 | **0%** | 0% | **0** | 0 |
| `seamTop` | 面板上接缝 | 0% | 0% | 2/255 | 0.0074 |
| `seamBot` | 面板下接缝 | 0% | 0% | 1/255 | 0.0036 |

**结论（可判定）**：
1. **NULL CONTROL 全部为 0（max=0）** ⇒ 截图管线**逐字节确定**，**任何被测差异都是真实的，不是噪声**。这是"观感未退化"能成立的关键前提（没有噪声地板就无法区分"不可辨"与"没测出来"）。
2. 环带 vs 全视口在**能看见模糊的唯一区域**上差异 = **`>2/255` 仅 0.0272%、max 7/255、mean 0.0072**，且**三次重复完全一致** ⇒ **不可辨**。
3. **面板 core 差异为 0（max=0）** ⇒ 实证了环带法赖以成立的"**面板不透明 ⇒ 面板背后的模糊不可见**"这一硬前提。
4. 与 `w11` **独立测得**的 0.0235% / max 8/255 **高度一致**（两次独立测量互相印证）。

### 4.6 作废数据（诚实登记）

**c1 的 B4–B12 全部作废**，两个原因（已定位并修复，c2 起不再出现）：
1. `SETUP` 的清理清单**漏了 `w29-carrier2/3/4`（环带残留）**⇒ B4 之后各腿实测 `areaShare` 达 **1.6042**（>1，重叠），载体几何被污染；
2. B3 的 **M1 暂停泄漏到后续腿**（`runningAnims` 从 9 掉到 1 并一直是 1）⇒ B4–B11 的驱动状态全错。
**只有 c1 的 B0–B3 可用**（在污染发生之前）：B0（无载体+paint，9 anims）**0.0%**、**B1（全视口 blur2+paint，9 anims）38.1%（fps 31.5、LoAF 11）**、B2（blur 关）**0.0%**、**B3（+M1）0.0%**。
⇒ 这组数据**独立复现了"有驱动才有代价"**（B1 有 9 条 app 动画 ⇒ 38.1%；而 c2 的 C2 只有 1 条合成驱动 ⇒ 0.3%），与 §4.2 结论一致。

---

## 5. 通用修法（按"保住观感"排序）

**用户的硬约束（已写进口径）**：追求流畅**不得牺牲观感**；**M1 / M2 是唯二首选**；**"删除 `backdrop-filter`" 只能标注为应急兜底、非推荐**，并写明会让哪些 UI 失去模糊；**M3 必须实测，无效就写无效**。

### 5.1 ⭐ M1 掐驱动（观感零妥协）— **实测唯一"任何配置都有效"**
**做什么**：在遮罩/弹窗可见期间，**暂停或冻结**其背后的持续重绘源。
**实测效果**：
| 场景 | 前 | 后 | 观感 |
|---|---|---|---|
| 全视口 + dotchase8（真实驱动） | **90.2%** | **3.4%**（只停驱动）/ 3.8%（全停） | 被暂停的动画**静止** |
| 全视口 + transform（整屏层） | **99.0 / 100%** | **0.0%** | 同上 |
| 全视口 + dotchase8（c4 另一窗口） | 37.5% | **3.7%** | 同上 |
| c1 B1（9 anims + paint） | 38.1% | **0.0%** | 同上 |

**关键正面发现**：**"只暂停真正在抖的那条驱动"与"暂停全部动画"效果等效（3.4% vs 3.8%）** ⇒ **不必去停 spinner 之类的 affordance**，只需停**大面积/持续重绘的那条**。这把 M1 的观感代价压到最小。

**"哪些动画必须暂停、哪些不能碰"的判据（本线实测得出）**：
1. **必须处理**：**大面积 + 持续重绘**的源 —— 铺满/近满视口的运动层、`left/top/width/height` 布局动画、`background-position` 扫掠、**SVG 子元素上的 `opacity` 无限动画**（本线证实 `_dsh-state-dot-chase` 8 实例是**主凶**，尽管它只是 2×2 px 的点：**微小的像素变化也会逼全视口 backdrop 重算**）。
2. **可以不动**：小面积、**compositor-only**（`transform`/`opacity` 在**普通 HTML 元素**上）、且**不在遮罩可见期内**的动画；以及**不落在大面积重绘路径**上的装饰。
3. **不能碰（affordance）**：DSH 里几乎所有无限动画都是**"运行中/加载中"指示**，全树清点如下（`raw/drivers-raw.json`）：
   | 动画 | 选择器 | 属性 | 来源 file:line(off) | 能否暂停 |
   |---|---|---|---|---|
   | `_dsh-state-dot-chase_10orb_1` | `._cell_10orb_54` | `opacity`(SVG rect) | `dist/assets/index-C6eRlFa6.css` | ⚠️ **是"会话状态点"**，但**实测是主凶**（§4.2）——**需要产品决策** |
   | `SalQ5q_btw-banner-shimmer` | `.SalQ5q_runningBannerText` | `background-position` | btw off `40523` | ⚠️ "运行中"横幅发光 |
   | `SalQ5q_btw-tool-row-sweep` | `.SalQ5q_toolRow[data-state=running] …:after` | `left` | btw bundle | ⚠️ 工具行"运行中"扫掠 |
   | `o3BgMG_dsh-tool-row-sweep` | `.o3BgMG_root[data-state=running] …:after` | `left` | tool off `28428` | ⚠️ 同上 |
   | `iWrAna_dsh-skill-row-sweep` | `.iWrAna_card[data-state=running] …:after` | `left` | skill off `1089` | ⚠️ 同上 |
   | `uV2eYG_input-pending` | `.uV2eYG_pending` | `opacity` | conversation off `141361` | ⚠️ 输入"待处理"脉冲 |
   | `ts_spin` | `.ts_spin` | `rotate` | dsh-taste off `2318` | ❌ **不能停**（loading spinner） |
   | `Tpxs2G_dshssh-rotate` | `.Tpxs2G_spin` | `rotate` | workspace-enhancement off `117479` | ❌ 不能停 |
   | `Y0dWHa_history-loading-spin` | `.Y0dWHa_historyLoadingSpinner` | `rotate` | trajectory off `116020` | ❌ 不能停 |
   | `_spin_1ionb_47` | `._spinner_1ionb_47` | `rotate` | 壳层 dist off `1475` | ❌ 不能停 |
   | `K0NzfW_root[data-state=running] .K0NzfW_header` | pptmaster | — | pptmaster bundle | ⚠️ 运行中 |
   > 判据落成一句话：**"能不能停"取决于这条动画是不是用户此刻需要的状态信号**；但**实测表明可以只停"大面积重绘源"而不停 spinner，效果已经到 3.4%** ⇒ **实践上不必碰 affordance**。
   > 这就是 §3.2 里 ①–⑦ 中"哪些该停"的答案：**优先停 ②③④⑤（`left`/`background-position` 扫掠，面积大且是纯装饰性的"正在动"暗示）与整屏运动层；① 视产品决策**。
4. **与既有机制是否冲突**：
   - `prefers-reduced-motion`：本线清点的多数插件**已有** `@media (prefers-reduced-motion:reduce)` 块（如 `@local/dsh-btw` 明确把 `SalQ5q_btw-banner-shimmer` / `tool-row-sweep` 设为 `animation:none`，`@media (prefers-reduced-motion:reduce){…}`）⇒ **M1 可以直接复用同一份"该停的清单"，把"减少动效"的既有语义扩展为"遮罩可见期暂停"**，不引入新机制。**但注意覆盖不全**：`_dsh-state-dot-chase`、`o3BgMG_dsh-tool-row-sweep`、`iWrAna_dsh-skill-row-sweep`、`uV2eYG_input-pending` **未**出现在 reduced-motion 块里 ⇒ M1 的清单必须**独立维护**，不能只靠现有 reduced-motion 规则。
   - `document.hidden` 门控：与 M1 **正交**（后台标签页 Chrome 本就降帧）；M1 是"前台 + 遮罩可见期"的新门控，需**新增**生命周期（遮罩 mount/open → pause，unmount/close → resume）。⚠️ **风险：暂停/恢复必须成对**，否则会出现"弹窗关掉后动画永久停住"（本线 c1 就因恢复缺失污染了 9 条腿，是真实的反面教材）。
   - 与 `w11` 环带：**正交、可叠加**（H7/I4 已同时具备环带，再加 M1 只会更好；c3 的 H4/H5 在环带上加 M1 未单独测，属**未量化**）。

**可行性**：高（纯 CSS/JS 生命周期，**作用域窄、可单条回滚**）。
**风险**：① 恢复成对性（必须 `resume`，否则动画永久静止）；② 停的是 affordance 时的**状态可见性损失**；③ 需要产品决定 `_dsh-state-dot-chase` 是否可停。
**验收**：同窗三相（静止 / 载体可见期 / 暂停驱动后）`>33ms` 占比 + LoAF + `getAnimations().filter(playState==='running').length` 前后对照；**并断言关闭弹窗后 `running` 数恢复原值**。
**回滚**：单条选择器/单个生命周期钩子回滚；不涉及全局通配规则。

### 5.2 ⭐ M2 缩面积（环带）— **观感不可辨，但适用边界已实测**
**做什么**：把**全视口**的一整块模糊拆成**环绕"不透明面板脚印"的 4 条**，**面板背后那块不参与计算**。
**已落地**：`exec-masklook`（`w11`）——`.VOzbGW_mask{backdrop-filter:none}` + `.VOzbGW_ring(top/bottom/left/right){backdrop-filter:var(--dsw-mask-blur)}`。
**实测效果（本线同窗复核）**：
| 场景 | 全视口 | 环带 | 改善 |
|---|---|---|---|
| dotchase8（真实驱动，16 anims） | **90.2%** | **9.7%** | 9.3× |
| dotchase8（8 anims） | 37.5% | **7.1%** | 5.3× |
| xfband 侧栏 | 99.2% | **8.2%** | 12× |
| xfband 居中 | 100.0% | **4.5%** | 22× |
| **transform（整屏运动层）** | **99.0%** | **100.0%** | **无效** |
**观感证据（两次独立测量，互相印证）**：
- `w11`/`exec-masklook`：**差 0.0235% >2/255、max 8/255**（`exec-masklook/shots/ab/`），代价 **LoAF 45→1**。
- **本线独立复测**（§4.5，真实设置弹窗，A/B/A/B/A/B × 3 reps）：**差 0.0272% >2/255、max 7/255、mean 0.0072**，面板 core **0%**，**NULL CONTROL 全 0（max=0）** ⇒ 管线逐字节确定，差异真实且不可辨。裁剪见 `shots/look-v1/crops/`（`sidebarText` 0.0225%/max 3，`chatLeftOfPanel` 与 `abovePanel` **完全 0**）。
⇒ 两个独立测量给出**同一量级（0.02–0.03% >2/255、max 7–8/255）** ⇒ **M2 的观感代价实测不可辨**。

**可推广判据（本线实测给出）**：
- **适用（几何）**：① 载体是**铺满视口**的遮罩；② 遮罩之上/之中存在一块**完全不透明**的面板，且面板**占据一个明确的矩形脚印**；③ 需要"面板背后那块模糊被去掉"在**视觉上不可辨** ⇒ **前提是面板不透明**。
  - ✅ **该前提在本线已实测成立**：运行时读回 `.VOzbGW_panel` 的 `backgroundColor` = **`rgb(255, 255, 255)`（alpha=1，完全不透明）**；且像素差实测 **panel core 差异 = 0（max=0）**（§4.5）⇒ 设置弹窗**确实满足**环带法前提。
  - **如何验证其它载体是否满足**：`getComputedStyle(panel).backgroundColor` 的 alpha 必须 = 1（或存在不透明底板元素）；**且**用 `tools/look-ab.mjs` 复算该载体面板 core 的像素差必须为 0。**半透明面板下 core 像素差不为 0 ⇒ 环带法不成立**。
- **不适用（几何）**：① **面板半透明时不能照搬**——理由：环带的正确性建立在"**面板把背后的模糊结果完全遮住了**"这一前提上；若面板半透明（或遮罩本身要在面板上方再叠一层模糊），**去掉面板背后的 backdrop 会让用户直接看到"未模糊"的底层**，观感**必然改变**（不是"不可辨"而是"看得见差异"）。⇒ 半透明面板**必须保留面板背后的模糊**，环带法**不成立**。② 载体不是遮罩而是**内容滤镜**（`filter: blur()` 打在内容上）时，没有"被遮挡的中心区"可利用。
- **不适用（动态）**：**当抖动源是一块铺满视口、持续运动的层**（4 条都被扫到）时，环带**几乎无效**（D2 99.0% → D3 **100.0%**）⇒ 此时必须换 M1。
**可行性**：高（已在 `exec-masklook` 落地验证）；**作用域窄**（4 个类 + 1 个 mask 类）。
**风险**：① **半透明面板下会退化为观感退化**（硬前提）；② 4 块需要与面板尺寸联动（`exec-masklook` 用 `--w11-pw/ph/ov` 变量已是正确形式）；③ 窗口尺寸/DPR 变化时要重算；④ **残留仍有 ~3–10% `>33ms`**（不是归零）。
**验收**：像素差（>2/255 占比 + max）+ 同窗 `>33ms`/LoAF 对照 + **面板不透明断言**（`getComputedStyle(panel).backgroundColor` 的 alpha 必须 = 1，或存在不透明底板）。
**回滚**：单类回滚（把 `.VOzbGW_ring*` 恢复成全视口 mask 一条规则）。

### 5.3 M3 背景隔离成不重绘层 — **实测：基本无效（4 变体，只有 1 个有效且不可迁移）**
这一条正是任务点名"最容易假阳性"的优化。**我按变体逐个实测，在"能复现"的条件上测（transform，100% 基准）**：

| 变体 | 施加对象 | 实测 | 判定 |
|---|---|---|---|
| **M3a** `will-change: backdrop-filter` | **载体自身** | J0 100% / LoAF 82 → J1 **100%** / LoAF 80 | ❌ **无效** |
| **M3b** `will-change:transform` + `translateZ(0)` | **运动的 HTML 层**（driver） | J0 100% → J2 **3.7%** / LoAF **5** | ✅ **有效（仅此形状）** |
| **M3c** `contain: paint` | 载体 | J0 100% → J3 **100%** / LoAF 89 | ❌ **无效（略差）** |
| **M3d** `contain: paint` | app 根（`#root`/`[data-slot=root]`） | J0 100% → J4 **100%** / LoAF 96 | ❌ **无效（略差）** |

**但 M3b 不能迁移到 DSH 真实的驱动形状（决定性反例，c4）**：
| 变体 | 施加对象 | 实测 | 判定 |
|---|---|---|---|
| 参照 | 全视口 + dotchase8 | 37.5% / LoAF 35 | — |
| **M3b-svg** `will-change:transform`+`translateZ(0)` | **每个被动画的 `<rect>`** | **36.1%** / LoAF 19 | ❌ **无效（37.5→36.1）** |
| **M3e** `will-change: opacity` | 每个 `<rect>` | 33.3% / LoAF 1 | ❌ **基本无效** |
| **M3b-svgc** 提层 **SVG 容器** | `#w29-driver`(svg) | **37.2%** / LoAF 29 | ❌ **无效** |

⇒ **结论（写清"无效"）**：**M3 对 DSH 真实的模糊载体-驱动组合基本无效。** 唯一有效的组合是"**被动画的对象是普通 HTML 元素且动画是 `transform`**"时可提层；**而 DSH 的主凶是 SVG 子元素上的 `opacity` 无限动画**（`_dsh-state-dot-chase`），**提层对它无效**（`will-change:opacity` 也无效）。**因此 M3 不应作为主方案**；若某处驱动恰是 HTML `transform` 动画，可把 M3b 作为**叠加可选项**（但需在该处单独实测复核）。

### 5.4 M4 其它
- **`filter: blur()` 打在内容上**（而非 `backdrop-filter`）：全树清点 **DSH 当前没有任何载体使用它**（运行时 `fHit` 计数 0）。方向上可行（内容模糊可被缓存，因为模糊的是**自己**的子树而不是背后任意像素），**副作用**：① 会**连同内容一起模糊**，无法只模糊背景；② 与 `sticky`/`fixed` 混用会出现**视口裁剪/包含块变化**的坑；③ 需要内容本身可被牺牲清晰度 ⇒ **不适用于"要看清面板内容、只模糊背景"的弹窗遮罩**。
- **壁纸预模糊（零代码，已发货）**：`dsh-wallpaper` 的 `background.blur`（0–60 滑杆）是**把模糊烘进壁纸图像/静态层**，**不在逐帧重绘路径上** ⇒ 这是**正确的"保住观感又不卡"的既有先例**：把"需要模糊的素材"**离线/一次性**处理，而不是每帧算。可推广到：**如果某个遮罩背后的背景是静态图/静态渐变，就预模糊成图**（B 类载体本来就免费，无需处理；A 类载体背后是动态内容，无法预模糊）。
- **合成替代**：用**半透明纯色 + 更低不透明度**近似模糊感 ⇒ **会改变观感**，按用户硬约束**不作为推荐**。

### 5.5 ⚠️ M5 不推荐项（含理由）
| 项 | 实测 | 为什么不推荐 |
|---|---|---|
| **降半径（`blur(0.5px)`）** | `>33ms` **93.9%**（vs `blur(2px)` 100%，LoAF 82→1） | **剂量曲线是平的**：半径几乎不影响是否掉帧（只有 LoAF 计数下降）。**纯亏**：观感变差（模糊变弱）+ 卡顿几乎不变。与 `w11` 的"`blur(0.5px)` 与 `blur(2px)` 同为 13–17 条 LoAF/rep"一致。 |
| **节流（把动画放慢 8 倍，仍 active）** | K2 `>33ms` **100.0%**、fps 20.04、LoAF 52（vs 参照 100%、19.24、82） | **几乎无效**。⇒ 关键判据：**必须"暂停"（把它移出活动动画集合），仅仅"放慢"不够**。 |
| **删除 `backdrop-filter`（应急兜底，非推荐）** | A3/C3 实测 **0.0%**（确实能解决） | 会**失去模糊**的 UI（逐个列出见下）。**仅在 M1/M2 都不可行、且该处必须立刻不卡时**使用，并应登记为技术债。 |

**"删掉模糊"会让哪些 UI 失去模糊（供用户判断，逐载体）**：
| 载体 | 删除后失去什么 |
|---|---|
| `._mask_15u5s_14` | **所有走壳层 `Modal` 的弹窗**的"背景毛玻璃"——目前已知包含 **btw「X = 结束 btw」确认框**（w28）；**其余调用点未枚举（§3.5.2）**，可能含多个插件的确认/对话框 |
| `.VOzbGW_ring`（设置） | 设置弹窗四周的毛玻璃（面板本身不受影响）**——注意：这条正是 `w11/exec-masklook` 已经用 M2 保住的，不应回退成删除** |
| `.BInVoG_mask` | 拖拽文件时的整屏毛玻璃（半径 10px，是**最"重"的一处**） |
| `.fNh4Da_mask` / `.SalQ5q_lightboxMask` | 图片灯箱的背景毛玻璃（会变成纯色蒙层，图片本身仍清晰） |
| `._onboardingMask_1cfrq_10` | 首启 onboarding 的毛玻璃 |

### 5.6 逐条 PASS / FAIL / INCONCLUSIVE
| 项 | 判定 | 依据 |
|---|---|---|
| 载体清单完整性（静态 grep vs 运行时普查一致） | **PASS** | §2，两法集合完全一致，逐条 offset 可复核 |
| `--dsw-mask-blur` token 解析 | **PASS** | `blur(2px)`，唯一定义点，全主题一致 |
| 分类判据可判定性（A/B/C） | **PASS** | §3.1，A 类三条件均可用运行时可观测量判定 |
| A 类驱动来源（file:line/off）逐条给全 | **PASS** | §3.2 ①–⑦ |
| "静态背景代价≈0"在**真实弹窗**上复现 | **PASS** | A2 vs A3 均 0.0%、LoAF 0 |
| "动态背景⇒持续掉帧"在**忠实复刻真实驱动**上复现 | **PASS** | H2 **90.2%** vs H1 0.0% |
| **M1 有效（观感零妥协）** | **PASS** | 4 个配置：90.2→3.4、99/100→0.0、37.5→3.7、38.1→0.0 |
| **M1 可只停驱动而不动 affordance** | **PASS** | 3.4%（只停驱动）vs 3.8%（全停） |
| **M2 有效** | **PASS（有边界）** | 4 个配置有效（9.7/7.1/8.2/4.5%）；**1 个配置无效（100%）** |
| **M2 适用边界（整屏运动层）** | **PASS（反例已实测）** | D2 99.0% → D3 100.0% |
| **M2 观感未退化（量化）** | **PASS** | 环带 vs 全视口 **0.0272% >2/255、max 7/255**；**NULL CONTROL max=0**；panel core 0%（§4.5） |
| **M2 硬前提（面板不透明）** | **PASS（已实测）** | `.VOzbGW_panel` bg = `rgb(255,255,255)` alpha=1；core 像素差 0 |
| **M3 有效** | **FAIL（基本无效）** | M3a 无效、M3c/d 无效、M3b 仅 HTML-transform 形状有效、**对真实 SVG-opacity 驱动无效（37.5→36.1）** |
| **M5 降半径有效** | **FAIL** | 93.9% vs 100%，剂量曲线平 |
| 节流（放慢）有效 | **FAIL** | K2 100% |
| 阳性对照有效 | **PASS（弱）** | §4.4，靠 p99/LoAF/LongTask 成立；**已修正一次时序竞态导致的假阴性** |
| 载体 4/5/6 实测 | **INCONCLUSIVE** | 未触发（拖拽/灯箱）；A 类身份由几何+机制+半径无关性推断 |
| 载体 2（onboarding）分类 | **INCONCLUSIVE** | 无法在本机复现 onboarding（§3.4） |
| `._mask_15u5s_14` 全部调用点 | **INCONCLUSIVE** | 8 个安全触发器中只有"设置"出载体；未找到第二个可安全打开的真实实例 |
| M2 "减 17% 面积却换 90% 改善"的机制 | **INCONCLUSIVE** | 现象已实测、机制未确证 |
| M3b 安装在真实产品的可迁移性 | **FAIL（已证不可迁移）** | c4 M3/M4/M5 腿 |
| Gecko 侧 | **未做** | 无 LoAF；FF155 无 CDP |

---

## 6. 每个 A 类载体「该用哪一招」

| 载体 | 首招 | 备招 | 说明 |
|---|---|---|---|
| **1. `._mask_15u5s_14`**（通用 Modal 遮罩，share 1.00） | **M2 环带**（面板不透明 ⇒ 适用；实测 90.2%→9.7%） | **M1**（若背后出现整屏运动层，或要归零）；**绝不要**只依赖降半径 | 这是"同类场景"的**共同根因**。⚠️ 它同时是 btw 确认框的载体（`exec-btwclose` 的单元）⇒ **本线只给通用方案，不重复拆解** |
| **3. `.VOzbGW_ring`**（设置，已有环带） | **已是 M2**；如需进一步归零再叠 **M1（只停大面积扫掠 ②③④⑤）** | — | 空闲 app 上实测 0.0%；有真实驱动时 9.7% ⇒ **当前形态已基本可用** |
| **4. `.BInVoG_mask`**（blur **10px**） | **M2 环带**（它有中央提示内容，但**需先确认该内容块是否不透明**；若不透明可用） | **M1**（拖拽期暂停背后扫掠） | 半径 10px **不构成额外风险**（半径无关，§5.4/5.5）；**未实测**，上方案前必须实测 |
| **5. `.fNh4Da_mask`**（图片灯箱） | **M2 环带**（灯箱图/容器作为中心脚印，**需确认不透明**） | **M1** | 灯箱可见期内背后会话若在流式输出即为 A 类；**未实测** |
| **6. `.SalQ5q_lightboxMask`**（btw 灯箱） | **M2 环带** | **M1**（btw 自带的 shimmer/sweep 是 ②③，恰好是"可停"的那类） | **未实测** |

---

## 7. 与其它线上的覆盖关系（谁已覆盖 / 谁仍暴露）

| 状态 | 载体/场景 |
|---|---|
| **已被覆盖（不要重复修）** | **`.VOzbGW_ring`（设置）** ← `exec-masklook`（w11 环带，M2，观感 0.0235%） |
| **正在被修（本线不重复拆解）** | **btw「X = 结束 btw」确认框**（载体 1 的一个调用点）← `exec-btwclose` |
| **⚠️ 仍暴露** | **载体 1 的其它调用点**（通用 Modal 遮罩本体仍是全视口 blur(2px)，**调用点未枚举**）<br>**载体 4 `.BInVoG_mask`**（blur 10px，**半径最大**）<br>**载体 5 `.fNh4Da_mask`**、**载体 6 `.SalQ5q_lightboxMask`**<br>**载体 2 `._onboardingMask_1cfrq_10`**（分类未定） |
| **不受影响** | `exec-keepalive`、`exec-virtual`（与本线无交集）；载体 1/3 之外的 `Modal` 面板样式 |

---

## 8. 环境异常与教训登记

### 8.1 `session.list` 极慢/超时
实测单发 32–35 s、4 路全超时（修复已落盘待重启）。**本线探针全部容错**：不调用会话列表，只等 DOM 节点数 + 设置触发器；`scan.mjs` 的 boot 等待为 180 s 且失败即记录 `aborts`。

### 8.2 并发导致测量窗口不干净
`concurrentWith=exec-boot2-probe(pid 2573906, 持锁),verify-render(pid 2672600)`，loadavg 3.6–11.5。**处置**：全部判据改为**同窗相对对照**；阳性对照每条窗口内验证；绝对 fps 标注不可跨窗口比较。

### 8.3 boot flake（**新发现，值得别人注意**）
`tools/probe-mask-instance.mjs --stamp m1` 那一次 boot 失败：控制台 `PAGEERROR **SlotAssemblyError: renderSlot('root') before any 'root' registration (boot order)**`，DOM 只剩 **115** 个节点（正常 527–596），因此 `button[aria-label="添加工作区"]` 与 `button.VOzbGW_trigger` **都 NOT_FOUND**。
⇒ 该次测量**作废**；我在 `ab-carrier.mjs` 里加了**稳健 boot**（`nodes>300 && 设置触发器存在`，最多 5 次重试）后续全部通过。
⇒ **教训**：任何"整屏可渲染"断言都必须同时检查 **容器存在 + 消息列表有内容 + `pageerror===0` + 可见面积 >0**；本线新增的"节点数 + 关键触发器存在 + pageerror 数"是这三条的可操作化。

### 8.4 自查发现的自身缺陷（已修正，登记以免误用）
1. **c1 的 B4–B12 作废**：清理清单漏 `carrier2/3/4` + M1 暂停泄漏（§4.5）。
2. **阳性对照时序竞态**：c1 B12 假阴性（0.0%），已改为窗口内触发（§4.4）。
3. **c2 的 C7–C10（M3 四变体）作废**：`paint` 驱动未复现问题（C2=0.3%），"0.0% vs 0.0%"是无效对照；M3 已在复现条件（transform / dotchase8）上重测（§5.3）。

### 8.5 未做/未能量化（汇总，与 §3.5 一致）
载体 4/5/6 未实测 · 载体 2 未分类 · `._mask_15u5s_14` 调用点未枚举 · M2 机制未确证 · 绝对帧率不可跨环境迁移（用户环境 5120×2880@DPR2 / 42.4 Hz 掉帧 27.2%，本线窗口 2560×1440@DPR2 / 60 Hz）· Gecko 未测 · 「用 JS 4 步离散更新替代 SVG opacity 无限动画」的 M1 变体未实装未实测 · 环带+M1 叠加未单独测。

---

## 9. 一句话回答（复述，便于直接回用户）

> **这个遮罩的 blur 能保留。**
> DSH 全树只有 **7 个模糊载体**，其中 **5 个是 A 类（背后有东西在持续重绘，所以会卡）**，**根因是同一个**：铺满视口的 `backdrop-filter` + 背后持续重绘。
> **保住观感的两招（实测）**：**M2 环带**（缩掉面板背后那块，实测 `>33ms` **90.2% → 9.7%**；**观感不可辨**：差 **0.0272% >2/255、max 7/255**，NULL CONTROL 全 0；**但当背后是一整块铺满视口在动的层时无效**，实测 99.0%→100%）与 **M1 掐驱动**（只暂停真正在抖的那条源，实测 **90.2% → 3.4%**、**100% → 0.0%**，**任何配置都有效**，代价是该动画静止；且**不必停 spinner**）。
> **不要做**：降半径（0.5px 实测仍 93.9%，纯亏）、放慢动画（实测仍 100%）、以及把模糊删掉（能解决但会失去 §5.5 列出的 5 处 UI 的毛玻璃，只能当应急兜底）。
> **M3（背景提层）我实测了，基本无效**——唯一有效的形状不能迁移到 DSH 真实的 SVG `opacity` 驱动（37.5%→36.1%）。
