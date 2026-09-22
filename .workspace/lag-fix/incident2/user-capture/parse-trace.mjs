#!/usr/bin/env node
/**
 * parse-trace.mjs — DSH「点击设置卡顿」取证解析器
 *
 * 输入（自动判别，二者皆可）：
 *   1) Chrome / Edge DevTools Performance 面板导出的 JSON（Save profile）
 *      —— 顶层 {traceEvents:[...], metadata:{...}}（可能是 gzip 流被存成 .json 的情况，会尝试 gunzip）
 *   2) 方案 C 取证工具 dsh-jank-capture.html 导出的 JSON
 *      —— 顶层 {schema:"dsh-user-capture/v1", frames:[...], longTasks:[...], loaf:[...], ...}
 *
 * 输出（默认：人可读文本；--json <path> 另存机器可读 JSON）：
 *   - 点击前后各 3 秒（可调）的帧分布
 *   - 最长任务 top 10（含函数名与 URL）
 *   - Script / RecalcStyle / Layout / Paint 分项
 *   - 是否命中已知修复项（ui-layout:366 / usage / runtime）
 *
 * 纪律：只读。脚本只读取输入文件、只写 --json/--out 指定的输出文件（默认不写任何文件）。
 *
 * 用法：
 *   node parse-trace.mjs <trace.json>                        # 打印报告
 *   node parse-trace.mjs <trace.json> --json report.json      # 另存 JSON
 *   node parse-trace.mjs <trace.json> --window 3000           # 锚点前后各 3000ms（默认）
 *   node parse-trace.mjs <trace.json> --anchor 12345          # 手动指定锚点（trace 时间戳；user-capture 为会话内毫秒）
 *   node parse-trace.mjs <trace.json> --rev ui-layout=82cca1a6178a,runtime=5559de4ce28c
 *                                                            # 人工投喂「实际下发 rev」用于判定
 *   node parse-trace.mjs <trace.json> --require-rev ui-layout=82cca1a6178a   # 不匹配则以退出码 3 结束（用于验证脚本自测）
 *   node parse-trace.mjs <trace.json> --self-test             # 内部一致性自检并打印结果
 *
 * 退出码：0 成功 · 2 输入不可解析 · 3 --require-rev 不满足 · 4 内部自检失败
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/* ══════════════════════════════════════════════════════════════════
   0. 已知修复项登记表（rev 口径：宿主下发的 client.js?rev=<sha1 前 12 位>）
   ══════════════════════════════════════════════════════════════════ */
const KNOWN_FIXES = [
  {
    key: 'ui-layout',
    label: 'ui-layout:366 —— 帧内 rAF 合并（themeColor 强制重算去重）',
    module: 'dsh-client-ui-layout',
    anchors: ['82cca1a6178a'],
    // 该修复在源码里的结构特征：themeColorRefreshQueue(Set) + themeColorFrame 句柄 + requestAnimationFrame 内批量 refreshThemeColor
    code_signature: [
      'themeColorRefreshQueue',
      'themeColorFrame',
      'requestAnimationFrame',
      'refreshThemeColor',
    ],
    symptom: '点击设置时 recalc/layout 被高频强制重算，主线程 busy 高、p99 帧间隔恶化',
    evidence_kind: 'rev + 代码结构签名',
  },
  {
    key: 'runtime',
    label: 'dsh-client-runtime —— U-P2AC（客户端 runtime 热面修复）',
    module: 'dsh-client-runtime',
    anchors: ['5559de4ce28c'],
    code_signature: ['p2ac-fix'],
    symptom: '设置页首次打开路径上的残留/重复执行与事件流重放',
    evidence_kind: 'rev + 标记 /* p2ac-fix */ ×4',
  },
  {
    key: 'usage',
    label: 'dsh-usage —— U-IG1/IG2/IG3/CC1（宿主 ingest 阻塞 + 游标 off-by-one）',
    module: 'dsh-usage',
    anchors: ['4536b91ed282'],
    code_signature: ['ingest-worker', 'INGEST_TIMER_ENABLED'],
    symptom: '宿主事件循环被同步 fold 长时间占用（G1 实测同步路径 31,188 ms vs worker 11.07 ms）⟹ 页面 RPC 一起卡',
    evidence_kind: 'rev + 宿主事件循环延迟（页面侧只能看到 RPC 变慢）',
    note: '该修复在宿主（冷面），页面 trace 里只能看到「一次 RPC/一次长任务」，需要与宿主侧 G1 数据联合判读。',
  },
  {
    key: 'wallpaper',
    label: 'dsh-wallpaper —— (iv-a) 内容比较去重',
    module: 'dsh-wallpaper',
    anchors: ['826d9217a8fc'],
    code_signature: ['sameShadedTokens', 'shadedTokens'],
    symptom: '主题色/壁纸重算在设置页被反复触发',
    evidence_kind: 'rev + 代码结构签名',
  },
];

const DEFAULT_WINDOW_MS = 3000;
const FRAME_BUCKETS = [
  { label: '<16.7 (≥60fps)', lo: -Infinity, hi: 16.7 },
  { label: '16.7–33 (30–60fps)', lo: 16.7, hi: 33 },
  { label: '33–50 (20–30fps)', lo: 33, hi: 50 },
  { label: '50–100 (10–20fps)', lo: 50, hi: 100 },
  { label: '100–250 (4–10fps)', lo: 100, hi: 250 },
  { label: '>250 (<4fps)', lo: 250, hi: Infinity },
];

/* ══════════════════════════════════════════════════════════════════
   1. 通用工具
   ══════════════════════════════════════════════════════════════════ */
const fmt = (n, d = 1) => (n === null || n === undefined || Number.isNaN(n) ? 'n/a' : Number(n).toFixed(d));
const pct = (n, d = 1) => (n === null || n === undefined || Number.isNaN(n) ? 'n/a' : Number(n).toFixed(d) + '%');
const short = (s, n = 96) => (s == null ? '' : String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

function quantile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

/** 从 RunTask/FunctionCall 的 args.task 里抽出函数名与 URL
 *  Chrome 的格式形如："FunctionCall https://host/path/file.js:120:34" 或 "EvaluateScript"
 *  也可能是 "v8.run", "TimerFire", "EventDispatch" 等无 URL 形式。 */
function parseTaskString(task) {
  if (!task || typeof task !== 'string') return { fn: null, url: null, line: null, col: null };
  const out = { fn: null, url: null, line: null, col: null };
  // 先按「URL + :line:col」匹配（URL 必须贪婪，否则 \S+? 会在第一个 ':' 处提前截断，
  // 导致 https://host:3080/x.js:12:5 被切成 url="https"，line/col 也拿不到）
  const m = task.match(/^(.*?)\s+((?:https?|file|webpack|chrome-extension):\/\/\S*)\:(\d+)\:(\d+)\s*$/);
  if (m) {
    out.fn = m[1].trim() || null;
    out.url = m[2] || null;
    out.line = Number(m[3]);
    out.col = Number(m[4]);
  } else {
    // 无行列号：退化为「函数名 + 可选 URL」
    const m2 = task.match(/^(.*?)\s+((?:https?|file|webpack|chrome-extension):\/\/\S*)\s*$/);
    if (m2) {
      out.fn = m2[1].trim() || null;
      out.url = m2[2] || null;
    } else {
      out.fn = task.trim() || null;
    }
  }
  return out;
}

/** Chrome devtools.timeline 事件名 → 我们的分项归类 */
function classifyStage(name) {
  switch (name) {
    case 'RunTask':
    case 'FunctionCall':
    case 'EvaluateScript':
    case 'v8.compile':
    case 'v8.compileModule':
    case 'CompileScript':
    case 'V8.Execute':
    case 'TimerFire':
    case 'EventDispatch':
    case 'XHRLoad':
    case 'XHRReadyStateChange':
    case 'ResourceSendRequest':
    case 'ResourceReceiveResponse':
    case 'ResourceFinish':
    case 'UpdateCounters':
    case 'MinorGC':
    case 'MajorGC':
    case 'BlinkGC':
    case 'GC':
      return 'script';
    case 'UpdateLayoutTree':      // 旧名 RecalculateStyles（devtools 里显示为 Recalc Style）
    case 'RecalcStyle':
    case 'InvalidateLayout':
      return 'recalcStyle';
    case 'Layout':
    case 'UpdateLayerTree':
    case 'ScheduleStyleRecalculation':
      return 'layout';
    case 'Paint':
    case 'PaintSetup':
    case 'RasterTask':
    case 'CompositeLayers':
    case 'Commit':
    case 'GraphicsLayer':
    case 'DrawFrame':
    case 'ActivateLayerTree':
      return 'paint';
    default:
      return null;
  }
}

const STAGE_LABEL = {
  script: 'Script（JS 执行）',
  recalcStyle: 'RecalcStyle（样式重算）',
  layout: 'Layout（布局）',
  paint: 'Paint/Raster/Composite（绘制、合成）',
};

/* ══════════════════════════════════════════════════════════════════
   2. 载入 + 形态判别
   ══════════════════════════════════════════════════════════════════ */
function loadJson(file) {
  const raw = fs.readFileSync(file);
  let buf = raw;
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try { buf = zlib.gunzipSync(buf); } catch { /* 交给下面的 JSON 解析报错 */ }
  }
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // 容忍 DevTools 有时导出的「不是合法 JSON 而是 JSONP/数组」等形态
  try {
    return JSON.parse(text);
  } catch (e) {
    const trimmed = text.trim();
    throw new Error(
      'JSON 解析失败：' + e.message +
      '\n  文件前 120 字节：' + JSON.stringify(trimmed.slice(0, 120)) +
      '\n  常见原因：① 文件其实是 gzip 二进制被当文本存过（字节被替换成 U+FFFD，不可恢复，需重新导出）；' +
      '\n            ② 导出的是 Playwright tracing 的 zip（不是 DevTools Performance 的 JSON）；' +
      '\n            ③ 下载未完成。'
    );
  }
}

function detectShape(doc) {
  if (doc && Array.isArray(doc.traceEvents)) return 'devtools-trace';
  if (doc && typeof doc.schema === 'string' && doc.schema.startsWith('dsh-user-capture/')) return 'user-capture';
  if (Array.isArray(doc)) return 'bare-event-array';   // 极少数导出形态
  return 'unknown';
}

/* ══════════════════════════════════════════════════════════════════
   3. DevTools trace 解析
   ══════════════════════════════════════════════════════════════════ */
