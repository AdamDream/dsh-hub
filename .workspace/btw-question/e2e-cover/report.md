# notebook §8 第 11 条「四项未覆盖」真机补测报告（T1–T4）

- **档位**：实测档（工作目录 `/home/CNS2026495165/dsh`），沙箱继承 `workspace-write`，全程**未使用** `sandbox_permissions`。
- **唯一写入面**：`.workspace/btw-question/e2e-cover/`（脚本 / JSON / 截图 / 本报告）。
- **只读读取**：`~/.dsh/sessions/**/session.jsonl.zstd`（`zstd -dc` 管道读取，未修改）。
- **未做**：未改 `dsh-btw/**`、`docs/**`、`FEATURE-MAP.md`、`.gitignore`、`~/.dsh/**`；未重启 dsh、未 kill 进程、无 git 写操作。
- **时间**：2026-09-23 18:40–18:49（UTC+8）。
- ⚠️ **并发写入披露（非本档所为）**：硬边界核查用 `find … -newermt 18:35` 发现 `docs/program-notebook.md`(18:42:55)、`docs/runbooks/verify-runbook.md`(18:43:05)、`docs/architecture/05-performance-and-ux-program.md`(18:41:33)、`FEATURE-MAP.md`(18:41:57) 在**本档运行时间窗内**发生过 mtime 变动。本档对 `docs/**` 与 `FEATURE-MAP.md` **只做过 `grep`/`read`（只读），从未 `write`/`edit`**，全部写入（51 个文件，含 2 个隐藏标记 `.run-start*`）都在 `.workspace/btw-question/e2e-cover/` 内；环境内同时存在多个 dsh 进程（实测 6 个）⇒ 上述改动应为**其它并发会话**所为。`dsh-btw/**` 与 `.gitignore` 在本时间窗内**无**任何变动。

---

## 0. 被测版本取证（证明测的是「刚部署的新版」）

| 项 | 实测值 | 取证方式 |
|---|---|---|
| 客户端 btw bundle rev | `887a12106dcd` | 页面内 `__DSH_BOOT__.entries` 取 `@local/dsh-btw` 条目 |
| 页面**实际加载**的 btw URL | `http://127.0.0.1:3080/plugins/@local/dsh-btw/client.js?rev=887a12106dcd`，**HTTP 200** | Playwright `page.on('response')` 抓取（非推断） |
| btw `client.js` md5 | `66beb3455c59f4991355f3918228e495` | `curl` 落地后 `md5sum`，两次独立请求一致 |
| 字节数 | `365 269 B` | 同上 |
| 缓存头 | `cache-control: no-cache` | `curl -D -` |
| boot payload rev | `__DSH_BOOT__.rev = 8d29bd300494` | 页面内读取 |
| browser context | **全新 context**（不复用 profile/缓存），`locale=zh-CN，viewport=1440×900` | 每次 `chromium.launch` + `newContext` |
| Chromium 版本 | `131.0.6778.33`（主 run 记录；T4b / T3-probe 两个脚本未记录该字段） | `browser.version()` |
| `pageerror` | **0**（四轮全部：主 run / T4b / T3-probe / T4-enter） | `page.on('pageerror')` |
| `console` warning/error | **0**（**仅主 run 挂了 `page.on('console')` 监听**；T4b 与 T3-probe 未挂该监听 ⇒ 这两轮「无 console 记录」**不构成**无告警的证据） | `page.on('console')` |

> ⚠️ **范围声明**：宿主侧 `index.js` 新版**尚未生效**（本轮不重启，用户已裁决）。四项补测**全部是客户端面**，故本报告**不构成**对宿主新代码的任何验证结论。

脚本（全部落在允许写入面内）：
- `cover-driver.mjs` —— 主驱动，T1→T2→T4→T3 单会话串行。
- `t4-keyboard-compare.mjs` —— T4 修正轮（多选 checkbox 取消勾选）+ **官方卡片同组键盘行为实测对照**。
- `t4-enter-probe.mjs` —— T4 补尾（Enter 键切换 / 是否误提交 / Shift+Tab 差异）。
- `t3-geometry-probe.mjs` —— T3 追加几何取证（判断「停止/输入框不在视口」的归属与成因）。

---

## 1. 逐项裁决

