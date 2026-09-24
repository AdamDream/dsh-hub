# U-BOOT2 两段式启动断言 —— 修订执行复核一体 交付报告

> 线：`exec-boot2`（唯一交付单元 **U-BOOT2**）
> 日期：2026-09-22｜工作区：`/home/CNS2026495165/dsh/.workspace/lag-fix/exec-boot2/`
> 纪律：**未使用 `sandbox_permissions`**（本会话审批已禁用）；**未写任何产品文件**（沙箱 `workspace-write`，全程核对
> 产品 shell 的 sha1-12 始终为 `6a27728a8730`）⇒ **`deployed` 写入由协调者执行**（见 `DEPLOY.md`）。
> 最终候选件：`candidates/C-dsh-web-frontend-index-ClqxG24t.js`（409,299 B，sha1-12 `29e6dacfe2c4`）

---

## §0 结论摘要（先看这段）

**同档自复核：`PASS`（10/10 判据，判定器 `raw/verdict-boot2-final.json`），但含一条必须由协调者裁决的审计偏离（§10）。**

最终一轮（单次运行、`--reps 3`、39 相位、持锁、`oneBrowserOnly=true`）实测：

| 臂 | A 中位（前后各 3 rep） | B 中位（扣 pptmaster +1500 ms） | **Δ_deferred** | B2 中位（扣 ui-theme +1500 ms） | **Δ_essential** |
|---|---|---|---|---|---|
| `baseline`（原始字节） | 363.4 ms | 1844.4 ms | **+1481.0 ms** | 1777.9 ms | **+1414.5 ms** |
| **`conservative`（补丁默认）** | 308.7 ms | 252.6 ms | **−56.1 ms**（归一化 −31.5；`mountApp` 自计时 −84.9） | 1650.0 ms | **+1341.3 ms** |
| `legacy`（`tier="all"`，开关方向 A） | 403.6 ms | 1779.7 ms | **+1376.1 ms** | — | — |

| # | 判据 | 实测 | 结论 |
|---|---|---|---|
| C1 | 基线扣住非首屏包 ⇒ 挂载**应位移** | **+1481.0 ms**（与 `exec-boot` 的 +686.5 ms 同向、同量级；本机更快故位移更充分） | PASS |
| C2 | 补丁默认模式扣同一包 ⇒ **不应再位移** | **−56.1 ms**（归一化 −31.5，`mountApp` −84.9） | PASS |
| C2b | 与 exec-boot 完全同口径的**绝对** `frame_layout` 位移对比度 | 1481.0 − 56.1 = **1424.9 ms** | PASS |
| C3 | **阴性对照**：扣住首屏必需包 | **+1341.3 ms** | PASS |
| C4 | 开关方向 A（`tier="all"`）⇒ 恢复旧行为 | **+1376.1 ms** | PASS |
| C5 | **整屏可渲染**（协调者新硬要求） | 补丁臂 **12/12** 相位（`baseline` 12/12、`legacy` 9/9） | PASS |
| C6 | 功能零回归 | 唯一 bundle id **50** == manifest **50** == loader 条目 **50** == `activatedCount` **50**，`mode=live`，`state=ok`，0 pageerror / 0 console error | PASS |
| C7 | 延后包失败 ⇒ **响亮上报** + 外壳可用 | 横幅 + `console.error` + 全局对象 + 整屏可渲染 | PASS |
| C8 | 必需包失败 ⇒ **启动硬失败** | `mountMs=null`（从未挂载）+ 启动卡显示错误 | PASS |
| C9 | `tier="all"` 下延后包失败 ⇒ 仍硬失败 | `mountMs=null` + 报错 | PASS |
| X1 | 诊断：审计的 **12 条闭包**切分 | 3/3 相位**首屏渲染失败**（DOM 停在 114 节点、正文 0 字、无侧栏/输入框），而 50 包**全部 active** | **证伪**（§10） |

**一句话**：扣住一个 **4.1 MB、首屏完全用不到**的插件包 +1.5 s，基线让挂载晚 **1481 ms**，
补丁后 **−56 ms（≈0，即不再位移）**；同时**必需包失败仍然硬失败**、**延后包失败响亮上报**、**整屏可渲染、50 包零回归**。

### ⚠️ 必须裁决的偏离（详见 §10）

