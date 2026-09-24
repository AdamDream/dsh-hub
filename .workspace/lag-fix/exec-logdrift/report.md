# exec-logdrift 执行档报告：宿主日志文件出口（U-LD1）· 孤儿 settings 段巡检（U-LD2）· 部署漂移校验器（U-LD3）

- 日期：2026-09-22（夜）｜工作区 `/home/CNS2026495165/dsh`｜独占写入目录 `.workspace/lag-fix/exec-logdrift/`
- 宿主（判据锚点）：**pid 2988915**，`node …/bin/dsh web`，启动 **18:11:49**（`/proc/2988915` ctime 实测 `2026-09-22 18:11:49.777`）。**未重启、未 pkill、未碰用户浏览器、未占用 3080。**
- 审计契约：`.workspace/lag-fix/program/w20-cordis/audit.md`（586 行）+ `raw/w20-cordis-logger-threshold.mjs`/`.json` + `.workspace/lag-fix/program/w13-feedback/audit.md`（F1）。
- 授权二级子代理：**2 个**（A = U-LD3 漂移校验器；B = 隔离宿主 harness）。**两个都交付了 PASS**。
- 工具调用**全程未传 `sandbox_permissions`**（本会话审批已禁用）。**实测确认：本沙箱对 `/home/CNS2026495165/.dsh/**` 与 `~/.npm-global/**` 的写入被拒绝**（`touch ~/.dsh/.x` ⇒ `权限不够`）⇒ **deployed 写入由协调者执行**，本档交付"候选件 + 幂等部署脚本 + 沙箱内全流程自测"。
- 探针锁：探针入口 `.workspace/lag-fix/scripts/run-locked-v1.mjs` 一律**先取锁再跑**、跑完立刻释放；**从未回收或手改任何锁**（取锁记录见 §6）。
- 证据分级：**【实跑】**=真进程/真字节/真命令输出；**【离线实跑】**=用**真实产品代码**（真 `cordis`/真 `dsh-app-boot`/真 `cordis-plugin-loader`）在零宿主负载下执行；**【只读推断】**=仅由 file:line 推出。

---

## 0. 结论先行