function parseDevtoolsTrace(doc) {
  const raw = doc.traceEvents.filter((e) => e && typeof e === 'object');
  const X = raw.filter((e) => e.ph === 'X' && typeof e.dur === 'number' && typeof e.ts === 'number');
  // 只收 blink.user_timing（28~29 个）；绝不收 StackCpuSampling/ProfileChunk 之类，
  // 否则 7 万+ 事件会把下面的 400 条上限吃满，把真正的 performance.mark 挤出数组（实测踩过）。
  const marks = raw.filter((e) => e.cat && String(e.cat).includes('blink.user_timing'));
  if (!X.length) throw new Error('trace 里没有任何完整的 ph="X" 时长事件，无法解析（可能导出了空档案或错误数据集）');

  const total = X.reduce((a, e) => a + e.dur, 0);
  // 真实采集窗口：用**所有带 ts 的事件**（含 ph:'b'/'P'/'I' 等无 dur 的事件）取极值，
  // 否则会误判 trace 的实际覆盖范围（实测：只用有时长事件会算短，导致窗口越界而不自知）。
  const stamp = raw.filter((e) => typeof e.ts === 'number' && e.ts > 0);
  const tMin = stamp.reduce((a, e) => Math.min(a, e.ts), Infinity);
  const tMax = stamp.reduce((a, e) => Math.max(a, e.ts + (typeof e.dur === 'number' && e.dur > 0 ? e.dur : 0)), -Infinity);
  const eventNameCounts = {};
  for (const e of raw) eventNameCounts[e.name] = (eventNameCounts[e.name] || 0) + 1;

  /* ---- 3.1 帧/渲染生命周期：主线程帧边界（不同 Chrome 版本事件名不同，按可得性择优）----
     实测（Chromium 131，devtools.timeline + devtools.timeline.frame）：
       AnimationFrame             = 主线程帧开始（每帧一个），首选
       BeginCommitCompositorFrame  = 提交合成器的帧边界，次选
       Commit                      = 提交，再次选
       DrawFrame                   = 旧版本（131 实测为 0 个），保底
     注意：这些是「有内容要渲染的帧」的边界，空闲期不会有事件，因此由间隔推出的 FPS 是
     「活跃期帧率」，不是整段时间的平均刷新率——报告里必须显式标注这一点。 */
  const FRAME_ORDER = ['AnimationFrame', 'Commit', 'BeginCommitCompositorFrame', 'DrawFrame', 'ActivateLayerTree'];
  const frameNameCounts = {};
  for (const e of raw) if (FRAME_ORDER.includes(e.name)) frameNameCounts[e.name] = (frameNameCounts[e.name] || 0) + 1;
  // AnimationFrame 在 Chrome 里是 ph:'b'/'e' 异步对（实测 131：59+59 对，另有 59 个 's'/'f'），
  // 不是 ph:'X'，因此必须单独取 'b' 的 ts 作为帧起点。
  const animStarts = raw.filter((e) => e.name === 'AnimationFrame' && e.ph === 'b');
  const frameEventName = (animStarts.length >= 3 && 'AnimationFrame') || FRAME_ORDER.find((n) => n !== 'AnimationFrame' && (frameNameCounts[n] || 0) >= 3) || null;
  let frameBoundary;
  if (frameEventName === 'AnimationFrame') {
    frameBoundary = animStarts.map((e) => ({ ts: e.ts, dur: 0 }));
  } else {
    frameBoundary = frameEventName ? X.filter((e) => e.name === frameEventName).map((e) => ({ ts: e.ts, dur: e.dur })) : [];
  }
  const frameGaps = [];          // {t, gap, dur}
  const commitTs = X.filter((e) => e.name === 'Commit').map((e) => e.ts);
  frameBoundary.sort((a, b) => a.ts - b.ts);
  for (let i = 1; i < frameBoundary.length; i++) {
    const gap = frameBoundary[i].ts - frameBoundary[i - 1].ts;
    if (gap > 0 && gap < 2000000) frameGaps.push({ t: frameBoundary[i].ts, gap, dur: frameBoundary[i].dur });
  }
  const frameSourceLabel = frameEventName
    ? frameEventName + ' 间隔（主线程活跃帧节拍，共 ' + frameBoundary.length + ' 个帧边界）'
    : '（无帧边界事件，帧分布不可用）';

  /* ---- 3.2 长任务：RunTask + 归因（函数名/URL）----
     实测：Chromium 131 的 RunTask.args.data 里**没有** task 字符串（是空对象），
     因此 fn/url 往往为 null；此时以「CPU profile 函数级 self-time」+「EventDispatch/FunctionCall」
     作为归属来源，而不是伪造函数名。 */
  const runs = X.filter((e) => e.name === 'RunTask' && e.dur >= 1000); // ≥1ms 才纳入候选，最后再筛 ≥50ms
  runs.sort((a, b) => b.dur - a.dur);
  const mainThreadBusyUs = runs.reduce((a, e) => a + e.dur, 0);
  // FunctionCall 是 Chromium 131 里**唯一可靠**的函数级归属来源：
  // args.data 带 {functionName, url, lineNumber, columnNumber, scriptId}，且是 RunTask 的子事件。
  // （RunTask 本身 args 为空、无 task 字符串；ProfileChunk 只有全窗口采样、无法按任务切分。）
  const fnCalls = X.filter((e) => e.name === 'FunctionCall').map((e) => {
    const d = e.args && e.args.data ? e.args.data : {};
    return {
      t: e.ts / 1000, durMs: e.dur / 1000,
      fn: d.functionName || '(anonymous)',
      url: d.url || null, line: d.lineNumber != null ? d.lineNumber + 1 : null,
      scriptId: d.scriptId || null,
    };
  }).sort((a, b) => a.t - b.t);

  /* ---- 3.3 分项聚合（顶层事件，避免 RunTask 与子事件重复计入）---- */
  const stageTotals = { script: 0, recalcStyle: 0, layout: 0, paint: 0 };
  const stageCounts = { script: 0, recalcStyle: 0, layout: 0, paint: 0 };
  const stageItems = { script: [], recalcStyle: [], layout: [], paint: [] };
  const stageNamesSeen = {};
  const recalcByElementCount = [];
  const paintSizes = [];
  for (const e of X) {
    const st = classifyStage(e.name);
    if (!st) continue;
    if (e.name === 'RunTask' || e.name === 'FunctionCall' || e.name === 'EvaluateScript') {
      // 只统计 RunTask 作为脚本耗时口径，避免父子重复累加
      if (e.name !== 'RunTask') continue;
    }
    stageNamesSeen[e.name] = (stageNamesSeen[e.name] || 0) + 1;
    stageTotals[st] += e.dur;
    stageCounts[st] += 1;
    stageItems[st].push(e);
    if (e.name === 'UpdateLayoutTree' || e.name === 'RecalcStyle') {
      const ec = e.args && e.args.data && typeof e.args.data.elementCount === 'number' ? e.args.data.elementCount : null;
      if (ec != null) recalcByElementCount.push({ ts: e.ts, dur: e.dur, elementCount: ec });
    }
    if (e.name === 'Paint' && e.args && e.args.data && typeof e.args.data.clip !== 'undefined') {
      const d = e.args.data;
      paintSizes.push({ ts: e.ts, dur: e.dur, x: d.x, y: d.y, w: d.clip && d.clip[2], h: d.clip && d.clip[3] });
    }
  }
  for (const k of Object.keys(stageItems)) stageItems[k].sort((a, b) => b.dur - a.dur);

  /* ---- 3.4 CPU profile（函数级自耗时）----
     实测（Chromium 131）：ProfileChunk 的 ph 是 'P'（不是 'X'），共 1044 个，其中 389 个带
     args.data.cpuProfile.nodes / .samples；每个 chunk 只带新增节点 + 本段采样 id。
     StackCpuSampling（ph:'n'）只有文本 frames 字符串，没有可机读的 cpuProfile，故不走那条路。
     采样间隔：options=sampling-frequency=10000 ⇒ ≈100µs/样本，因此「采样占比」可当时间占比用。 */
  const nodesById = new Map();
  const selfSamples = new Map(); // nodeId -> count
  let profileChunks = 0, profileSamples = 0;
  for (const e of raw) {
    const isProfCat = e.cat && String(e.cat).includes('cpu_profiler');
    if (!isProfCat && e.name !== 'ProfileChunk' && e.name !== 'Profile') continue;
    const d = e.args && e.args.data;
    if (!d) continue;
    if (e.name === 'ProfileChunk' || e.name === 'Profile') profileChunks++;
    const cp = d.cpuProfile;
    if (cp && Array.isArray(cp.nodes)) for (const n of cp.nodes) if (n && n.id != null) nodesById.set(n.id, n);
    const samps = (cp && Array.isArray(cp.samples)) ? cp.samples : (Array.isArray(d.samples) ? d.samples : null);
    if (samps) { profileSamples += samps.length; for (const id of samps) if (id != null) selfSamples.set(id, (selfSamples.get(id) || 0) + 1); }
  }
  const IDLE_RE = /^\((idle|program|root|garbage collector)\)$/;
  let cpuTop = [];
  let cpuTopCode = [];      // 剔除 (idle)/(program)/(root)/GC 后的真实代码
  let cpuTotalSamples = 0;
  let cpuIdleSamples = 0;
  if (selfSamples.size && nodesById.size) {
    const agg = new Map();
    for (const [id, cnt] of selfSamples) {
      const n = nodesById.get(id);
      if (!n) continue;
      const cf = n.callFrame || {};
      const fname = cf.functionName || '(anonymous)';
      const url = cf.url || null;
      const key = fname + ' @ ' + (url || '(unknown)');
      const cur = agg.get(key) || { key, functionName: fname, url, line: cf.lineNumber, col: cf.columnNumber, count: 0, idle: IDLE_RE.test(fname) };
      cur.count += cnt;
      agg.set(key, cur);
      cpuTotalSamples += cnt;
      if (cur.idle) cpuIdleSamples += cnt;
    }
    const mk = (x) => ({ ...x, sharePct: +((x.count / cpuTotalSamples) * 100).toFixed(2) });
    const all = [...agg.values()].sort((a, b) => b.count - a.count).map(mk);
    cpuTop = all.slice(0, 25);
    const code = all.filter((x) => !x.idle);
    const codeTotal = code.reduce((a, x) => a + x.count, 0);
    cpuTopCode = code.slice(0, 25).map((x) => ({ ...x, sharePctOfCode: codeTotal ? +((x.count / codeTotal) * 100).toFixed(2) : null }));
  }

  /* ---- 3.5 时间基准（trace 的 ts 是任意 epoch，需映射成相对秒）---- */
  const navStart = marks
    .filter((e) => e.name === 'navigationStart' || e.name === 'NavigationStart')
    .reduce((a, e) => Math.min(a, e.ts), Infinity);

  return {
    shape: 'devtools-trace',
    unit: 'us',
    traceRange: { tMin, tMax, spanMs: (tMax - tMin) / 1000 },
    eventCount: raw.length,
    timedEventCount: X.length,
    sumOfTimedMs: total / 1000,
    // t 必须换算成毫秒（原为 trace 微秒），与 runs[].t / 锚点口径一致 —— 见 analyzeWindow 的单位铁律
    frameGaps: frameGaps.map((g) => ({ t: g.t / 1000, gap: g.gap / 1000, dur: g.dur / 1000 })),
    frameSourceLabel,
    frameEventName,
    frameNameCounts,
    frameBoundaryCount: frameBoundary.length,
    eventNameCounts,
    mainThreadBusyMs: mainThreadBusyUs / 1000,
    fnCallCount: fnCalls.length,
    fnCalls,
    commitTs,
    runs: runs.map((e) => {
      const data = (e.args && e.args.data) || {};
      const t0 = e.ts / 1000, t1 = (e.ts + e.dur) / 1000;
      // 归属：落在该 RunTask 时间区间内的 FunctionCall，按函数聚合
      const byFn = new Map();
      for (const c of fnCalls) {
        if (c.t < t0 || c.t > t1) continue;
        const k = c.fn + ' @ ' + (c.url || '(unknown)');
        const cur = byFn.get(k) || { functionName: c.fn, url: c.url, line: c.line, totalMs: 0, calls: 0 };
        cur.totalMs += c.durMs; cur.calls += 1; byFn.set(k, cur);
      }
      const attribution = [...byFn.values()].sort((a, b) => b.totalMs - a.totalMs).slice(0, 3)
        .map((x) => ({ ...x, totalMs: +x.totalMs.toFixed(1) }));
      // 实测：Chromium 131 的 RunTask.args.data 里既没有 task 字符串也没有 url（空对象）；
      // 但部分版本/导出会带 data.task。两者都支持，取不到就老实返回 null，不伪造函数名。
      const taskStr = data.task || (e.args && e.args.task) || null;
      const info = parseTaskString(taskStr);
      return {
        t: e.ts, durMs: e.dur / 1000,
        task: taskStr, fn: info.fn, url: info.url || data.url || null,
        line: info.line, col: info.col,
        frame: data.frame || null,
        source: 'RunTask',
        attribution,
        // 无 task 字符串时，用归属到的最大函数当作展示名
        displayFn: info.fn || (attribution[0] ? attribution[0].functionName : null),
        displayUrl: info.url || data.url || (attribution[0] ? attribution[0].url : null),
      };
    }),
    stageTotals: Object.fromEntries(Object.entries(stageTotals).map(([k, v]) => [k, v / 1000])),
    stageCounts,
    stageNamesSeen,
    stageTop: Object.fromEntries(Object.entries(stageItems).map(([k, v]) => [k, v.slice(0, 10).map((e) => ({
      t: e.ts, durMs: e.dur / 1000, name: e.name,
      url: (e.args && e.args.data && e.args.data.url) || null,
    }))])),
    recalcByElementCount,
    paintCount: stageCounts.paint,
    cpuTop, cpuTopCode, cpuTotalSamples, cpuIdleSamples, profileSamples, profileChunks,
    navStartTs: Number.isFinite(navStart) ? navStart : null,
    marks: marks.slice(0, 2000).map((e) => ({ name: e.name, ts: e.ts, cat: e.cat, ph: e.ph })),
    warnings: [],
  };
}