| 项 | 裁决 | 一句话依据 |
|---|---|---|
| **T1｜真实 GUI 多选交互（含真正提交）** | **PASS** | 不给键名即得 `role=group` + 3×`role=checkbox`；点 1、2 后 **59/59 采样全程 true（2 967 ms）**；勾徽标 0→1 且 50 ms×3 s 后仍 1；「发送回答」后卡片 1 ms 内消失，宿主日志收到 `selected:["咖啡","茶"]` 且子代理继续 |
| **T2｜「回答后再提问」重挂** | **PASS** | 第二张卡 2 选项**全 `aria-checked=false`** + 自定义框 `value=""`；header/题干/选项与第一题全不同；重挂后点选 **59/59（2 974 ms）**；宿主日志 `questionId: drinks → time_slot` |
| **T3｜窄屏 <720 px bottom-sheet 选项行** | **PASS（选项行本体）＋ 1 项如实限定** | 640×800 下 `data-placement-mode="bottom-sheet"`（2 ms 内由 `right` 切换）；选项行 bbox 完全落在视口内；点选 **59/59（2 963 ms）**、普通点击未被 scrim 吞；「发送回答」`elementFromPoint` 命中自身且真实点击成功；**但「停止」控件中心点在视口外**（见 §2.4） |
| **T4｜选项行键盘导航与焦点序** | **PASS（修正口径后）** | 首轮在**单选 radio** 上按「再按 Space 可取消」判定为 FAIL —— **该期望本身错**（radio 语义下不可取消，官方同款）；改用**多选 checkbox** 复测：Space→true（59/59，2 971 ms）、再 Space→**false（0/59，2 959 ms）**、第三次→true；`Enter` 键同样可来回切换且**未误提交**卡片；方向键全程无效（与官方实测一致） |

首轮 T4 的 FAIL 与修正，见 §3「T4 判定口径更正」。

---

## 2. 逐项原始证据

### 2.1 T1｜真实 GUI 多选交互（`raw-…-T1.json`、run `2026-09-23T10-40-44-836Z`）

**提示词刻意不给键名**（第 1 次即成功，**无需重试**；`attempts[0].promptKind = "no-keyname"`）：

> 请立刻调用 btw_ask_user 工具向我提一个问题：我希望可以同时勾选多个选项（多选，允许一次选中好几个），给出 3 个选项。header 写「饮品」，问题写「你想喝哪几种？」…（未出现任何键名）

**宿主侧「子代理自发写了什么参数」**（只读宿主会话日志，见 §4）：

```json
{"questions":[{"id":"drinks","header":"饮品","question":"你想喝哪几种？",
  "multi_select":true,"options":[{"label":"咖啡"},{"label":"茶"},{"label":"果汁"}]}]}
```

⇒ **实测复证既有事实**：不给键名时子代理自发写出**合法** `multi_select: true`（snake_case，未踩 D30 的 `multiSelect` 陷阱）。

**断言①卡出现 + 选项行 `role=checkbox`（不是 radio）——PASS**

```
cardFound=true  optionCount=3  optionsWrapRole="group"
roles=["checkbox","checkbox","checkbox"]  labels=["咖啡","茶","果汁"]
```

**断言②点第 1、2 项后两个 `aria-checked=true` 且 50 ms×3 s 全程保持 —— PASS**

```
ticks=59  allOnTicks=59  ratio=59/59  allOnAllTicks=true  firstOffAtMs=null
observedMs=2967   firstTick=lastTick=[{咖啡:true},{茶:true},{果汁:false}]
```
（`sampleMs=50`，即与 D29 同口径的持久化判据；**零翻回**。）

**断言③复选框勾图标/徽标随选中出现 —— PASS**

| 选项 | `checkSvgCount`（前→后） | `questionOptionCheckChecked`（前→后） | `::before` background（前→后） |
|---|---|---|---|
| 咖啡 | 0 → **1** | false → **true** | `rgba(0,0,0,0)` → **`rgb(15,17,21)`** |
| 茶 | 0 → **1** | false → **true** | `rgba(0,0,0,0)` → **`rgb(15,17,21)`** |
| 果汁 | 0 → 0 | false → false | `rgba(0,0,0,0)` → `rgba(0,0,0,0)` |

视觉复核（元素级裁切，识图逐字）：未选时三行均为「空心圆角方框徽标」；选中后第 1、2 行变为**实心近黑方框 + 白色对勾**，第 3 行仍为空心；行底色同时变浅灰。另可见组内提示文案 **「可多选」**。