| # | 结论 | 判定 | 级别 |
|---|---|---|---|
| **1** | **U-LD1 落地并通过全部验收**：新增本地薄插件 `@local/dsh-logfile`（宿主侧**文件 exporter**），经 profile patch 的 `insert` **热①挂载（零重启，实测 2 s）**。它**显式声明 `levels:{default:2}`** ⇒ 把 `warn` 从"被级别过滤直接丢弃"变成"落盘"。 | **PASS** | 【实跑】 |
| **2** | **验收①（同一次 warn 有/无补丁对照）**：在**活的隔离 `dsh web` 宿主**上，同一条产品 `log.warn`（`dsh-app-boot` 的 `patch: entry … not found`）——**未挂载时磁盘上什么都没有**（内存见证 exporter 证明 warn 确实发出），**热挂载后 1 s 内落盘**，原文：`{"ts":1790075970279,"iso":"2026-09-22T11:19:30.279Z","type":"warn","level":2,"name":"loader","sn":16,"msg":"patch: entry ld-trigger-live-1 not found"}`。 | **PASS** | 【实跑】 |
| **3** | **验收②（`levels` 生效证据）**：同一进程、同一触发、**同一窗口**内只改 `levels.default` —— `2` 落盘、`1` 不落盘，且两臂的内存见证**都**看到了该 warn（排除"其实是没触发"）⇒ 差异只能由阈值解释。离线侧另有阳性/阴性对照（`error/info/warn/debug` 四级矩阵）。 | **PASS** | 【实跑】+【离线实跑】 |
| **4** | ⚠️ **审计 §4.3 P-1 的前提被实测推翻**：**插件作用域的 `ctx.logger.exporter()` 会被插件 fiber 自动回收**，不需要自登记 effect。机制：`logger` 服务带 tracker `{property:'ctx', noShadow:true}`，其 traceable 代理在取 `prop === 'ctx'` 时**返回访问者 ctx**（`cordis/lib/index.js:123-128`）⇒ 实测 `pluginCtxIsLoggerCtx: true`（离线 Q7 + 活宿主 `exporterCtxIsPluginCtx: true`）⇒ `exporter()` 里的 `this.ctx.effect(…)` 落在**插件 fiber**上。反例实测：`ctx.root.logger.exporter(…)` 会**泄漏**（卸载后 `exporters.size` 不降、仍在收消息）。 | **修正审计** | 【离线实跑】+【实跑】 |
| **5** | **但自登记 `ctx.effect` 仍然必需**，理由与 P-1 不同：`fs.WriteStream` **没有 `unref()`**（实测 `typeof === 'undefined'`）⇒ 打开的文件 fd 只有靠插件 effect 的 cleanup 才会被 `end()` 回收。本实现把"回收 exporter + 关闭文件句柄 + 落生命周期记录"放在同一次幂等 cleanup 里。 | **PASS** | 【实跑】 |
| **6** | **验收③（卸载/回收，实测而非按 JSDoc）**：活宿主里从 patch 文件删掉 insert ⇒ **2 s 内** lifecycle 记录 `exporter-disposed`：`presentAtCleanup:false / presentAfterDisposer:false / exportersSizeAfter:1`（只剩内置环形缓冲）⇒ **零泄漏**；随后用**同一触发**再打一次 ⇒ **不再落盘**（3 行 → 3 行）。 | **PASS** | 【实跑】 |
| **7** | **验收④（文件有上限）**：`maxBytes × maxFiles` **硬顶**（默认 8 MiB × 3 = **24 MiB**）；轮转 = 同步 `rename/unlink` + 换流（旧流异步 `end()` 收尾），**无内存队列 ⇒ 风暴下不丢行**（单测：600 行连写、0 丢弃、31 次轮转、总量 ≤ 硬顶）。活宿主 `maxBytes=4096/maxFiles=2` 臂实测：文件数 ≤ 2、总量 ≤ 8192、`.1` 存在。`maxFiles:1` 退化为截断重开，仍**有界**。 | **PASS** | 【离线实跑】+【实跑】 |
| **8** | **验收①的"重启后仍在"**：两次独立进程覆盖同一状态目录 ⇒ 第二次 `starterBytes > 0`（复用已有文件而非新建）、第一次的行**逐字仍在**、新代际的 warn **追加**到同一文件。 | **PASS** | 【离线实跑】 |
| **9** | **U-LD2 落地（只上报、不改行为）**：同一插件内 `orphanWatch` 用 `settings.describe()`（`:352-382`）× `settings.documentPath`（`:291` / `dsh-settings-file:107`）做差集，并 `fs.watch` 文档目录做**事件驱动**重巡（无轮询）。活宿主实跑：**`orphans: []`（真文档 12 段全部有主 ⇒ 阴性对照通过，零误报）**；`unsectioned`（注册了但文档没写段）8 个，仅 info 级。 | **PASS** | 【实跑】 |
| **10** | **U-LD2 的"注册了但没人 `get`"方向**：`dsh-settings` **没有**任何读取计数/事件（`get` 就是一次 Map 查询，`register()` 里无 hits 字段）⇒ 运行时无法观测，插桩又会**改行为** ⇒ 改为**部署字节上的静态消费点普查**。实跑（843 文件 / 23.1 MB / 321 个字面量命名空间；universe = 运行时真值 20 个已注册 ns）：`cross-plugin-read 5` · `self-read 0` · `registered-only 1`（`dsh-usage`）· `mentioned-only 14`（注册用常量，模式未解析，**不是**孤儿证据）· **`unreferenced 0`** ⇒ 当前部署树里**没有任何命名空间可证为孤儿**。 | **PASS** | 【实跑】 |
| **11** | **U-LD3 交付（子代理 A，自裁决 PASS）**：覆盖 **52 包 / 322 条登记文件**（8 本地 + 44 全局 `@deepseek-ai/*`），扫描 16580 文件、未分类 **0**；**漂移 17 处 / 9 包**（15 `deployed-only+source-only`、2 `deployed-only`、0 `source-only`、305 `equal`）；**6 类未覆盖补丁全部确认**（`grep -c` 全 0，命令原文存档）；一键 `--check` 阴性 322/322 MATCH（exit 0）、阳性三种打法全部 exit 1 并点名。**零产品足迹**。 | **PASS** | 【实跑】 |
| **12** | **U-LD3 对审计的一处修正**：审计 §3.6 的 G5（`dsh-client-modules/lib/client.js`）**当前并不携带手改** —— 与 workspace npm 影子副本 + `baseline-011` 快照**三方同哈希**、mtime = 安装时刻、provenance grep 计数 0。准确表述是"**该类没有任何脚本保护**"，而不是"该类有一个手改会丢"。 | **修正审计** | 【实跑】 |
| **13** | ⚠️ **本单元的真实边界（必须知道）**：文件 exporter **抓不到"本次 apply 期间"发出的 warn** —— 插件是在**同一次** `applyEntryPatches` 里被插入的，而 `applyEntryPatches` 的 warn 在该函数内就已发出（早于任何插件挂载）⇒ **宿主 boot 首轮的补丁未命中告警不会进文件**。**但**：此后**任何一次** profile/home patch 变更都会**重新应用整份 patch 列表**、把那些未命中的 id **再次**告警 ⇒ 此时 exporter 已在 ⇒ **会被看到**（活宿主实测正是如此：boot 期那条丢失、写入 patch 后同一条被捕获）。 | **已实测并记录** | 【实跑】 |
| **14** | **我无法执行 deployed 写入**（沙箱拒写工作区外）。因此交付物是：候选件 + **幂等部署脚本 `apply-LogDrift-v1.mjs`**（dry-run 默认 / `--apply` / 锚点唯一命中否则**零写入** / 自动 pre-image / 写入后 `node --check`+产品解析器验收 / 幂等 / 每单元独立回滚），并在**沙箱根**里跑完 apply→验证→幂等→闸门→回滚 全流程（见 §5）。 | **边界（非缺陷）** | 【实跑】 |

### 0.1 最终字节修订与"重跑"声明（诚实项）

本档在收尾时对候选件做了一次**只涉及 config 默认值**的清理（删掉已废弃的 `queueMax` 键、把 `keepArgs:false` 显式化）⇒
**插件字节在首轮验收之后发生了变化**。为不留下"证据对应旧字节"的缝隙，**全部离线验收已用最终字节重跑**：

| 产物 | sha256（**最终修订**） | 重跑结果 |
|---|---|---|
| `lib/index.js` | `043f4065fc6943d0175ce30ac7e14b7c…` | `raw/boot-probe-full.json` **18/18** |
| `lib/jsonl-sink.js` | `9db0771f8e1d1a033ab9ba7f3985412b…` | `raw/unit-tests-v1.json` **10/10** |
| `lib/orphan-settings.js` | `1d74cd21defa73f431721ac6be48d5b0e…` | `raw/boot-probe-prime.json` **1/1** |
| `package.json` | `23ac279e957eae8394d7090fd9665016…` | `raw/boot-probe-restart.json` **3/3** |