授权书写的"首屏闭包 = 审计的 **12 条 / 1.30 MB**"**不能直接用**：实测该切分会让 shell 在 `mountApp` 之后抛
`'root' has no registration — a layout entry must register into 'root' before the shell renders it`，**整屏只剩壁纸**。
⇒ 默认集合改用**审计自己的 `static-inventory.json` 分类**（延迟 = `deferrable=yes` 去掉 `immediately` 行 =
**20 条 / 5,431,021 B**；其余 **30 条必需**，含注册 `root` slot 的 `@deepseek-ai/dsh-client-ui-layout`），
这正是**审计 §C1 收益口径**（关键路径 −5.43 MB / −46%）对应的集合。契约字面的 12 条切分作为
**诊断模式 `tier="wire12"`** 保留，可随时复现证伪。

---

## §1 交付物清单

| 路径 | 内容 |
|---|---|
| `candidates/C-dsh-web-frontend-index-ClqxG24t.js` | **最终补丁候选件**（409,299 B，sha1-12 `29e6dacfe2c4`，sha256 `4093b7f44fbe1c44…`） |
| `candidates/ALT-v2-rAFgate-C-dsh-web-frontend-index-ClqxG24t.js` | 备选候选件（v2，rAF 闸门版，408,800 B，sha1-12 `855b226617b6`）——亦已全判据 PASS（`raw/verdict-boot2-merged.json`） |
| `candidates/preimage/…` | 自测用 pre-image |
| `scripts/apply-Boot2-v1.mjs` | 补丁脚本（dry-run 默认 / `--apply` / `--rollback` / `--out-copy` / 锚点唯一 / 自动 pre-image / `node --check` / 幂等） |
| `scripts/selftest-boot2.mjs` | 逻辑单测 24 条（在 headless DOM 内执行候选件抽出的方法块） |
| `scripts/probe-boot2.mjs` | 端到端探针（三臂 A-B-A + 三失败臂 + 整屏可渲染 + 四道窗口门禁 + LoAF/rAF/页内阳性对照） |
| `scripts/analyze-boot2.mjs` | 离线判定器（10 判据 + 归一化口径 + 中位/离散 + 多遍合并 + 缺臂 N/A） |
| `scripts/lib-browser-identity.mjs` | 浏览器身份/存活/普查（cmdline 口径） |
| `scripts/recon-boot2.mjs`、`scripts/build-manifest.mjs` | 结构侦察 / 交付清单生成 |
| `DEPLOY.md` | 部署 · 开关 · 回滚 · 维护代价 · 验收链 · 已知风险 |
| `raw/probe-boot2-final.json`（+ `.partial`） | **最终一轮原始 JSON**（39 相位，1500 ms 注入，含窗口级有效性） |
| `raw/verdict-boot2-final.json` | **最终判定结果**（10 判据 + 逐臂统计 + 逐相位整屏证据 + 逐相位原始值） |
| `raw/probe-boot2-full1|pass2|pass3|pass4.json`、`raw/verdict-boot2-full1|pass2|pass3|merged.json` | 迭代历史（见 §6.3） |
| `raw/selftest-*.json`、`raw/boot-manifest.json`、`raw/served-index.html`、`raw/recon-*.json`、`raw/sandbox/` | 单测 / boot manifest / 服务端 HTML / 侦察 / 反向用例沙箱 |
| `evidence/boot2-*.png`（68 张） | 截图证据（基线 / 补丁 / 三失败臂 / 证伪臂） |
| `MANIFEST.json` | 交付清单（路径 / 字节 / sha256 / 角色） |

---

## §2 授权硬约束 → 落地映射

| 用户硬约束 | 落地位置（`dist/assets/index-ClqxG24t.js` 补丁后行号） | 证据 |
|---|---|---|
| 保持"必需包未加载 ⇒ 启动失败"语义不变 | `runPluginBoot`（94）：必需集合 `await Promise.all(create)` → `await l.await()` → `assertEntriesActive(n, essential)`（**同一函数、同一错误文本**） | §5 T8/T9/T9b；§7 C8 |
| 只把**非首屏包**移出 `mountApp` 之前的等待 | `startDeferredTier(c)`（146）在 `run()` 尾部 `await this.mountApp(c)` **之后**调用且**不 await** | §6 C2 |
| 延后集合失败必须**响亮上报** | `reportDeferredFailure`（186）+ `renderDeferredFailure`（192）：`console.error` + 固定红色横幅 + `globalThis.__DSH_BOOT2_REPORT__` + `data-*` 属性 | §7 C7 + 截图 |
| 保留一个开关可一键恢复旧行为 | 常量 `BOOT2_DEFAULT_TIER`（126）+ 运行时 `globalThis.__DSH_BOOT2__={tier:"all"}` | §5 T4/T4b/T6；§6 C4；§7 C9 |
| （追加）**整屏可渲染**验收 | 见 §8：逐相位 `#root` 矩形/网格/可见元素/会话区/正文/`pageerror`/console error | §8 C5 |

