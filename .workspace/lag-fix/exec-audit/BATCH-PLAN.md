# 落地批次计划（BATCH-PLAN）

- 日期：2026-09-21
- 决策者：协调者（主 agent）；每条单元标注**执行档 / 生效方式 / 依赖 / 验收**
- 共享事实源：`.workspace/lag-fix/research-v2/MEASUREMENT-STATUS.md`（数据可信度与撤回清单）
- 纪律：**deployed 写入一律由主 agent 用各档产出的补丁脚本执行**（子代理沙箱不可写工作区外）；脚本 `dry-run` 默认、锚点唯一命中才写、自动 pre-image + `node --check` + **引入标识符本文件内声明校验**

## 一、单元清单

| # | 单元 | 目标文件 | 档 | 生效 | 状态 |
|---|---|---|---|---|---|
| **U-TP0** | `ThemePresenter` 实例去重（消除同快照重放 2–6 次） | `dsh-client-ui-layout/lib/client.js` | `exec-theme` | 热面（刷新） | 执行档运行中 |
| **U-TP1** | 去掉/改写 `:378` 强制全文档重算（改为从快照取 `--dsw-alias-bg-base`） | 同上 | `exec-theme` | 热面 | 同上 |
| **U-TP2** | 内容签名跳过重放（三联前提：签名不含 `revision`、落地点守卫、首调不跳过） | 同上 | `exec-theme` | 热面 | 同上 |
| **U-TP3** | `overrideTokens` 内容比较（wallpaper 回响 + ui-theme 无条件 publish） | `dsh-wallpaper/lib/client.js`、`dsh-client-ui-theme/lib/client.js` | `exec-theme` | 热面 | 同上（可能拆下一批） |
| **U-IG1** | **ingest 移出宿主主线程**（worker/单飞；worker 自开连接、不可调 `resolveDbPath`） | `dsh-usage/lib/{ingest-worker,ingest-runner}.js` + `index.js` + `db.js` | `exec-audit/ingest` → 执行档 | **冷面（重启）** | 审计运行中 |
| **U-IG2** | 修 45s timer 未触发 | `dsh-usage/lib/index.js` | 同上 | 冷面 | 审计运行中；**依赖 U-IG1 先完成** |
| **U-IG3** | 修 `rebuildDailyForDays` 重复键（11/871 文件在空库复现；生产 1 例） | `dsh-usage/lib/db.js` | 同上 | 冷面 | 审计运行中 |
| **U-CC1** | CC 游标 off-by-one（静默丢记录）+ 遗留游标自愈 | `dsh-usage/lib/ingest-cc.js` | 已就绪（协调者实现） | 冷面 | **候选已生成并行为验证**（`LOSS→NO_LOSS`、`SELF_HEAL_PASS`） |
| **U-B1** | 冷排序 `?? createdAt` + id 消歧；running 计数 `childrenOf` 改由 `ctx.sessions.list()` 构建 | `dsh-host-apiproxy/lib/{index.js,types/api-proxy.js}` + 回放规格 v2 + **哨兵夹具同批更新** | `exec-b1` | 冷面 | 执行档运行中 |
| **U-P2** | P2 address-chain 残留（链域回拷 + 键集闸门，两处同修） | `dsh-client-runtime/lib/client.js` | `exec-audit/p2` → 执行档 | 热面 | 审计运行中 |
| **U-C2** | C2 投影签名门闸（可选小项 2.6→0.6 ms/s） | `dsh-workspace-enhancement/lib/client.js` | 待定 | 热面 | **降级为可选**（层成本仅 0.26–0.44% 单核） |

## 二、重启分组（尽量合并）

**冷面全部合并为一次重启**：U-IG1 + U-IG2 + U-IG3 + U-CC1（`dsh-usage` 四单元，**同一写入者**，避免半套状态）+ U-B1（apiproxy）。
**热面可先落**：U-TP0/1/2/3（layout/theme/wallpaper）、U-P2（runtime）、U-C2（可选）。
**顺序铁律**：**U-IG1 未完成且未验证"单轮不再阻塞主线程"之前，不得启用 U-IG2**（否则 = 每 45 秒冻 2.7 秒）。