- **活宿主（:3188）证据对应的是上一修订**（19:17 字节）：宿主对已加载模块有 ESM 缓存，热重挂**不会**重读字节（这本身正是审计 H7 的冷面事实）。
  两个修订的差异仅在 `DEFAULT_CONFIG` 的键集合，**不触及 exporter/阈值/回收/轮转任何逻辑**；且活宿主当时使用的 `level/maxBytes/maxFiles` 全部来自 insert 的显式 config，与默认值无关。
- **真实根（`DSH_HOME=/home/CNS2026495165/.dsh`）的 dry-run 已跑**：`anchor count = 1`、`action = append`、`checks 9/9`、**`writes=0`** ⇒ 协调者可直接执行 `--apply`（锚点闸门在真实文件上已经通过）。
- `raw/apply-selftest-transcript.txt` 记录的是**部署器**全流程（apply/幂等/闸门/回滚）；其中 payload 的 sha 属"导出时的修订"，部署器逻辑与字节修订无关。

---

## 1. U-LD1 实现（候选件）

**目录**：`candidates/dsh-logfile/`（package.json + `lib/index.js` + `lib/jsonl-sink.js` + `lib/orphan-settings.js`）

| 项 | 实现 | 依据 |
|---|---|---|
| 注册方式 | `ctx.logger.exporter({ colors:0, levels:{default:cfg.level}, export })`，**插件作用域** `ctx.logger`（**绝不可** `ctx.root.logger`，实测泄漏） | `cordis/lib/index.js:613-617`；本档 Q5/Q7 实测 |
| **显式 `levels`（P-2）** | `levels:{default:2}` 由 config `level` 决定（默认 2 = error+info+warn；3 才含 debug） | `cordis/lib/index.js:474`；`raw/w20-logger-threshold.json` |
| 阈值语义 | `error=0 / info=1 / warn=2 / debug=3`，阈值越大越"宽松" | `cordis/lib/index.js:457-460` |
| 卸载回收 | 自登记 `ctx.effect(…, '@local/dsh-logfile: exporter')`：cleanup 里 (a) 调 `exporter()` 返回的 disposer（幂等）、(b) 记录 `presentAtCleanup / presentAfterDisposer / exportersSizeAfter`、(c) `sink.close()` 关 fd。回收 exporter **本身**由插件 fiber 负责（见 §0-4），本 effect 负责**句柄与刷新** | 本档 Q2/Q3/Q5/Q6 实测 |
| 写入路径 | `createWriteStream`（**异步**）**+ 同步 `openSync` 拿 fd** 再交给流 | P-3（禁 `appendFileSync`）；见 §5 的两个竞态踩坑 |
| **不得无限增长** | 硬顶 = `maxBytes × maxFiles`（默认 **8 MiB × 3 = 24 MiB**）；触发条件 `bytes>0 && bytes+line>maxBytes`；轮转 `unlink(.maxFiles-1) → 逐级 rename → rename(base→.1) → 新开流`；`maxFiles:1` ⇒ unlink 后重开（truncate）；单行 > `maxBytes` 直接丢弃；`maxLineBytes` 默认 8192（超长行截断并打标 `…[clamped NB]`） | `lib/jsonl-sink.js`；单测 T1/T2/T3 |
| `export()` 永不抛 | 全路径 try/catch + `safeJson`/`safeStringify`（循环/BigInt/Symbol/函数/超深结构全部降级为字符串） | `cordis/lib/index.js:484`（`exporter.export(message)` **无** try/catch）⇒ 抛错会污染产品调用点 |
| 文本渲染 | 复刻 `Logger.format()` 在 `colors:0` 下的语义（`%s/%d/%i/%f/%o/%O/%c/%C/%%`、Error→stack、多余参数→JSON） | `cordis/lib/index.js:431-452`；单测 T5 |
| 记录格式 | JSONL：`{ts, iso, type, level, name, sn, msg, [args]}`；`msg` 可直接 grep | 本档 |
| 自证/生命周期 | 独立小文件 `dsh-logfile-lifecycle.jsonl`（`maxFiles:1` + 256 KiB 截断策略 ⇒ 也有界）记录 `plugin-apply / exporter-registered / orphan-inspect / exporter-disposed / sink-closed`，**含 sink 统计**（bytes/written/dropped/rotations/truncations/errors） | 验收②③④的证据源 |
| 路径规则 | `config.dir` 优先；否则 `<DSH_HOME>/logs`（`DSH_HOME` 取非空 trim，否则 `~/.dsh`）——与 `@deepseek-ai/dsh-home-paths` 的 `resolveDshHome()` **同语义**（该包在 `profiles/node_modules` 扁平回退里可解析，但本插件**故意内联实现**以免因解析失败而失去观测能力） | `dsh-home-paths/lib/index.js:resolveDshHome/expandHomePath/defaultDshHome`；单测 T10 |

---

## 2. 验收①：同一次 `log.warn` 的**有/无补丁对照**（真跑原文）

### 2.1 活宿主（隔离 `dsh web`，pid 1194018 / :3188，`DSH_HOME=iso/home`）

子代理 B 交付的隔离宿主（真实 `dsh web`、真实组合 14 条 insert、真实 chokidar）上，由主线驱动：