/* ══════════════════════════════════════════════════════════════════
   4. 方案 C（user-capture/v1）解析 —— 统一映射到同一中间形态
   ══════════════════════════════════════════════════════════════════ */
function parseUserCapture(doc) {
  const frames = Array.isArray(doc.frames) ? doc.frames : [];
  const longTasks = Array.isArray(doc.longTasks) ? doc.longTasks : [];
  const loaf = Array.isArray(doc.loaf) ? doc.loaf : [];
  const events = Array.isArray(doc.events) ? doc.events : [];

  // user-capture 里 frames[].t 已经是「相对会话起点毫秒」，直接可用
  const frameGaps = frames
    .filter((f) => f && typeof f.gap === 'number' && f.gap > 0 && f.gap < 100000)
    .map((f) => ({ t: f.t, gap: f.gap, dur: f.gap }));
  const tMax = Math.max(
    doc.durationMs || 0,
    ...frames.map((f) => f.t || 0), ...longTasks.map((t) => (t.startTime || 0) + (t.duration || 0)),
    ...loaf.map((t) => (t.startTime || 0) + (t.duration || 0)), 0
  );

  // 长任务合并 longtask + LoAF（LoAF 更有信息量：含脚本归属）
  const runs = [];
  for (const t of longTasks) {
    runs.push({
      t: t.startTime || 0, durMs: t.duration || 0, task: t.name || 'longtask',
      fn: (t.attribution && t.attribution[0] && t.attribution[0].name) || t.name || 'longtask',
      url: (t.attribution && t.attribution[0] && (t.attribution[0].containerSrc || null)) || null,
      line: null, col: null, frame: null, source: 'longtask',
      attribution: t.attribution || [],
    });
  }
  for (const f of loaf) {
    const scripts = (f.scripts || []).slice().sort((a, b) => (b.duration || 0) - (a.duration || 0));
    const s0 = scripts[0];
    runs.push({
      t: f.startTime || 0, durMs: f.duration || 0, task: 'LoAF',
      fn: s0 ? (s0.sourceFunctionName || s0.name || s0.invoker || '(anonymous)') : '(no script attribution)',
      url: s0 ? (s0.sourceURL || null) : null,
      line: s0 ? (s0.sourceCharPosition ?? null) : null, col: null, frame: null, source: 'loaf',
      blockingDuration: f.blockingDuration || 0,
      styleAndLayoutStart: f.styleAndLayoutStart || null,
      renderStart: f.renderStart || null,
      scripts: scripts.slice(0, 5),
      forcedStyleAndLayoutMs: scripts.reduce((a, s) => a + (s.forcedStyleAndLayoutDuration || 0), 0),
    });
  }
  runs.sort((a, b) => b.durMs - a.durMs);

  // 分项：方案 C 无法直接给出 Script/Recalc/Layout/Paint 的毫秒分项（这是页面侧 API 的固有限制）
  const forced = loaf.reduce((a, f) => a + (f.scripts || []).reduce((x, s) => x + (s.forcedStyleAndLayoutDuration || 0), 0), 0);
  const loafBlock = loaf.reduce((a, f) => a + (f.blockingDuration || 0), 0);

  const evDur = events.reduce((a, e) => a + (e.duration || 0), 0);

  return {
    shape: 'user-capture',
    unit: 'ms',
    traceRange: { tMin: 0, tMax, spanMs: tMax },
    eventCount: frames.length + longTasks.length + loaf.length + events.length,
    timedEventCount: runs.length,
    sumOfTimedMs: runs.reduce((a, r) => a + r.durMs, 0),
    frameGaps,
    commitTs: [],
    runs,
    // 分项：以 LoAF 的 forcedStyleAndLayout 作为「样式+布局」的下限证据
    stageTotals: { script: null, recalcStyle: null, layout: null, paint: null, _forcedStyleAndLayoutMin: forced, _loafBlocking: loafBlock },
    stageCounts: { script: null, recalcStyle: null, layout: null, paint: null, events: events.length },
    stageNamesSeen: {},
    stageTop: { script: [], recalcStyle: [], layout: [], paint: [] },
    recalcByElementCount: [],
    paintCount: null,
    cpuTop: [], cpuTotalSamples: 0, profileChunks: 0,
    navStartTs: null,
    marks: (doc.marks || []).map((m) => ({ name: m.name, ts: m.t, cat: 'user-capture.mark', ph: 'R' })),
    interactions: doc.interactions || [],
    warnings: (doc.warnings || []).concat(
      doc.source === 'iframe'
        ? ['来源为 iframe 模式：跨源隔离下被测页面内部的长任务/LoAF 不会上报宿主页，因此长任务明细大概率为空——这是预期结果，不是采集失败。']
        : []
    ),
    rawDoc: doc,
  };
}

/* ══════════════════════════════════════════════════════════════════
   5. 锚点（点击「设置」）推断
   ══════════════════════════════════════════════════════════════════ */
function resolveAnchor(parsed, opts, rawDoc, optsWindowHint) {
  const cands = [];
  optsWindowHint = optsWindowHint || DEFAULT_WINDOW_MS;
  if (opts.anchor != null) {
    return { t: opts.anchor, how: 'cli:--anchor', confidence: 'user-supplied', candidates: [] };
  }
  if (parsed.shape === 'user-capture') {
    if (rawDoc.anchor && typeof rawDoc.anchor.t === 'number') cands.push({ t: rawDoc.anchor.t, how: 'user-capture.anchor (' + (rawDoc.anchor.how || 'n/a') + ')', confidence: rawDoc.anchor.how && rawDoc.anchor.how.indexOf('settings') >= 0 ? 'high' : 'medium' });
    if (Array.isArray(rawDoc.settingsHits) && rawDoc.settingsHits.length) cands.push({ t: rawDoc.settingsHits[0].t, how: '首个 isSettings 交互', confidence: 'high' });
    if (Array.isArray(rawDoc.interactions)) {
      const c = rawDoc.interactions.filter((i) => i.type === 'click')[0];
      if (c) cands.push({ t: c.t, how: '首个 click 交互', confidence: 'medium' });
    }
  } else {
    // DevTools：优先 performance.mark 出来的自定义锚点；其次第一个 RunTask 里的 click 处理函数
    // 注意：performance.mark 事件的 phase 字母**不稳定**（实测同一条 mark 一次是 'I'、一次是 'R'），
    // 因此这里只按 name 匹配，绝不按 ph 过滤。
    const marksByName = (re) => parsed.marks.filter((m) => re.test(m.name)).sort((a, b) => a.ts - b.ts);
    const starts = marksByName(/USER_CLICK_SETTINGS_START/i);
    const ends = marksByName(/USER_CLICK_SETTINGS_END/i);
    const anyCap = marksByName(/dsh-capture-interaction/i);
    const markStart = starts[0];
    const markEnd = ends[0];
    if (markStart && markEnd && markEnd.ts > markStart.ts) {
      // 选锚点的原则：优先保证「锚点之后仍有 ≥ 一个窗口长的时间」可分析，
      // 否则尾部证据会被 trace 结束截断（实测中点锚点会把 +3s 窗口推到 trace 之外）。
      const span = markEnd.ts - markStart.ts;
      const tailAfterEnd = parsed.traceRange.tMax - markEnd.ts;
      const enough = tailAfterEnd >= 2 * optsWindowHint;
      const mid = (markStart.ts + markEnd.ts) / 2;
      const useMid = enough || (parsed.traceRange.tMax - mid) >= 1.5 * optsWindowHint;
      cands.push({
        t: useMid ? mid : markStart.ts,
        how: useMid
          ? 'performance.mark START/END 窗口中点（窗口 ' + (span / 1000).toFixed(0) + ' ms；其后再无足够帧数据，已避开截断）'
          : 'performance.mark(' + markStart.name + ') —— 点击前那一刻（END 之后 trace 仅剩 ' + (tailAfterEnd / 1000).toFixed(1) + ' s，取中点会把 +窗口 推到 trace 之外，故退化为 START）',
        confidence: 'high',
        window: { start: markStart.ts, end: markEnd.ts },
      });
    }
    if (markStart) cands.push({ t: markStart.ts, how: 'performance.mark(' + markStart.name + ')（点击前那一刻）', confidence: 'high' });
    if (anyCap.length) cands.push({ t: anyCap[0].ts, how: 'performance.mark(' + anyCap[0].name + ')', confidence: 'high' });
    // 兜底：名字里带 onClick/click handler 的 RunTask；再兜底：整段 trace 的中点
    const clickRun = parsed.runs
      .filter((r) => r.t >= (parsed.navStartTs || parsed.traceRange.tMin))
      .filter((r) => /click|onClick|handleClick|pointer/i.test((r.fn || '') + ' ' + (r.task || '')))
      .sort((a, b) => a.t - b.t)[0];
    if (clickRun) cands.push({ t: clickRun.t, how: '首个名称含 click 的任务（' + short(clickRun.fn || clickRun.task, 40) + '）', confidence: 'medium' });
    if (!cands.length) {
      const mid = (parsed.traceRange.tMin + parsed.traceRange.tMax) / 2;
      cands.push({ t: mid, how: '整段 trace 中点（未找到任何交互锚点，请用 --anchor 指定）', confidence: 'low' });
    }
  }
  if (!cands.length) cands.push({ t: (parsed.traceRange.tMin + parsed.traceRange.tMax) / 2, how: 'fallback: trace 中点', confidence: 'low' });

  // ── 按「证据量」择优 ──────────────────────────────────────────────
  // 单纯取第一个候选会踩坑：START/END 中点常常把 +window 推到采集范围之外，
  // 于是"点击后"一栏全是 0。这里对每个候选真正数一遍窗口内的数据量再决定。
  const tMin = parsed.traceRange.tMin, tMax = parsed.traceRange.tMax;
  for (const c of cands) {
    const from = c.t - optsWindowHint, to = c.t + optsWindowHint;
    const mk0 = parsed.unit === 'us' ? (t) => t / 1000 : (t) => t;
    const tminMs = parsed.unit === 'us' ? tMin / 1000 : tMin;
    const tmaxMs = parsed.unit === 'us' ? tMax / 1000 : tMax;
    const ancMs = (parsed.unit === 'us' ? c.t / 1000 : c.t);
    c.coverageBeforeMs = +(ancMs - tminMs).toFixed(0);
    c.coverageAfterMs = +(tmaxMs - ancMs).toFixed(0);
    c.windowFullyCovered = (ancMs - optsWindowHint) >= tminMs && (ancMs + optsWindowHint) <= tmaxMs;
    // parsed.runs[].t / frameGaps[].t 是毫秒，锚点是微秒 ⇒ 先统一到毫秒（同 analyzeWindow 的铁律）
    const mk = parsed.unit === 'us' ? (t) => t / 1000 : (t) => t;
    const f2 = mk(c.t) - optsWindowHint, t2 = mk(c.t) + optsWindowHint;
    c.runsInWindow = parsed.runs.filter((r) => r.t >= f2 && r.t <= t2).length;
    c.framesInWindow = parsed.frameGaps.filter((g) => g.t >= f2 && g.t <= t2).length;
    c.evidence = c.framesInWindow * 3 + c.runsInWindow;   // 帧样本更稀缺，权重给高
  }
  const covered = cands.filter((c) => c.windowFullyCovered);
  const pool = covered.length ? covered : cands;
  // 覆盖度达标者中取证据最多；并列时取置信度更高、更早的候选
  const rank = { high: 0, medium: 1, low: 2, 'user-supplied': -1 };
  const best = pool.slice().sort((a, b) => {
    if (b.evidence !== a.evidence) return b.evidence - a.evidence;
    const r = (rank[a.confidence] ?? 3) - (rank[b.confidence] ?? 3);
    if (r !== 0) return r;
    return a.t - b.t;
  })[0];
  best.selection = covered.length
    ? '在覆盖度达标的候选中选了证据量最大的（窗口内 ' + best.runsInWindow + ' 个 RunTask / ' + best.framesInWindow + ' 个帧样本）'
    : '⚠ 没有任何候选能让 ±' + optsWindowHint + 'ms 窗口完全落在采集范围内，退化为证据量最大者';
  return { ...best, candidates: cands };
}