**断言④点「发送回答」后卡片消失、子代理继续（本轮真正提交）—— PASS**

```
submitButton = {text:"发送回答", disabled:false, box:{x:1010,y:709,w:388,h:28}}
submitClickOk=true   cardGone=true   cardGoneAfterMs=1   transcriptChangedAfterSubmit=true
```

**提交后的答案内容（宿主侧逐字，权威于 DOM）**：

```json
{"answers":[{"id":"drinks","selected":["咖啡","茶"]}]}
```

⇒ 与 UI 上勾选的两项**逐字一致**；随后子代理在 `turn 1 step 2` 继续产出 assistant 消息（宿主日志实测），并在 T2 抛出第二个问题 ⇒「提交答案 → 子代理继续」链路**走通**。

截图：`fullpage-…-T1-1-card-appeared.png`、`fullpage-…-T1-2-after-click-hold.png`、`fullpage-…-T1-3-after-submit.png`；元素级 `…-T1-1-options-crop.png`（5 090 B）、`…-T1-2-options-selected-crop.png`（5 508 B）。

---

### 2.2 T2｜「回答后再提问」重挂（`raw-…-T2.json`）

**断言①新卡草稿全空 —— PASS**

```
optionCount=2   ariaChecked=["false","false"]   selectedClass=[false,false]
customInputs=[{ariaLabel:"自定义回答", placeholder:"输入你自己的回答…", value:""}]
uuidAttrsInCard=[]      ← 卡片 DOM 内不存在任何 UUID 属性
```

**断言②题干/选项与第一题不同 —— PASS**

| | 第一题 | 第二题 |
|---|---|---|
| header | 饮品 | **时间** |
| question | 你想喝哪几种？ | **你什么时候有空？** |
| options | 咖啡 / 茶 / 果汁 | **上午 / 下午** |

⇒ `diffHeader=diffQuestion=diffLabels=true`，证明是**新一轮**而非残留。宿主侧同样确认 questionId 变化：

```json
{"questions":[{"header":"时间","id":"time_slot","multi_select":false,
  "options":[{"label":"上午"},{"label":"下午"}],"question":"你什么时候有空？"}]}
```

**断言③重挂后点选并 50 ms×3 s 保持 —— PASS**

```
clicked 选项 index=1（下午）
ticks=59  allOnTicks=59  ratio=59/59  observedMs=2974
firstTick=[{上午:false},{下午:true}]   lastTick 相同
```

**关于「重挂」的可观察等价物**：React 内部 remount 不可直接观测，且 **`questionId` 在 DOM 中不可取**（实测 `uuidAttrs=[]`，卡片只渲染 `className`/`aria-label`，React key 不落 DOM）。故本轮采用**双等价物**：① UI 侧草稿清零（全 false + 自定义框为空）；② 宿主侧 `questionId` 由 `drinks` **变化**为 `time_slot`（host 每次 `randomUUID()` 生成 id 由子代理自己的工具参数携带，此处恰为模型自选的可读 id，仍能证明是新一轮）。

截图：`fullpage-…-T2-1-second-card-fresh.png`、`fullpage-…-T2-2-after-click-hold.png`；`…-T2-1-options-fresh-crop.png`（2 519 B）、`…-T2-2-options-selected-crop.png`（2 704 B）。

---

### 2.3 T3｜窄屏 640×800 bottom-sheet 选项行（`raw-…-T3.json`）

**断言①bottom-sheet 分支 —— PASS**

```
resize 前：placement.mode="right"（box 0,0,1440×900），scrim display:none
resize 后：placement.mode="bottom-sheet"（box 0,0,640×800），等待 2 ms
scrim: display=block, pointer-events=auto, box=(0,0,640×800)  ← 覆盖整个视口
surfaceMode="drawer"   matchMedia('(width<=720px)')=true   '(width<=719.98px)'=true
resize handle: width/height/corner 三者 display:none（符合 @media width<=719.98px）
```

属性名以实测为准：放置在**放置根** `[data-dsh-btw-root]` 的 `data-placement-mode` 上（不是抽屉根 `[data-side-chat-surface-mode]`）。

**断言②卡片可见且未被裁剪 —— PASS（需先把卡片滚入视野）**