| 步骤 | 真实输出 | 结论 |
|---|---|---|
| 挂载前 | `iso/host-logs/` **空**（宿主已跑 ~7 分钟）；`~/.dsh/logs/dsh-host.jsonl` 不存在 | 未打补丁 = 磁盘零输出 |
| 热挂载（`iso.sh patch-set`，**改 patch 文件，零重启**） | **2 s** 内出现 `plugin-apply`（`dshHome: …/iso/home`）+ `exporter-registered`（`myKey:2 · exportersSizeAfter:2 · levelsDeclared:true · exporterCtxIsPluginCtx:true`） | 热①成立 |
| 触发（同一次 patch 追加一条**不存在的 id** ⇒ 产品 `dsh-app-boot:92-95` 的 warn） | **1 s** 内落盘：`{"ts":1790075970279,"iso":"2026-09-22T11:19:30.279Z","type":"warn","level":2,"name":"loader","sn":16,"msg":"patch: entry ld-trigger-live-1 not found"}` | **验收① PASS** |
| 顺带捕获的真实产品日志 | `{"type":"info","level":1,"name":"usage","msg":"dsh-usage: ingest done: dsh scanned=0 new=0 failed=0; cc scanned=0 new=0 failed=0"}` | exporter 抓的是**真产品插件**日志，不只是自造触发 |
| 卸载后同触发 | 行数 3 → **3（无新增）** | 行为级回收证据 |

> ⚠️ **触发条目必须与"改变配置/挂载"分两次写 patch 文件**：同一次 `entry.update` 里，`applyEntryPatches` 会**先**发 warn（此刻旧 exporter 还活着），**之后**才重挂插件 ⇒ 同一次写入会让"level 对照臂"被时序假象污染（本档首轮实测即如此，ARM-C 假失败）。这是**复现/验收此类告警时的通用坑**，已写进脚本注释与 §7。

### 2.2 离线真链路（真实 `dsh-app-boot:boot()` + 真实 `watchUserPatches` + 真实 chokidar，无端口、无服务器）

`scripts/boot-probe-v1.mjs --phase=full`（**18/18 PASS**），关键原文：

```
PASS  [ARM-A] warn 触发确实发生（内存见证 exporter 收到 "…not found"）
PASS  [ARM-A] 未打补丁时日志文件不存在（对照基线）
PASS  [ARM-B] 热挂载成功（lifecycle 记录 exporter-registered，零重启）
PASS  [ARM-B] 同一 log.warn 真的出现在日志文件里（给出原文）
      → {"ts":1790075769312,"iso":"…11:16:09.312Z","type":"warn","level":2,"name":"loader","sn":6,"msg":"patch: entry ld-trigger-B1 not found"}
PASS  [ARM-C] level:1 的 exporter 确实生效（热改 insert config ⇒ 重挂，零重启）
PASS  [ARM-C] 同一触发在内存见证里出现（证明 warn 确实发出，不是"没触发"）
PASS  [ARM-C] level:1 时同一 warn 不落盘（阈值对照：反例）
PASS  [ARM-D] 卸载后 lifecycle 记录 exporter-disposed（实测回收，非 JSDoc）
PASS  [ARM-D] 卸载后同一 warn 不再落盘（行为级回收证据）
PASS  [ARM-E] 小上限配置确实热生效 / 见证看到 ≥30 条触发 / 总量 ≤ 硬顶 8192 / 存在 .1
PASS  [FINAL] 进程退出（根 fiber dispose）后 exporter 也已回收（合法 shutdown 不泄漏）
PASS  [FINAL] 全程未写用户 home（~/.dsh/logs/dsh-host.jsonl 不存在）
```

**验收①（重启保留）**：`--phase=prime`（1/1）+ `--phase=restart`（3/3）：

```
PASS  [ARM-RESTART] 第二次 boot 复用已有文件（starterBytes > 0，不是新建）
PASS  [ARM-RESTART] 重启后旧行逐字仍在（append 语义）
PASS  [ARM-RESTART] 重启后新代际的 warn 追加到同一文件
```
（对照 w13/w17 实测的"当前重启保留率 0%"：日志出口落地后该项变为**可保留**。）

---

## 3. 验收②：`levels` 阈值的前后对照

| 臂 | exporter 的 `levels.default` | 同一触发是否落盘 | 内存见证是否看到触发 | 结论 |
|---|---|---|---|---|
| 未打补丁 | —（无文件 exporter） | **否**（文件不存在） | **是** | 现状 = 黑洞 |
| ARM-B（活宿主 & 离线） | **2** | **是** | 是 | 显式 `levels` 解禁 warn |
| ARM-C（离线，同进程同窗口） | **1** | **否** | **是** | 阈值语义正确：缺失只能由级别过滤解释 |
| 离线四级矩阵（真实 cordis） | 不写 `levels`（=现状） | 收到 `["error","info"]`；环形缓冲同样只有 `error/info`（长度 2） | — | 复现 w20 §4.2 |
| 离线四级矩阵 | `levels:{default:2}` | 收到 `["error","info","warn"]` | — | 与 `:474` 公式一致 |
| 离线四级矩阵 | `levels:{default:3}` | 四级全过（w20 阳性对照复现） | — | — |

---

## 4. 验收③/④：回收与上限（实测证据）

**回收（活宿主，零重启）**：
```
{"event":"exporter-disposed","myKey":2,"presentAtCleanup":false,"presentAfterDisposer":false,
 "exportersSizeAfter":1,"disposeError":null,"uptimeMs":53110,
 "sink":{"bytes":616,"written":3,"dropped":0,"rotations":0,"errors":0,"closed":false}}
```
`exportersSizeAfter:1` = 只剩内置环形缓冲 ⇒ **exporter 被摘掉**；`presentAtCleanup:false` 同时证明**回收发生在插件 fiber 自身**（内层 effect 先于外层 cleanup 执行）—— 这正是 §0-4 的机制在真链路上的体现。卸载后同触发不再落盘 = 行为级第二证据。