---

## §3 实现（三处锚点，全部**唯一命中**）

目标：`<dsh>/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-ClqxG24t.js`
**399,361 B → 409,299 B（Δ9938）**，sha1-12 `6a27728a8730` → `29e6dacfe2c4`

| 锚点 | 原文（唯一 ×1） | 改为 |
|---|---|---|
| A1 | `const u=this.prefetchImmediateTier(),c=new Ae;this.ctx=c,await this.runPluginBoot(c,u),await this.mountApp(c)` | 尾部追加 `,this.startDeferredTier(c)` |
| A2 | `async runPluginBoot(n,i){` | 替换为两段式实现 + 新增 8 个成员 |
| A3 | `;const da=document.getElementById("root")` | 替换区间右界（要求区间以「方法收尾 `}` + 类体收尾 `}`」结束，否则拒写） |

补丁后位置（`file:line`）：

| 位置 | 行 | 说明 |
|---|---|---|
| `runPluginBoot` | 94 | 必需集合在挂载前断言；`tier="all"` 走原全量路径 |
| `BOOT2_DEFAULT_TIER="deferred"` | **126** | **开关常量**（文件内改回 `"all"` 即恢复旧行为） |
| `BOOT2_DEFERRED_ALLOWLIST=[…20 个 id…]` | **127** | 可延后白名单（审计 `deferrable=yes` − `immediately`）；**未知 id 一律必需**（安全方向） |
| `bootTiers()` | 115 | 三模式 `deferred` / `wire12`（诊断）/ `all`（旧行为）+ `globalThis.__DSH_BOOT2__.deferredAllow` 覆盖 |
| `startDeferredTier(n)` | **146** | 记录 `mountAppEnd`、写 `documentElement[data-dsh-boot2-mode]`、**不阻塞 `run()`** |
| `loadDeferredTier(n)` | 154 | **启动闸门**（156）：轮询 `[data-dsh-boot]` 启动卡消失（= React `createRoot` 已清空 `#root`，应用已接管容器）→ `requestIdleCallback(600)`；另挂 **1500 ms 硬兜底**（挂载失败 / 隐藏标签页 / 无 rAF 也一定会启动 ⇒ 不会把"延后"变成"静默缺失"） |
| `reportDeferredFailure(failed)` | **186** | `console.error("web boot: N deferred plugin(s) failed to load — …")` + 全局对象 |
| `renderDeferredFailure(failed)` | **192** | 横幅 `div#dsh-boot2-deferred-failure`：`role="alert"`、`position:fixed;top:0;z-index:2147483647`、背景 `#b3261e`、`data-dsh-boot2-failed-count` / `-failed-ids`、可点 `×` 关闭 |
| `countActive(n)` | 218 | 统计 loader 条目总数 / active 数（零回归证据） |
| `assertEntriesActive(n,i)` | **228** | 按集合断言；`i===void 0` 时与原实现**逐字一致** |

**为什么只能改 dist**：产品包 `package.json` 的 `files` 只有 `["lib/*.js","config"]`，安装树内无 `apps/`、`packages/`、`src/`，
全机 `find` 未找到 `dsh-web-frontend` 源码目录 ⇒ **无法从源码重建**该 Vite 产物。
**维护代价**：`dsh` 升级以新哈希文件名覆盖 ⇒ 补丁静默失效，须重跑 dry-run 看 `ANCHOR_FAIL`；
本补丁**改内容不改名**，而该资源实测**无 `cache-control`/`ETag`** ⇒ 部署后需硬刷新。

---

## §4 阶段一：静态自证（真跑）

```
$ node scripts/apply-Boot2-v1.mjs                    # dry-run（默认不写）
[OK] …/dist/assets/index-ClqxG24t.js
   bytes 399361 → 409299 (Δ9938)  sha1_12 6a27728a8730 → …
   anchors: 1× A1 | 1× A2 | 1× A3
   syntax: OK
   frame: OK  preserveErrorText=true
```

| 自证项 | 结果 |
|---|---|
| 锚点唯一命中 | 三锚点各 **1×** |
| 写前 `node --check` | **OK** |
| 结构自检（类体收尾/模块收尾/9 成员/错误文本保留） | `frame: OK  preserveErrorText=true` |
| 幂等 | 对已补丁文件再跑 ⇒ `ALREADY_APPLIED`，不写文件 |
| `--apply`（沙箱副本） | 写入 == 候选件哈希，pre-image 自动生成，`verified=true` |
| `--rollback` | `ROLLED_BACK`，sha1-12 回到 `6a27728a8730`，`verified=true` |
| **锚点不唯一 ⇒ 一个文件都不写** | 人为重复 A2 ⇒ `ANCHOR_FAIL`，**文件字节不变**（`8e186b42b52b`），pre-image 不新增 |
| 无锚点 / 空文件 | `ANCHOR_FAIL`（各 0×），文件保持原样 |
| **产品文件全程未被触碰** | sha1-12 恒为 `6a27728a8730` |