```
cardBox = {x:83, y:470, w:530, h:263, right:613, bottom:733}   viewport 640×800
选项行1 {x:98, y:559, w:500, h:40, right:598, bottom:599}
选项行2 {x:98, y:605, w:500, h:40, right:598, bottom:645}
fullyInsideViewport=true   allVisibleAreaGt0=true
```
两行 bbox 完全落在视口内（x 98–598 ⊂ 0–640；y 559–645 ⊂ 0–800），可见面积 >0。

> **限定（实测）**：该结论是在 `card.scrollIntoView({block:'center'})` 之后取得的。**不做滚动时卡片会溢出视口下沿**——独立复现见 §2.4。

**断言③点选后 50 ms×3 s 保持 true —— PASS**

```
targetIndex=1（下午，点击前 checked=false）
clickMethod="normal"（未使用 force，即 Playwright 全套可操作性/命中检查通过）
ticks=59  allOnTicks=59  ratio=59/59  observedMs=2963
```

**断言④该模式下控件可命中、未被 scrim 吞掉 —— 部分 PASS（如实拆分）**

| 控件 | `elementFromPoint` 命中 | 是否被 scrim 吞 | 结论 |
|---|---|---|---|
| 「发送回答」 | `BUTTON`（`_button_kz6gm_4 _primary_kz6gm_38`），`isSelf=true` | **否**（`isScrim=false`） | **PASS**，且 Playwright 真实点击成功（`realClickOnSubmit="ok"`，提交后 `cardCount=0`） |
| 选项行 | `SPAN`（选项行内部元素），`isSelf=true` | **否** | **PASS** |
| 「停止」 | **`null`** —— 中心点不在视口内 | 否 | **不成立**，但成因是**布局溢出**而非 scrim（见 §2.4） |

截图：`fullpage-…-T3-1-bottom-sheet-640x800.png`（181 KB，整页）、`fullpage-…-T3-3-final.png`；元素级 `…-T3-1-options-crop-640x800.png`（3 261 B）、`…-T3-2-options-selected-crop.png`（2 755 B）。

**640×800 整页识图复核逐字**：底部为浅色 bottom-sheet（x≈76–604, y≈465–780）；可见「侧边助手正在向你提问」「时间 / 你什么时候有空？」「1 上午」「2 下午」「输入你自己的回答…」「发送回答」；卡片下沿 ≈780，**全部控件在框内**；背景有轻微压暗（scrim `#0507088a`，非重遮罩）。

---

### 2.4 T3 追加几何取证：`停止`/抽屉输入框为何「不可命中」（`raw-…-T3-extra.json`）

用独立会话（`t3-geometry-probe.mjs`）复现并定位归属：

**640×800 / bottom-sheet（未把卡片滚入视野）**

```
drawer  #dsh-btw-drawer      box {x:68, y:416, w:560, h:372, bottom:788}   clientH=370  scrollH=633  ← 内容高 633 > 容器 370
transcript .SalQ5q_transcript box {y:596..650}  clientHeight=54  scrollHeight=183   ← 只有 54 px 滚动窗
card     section.questionCard box {x:83, y:650, h:263, bottom:913}   ← 已越过抽屉下沿 788、越出视口 800
submit   BUTTON「发送回答」    box {y:872..900}  centerInViewport=false  elementFromPoint=null
composer TEXTAREA             box {y:962..1010} centerInViewport=false  elementFromPoint=null
stop     BUTTON「停止」        box {y:980..1010} centerInViewport=false  elementFromPoint=null
```
DOM 归属全部确认在 `#dsh-btw-drawer` 内（链路：`BUTTON.SalQ5q_sendButton < DIV.SalQ5q_composer < FOOTER.SalQ5q_composerArea < DIV.SalQ5q_surface < ASIDE#dsh-btw-drawer < DIV.SalQ5q_placementRoot < … < #root`），**不是**主会话的控件，也**不是**被 scrim 遮挡（scrim 是 `placementRoot` 的**前一个兄弟**，抽屉在其之上）。

**1440×900 / "right"（同一会话同一卡片，对照）**

```
drawer   {y:12..888}   card {y:487..750}   submit {y:709..737}   composer {y:799..847}   stop {y:817..847}
全部 centerInViewport=true 且 elementFromPoint 命中自身
```