**上限（单测 T1/T3 + 活宿主 ARM-E）**：

| 场景 | 参数 | 观测 | 判定 |
|---|---|---|---|
| 风暴（600 行连写） | `maxBytes=4096, maxFiles=3` | 文件 = `a.jsonl:2299 + .1:3971 + .2:3971`，总量 **10241 ≤ 12288**，`rotations 31`，**`written 600 / dropped 0`** | PASS |
| 单文件策略 | `maxFiles=1` | 单文件、总量 ≤ 2048、`truncations = 11` | PASS |
| 巨型单行 | `maxLineBytes=512` | 单行被截断到 ≤512 B 并带 `…[clamped NB]` 标记 | PASS |
| 活宿主真实轮转 | `maxBytes=4096, maxFiles=2`（60 条触发） | 文件数 ≤ 2、总量 ≤ 8192、`.1` 存在 | PASS |
| 重启续写 | 同文件重开 | `starterBytes > 0`，旧行逐字仍在 | PASS |

> **有界 ⇒ 保留量本身受硬顶约束**：旧行按设计被轮转淘汰（保留量 ≈ 硬顶 / 平均行宽）。单测最初的断言写的是"600 行都在盘上"，那是**断言写错**，已改为"写入 600 行 0 丢弃 + 保留总量 ≤ 硬顶 + 且确实接近硬顶"。

---

## 5. U-LD1 部署器 + 沙箱全流程自测（`scripts/apply-LogDrift-v1.mjs`）

**纪律实现**：默认 **dry-run**；`--apply` 才写；**锚点唯一命中闸门**（补丁文件**末行**必须在文件中恰好出现 1 次，且未重复打补丁；不满足 ⇒ `ABORT` + **零写入**）；**自动 pre-image**（只登记本次真的会改写的文件，存 `<work>/preimage/<unit>/<ts>/` + `manifest.json`）；写入后逐个 `node --check`（`.json` 走 `JSON.parse`）+ 追加后**用产品自带 `loadOptionalPatches` 解析验收**；**幂等**（内容相同⇒skip、已含 insert⇒skip）；**每单元独立回滚**（U-LD1 = payload+insert；U-LD2 = 该插件 config 的 `orphanWatch` 键；U-LD3 = 零产品足迹）。

**沙箱自测（`--root=<工作区内假 home>`，全程不碰真实 `~/.dsh`）** — 原文见 `raw/apply-selftest-transcript.txt`：

| 步骤 | 观测 | 判定 |
|---|---|---|
| dry-run | `checks 9/9`、`writes=0`、沙箱 payload 文件数 0、补丁 sha 不变 | PASS |
| `--apply` | 5 处写入：4 个 payload（`JSON.parse OK` / `node --check OK`）+ 补丁 `+531 B`（`yaml=yaml-package, entries=18`） | PASS |
| 产品解析器 | `loadOptionalPatches` ⇒ `entries=18`，`logfile=[{"insert":[{"id":"logfile","name":"@local/dsh-logfile","config":{"level":2,"maxBytes":8388608,"maxFiles":3,"orphanWatch":true}}]}]` | PASS |
| 幂等重跑 | `nothing to change ⇒ no pre-image taken`、`writes=0` | PASS |
| **锚点闸门** | 末行重复 ⇒ `anchorCount=2`、`action=ABORT(anchor-not-unique)`、**`writes=0`、payload 文件数 0、补丁 sha 不变** | PASS |
| 回滚 | 补丁 sha 逐字节回到原始 `1d8bbd4f…`、payload 文件数 0 | PASS |
| 回滚后再 apply | `checks 9/9`、`writes=5` | PASS |
| 写入中途失败 | 早期一版脚本在 `package.json` 上误跑 `node --check` 失败 ⇒ 已写入文件被**自动清理**（`writes=1` 但盘上 0 个 payload 文件） | PASS（故障注入） |

**自测过程中发现并修掉的 3 个真缺陷**（都属"只有真跑才会暴露"）：
1. **异步队列轮转在风暴下丢 90% 行**（600 行丢 542）⇒ 改为**同步 rename + 换流**（旧流异步 `end()`），彻底去掉内存队列；`dropped` 从 542 → **0**。
2. **`createWriteStream` 的 open 是异步的** ⇒ 轮转 rename 命中"文件尚未创建"（ENOENT 被吞）或"旧流把重命名后的路径重新打开"⇒ 表现为 `.1/.2` 为 0 字节、当前文件涨到 125 KB（31 次"轮转"全部失效）。修法：**同步 `openSync` 拿 fd** 再交给流，并把 rename 失败**计入 `errors/lastError`**（不再静默）。
3. **`renderMessage` 里三元表达式写了两次 `args.shift()`** ⇒ 吞掉第一个参数（`%C` 替换后只剩 `ld-trigger-1`）；并补 `safeJson` 让 `%o` 与 cordis 的 `JSON.stringify` 同形（`{a:1}` 不再变成 `{"a":"1"}`）。

**部署脚本自测之外，还有 10/10 的离线单元验收**（`scripts/test-units-v1.mjs` → `raw/unit-tests-v1.json`）：轮转硬顶 / 单行截断 / 单文件截断 / 重启续写 / 文本渲染保真 / 序列化鲁棒 / 差集纯函数 / 块标量不误报段名 / 巡检端到端(含 `fs.watch` 二次巡检) / `resolveDshHome` 同语义。

---