/* ══════════════════════════════════════════════════════════════════
   6. 窗口分析
   ══════════════════════════════════════════════════════════════════ */
function analyzeWindow(parsed, anchor, windowMs) {
  // ⚠ 单位铁律：中间形态里 frameGaps[].t / runs[].t 一律是**毫秒**；
  // 而锚点在 devtools 形态下是 trace 的**微秒**时间戳。必须在入口统一成毫秒，
  // 否则窗口与数据差 1000 倍、所有窗口统计恒为 0（这个 bug 实测踩过）。
  if (parsed.unit === 'us') anchor = anchor / 1000;
  parsed = { ...parsed, traceRange: parsed.unit === 'us'
    ? { tMin: parsed.traceRange.tMin / 1000, tMax: parsed.traceRange.tMax / 1000, spanMs: parsed.traceRange.spanMs }
    : parsed.traceRange };
  parsed.runs = parsed.runs.map((r) => parsed.unit === 'us' ? { ...r, t: r.t / 1000 } : r);
  const from = anchor - windowMs, to = anchor + windowMs;
  const inW = (t) => t >= from && t <= to;

  const allGaps = parsed.frameGaps.slice().sort((a, b) => a.t - b.t);
  const selGaps = allGaps.filter((g) => inW(g.t));
  const gaps = selGaps.map((g) => g.gap).sort((a, b) => a - b);
  const sum = gaps.reduce((a, b) => a + b, 0);

  const before = allGaps.filter((g) => g.t < anchor).slice(-Math.round(windowMs / 16.7));
  const after = allGaps.filter((g) => g.t > anchor).slice(0, Math.round(windowMs / 16.7));
  const stat = (arr) => {
    const s = arr.map((g) => g.gap).sort((a, b) => a - b);
    if (!s.length) return { n: 0, fps: null, p50: null, p95: null, p99: null, max: null, janky: 0 };
    const t = s.reduce((a, b) => a + b, 0);
    return {
      n: s.length,
      fps: +(1000 / (t / s.length)).toFixed(1),
      p50: +quantile(s, 0.5).toFixed(1), p95: +quantile(s, 0.95).toFixed(1),
      p99: +quantile(s, 0.99).toFixed(1), max: +s[s.length - 1].toFixed(1),
      janky: s.filter((x) => x > 50).length,
    };
  };

  const buckets = FRAME_BUCKETS.map((b) => {
    const n = gaps.filter((g) => g > b.lo && g <= b.hi).length;
    return { label: b.label, count: n, sharePct: gaps.length ? +((n / gaps.length) * 100).toFixed(1) : 0 };
  });

  // 最长任务 top10（窗口内）
  const tasksInWin = parsed.runs.filter((r) => inW(r.t));

  // 窗口内函数级占用汇总（来自 FunctionCall，devtools 形态才有）
  let fnSummary = [];
  if (parsed.fnCalls && parsed.fnCalls.length) {
    const agg = new Map();
    for (const c of parsed.fnCalls) {
      if (!inW(c.t)) continue;
      const k = c.fn + ' @ ' + (c.url || '(unknown)');
      const cur = agg.get(k) || { functionName: c.fn, url: c.url, line: c.line, totalMs: 0, calls: 0 };
      cur.totalMs += c.durMs; cur.calls += 1; agg.set(k, cur);
    }
    fnSummary = [...agg.values()].sort((a, b) => b.totalMs - a.totalMs)
      .map((x) => ({ ...x, totalMs: +x.totalMs.toFixed(1) }));
  }
  const top10 = tasksInWin.slice().sort((a, b) => b.durMs - a.durMs).slice(0, 10);

  // 分项（窗口内）
  const stage = {};
  if (parsed.shape === 'devtools-trace') {
    // 重新按窗口扫描分项事件：stageTop 只有 top10，需要完整重算 ⇒ 由调用方传入 full 事件
    stage.windowTotals = parsed._stageWindow ? parsed._stageWindow(from, to) : null;
  }

  const blockingTotal = tasksInWin.reduce((a, r) => a + Math.max(0, r.durMs - 50), 0);
  // 数据稀疏检测：区分「窗口内真的没有任务」与「窗口根本没覆盖到采集到的数据」。
  // 实测踩过：锚点位于 trace 尾部时，窗口被推到采集范围之外，输出 "占比 0.0%"，
  // 读起来像"完全不卡"，其实是"没有数据"——必须显式区分，否则会误导用户。
  const thinness = [];
  if (selGaps.length < 3) thinness.push('帧间隔样本仅 ' + selGaps.length + ' 个（<3）');
  if (tasksInWin.length === 0) thinness.push('窗口内没有任何 RunTask/长任务记录');
  const dataThin = selGaps.length < 3 && tasksInWin.length === 0;
  // 主线程占用率：窗口内所有 RunTask 时长之和 / 窗口跨度。这是不依赖帧边界事件的最硬指标。
  const busyMs = tasksInWin.reduce((a, r) => a + r.durMs, 0);
  const occupancyPctOfSpan = to > from ? +((busyMs / (to - from)) * 100).toFixed(1) : null;
  // 活跃期口径：窗口内第一个帧到最后一个帧之间
  const frameSpan = selGaps.length >= 2 ? (selGaps[selGaps.length - 1].t - selGaps[0].t) : 0;
  // 「按活跃期算」只在帧样本足够多时才有意义：样本只有 3~4 个时活跃期跨度可能只有几十毫秒，
  // 而 RunTask 占用的是整个窗口，会算出 >100% 这种物理上不可能的数（实测出现过 167.6%）。
  // 处理方式：分母至少取窗口的 1/4；仍超 100% 则封顶并标注，不输出不可能的数。
  let occupancyPctOfActive = null;
  if (frameSpan > 0 && selGaps.length >= 10) {
    const denom = Math.max(frameSpan, (to - from) / 4);
    const raw = (busyMs / denom) * 100;
    occupancyPctOfActive = +Math.min(100, raw).toFixed(1);
    if (raw > 100) occupancyPctOfActive = 100;
  }

  return {
    window: { from, to, spanMs: windowMs * 2, anchor, unit: 'ms' },
    frames: {
      n: gaps.length,
      fps: gaps.length ? +(1000 / (sum / gaps.length)).toFixed(1) : null,
      p50: gaps.length ? +quantile(gaps, 0.5).toFixed(1) : null,
      p95: gaps.length ? +quantile(gaps, 0.95).toFixed(1) : null,
      p99: gaps.length ? +quantile(gaps, 0.99).toFixed(1) : null,
      max: gaps.length ? +gaps[gaps.length - 1].toFixed(1) : null,
      jankyOver50: gaps.filter((g) => g > 50).length,
      buckets,
      source: parsed.shape === 'devtools-trace'
        ? (parsed.frameSourceLabel || '无帧边界事件')
        : 'rAF 间隔（页面主线程帧节拍，方案 C 探针直接采样）',
      frameSpanMs: +frameSpan.toFixed(1),
    },
    mainThreadBusyMs: +busyMs.toFixed(1),
    occupancyPctOfSpan: (selGaps.length < 3 && tasksInWin.length === 0) ? null : occupancyPctOfSpan,
    occupancyPctOfSpanRaw: occupancyPctOfSpan,
    occupancyPctOfActive,
    dataThin,
    thinness,
    before: stat(before),
    after: stat(after),
    top10: top10.map((r) => ({
      startMs: +r.t.toFixed(1),
      attribution: r.attribution || [],
      relToAnchorMs: +(r.t - anchor).toFixed(1),
      durMs: +r.durMs.toFixed(1),
      blockingMs: r.blockingDuration != null ? +r.blockingDuration.toFixed(1) : +Math.max(0, r.durMs - 50).toFixed(1),
      functionName: r.fn || null,
      url: r.url || null,
      line: r.line ?? null,
      task: r.task || null,
      source: r.source,
      forcedStyleAndLayoutMs: r.forcedStyleAndLayoutMs != null ? +r.forcedStyleAndLayoutMs.toFixed(1) : null,
      scripts: r.scripts || undefined,
    })),
    taskCount: tasksInWin.length,
    fnSummary,
    blockingTotalMs: +blockingTotal.toFixed(1),
    stage: stage.windowTotals || null,
  };
}