**结论（如实）**：在 640×800 的 bottom-sheet 分支下，放置引擎给出的**底部泳道高度仅 372 px**，而抽屉自身内容（header 34 + transcript + 卡片 263 + composer ≈120）需要 ≈633 px ⇒ 内容列溢出容器下沿，**问答卡片与 composer 页脚（输入框/停止/发送）被推到视口之外**；transcript 只剩 ~54 px 的滚动窗，必须滚动才能看到完整卡片。两次独立会话（主 run 与 probe run）都得到 **372 px** 泳道，可复现。整页识图亦确认：不滚动时卡片在 640×800 下沿被裁掉、「发送回答」不出现在画面内。

> 这不是「scrim 吞点击」，而是一个**独立的窄屏布局限制**。它超出本次四项的字面范围，但落在 T3 的同一分支上，故如实登记（**是否修由用户裁决**）。本轮**未**扫描其它窄屏尺寸，也未判定该限制的边界。

---

### 2.5 T4｜选项行键盘导航与焦点序

#### 首轮（`raw-…-T4.json`，在**单选 radio** 卡片上）

**① 焦点序（Tab/Shift+Tab 到第一个选项行）—— PASS**

锚点实况：**抽屉输入框在待答状态下 `disabled=true`**（`composerProbe={disabled:true}`），DOM `.focus()` 对其无效 ⇒ **spec 指定的锚点在待答状态下不可构造**（卡存在 ⇔ 侧聊 `running` ⇒ composer 被 `disabled`）。按预案回退为「`#dsh-btw-drawer` 内第一个可聚焦元素」，得到**超集**焦点序（8 步抵达第一个选项行）：

| 步 | 元素 | role / aria-label | 在选项行内 |
|---|---|---|---|
| 0 | `DIV` | separator / 调整 btw 宽度 | 否 |
| 1 | `DIV` | separator / 调整 btw 高度 | 否 |
| 2 | `BUTTON` `SalQ5q_jumpToggle` | — / 「▸跳转到其他 btw」 | 否 |
| 3 | `SELECT` `SalQ5q_modelSelect` | — / 「模型」 | 否 |
| 4 | `BUTTON` `SalQ5q_endButton` | — / 「结束 btw」 | 否 |
| 5 | `BUTTON` `SalQ5q_iconButton` | — / 「收起 btw」 | 否 |
| 6 | `DIV[role=button]` `SalQ5q_toolRowRow` | button / — （`btw_ask_user` 工具行） | 否 |
| 7 | `DIV[role=button]` `SalQ5q_toolRowRow` | button / — （`btw_ask_user` 运行中…） | 否 |
| **8** | **`BUTTON` `SalQ5q_questionOption`** | **radio / 「1上午」** | **是** |

⇒ 选项行**键盘可达**（原生 `<button>`），且工具行本身也是 `tabIndex` 可聚焦项（`DIV[role=button]`）。

**② 焦点在选项行按 Space ⇒ `aria-checked=true` 且 3 s 保持 —— PASS**

```
focusedIndex=0  聚焦前 {上午:false}  按 Space 后 58/58 ticks true（observedMs=2950）
```

**③ 再按 Space「可再次切换」—— 首轮判为 FAIL（**判定口径错**，见 §3）**

```
按 Space #2 后：上午 仍为 true（58/58 → 未翻回）
```

**④ `ArrowDown`/`ArrowUp` —— PASS（不改变选中/焦点）**

```
activeIndexBefore=0 → afterDown=0 → afterUp=0；选中态 checksSame=true
roving tabindex 证据：两条选项行 tabIndex=0、hasTabindexAttr=false（无 roving tabindex）
```

#### 修正轮（`raw-…-T4b.json`）：多选 checkbox 的「真·切换」+ 官方实测对照

**A. 官方卡片（单选框，主会话 `ask_user_question`）—— PASS**

```
containerRole="radiogroup"   options: [{label:继续, role:radio, tabIndex:0, hasTabindexAttr:false},
                                       {label:停止, role:radio, tabIndex:0, hasTabindexAttr:false}]
锚点=卡片内第一个可聚焦元素（BUTTON「收起问题卡片」）→ Tab **2 步**抵达第一个选项行
Space #1  → 继续 true，59/59（observedMs=2980）
Space #2  → 继续 **仍为 true**（radio 不可取消）
ArrowDown/Up → activeIndex 0→0→0，选中态不变（arrows_noop=true）
```