## 6. U-LD2 实现与结果

**实现**（同包 `lib/orphan-settings.js`，`orphanWatch` 开关独立可回滚）：

| 面 | 做法 | 依据 |
|---|---|---|
| 孤儿段（文档里有、没人注册） | `settings.describe().map(d=>d.ns)` × `settings.documentPath` 指向文档的**顶层键** 差集 ⇒ 非空即上报（默认 **info** 级，避免把用户保留的历史段当错误） | `dsh-settings/lib/index.js:352-382`、`:291`；`dsh-settings-file/lib/index.js:107` |
| 重巡机制 | `fs.watch` 文档**所在目录**（过滤 basename + 400 ms 去抖 + `persistent:false`），**事件驱动、无轮询**；apply 时先跑一遍 | 本档；单测 T9 验证"改文档 ⇒ 二次巡检" |
| 消费方探测 | 显式 `ctx.inject(['settings'], …)`（**关键**：非注入 ctx 上访问未注入服务会被 cordis 抛 `cannot get property … without inject`，`cordis/lib/index.js:675-676`；`dsh-tool-subagent` 正是把该异常吞成 `undefined` 才产生"静默回落"） | 审计 §2.1 S-3；本档实测 |
| 顶层键解析 | 优先真实 `yaml` 包；**不可用时回退**到保守扫描器（跳过块标量、去引号、无视注释）。**实测两处行为**：候选/symlink 位置解析不到 `yaml` ⇒ `regex-fallback`（12 个键与真值逐个一致）；**部署位置** `<DSH_HOME>/profiles/node_modules/yaml` 存在 ⇒ 走真解析器 | 单测 T8 |
| "注册了但没人 `get`" | **运行时不可观测**（无计数/无事件；插桩会改行为）⇒ 由 `scripts/settings-orphan-census-v1.mjs` 在**部署字节**上做静态普查，结论分四类（见下） | 本档 §0-10 |

**活宿主阴性对照（真文档 12 段）**：`orphans: []` ⇒ **零误报**；`registered` 20 个运行时命名空间被完整列出。

**静态普查结果**（`raw/settings-orphan-census-v1.json`；843 文件 / 23.1 MB）：

| 分类 | 数量 | 命名空间 | 含义 |
|---|---|---|---|
| `cross-plugin-read` | 5 | `dsh-subagent, llm-deepseek, llm-pi-ai, locale, shell` | 有 `get("<ns>")` 字面量且读取点不在注册文件内 ⇒ 确证跨插件消费 |
| `self-read` | 0 | — | — |
| `registered-only` | 1 | `dsh-usage` | 有 `register("<ns>", …)` 字面量、无 `get("<ns>")`（用 owner scope 的 `get()`） |
| `mentioned-only` | 14 | `agent-default-model, agent-loop, agent-presets, dsh-btw, dsh-ssh-gui, dsh-workerspace, permission, session-status-board, ui-conversation, ui-onboarding, ui-theme, vision-adam, wallpaper, web-search-deepseek` | 字符串出现过但**注册用常量**（如 `register(WALLPAPER_NAMESPACE, …)`）⇒ **模式未解析，不是孤儿证据** |
| **`unreferenced`** | **0** | — | **无任何可证孤儿** |

> 诚实边界：`registered-only` / `mentioned-only` **不等于"没人读"** —— 主流形态是用 `register()` 返回的 owner scope 的 `get()`（无 ns 字面量）。本普查只回答"**有没有服务级读取点**"。要把这一维做到运行时确证，需要 `dsh-settings` 侧新增读取计数（**属冷面 + 兼容面改动，本档不做**）。

---

## 7. 探针锁与并发条件（判据纪律）

- 所有会产生负载的探针都经 `scripts/run-locked-v1.mjs`（内部调 `.workspace/lag-fix/lib/probe-lock.mjs` 的 `acquire/release`）执行，**跑完立即释放**；**从未**手工删锁、**从未**改 `owner.txt`、**从未**回收 `liveness !== DEAD` 的锁。
- 取锁记录（真实）：首次 `BUSY (owner=w23-nav ALIVE)` 0 s → 重试即得；另一次 `BUSY (owner=exec-logdrift-iso ALIVE)` 等待 **15 s** 后由对方释放而取得；其余多次 `attempts=1` 直接取得。**无 BLOCKED-ON-LOCK**。
- 并发条件（引用绝对耗时时必读）：现场有 **9 条审计线 + 3 条执行线**在飞，期间别线仍在写热③面 `lib/client.js`（`dsh-client-ui-renderer`/`dsh-client-hmr` @18:30:56 等）。本档的耗时数字（"热挂载 2 s / warn 落盘 1 s / 卸载回收 2 s"）**是在此并发条件下、单次观测的绝对值**，仅作"热面成立"的定性证据；**未做同窗对照，故不作为性能断言**。
- 未取锁的纯离线动作：单元测试、真实 cordis 离线探针、静态普查、沙箱 apply/rollback 自测（宿主机上只是一次 `node` 解析/写文件，不产生交互负载）。

---

## 8. 冷面 / 热面判定（本档结论）