---

## §5 阶段二：逻辑单测 **24/24 PASS**

`node scripts/selftest-boot2.mjs`：把候选件 `BEGIN..END` 之间的方法块**原样抽出**，在真实 headless DOM 里执行。

| 断言 | 结果 |
|---|---|
| T1 默认必需集合 == 30 条 | PASS |
| T1b 默认延后集合 == 20 条 | PASS |
| T1c 审计 12 条闭包是默认必需集合的**真子集** | PASS |
| T1d **`root` slot 注册者 `dsh-client-ui-layout` 默认必需** | PASS |
| T1e 延后集合 == 审计 `deferrable=yes` − `immediately`（逐条相等） | PASS |
| T2 默认必需字节 == 8,262,805 − 5,431,021 = 2,831,784 | PASS |
| T2b `wire12` 必需字节 == **1,304,799**（复现审计数字） | PASS |
| T3 默认 tier == `"deferred"` | PASS |
| T4 开关四态 `all`/`deferred`/`wire12`/未设置 | PASS |
| T4b `wire12` **逐字复现**审计 12 条闭包 | PASS |
| T4c `wire12` 把 `root` slot 注册者延后（= 被证伪的切分） | PASS |
| T5 默认只 `create` 30 条、`page.total=30`、`deferredIds=20` | PASS |
| T5b `wire12` 只 `create` 12 条 | PASS |
| T6 `tier="all"` ⇒ `create` 全部 50 条、`deferredIds=[]`、`total=50` | PASS |
| **T7 延迟包 inactive ⇒ 集合断言不抛** | PASS |
| **T8 同一情形在全量口径下仍抛** | PASS |
| **T9 抛错文本与原实现逐字一致** | PASS |
| T9b 必需包 inactive ⇒ 集合断言抛 | PASS |
| T10a–d 失败上报四通道（全局状态 / console / 横幅 DOM+属性 / 全局别名同一对象） | PASS |
| T11 横幅可关闭 | PASS |
| T12 全成功 ⇒ `state="ok"`、无横幅、无 `console.error` | PASS |

---

## §6 阶段三：端到端双判据实测（**真跑**）

**器械**：`scripts/probe-boot2.mjs`。headless chromium（单浏览器进程），用 CDP `Fetch.fulfillRequest`
**在浏览器内**把产品 shell 字节替换为候选件字节 ⇒ **产品文件始终未改**。
每臂相位序列 `A1×3 → B×3 → B2×3 → A2×3`；`B`/`B2` 各注入 `+1500 ms`。
**挂载时刻口径与 `exec-boot` 的 `boot-causal` 逐一相同**：`pred:frame_layout = document.querySelector('[class*="sidebarCol"]')`。

### 6.1 主结果（`raw/verdict-boot2-final.json`）

| 臂 | A 中位（6 值） | B 中位（3 值） | B2 中位（3 值） | Δ_deferred | Δ_essential | 有效窗 |
|---|---|---|---|---|---|---|
| `baseline` | 363.4 ms | 1844.4 ms | 1777.9 ms | **+1481.0** | +1414.5 | **12/12** |
| `conservative` | 308.7 ms | 252.6 ms | 1650.0 ms | **−56.1** | **+1341.3** | **12/12** |
| `legacy` | 403.6 ms | 1779.7 ms | — | **+1376.1** | — | **9/9** |
| `wire12`（诊断） | — | — | — | — | — | 0/3（渲染失败 ⇒ 门禁④必然不成立） |

逐相位原始值（`frame_layout`，ms）：

- `baseline` A = `[344.0, 351.8, 363.0, 363.7, 381.6, 1725.3]`（末值遇争用），B = `[1828.1, 1844.4, 1996.6]`，B2 = `[1769.8, 1777.9, 1802.6]`
- `conservative` A = `[235.8, 240.3, 297.6, 319.8, 338.1, 1934.2]`（末值遇争用），B = `[248.4, 252.6, 287.6]`，B2 = `[1645.1, 1650.0, 1657.6]`
- `legacy` A = `[354.0, 376.9, 397.7, 409.6, 427.8, 1386.3]`，B = `[1772.2, 1779.7, 1882.8]`