**B. btw 多选卡片（复选框）—— PASS**

```
header「配料」/「你要加哪几种？」  containerRole="group"
options: 香菜/葱花/辣椒，role=checkbox ×3，tabIndex=0、hasTabindexAttr=false
composerDisabled=true（同首轮） → 锚点回退抽屉内第一个可聚焦元素 → Tab **6 步**抵达第一个选项行
Space #1 → 香菜 true，59/59（observedMs=2971）
Space #2 → 香菜 **false，0/59（observedMs=2959）**   ← 真正的「可再次切换」
Space #3 → 香菜 **true**
ArrowDown/Up → activeIndex 0→0→0，checksSame=true
```

截图：`fullpage-…-T4b-A1-official-card.png` / `…-T4b-A2-official-after-keys.png`（+ 两个官方卡片裁切 44/45 KB）；`fullpage-…-T4b-B1-btw-multi-card.png` / `…-T4b-B2-btw-after-keys.png`（+ 两个选项行裁切 6 KB）。

#### 补尾（`raw-…-T4-enter.json`）：`Enter` 键（spec「Space（或 Enter）」的另一半）—— PASS

多选卡（`containerRole="group"`，选项 盐/糖，`role=checkbox`），锚点回退后 Tab **6 步**抵达第一个选项行（与 T4b-B 的 6 步一致，两轮独立复现）：

```
beforeEnter  = [盐:false, 糖:false]
Enter #1     → [盐:true,  糖:false]   焦点仍在选项行（BUTTON「盐」，optionIndex=0）
Enter #2     → [盐:false, 糖:false]   ← Enter 亦可来回切换
卡片数：before=1, afterEnter=1, afterEnter2=1   ← Enter **未误提交**整张卡片
pageerror=0
```

附加测量（**与首轮焦点序方向不完全镜像，成因未确证**）：从选项行按 `Shift+Tab` 落到的是 `BUTTON「—」`（`SalQ5q_iconButton`，「收起 btw」），而非首轮正向序列里的 tool row。**假设**（未验证）：问答卡片是 transcript **之后的兄弟节点**（T3 几何实测：transcript box `y:596..650`、card box `y:650..913`，卡在 transcript 容器之外），故反向退格应落到 transcript 内最后一个可聚焦项；该 run 里运行中的 tool row 可能不可聚焦，遂继续退到 header 控件。**如实登记为「已观测差异，未定因」。**

截图：`fullpage-…-T4e-1-after-enter.png`、`fullpage-…-T4e-2-after-shifttab.png`。

---

## 3. T4 判定口径更正（为什么首轮 FAIL 不是 btw 缺陷）

读源（**只读**，未改动）证明「单选卡再按一次不取消」是 **radio 语义 + 官方同款**：

- btw 自绘 `toggle()`：`if (!multiSelect) selected.clear(); if (selected.has(label)) delete else add`
  ⇒ `clear()` 之后 `has(label)` 恒为 `false` ⇒ 必然重新 `add` ⇒ **单选选项不可取消**。
- 官方 `dsh-client-ui-user-questions/lib/client.js:387` `choose()` 单选分支：`return { selected: [label], custom: "", skipped: false }`
  ⇒ 同样恒选中、**不可取消**。

⇒ 首轮 T4 的期望值「再按 Space 应翻回 false」本身**与 radio 语义不符**；在多选勾选框上复测才成立（已复测，**PASS**）。
**T4 最终裁决 = PASS**；上述 FAIL 作为「判定口径更正记录」保留，不计为 btw 缺陷。

**与官方行为逐项对照（均为本轮真机实测，非读码推断）**

| 维度 | 官方卡片（实测） | btw 卡片（实测） | 一致性 |
|---|---|---|---|
| 容器 role | 单选 `radiogroup` | 单选 `radiogroup` / 多选 `group` | ✅ 同构 |
| 选项行 | 原生 `button[role=radio\|checkbox][aria-checked]` | 同 | ✅ |
| roving tabindex | 无（`tabIndex=0`，无 `tabindex` 属性） | 无（同） | ✅ 同为 APG 偏差 |
| 方向键 | 不改变选中/焦点 | 不改变选中/焦点 | ✅ 同款偏差 |
| Space 选中 | 生效（59/59） | 生效（59/59） | ✅ |
| Space 再按（radio） | **不取消** | **不取消** | ✅ |
| Space 再按（checkbox） | 未测官方多选 | **取消（0/59）→ 再选回** | —（btw 侧已证） |
| 选项行键盘可达 | 是（2 步） | 是（6 步；锚点回退后） | ✅ |