/* ══════════════════════════════════════════════════════════════════
   7. 已知修复项命中判定
   ══════════════════════════════════════════════════════════════════ */
function judgeKnownFixes(revs, parsed, win, rawDoc) {
  const revOf = (mod) => {
    if (!revs) return null;
    // 支持 {ui-layout:"sha"} / {uiLayout:"sha"} / {"dsh-client-ui-layout":"sha"}
    const keys = [mod, mod.replace(/-([a-z])/g, (m, c) => c.toUpperCase()), 'dsh-client-' + mod, 'dsh-' + mod];
    for (const k of keys) if (revs[k]) return String(revs[k]).slice(0, 12);
    return null;
  };

  return KNOWN_FIXES.map((fx) => {
    const delivered = revOf(fx.key) || (rawDoc && rawDoc.targetRev ? (rawDoc.targetRev.all && (rawDoc.targetRev.all[fx.module] || rawDoc.targetRev.all[fx.key])) || null : null);
    const match = delivered ? fx.anchors.includes(delivered) : null;
    const item = {
      key: fx.key,
      label: fx.label,
      module: fx.module,
      expectedRev: fx.anchors[0],
      deliveredRev: delivered,
      revMatch: match,                     // true=已修复构建 / false=旧构建 / null=未知
      status: match === true ? 'PRESENT' : match === false ? 'ABSENT-OR-OLDER' : 'UNKNOWN(no rev evidence)',
      evidenceKind: fx.evidence_kind,
      note: fx.note || null,
    };

    // 行为侧的间接证据（与 rev 相互独立，用来解释「为什么卡」/「卡在哪」）
    const ev = [];
    const t = win.top10 || [];
    if (fx.key === 'ui-layout') {
      const recalcish = t.filter((x) => /style|layout|recalc|theme/i.test((x.functionName || '') + ' ' + (x.url || '') + ' ' + (x.task || '')));
      const forced = t.reduce((a, x) => a + (x.forcedStyleAndLayoutMs || 0), 0);
      if (recalcish.length) ev.push({ kind: 'behavior', text: '窗口内 top10 有 ' + recalcish.length + ' 项与样式/布局/主题相关', items: recalcish.slice(0, 3) });
      if (forced > 0) ev.push({ kind: 'behavior', text: 'LoAF 统计到的 forcedStyleAndLayout 合计 ' + fmt(forced) + ' ms（强制同步布局的直接证据）' });
      if (win.frames && win.frames.p99 != null) ev.push({ kind: 'metric', text: '窗口 p99 帧间隔 ' + fmt(win.frames.p99) + ' ms、>50ms 掉帧 ' + win.frames.jankyOver50 + ' 次' });
      if (parsed.shape === 'devtools-trace' && parsed.stageTotals && parsed.stageTotals.recalcStyle != null) {
        const st = parsed.stageTotals;
        ev.push({ kind: 'metric', text: '全 trace 分项：Script ' + fmt(st.script, 0) + ' ms / RecalcStyle ' + fmt(st.recalcStyle, 0) + ' ms / Layout ' + fmt(st.layout, 0) + ' ms / Paint ' + fmt(st.paint, 0) + ' ms' });
        if (st.recalcStyle > st.script * 0.5) ev.push({ kind: 'judgement', text: 'RecalcStyle 占 Script 之比 >50%，与「强制重算」靶点一致' });
      }
    }
    if (fx.key === 'runtime') {
      const rtish = t.filter((x) => /dsh-client-runtime|p2ac|session|event|store|reducer|dispatch/i.test((x.url || '') + ' ' + (x.functionName || '')));
      if (rtish.length) ev.push({ kind: 'behavior', text: '窗口内 top10 有 ' + rtish.length + ' 项指向 runtime/session 事件流', items: rtish.slice(0, 3) });
      else ev.push({ kind: 'behavior', text: '窗口内 top10 未见 runtime/session 事件流的直接命中（不能据此排除）' });
    }
    if (fx.key === 'usage') {
      // 页面侧可见信号：RPC/网络等待造成的长任务（无 JS 自耗时）
      const rpcish = t.filter((x) => /rpc|fetch|xhr|usage|sessions/i.test((x.functionName || '') + ' ' + (x.url || '') + ' ' + (x.task || '')));
      if (rpcish.length) ev.push({ kind: 'behavior', text: '窗口内 top10 有 ' + rpcish.length + ' 项与 RPC/usage 相关', items: rpcish.slice(0, 3) });
      ev.push({ kind: 'limit', text: 'usage 修复在宿主（冷面）：页面 trace 无法直接证明宿主事件循环阻塞，需与宿主侧 G1 延迟数据联合判读' });
    }
    item.behaviorEvidence = ev;
    return item;
  });
}

/* ══════════════════════════════════════════════════════════════════
   8. 报告渲染
   ══════════════════════════════════════════════════════════════════ */
