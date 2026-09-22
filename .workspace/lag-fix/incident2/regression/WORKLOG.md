# incident2/regression — 工作记忆（WORKLOG）

> 供本线（regression）及其 2 个二级 subagent 共用。**磁盘是记忆**。
> 授权：本线独占 `.workspace/lag-fix/incident2/regression/`；宿主 10806 严禁重启/pkill；不改产品文件。

## 0. 任务（来自主 agent 的派发）

对「**全新页面 → 点设置**」这条路径做**页内只读 stub 的 A/B**（每条件 ≥3 次重复），逐面排除
「补丁未覆盖该路径」与「补丁引入新成本」：

1. 主题修复面：关掉签名跳过（强制每次重放）vs 保持修复
2. P2AC 面：恢复旧的无差别回拷（只读观测计数，必要时只在内存里替换函数）
3. R4 usage client 面：让 usage 卡片首挂载 9 路请求不发出
4. 主题 rAF 延后：theme-color meta 写回改同步
5. 补丁标记核对：四包 served rev vs 磁盘一致 + 补丁标记逐处列出；**某包未生效 = 最高优先级发现**
6. 输出「首开路径成本分布 + 各补丁贡献/缺失」+ **仍未被任何补丁覆盖的成本项**

交付：`audit.md` + 原始 JSON，逐条 PASS/FAIL/INCONCLUSIVE。**stub 必须自证生效（对比计数）**。
纪律：单浏览器、锁协议同目录（`research-v2/.probe.lock`）、只点设置/关闭/设置页导航、不点保存/应用/删除。

## 1. 已完成的既有结论（不要重复劳动）

### 1.1 起跑状态（10:06 宿主重启，冷面批次已生效）
- 宿主 PID `10806`，`node .../bin/dsh web`，重启于 2026-09-22 10:06:16。
- `curl http://127.0.0.1:3080/` = HTTP 200。
- 探针锁 `research-v2/.probe.lock` 原属 `incident2-live-repro` 的 **PID 15894（已死，陈旧锁）**，
  本线已接管。

### 1.2 面5（rev/标记核对）— 已完成，脚本 `verify-revs.mjs`，结果 `verify-revs.json`
| 面 | 包 | served rev | 磁盘 sha1-12 | 一致 | 补丁标记 |
|---|---|---|---|---|---|
| 主题/U-TP | `@deepseek-ai/dsh-client-ui-layout` | `82cca1a6178a` | `82cca1a6178a` | ✅ | **无** `/* dsh-perf-fix */` 类标记（见下 G1） |
| 主题/U-TP | `@local/dsh-wallpaper` | `826d9217a8fc` | `826d9217a8fc` | ✅ | **无** 标记 |
| P2AC | `@deepseek-ai/dsh-client-runtime` | `5559de4ce28c` | `5559de4ce28c` | ✅ | `/* p2ac-fix */` ×4；另含历史 `/* dsh-perf-fix P1 v1 */`、`P2 v1` ×2 |
| R4 usage client | `@local/dsh-usage`（client 面） | `4536b91ed282` | `4536b91ed282` | ✅ | `/* dsh-perf-fix R4 v1 ... */` ×1；`/* dsh-perf-fix A-gating-fix v1 */` ×1 |