---

## 4. 宿主侧只读取证（答案内容，权威于 DOM）

- **文件**：`~/.dsh/sessions/--home-CNS2026495165-MCU--/25d1bea5-c31e-4993-b0fd-595c1543c6dd/session.jsonl.zstd`
- **会话元数据**：`origin="subagent"`，`delegationDepth=1`，`cwd="/home/CNS2026495165/MCU"`，`createdAt=1790160053447`（= 本 run 打开抽屉时刻 18:40:53）
- **读取方式**：`zstd -dc` 管道进 `node`，**只读**，未写回、未改动。

| 事件 | 逐字内容 |
|---|---|
| `tool/call` seq=21 `btw_ask_user` | `{"questions":[{"id":"drinks","header":"饮品","question":"你想喝哪几种？","multi_select":true,"options":[{"label":"咖啡"},{"label":"茶"},{"label":"果汁"}]}]}` |
| `tool/result` seq=23（isError=false） | `{"answers":[{"id":"drinks","selected":["咖啡","茶"]}]}` |
| `tool/call` seq=36 `btw_ask_user` | `{"questions":[{"header":"时间","id":"time_slot","multi_select":false,"options":[{"label":"上午"},{"label":"下午"}],"question":"你什么时候有空？"}]}` |
| `tool/result` seq=37（isError=false） | `{"answers":[{"id":"time_slot","selected":["下午"]}]}` |
| `assistant/message` seq=27（turn1 step2，**在 result 之后**） | 「…Now the answer came back: 咖啡, 茶…」⇒ **子代理在收到答案后继续** |
| `assistant/message` seq=40（turn2 step2） | 「好的——单选结果：**下午**。」 |

⇒ 「**提交答案 → 子代理继续 → 再提问**」整条链路在宿主侧**闭环可证**（不依赖 UI 推断）。

---

## 5. 交付物清单（全部位于 `.workspace/btw-question/e2e-cover/`）

**脚本**：`cover-driver.mjs`（45 035 B）、`t4-keyboard-compare.mjs`（19 297 B）、`t4-enter-probe.mjs`（7 255 B）、`t3-geometry-probe.mjs`（8 161 B）
**运行日志**：`run.log`（首个失败 run）、`run2.log`（主 run）、`run3.log`（T4 修正轮）、`.run-start` / `.run-start2`

**原始 JSON（含时间戳 + 采样数组 + 逐项判定）**

| 文件 | 内容 | 大小 |
|---|---|---|
| `raw-2026-09-23T10-40-17-467Z.json` | **失败 run**（脚本 bug：`page.evaluate` 闭包引用 Node 侧常量 `BTN_ANSWER`） | 1 210 B |
| `raw-2026-09-23T10-40-44-836Z.json` | **主 run**（T1+T2+T4+T3 合并；含 `consoleMessages`/`pageErrors`/`resourceUrls`） | 147 125 B |
| `raw-…-T1.json` / `-T2.json` / `-T3.json` / `-T4.json` | 分项切片 | 39/24/23/31 KB |
| `raw-2026-09-23T10-44-10-837Z-T4b.json` | T4 修正轮 + 官方对照（含 2×2 组 59 tick 采样） | 125 414 B |
| `raw-2026-09-23T10-45-10-835Z-T3-extra.json` | T3 几何取证（1440×900 vs 640×800 vs 滚动后） | 27 304 B |
| `raw-2026-09-23T10-49-34-289Z-T4-enter.json` | T4 补尾：Enter 键切换 + 未误提交 + Shift+Tab 差异 | 2 036 B |

**元素级裁切截图（小体积，11 张）**：`…-T1-1-options-crop.png`(5 090)、`…-T1-2-options-selected-crop.png`(5 508)、`…-T2-1-options-fresh-crop.png`(2 519)、`…-T2-2-options-selected-crop.png`(2 704)、`…-T3-1-options-crop-640x800.png`(3 261)、`…-T3-2-options-selected-crop.png`(2 755)、`…-T4-1-options-crop.png`(3 258)、`…-T4b-A1-official-card-crop.png`(44 317)、`…-T4b-A2-official-after-keys-crop.png`(45 573)、`…-T4b-B1-btw-multi-options-crop.png`(6 039)、`…-T4b-B2-btw-after-keys-crop.png`(6 741)