function renderReport(result) {
  const L = [];
  const { meta, anchor, window: win, fixes } = result;

  L.push('════════════════════════════════════════════════════════════════');
  L.push(' DSH 点击设置卡顿 · trace 解析报告');
  L.push('════════════════════════════════════════════════════════════════');
  L.push('输入文件     : ' + meta.inputPath);
  L.push('输入形态     : ' + meta.shape + '（时间单位 ' + meta.unit + '）');
  L.push('文件大小     : ' + (meta.fileBytes / 1024).toFixed(0) + ' KB' + (meta.wasGzip ? '（gzip 已解压）' : ''));
  L.push('事件总数     : ' + meta.eventCount + '（其中有时长的事件 ' + meta.timedEventCount + '）');
  L.push('trace 跨度   : ' + fmt(meta.spanMs / 1000, 2) + ' s');
  L.push('采集来源     : ' + (meta.origin || 'devtools-performance-panel'));
  if (meta.environment) {
    const e = meta.environment;
    L.push('运行环境     : ' + [e.userAgent, e.hardwareConcurrency ? e.hardwareConcurrency + ' 核' : null, e.devicePixelRatio ? 'DPR ' + e.devicePixelRatio : null].filter(Boolean).join(' · '));
  }
  L.push('');
  L.push('── 锚点（点击「设置」）──────────────────────────────────────────');
  L.push('锚点时间     : ' + fmt(anchor.t, 1) + (result.shape === 'devtools-trace' ? ' µs（trace 时钟）' : ' ms（会话内）'));
  L.push('判定依据     : ' + anchor.how);
  L.push('置信度       : ' + anchor.confidence);
  if (anchor.candidates && anchor.candidates.length > 1) {
    L.push('候选锚点     :');
    for (const c of anchor.candidates) {
      L.push('               · ' + fmt(c.t, 1) + '  [' + c.confidence + '] ' + c.how);
      if (c.evidence != null) L.push('                 └ 覆盖 ' + (c.windowFullyCovered ? 'OK' : '不足') +
        '（前 ' + c.coverageBeforeMs + ' ms / 后 ' + c.coverageAfterMs + ' ms）· 窗口内 ' + c.runsInWindow + ' 任务 / ' + c.framesInWindow + ' 帧样本');
    }
    if (anchor.selection) L.push('选择理由     : ' + anchor.selection);
  }
  L.push('');
  L.push('── 点击前后 ' + fmt(win.window.spanMs / 1000, 1) + ' 秒 · 帧分布 ────────────────────────────');
  L.push('口径         : ' + win.frames.source);
  L.push('帧数         : ' + win.frames.n + (win.frames.n === 0 ? '  ⚠ 窗口内无帧边界事件（下方分布表全 0 表示"无数据"而非"无掉帧"）' : ''));
  L.push('平均 FPS     : ' + fmt(win.frames.fps) + (win.frames.n ? '   ← 活跃期帧率（空闲期不产生帧事件，不等于屏幕刷新率）' : ''));
  L.push('帧间隔 p50 / p95 / p99 / max : ' + fmt(win.frames.p50) + ' / ' + fmt(win.frames.p95) + ' / ' + fmt(win.frames.p99) + ' / ' + fmt(win.frames.max) + ' ms');
  L.push('掉帧(>50ms)  : ' + win.frames.jankyOver50 + ' 次' + (win.frames.frameSpanMs ? '（活跃期跨度 ' + fmt(win.frames.frameSpanMs, 0) + ' ms）' : ''));
  if (win.frames.n > 0 && win.frames.n < 10) {
    L.push('  提示         : 帧边界样本只有 ' + win.frames.n + ' 个（无头/空闲页极少产生帧事件），');
    L.push('                 上面这张分布表只能当参考；判卡请以「主线程占用」和「最长任务」为准。');
  }
  if (win.dataThin) {
    L.push('主线程占用   : ⚠ 不可判读 —— ' + (win.thinness || []).join('；'));
    L.push('               这个窗口内几乎没有采集到的数据（不是"不卡"，而是"没有证据"）。');
    L.push('               最可能原因：锚点太靠近 trace 末尾，或录制在点击后过早停止。');
    L.push('               ⇒ 请按 Runbook 重录：点击「设置」后再等 5 秒以上才停止录制。');
  } else {
    L.push('主线程占用   : ' + fmt(win.mainThreadBusyMs, 0) + ' ms / 窗口 ' + fmt(win.window.spanMs, 0) + ' ms = ' + pct(win.occupancyPctOfSpan) +
      (win.occupancyPctOfActive != null ? '  （按活跃期算 ' + pct(win.occupancyPctOfActive) + '，分母=活跃期跨度，样本≥10 才给）' : ''));
  }
  L.push('               ← 占用率越高越卡；>50% 必然可感知，>80% 严重。这是不依赖帧事件的最硬指标。');
  L.push('  窗口内 RunTask 数 : ' + win.taskCount + '（帧边界事件只有 ' + win.frames.n + ' 个 ⇒ 占用率比帧率更可靠）');
  L.push('  ' + '区间'.padEnd(22) + '次数'.padStart(6) + '  占比');
  for (const b of win.frames.buckets) {
    const bar = '█'.repeat(Math.max(0, Math.round(b.sharePct / 3)));
    L.push('  ' + b.label.padEnd(22) + String(b.count).padStart(6) + '  ' + pct(b.sharePct).padStart(6) + ' ' + bar);
  }
  L.push('');
  L.push('  对比：锚点前 ' + win.before.n + ' 帧 FPS ' + fmt(win.before.fps) + ' / p99 ' + fmt(win.before.p99) +
    ' / 掉帧 ' + win.before.janky + '   ‖   锚点后 ' + win.after.n + ' 帧 FPS ' + fmt(win.after.fps) +
    ' / p99 ' + fmt(win.after.p99) + ' / 掉帧 ' + win.after.janky);
  L.push('');
  L.push('── 最长任务 top 10（窗口内）────────────────────────────────────');
  if (!win.top10.length) {
    L.push('（窗口内没有任何 ≥1ms 的任务记录）');
  } else {
    L.push('  #  相对锚点     耗时      阻塞     来源      函数 / URL');
    win.top10.forEach((t, i) => {
      const rel = (t.relToAnchorMs >= 0 ? '+' : '') + t.relToAnchorMs.toFixed(0);
      const shown = t.functionName || (t.attribution && t.attribution[0] ? t.attribution[0].functionName : null) || '(无函数归属)';
      L.push('  ' + String(i + 1).padStart(2) + '  ' + (rel + ' ms').padStart(11) + '  ' + (fmt(t.durMs) + ' ms').padStart(9) +
        '  ' + (fmt(t.blockingMs) + ' ms').padStart(8) + '  ' + String(t.source).padEnd(9) + ' ' + short(shown, 54));
      const u = t.url || (t.attribution && t.attribution[0] ? t.attribution[0].url : null);
      if (u) L.push('      ' + ' '.repeat(11) + '  ' + short(u, 118) + (t.line != null ? ':' + t.line : ''));
      if (t.attribution && t.attribution.length > 1) {
        L.push('      ' + ' '.repeat(11) + '  ⤷ 该任务内函数占用：' + t.attribution.map((a) => fmt(a.totalMs) + 'ms ' + short(a.functionName, 34)).join(' · '));
      }
      if (t.forcedStyleAndLayoutMs) L.push('      ' + ' '.repeat(11) + '  ⤷ forcedStyleAndLayout ' + fmt(t.forcedStyleAndLayoutMs) + ' ms');
      if (t.scripts && t.scripts.length) {
        for (const s of t.scripts.slice(0, 3)) L.push('      ' + ' '.repeat(11) + '  ⤷ 脚本 ' + fmt(s.duration) + ' ms ' + short((s.sourceFunctionName || s.name || '?') + ' ' + (s.sourceURL || ''), 100));
      }
    });
    L.push('  窗口内任务数 ' + win.taskCount + ' · 总阻塞（Σ(dur−50ms)）' + fmt(win.blockingTotalMs) + ' ms');
  }
  if (win.fnSummary && win.fnSummary.length) {
    L.push('');
    L.push('── 窗口内函数级占用（FunctionCall 口径 top 12）────────────────');
    L.push('  #  累计耗时    调用次数  函数 @ URL');
    win.fnSummary.slice(0, 12).forEach((f, i) => {
      L.push('  ' + String(i + 1).padStart(2) + '  ' + (fmt(f.totalMs) + ' ms').padStart(9) + '  ' + String(f.calls).padStart(7) + '   ' + short(f.functionName, 46));
      L.push('      ' + ' '.repeat(9) + '  ' + ' '.repeat(7) + '   ' + short(f.url || '(unknown)', 110));
    });
  }
  if (result.shape === 'devtools-trace' && result.empirical) {
    L.push('');
    L.push('── 实证口径（本 trace 里该事件名到底有多少个）──────────────────');
    const emp = result.empirical;
    const show = (k, v, note) => L.push('  ' + k.padEnd(30) + String(v == null ? '—' : v).padStart(8) + '   ' + (note || ''));
    show('RunTask', emp.RunTask, '主线程任务（长任务口径的来源）');
    show('FunctionCall', emp.FunctionCall, '带 URL 的函数调用，用于归属到模块');
    show('UpdateLayoutTree', emp.UpdateLayoutTree, '= Performance 面板的 Recalc Style');
    show('Layout', emp.Layout, '布局');
    show('Paint', emp.Paint, '绘制');
    show('ProfileChunk', emp.ProfileChunk, 'CPU profile 分片（函数级归因的前提）');
    show('StackCpuSampling', emp.StackCpuSampling, '调用栈采样（函数级归因的数据源）');
    show('AnimationFrame', emp.AnimationFrame, '帧边界（帧分布口径）');
    show('Commit', emp.Commit, '提交合成器');
    show('EventDispatch', emp.EventDispatch, '事件派发（点击处理）');
    show('FrameCommittedInBrowser', emp.FrameCommittedInBrowser, '');
    const missing = ['UpdateLayoutTree', 'Layout', 'Paint', 'ProfileChunk'].filter((k) => !emp[k]);
    if (missing.length) L.push('  ⚠ 缺失：' + missing.join(' / ') + ' ⇒ 对应分项或函数级归因不可用（多因录制时未勾选相应类别）。');
  }
  L.push('');
  L.push('── Script / RecalcStyle / Layout / Paint 分项 ──────────────────');
  if (result.shape === 'devtools-trace') {
    const st = result.globalStage;
    let sum = 0;
    for (const k of ['script', 'recalcStyle', 'layout', 'paint']) if (st.totals[k] != null) sum += st.totals[k];
    L.push('（全 trace 口径，主线程顶层事件；单位 ms）');
    L.push('  分项' + ' '.repeat(16) + '总耗时      占比      事件数');
    for (const k of ['script', 'recalcStyle', 'layout', 'paint']) {
      const v = st.totals[k];
      if (v == null) continue;
      const share = sum ? (v / sum) * 100 : 0;
      L.push('  ' + STAGE_LABEL[k].padEnd(24) + fmt(v, 1).padStart(9) + '  ' + pct(share).padStart(7) + '  ' + String(st.counts[k]).padStart(6));
    }
    L.push('  分项合计 ' + fmt(sum, 1) + ' ms · trace 总跨度 ' + fmt(meta.spanMs, 0) + ' ms ⟹ 主线程被计入事件占用约 ' + pct(sum / meta.spanMs * 100));
    if (st.recalcElementCounts && st.recalcElementCounts.length) {
      const ec = st.recalcElementCounts.slice().sort((a, b) => b.elementCount - a.elementCount).slice(0, 5);
      L.push('  RecalcStyle 影响元素数 top5 : ' + ec.map((x) => x.elementCount + ' 个/' + fmt(x.durMs) + 'ms').join(' · '));
      const tot = st.recalcElementCounts.reduce((a, x) => a + x.elementCount, 0);
      L.push('  RecalcStyle 累计影响元素数 : ' + tot + '（跨 ' + st.recalcElementCounts.length + ' 次重算）');
    }
    if (result.windowStage) {
      L.push('');
      L.push('（窗口内口径，仅列耗时 top3 事件）');
      for (const k of ['script', 'recalcStyle', 'layout', 'paint']) {
        const w = result.windowStage[k];
        if (!w || !w.count) { L.push('  ' + STAGE_LABEL[k].padEnd(24) + '（窗口内无）'); continue; }
        L.push('  ' + STAGE_LABEL[k].padEnd(24) + fmt(w.totalMs, 1).padStart(9) + ' ms · ' + String(w.count).padStart(5) + ' 次');
        for (const it of w.top.slice(0, 3)) L.push('      ' + fmt(it.durMs) + ' ms @ ' + fmt(it.relMs, 0) + ' ms ' + short(it.name + ' ' + (it.url || ''), 90));
      }
    }
    if (st.cpuTotalSamples) {
      L.push('');
      L.push('── CPU profile 函数级自耗时（top 15，按采样数）──────────────────');
      L.push('  采样总数 ' + st.cpuTotalSamples + '（ProfileChunk ' + st.profileChunks + ' 个；未设采样间隔，故只给相对占比）');
      L.push('  #   占比     函数 @ URL');
      st.cpuTop.slice(0, 15).forEach((c, i) => {
        L.push('  ' + String(i + 1).padStart(2) + '  ' + pct(c.sharePct).padStart(7) + '  ' + short(c.functionName + ' @ ' + (c.url || '(unknown)'), 110) + (c.line != null ? ':' + c.line : ''));
      });
    } else {
      L.push('');
      L.push('⚠ 该 trace 未包含 CPU profile（无 ProfileChunk）。要拿函数级归因，请在 Performance 面板录制时');
      L.push('  勾选右上角齿轮里的 “Enable JavaScript samples / 记录 JS 采样”（或 CPU: 4x slowdown 一并开），或使用方案 C 的模式 B。');
    }
  } else {
    const st = result.globalStage;
    L.push('（方案 C 页面侧 API 的固有限制：无法直接给出 Script/Recalc/Layout/Paint 的毫秒分项）');
    L.push('  可用的替代量：');
    L.push('    LoAF 阻塞合计              : ' + fmt(st.loafBlocking, 1) + ' ms（主线程被长帧阻塞的总时长）');
    L.push('    forcedStyleAndLayout 合计  : ' + fmt(st.forcedStyleAndLayoutMin, 1) + ' ms（强制同步样式/布局 —— 与 ui-layout 靶点直接相关）');
    L.push('    Event Timing 事件总时长    : ' + fmt(st.eventDurationMs, 1) + ' ms 跨 ' + st.eventCount + ' 个事件');
    L.push('  要拿到 Script/RecalcStyle/Layout/Paint 分项，请改用方案 A（DevTools Performance 面板）。');
  }
  L.push('');
  L.push('── 已知修复项命中判定 ──────────────────────────────────────────');
  L.push('  口径：宿主下发的 client.js?rev=<sha1 前 12 位>，与已落地修复的终态指纹比对。');
  L.push('');
  for (const f of fixes) {
    const tag = f.revMatch === true ? '✔ 命中（已修复构建）' : f.revMatch === false ? '✘ 未命中（旧构建）' : '? 无 rev 证据';
    L.push('  [' + f.key + '] ' + tag);
    L.push('      ' + f.label);
    L.push('      期望 rev ' + f.expectedRev + ' · 实际 rev ' + (f.deliveredRev || '(未提供)') + ' · 判据 ' + f.evidenceKind);
    if (f.note) L.push('      注：' + f.note);
    for (const e of f.behaviorEvidence || []) L.push('      · [' + e.kind + '] ' + e.text);
    L.push('');
  }
  L.push('  提示：rev 需要人工投喂（--rev ui-layout=…,runtime=…,usage=…），或使用方案 C 工具自动抓取的目标页 rev。');
  L.push('  rev 只回答「你跑的是不是修复后的构建」；行为证据回答「卡在哪」。两者都命中才算闭环。');
  if (result.extraWarnings.length) {
    L.push('');
    L.push('── 采集/解析告警 ──────────────────────────────────────────────');
    for (const w of result.extraWarnings) L.push('  ⚠ ' + w);
  }
  L.push('');
  L.push('── 结论 ───────────────────────────────────────────────────────');
  L.push('  ' + result.headline);
  L.push('════════════════════════════════════════════════════════════════');
  return L.join('\n');
}