## 三、已定裁决（不重开）

1. **`lib/types/api-proxy.js` 一并改**（运行时不可达，属一致性维护；规格里须标注）。
2. **A6 集合等式允许读 `~/.dsh/sessions` 首帧 header**（只读、≤1 chunk、不碰对话内容）。
3. **B① 用策略②B1**，否决 A2（`revision` 不透明，跨包改契约将破坏批次隔离）；"最近"窄化为"最近创建"须写进注释。
4. **B② 用策略①A2**，本批**不叠加** keep-set 豁免（独立产品决策）。
5. **主题速率取区间 4–23/s**（精确值交独占 P0 探针）；**不阻塞修复**。
6. **接受残留归因空白**（apply 归零后仍 65–100 ms/s）⇒ 本批**不宣称消除可感卡顿**；新增 **M-residual** 归因测量（GC/`(program)`/React commit）排入后续。
7. **C2 门闸降级为可选**（实测层成本 0.26–0.44% 单核）。
8. **不做**：`cssText` 合并（N=1 零收益 + 三重风险）、SettingsRoot/SettingsPanel memo（函数级自时间未证实且对象 selector 已排除）、settings-models 行级 memo/虚拟化（12/12 窗 0 fiber）、C2 观察器收窄（收益可忽略且易漏动态行）。

## 三bis、ingest 批次专项约束（执行前审计钉死，必须遵守）

### 3bis.1 根因（已实跑，非推断）
- **timer 未触发**：`inject` 缺 `"timer"` ⇒ `ctx.setInterval` 是 timer 服务 mixin accessor，**读取即抛** `cannot get property "timer" without inject`；
  因 `A ? B : C` 必须先求值 `A`，`ctx.effect` 兜底分支**语法上不可达**，异常被 `index.js:220` 的 `.catch` 吞成一行 warn。
  **修法形状**：把安装动作放进 `ctx.inject(["timer"], cb)`；**不得保留 `typeof ctx.setInterval` 式探测**（探测本身会抛）。
- **U-IG3**：`rebuildDailyForDays` 的 DELETE 集合 = 传入的**非连续** day 集合，INSERT 的 SELECT 用 `[min, max+1day)` **连续区间**
  ⇒ 区间内**间隙日**未删却被 GROUP BY 重新产出 → 裸 INSERT 撞 UNIQUE（11/11 逐例吻合）。
  修法二选一（可同时上）：**A 区间对齐**（DELETE 覆盖 `[lo,hi)` 内全部 day）／**B INSERT 加 `ON CONFLICT(...) DO UPDATE`**；两者实跑后与全量重算**逐行一致**。
  验收：A1 UNIQUE=0；A2 daily↔events 逐键 `mismatched=orphan=missing=0`（**用 JS 聚合，不要用 SQL GROUP BY**）；A3 7 个端点重建前后同值；A4 断言"产出 day ⊆ DELETE day"恒真。

### 3bis.2 写入者与 API 分歧（关键陷阱）
- `db.js` 三处改动（U-IG3 + `invalidateMaxDailyDayCache` 导出 + `busy_timeout`）**单一写入者**。
- **`rpc.js` deployed 与 source 是两套不同 API**：source 用 `ctx.connection.register(ctx,"/usage",handle)`（0.1.5 姿势）；
  **deployed 用 `ctx.connection.rpc.handle("/usage", handle, {authority:"loopback"})`（`rpc.js:225`，0.1.1 姿势）**
  ⇒ **整文件 cp source→deployed 会立刻打断 `/usage` 路由**，必须走锚点补丁。（又一次 source≠deployed 的坑）

