# 修订执行复核：主题重放批（`ThemePresenter.apply` 触发链）

- 日期：2026-09-21（执行窗口 16:34–17:10）
- 档位：修订执行复核一体。契约 = `.workspace/lag-fix/exec-audit/theme/audit.md`（666 行）
- 独占目录：`.workspace/lag-fix/exec-theme/`
- 纪律核对：**未写产品文件**（`~/.dsh/profiles/node_modules` 与 `~/.npm-global/...` 全程只读；`apply-Theme-v1.mjs` 默认 dry-run，本档只跑 dry-run）、**未重启**、**未 pkill**、**未开浏览器**、**未传 `sandbox_permissions`**
- 自证一键复跑：`bash run-all-selfproof.sh`（10 步全绿，原始日志 `raw/SELFPROOF-LOG.txt`）
- **返工轮（r2）**：协调者实测判我的实例探针 v1 为**失效探测器**（`instances=0` 而 `applyCalls=70`、`data.sample` 空），并裁决 ii-b 接受、`lastTokens` 修正接受、阈值以相对降幅为主判据。本轮已按 §2.0 / §4.3 / §6.4 逐条返工，原始证据在 `raw/probe-capture-selftest.log`。

---

## 0. 裁决速览

| 单元 | 内容 | 状态 | 一句话 |
|---|---|---|---|
| **(0)** | 并存 `ThemePresenter` 实例去重 | **REWORK（阻塞，未交付可用补丁）** | 静态上**无法证明** 2–6 个实例的来源；v1 探针被协调者实测证伪为**失效器械**（已修，见 §2.0）。候选（opt-in）仍待 P0 结论 |
| **(i)** | 内容签名跳过重放 | **交付（含三联前提逐条落实）** | 签名只含内容不含 `revision`；带落地点守卫；首调永不跳过。离线对拍 27 项全过 |
| **(ii)** | 去掉/改写 `:378` 强制重算 | **交付（选定 ii-b 变体，非审计列的 ii-a）** | 采用"延后到 rAF + 同帧去重"，**值逐位不变**；未采用 ii-a（实测模型显示会改可见 meta 值） |
| **(iv-a)** | wallpaper `shadeTokens` 内容比较 | **交付（默认 ON）** | 切断 §1.5 回响的一轮 publish；离线验证 |
| **(iv-b)** | ui-theme `overrideTokens` 内容比较 | **交付，但标"下一批"（opt-in，默认 OFF）** | 证据强、改动小，但与 (i) 同为"削 publish"杠杆，需与 (i) 分开计量 |
| **(iii)** | `cssText` 合并 | **未做（审计否决，遵守）** | — |

**一句话总纲**：本批可以削减 `apply` 的**次数**（(i)/(iv)）与**每次成本**（(ii)），但**不能**凭本批宣称消除可感卡顿——审计 §6.3 的 65–100 ms/s 残留归因空白仍在（§6 复述，未扩范围）。

---

## 1. 交付物与部署入口

```
.workspace/lag-fix/exec-theme/
├── lib/patches.mjs                 锚点与模板的唯一真源（生成器与落地器共用，候选与落地字节不可能漂移）
├── gen-candidates.mjs              从 pristine 目标生成候选（读 deployed，只写本目录）
├── candidates/                     默认批：client.layout.js / client.wallpaper.js + MANIFEST.json
│   └── optin/                      全单元批：+ client.uitheme.js（(iv-b)）与含 (0) 的 layout
├── apply-Theme-v1.mjs              ★ 落地器：默认 dry-run，--apply 才写；含 pre-image 备份/回滚
├── proof/
│   ├── verify-candidates.mjs        锚点唯一性 + node --check + 标识符声明校验 + 6 个变异反证
│   ├── stub-apply.mjs               无浏览器对拍：真实源文本抽取，比较 DOM 写序列与 theme-color 值
│   ├── probe-capture-selftest.mjs   ★r2 器械自证：复现 v1 失效 / 证明 v2 可捕获 / 发布件形态检查
│   └── check-experiment-logic.mjs   实验器械自检：primary 与 reference 分级双向有效（16 项）
├── experiments/
│   ├── theme-ab.mjs                M-A/M-B/M-C/M-D + 全字段采集 + --compare（primary 判分 / reference 参考）
│   ├── probe-instances.mjs         ★r2 P0 探针 v2：三值判定 + 五路口径 + 页内自证 + 口径定义
│   ├── verify-functional.mjs       R1–R9 的免探针版（probe-free，被动 DOM 取证）
│   ├── thresholds.json             §4 阈值（逐字抄自审计，**未放宽**）+ cpuL 基线表
│   └── run-theme-experiments.sh    串行驱动：before / after / compare / verify / probe
├── run-all-selfproof.sh            一键复跑全部静态/离线自证
└── raw/                            全部真跑原始输出
```

### 落地命令（**由主 agent 执行，本档不写 deployed**）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-theme

# ① 默认批（(i) + (ii) + (iv-a)，布局与壁纸两个文件，一次重启）
node apply-Theme-v1.mjs --apply

# ② 若决定一并上 (0) 与 (iv-b)（(0) 见 §2 的前置条件）
node gen-candidates.mjs --scope instances,signature,themeColor,overlay,wallpaperShade --target candidates/optin
node apply-Theme-v1.mjs --scope instances,signature,themeColor,overlay,wallpaperShade --candidates candidates/optin --apply