function makeHeadline(result) {
  const w = result.window;
  const janky = w.frames.jankyOver50 || 0;
  const fpsWorse = (w.before.fps != null && w.after.fps != null && w.after.fps < w.before.fps - 5);
  const revAbsent = result.fixes.filter((f) => f.revMatch === false).map((f) => f.key);
  const revPresent = result.fixes.filter((f) => f.revMatch === true).map((f) => f.key);
  const parts = [];
  if (!w.frames.n) parts.push('窗口内未采到帧边界事件（该 trace 未含帧类别，或窗口过短）——帧分布证据不足，但主线程占用率仍可判读。');
  else parts.push('点击前后各 ' + (w.window.spanMs / 2000) + 's 内采集 ' + w.frames.n + ' 个帧间隔，活跃期 ' + fmt(w.frames.fps) + ' FPS，p99 ' + fmt(w.frames.p99) + ' ms，>50ms 掉帧 ' + janky + ' 次' + (janky > 0 ? '（存在可感知卡顿）' : '（未见明显掉帧）') + '。');
  if (w.occupancyPctOfSpan != null) parts.push('窗口内主线程被任务占用 ' + fmt(w.mainThreadBusyMs, 0) + ' ms = ' + pct(w.occupancyPctOfSpan) + '（按活跃期 ' + pct(w.occupancyPctOfActive) + '）' + (w.occupancyPctOfSpan > 50 ? '，属于明显卡顿水平' : w.occupancyPctOfSpan > 25 ? '，属于可感知的偏卡' : '，占用不高') + '。');
  if (fpsWorse) parts.push('锚点后 FPS（' + fmt(w.after.fps) + '）低于锚点前（' + fmt(w.before.fps) + '），与「点设置就卡」的主观感受方向一致。');
  if (w.top10 && w.top10.length) parts.push('最长任务 ' + fmt(w.top10[0].durMs) + ' ms，落在 ' + short(w.top10[0].functionName || '?', 60) + (w.top10[0].url ? '（' + short(w.top10[0].url, 70) + '）' : '') + '。');
  if (revAbsent.length) parts.push('rev 判定：' + revAbsent.join('/') + ' 为旧构建 ⇒ 抓到的很可能是修复前行为，请先强刷页面再复采。');
  else if (revPresent.length) parts.push('rev 判定：' + revPresent.join('/') + ' 已是修复后构建 ⇒ 若仍卡，说明残留卡点在别处，需看 top10 与 CPU 分项。');
  else parts.push('rev 未知 ⇒ 先用 --rev 或方案 C 工具补齐 rev，否则无法区分「旧构建复现」与「新构建残留」。');
  return parts.join(' ');
}

/* ══════════════════════════════════════════════════════════════════
   9. 内部自检（--self-test）
   ══════════════════════════════════════════════════════════════════ */
function selfTest() {
  const checks = [];
  const ok = (name, cond, detail) => checks.push({ name, pass: !!cond, detail: detail || '' });

  // 1) 帧分布分桶边界正确
  {
    const buckets = FRAME_BUCKETS.map((b) => ({ ...b, count: 0 }));
    const feed = [10, 17, 40, 60, 150, 300];
    for (const g of feed) for (const b of buckets) if (g > b.lo && g <= b.hi) { b.count++; break; }
    ok('帧分桶 6 档各命中 1 次', buckets.every((b) => b.count === 1), JSON.stringify(buckets.map((b) => b.count)));
  }
  // 2) 分位数
  {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // 约定：floor((n-1)*p) 取最近下位（与 Performance 面板的「最近秩」口径一致）
    ok('quantile p50=5 / p99=9 / p100=10', quantile(s, 0.5) === 5 && quantile(s, 0.99) === 9 && quantile(s, 1) === 10,
      'p50=' + quantile(s, 0.5) + ' p99=' + quantile(s, 0.99) + ' p100=' + quantile(s, 1));
    ok('quantile 空数组=null', quantile([], 0.5) === null);
  }
  // 3) task 字符串解析
  {
    const a = parseTaskString('FunctionCall https://127.0.0.1:3080/x.js:12:5');
    const b = parseTaskString('EventDispatch');
    ok('parseTaskString 带 URL', a.fn === 'FunctionCall' && a.url === 'https://127.0.0.1:3080/x.js' && a.line === 12 && a.col === 5, JSON.stringify(a));
    ok('parseTaskString 无 URL', b.fn === 'EventDispatch' && b.url === null, JSON.stringify(b));
  }
  // 4) 分项归类
  {
    ok('UpdateLayoutTree→recalcStyle', classifyStage('UpdateLayoutTree') === 'recalcStyle');
    ok('Layout→layout', classifyStage('Layout') === 'layout');
    ok('Paint→paint', classifyStage('Paint') === 'paint');
    ok('RunTask→script', classifyStage('RunTask') === 'script');
    ok('未知事件→null', classifyStage('SomeUnknown') === null);
  }
  // 5) 形态判别
  {
    ok('判别 devtools-trace', detectShape({ traceEvents: [] }) === 'devtools-trace');
    ok('判别 user-capture', detectShape({ schema: 'dsh-user-capture/v1' }) === 'user-capture');
    ok('判别 unknown', detectShape({ foo: 1 }) === 'unknown');
  }
  // 6) 端到端：合成一份最小 devtools trace，走完整解析链路
  {
    const T = 1000000; // µs
    const ev = [];
    for (let i = 0; i < 60; i++) ev.push({ name: 'DrawFrame', cat: 'devtools.timeline', ph: 'X', ts: T + i * 16670, dur: 3000, pid: 1, tid: 1, args: {} });
    ev.push({ name: 'RunTask', cat: 'devtools.timeline,toplevel', ph: 'X', ts: T + 200000, dur: 320000, pid: 1, tid: 1, args: { task: 'FunctionCall https://127.0.0.1:3080/plugins/x/client.js:366:9', data: { frame: 'F1' } } });
    ev.push({ name: 'UpdateLayoutTree', cat: 'devtools.timeline', ph: 'X', ts: T + 210000, dur: 180000, pid: 1, tid: 1, args: { data: { elementCount: 4213 } } });
    ev.push({ name: 'Layout', cat: 'devtools.timeline', ph: 'X', ts: T + 400000, dur: 90000, pid: 1, tid: 1, args: { data: { elementCount: 3000 } } });
    ev.push({ name: 'Paint', cat: 'devtools.timeline', ph: 'X', ts: T + 500000, dur: 40000, pid: 1, tid: 1, args: { data: { clip: [0, 0, 100, 100] } } });
    ev.push({ name: 'navigationStart', cat: 'blink.user_timing', ph: 'R', ts: T, pid: 1, tid: 1, args: {} });
    ev.push({ name: 'USER_CLICK_SETTINGS_START', cat: 'blink.user_timing', ph: 'R', ts: T + 200000, pid: 1, tid: 1, args: {} });
    ev.push({ name: 'ProfileChunk', cat: 'disabled-by-default-v8.cpu_profiler', ph: 'P', ts: T, pid: 1, tid: 1, args: { data: { cpuProfile: { nodes: [{ id: 1, callFrame: { functionName: 'refreshThemeColor', url: 'https://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-ui-layout/client.js', lineNumber: 472 } }], samples: [1, 1, 1, 1] } } } });
    const doc = { traceEvents: ev, metadata: {} };
    const parsed = parseDevtoolsTrace(doc);
    ok('合成 trace: 60 帧 → 59 个间隔', parsed.frameGaps.length === 59, 'got ' + parsed.frameGaps.length);
    ok('合成 trace: 分项 recalc=180ms', Math.abs(parsed.stageTotals.recalcStyle - 180) < 0.001, 'got ' + parsed.stageTotals.recalcStyle);
    ok('合成 trace: 分项 layout=90ms', Math.abs(parsed.stageTotals.layout - 90) < 0.001, 'got ' + parsed.stageTotals.layout);
    ok('合成 trace: CPU 采样 4', parsed.cpuTotalSamples === 4, 'got ' + parsed.cpuTotalSamples);
    ok('合成 trace: CPU top1 = refreshThemeColor', parsed.cpuTop[0] && parsed.cpuTop[0].functionName === 'refreshThemeColor', JSON.stringify(parsed.cpuTop[0] && parsed.cpuTop[0].functionName));
    const anchor = resolveAnchor(parsed, {}, doc);
    ok('合成 trace: 锚点取自 performance.mark', Math.abs(anchor.t - (T + 200000)) < 1 && anchor.confidence === 'high', JSON.stringify(anchor));
    const win = analyzeWindow(parsed, anchor.t, 3000);
    ok('合成 trace: 窗口内 top1 = 320ms RunTask', win.top10[0] && Math.abs(win.top10[0].durMs - 320) < 0.001, JSON.stringify(win.top10[0] && win.top10[0].durMs));
    ok('合成 trace: top1 函数名与 URL 解析正确', win.top10[0].functionName === 'FunctionCall' && /client\.js/.test(win.top10[0].url || ''), JSON.stringify(win.top10[0] && [win.top10[0].functionName, win.top10[0].url]));
    ok('合成 trace: 窗口帧数 >0', win.frames.n > 0, 'got ' + win.frames.n);
    const fx = judgeKnownFixes({ 'ui-layout': '82cca1a6178a', runtime: '000000000000' }, parsed, win, doc);
    ok('修复项判定: ui-layout=PRESENT', fx[0].status === 'PRESENT', fx[0].status);
    ok('修复项判定: runtime=ABSENT-OR-OLDER', fx[1].status === 'ABSENT-OR-OLDER', fx[1].status);
    ok('修复项判定: usage=UNKNOWN', fx[2].status.startsWith('UNKNOWN'), fx[2].status);
  }
  // 7) 端到端：合成一份最小 user-capture，走完整解析链路
  {
    const doc = {
      schema: 'dsh-user-capture/v1', source: 'inpage', sessionId: 'selftest', durationMs: 8000,
      frames: Array.from({ length: 40 }, (_, i) => ({ t: i * 100, gap: i === 20 ? 180 : 16.7 })),
      longTasks: [{ name: 'self', startTime: 2000, duration: 120, attribution: [{ name: 'unknown', containerType: 'window' }] }],
      loaf: [{ startTime: 2050, duration: 240, blockingDuration: 190, renderStart: 2200, styleAndLayoutStart: 2240, scripts: [{ duration: 200, sourceFunctionName: 'refreshThemeColor', sourceURL: 'https://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-ui-layout/client.js', forcedStyleAndLayoutDuration: 150, invoker: 'Timer' }] }],
      events: [{ name: 'click', duration: 30, startTime: 2100 }],
      interactions: [{ t: 1980, type: 'click', isSettings: true, label: '设置', selector: 'button"设置"' }],
      anchor: { t: 1980, how: 'click-on-settings-like-control' },
      targetRev: { all: { 'dsh-client-ui-layout': '82cca1a6178a', 'dsh-client-runtime': '5559de4ce28c' } },
    };
    const parsed = parseUserCapture(doc);
    const anchor = resolveAnchor(parsed, {}, doc);
    ok('user-capture: 锚点来自 settings 点击', anchor.t === 1980 && anchor.confidence === 'high', JSON.stringify(anchor));
    const win = analyzeWindow(parsed, anchor.t, 3000);
    ok('user-capture: 窗口检出 180ms 掉帧', win.frames.jankyOver50 === 1, 'janky=' + win.frames.jankyOver50);
    ok('user-capture: LoAF 归属函数名正确', win.top10.some((t) => t.functionName === 'refreshThemeColor'), JSON.stringify(win.top10.map((t) => t.functionName)));
    const fx = judgeKnownFixes(null, parsed, win, doc);
    ok('user-capture: rev 从 targetRev 读出且命中', fx[0].status === 'PRESENT' && fx[1].status === 'PRESENT', fx[0].status + '/' + fx[1].status);
    ok('user-capture: forcedStyleAndLayout 证据存在', fx[0].behaviorEvidence.some((e) => /forcedStyleAndLayout/.test(e.text)), JSON.stringify(fx[0].behaviorEvidence));
  }

  const pass = checks.filter((c) => c.pass).length;
  console.log('parse-trace.mjs 内部自检');
  console.log('────────────────────────────────────────────────');
  for (const c of checks) console.log((c.pass ? '  PASS  ' : '  FAIL  ') + c.name + (c.pass ? '' : '   → ' + c.detail));
  console.log('────────────────────────────────────────────────');
  console.log('  ' + pass + '/' + checks.length + ' 通过');
  return pass === checks.length;
}