### 3bis.3 恢复 45s 周期的硬闸门（G1 一条即决定）
| 闸门 | 判据 |
|---|---|
| **G1** | **一次完整 ingest pass 期间宿主事件循环最大延迟 < 100 ms**（`perf_hooks.monitorEventLoopDelay`）。现状对照：同 pass 同步执行 = **2.68s / 36.1s** 单次阻塞 |
| G2 | 并发 10 次 refresh 只触发 **1** 次 fold（单飞必须让并发调用者**复用同一个 promise**，否则堆叠多份 fold） |
| G3 | `status` 期间不等待（不把 pass 时长转嫁给查询） |
| G4 | 卸载后**无残留 worker** |
| G5 | `ingest-equiv/run-suite.sh` 全绿 |

- **U-IG1 未通过 G1 前不得启用 U-IG2**；落地时用**常量开关先关着**，验证后再开（同一文件 `index.js`，避免半套状态）。
- **若 U-IG1 本轮无法安全完成 ⇒ 明确阻止**：不修 timer 注入、**不新增任何周期性 ingest 触发**（含"顺手 `ctx.inject(['timer'])` 装上"这种看似更安全的写法）、数据新鲜度走手动 `/usage/refresh`，并在交付说明里写明"按铁律阻止"。
- **U-IG1 两个设计点**：① **不用总时长超时**（冷摄入 36.1s 且随数据增长）→ 用**停滞看门狗**（距上条 progress >120s 则 terminate + 重建，**不重试**）；② 单飞共享 promise（同上 G2）。

### 3bis.4 沙箱假失败警告（已坑到一次，必须转告）
本环境（agent 沙箱）**无法创建 SQLite 临时文件** ⇒ 任何需要 temp-store 的聚合必然失败：
生产库只读连接下**多列 GROUP BY 40/40 失败**、单列 `GROUP BY day` 10/10 成功、`PRAGMA temp_store=2` 后立即可用。
同机制下 `queryTimeseries/day/hour`、`queryByDay/ByModel/ByProject/Sessions` 在生产库上**全 ERR**，而**宿主自身用量卡片正常出数**
⇒ 这些 ERR **是沙箱产物，不得当生产缺陷**；"空库全量 ingest + 端点对比"类验证在此沙箱会得到**假失败**。
**可选加固（标"加固"不标"修 U-IG3"）**：`openUsageDb` 里加 `PRAGMA temp_store = 2`（代价：聚合排序占内存；本库量级很小）。

### 3bis.5 代码级写入者（本轮已定）
- `db.js`（U-IG3 + 导出 + busy_timeout + 可选 temp_store）：**单一写入者**
- `ingest-worker.js` / `ingest-runner.js`（新增）+ `index.js`（接线 + timer 开关常量）：**同一写入者**
- `ingest-cc.js`（U-CC1，已就绪的补丁脚本 `research-v2/cc-cursor/apply-CC-cursor-fix.mjs`）：可独立执行


## 三ter、P2AC 专项（审计 GO，须遵守）

- **目标**：`~/.npm-global/.../dsh-client-runtime/lib/client.js`（live sha256 `d71a8ca5…`，审计首尾一致）；**热面 ⇒ 刷新即生效，无需重启**。
- **独立标记 `/* p2ac-fix */`**（不得复用 `dsh-perf-fix P2 v1` 或 `dsh-lag-fix B1/C1`）；**独立 pre-image 必须从当前 live 取**。
  ⚠️ 审计实测：`backup/R4-20260921-115821/deployed/client.js`（`eeb5dcf2…`, 71 KB）**不是**本 bundle 的 pre-image（是宿主侧同名文件）；另实测 **B1 对 runtime bundle 的全部改动 = `:8572` 一行**，两处锚点由 C1 引入。