**整页截图（大体积，统一 `fullpage-` 前缀，21 张）**：T1×3、T2×2、T3×3、T4×3、T4b×4、T4e×2、T3x×3（含 `T3x-640x800` 展示卡片被裁、`T3x-640x800-scrolled`、`T3x-1440x900` 对照）、首轮失败 ERROR 帧×1。

> 目录合计 **49 个文件 / 12 MB**（11 张小裁切 + 21 张整页 + 9 个 JSON + 4 个脚本 + 日志/标记）。后续按体积剔除时：`fullpage-*.png` 全部为大体积整页，可整组清理。

**临时 GUI 会话**：全部**保留未删**（MCU 工作区，`~/.dsh/sessions/--home-CNS2026495165-MCU--/`），含主 run 父会话 + btw 子会话 `25d1bea5-…`、T4b 两段会话、T3-exta 一段会话；首个失败 run 的会话亦保留。

---

## 6. 仍未覆盖 / 无法判定（诚实清单）

1. **React 内部「重挂」机制本身不可观测**。T2 只能给**可观察等价物**：草稿清零（全 `aria-checked=false` + 自定义框 `value=""`）+ 宿主侧 `questionId` 变化（`drinks` → `time_slot`）。**DOM 内无 questionId**（实测 `uuidAttrs=[]`），故无法从 DOM 直接读到 questionId。
2. **「从抽屉输入框开始」的焦点锚点在待答状态下不可构造**：`textarea` `disabled=true`（实测，卡存在 ⇔ 侧聊 running）。T4 的焦点序锚点**回退**为「抽屉内第一个可聚焦元素」，得到的是**超集序列**（会经过 header 控件与两条 tool row）。⇒ 严格意义上的「从输入框起算的 Tab 距离」**未测得**。
3. **「停止」控件在 640×800 下不可命中**，成因是抽屉内容溢出视口（§2.4），**不是** scrim 吞点击。未测该现象在其它窄屏尺寸/高度下是否复现，也未测「滚动抽屉内部容器能否把 composer 带回视口」（probe 里对 `#dsh-btw-drawer` 内所有可滚动元素滚到底后，card/composer 仍在视口外）。
4. **窄屏只测了 640×800 一档**。未扫 719.98/720 边界行为，未测更窄（如 390×844）与横屏，也未测 `data-placement-degraded`（本轮恒为 `null`）。
5. **官方多选（checkbox）卡片未做真机对照**：官方对照只跑了单选 radio（因官方 `ask_user_question` 的多选入参键名未在本轮确证，避免引入 D30 类 schema 风险）。故「checkbox 再按取消」的一致性只有 **btw 侧实测 + 双方读源对照**，缺官方真机同项。
6. **反向焦点路径（Shift+Tab）与正向不镜像，成因未确证**：从选项行反向退格落到「收起 btw」header 按钮，而非首轮正向序列中的 tool row（假设：卡片是 transcript 之后的兄弟节点 + 该 run 中运行态 tool row 不可聚焦；**未做定向验证**，故只登记差异）。
7. **未测自绘卡片的 `aria-label` 缺失影响**：btw 选项按钮无 `aria-label`（官方有 `aria-label=display.label`），实测 T4b-B 的 `focusAfterDown.ariaLabel=null`；本轮只记录事实，未做 SR（屏幕阅读器）语义判定。
8. **D30 的实际后果未测**（本轮范围外，登记在 notebook §7 的 D30 行）。本轮反而**顺带**复证了合法 `multi_select:true` 路径正常（子代理自发写对键名，卡片正常出现，0 条 btw warn）。
9. **宿主侧新代码未验证**：本轮不重启，`index.js` 新版未生效；报告只覆盖客户端面。
10. **重试记录**：T1/T2/T4b/T3 的提问与官方提问**全部第 1 次提示即成功**，未触发任何重试分支（`attempts` 数组均为单元素）；唯一失败是**首轮 run 的脚本自身 bug**（`page.evaluate` 内引用 Node 侧常量 `BTN_ANSWER` → `ReferenceError`），已修并重跑，原始失败 JSON 保留。首轮 T4 的 FAIL 是**判定口径错**（非重试）。