**结论**：
1. **解耦**：同一非首屏包被扣 1.5 s，基线位移 **+1481 ms**，补丁后 **−56 ms**（≈0，甚至略负 = 噪声内）；
   contrast = **1424.9 ms**。`mountApp` 自计时 Δ = **−84.9 ms**（归一化 −85.6）→ 挂载本身完全解耦。
2. **阴性对照**：扣住首屏必需包 `@deepseek-ai/dsh-client-ui-theme`（闭包成员、非 head 脚本），
   补丁后仍位移 **+1341.3 ms** ⇒ **断言没被弱化**，不是"把所有东西都变惰性"。
3. **开关方向 A**：`tier="all"` 时位移回到 **+1376.1 ms**（与基线同量级）。
4. **注入如实生效**：B/B2 相位 `heldRequests` 记录到唯一一条 `hold/1500 ms`（pptmaster / ui-theme 各自的 URL）。

### 6.2 判据口径的两点方法学修正（本档主动，已披露）

1. **归一化口径**：本机页首延迟实测 `DOMContentLoaded` 27→710 ms（**26×**），它把某个相位整体平移，
   而 A-B-A 无法抵消（争用与相位顺序无关）。故增加主口径
   **归一化挂载时刻 = 挂载谓词 − DOMContentLoaded**：
   `conservative` Δ = **−31.5 ms**，`baseline` Δ = **+1480.6 ms**。
   **原始口径（与 exec-boot 完全同口径）也并列给出**，两者结论一致。
2. **启动闸门修正（v1→v3）**：初版在 `mountApp` 返回后立刻 `requestIdleCallback(250 ms)` 并发拉 20 个包，
   实测出现**首帧竞态**——延迟包的解析/执行与外壳首个提交抢主线程，个别相位把首屏谓词推迟 ~280–520 ms
   （见 §6.3 的 pass2/pass3）。改为**等外壳自己的 DOM 契约**（启动卡 `[data-dsh-boot]` 被 React 清空
   ⇒ 应用已接管容器）再进入空闲，并挂 1500 ms 硬兜底 ⇒ 最终一轮 B 相位离散度收敛到 248–288 ms。

### 6.3 迭代历史（每一步都有独立原始 JSON，便于复核）

| 轮次 | 候选件 | 臂覆盖 | 原始口径 Δ_deferred（基线 → 补丁） | 备注 |
|---|---|---|---|---|
| `full1`（1500 ms，reps=3） | v1（rIC-250 闸门） | 全部 | +1053.0 → **+13.7** | 9/9 判据 PASS；**最终 JSON 写出时崩于 `SETTLE is not defined`**（已修），证据以 `.partial.json` 保留 |
| `pass2`（reps=1） | v1 | 全部 | +1330.2 → +521.2 | 暴露首帧竞态；同时暴露 `frame_layout` 在补丁臂可能**早于** `mountApp` 出现 |
| `pass3`（reps=3） | v2（2×rAF 闸门） | baseline + conservative | +1329.2 → **+284.7**（归一化 +10.3） | 竞态减轻但未消除 |
| `pass4`（reps=3） | v2 | legacy + wire12 + 3 失败臂 | +1620.3（legacy） | 与 pass3 合并 ⇒ `raw/verdict-boot2-merged.json` **PASS 10/10** |
| **`final`（reps=3）** | **v3（启动卡闸门）** | **全部** | **+1481.0 → −56.1**（归一化 −31.5） | **`raw/verdict-boot2-final.json` PASS 10/10 = 交付口径** |

### 6.4 窗口有效性（四道门禁 + 并发标注）

| 门禁 | 实现 | 最终一轮实测 |
|---|---|---|
| ① 窗口内心跳 | 2 s 心跳，tick ≥3 且最大间隔 < 6 s | 全部相位 PASS（`heartbeatMaxGapMs ≈ 2000`） |
| ② 浏览器 pid 存活 | `/proc/<pid>` + `stat` ∉ {Z,X} + cmdline 非空（**绝不 `readlink(exe)`**） | `browserPid=2948582`，`browserDeathMidWindow=false`，`heartbeatTicks=229` |
| ③ 单浏览器普查 | cmdline 口径主进程普查 | `lockHeld=true`、`lockWaitedS=0`、`oneBrowserOnly=true`、`censusEnd.foreignMains=1`（他线浏览器，已标注）、`loadavg 6.39→4.08` |
| ④ **链底座存在** | **等待条件与门禁同口径**：`frame_layout ∧ [role=treeitem] ≥ 12 ∧ DOM 节点 ≥ 570` | 计时臂 12/12、9/9 全通过（`treeitemRows=14, domNodes=596`） |