- **三处"看着对、其实错"的陷阱（已成机器断言）**：T1 `chainRowIds` 必须声明在**方法体顶层（4 Tab）**（否则 `ReferenceError`）；T2 A1 必须锚 `:9294` 的 `if` 行**上方**插入（锚 `:9324` 会插到 walk 之后）；T3 旧注释必须**连行带换行整行删除**（否则留 8 Tab 孤立缩进）。
- **回归闸门**：新增对拍 **39/39**（三态×六场景，含 `unpatched_reproduces_defect=true`）+ baseline `harness-a-p2-stale-row.cjs` **18/18**；**两轮必须同一实例**（否则未改代码会假 PASS）。
- **新增断言**：S-IDENT（`published2 === published1`，证明 P2 引用稳定性未被削弱）、S-CUTOVER（割接首轮即清掉旧代码写入的残留键）。
- **活体判据 = INCONCLUSIVE**（残留只在浏览器内存，不落盘不出网络）⇒ **不得**写成活体验收判据。
- **回滚铁律**：**P2AC → B1/C1 → C1**；**禁止**用 C1 `--rollback` 抹 P2AC/B1 行（它会还原 `aba836a0` baseline，连带抹掉 B1 的 `:8572` 行与 P1/P2 全部）。

## 三quater、主题批的因果判定方式（协调者已裁决）

- **M1 的"页内 stub A/B"不可用（已核实）**：
  1. cpu-profile 线建议的命令 `capture6.mjs --scenarios m1,m3` **不被支持** —— capture6 只注册了
     `home-idle` / `long-session-idle` / `long-session-active` / `settings-general-open` / `settings-dwell` 五个场景（`m1`/`m3` 命中数为 **0**），照跑只会产出空窗。
  2. 其 `probe-apply-ab2.mjs` 的头部注释**自陈多次打桩失败**（"Final approach: … Error.captureStackTrace"），与该线"两次打桩未挂上 prototype"的结论一致。
- **改用真实修复本身做 A/B**（更干净、不依赖脆弱 stub）：
  1. **修复前基线**：取锁 + 门禁跑 `capture6 --scenarios home-idle,settings-general-open,settings-dwell,long-session-idle --reps 2 --win 20000 --stamp before-theme`；
  2. 落地主题批（**热面，刷新即生效**）；
  3. **修复后**同场景重跑（`--stamp after-theme`），按主题审计 §4 的**预注册阈值**判定：
     `RecalcStyle÷Task 60%→≤15%`、`applyMs/busyMs 0.50–0.80→≤0.10`、`rafOver50 42–80→≤10/2 窗`、`rafP99≤33ms`、**`rafP50`=16.7ms 作"没坏"哨兵**。
- **门禁口径陷阱**：`capture6` 的 `lockHeldByMe` 判据是 **`owner.txt` 前两行含 "cpu-profile" 字样**（正则 `/cpu-profile/`）——
  锁文件其余字段写什么都不影响该判定；因此由协调者代跑时必须把归属如实写清（本次写法：`agent: coordinator(main) driving cpu-profile collector`）。
- **锁释放陷阱（该线的 `exclusive-run.sh` 自身有此缺陷）**：它只用 `rmdir "$L"`，而目录内仍有 `owner.txt` 时 **rmdir 静默失败** ⇒ 残留目录会被他线当成"锁被占用"。正确顺序 = `rm -f owner.txt && rmdir`。

## 四、每单元验收通则

- **热面**：`served rev == 磁盘 sha1-12` 核对 + 功能回归清单逐项 + 目标行为的**同窗对照**（不用跨窗绝对数）。
- **冷面**：重启后 sha 必须等于预期值；`session.list` 200 与顶层行齐全（回归哨兵）；单元专属断言（如 U-B1 的"201 subagent 第 201 条 running"反事实、U-CC1 的 `LOSS→NO_LOSS`）；
  **保留所有 invalid/超阈值窗口**，禁止挑最佳窗口。
- **性能类**：一律以**比值/为零/占比**判据（例如主题批：`RecalcStyle÷Task` 60%→≤15%、`applyMs/busyMs` 0.50–0.80→≤0.10、`rafOver50` 42–80→≤10/2 窗、`rafP99`≤33ms、**`rafP50`=16.7ms 作"没坏"哨兵**），并满足 `exclusive-run.sh` 的 `gateOutcome==EXCLUSIVE`。

## 五、测量协议（本轮确立，必须遵守）