- client-runtime 的真实路径是
  `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js`
  （不是 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh-client-runtime/…`，该路径不存在）。
- usage client 路径 `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/client.js`。

### 1.3 热面补丁的文本落点（已 diff 确认，来自 pre-image 对照）
- `exec-theme/backup/20260921092148./layout.preimage.js` → live：+`themeColorRefreshQueue`/`themeColorFrame`/
  `scheduleThemeColorRefresh()`、`ThemePresenter.lastSignature/lastTokens/pendingTokenSignature/refreshedTokenSignature`、
  `apply()` 里 `signature === this.lastSignature && this.landingIntact(scheme, body)` 早退、`tokenSignature(entries)`、`f`…
- `exec-theme/backup/20260921092148./wallpaper.preimage.js` → live：+`shadedTokens` / `sameShadedTokens(left,right)`
  （wallpaper 第 179–182、204–205 行），`shadeTokens` 里相同内容不再重建 override 层。
- P2AC 在 client-runtime `projectList` 内：
  - `const chainRowIds = new Set(); /* p2ac-fix */`（9294）
  - `chainRowIds.add(childId); /* p2ac-fix */`（9301）
  - 回拷行 9329：`for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0 && chainRowIds.has(id)) byId[id] = previousProjection.byId[id];`
  - key-set 闸门 9345：`… && reusableByIdKeys.length === liveKeys.length && reusableByIdKeys.every(…)`
- usage client 首挂载 9 路 RPC（`lib/client.js` 910–915、920、950、965）：
  `summary`、`timeseries(day)`、`heatmap`、`byModel`、`byProject`、`byDay`、`timeseries(hour)`、`sessions`、`status`。

## 2. A/B 器械（本线自建，勿重复造）

`tools/firstopen-ab.mjs` —「全新页面 → 点设置」单窗口采集器。
`tools/stubs.js` — 全部页内只读 stub（经 `addInitScript` 注入页面内存）。

```
node tools/firstopen-ab.mjs --cond <base|tp-off|p2ac-old|usage-nofetch|theme-sync> \
     --label <输出标签> --settle 6000 --dwell 6000