> 门禁④是本档**主动加的第 4 道**（`exec-proj` 新发现）。第一轮曾有 1 个相位（`baseline/B#1`）
> 因 32 s 内未收敛被弃（当时"等待条件只要求会话行存在"与门禁不同口径，已修正为同口径）；
> 最终一轮**无任何 invalid 相位**。

---

## §7 失败路径真跑（三条，均有截图）

### C7 延后包失败 ⇒ **响亮上报** + 外壳可用（`fail-deferred`）

人为让 `@local/dsh-pptmaster` 的 bundle 请求 `Fetch.failRequest(Aborted)`（最终一轮）：

| 通道 | 实测 |
|---|---|
| 全局对象 | `__DSH_BOOT2_REPORT__.state="deferred-failed"`，`failed=[{id:"@local/dsh-pptmaster", reason:"entry missing after create"}]` |
| `console.error` | `web boot: 1 deferred plugin failed to load — the shell is running, these features are missing` + `@local/dsh-pptmaster: entry missing after create` |
| **可见横幅** | `div#dsh-boot2-deferred-failure`、`role=alert`、1620×72 固定顶部、`data-dsh-boot2-failed-count="1"`、`data-dsh-boot2-failed-ids="@local/dsh-pptmaster"`；文案 `⚠ 1 个插件加载失败 / 1 plugin failed to load …` + `外壳仍可用；详情见控制台 / Shell is usable; see the console for details.`（可关闭） |
| **外壳仍可用** | `mountMs=234.7`（挂载已发生）、`visibleElementsInRoot=268`、会话行 2、项目行 11、正文 408 字、**`pageErrors=0`** |
| 截图 | `evidence/boot2-fail-deferred-F-final.png`（视觉复核：红色横幅 + 完整可用外壳，无其它报错） |

### C8 必需包失败 ⇒ **启动硬失败**（`fail-essential`）

让闭包成员 + head 脚本 `@deepseek-ai/dsh-client-runtime` 请求失败：
`mountMs=null`（**从未挂载**）、启动卡仍在、可见
`failed to import loader entry c009b261 (@deepseek-ai/dsh-client-ui-theme): client-modules: require("@deepseek-ai/dsh-client-runtime/client") missed the module table …`
⇒ **"必需包未加载 ⇒ 启动失败"语义与改动前一致**。
截图 `evidence/boot2-fail-essential-F-final.png`（视觉复核：`HARNESS` / `Failed to load plugins` / 错误文本）。

### C9 `tier="all"` 下延后包失败 ⇒ **仍硬失败**（`fail-legacy-deferred`）

`tier="all"` + pptmaster abort ⇒ `mountMs=null`，可见
`failed to import loader entry c8242f8b (@local/dsh-pptmaster): client-modules: bundle script … failed to load`
⇒ 证明"可延后"只是**新模式**属性，**不是被静默吞掉**；开关确实整体切回旧行为。
截图 `evidence/boot2-fail-legacy-deferred-F-final.png`。

---

## §8 整屏可渲染判据（协调者追加硬要求）

逐相位落盘。判据 = `#root` 矩形 > 200×200 ∧ 视口 5×5 网格 ≥20 点落在 `#root` 内 ∧ `#root` 内可见元素 ≥150
∧ 会话区容器存在 ∧ 会话行或项目行 > 0 ∧ 正文文本 > 200 字 ∧ `pageerror===0` ∧ console error 0。

| 臂 | 通过率 | 关键读数 |
|---|---|---|
| `baseline` | **12/12** | 可见元素 273 量级、会话区 1、会话行 3、项目行 11、正文 >200 |
| `conservative` | **12/12** | 会话区 1、正文 >200、`pageErrors=0`、`consoleErrors=0`、无横幅 |
| `legacy` | **9/9** | 同上 |
| `wire12`（诊断） | **0/3** | 可见元素 **0**、`domNodes=114`、正文 **0** 字、无侧栏/输入框/会话行 |

> ⚠️ **阈值标定**：探针运行时阈值原为 `visibleElementsInRoot ≥ 300`，而 **baseline（未打补丁）实测 273**
> ⇒ 该阈值连原始产品都会判 false。判定器对**所有臂**统一改为 **≥150** 并重算（`verdict.*.calibration` 记录）。
> 运行时 300 的中间数值未被用于任何结论。