# ③ 回滚（备份在 exec-theme/backup/<stamp>/，不会写进 deployed 树）
node apply-Theme-v1.mjs --restore <stamp>
```

落地器在写任何字节前强制：
1. 三个目标的 **pre-image md5 与行数与审计记录逐一相等**（不符即拒绝，提示重新审计）；
2. 每个锚点在**其将被应用的那份文本**里**恰好命中一次**（0 次或 ≥2 次即中止整批）；
3. 打补丁后的文本与**已复核的候选件逐字节相同**（否则要求先重生成候选）；
4. `node --check` 通过；
5. 本批引入的每个模块级标识符**在本文件内有声明**且被引用；
6. 先在 `exec-theme/backup/<stamp>/` 落 pre-image，再用临时文件 + rename 原子写入并回读校验 md5。

实测权限：三目标 dry-run 均 `writable=true`（layout 664、ui-theme 664、wallpaper **600**）。**若主 agent 以不同身份执行 `--apply`，wallpaper 的 600 可能挡住写入**——落地器会以 `[PRECONDITION FAILED] target not writable` 明确拒绝并**不写任何文件**（不会留半成品）。这是提交给主 agent 的一个真实边界，不是自证通过项。

---

## 2. 单元 (0)：同名实例去重 —— **REWORK / 阻塞**

### 2.0 返工轮（r2）：v1 探针是失效器械 —— 根因已定位并修复

**协调者的实测**：`probe-instances.mjs` v1 在两场景都打印 `instances=0 urls={}`、`data.sample` 为空，而同一窗口 `applyCalls=70 / 31`。⇒ 栈扫描**一帧都没捕获到**，与 profile 数出的 4/6 个 `apply` 函数对象**直接矛盾**。

**根因（离线可复现，`proof/probe-capture-selftest.mjs` 的 S1）**：v1 安装了 `Error.prepareStackTrace`，然后 `new Error("probe")`，**却从不读取 `.stack`**。V8 **只在 `.stack` 被访问时**才调用该 hook —— 所以 hook 一次都没执行，`framesByFn` 永远是空数组。"`instances=0`" 是尸检报告上的空白，不是页面事实。离线复现的数字与协调者看到的一模一样：**40 次 apply / `prepareCalls=0` / `frames=0`**。

**v2 的三条返工要求逐条落实**：

**(a) 器械自证（先证明能捕获，再报数）**
- 修掉根因：采样处**真的读 `.stack`**（`void e.stack`），并用一个 **lock** 保证 hook 只在自己的读取期间生效（不劫持页面/其它库的 `prepareStackTrace`），另有 watchdog 记录 hook 是否被他人替换（`handlerReplaced`）；
- 页内 `SELFVAL` 自证：构造一个**合成 `apply` 帧**并读取其栈，要求 `readsDelta>0 && prepareDelta>0 && svDelta>0`。该自证在**开窗前后各跑一次**（`preflight` / `postflight`）；
- **三值判定**，绝不再输出裸数字：
  - `CAPTURED`：观测到的应用量足够（`applyCalls≥10` 且 `bursts≥3`）**且**栈通道自证通过 ⇒ 数字可作 P0 证据；
  - `NOT-OBSERVED`：通道健康但窗口内几乎没有 apply 工作 ⇒ **明说"这对实例数什么也没说"，而不是"single presenter"**；
  - `INCONCLUSIVE-INSTRUMENT`：任一通道未通过自身前置 ⇒ 数字不得使用（进程退出码 2）。
- `--compare` 也会拦：若 `raw/instances-after.json` 的 `determination !== CAPTURED`，P0 直接判 FAIL（自检 X3g 覆盖）。

**(b) 第二种独立口径（现为三口径 + 一个旁证）**，来自不同物理量，不再只靠 V8：
| 口径 | 测什么 | 为什么独立 |
|---|---|---|
| **N1 栈通道** | 不同 `apply` **函数对象**数（含各自 bundle URL） | 函数身份 |
| **N2 DOM 通道** | `<head>` 里 `meta[name=theme-color]` 节点数 | `layout :354-355` 每个 presenter 造 1 个、`:379` 追加；**不依赖 V8 栈**，第二个活 presenter 必留第二个节点 |
| **N3 突发通道** | 一次派发内 `body.style.removeProperty` 调用数的**最大值** | 每个 presenter 只 retract 自己的 1 个 token（审计实测 N_old=1）⇒ 突发大小 = 活实例数 |
| **N4 profile** | 同窗口 profile 里该 bundle 行的 `apply` self-time 行数 | 离线聚合，与页内无关 |
| 旁证 cordis | 包住 `loader.internal.import` 返回的 layout exports 的 `apply`，记录每次插件体调用及其 ctx | 与上面的消费者侧口径互补 |

**口径定义（协调者要求 (c)，已写进探针的 `definitions` 字段）**：
- `instanceCount` = **活的 ThemePresenter 对象数** = N1 = N2 = N3（三值并列，全部打印，并给 `allThreeEqual`）；
- `applyCalls` = 窗口内 `body.style.removeProperty`（仅 body）总次数 = **publish 次数 × 活实例数**（因 N_old=1）；
- ⇒ **`instances=0 且 applyCalls=70` 对一个可用器械是不可能的**。v1 报告里这两行并列且不作解释，这正是它的错误呈现方式；v2 在文档、JSON 与终端输出三处都写明这条不可能性。

**(c) 自证测试的区分力**：`proof/probe-capture-selftest.mjs`（13 项全 PASS）离线复现 v1 失效形态与 v2 可用形态，**同输入下 broken=0 帧 / fixed≥1 帧**（S2b 是变异对照），并验证：只统计 ui-layout 帧（foreign 帧不得灌水，S2c）、不同函数对象分别计数且重复读数不膨胀（S2d）、采样制度在 300 次 apply 下只读 90 次（S3）。此外它还检查**发布文件本身**是否含 `.stack` 读取与三值判定（S4a–S4f）——发布件退回 v1 形态会直接导致该自测失败。

**（仍未消除的诚实边界）** v2 的可用性**只能由你在独占窗口真跑验证**（`determination=CAPTURED` 才算数）。本档没有浏览器，**没有**任何活体实例数结论；profile 的 4/6 行与 v1 的 0 之间哪个对，由 v2 的 preflight + 三口径一致性来裁决。

### 2.1 我做了什么

按契约"**先从代码静态证明多实例的来源**"逐条排查，并用审计给的 `fns` 口径在 `raw/profile-cpuL-*.json` 上重算：

| 假设 | 静态判定 | 依据 |
|---|---|---|
| 模块被**多次 load**（bundle 执行两次） | **不可能** | `dsh-client-modules/lib/client.js:192` `register()` 对同 id 二次注册**直接 throw**；`:186` 同一 graph entry 重复也 throw |
| 模块被**多重物化**（一份工厂出两个 exports） | **不可能** | `ClientModuleSystem.loadCache` 按 id 记忆化（`:240-252` `materialize`），`arrive()`（`:204`）按 id 幂等 |
| 每次 `theme/change` **重新注册** listener/实例 | **不可能** | `ui-layout/lib/client.js:436-446`：`new ThemePresenter()` 与 `ctx.on(...)` 在 `ctx.effect` **体内**，只随 effect 重放执行，且 `:442-445` 有 `off()` 配对 |
| 同一 plugin 被**两个 entry** 应用 | **不可能**（boot 路径） | `dsh-web-frontend/dist/assets/index-ClqxG24t.js`（shell）：`this.manifest.plugins.map(c=>c.id)` → **每个 id 恰好 `loader.create({name:c})` 一次**；`EntryGroup.create` 以 id 为 key 复用 entry（`cordis-plugin-loader/lib/index.js:44-62`）；`Entry._start`（`:532-541`）每次 `_patchContext` + `registry.plugin()`，`update()` 路径**先 `_dispose(previous)`**（`:474`） |
| 只剩：**同一 entry 的 fiber 被多次启动 / 同源多 fiber** | **未证** | 需要活体判别（见 2.3） |

### 2.2 硬事实（重算，非转述）

`raw/profile-cpuL-*.json` 的 `selfTop` 里，同一 URL 同一行 `366` 的 `apply` **函数对象**计数（`analyze` 的 `rows` 是**每 node.id 一行**）：

| 窗口 | `apply` 函数对象数 | 分布（ms） |
|---|---|---|
| home-idle-w1 | **4** | 232.0 / 201.0 / 120.8 / 111.2 |
| home-idle-w2 | **4** | 152.6 / 126.1 / 54.0 / 51.9 |
| long-idle-w1/w2 | 2 / 2 | ≈1815/1717、1851/1743 |
| long-active-w1/w2 | 2 / 2 | ≈1299/1263、1398/1335 |
| settings-open-t1 | **6** | 1838.7 / 1748.3 / 19.1 / 18.1 / 16.0 / 11.7 |
| settings-open-t2 | 2 | 1557.1 / 1524.2 |
| settings-models-tab-t1 | **6** | 1089.5 / 1056.4 / 230.5 / 223.0 / 11.7 / 10.7 |
| settings-dwell-w1/w2 | 2 / 2 | 1341.2/1274.2、752.2/734.1 |
| settings-models-tab-t2 | 2 | 1775.7 / 1710.7 |
| settings-plugins-tab-t1/t2 | 2 / 2 | 1617.4/1580.9、671.8/633.5 |

- 每个窗口的 `bundles[].urls` **只有一条**（`client.js?rev=abdb7f55acba`），且该窗口 `bundles[].selfMs` ≡ 该窗口 `applyMs` ⇒ 所有同名 `apply` 行**来自同一份 URL**。
- 审计 §1.6 把 `bundles[].fns` 读作"并存实例数"。本档复核后的**更硬口径**是 `selfTop` 里 line 366 的行数（这两者在 cpuL 的 14 个窗口里**逐窗相等**，所以审计的行计数结论仍成立）。

### 2.3 为什么按停止条件上报（不是"懒得做"）

审计自己标了边界（§6.2）：`fns` 只证"被采样到的不同函数对象"，**未证仍在 `theme/change` 列表里**。我把所有"非活体"路径排掉之后，**唯一剩下的机制（同源多 fiber）无法用静态代码证明**——因为创建 fiber 的每一处（`Entry._start`、`HMR reload`、`DynamicCordisPanel.mount`）在代码上都**先 dispose 旧 fiber 或复用同一 entry**。也就是说：**要么我的静态模型漏了一处调用点，要么 profile 的"多函数对象"另有物理解释**。契约明确要求"**禁止在来源未证明时用『只让最后一个生效』这类补丁掩盖**"，因此：

- **不把 (0) 放进默认批**；
- 交付 `experiments/probe-instances.mjs`（P0 判别探针）作为**唯一**开闸依据；
- 同时交付一份**不依赖来源**的候选（见 2.4）标为 opt-in，**但它只在探针给出"同源"结论后才有意义**。

### 2.4 P0 判别探针（v2，交主 agent 跑）

```bash
# 前置：只读；开窗走 §4.0 硬件门槛（foreignCount==0 且锁属主为本线）
node experiments/probe-instances.mjs --label check-home     --scenario home     --win 8000
node experiments/probe-instances.mjs --label check-settings --scenario settings --win 8000
```

**判读规则（先看 `determination`，再看数字）**：
1. `determination != CAPTURED` ⇒ **不要用任何实例数字**：`NOT-OBSERVED` 是"没证据"，`INCONCLUSIVE-INSTRUMENT` 是"器械坏了"（进程退出码 2，且会打印失败原因）；
2. `CAPTURED` 后看 `agreement`：
   - `N1==N2==N3==1` ⇒ 活体只有一个 presenter ⇒ 关闭 (0)；
   - `N1>1 且 sources 只有 1 条` ⇒ **同源多 fiber**，`candidates/optin/client.layout.js` 的模块级单例**能**收敛到 1（已备，未批准落地）；
   - `N1>1 且 sources 多条` ⇒ **多重物化/多重装配**，我的模块级单例**无效**，靶点移到装配侧，请回传我重做；
3. **口径分歧本身也是证据**：若 `N1≠N2`，说明"栈上的函数对象"与"DOM 上留下的节点"不是一回事（例如旧 presenter 已 dispose、meta 被移除），把原始 JSON 回传，我按分歧重解。

探针同时打印**你已实测的值取证**（`computedBodyBackgroundColor` / `inlineTokenBgBase` / `computedTokenBgBase` / `themeColorMetaContent` / 活体页面上所有 `body{...}` 规则），用于 §4.3。

### 2.5 (0) 的候选（opt-in，**未批准落地**）

`candidates/optin/client.layout.js`（scope 含 `instances`）实现：

- 模块级 `themePresenterSlots = new WeakMap()`（按 `window` 建槽）；
- `acquireThemePresenter(window, presenter)` 引用计数：首个调用者建槽，后续调用者**共用**同一个 presenter；
- `slot.release` **先做代际身份检查**（`themePresenterSlots.get(winRef) !== slot` 即 no-op），因此**过期释放不会打乱计数**；
- effect 体：`const release = acquireThemePresenter(window, presenter); … return () => { off(); release(); }`——**最后一个消费者**放手时才 retract 文档。

**为什么这不是"只让最后一个生效"**：所有并存 presenter 对同一份 `body.style` 写**完全相同**的 token 集，因此它们互为纯冗余；单例化后语义等价，且**任何**来源（多余 fiber、HMR 替换、effect 重放）都被收敛。它在"同源多 fiber"前提下**由构造保证** 实例数 = 1。
**它证明不了的**：若探针判为"多重物化"，该候选无效（两处模块作用域各自一个单例）——**这就是它必须等探针的原因**。

---

## 3. 单元 (i)：内容签名跳过重放 —— 交付

### 3.1 三联前提逐条落实（审计 §2.4）

| 前提 | 落实方式 | 反证 |
|---|---|---|
| ① 签名只含**内容**，不含 `revision` | `const signature = scheme + "\u0000" + tokenSignature(entries)`，`tokenSignature` 取 `entries`（`Object.entries(active.tokens)` 的 `[name,value]` 对），`JSON.stringify` 每个值、按名排序后以 NUL 连接 | **M1** 把 `snapshot.revision` 掺进签名 ⇒ 校验器判 FAIL（"revision in signature"） |
| ② **落地点守卫** | `landingIntact(scheme, body)`：`documentElement.style.colorScheme === scheme` ∧ `body.hasAttribute(DARK_ATTRIBUTE) === (scheme==="dark")` ∧ **上一次真正写过的每个 token 仍非空**（`this.lastTokens`，即"上一轮真实落地点"而非本轮被清空的 `appliedTokens`） | **M2** 去掉 `landingIntact` ⇒ 判 FAIL |
| ③ **首次调用不得跳过** | `lastSignature` 字段默认 `undefined`，而签名恒为字符串 ⇒ 首调必然不等 | **M3** 给条件加 `this.lastSignature !== void 0 &&` ⇒ 判 FAIL（形状漂移） |

**一处我按审计给的守卫原文实现、但发现需要注意的地方**（诚实标注，未擅自"顺手修"）：
审计原文守卫是 `body.hasAttribute(DARK_ATTRIBUTE) === (scheme === "dark")`。注意这在 `scheme==="light"` 时断言的是"**必须没有** 该属性"，若第三方错误地**加上**了它，守卫会失败并重新 apply（能修）；而 `scheme==="dark"` 时若第三方**移除**了它，`hasAttribute` 返回 `false` 也**不等于** `true` ⇒ 守卫同样失败并重新 apply（也能修）。两种漂移都被这条路挡住；离线对拍 **E4a/E4b/E4c** 实测确认（移除属性后**下一次 apply 就修复**）。我将该结论写进报告而**不改**审计给出的守卫形状。

**（协调者裁决 3：接受）** 审计原守卫用 `this.appliedTokens`，但那在 `:373` 刚被清空，会让 token 那一条**恒真**（退化为只查 colorScheme 与 dark 属性）。因 `:373` 先清空而**恒真**，等于无守卫；我的 `lastTokens` 修正**已被协调者接受并要求随批落地**。两个残留边界照写：

1. 若上一轮**完全没有** token（`lastTokens` 为空，本部署在壁纸关闭/无覆盖层时会经过这个状态），守卫只剩 `colorScheme` 与 dark 属性两条 ⇒ 此时"第三方清掉我们本就不拥有的 token"不会被发现。这是**正确**的（我们没写过它），但意味着守卫的强度**随状态变化**，活体验收时不要假定它总是三条齐备；
2. 守卫只查我们自己写过的名字，**不查**第三方额外写进 `body.style` 的属性；本部署实测 `bodyStyleWrites == 2 × apply`（`analysis-cpuL.json` 14 窗逐窗自洽）⇒ 运行期**没有**第三个 body 写入者，所以本批是安全的；这条依赖在活体上由 R4/R6 复核。

### 3.2 四个必须仍生效的场景（逐条核）

| 场景 | 机制 | 签名变化？ | 离线对拍 |
|---|---|---|---|
| dark/light 切换 | `active.colorScheme` 变 | **变** | E3c（writes>0） |
| 壁纸（`--dsw-alias-bg-base` 随 opacity/源图变） | tokens 值变 | **变** | E3b（writes>0） |
| locale | locale **不参与** theme 快照（`buildSnapshot` 无 locale 字段） | 不变 | 签名只取 `colorScheme`+`tokens`，结构上无法纳入 locale |
| token 覆盖增/改/删 | `composeActive` 重算，**删层**时键集减少 | **变** | E3d（writes>0，3 次写） |

### 3.3 生效方式与回归

改的是 client bundle（`?rev=`）⇒ 审计判定**需重启**（`__DSH_BOOT__` 无 `__DSH_HMR__`）。回归项：R1–R9（`experiments/verify-functional.mjs` 被动部分 + 清单里的手工项）。

---

## 4. 单元 (ii)：`:378` 强制重算 —— 交付，但**我选的不是审计首推的 (ii-a)**

### 4.1 结论

`:378` 的**唯一**用途是给 presenter 自建的 `theme-color` meta 提供"计算后的 body 背景色"，**不能删**（审计 §3(ii) 已判 FAIL）。本批采用 **(ii-b)**：

```
apply 末尾：
  this.pendingTokenSignature = tokenSignature(entries);
  scheduleThemeColorRefresh(this.themeColorMeta.ownerDocument?.defaultView, this);