| 改动 | 面 | 零重启可见？ | 证据 |
|---|---|---|---|
| profile patch 追加 `insert`（挂载/卸载插件） | **热①** | **是**（实测 2 s） | 活宿主 + 离线真链路 |
| insert 的 `config` 变化（`level` / `maxBytes` / `orphanWatch`） | **热①** | **是**（实测：`exporter-registered` 出现新的 `level:1` 记录、`maxBytes:4096` 生效） | ARM-C / ARM-E |
| 插件 payload 字节（`lib/*.js`） | **冷**（ESM 缓存） | 否 —— 改字节**不会**重读 | 与审计 H7 一致（本档按此把"改脚本后需重启"写进 DEPLOY.md） |
| 日志文件本身 | 不适用（数据面） | 追加、重启保留 | 单测 T4 + ARM-RESTART |
| U-LD2 巡检 | **热**（挂在 U-LD1 上；`fs.watch` 事件驱动） | 是 | 单测 T9 + 活宿主 `orphan-inspect` |
| U-LD3 校验器 | **离线冷面（脚本本身）**；守护的补丁分布在冷面与热③两面 | 脚本不需要宿主 | A 报告 |

---

## 9. 诚实清单（未测 / 不可判定 / 明确边界）

1. **deployed 写入未执行**：本会话无法写 `~/.dsh/**`（实测被拒）⇒ §5 的 `--apply` 只在**沙箱根**跑过。真实部署请协调者执行（DEPLOY.md 给了逐步命令与期望输出）。
2. **未在真实用户的 3080 宿主上挂载**：所有活体证据来自**隔离宿主**（独立 `DSH_HOME` + 独立端口 3188），它用**同一份产品代码**、同一组合、同一 chokidar 链路；`~/.dsh` 与 3080 宿主全程未被写、未被重启（B 的隔离证据：真实 `storages/workspace.json` mtime 仍为启动前、真实 patch/settings/credentials sha 不变、启动后 0 个新 session 目录、3080 仍 200）。
3. **boot 首轮 apply 的补丁告警抓不到**（§0-13）：机制清楚、修法不必要（下一次 patch 变更即会重现），但**本档没有**"boot 期告警落盘"的证据，也**不应**如此宣称。
4. **`ctx.effect` 的返回值形状**：实测为**可调用对象**（`typeof === 'function'`、带 `then`、`ownKeys=[length,name,then,Symbol(cordis.effect)]`），直接调用即回收、**二次调用安全**（幂等）。这是"不要照抄 JSDoc"的实测确认（审计 §6 待办项）。
5. **性能/写盘量未做量化**：`level=2` 不含 debug；隔离宿主空闲 ~7 分钟仅 3 行。**未**做负载下的写盘量/延迟测量 ⇒ 不给性能断言。
6. **U-LD2 的 `registered-only/mentioned-only` 不等于孤儿**（§6 末尾），运行时确证需要 `dsh-settings` 侧计数器（冷面 + 兼容面，本档不做）。
7. **U-LD3 的两个已知能力缺口**（子代理 A 报告）：`dist/**` 构建产物通道**按误报闸门要求只上报不硬登记**（`dsh-web-frontend/dist/assets/index-ClqxG24t.js` 确实携带 `U-BOOT2` 手改 ⇒ 全局升级会静默丢掉它，而 `--check` 不会失败）；`profiles/web/node_modules` **模块遮蔽**通道字节不变 ⇒ 字节台账原理上看不见（已改为显式 WARN 段，当前无遮蔽树）。
8. **未做真实升级回滚演练**（`npm i -g` / `deploy-side.sh` / 隔离宿主升级），符合"不得跑 npm/pnpm install"的禁令 ⇒ U-LD3 里"升级后会怎么丢"是【只读推断】。
9. **隔离宿主仍在运行**：pid **1194018**、端口 **3188**、空闲健康（属本档子代理 B 启动，**不是**用户的 3080 宿主）。若不再复用：`bash .workspace/lag-fix/exec-logdrift/iso/iso.sh stop`（该 harness 有三重身份校验才发信号）。**我没有擅自 stop**，以保留复核能力。
10. **子代理 B 的一个 UNRESOLVED 已被本档解释**：B 报告"改 iso patch 后未观察到热重应用"。本档用**同一个** `iso.sh patch-set` 工具（tmp+rename）在**同一个**宿主上实测到了热挂载（2 s）与热卸载（2 s）⇒ 结论：**B 的那次观测是方法学假阴性**（其探针只在 `apply()` 里写 marker、不在 disposer 里写，因此"卸载后 marker 时间戳不变"是**预期行为**，不能作为"未热重应用"的证据）。B 已按纪律标注为"未观察到 + 阴性对照干净"，未误报为"热重应用已坏"。

---

## 10. 产物清单（本目录）