**视觉复核（`analyze_image`）**：
- `evidence/boot2-conservative-A1-final.png`：完整外壳（侧栏项目/会话树、主区空态、底部输入框），**无红色横幅、无报错**。
- `evidence/boot2-wire12-A1-final.png`：**只剩整屏壁纸插画，零 UI 元素**（与 `visible=0`、正文 0 字一致）。

---

## §9 功能零回归证据（`conservative` 臂，最终一轮）

| 项 | 期望 | 实测 |
|---|---|---|
| 唯一 bundle id 数 | == manifest 条目数 | **50 == 50**（`bundleRequestCount=50`；`/plugins/events` 是 SSE 端点，已排除以免出现"51"假多余项） |
| loader 条目数 | 50 | **`loaderEntries=50`** |
| 最终 active 数 | 50 | **`activatedCount=50`**（`stateTally.active=50`） |
| `__ModuleLoader__.mode` | `live` | **`live`**（`pendingQueueLen=0` 只作观察，不作判据） |
| 延后层状态 | `ok`、0 失败 | **`ok` / `failures=0` / 无横幅** |
| 首屏谓词 | 与 exec-boot 同口径 | `frame_layout` 中位 **308.7 ms**（同窗基线 363.4 ms；扣包相位 252.6 vs 基线 1844.4） |
| pageerror / console error | 0 / 0 | **0 / 0** |
| 关键 UI 文本 | 非空 | 正文 408 字（含项目/会话标题） |
| 启动卡 | 挂载后被清除（不是遮挡层） | `bootCardPresent=false`、`rootChildren=1`（侦察确认 React `createRoot` 清空 `#root`） |

---

## §10 关键发现：审计的"12 条首屏闭包"**不成立**（偏离与理由）

**实测（`tier="wire12"`，最终一轮 3/3 相位一致）**：

| 事实 | 读数 |
|---|---|
| 50 个包是否加载 | **全部成功**：`activatedCount=50`、`loaderEntries=50`、`uniqueBundleIds=50`、`state="ok"` |
| 首屏是否渲染 | **没有**：`pageerror = 'root' has no registration — a layout entry must register into 'root' before the shell renders it` |
| DOM | `domNodes=114`、正文 **0 字**、`sidebarCol=0`、`composer=0`、`sessionRow=0`、可见元素 **0** |
| 截图 | `evidence/boot2-wire12-A1-final.png`（只剩壁纸） |

**根因**：审计的 12 条来自 **wire `inject` 图 + `immediately`** 的传递闭包，表达的是**服务依赖**；
首屏渲染还需要**槽位注册**（`root` slot）——`@deepseek-ai/dsh-client-ui-layout` 注册 `root@520`，
它既不是 `immediately`，也不被任何 `immediately` 行的 `inject` 引用 ⇒ **在 wire 图里不可见**，
12 条闭包必然漏掉它。而审计自己的 `static-inventory.json` 已把它标为
`category=shell_essential / deferrable=no`——**审计 §C1 的"断言范围"措辞用 12 条闭包，
其"收益口径"（−5.43 MB / −46%）用 `deferrable=yes` 集合，两处内部不一致**。

**本档处置（保守方向，请裁决）**：
1. 默认集合 = **审计自己的 `deferrable` 分类**：延后 = `deferrable=yes` − `immediately` ⇒
   **20 条 / 5,431,021 B（全部 client JS 的 65.7%）**；其余 **30 条必需**（含 `ui-layout`、`ui-sidebar`、
   `ui-conversation`、`ui-workspace`、`ui-brand-official` 等全部 `shell_essential` 与全部 `partial` 行）。
2. **未知 id 一律按必需处理**（安全方向）⇒ 新装插件不会被误延后。
3. 契约字面的 12 条切分以 **`tier="wire12"` 诊断模式**保留，可随时复现证伪。
4. 该处置**只放宽"必需"的范围**（更多包留在挂载前断言），**不放宽语义** ⇒ 与"必需包未加载 ⇒ 启动失败"
   方向一致；C4/C8/C9 证明旧行为与硬失败语义完好。

---

## §11 失败 / invalid / 仪器缺陷（诚实清单）

1. **审计 C1 的必需集合有误**（§10）——结论性偏差，非仪器问题。
2. **探针 v1 最终 JSON 写出崩于 `SETTLE is not defined`**（重命名遗漏一处引用）：已修；该轮证据以
   `raw/probe-boot2-full1.partial.json` 完整保留（缺窗口级 `windowValidity`，已由 `pass2`/`final` 补齐）。
3. **首帧竞态**（v1/v2）：见 §6.2/§6.3，v3 用启动卡闸门解决。
4. **`baseline/B#1`（第一轮）invalid**：32 s 内链底座未收敛，按门禁④弃窗；等待条件已改为与门禁同口径，
   最终一轮 **0 invalid**。