```
- 输出 `raw/firstopen-<label>.json`；退出码 0=EXCLUSIVE，3=CONTENDED（窗口仍写出，判 INCONCLUSIVE）。
- 闸门：`ps` 里没有任何 foreign `--remote-debugging-*` 浏览器 **且** 本线持有 `research-v2/.probe.lock`。
  **同机多 agent 抢锁，`--gatemax 180000` 是必要的**（实测等待 8–21 s）。
- 三段口径：`phaseMount`（导航→settle）/ `phaseClick`（点设置→dwell）/ `rafClick`+`longtasks`。
- stub 自证：`stub.effective`（严格口径）+ `stub.pathReachableClick`（路径可达性，**两者必须分开看**）。
  `stub.effective=true 但 pathReachableClick.themeApplyRanInClick=false` ⇒ stub 生效、但**该补丁路径根本没跑**，
  这正是「补丁未覆盖该路径」型结论的证据。

### 面2 的机制（与其它面不同）
P2AC 改的是**包内闭包**里的实现，页内 API 拦不到 ⇒ 用 Playwright `page.route` 在**传输中**改写
`/plugins/@deepseek-ai/dsh-client-runtime/client.js` 的响应字节（**磁盘零改动**），两个替换锚点：
- `carry`：`… && chainRowIds.has(id)) byId[id] = …` → 去掉 `chainRowIds.has(id)`（恢复无差别回拷）
- `keygate`：去掉 `reusableByIdKeys.length === liveKeys.length &&`（恢复旧 key-set 行为）
命中数与 bytes 记在 `stub.routeHits`；锚点命中数 ≠1 会记进 `routeHits.bad`。

## 3. 已跑窗口（smoke，短窗口，**不足以作结论**）
| label | cond | gate | clickWall | raf/s | rafP99 | lt | scriptMs/s | recalcMs/s | 备注 |
|---|---|---|---|---|---|---|---|---|---|
| smoke-base | base | EXCLUSIVE | 42 ms | 60.10 | 16.8 | 0 | 0.08 | 0.004 | 全新页面点设置**很轻** |
| smoke-tpoff | tp-off | EXCLUSIVE | 44 ms | 60.06 | 16.8 | 0 | 0.083 | 0.006 | stubEff=false（见 §3 关键观察） |

### 关键观察（待决定性口径复核）
`mountWrites=1`、`clickReadbacks=0`、`forcedReplay=0`、`usageSeen=0` ⇒ 在**全新页面 → 点设置**上：
- 主题 `apply()` 在本窗口内几乎没被调用（未观测到重放）；
- `tp-off` 的强制重放闸门**一次都没触发**（所以那个窗口 `stubEff=false`，其数值不能当「强制重放」证据，
  只能当 base 的重复）；
- usage 9 路请求在全新页面**未观测到**（0 次）。

⇒ 强假设 H1：**全新页面 → 点设置这条路径上，四个补丁的靶点基本不执行**，
   用户「全新页面点设置仍卡」的成本不在主题重放 / usage 首挂载 / P2AC 回拷上。
   必须用「路径可达性」计数把 H1 钉死或推翻（`pathReachableClick`）。

## 4. 结论（已定稿，详见 `audit.md`）

**首开路径 = 客户端瞬时 + 宿主秒级。四个补丁的靶点在这条路径上基本不执行，既无收益也无新成本。**

### 4.1 客户端成本分布（42 窗口 / 40 EXCLUSIVE）
| 指标 | 值 |
|---|---|
| 点设置 → 面板可见 `overlay.msToVisible` | 12.9 – 22.7 ms（各条件中位 14.4 – 19.2 ms） |
| rAF 间隔 p99 | 16.6 – 16.8 ms（满 60 fps） |
| 长任务数 | **恒为 0** |
| 点击相位脚本 | 0.005 – 0.097 ms/s |
| 点击相位样式重算 | ≈ 0 ms/s |

### 4.2 逐面判定
| 面 | 条件 | 判定 | 关键证据 |
|---|---|---|---|
| 1 主题签名跳过 | `tp-off` 5窗 / `tpoff-armed` 3窗 | **INCONCLUSIVE** | stub 无自证 `tpTokenReadbacks=0`；`themeApplyRanInClick` 0 窗口为真 |
| 2 P2AC | `p2ac-old` 7窗 | **FAIL**（无可测贡献） | route 命中 1.0；+3.6% 区间重叠；无 chain 输入 |
| 3 R4 usage | `usage-nofetch` 6窗 | **INCONCLUSIVE** | `usageRequestsSeen=0`（卡片未挂载，9 路请求根本不发） |
| 4 主题 rAF 延后 | `theme-sync` 5窗 | **FAIL**（疑虑不成立） | stub 自证 5/5；`themeDeferScheduledByProdInClick=false`；−7.2% |
| 5 rev/标记 | — | **PASS**（rev）×**FAIL**（主题批无标记） | 四包 served rev == 磁盘 sha1-12 |

### 4.3 **未被任何补丁覆盖的成本项（已身份化）：宿主 RPC 排队延迟**
点击相位内逐 RPC 计时（`raw/firstopen-b2-*.json`，方法名取自请求体）：
| RPC | n | p50 | max |
|---|---|---|---|
| `session.list` | 3 | **8 712.7 ms** | **10 262.5 ms** |
| `subagent.list` | 4 | **3 548.2 ms** | 3 991.1 ms |
| `agentPreset.list` | 14 | 87.9 ms | 1 450.8 ms |
| `commands/list` / `skill.list` | 3 / 3 | 52.6 / 84.7 ms | ≤ 98.6 ms |

独立旁证（peer `host-click` 采样，`raw/host-degrade.json`）：宿主事件循环 p99 **283.7 / 298.4 ms**、
max **18.6 / 17.5 s**，吞吐从 1 009 次/分掉到 115–319 次/分。
⇒ **面板外壳 15 ms 就画出来了，数据在宿主里排了 3.5–10 秒的队。**
B1 最接近这条链（同为 `session.list`），但它改的是**算法复杂度**，不是**排队**。

### 4.4 口径警告（写给后续接手者）
- 宿主数字取自「同机 5–8 个并行 agent 线 + 多浏览器」的**合成负载**；本线自身就是负载的一部分。
  它证明「剩余成本由宿主排队解释」，**不能**直接外推为用户当时的卡。
- **本机已被证实存在与点击无关的宿主秒级停顿**（另一线基线：`max 18.6 s`、`≥100 ms 占 8.8%`，
  且与外部重命令 `zstd -19` **同窗**；本线独立复现 `/api/host.describe max 18 611 ms`）
  ⇒ **判定只能用「同运行内相对比较」，不得用绝对阈值**。本审计的判据已写成
  「同批 base 中位数作分母 + 组内区间重叠」。
- **`b2` 批并非全程独占**（自曝）：闸门的 `foreignCount==0` 只在**抢锁那一瞬**成立；
  逐窗口复核 `exclusiveThroughout = 0/14`，采集期各有 1–2 个外来浏览器并存
  （逐窗口记录见 `raw/loadavg-window.json`，批内 loadavg 5.5–7.2）。
  好在并存对**所有条件均等作用**，条件间相对比较仍有效；更强的反面证据是：
  在此并存负载下 14/14 窗口仍 `rafP99 16.6–16.8 ms`、**长任务 0** ⇒ 客户端对该负载不敏感。
- 器械曾被并行编辑（本线 3 进程 + 2 个二级 subagent 共用 `tools/*.mjs`）。二级 subagent 已冻结
  `tools/frozen-20260922T1023/`；**跨批比较只作方向性证据**，不要用于判定。

### 4.45 引擎 / DPR 口径（按 `gecko-vs-blink` 通知，已完成自证）
- **本线全是 Blink 口径**（`HeadlessChrome/131.0.6778.33`）。本线已**自行完成 longtask 阳性对照**：
  注入 1 次 150 ms 同步阻塞 ⇒ `longtask` 观测 **1 条、时长 150 ms**，`loaf` 亦 1 条
  （`tools/selfproof-engine-dpr.mjs`、`raw/selfproof-engine-dpr-r1.json`）
  ⇒ 「长任务恒 0」是**真实零**，不是通道缺失。
- **禁止跨引擎引用**：Gecko 会静默接受 `longtask`/`long-animation-frame` 的 `observe` 却永不投递条目
  ⇒ **「Firefox 无长任务」不是「不卡」**，本线不主张、不引用。
- **DPR 自证**：页内读回 `devicePixelRatio=1`、viewport `1280×720`、canvas backing/CSS `1:1`；
  **未**使用 `--force-device-scale-factor`。43/43 窗口面板 box 恒为 1280×720 ⇒ DPR 非混杂因素。
- 复现/继续测量时：若涉及 DPR 或视口，**每次运行都要页内读回 `devicePixelRatio` 并落盘**。

### 4.5 锁争用（协调者指令后的整改）
- 本线 `b2` 批为「**一次抢锁跑完 14 窗口**」（`batchSingleLockHoldMs = 264 157 ms`）——
  这正是要整改的模式；该批在收到指令前已结束且锁已释放。
- **此后本线不再启动任何浏览器窗口**，并已把「每 1–2 窗口释放重排 / 让位 minimal-page 与 live-repro /
  ≥3 分钟等待才可并发并标注 `concurrentWith` + loadavg」的要求转达给仍在持锁的二级 subagent。
- 本线全程**未**清理任何他人锁、**未** pkill 任何他人浏览器。
- 后续如需再测：**先查 owner.txt，若被 minimal-page / live-repro 持有，等下一轮**。

## 5. 并行 agent 边界（同机多线，避免互相污染）
`incident2/` 下另有 `host-click`（宿主事件循环 drift，纯观测）、`gc-residual`、`headed-vs-headless`、
`live-repro`、`static-events`、`theme-open`、`user-capture`、`first-open-profile`（owner PID 18998 已死）。
它们都会抢同一把浏览器锁 ⇒ 窗口判据必须带 `gate.outcome`，CONTENDED 一律 INCONCLUSIVE。
实测单窗口闸门等待：8.2 / 21.4 / 23.6 / 26.7 / 48.1 / 87.2 / 113.4 / **264.2 s**。
⇒ **单窗口器械在大负载下不可用**，请改用 `tools/firstopen-batch.mjs`（一次抢锁、窗口内多条件多重复）。