1. **并发口径必须按"主浏览器进程"计数**：`pgrep -c -f headless_shell` 会把**一个实例的子进程**（renderer/gpu/zygote/utility）数成 5–8 个（实测该命令 3 而真实实例 1–2）。
   正确口径 = 命令行含 `--remote-debugging-pipe` **且不含 `--type=`**；或用 `/proc/<pid>/exe` 精确统计并**排除自身**（该 `pgrep -f` 模式还会自匹配，实测安静时返回 2 而实际 0）。
2. 每窗口**起止各采一次**并发快照，`>1` 即该窗口 invalid（`--concurrency-gate strict` 默认）；**开窗门禁**：采集前必须 `foreignCount==0 && lockHeldByMe==true`，否则重试到上限并标 `CONTENDED`。
3. 探针必须显式接管 `SIGINT/SIGTERM/SIGHUP`（Node 默认不触发 `exit` ⇒ 否则留下孤儿浏览器与死锁锁）。
4. **锁释放必须按顺序**：`rm -f .probe.lock/owner.txt && rmdir .probe.lock` —— 目录内仍有 `owner.txt` 时 `rmdir` **静默失败**，残留目录会被他线当成"锁被占用"。
5. 锁回收：owner `pid` 确认不存在即可回收（**不必等 25 分钟**）；`owner.txt` 必须写 `pid`/`owner_pid`（`host_pid` 不是持有者）。
6. 跨线时间比较**先换算本地时区**（部分 harness 记 UTC）。
7. **历史绝对值换算**：独占 vs 受污染实测膨胀 **Script 4.5–10.3×、apply 9.6–20.5×、Task 3.2–8.3×、Recalc 5.6–9.3×**；
   `Layout` 在受污染批被测成 ≈0 ⇒ **该指标只有独占批可用**。引用历史"script 80–190 ms/s"须先除以 3–10。
8. ⚠️ **仪器陷阱（exec-ingest 实测复现，全队适用）**：`perf_hooks.monitorEventLoopDelay` **会丢弃 `reset()` 之后的第一个样本** ——
   `enable → settle → reset → block` 对 **3 s / 20 s** 的阻塞只报 **10.31 / 10.16 ms**；改成 `enable → settle → block` 才报 **3 003 / 20 015 ms**。
   ⇒ **任何"主线程阻塞/事件循环延迟"测量都必须避开在阻塞前 `reset()`**（保留样本或改用独立心跳确认）。
   证据：`exec-ingest/tools/probe-eld-reset.mjs` + `out/eld-reset-trap.txt`。
9. ⚠️ **引擎口径陷阱（incident2 实测，2026-09-22）**：**Gecko（Firefox）会静默接受 `PerformanceObserver.observe({entryTypes:['longtask']})`
   与 `{type:'long-animation-frame'}`（不抛错、`longtaskSupported=true`）却永不投递任何条目**。
   阳性对照（同页三次 200 ms 同步阻塞）：**Blink 报 `longtaskCount=2` + `loafCount=3`；Gecko 报 `0 / 0`**。
   ⇒ ① **Gecko 上"0 长任务/无长帧"是 API 缺失，不是不卡**，禁止作为证据引用；
   ② 任何 LongTask 判据**必须先做"注入阻塞 ⇒ 通道确能报出"的阳性对照**（regression 线已自证：注入 150 ms ⇒ 观测到 1 条恰 150 ms）；
   ③ Firefox 侧改用 rAF 帧间隔/帧投递口径；④ 报告必须写明**引擎与版本**（UA 读回，不靠推断）。
10. ⚠️ **DPR 自证规则**：Blink 的 DPR 由 CDP `Emulation.setDeviceMetricsOverride` 实现（**`headless_shell` 命令行里没有 `--force-device-scale-factor`**；
    早期某批被加了该 flag，其 `devicePixelRatio=1` 是**人为产物、不可作证据**）。**每次运行都要页内读回 `devicePixelRatio`
    与 canvas backing/CSS 尺寸自证生效**；Gecko 侧写 `user.js` 的 `layout.css.devPixelsPerPx`（BiDi `setViewport.devicePixelRatio` 可作第二开关）。