/* ══════════════════════════════════════════════════════════════════
   10. CLI
   ══════════════════════════════════════════════════════════════════ */
function parseArgs(argv) {
  const o = { input: null, json: null, window: DEFAULT_WINDOW_MS, anchor: null, rev: null, requireRev: null, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (a === '--self-test') { o.selfTest = true; continue; }
    if (a === '--window') { o.window = Number(argv[++i]); continue; }
    if (a === '--anchor') { o.anchor = Number(argv[++i]); continue; }
    if (a === '--json' || a === '--out') { o.json = argv[++i]; continue; }
    if (a === '--rev') { o.rev = argv[++i]; continue; }
    if (a === '--require-rev') { o.requireRev = argv[++i]; continue; }
    if (!o.input && !a.startsWith('-')) { o.input = a; continue; }
    throw new Error('未知参数：' + a);
  }
  return o;
}

function parseRevSpec(spec) {
  if (!spec) return null;
  const out = {};
  for (const part of String(spec).split(',')) {
    const [k, v] = part.split('=');
    if (k && v) out[k.trim().replace(/^dsh-client-|^dsh-/, '')] = v.trim();
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?/, ''));
    return 0;
  }
  if (opts.selfTest) return selfTest() ? 0 : 4;

  if (!opts.input) {
    console.error('用法：node parse-trace.mjs <trace.json> [--json report.json] [--window 3000] [--anchor N] [--rev ui-layout=…]');
    console.error('      node parse-trace.mjs --self-test');
    return 2;
  }
  if (!fs.existsSync(opts.input)) {
    console.error('输入文件不存在：' + opts.input);
    return 2;
  }

  const fileBytes = fs.statSync(opts.input).size;
  const head = fs.readFileSync(opts.input).slice(0, 2);
  const wasGzip = head.length === 2 && head[0] === 0x1f && head[1] === 0x8b;

  let doc;
  try { doc = loadJson(opts.input); }
  catch (e) { console.error('✘ ' + e.message); return 2; }

  const shape = detectShape(doc);
  if (shape === 'unknown') {
    console.error('✘ 无法判别输入形态：顶层既没有 traceEvents[]（DevTools），也没有 schema="dsh-user-capture/v1"（方案 C）。');
    console.error('  顶层键：' + JSON.stringify(Object.keys(doc).slice(0, 30)));
    return 2;
  }

  let parsed;
  try {
    parsed = shape === 'user-capture' ? parseUserCapture(doc) : parseDevtoolsTrace(shape === 'bare-event-array' ? { traceEvents: doc } : doc);
  } catch (e) {
    console.error('✘ 解析失败：' + e.message);
    return 2;
  }

  // DevTools：提供窗口内分项的按需重算（需要原始事件，故在此闭包）
  let windowStage = null;
  if (parsed.shape === 'devtools-trace') {
    const X = doc.traceEvents.filter((e) => e && e.ph === 'X' && typeof e.dur === 'number');
    parsed._stageWindow = (from, to) => {
      const acc = {};
      for (const k of ['script', 'recalcStyle', 'layout', 'paint']) acc[k] = { totalMs: 0, count: 0, top: [] };
      for (const e of X) {
        if (e.ts < from || e.ts > to) continue;
        const st = classifyStage(e.name);
        if (!st) continue;
        if (e.name !== 'RunTask' && st === 'script') continue;
        acc[st].totalMs += e.dur / 1000;
        acc[st].count += 1;
        acc[st].top.push({ durMs: e.dur / 1000, relMs: e.ts, name: e.name, url: (e.args && e.args.data && e.args.data.url) || null });
      }
      for (const k of Object.keys(acc)) acc[k].top.sort((a, b) => b.durMs - a.durMs);
      return acc;
    };
  }

  const anchor = resolveAnchor(parsed, opts, doc, opts.window);
  const win = analyzeWindow(parsed, anchor.t, opts.window);
  let coverage = null;
  // 覆盖度检查：窗口两端是否超出真实采集范围
  const cov = {
    anchorBeforeMs: (anchor.t - parsed.traceRange.tMin) / (parsed.shape === 'devtools-trace' ? 1000 : 1),
    anchorAfterMs: (parsed.traceRange.tMax - anchor.t) / (parsed.shape === 'devtools-trace' ? 1000 : 1),
    wantedMs: opts.window,
  };
  cov.beforeShortfallMs = +(opts.window - cov.anchorBeforeMs).toFixed(0);
  cov.afterShortfallMs = +(opts.window - cov.anchorAfterMs).toFixed(0);
  cov.adequate = cov.beforeShortfallMs <= 0 && cov.afterShortfallMs <= 0;
  coverage = cov;
  if (parsed.shape === 'devtools-trace' && parsed._stageWindow) windowStage = parsed._stageWindow(win.window.from, win.window.to);

  const revs = parseRevSpec(opts.rev);
  const fixes = judgeKnownFixes(revs, parsed, win, doc);

  const extraWarnings = (parsed.warnings || []).slice();
  if (coverage) {
    if (coverage.beforeShortfallMs > 0) extraWarnings.push('锚点之前只有 ' + coverage.anchorBeforeMs.toFixed(0) + ' ms 数据（希望 ' + coverage.wantedMs + ' ms，缺 ' + coverage.beforeShortfallMs + ' ms）⇒ 「点击前」那一列的统计被截断，只能说明趋势，不能当基线。');
    if (coverage.afterShortfallMs > 0) extraWarnings.push('锚点之后只有 ' + coverage.anchorAfterMs.toFixed(0) + ' ms 数据（希望 ' + coverage.wantedMs + ' ms，缺 ' + coverage.afterShortfallMs + ' ms）⇒ 录制在点击后过早停止，「点击后」窗口不完整。请按 Runbook「录制后至少再等 5 秒」重录。');
  }
  if (parsed.shape === 'user-capture' && doc.source === 'iframe') {
    extraWarnings.push('iframe 模式：窗口内长任务明细为空属预期（跨源隔离），要函数级归属请用方案 C 的模式 B 或方案 A。');
  }
  if (parsed.shape === 'devtools-trace' && !parsed.cpuTotalSamples) {
    extraWarnings.push('该 trace 无 CPU profile（无 ProfileChunk）⇒ 无函数级自耗时。录制时请在 Performance 面板齿轮里开启 JS 采样。');
  }
  if (anchor.confidence === 'low') {
    extraWarnings.push('锚点置信度为 low（未找到点击证据）⇒ 帧分布可能没有对齐到你真正点设置的那一刻。可用 --anchor 手动指定。');
  }

  const result = {
    schema: 'dsh-trace-report/v1',
    generatedAt: new Date().toISOString(),
    meta: {
      inputPath: path.resolve(opts.input), fileBytes, wasGzip, shape,
      unit: parsed.unit, eventCount: parsed.eventCount, timedEventCount: parsed.timedEventCount,
      spanMs: parsed.traceRange.spanMs,
      origin: parsed.shape === 'user-capture' ? ('dsh-jank-capture.html (' + (doc.source || 'unknown') + ')') : 'DevTools Performance panel',
      environment: parsed.shape === 'user-capture' ? doc.meta || null : null,
    },
    shape: parsed.shape,
    anchor,
    window: win,
    coverage,
    windowStage,
    globalStage: parsed.shape === 'devtools-trace' ? {
      totals: parsed.stageTotals, counts: parsed.stageCounts, namesSeen: parsed.stageNamesSeen,
      cpuTop: parsed.cpuTop, cpuTotalSamples: parsed.cpuTotalSamples, profileChunks: parsed.profileChunks,
      recalcElementCounts: (() => {
        const g = parsed.recalcByElementCount.map((x) => ({ elementCount: x.elementCount, durMs: x.dur / 1000, ts: x.ts }));
        return g;
      })(),
    } : {
      totals: null,
      counts: parsed.stageCounts,
      loafBlocking: parsed.stageTotals._loafBlocking,
      forcedStyleAndLayoutMin: parsed.stageTotals._forcedStyleAndLayoutMin,
      eventDurationMs: (doc.events || []).reduce((a, e) => a + (e.duration || 0), 0),
      eventCount: (doc.events || []).length,
      cpuTop: [], cpuTotalSamples: 0, profileChunks: 0, recalcElementCounts: [],
    },
    fixes,
    empirical: parsed.shape === 'devtools-trace' ? (() => {
      const want = ['RunTask', 'FunctionCall', 'UpdateLayoutTree', 'RecalcStyle', 'Layout', 'Paint', 'PaintSetup', 'ProfileChunk',
        'StackCpuSampling', 'AnimationFrame', 'AnimationFrame::Render', 'AnimationFrame::StyleAndLayout', 'BeginCommitCompositorFrame',
        'Commit', 'EventDispatch', 'FrameCommittedInBrowser', 'DrawFrame', 'RasterTask', 'UpdateCounters'];
      const o = {};
      for (const w of want) o[w] = parsed.eventNameCounts ? (parsed.eventNameCounts[w] || 0) : null;
      return o;
    })() : null,
    extraWarnings,
    headline: '',
  };
  result.headline = makeHeadline(result);

  const report = renderReport(result);
  console.log(report);

  if (opts.json) {
    fs.writeFileSync(opts.json, JSON.stringify(result, null, 2));
    console.error('\n（机器可读报告已写入 ' + path.resolve(opts.json) + '）');
  }

  if (opts.requireRev) {
    const want = parseRevSpec(opts.requireRev);
    const bad = [];
    for (const [k, v] of Object.entries(want)) {
      const f = fixes.find((x) => x.key === k || x.module === k);
      if (!f) { bad.push(k + '=未登记'); continue; }
      if (f.deliveredRev !== String(v).slice(0, 12)) bad.push(k + ' 期望 ' + String(v).slice(0, 12) + ' 实际 ' + (f.deliveredRev || 'null'));
    }
    if (bad.length) { console.error('\n✘ --require-rev 未满足：' + bad.join('; ')); return 3; }
  }
  return 0;
}

process.exit(main());
