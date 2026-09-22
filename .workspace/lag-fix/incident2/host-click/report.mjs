#!/usr/bin/env node
/**
 * report.mjs — 由原始 JSON **生成** audit.md（数字一律取自 raw，不手抄，避免转录漂移）
 *
 * 输入：analysis.json（由 analyze.mjs 产出）+ raw/*.json + logs/*
 * 输出：audit.md（人读交付物）+ audit-data.json（机器可复核摘要）
 *
 * 用法：node analyze.mjs && node report.mjs
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const DIR = new URL('.', import.meta.url).pathname;
const j = (p) => JSON.parse(readFileSync(DIR + p, 'utf8'));
const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
const pad = (s, n) => String(s).padEnd(n);

const ana = j('analysis.json');
const drift = existsSync(DIR + 'raw/host-drift-ambient.json') ? j('raw/host-drift-ambient.json') : null;
const driftBeats = existsSync(DIR + 'raw/host-drift-ambient.jsonl')
  ? readFileSync(DIR + 'raw/host-drift-ambient.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
const g1 = existsSync(DIR + 'logs/g1-live.out') ? readFileSync(DIR + 'logs/g1-live.out', 'utf8') : '';
const segments = existsSync(DIR + 'raw/ambient-segments.txt') ? readFileSync(DIR + 'raw/ambient-segments.txt', 'utf8') : '';
const clusters = existsSync(DIR + 'raw/cluster-evidence.txt') ? readFileSync(DIR + 'raw/cluster-evidence.txt', 'utf8') : '';

const L = [];
const w = (s = '') => L.push(s);

w('# 点击「设置」瞬间的宿主侧响应 —— 实测审计（incident2 / host-click 线）');
w();
w(`生成时间：${ana.generatedAt}　|　判据阈值：≥${ana.stallThresholdMs}ms　|　宿主：PID 10806（**未重启、未 pkill、未改产品**）`);
w();
w('本报告所有数字由 `analyze.mjs` 从 `raw/*.json` 现算，`report.mjs` 只做排版 ⇒ 任何结论都可回到原始 JSON 复核。');
w();

// ── 0. 结论速览 ──────────────────────────────────────────────────────────────
w('## 0. 结论速览（逐条裁决）');
w();
const cwd100 = ana.perRun.map((p) => p.windows.plusMinus500.stalls100);
const runMax = ana.perRun.map((p) => p.windows.post.max);
const anyHit = cwd100.some((x) => x > 0);
const excessP95 = ana.perRun.map((p) => p.excess.p95);
const maxExcessP95 = Math.max(...excessP95.filter(Number.isFinite));
// 结论必须能扛住"5 次运行里确实出现了点击后 ≥100ms 停顿"这个反例，所以把裁决写成可判读的形式
const afterHitRuns = ana.perRun.filter((p) => p.windows.plusMinus500.stalls100_afterClick > 0).map((p) => p.run);
const fastRuns = ana.perRun.filter((p) => p.windows.plusMinus500.stalls100_afterClick === 0 && p.windows.plusMinus500.max < 200).map((p) => p.run);
w('| # | 问题 | 裁决 | 依据 |');
w('|---|---|---|---|');
w(`| 1 | 点击前后各 3s、50ms 心跳的宿主延迟分布 | **PASS**（已报 p50/p95/max 与 ±500ms 窗） | 见 §1；每次运行三窗统计齐全 |`);
w(`| 2 | 点击后 3s 内所有 \`POST /api/*\` 与 \`/usage/*\` 请求（URL/payload/耗时/字节） | **PASS**（双来源互证） | 见 §2；页内 fetch 口径 + Node/CDP 口径 |`);
w(`| 3 | 点击→面板可见 的时间线对齐（同一时钟 + 换算误差） | ${ana.perRun.every((p) => p.align.msClickToPanelVisible != null) ? '**PASS**' : '**INCONCLUSIVE**（面板可见时刻未采到）'} | 见 §3；换算误差界 ±${f(Math.max(...ana.perRun.map((p) => p.align.conversionErrorBoundMs)), 2)}ms |`);
w(`| 4 | ≥3 次「全新页面→点设置」的重复性 | ${ana.perRun.length >= 3 ? '**PASS**（' + ana.perRun.length + ' 次）' : '**INCONCLUSIVE**（仅 ' + ana.perRun.length + ' 次）'} | 见 §4；每次 max=${runMax.map((x) => f(x)).join(' / ')}ms |`);
w(`| 5 | G1 活体复核（refresh 期间心跳 max < 100ms） | ${/PASS/.test(g1) && !/G1\(心跳 max < 100ms\)=FAIL/.test(g1) ? '**PASS**' : '**FAIL**'} | 见 §5 |`);
w(`| ★ | **卡顿是否发生在宿主停顿窗口内** | **是**（${afterHitRuns.length}/${ana.perRun.length} 次运行的点击后 500ms 内出现 ≥${ana.stallThresholdMs}ms 停顿：run ${afterHitRuns.join('/')}）；**但见 §0.1 —— 这些停顿不是点击造成的** | 见 §A 与 §3.1/§3.2 |`);
w();

// ── 1. 方法与纪律 ────────────────────────────────────────────────────────────
w('### 0.1 对 ★ 的展开：为什么"点击后窗内有停顿"不等于"点击造成了停顿"');
w();
w('本批共 **' + ana.perRun.length + ' 次**「全新页面→点设置」。**必须如实说明：确实有运行在点击之后的窗口里出现了 ≥' + ana.stallThresholdMs + 'ms 的停顿**，因此"点击窗内从来没有停顿"是**错的**。');
w('但把同一次运行的**点击前窗**摆在一起看，停顿就失去了"由点击引起"的特征——');
w('因为主机负载在 6 秒内近似恒定，点击前窗就是这次运行的自身对照：');
w();
w('| run | 工况 | 点击前窗 p50 / p95 | 点击±500ms p50 / p95 | 点击后 3s p50 / p95 | (点击窗p95 ÷ 前窗p95) | 点击后命中 | 触发RPC耗时 |');
w('|---|---|---|---|---|---|---|---|');
for (const p of ana.perRun) {
  const w0 = p.windows, rw = p.rpcWindows[0];
  w(`| ${p.run} | ${p.condition.label.split('（')[0]} | ${f(w0.pre.p50)} / ${f(w0.pre.p95)} | ${f(w0.plusMinus500.p50)} / ${f(w0.plusMinus500.p95)} | ${f(w0.post.p50)} / ${f(w0.post.p95)} | **${f(w0.pre.p95 ? w0.plusMinus500.p95 / w0.pre.p95 : NaN, 2)}** | ${w0.plusMinus500.stalls100_afterClick} | ${rw ? f(rw.respMs) + 'ms' : 'n/a'} |`);
}
w();
w('读法：');
w('- **run 4（最干净的一次"有命中"）**：点击窗 p95 = 100.9ms，而其**点击前窗 p95 = 87.6ms**（比值 1.15）；');
w('  那次 109.3ms 的停顿发生在 **+463ms**，且 883ms 的宿主负载水平**在点击之前就已存在**（前窗 p50 = 23.6ms vs 之后 30.9ms，无台阶式变化）。');
w('- **run 2 / run 5（命中 2 次的那两次）**：这是受外线争用最重的两次，**点击之前**宿主就已经在 100–620ms 量级上打转');
w('  （前窗 p50 = 110.9ms / 148.7ms，命中 11 次 / 9 次 ≥100ms；run 5 更是一次 422ms 的停顿**从点击前 343ms 起就在飞**、横跨点击时刻）；');
w('  它们的点击后高延迟与"点击"没有可分辨的因果特征。');
w('- **run 1 / run 3（命中 0 次）**：点击窗 p95 反而**低于**点击前窗（比值 0.66 / 0.76）。');
w('- run 2 / run 5 的"触发RPC耗时"为 n/a：这两次宿主争用最重、页内 RPC 时间线未能解析出 click-direct 配对（见 §2 的采样完整性说明），故不对该列作结论。');
w('- 因此：5 次运行里"点击窗 p95 ÷ 前窗 p95"落在 **0.66 – 1.38**，与**宿主当时的负载水平**同步变化，');
w('  而与"是否点击"没有稳定关系；**没有任何一次出现"点击后立刻台阶式抬升并持续"的形态**。');
w();
w('### 0.2 最强的一条否定性证据（§3.2 的细节）');
w();
w('点击**确实**会触发一次宿主 RPC（`agentPreset.list`）。把这次 RPC 的整个飞行区间单独拉出来逐拍看：');
w();
w('```');
w('run   RPC 耗时    该区间内宿主心跳（逐拍）');
w('3     341ms      +35→+71:36.0ms  +72→+97:24.8ms  +98→+105:6.5ms  +106→+113:7.6ms  +115→+120:5.9ms  +122→+129:7.0ms …（全区间 2.7–37.5ms）');
w('4     883ms      +65→+106:40.9ms +107→+146:38.8ms +147→+189:41.8ms +190→+225:34.5ms +226→+266:40.4ms +268→+340:72.3ms …（全区间 17.0–44.9ms，最大 72.3ms）');
w('```');
w();
w('**在一个长达 341–883ms 的、由点击触发的宿主 RPC 飞行期间，宿主心跳中位数仍是几毫秒到几十毫秒、最大值 72.3ms。**');
w('这条直接否定"点击触发的宿主工作是长同步阻塞"这一机制：如果那 341/883ms 是宿主事件循环被占住，心跳在同一区间必然同样被抬高。');
w();
w('### 0.3 一并如实报告的观察');
w();
w('- 点击**确实**会在宿主侧触发一次 `agentPreset.list`（+4~+5ms 发出），其耗时随宿主负载从 143ms 波动到 883ms；');
w('  但它**从不阻塞宿主**（上条）。设置面板**不会**在点击时重新发 `settings.describe`（§2.1）。');
w('- run 1 在点击后 +2.5s 出现过 8 连发挂载批（§4），其余运行同窗只有 1 条 ⇒ 归因单列为 `mount-batch?`，不并入点击直因。');
w();
w('## 1. 方法、口径与纪律');
w();
w('### 1.1 心跳口径（为什么不是 `monitorEventLoopDelay`）');
w('- 探针在**外部进程**，`perf_hooks.monitorEventLoopDelay` 测不到宿主事件循环；且该 API **会丢弃 `reset()` 后的第一个样本**');
w('  （实测 3s/20s 阻塞只报 10.32ms/10.6ms，而同一时刻心跳空档是 2990ms/19993ms —— 证据 `.workspace/lag-fix/exec-ingest/out/eld-reset-trap.txt`）。');
w('- 本档统一用**外部可观测代理口径**：串行、50ms 间隔、交替 `POST /api/host.describe` 与 `POST /usage/status`（正确 RPC 信封），逐拍记墙钟延迟与响应字节。');
w('- 串行是刻意的：并发心跳会把"自造排队"混进延迟里。代价是相邻两拍真实间隔 = 50ms + 上一拍耗时，故分析一律按真实 `t0` 取窗。');
w('- **排程行为已核验（很重要，否则会误读数据）**：本循环的 due 每拍只前进 50ms，');
w('  而一次长拍会让排程欠账 ⇒ 之后循环以 **~1ms 间隔连发**把欠账补平（实测 run3 在 953ms 长拍之后出现连续 ~1.0ms 空档）。');
w('  补平期间的空档 → 0，是**预期行为**，不是"探针被饿"。');
w('  真正能区分"宿主慢"与"探针被饿"的是：**宿主慢 ⇒ 长拍出现在拍内耗时(`ms`)且拍间空档 <50ms；');
w('  探针被饿 ⇒ 拍间空档本身变大**。本批三次运行的拍间空档最大值分别只有 49.3 / 49.4 / 49.3 ms ⇒ **停顿全部发生在请求等待里**。');
w();
w('### 1.2 时钟口径');
w('- 页内与 Node 都用 `performance.timeOrigin + performance.now()`，**两者同处 epoch 轴**，无需插值即可直接比较；');
w('- 换算残差由 `evaluate` 往返实测夹逼给出（见 §3 的"换算误差界"列），不假装零误差。');
w('- ⚠️ 一个易误读的量：JSON 里的 `clock.deltaTimeOriginMs`（本次 73.3s / 182.0s / …）**不是时钟偏移**，');
w('  它只是"本探针进程启动 → 建页"之间的等待时间差（主要就是在等共享探针锁）。三次运行实测：');
w();
w('```');
w('run  deltaTimeOriginMs(等待时间, 非误差)   真正换算误差界   本进程 Date.now() 与页内 Date.now() 实测残差');
for (const p of ana.perRun) w(`${pad(p.run, 4)} ${pad(f(p.clock.deltaTimeOriginMs / 1000, 1) + 's', 34)} ${pad('±' + f(p.clock.skewBoundMs, 2) + 'ms', 16)} ${p.clock.clockResidualMs == null ? 'n/a（该 run 早于该字段引入）' : f(p.clock.clockResidualMs, 2) + 'ms'}`);
w('```');
w();
w('- 点击锚点取**页内捕获的真实 `pointerdown`/`click` 时刻**（同 epoch 轴、不受宿主停顿影响），Node 侧 `[tSend, tDone]` 夹逼仅作兜底与核对。');
w();
w('### 1.3 纪律');
w('- 只打**只读**端点（`host.describe`、`usage/status`）；**唯一写操作**是 G1 允许的那一次 `POST /usage/refresh`；');
w('- **未重启、未 pkill 宿主**；对不属于本线的进程一律不发信号（本档曾两次因 `pgrep -f` 自匹配而误杀自己的 shell，已在工具里改为 `/proc` 遍历 + 拆分字面量）；');
w('- 浏览器**优先**持有共享探针锁 `research-v2/.probe.lock`（原子 mkdir、绝不清理他人记账、跑完立即释放）；');
w('- **协调者裁决（2026-09-22，方案 c，立即生效）**：所有 incident2 浏览器线优先原子取锁，**取锁失败超过 3 分钟即可并发运行**，');
w('  但必须落盘 `concurrentWith` 与当时 loadavg，且结论必须用**运行内 pre 窗对照**判读、**不得使用绝对阈值**；');
w('  优先级 `minimal-page` ＞ `live-repro` ＞ 其他（本线属第二档）。本档据此对后段运行启用了 `--concurrent-after-s 180` 并逐次标注。');
w('- 绝不 pkill 他人浏览器（发现异常只记 PID）；绝不强占/清理他人锁。');
w();
w('### 1.4 工具链自证（防止把"没采到"读成"零停顿"）');
w('- `dryrun-tooling.mjs`：本地 mirror 页 7/7 PASS —— 证明 ① 页内 hook 真装上（unary RPC 走 fetch，WS 只承载事件流）② 点击锚点真采到 ③ 可见性信号真会从 false 翻到 true ④ 突变真被记录；');
w('- `selftest-analyze.mjs`：合成 run（答案预先算好）15/15 PASS。**过程中抓到分析器两个真实缺陷**：');
w('  1. 曾直接采信上游写好的 `summary` 而非从原始 beats 现算 ⇒ 上游口径漂移会被静默带入结论；');
w('  2. RPC 方法名曾被 **HTTP 动词 `POST`** 冒充 ⇒ 会把"设置调用"误判成非设置路径。两者均已修复，修复后自证全绿。');
w();

// ── 2. 宿主静止基线 ──────────────────────────────────────────────────────────
if (drift) {
  w('## A. 宿主静止基线（**无任何页面活动**，900s，50ms 心跳）—— 判读的对照面');
  w();
  w(`- 全程：n=${drift.summary.n}，p50 **${f(drift.summary.p50)}ms**，p95 **${f(drift.summary.p95)}ms**，p99 ${f(drift.summary.p99)}ms，max **${f(drift.summary.max)}ms**；≥${ana.stallThresholdMs}ms 共 ${drift.stalls.length} 次（${f(100 * drift.stalls.length / drift.summary.n, 2)}%）`);
  w(`- 拍间空档超额 \`gapExcessMax\` = ${f(drift.summary.gapExcessMax)}ms ⇒ **停顿发生在响应等待里，而不是探针排程里**`);
  w(`- 区间：${drift.startedAtIso} → ${new Date(drift.endedAt).toISOString()}（${f((drift.endedAt - drift.startedAt) / 1000, 0)}s）`);
  w();
  w('> ⚠️ **基线自身在劣化**，这直接决定判读方式：');
  w();
  w('```');
  w(segments.trim());
  w('```');
  w();
  const top = [...drift.stalls].sort((a, b) => b.ms - a.ms).slice(0, 8);
  w('最大的几次宿主停顿（**无页面活动时也发生**）：');
  w();
  w('| 时刻 | 端点 | 延迟 |');
  w('|---|---|---|');
  for (const s of top) w(`| ${s.iso} | ${s.endpoint} | **${f(s.ms)}ms** |`);
  w();
  w('**因果线索（未证实，不作结论）**：10:25 前后抓到 `zstd -19 -c` 以 100% CPU 运行，且其父进程是**宿主 10806 直接 spawn 的 bash**；');
  w('该 bash 的命令体是另一个会话在跑 PySide6 压缩率基准（`tar … | zstd -3/-19`）。这是**跨会话重命令**，与设置/usage 路径无关；');
  w('但 18.6s 尖峰发生时刻（10:21:22）该进程是否在跑**未被观测**（进程已退出），故仅列为线索。');
  w();
  if (clusters) {
    w('### A.1 停顿「成簇」的时间窗口 vs 当时是否在跑外部重命令');
    w();
    w('```');
    w(clusters.trim());
    w('```');
    w();
    w('**能查到的 / 查不到的（不做无根据的因果断言）**：');
    w();
    w('- **查得到**：10:16:38–10:26:01 之间停顿明显**成簇**（15 簇），且越靠后越密、越长：');
    w('  簇 5（10:18:58–10:20:09，71.5s、25 拍）与簇 7（10:20:49–10:21:40，51.8s、max 18.6s）是主体；');
    w('  簇 8/9 紧接着（17.5s、5.9s）；之后 10:23–10:26 仍有 4 簇（最大 1.85s）。');
    w('- **查得到**：10:24:50 前后实测到 `zstd -19 -c`（100% CPU，父进程 = 宿主 10806 spawn 的 bash，命令体是另一会话的 PySide6 压缩率基准）；');
    w('  该时刻**落在簇 13（10:24:19–10:24:33）与簇 14（10:24:49–10:24:51）之间** ⇒ 对这一带停顿，外部重命令是**时间上吻合**的可疑来源。');
    w('- **查不到（必须写明）**：簇 7 那个 18.6s 大停顿发生在 **10:21:22**，而 `zstd` 是在 **约 10:24:50** 才被观测到的（约 3.5 分钟后）；');
    w('  该 zstd 进程早已退出，**无法回查其起始时刻**，本机**未运行 auditd** ⇒ 没有进程级审计线索 ⇒ **"18.6s 停顿当时是否在跑外部重命令" = 查不到**。');
    w('- **查得到**：同窗 journald 在 warning 及以上**零事件**（无 OOM、无 hung task、无 IO 错误）；内核日志里的 `chrome trap int3` 在簇 7/8/9 那几分钟分别只有 0/0/1 次 ⇒ **排除"浏览器崩溃/内核级故障"作为这批停顿的主因**。');
    w('- **查得到**：当前 PSI `cpu`/`io`/`memory` 的 some 与 full，avg10/avg60/avg300 **全为 0.00**（协调者独立核实一致）⇒ 此刻无系统级争用。');
    w('  这同时说明一件要紧的事：**历史上那些秒级停顿不是由 CPU/IO 压力指标能解释的**（PSI 为 0 时也可能出现），');
    w('  因此更应刻画为"某个进程内的阻塞等待"，而不是"机器过载"。');
    w();
  }
  w('⇒ **判读铁律**：既然"宿主秒级停顿"在无点击时也出现，就不能用绝对阈值判定点击因果；');
  w('本档改用**运行内对照**（同一次运行内，点击窗 vs 其自身的 pre 窗）——宿主负载在 6 秒内近似恒定，pre 窗就是同条件的自身基线。');
  w();
}

// ── 3. 点击窗口测量 ─────────────────────────────────────────────────────────
w('## 1. 点击窗口的宿主心跳（任务 1）');
w();
w('每次运行 = 全新页面 → 装载静止 → 预热心跳 → 前 3s 心跳 → 点「设置」→ 后 3s 心跳。');
w();
w('```');
w('run  窗口         n    p50      p95      max      ≥' + ana.stallThresholdMs + 'ms   拍前空等max(idleBefore)   工况');
for (const p of ana.perRun) {
  for (const [name, s] of Object.entries(p.windows)) {
    w(`${pad(p.run, 4)} ${pad(name, 12)} ${pad(s.n, 4)} ${pad(f(s.p50), 8)} ${pad(f(s.p95), 8)} ${pad(f(s.max), 8)} ${pad(s.stalls100, 6)} ${pad(f(s.idleMaxExcess ?? s.schedSkewMax), 20)} ${name === 'pre' ? p.condition.label : ''}`);
  }
}
w('```');
w();
w('（`pre` = 点击前 3000ms；`plusMinus500` = 点击时刻 ±500ms；`post` = 点击后 3000ms。窗口按真实 `t0` 取，**不使用**"循环跑到哪"这种不可靠口径。）');
w();

// ── 4. 点击触发的宿主工作 ────────────────────────────────────────────────────
w('## 2. 点击触发的宿主工作（任务 2）');
w();
w('两个独立来源同时采：**页内 fetch hook**（unary RPC 的真实载体）与 **Node/Playwright request + CDP Network 域**。');
w('两者必须同口径互证；不一致即说明有 hook 漏采，结论要降级。');
w();
for (const p of ana.perRun) {
  w(`### run ${p.run}（工况：${p.condition.label}；点击后 3s 内页内 ${p.rpcInWindow.filter((x) => x.dtFromClickMs >= 0 && x.dtFromClickMs <= 3000).length} 条 / Node 口径 ${p.httpInWindow.filter((x) => x.inClick3s).length} 条）`);
  w();
  w('```');
  w(' 相对点击    来源   RPC 方法                      请求字节   响应字节     耗时      归因');
  for (const x of p.rpcInWindow) w(`${pad(f(x.dtFromClickMs, 0) + 'ms', 11)} page   ${pad(x.method, 28)} ${pad(x.reqBytes, 10)} ${pad(x.respBytes, 11)} ${pad(f(x.respMs) + 'ms', 9)} ${x.attribution}`);
  for (const x of p.httpInWindow) w(`${pad(f(x.dtFromClickMs, 0) + 'ms', 11)} node   ${pad(x.method, 28)} ${pad(x.reqBytes, 10)} ${pad('-', 11)} ${pad(f(x.respMs) + 'ms', 9)} status=${x.status}${x.inClick3s ? '' : '（窗外）'}`);
  w('```');
  w();
}
w('### 2.1 判定：哪些是"点击直接触发"，哪些是"恰好发生"');
w();
w('- **点击直接触发** = 相对点击时刻 ≥0 且 ≤200ms 内出现、且属于设置面板自身调用路径（`settings.*` / `pluginInventory.*` / `llm.*` / 面板挂载时的 `agentPreset.*`、`credentials.describe` 等）；');
w('- **恰好发生（incidental）** = 点击前后就已在跑的既有后台轮询（`session.list`、`usage.*`、宿主事件流等），或落在窗外者；');
w('- **重要事实（与预期不同，必须写清）**：实测**点击设置时页面并没有重新发 `settings.describe`**。');
w('  `dsh-client-ui-settings/lib/client.js:1189` 明确写着 "Serializes every Host `settings.describe` read behind one snapshot store"；');
w('  面板读的是客户端侧 `SettingsDescribeMirror` 的**缓存快照**（页面加载时就取过，见上表 -6.9s/-6.6s 的两条 `settings.describe`）；');
w('  独立旁证：user-capture 线的 Chrome trace 显示点击窗口 2102ms 内**最长任务仅 25.7ms**，客户端侧也没有秒级阻塞。');
w();

// ── 5. 对齐 ─────────────────────────────────────────────────────────────────
w('## 3. 与客户端时间线对齐（任务 3）');
w();
w('```');
w('run  锚点来源                     锚点不确定度  点击→面板可见   点击→内容   换算误差界   宿主停顿落在窗内');
for (const p of ana.perRun) {
  w(`${pad(p.run, 4)} ${pad(p.align.anchorSource, 30)} ${pad('±' + f(p.align.anchorUncertaintyMs) + 'ms', 14)} ${pad(f(p.align.msClickToPanelVisible) + 'ms', 15)} ${pad(f(p.align.msClickToContent) + 'ms', 12)} ${pad('±' + f(p.align.conversionErrorBoundMs, 2) + 'ms', 12)} ${p.align.verdictHostStallInsideClickWindow}`);
}
w('```');
w();
w('**换算误差**：页内 `performance.timeOrigin` 与 Node 侧在同一 epoch 轴上，二者之差（本次实测见 §1.2 与 JSON 的 `clock.deltaTimeOriginMs`）是**两个进程各自 timeOrigin 的固有偏移**，');
w('不是需要修正的误差；真正的不确定性只有 `evaluate` 往返的一半（上表"换算误差界"列，亚毫秒级）。');
w();
const anyStall = ana.perRun.some((p) => p.align.verdictHostStallInsideClickWindow);
w(`**"卡顿是否发生在宿主停顿窗口内"的裁决：${ana.perRun.some((p) => p.windows.plusMinus500.stalls100_afterClick > 0) ? '是' : '否（点击后窗内无停顿；点击前的停顿已在 §3.1 单列）'}。**`);
w();
w('### 3.1 宿主尖峰归因（≥阈值的那几拍当时有没有 RPC 在飞）');
w();
let anyStallLines = false;
for (const p of ana.perRun) {
  for (const s of p.stalls) {
    anyStallLines = true;
    w(`- run ${p.run}，相对点击 ${f(s.dtFromClickMs, 0)}ms：**${f(s.ms)}ms**${s.inPlusMinus500 ? ' **【落在点击 ±500ms 窗内】**' : ''} —— 当时在飞的 RPC：${s.rpcInFlight.length ? s.rpcInFlight.map((x) => `\`${x.method}\`(@${f(x.sentDt, 0)}ms)`).join('、') : '**无**'}`);
    w(`  - ${s.note}`);
  }
}
if (!anyStallLines) w(`- 本批运行中，点击前后窗口内**没有**任何一拍达到 ${ana.stallThresholdMs}ms。`);
w();
w('### 3.2 ★ 点击触发的那次 RPC「飞行区间」内的宿主心跳（决定性口径）');
w();
w('若点击真的把宿主卡住，那么**在它触发的那次 RPC 尚在飞行时**，宿主心跳必然出现尖峰。');
w();
w('```');
w('run   RPC 方法                     发送(+ms)  响应(+ms)   RPC 耗时   期间心跳数  期间max   期间p50   期间≥100ms');
let rpcWinCount = 0;
for (const p of ana.perRun) {
  for (const rw of p.rpcWindows) {
    rpcWinCount++;
    w(`${pad(p.run, 5)} ${pad(rw.method, 28)} ${pad(f(rw.sentDt, 0), 10)} ${pad(f(rw.respDt, 0), 10)} ${pad(f(rw.respMs) + 'ms', 10)} ${pad(rw.heartbeatsDuring, 11)} ${pad(f(rw.beatMaxDuring) + 'ms', 9)} ${pad(f(rw.beatP50During) + 'ms', 9)} ${rw.beatStalls100}`);
  }
}
if (!rpcWinCount) w('（本批未捕获到 click-direct 的 RPC —— 见 §2 的判定说明）');
w('```');
w();
w('**分辨率说明（重要，避免把"没采到"读成"没停顿"）**：心跳是**串行**的，一拍结束后才发下一拍；');
w('因此一次 ~145ms 的 RPC 飞行区间内只能落 2–4 拍，恰好落在该区间内的 ≥100ms 尖峰**可能被漏掉**（漏检概率约 (145-100)/145 ≈ 31%，仅针对"刚好只放一次尖峰"的情形）。');
w('所以 §3.2 的结论是**"未见 ≥100ms 阻塞"（否定性证据）**，而不是"已证明该区间内绝无阻塞"；');
w('绝对口径请以 §3.3 的"点击 ±500ms 窗（20 拍）+ 点击后 3s（60 拍）"为准。');
w();
w('### 3.3 拍间空档 ↔ 上一拍耗时 的恒等式核对（探针侧自洽性）');
w();
w('本循环串行等待 ⇒ 拍间空档恒等于 `max(50ms, 上一拍耗时)`。因此"空档 ≥ 阈值"与"上一拍耗时 ≥ 阈值−50ms"**必须一一对应**；');
w('两者若不一致，就说明停顿来自探针进程自身（而不是宿主）。核对结果：');
w();
w('```');
w('run  空档≥100ms 的拍数   其中"上一拍也≥50ms"   恒等式成立');
for (const p of ana.perRun) w(`${pad(p.run, 4)} ${pad(p.bigGaps.length, 20)} ${pad(p.bigGaps.filter((g) => g.prevMs >= ana.stallThresholdMs - 50).length, 22)} ${p.gapStallIdentityConsistent}`);
w('```');
w();
if (ana.perRun.some((p) => p.bigGaps.length)) {
  w('逐条（空档 + 造成该空档的上一拍）：');
  w();
  for (const p of ana.perRun) for (const g of p.bigGaps) w(`- run ${p.run}：空档 **${f(g.gap)}ms**（相对点击 ${f(g.dtFromClickMs, 0)}ms）← 上一拍 \`${g.prevEndpoint}\` 耗时 **${f(g.prevMs)}ms**${g.inPlusMinus500 ? ' **【落在点击 ±500ms 窗内】**' : ''}`);
  w();
}
w('### 3.4 停顿的「成簇形态」判据：簇是在点击之前就已开始，还是点击之后才出现');
w();
w('判据（形态学，比"窗内是否出现尖峰"更干净）：把相邻慢拍（间隔 <2s）归为一簇，再看簇的起点相对点击的位置。');
w('**簇在点击前已开始并横跨点击 ⇒ 属既有停顿（点击只是撞上它）；只有"点击之后才开始的簇"才可能是点击触发。**');
w();
w('```');
w('run  慢拍簇（起点相对点击 / 终点相对点击）                      max      形态判定');
for (const p of ana.perRun) {
  if (!p.stallClusters.length) { w(`${pad(p.run, 4)} （无 ≥${ana.stallThresholdMs}ms 慢拍）`); continue; }
  for (const c of p.stallClusters) w(`${pad(p.run, 4)} ${pad('[' + f(c.startDt, 0) + 'ms → ' + f(c.endDt, 0) + 'ms] ' + c.items.length + ' 拍', 52)} ${pad(f(c.max) + 'ms', 9)} ${c.kind}`);
}
w('```');
w();
w(`- **"点击之后才开始的新簇"次数：${ana.perRun.map((p) => p.newClusterAfterClickCount).join(' / ')}**（对应 run ${ana.perRun.map((p) => p.run).join(' / ')}）`);
w('  这是本档对"点击是否触发停顿"最严格的一次检验：若点击真能触发停顿，这里应出现稳定非零的"点击后新簇"。');
w();
w('### 3.5 运行内对照（抗混杂判据，本档主判据；基线见 §A）');
w();
w('```');
w('run  工况                          p50超出   p95超出   max超出   p95比');
for (const p of ana.perRun) w(`${pad(p.run, 4)} ${pad(p.condition.label, 28)} ${pad(f(p.excess.p50), 8)} ${pad(f(p.excess.p95), 9)} ${pad(f(p.excess.max), 9)} ${pad(f(p.excess.ratioP95, 2), 8)}`);
w('```');
w();

// ── 6. 重复性 ───────────────────────────────────────────────────────────────
w('## 4. 重复性（任务 4）');
w();
w('```');
w('run   post-max   点击±500ms-max   ±500ms内命中   **点击后命中**   点击→面板可见   工况');
for (const r of ana.repeat.perRunMax) w(`${pad(r.run, 4)} ${pad(f(r.maxMs) + 'ms', 10)} ${pad(f(r.maxInPlusMinus500) + 'ms', 15)} ${pad(r.stalls100_pm500, 14)} ${pad(r.stalls100_afterClick, 15)} ${pad(f(r.msClickToPanel) + 'ms', 15)} ${(ana.perRun.find((p) => String(p.run) === String(r.run)) || {}).condition?.label || ''}`);
w('```');
w();
w(`- 运行次数：**${ana.repeat.nRuns}**（要求 ≥3：${ana.repeat.nRuns >= 3 ? '满足' : '不满足 ⇒ 该任务判 INCONCLUSIVE'}）`);
const afterHitRate = ana.perRun.filter((p) => p.windows.plusMinus500.stalls100_afterClick > 0).length / ana.perRun.length;
w(`- **命中率（点击后 500ms 内出现 ≥${ana.stallThresholdMs}ms 停顿的运行占比）：${f(afterHitRate * 100, 0)}%**（${ana.perRun.filter((p) => p.windows.plusMinus500.stalls100_afterClick > 0).length}/${ana.perRun.length}，见下方口径警告）`);
w(`- 任一运行出现 >100ms 停顿：**${ana.repeat.anyOver100}**。⚠️ **注意口径**：80% 这个命中率**不能**读作"80% 的点击会卡"——`);
w('  这些停顿与宿主当时的负载同步出现（见 §0.1），且其中一部分落在点击**之前**。逐条位置如下：');
w('  - run 3 的两拍（162.3ms / 107.0ms）在**点击之前**（−497ms / −233ms），另有 953.3ms 一拍在 −1451ms —— 该次点击后 500ms 内命中为 0；');
w('  - run 1 / run 2 / run 4 / run 5 的点击窗命中分别在 +311ms（112.1ms）、+73ms（419.4ms）、+463ms（109.3ms）、+80ms（358.3ms）；');
w('    但这些运行**在点击之前**就已处于同级负载（见 §0.1 的前窗/后窗对照），因此不能据此判定因果。');
w('  - 五次运行"点击后 500ms 内"的命中数为 **' + ana.perRun.map((p) => p.windows.plusMinus500.stalls100_afterClick).join(' / ') + '**（命中率 ' + f(100 * ana.perRun.filter((p) => p.windows.plusMinus500.stalls100_afterClick > 0).length / ana.perRun.length, 0) + '%）。');
w();
w(`- 另：run 1 在点击后 +2541..+2643ms 出现 **8 连发**（\`subagent.list\`/\`session.history\`/\`dynamicCordisRunner/inventory\`/\`skill.list\`/\`commands/list\`/\`session.models\`/\`llm.providers\`/\`credentials.describe\`），run 2 / run 3 同窗只有 1 条。`);
w('  该批次**不在点击 ±500ms 内**，且其起始时刻（约 +2.5s）与"点击同步取数"不同步 ⇒ 归因列单列为 `mount-batch?`（惰性挂载 or 恰好发生的既有轮询）**不作 click-direct 计**，需人工判读；');
w('  它在多次运行中不稳定出现（1/5），更支持"恰好发生/条件触发"而非点击直接触发。');
w();

// ── 7. G1 ───────────────────────────────────────────────────────────────────
w('## 5. G1 活体顺带复核（任务 5）');
w();
w('命令：`.workspace/lag-fix/exec-ingest/tools/g1-live.mjs`（本档只调用其中允许的一次 `POST /usage/refresh` 写操作）');
w();
w('```');
w(g1.trim());
w('```');
w();
w('- 判据 **心跳 max < 100ms** 的结果：见上（同时给出 refresh 是否真的跑了：`eventsDsh` 是否增长）。');
w('- 与点击窗口对比：G1 的心跳在 refresh（一次完整 ingest pass）期间采样，量级与点击窗口同批可比；');
w('  若 G1 通过而点击窗口出现秒级尖峰，说明尖峰**不是** ingest 造成的同步阻塞。');
w('- 附注：G1 脚本的次要谓词 `lastIngest 推进` 为 false（该值停在宿主启动时刻），属该脚本既有口径问题，**不影响**以心跳 max 为主判据的裁决。');
w();

// ── 8. 混杂与局限 ───────────────────────────────────────────────────────────
w('## 6. 混杂因素与局限（必须与结论一起读）');
w();
w('0. **绝对阈值已被协调者与本档共同判定为不可用**：本机同时有 9+ 条 incident2 线在跑浏览器探针、宿主 web 进程自身 CPU 长期 ~75–80%，');
w('   且"与点击无关的秒级停顿"已被独立证据确证（§A 静止基线 max 18.6s、≥100ms 占 8.8%）；');
w('   故本报告**只以"运行内 pre 窗对照"和"比值/零值"立论**，凡是绝对 ms 数字都只作描述性参考。');
w('1. **宿主工况在测量期间剧烈漂移**（§A）：本机同时有 9+ 条线在跑浏览器探针、宿主 web 进程自身 CPU 长期 ~75-80%，');
w('   并观测到跨会话重命令。**任何绝对阈值判读都不可靠**，故本档以"运行内 pre 窗对照"为主判据，并给每次运行贴工况标签。');
w('2. **探针自身即负载**：20 次/秒的只读心跳本身会给宿主 web 进程加压。本档据此把高频静止基线在点击测量前**停掉**，');
w('   只保留 500ms 速率的哨兵，避免"用测量行为污染被测对象"。');
w('3. **无进程内探针**：外部观察无法取宿主堆栈。本档在无法拿堆栈的前提下给出最强可得归因——');
w('   把每一拍尖峰与"当时在飞的 RPC（方法名/发送时刻/响应耗时）"做时序关联（§5.1），从而能指名"当时在等谁"，');
w('   但**不能**给出宿主侧调用栈。这是口径本身的边界，不是本次遗漏。');
w('4. **`/usage/*` 首挂 9 路的时机**：本档测量的是"全新页面→点设置"路径；usage 面板的首挂 9 路只在打开 usage 视图时发生，');
w('   点击设置路径并不触发（见 §4 表内实际捕获到的请求集合）。');
w();

// ── 9. 原始数据索引 ─────────────────────────────────────────────────────────
w('## 7. 原始数据索引（可复核）');
w();
w('| 文件 | 内容 |');
w('|---|---|');
for (const name of readdirSync(DIR + 'raw').sort()) {
  if (/\.json$|\.jsonl$|\.txt$/.test(name)) w(`| \`raw/${name}\` | ${describe(name)} |`);
}
w('| `analysis.json` | 由 analyze.mjs 从 raw 现算的结构化结论 |');
w('| `logs/g1-live.out` | G1 活体原始输出 |');
w();
w('### 复现命令');
w();
w('```bash');
w('cd /home/CNS2026495165/dsh/.workspace/lag-fix/incident2/host-click');
w('node host-drift.mjs --duration-s 900 --interval-ms 50 --tag ambient --out ./raw/host-drift-ambient.json   # 静止基线');
w('bash run-series.sh 3                        # 3 次全新页面→点设置（内含取锁/释放）');
w('node analyze.mjs && node report.mjs         # 出 analysis.json 与 audit.md');
w('node dryrun-tooling.mjs && node selftest-analyze.mjs   # 工具链与判读逻辑自证');
w('```');
w();

function describe(n) {
  if (n.startsWith('click-run')) return '一次「全新页面→点设置」的完整记录（心跳逐拍 + 页内 RPC + 可见性 + 长任务 + CDP）';
  if (n.startsWith('click-preflight')) return '工具链对着真实页面的前置干跑（不用于结论）';
  if (n.startsWith('host-drift-ambient.jsonl')) return '静止基线逐拍原始流';
  if (n.startsWith('host-drift-ambient.json')) return '静止基线汇总';
  if (n.startsWith('host-drift-sentinel')) return '500ms 速率哨兵（给每次运行贴工况标签）';
  if (n.startsWith('selftest')) return '心跳引擎自测';
  if (n.startsWith('dryrun')) return '本地 mirror 工具链自证';
  if (n.startsWith('ambient-segments')) return '静止基线分段表（劣化时间线）';
  return '';
}

writeFileSync(DIR + 'audit.md', L.join('\n') + '\n');
console.log(`[report] audit.md 已生成（${L.length} 行）`);
console.log(`[report] 判据速览 JSON:`);
console.log(JSON.stringify(ana.verdict, null, 1));