11. **Gecko 可运行配方（incident2 实测可用）**：直接 exec snap 载荷
    `/snap/firefox/8863/usr/lib/firefox/firefox --headless --no-remote --new-instance --profile /tmp/<dir>/prof --remote-debugging-port=N`，
    经 **WebDriver BiDi**（`ws://127.0.0.1:N/session`，Node 22 原生 WebSocket）驱动。
    **前提**：① `HOME` 必须可写（否则 `Could not find profile folder.` 直接退出）；② 私有 profile + `--no-remote --new-instance`（确保永不附着用户会话）。
    **边界**：headless Gecko 走 **SWGL 软件 WebRender**，绝对 ms 是软件光栅口径，**只有同引擎相对比较有效**。
    Playwright 的 `firefox` 不可用（需自带 juggler 构建）；Firefox 155 已移除 CDP（`/json/version` 不再提供）。
12. **系统级取证通道（incident2 发现）**：本机 **`/var/log/Xorg.*.log*` 不存在**（真日志在 `~/.local/share/xorg/`），
    但 **gdm 的 `/usr/libexec/gdm-x-session[PID]` 会把整份 X 日志转发进 journald** ⇒ **已被轮转删除的历史 Xorg 日志可从 `journalctl -b -N` 完整恢复**
    （含 `NVIDIA(0)`/`AMDGPU(0)`、连接器 EDID、`(--) PCI:*` boot-VGA 标记）。跨 boot 比较图形栈时必须用这条通道。
13. ⚠️ **阳性对照必须在"页内"注入阻塞，不能用 CDP `Runtime.evaluate`**（incident2 实测）：
    同一 120 ms 忙循环，**页内 `setTimeout`/rAF 注入 → LongTask 如实报 120.0 ms**；
    而 **`Runtime.evaluate` 注入 → LongTask 报 0（通道盲区）**，同段循环 **LoAF 却报 123.5 ms**。
    ⇒ 用 `page.evaluate` 做"证明通道可用"的对照会得到**假阴性**并误判"通道不灵"。统一改用**页内定时器注入**。
14. **口径辨析：设置里"导航项"与"tab"是两件事**（incident2 实测，影响对照分组）：
    点导航「插件」→ 落 **`插件配置`**（`dsh-client-ui-settings-plugins/lib/client.js:1289-1291` order 0），发 **9 个 `/usage/*` RPC**（click+6…8ms 并发，+25…290ms 到齐）；
    **`插件列表`**（`dsh-client-ui-settings-plugin-inventory/lib/client.js:288` order 10）才发 `pluginInventory.list`。两者成本不同（导航热 **4.2ms** / tab **20.8ms**），**不得混为一谈**。
15. ⚠️ **跨引擎时钟粒度陷阱（gecko-vs-blink 实测）**：Gecko 默认把内容进程 `performance.now()` **夹到 1 ms**（0.35 ms 忙等报成 1.0 ms，**高估 2.9×**），Blink 为 0.1 ms；
    设 `privacy.reduceTimerPrecision=false` 后 Gecko 到 0.02 ms。⇒ **任何跨引擎的亚毫秒级"JS 耗时"比值，不做时钟校正就是假象**（该线因此把 DOM 单元判为 INCONCLUSIVE）。
    该线另自曝一处仪器产物并已自行推翻：`setInterval(16ms)`+35ms 忙等曾显示 Gecko p50 **66.2 ms vs Blink 33.3 ms（2×）**，改用 **rAF 锁负载**做负载曲线后差距消失（各档比值 0.95–1.00）——**setInterval 补偿语义造成的假象**。
16. **锁文件 `owner.txt` 格式必须统一**：现存 `pid=N` 与 `pid: N` 两种写法，**只认前者的解析器会把存活 owner 误判为死锁**（gecko-vs-blink 线实测并已在脚本里兼容四种写法，且只删自己的锁目录）。
    **统一为 `pid: N`（冒号+空格）**；回收脚本必须同时兼容两式，并遵守"只听自己的锁"。