5. **`wire12` 臂 0/3 有效窗**：渲染失败 ⇒ 门禁④必然不成立；该臂只用"全部相位"读数列出，明确它是**证伪实验**。
6. **本版 Playwright 无 `Browser.process()`**（`typeof === "undefined"`）⇒ `exec-boot` 的
   `probe-decoupling.mjs` 里 `browser.process()?.pid` 是**未运行才没暴露的缺陷**；本档改用
   "启动前后主进程集合差分 + cmdline 口径"。
7. **`Emulation.setCacheDisabled` 在本版不存在**（Protocol error）⇒ 改 `Network.setCacheDisabled`（best-effort）。
8. **`__REACT_DEVTOOLS_GLOBAL_HOOK__` 不存在** ⇒ 链底座改用 `[role=treeitem] ≥ 12 ∧ DOM ≥ 570`。
9. **跨臂绝对 ms 不可比**（宿主争用+漂移严重：同臂 A 相位 236→1934 ms）⇒ 结论一律用**同臂内 A-B-A**；
   跨臂比较仅作趋势参考并已标注。
10. **锁竞争**：多次遇到 `exec-a11y` / `w29` / `exec-blurfix` / `exec-hmr` 持锁 ⇒ **只等待、绝不回收存活者的锁**；
    一次自身崩溃残留的锁（owner pid 确证 DEAD）由本档清理。
11. **`frame_layout` 在补丁臂可能早于 `mountApp`** 出现（因 layout 插件在挂载前已 active 并渲染进容器）
    ⇒ 该谓词不是"mountApp 完成"的严格同义词；故同时给出 `mountApp` 自计时（`__DSH_BOOT2_REPORT__.timings`）。
    两种口径结论一致（−56.1 ms / −84.9 ms）。

---

## §12 同档自复核（Revise-Execute-Review）

| 复核项 | 判定 | 依据 |
|---|---|---|
| 逐条对照授权硬约束 | **通过** | §2 映射 + §5/§6/§7 |
| 是否重新拆解/扩范围 | **未扩范围**；必需集合按**审计自身分类**修正并已上报 | 三锚点、单一文件、最小改动面 |
| 单元 1 两段式断言 + 响亮上报（含 file:line） | **通过** | §3 表 + §7 C7 四通道 + 截图 |
| 单元 2 开关，两方向实测 | **通过** | §5 T4/T4b/T6；§6 C4；§7 C9 |
| 单元 3 双判据真跑 | **通过** | §6.1：+1481.0 → −56.1；阴性对照 +1341.3 |
| 单元 4 功能零回归 | **通过** | §9：50/50/50、`live`、`state=ok`、0 pageerror |
| 单元 5 失败路径真跑 | **通过** | §7 三条 + 三张截图 |
| 追加要求：整屏可渲染 | **通过** | §8：12/12 + 视觉复核 |
| 副作用/回归 | **通过** | 同器械同窗对照；补丁臂无基线没有的报错；产品文件字节未变 |
| 未闭合项 | 2 项（非阻塞） | ① 固定阈值（0 console error / visible ≥150）的**跨机型**标定；② `wire12` 模式下 render 失败属**预期**，但它也说明"少 create 一条即抛错"的旧断言一旦被削弱成 12 条就会白屏——建议审计侧把这条写进方案约束 |

**自裁决：`PASS`（10/10，最终候选件 `29e6dacfe2c4`），附 §10 审计偏离待协调者裁决。**
若协调者坚持契约字面的 12 条切分，则应判 `REWORK`——但**那不是本档能安全落地的形态**：
`wire12` 实测为**整屏白屏**（§10），会直接复现 `exec-a11y` 那次"会话区不可见"的事故类别。

---

## §13 复现命令

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-boot2

node scripts/apply-Boot2-v1.mjs                 # 干跑：锚点/语法/结构自检（不写文件）
node scripts/apply-Boot2-v1.mjs --out-copy candidates/C-dsh-web-frontend-index-ClqxG24t.js
node scripts/selftest-boot2.mjs                 # 逻辑单测 24/24
node scripts/probe-boot2.mjs --reps 3 --tag final --shots   # 端到端（需共享锁；不回收他人锁）
node scripts/analyze-boot2.mjs --in raw/probe-boot2-final.json --out raw/verdict-boot2-final.json
node scripts/build-manifest.mjs                 # 交付清单
```

**部署 / 开关 / 回滚 / 维护代价 / 已知风险**：见 `DEPLOY.md`。