| 文件 | 内容 |
|---|---|
| `report.md` | 本报告（主交付） |
| `DEPLOY.md` | 部署/验收/回滚手册（含热冷面、真实命令、期望输出、不可执行项） |
| `candidates/dsh-logfile/` | **U-LD1+U-LD2 候选件**：`package.json` + `lib/index.js` + `lib/jsonl-sink.js` + `lib/orphan-settings.js` |
| `scripts/apply-LogDrift-v1.mjs` | **部署器**（dry-run 默认 / `--apply` / 锚点闸门 / pre-image / `node --check` / 产品解析器验收 / 幂等 / 每单元回滚 / `--root` 沙箱自测） |
| `scripts/boot-probe-v1.mjs` | **真链路验收**：真实 `boot()`+`watchUserPatches`+真 chokidar，ARM-A..E + prime/restart |
| `scripts/probe-cordis-effect-v1.mjs` | 离线实测 `exporter()/effect()` 形状与回收语义（Q1–Q7） |
| `scripts/test-units-v1.mjs` | 10 项离线单元验收（T1–T10） |
| `scripts/settings-orphan-census-v1.mjs` | U-LD2 静态消费点普查（四分类 + 提及回退） |
| `scripts/run-locked-v1.mjs` | 探针锁包装（先取锁再跑、跑完释放、有界等待、BLOCKED 如实上报） |
| `raw/probe-cordis-effect-v1.json` | Q1–Q7 原始结果 |
| `raw/unit-tests-v1.json` | 10/10 单元验收原始结果 + 明细 |
| `raw/boot-probe-full.json` | 18/18 真链路验收（含每臂原文与 lifecycle 全量记录） |
| `raw/boot-probe-prime.json` / `raw/boot-probe-restart.json` | 重启保留验收（1/1 + 3/3） |
| `raw/settings-orphan-census-v1.json` | U-LD2 普查台账（含逐 ns 读取点/注册点/提及点） |
| `raw/apply-selftest-transcript.txt` | 部署器沙箱全流程自测原文 |
| `preimage/` | 部署器在自测中生成的 pre-image 快照（真实部署时也会落在这里） |
| `iso/` | 子代理 B 的隔离宿主 harness 与证据（`HARNESS.md`、`iso.sh`、`state/`、`logs/`） |
| `drift/` | 子代理 A 的 U-LD3 交付（`U-LD3-report.md`、`DRIFT-LIST.md`、`deployed-manifest-v2.json`、`raw/`） |
| `tmp/` | 自测沙箱（假 home、boot-probe 状态、restart-probe 状态）——**可整体删除** |

**未写入**：`~/.dsh` 下任何文件、`~/.npm-global` 下任何文件、任何产品文件；宿主未重启、未 `pkill`；未占用 3080。

---

## 11. 自复核（本档自裁决）

| 审计/任务书要求 | 交付项 | 判定 | 证据 |
|---|---|---|---|
| U-LD1 exporter 落地 | 候选件 + 部署器 | **PASS** | §1、§5 |
| ⚠️ 必须显式写 `levels` | `levels:{default:cfg.level}` 默认 2 | **PASS** | §3 |
| ⚠️ 必须让 warn 进文件 | 活宿主 + 离线路实链路均落盘 | **PASS** | §2 |
| ⚠️ `ctx.effect` 语义**实测**确认 | Q1–Q7 + `exporterCtxIsPluginCtx` | **PASS**（并**推翻审计 P-1 前提**） | §0-4/5、§4 |
| 文件路径/轮转/上限有明确规则 | `maxBytes×maxFiles` 硬顶 + 轮转规则 + 单行/单文件策略，全部文档化+单测 | **PASS** | §1、§4 |
| 不得无限增长（别再造 spill） | 硬顶 24 MiB（可配），lifecycle 文件额外 256 KiB 截断 | **PASS** | §4 |
| 验收① warn 原文 + 未打补丁对照 | 二者都给了原文 | **PASS** | §2 |
| 验收① 重启后日志仍在 | `starterBytes>0` + 旧行逐字仍在 + 追加 | **PASS** | §2.2 |
| 验收② levels 前后对照 | 同窗口 level 2 vs 1 + 见证交叉校验 | **PASS** | §3 |
| 验收③ 卸载/dispose 可回收（实测） | 活宿主 `exportersSizeAfter:1` + 行为级 | **PASS** | §4 |
| 验收④ 文件有上限（容量/轮转证据） | 单测 + 活宿主小上限臂 | **PASS** | §4 |
| 补丁脚本 dry-run/--apply/锚点/pre-image/`node --check`/幂等/分单元回滚 | 全部实现并**沙箱自测**（含闸门零写入、回滚逐字节还原） | **PASS** | §5 |
| 不得用"加一次性 warn"充数 | 本档一行 warn 都没加；修的是**出口 + 阈值** | **PASS** | §1 |
| W-1 是否落在热面 | **热面**（零重启，实测 2 s） | **PASS** | §8 |
| U-LD2 只上报不改行为 | 巡检仅调用 `describe()`/`documentPath`/`fs.watch`，无写入、无 API 改动 | **PASS** | §6 |
| U-LD3 与既有校验器对齐、不重复造 | 子代理 A 沿用 `verify-deployed-manifest-v1.mjs` 约定并扩张覆盖面 | **PASS**（A 自裁 PASS） | `drift/U-LD3-report.md` |
| U-LD3 只读 + 出清单 | 未改任何产品文件；`--check` 只读 | **PASS** | A 报告 |
| U-LD3 显式列出 6 类未覆盖补丁 + 漂移方向 | `DRIFT-LIST.md` 含 grep=0 原文 + 逐文件方向 | **PASS** | A 报告 §③ |
| U-LD3 误报闸门（不得把正常构建产物当漂移） | 12 条具名排除规则、未分类=0；`dist/**` **按闸门要求停下上报、未硬登记** | **PASS** | A 报告 §④ |
| 纪律：探针锁 / 不回收活锁 | 全部经 `run-locked-v1.mjs`；无 BLOCKED | **PASS** | §7 |
| 纪律：不写 `~/.dsh` 之外部署位 / deployed 写入交给协调者 | 本会话被沙箱拒绝；交付脚本由其执行 | **PASS** | §0-14 |
| 纪律：不传 `sandbox_permissions` | 全程未传 | **PASS** | — |
| 停止条件触发情况 | `ctx.effect` 语义**已确认**（未触发停止）；W-1 **确为热面**（未触发停止）；漂移清单**未误报**（A 用四路证据排除运行期状态、对 `dist/**` 选择上报不登记）⇒ **三个停止条件均未触发** | **PASS** | §9 |

**自裁决：PASS**。唯一需要协调者动作的是"执行 deployed 写入"（本会话沙箱不允许），以及"是否 stop 隔离宿主 1194018"。