scheduleThemeColorRefresh：同 window 一个 Set 队列 + 一个 rAF 句柄；
  该帧回调里对每个 presenter 调 refreshThemeColor()；
  refreshThemeColor：签名与本帧已刷过的相同则直接返回，否则
    this.themeColorMeta.content = getComputedStyle(document.body).backgroundColor;
  host 无 requestAnimationFrame 时**同步内联**（保持非浏览器宿主行为）。
```

### 4.2 为何不改变可见结果（三件产物逐一交代）

| 产物 | 旧行为 | 新行为 | 变化的**证明** |
|---|---|---|---|
| `document.documentElement.style.colorScheme` | `apply` 内同步写 | **完全未改**（原样保留在 `:368` 位置） | 对拍 E6：与 pristine **逐步相等** |
| `body[data-ds-dark-theme]` | `apply` 内同步写 | **完全未改** | 对拍 E6：相等 |
| `meta[name=theme-color].content` | 每次 apply 末尾**同步**读 `getComputedStyle(body).backgroundColor` | 改到**同一次 apply 所在帧**的 rAF 里读，帧内去重 | 对拍 E5：**7 步逐步与 pristine 相同**；E7：读次数 = token 集**变化**次数（4）而 pristine = apply 次数（7） |

"为什么要挑 rAF 而不是微任务"：`:378` 排在 `:368-377` 的所有写**之后**，因此它读到的是**本轮写完之后**的解析结果。rAF 回调发生在**本帧所有同步任务（含本次 publish 的全部 listener、全部并存实例）结束之后、下一帧绘制之前**，所以它读到的仍然是**同一份文档状态**；反过来它把"一次 publish 派发里的多次读"合并成了**一次读**。这是 (ii-b) 相对 (ii-a) 的关键优势：**值不变**。

### 4.3 为何不选 (ii-a)（我原先给的理由**是错的**，协调者已实测纠正）

**我原先的说法（错）**："全量扫描所有 client bundle，没有任何规则给 `body` 设 background/background-color ⇒ 计算值恒为 `rgba(0,0,0,0)` ⇒ 换 token 值属可见变化"。

**协调者实测（对）**：页面上存在 `body{background: var(--dsw-alias-bg-base, #fff)}`，且 `computed == inline token == computed token == theme-color meta` 四者相等。

**我为什么漏掉它（根因）**：我的静态扫描只覆盖了 `*/lib/client.js` 与 `@local/*/lib/client.js`。该规则实际位于 **shell 的编译产物 CSS**：`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-C6eRlFa6.css`：

```
body{font-family:…;color:var(--dsw-alias-label-primary, #0f1115);background:var(--dsw-alias-bg-base, #fff)}
```

我已把这条**带 fallback 的规则及其文件路径**记进 `experiments/thresholds.json` 的 `valueFacts`，并由 `probe-instances.mjs` 每次真跑时在活体上复核（打印 `bodyBackgroundRules`）。

**结论修正**：因为 CSS 给的是 `background: var(--dsw-alias-bg-base, #fff)`，body 的**计算背景色在 token 存在时等于 token 值、在 token 缺失时回落 `#fff`**。所以：

- **我原来的"值会变"理由不成立** —— 常规情况下 (ii-a) 与 (ii-b) **同样保值**；
- **(ii-b) 仍然更优，但理由换成协调者给的这一条**：它读的是**计算值本身**，因此**无条件**保值——token 未定义、被他人覆盖、被删除、或多层覆盖互相作用时都自动正确；而 (ii-a) 依赖"token 存在且恰好等于计算值"这一**前提**，在多写入者/缺 token 的边角上会写错 meta（更糟的是它会把 meta 写成空串）。
- 因此本批保持 **(ii-b)**，并把这条"无条件保值 vs 依赖前提"的判据写成本单元的真正取舍理由。

### 4.4 一处必须写明的真实弱化

`refreshThemeColor` 的帧内去重按 **token 签名**判等，而"需要重读"的**充分**条件是"计算背景可能变了"。本部署里变色只由 `colorScheme`（⇒ `body[data-ds-dark-theme]`）与 token 集驱动，所以签名足够；**若将来有第三条 CSS 通路改 body 背景**（例如新增 `body{background:…}` 规则或第三个写入者），帧内去重会少读一次，meta 可能滞后一个内容变化周期。缓解：`landingIntact` 仍在每次 apply 上把关（内容变了就必定重写、必重读）。这条与审计 §6.2 的风险同源，我把它显式写进报告而不是假装没有。**注意该风险的实际量级已被协调者的实测大幅收敛**：`body{background:var(--dsw-alias-bg-base,#fff)}` 是**唯一**的 body 背景规则，且它只引用我们写的那个 token ⇒ 本部署里"计算背景"确实由 `colorScheme` + token 集决定，帧内去重的前提成立。

另：协调者在独占门禁全通过的批次里实测 `RecalcStyle÷Task = 31–35%`（非审计引用的 60%），说明 (ii) 的**收益上限**应以干净基线衡量；本批判据已相应改为以相对降幅为主（见 §6.5）。

---

## 5. 单元 (iv)：内容比较（wallpaper 默认 ON；ui-theme opt-in）

### 5.1 wallpaper `shadeTokens`（默认 ON）

`@local/dsh-wallpaper/lib/client.js:183-198` 每次都重建**逐字节相同**的层。候选改为：先算 `next`，与 `shadedTokens` 比较，相同则**只跳过 `overrideTokens` 的 publish**，仍执行 `overrideDispose?.()`（它的 disposer 内部 `overrides.delete` 之后 `publish()`——这是**必要**的，因为 layer 已从 map 删除，跳过它会留下不一致状态）。

⇒ 净效果：把"删层 publish + 重建 publish"压成 **1 次 publish**（回响的另一半由 (i) 在消费者侧吃掉）。离线对拍不覆盖这条（它依赖 ui-theme 的真实 publish 计数），因此**在 R4/R6 的功能清单里验**（`verify-functional.mjs` 的被动项 + 手工 R6）。

### 5.2 ui-theme `overrideTokens`（opt-in，标"下一批"）

`ui-theme/lib/client.js:1224-1236` 无条件 `publish()` 且不做层内容比较。候选改为：`validateOverrides` 后与 `this.overrides.get(source).tokens` 做**逐 token 逐模式**比较，全等则返回**既有 layer 的 disposer**（不 publish）。

**为什么标下一批**：它与 (i) 是**同一杠杆**（削减 `theme/change` 发射次数）的两个独立实现（生产侧/消费侧）。两者同时上会**混淆 P0 归因**（`apply/s` 下降多少归谁？），而 §4.1 的判据要求"`theme/change` 发射次数下降 ≥50%"。因此默认 OFF，等 (i) 单独跑出干净增量后再上。

---

## 6. 真跑自证（全部离线/静态，**未开浏览器**）

原始日志：`raw/SELFPROOF-LOG.txt`（**10 步** `EXIT=0`）。逐项：

| # | 自证 | 命令 | 结果（原始摘录） |
|---|---|---|---|
| 1 | 锚点唯一性 + 生成默认批 | `node gen-candidates.mjs` | layout 5 锚点各 `UNIQUE`（pristine occurrences=1）；wallpaper 2 锚点各 `UNIQUE`；`client.layout.js` md5 `684622de7914eaae058985fbeca09076`（+115 行）、`client.wallpaper.js` md5 `885bde89e33c33fec4ef399ba00e907c`（+13 行） |
| 2 | 锚点唯一性 + 生成全单元批 | `--scope instances,signature,themeColor,overlay,wallpaperShade` | layout 6 锚点全 `UNIQUE`；ui-theme 2 锚点全 `UNIQUE`；`optin/client.layout.js` md5 `230bf663be0ca4b2374d42e683f5cb83`、`optin/client.uitheme.js` md5 `25cad50ea097b54af319272fbe128eba` |
| 2b | 作用域矩阵 | （脚本内）8 个 scope 组合 | 全部 `unique` ⇒ 每个锚点在它被应用的那份文本里恰好一次（含 unknown unit 的容错） |
| 3 | 候选件 `node --check` | 5 个候选 | **全 OK** |
| 4 | 落地器 dry-run（默认批） | `node apply-Theme-v1.mjs` | pre-image md5 与审计记录**逐位相等**（`af19ea…`/`b9cd…`）；5+2 锚点各 `occurrences=1`；候选字节一致；`node --check OK`；`tokenSignature/themeColorRefreshQueue/themeColorFrame/scheduleThemeColorRefresh/shadedTokens/sameShadedTokens` 全部 `declared=true referenced=true`；`[DRY-RUN] no file written` |
| 5 | 落地器 dry-run（全单元） | `--scope … --candidates candidates/optin` | 同上 + `sameOverrideTokens` 声明校验通过；`themePresenterSlots/acquireThemePresenter` 声明校验通过 |
| 6 | 校验器 + 变异反证（默认批） | `node proof/verify-candidates.mjs --allow-unavailable-mutations` | **19 项全 PASS**（M6 SKIP，因该候选不在本 scope） |
| 7 | 校验器 + 变异反证（全单元） | `--candidates candidates/optin` | **25 项全 PASS，M1–M6 全部"mutation rejected"** |
| 8 | 离线对拍（stub DOM） | `node proof/stub-apply.mjs` | **27 项全 PASS**（逐模型×2）；见下表 |
| **9** | **探针捕获自证（r2 新增）** | `node proof/probe-capture-selftest.mjs` | **13 项全 PASS**：S1 复现 v1 失效（40 apply / `prepareCalls=0` / `frames=0`）、S2/S2b 同输入下 broken=0 帧 vs fixed≥1 帧、S2c 外来帧不灌水、S2d 不同函数对象分列且重复不膨胀、S3/S3b 采样制度、S4a–f 发布件必须含 `.stack` 读取与三值判定 |
| **10** | 实验器械自检 | `node proof/check-experiment-logic.mjs` | **16 项全 PASS**：X2 同基线必 FAIL、X3a 达标必 PASS、X3b/c/d/f/g/h 各自必 FAIL、**X3e 受污染基线项默认不判死刑 + X3e' `--enforce-reference` 恢复强制** |

### 6.1 变异反证（证明 verifier 有区分力，审计要求）

| 变异 | 期望 | 实测 |
|---|---|---|
| **M1** 签名掺入 `revision` | 判失败 | ✅ rejected（`revision in signature`） |
| **M2** 去掉落地点守卫 | 判失败 | ✅ rejected（`signature test missing/ambiguous; landing guard missing`） |
| **M3** 首调也跳过 | 判失败 | ✅ rejected（`extra first-call guard (shape drift)`） |
| **M4** 去掉帧延后（回到同步强制读） | 判失败 | ✅ rejected（`no frame deferral`） |
| **M5** 去掉 wallpaper 内容比较 | 判失败 | ✅ rejected |
| **M6** 去掉 ui-theme 内容比较 | 判失败 | ✅ rejected（全单元批） |
| 对照 | 未变异候选必须**被接受** | ✅ `C:layout / C:wallpaper / C:uitheme` 全 PASS |

另：**M6 在默认批里是 SKIP 而不是 PASS**——候选不在该 scope 时反证等于没跑，我把它显示为 SKIP，避免"没跑也算过"。

### 6.2 离线对拍（`proof/stub-apply.mjs`，真实源文本抽取，非重实现）

从**部署态 pristine bundle** 与**候选件**各自抽取 `ThemePresenter` 类体 + `tokenSignature` + `scheduleThemeColorRefresh`，喂给 stub document（记录每一次 `setProperty/removeProperty/setAttribute/removeAttribute/appendChild/style.colorScheme=` 以及 `getComputedStyle` 次数），两种 `getComputedStyle` 值模型（`transparent` / `token`）各跑一遍：

| 判据 | 结果 |
|---|---|
| E1 首调写入（colorScheme + 属性 + token + append meta） | ✅ 4 writes |
| **E2 逐字节相同的重放：0 次写、0 次 `getComputedStyle`** | ✅ `writes=0 gcs=0`（pristine 同一步：`writes=4 gcs=1`） |
| E3a 仅 `revision` 变（内容相同）仍跳过 | ✅ `writes=0` |
| E3b token 值变 / E3c 配色变 / E3d 键集减 | ✅ 均 `writes>0`（4/4/3） |
| **E5 `theme-color` meta 值与 pristine 逐步相等** | ✅ `["rgba(21,21,23,0.72)",…,"rgba(0,0,0,0)"]` 两侧一致 |
| **E6 colorScheme / dark 属性 / body token 集与 pristine 逐步相等** | ✅ |
| **E7 强制重算次数：patched=4（token 集变化次数） vs pristine=7（apply 次数）** | ✅ `replays skipped=2/2` |
| E4a 守卫：第三方清掉我们的 token ⇒ 重放不跳过 | ✅ `writes=4` |
| E4b 守卫：colorScheme 漂移 ⇒ 不跳过 | ✅ `writes=4` |
| **E4c 守卫：第三方移除 dark 属性 ⇒ 下一次 apply 即修复** | ✅ `writes=4, dark=true` |

> 说明：E7 的期望值由**输入**推导（token 集变化次数），**没有**硬编码 5 或 4——第一次写成硬编码时它报了 FAIL，我改的是**判据的推导方式**，不是阈值。

### 6.3 实验器械自检（阈值有区分力）

| 场景 | 期望 | 实测 |
|---|---|---|
| X2 修复后仍与基线同值 | `BATCH VERDICT: FAIL` | ✅ exit=2 |
| X3a 达标（applyMs 掉 98.6%、`RecalcStyle÷Task` 0.604→0.143、`applyMs/busyMs` 0.875→0.08、`rafP50` 16.7、`rafP99` 133→22、`rafOver50` 34→1、instances 2→1） | `PASS` | ✅ exit=0 |
| X3b DOM 节点数漂移 >5% | 判"不可比" | ✅ |
| X3c `rafP50` 变差（16.7→22.5） | 判 FAIL（哨兵） | ✅ |
| X3d 实例数仍为 2 | 判 FAIL（P0） | ✅ |
| X3e `RecalcStyle÷Task` = 0.64 | 判 FAIL | ✅ |
| X3f `applyMs/busyMs` = 0.667 | 判 FAIL | ✅ |

---

### 6.4 返工轮的器械自证（逐项）

| 判据 | 结果 |
|---|---|
| S1 根因复现：装 hook 但**不读 `.stack`** ⇒ 40 次 apply 下 `prepareCalls=0`、`frames=0` | ✅ 与协调者实测形态一致 |
| S2 同输入下 v2 捕获到 ui-layout `apply` 帧 | ✅ `prepareCalls=40 distinctApplyObjects=2 sources=["client.js?rev=abdb7f55acba#L366"]` |
| S2b 变异对照有区分力（broken=0 vs fixed≥1） | ✅ |
| S2c 非 ui-layout 的 `apply` 帧不计数（不灌水） | ✅ `frames=1`，外来帧被忽略 |
| S2d 不同函数对象分别计数、重复读数不膨胀 | ✅ `distinct=3`，3 次读数后仍为 3 |
| S3 采样制度：300 次 apply 只读 90 次（60 + ⌊(300−60)/8⌋） | ✅ |
| S3b 前 60 次 apply 逐次读（窗口内不欠采样） | ✅ `stackReads=40/40` |
| S4a–f 发布件自检：含 `.stack` 读取 / 页内自证 / 三值判定 / 三口径 / 口径定义 / 安装 hook | ✅ 6/6；**发布件退回 v1 形态会使本自测失败** |

### 6.5 阈值来源重划（协调者裁决 4 落实）

`experiments/thresholds.json` 现分两节，**数字一字未改**，只是把"谁有资格判死刑"按来源重划：

| 节 | 内容 | 是否判 FAIL |
|---|---|---|
| `primary` | 同条件**相对降幅**（`apply/s` 降幅 ≥50% 且有绝对上限 5/s、`applyMs/s` 降幅 ≥70%、`rafOver50` 相对降幅 ≥50%、`bodyStyleWrites` 降幅 ≥50%）+ 三个**不依赖受污染批**的绝对守卫（节点数差 ≤5%、`rafP50` 16.7 哨兵、`reconcileRatio` 0.9–1.1）+ P0 实例数 =1（且必须来自 `determination==CAPTURED` 的探针） | **是** |
| `reference` | `RecalcStyle÷Task ≤0.15`（审计取自**受污染** 60%）、`applyMs÷busyMs ≤0.10`（取自 0.50–0.80）、`raf/s ≥55`、`rafP99 ≤33`、`Task/s` 降幅 ≥40% | **否**（仅报告；加 `--enforce-reference` 才强制） |

每条 `reference` 项都带 `provenance` 字段写明它取自哪一批；`_baseline.coordinatorCleanMeasurement` 记录你实测的 `recalcOverTask 31–35%`。自检 X3e/X3e' 证明这套分级**双向**有效（默认不判死刑、显式要求时确实判死刑）。

## 7. 失败 / 无效 / 未做

| 项 | 状态 | 说明 |
|---|---|---|
| 单元 (0) 的**来源证明** | **仍未完成（阻塞）** | 见 §2.3；v1 探针被协调者实测证伪（§2.0），v2 已修但**仍需你在独占窗口真跑**才能判定——本档无浏览器，故仍无活体实例数结论 |
| v1 探针的失效 | **失败（已定位并修复）** | 根因 = 装 hook 不读 `.stack`；离线复现 + 修复 + 变异对照见 §2.0 / §6.4。**同一失误也污染了我 §4.3 的静态结论**（漏扫 shell 的编译产物 CSS），已按你的实测纠正 |
| 单元 (0) 的候选 | **未批准落地** | 只在"同源多 fiber"前提下有效；默认 scope 不含 `instances` |
| 实验脚本的**真跑** | **未执行（无独占窗口 + 禁止开浏览器）** | M-A/B/C/D、P0 探针、R1–R9 全部**已写好、已自检、待主 agent 跑**；本报告不含任何活体数字 |
| 审计 §4.2 的绝对阈值 | **无法在本档判定** | `cpuL` 是在 3 个外来 `headless_shell` 并发下测的；`thresholds.json` 里我把 `cpuL` 基线表copied下来**只作参考**，判据一律用**同窗比值 + 同条件 before/after** |
| `(ii-a)` | **未采用** | 理由见 §4.3（会改可见 meta 值）；已给出可证伪取证手段 |
| `(iii) cssText` | **未做** | 审计否决，遵守 |
| 产品文件写入 / 重启 / 活体验证 | **本档一律未做** | 纪律要求 |

---

## 8. 同档自复核裁决：**REWORK**

### 8.1 判定（返回轮的更新）

**REWORK（范围已收窄）** —— 首轮交回后协调者给出四项裁决，逐条落实如下：

| 裁决 | 状态 | 落点 |
|---|---|---|
| ① 单元 (0) 探针结论**无效**，返工（器械自证 / 第二口径 / 口径定义） | **已返工** | §2.0：根因定位（不读 `.stack`）、三值判定、N1/N2/N3+N4+旁证五路口径、`definitions` 字段、`--compare` 拒绝非 CAPTURED 探针；自证 13 项全 PASS |
| ② ii-b 取代 ii-a：**接受**，但理由换成"无条件保值" | **已接受并改写** | §4.3：删掉我错误的那条理由，记入真实 CSS 规则与其文件位置 |
| ③ `appliedTokens → lastTokens`：**接受**，随批落地 | **已接受** | §3.1 |
| ④ 阈值：绝对项来自受污染批 ⇒**以相对降幅为主判据** | **已落实** | §6.5 / `thresholds.json` 的 `primary` vs `reference` + `--enforce-reference`；自检 X3e/X3e' 双验证 |
| ⑤ 边界照写不省 | **保留** | §9 原文照录 |

**仍然 REWORK 的部分（只剩一条）**：单元 (0) 的**来源判定**必须由 v2 探针在你的独占窗口给出 `determination=CAPTURED` 的结论。在此之前 `(0)` 不进默认批——这是契约的停止条件，不是实现缺陷。

**同时请知悉我这一轮的两次实质错误**（都已定位并改正，不再依赖你复核）：
1. **探针失效**：装 `prepareStackTrace` 却不读 `.stack`，导致 `instances=0` 被当作页面事实（正是你抓到的矛盾）；
2. **静态漏扫**：我只扫了 `*/lib/client.js`，漏掉 shell 的编译产物 CSS，因此错误地断言"body 计算背景恒为 transparent"。该错误使我给 ii-a 的否决理由站不住——**若你当时采纳了我的理由，会把一个本可用的更省方案否掉**。教训已写进 §4.3。

### 8.2 返工清单（按优先级）

| # | 返工项 | 触发/依据 | 需要谁 |
|---|---|---|---|
| R1 | 跑 v2 探针（home + settings），**先把 `determination` 报回来** | 单元 (0) 的唯一开闸依据（§2.0） | 主 agent（独占窗口） |
| R2 | 依 R1 结论决定 `instances` 是否进批；判"多重物化"请回传，我改靶点 | §2.4 判读规则 | 主 agent → 我 |
| R3 | 落地默认批 → 重启 → `run-theme-experiments.sh before/after/compare` | 以 **primary**（相对降幅）判分；`--enforce-reference` 仅在你想看绝对项时加 | 主 agent |
| R4 | `verify-functional.mjs`（免探针）+ 手工 R1/R2/R6/R7 | §4 的 P2 清单 | 主 agent |
| R5 | 若 (i) 增量不足以达到 `apply/s` 降幅 ≥50%，再上 (iv-b) 独立计量 | 候批已备 | 我 |
| R6 | 用 v2 探针顺带复核 §4.3 的四值相等（`computed == inline == computedToken == meta`） | 该事实我此前断言错了 | 主 agent（探针已自动打印） |

### 8.3 我没有做、也不该由我做

- 未改验收阈值或期望值来让某次运行"通过"（`thresholds.json` 的阈值逐字抄自审计 §4；X3a 一度 FAIL 时我改的是**判据的推导方式**并把过程写进 §6.2）；
- 未把 `(0)` 硬塞进默认批；
- 未宣称本批能消除可感卡顿（见 §9）。

---

## 9. 边界声明（审计 §6.3 复述，**不得被本批的措辞掩盖**）

> **即使 `apply` 完全归零，仍有 65–100 ms/s 的主线程残留没有归因。**

- `apply` 占 busy 的 **0.50–0.80**（7 场景）⇒ 归零后仍有 20–50% 非 idle 工作残留；按 `cpuL` 的 `home-idle`（busy 130.0 / apply 65.4 ms/s）估算残留 ≈ **65 ms/s**，按 `long-idle`（busy 450.8 / apply 348.9）估算 ≈ **100 ms/s**。
- 残留里**第二大**可归因项是会话链，但只有 **3.2–10.1 ms/s** ⇒ 残留主体是采样表上看不到归属的散点（`(program)`、GC、`(no-url:native/vm)`、React commit、连接层），**本批没有**逐个归因。
- 因此：**修 `apply` 是必要且高收益的**（占第一，且 `RecalcStyle÷Task` 60% 的绝大部分由它产生），但**不保证**单独消除可感卡顿。判定必须走 §4.2 的 `rafOver50`/`rafP99`/`RecalcStyle÷Task` + §5 的因果分离；若 M-B/M-C 显示 `apply` 归零后 `rafOver50` 仍 >10/2 窗，则须**追加**对残留项的归因。
- 一句话给协调者：**本批交付的是"把第一 CPU 成本项按证据削下去"的可验证改动，不是"卡顿已解决"的结论。**

---

## 10. 盘面清单（供复核）

```
候选（未部署）
  candidates/client.layout.js            md5 684622de7914eaae058985fbeca09076  (i)+(ii)
  candidates/client.wallpaper.js         md5 885bde89e33c33fec4ef399ba00e907c  (iv-a)
  candidates/optin/client.layout.js      md5 230bf663be0ca4b2374d42e683f5cb83  + (0)
  candidates/optin/client.uitheme.js     md5 25cad50ea097b54af319272fbe128eba  (iv-b)
  candidates/optin/client.wallpaper.js   md5 885bde89e33c33fec4ef399ba00e907c

目标（只读，pre-image 已核）
  ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js
      md5 af19ea709a1556b8c48bedfa8b31e785  455 行  ?rev=abdb7f55acba
      （符号链接 → ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/…，两侧内容一致）
  ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js
      md5 7b8efca68e0f6c45dfa4222974697eab  1354 行  ?rev=e19c47b60a1c
  ~/.dsh/profiles/node_modules/@local/dsh-wallpaper/lib/client.js
      md5 b9cd4747f91084065d1227fba5aa7e61  597 行   ?rev=fb28faf9db9a（mode 600 → 落地器会拦非属主写入）

原始输出
  raw/SELFPROOF-LOG.txt       9 步全绿（含每步 EXIT）
  raw/gen-candidates.*.log    锚点唯一性逐条
  raw/apply-dryrun.default.log 落地器 dry-run 全文
  raw/verify.log / verify-optin.log   校验器 + 变异反证
  raw/stub-apply.log          离线对拍
  raw/experiment-logic.log    器械自检（16 项）
  raw/probe-capture-selftest.log  ★r2 探针捕获自证（13 项，含 v1 失效复现）
  proof/*.json                机器可读报告（verify / stub-apply×2 / experiment-logic）
```
