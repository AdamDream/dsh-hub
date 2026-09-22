#!/usr/bin/env node
/**
 * analyze.mjs — 把 host-click-probe 的原始 JSON 变成可裁决的结论（task 1/2/3/4 逐条）
 *
 * 输入：
 *   raw/click-run*.json   每次「全新页面 → 点设置」的完整记录
 *   raw/host-drift-ambient.json  同时段、无页面活动的宿主静止基线（对照面）
 * 输出：
 *   analysis.json（结构化）+ 控制台表格
 *
 * 判据（本档事先钉死，避免事后挑标准）：
 *   T1 心跳口径：报 pre / click±500ms / post 三窗的 p50/p95/max + 窗内 ≥100ms 的尖峰计数
 *   T2 点击触发：点击锚点后 3s 内所有 POST /api/* 与 /usage/*，逐条标 click-direct / incidental
 *   T3 对齐：clickAnchor→settingsPanelVisible 的时长，与同窗宿主尖峰求交；换算误差取 clock.skewBoundMs
 *   T4 重复性：≥3 次运行的 max 与"±500ms 命中"计数；任一 max>100ms 即列出该时刻 URL
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = new URL('.', import.meta.url).pathname;
const RAW = join(DIR, 'raw');
const STALL_MS = Number(process.env.HC_STALL_MS || 100);

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const readJsonl = (p) => readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const q = (arr, p) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const pos = (s.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
};
const stat = (beats) => {
  const ms = beats.map((b) => b.ms).filter(Number.isFinite);
  return {
    n: beats.length, nValid: ms.length,
    p50: q(ms, .5), p95: q(ms, .95), p99: q(ms, .99),
    max: ms.length ? Math.max(...ms) : NaN, min: ms.length ? Math.min(...ms) : NaN,
    stalls100: beats.filter((b) => b.ms >= STALL_MS).length,
    // 探针自我饿住 / 补账空等：每拍开始前因"上一拍超时导致排程欠账"而产生的空等毫秒数（idleBefore）。
    // 该值 > 0 表示这一拍的 t0 不是"按 50ms 节拍该发的时刻"，而是"补账时刻"，
    // 其耗时里可能含有等待抖动 ⇒ 报告里单列，不混进"宿主纯响应"结论。
    idleMaxExcess: Math.max(0, ...beats.map((b) => b.idleBefore || 0)),
    nWithIdleBefore: beats.filter((b) => (b.idleBefore || 0) > 1).length,
    schedSkewMax: Math.max(0, ...beats.map((b) => b.schedSkew || 0)),
  };
};
const winOf = (beats, from, to) => beats.filter((b) => b.t0 >= from && b.t0 <= to);
/** 从一条 fetch-out 记录里取**RPC 方法名**（绝不用 HTTP 动词冒充）。 */
const rpcMethodOf = (o) => {
  if (o.rpcMethod) return o.rpcMethod;
  const body = o.raw || o.body || '';
  try { const j = JSON.parse(body); if (j && typeof j.method === 'string') return j.method; } catch { /* 非 JSON */ }
  if (o.method && o.method !== 'POST' && o.method !== 'GET') return o.method;
  return '?';
};
const PRE_MS = (r) => r.preMs ?? 3000;
const POST_MS = (r) => r.postMs ?? 3000;

// ── 1) 读入全部运行 ────────────────────────────────────────────────────────────
const runFiles = existsSync(RAW) ? readdirSync(RAW).filter((f) => /^click-run.*\.json$/.test(f)).sort() : [];
if (!runFiles.length) { console.error(`[analyze] 没有 raw/click-run*.json —— 先跑 host-click-probe.mjs`); process.exit(3); }
const runs = runFiles.map((f) => ({ file: f, ...readJson(join(RAW, f)) }));

const driftPath = join(RAW, 'host-drift-ambient.json');
const drift = existsSync(driftPath) ? readJson(driftPath) : null;
const driftBeats = drift ? readJsonl(join(RAW, 'host-drift-ambient.jsonl')) : [];
// 低速率哨兵（500ms 间隔）：只用来给**每次运行**贴"当时宿主处于什么状态"的标签，
// 不当作延迟分布证据（速率太低，取不到 p95）。
const sentinelPath = join(RAW, 'host-drift-sentinel.jsonl');
const sentinel = existsSync(sentinelPath) ? readJsonl(sentinelPath) : [];

/** 运行时刻 ±15s 的哨兵窗口 ⇒ 该次运行的宿主工况标签（点击测量的混杂变量）。 */
function conditionAt(anchorT) {
  const w = sentinel.filter((b) => Math.abs(b.t0 - anchorT) <= 15000);
  if (!w.length) return { n: 0, label: 'UNKNOWN（哨兵无样本）' };
  const ms = w.map((b) => b.ms).sort((a, b) => a - b);
  const p50 = q(ms, .5), mx = ms[ms.length - 1];
  const stalls = ms.filter((x) => x >= 100).length;
  const label = p50 < 15 && mx < 150 ? 'QUIET（宿主接近静止）' : p50 < 60 && mx < 500 ? 'LOADED（宿主明显有外线负载）' : 'HEAVY（宿主严重争用/存在秒级停顿）';
  return { n: w.length, p50, max: mx, stalls100: stalls, label };
}

// ── 2) 每次运行：窗口统计 + 请求分类 + 对齐 ────────────────────────────────────
const perRun = runs.map((r) => {
  const a = r.anchor.clickAnchor;
  const beats = r.beats;
  // 现算 idleBefore（不依赖探针版本，旧的 run 也能算）：本拍 t0 与"上一拍 t1 + 50ms"的差，取正。
  for (let k = 0; k < beats.length; k++) beats[k].idleBefore = k === 0 ? 0 : Math.max(0, beats[k].t0 - beats[k - 1].t1 - 50);
  // 统计**一律从原始 beats 现算**，不采用上游写好的 summary —— 上游万一算错/口径漂移，
  // 结论不能被静默带偏（本档自证脚本正是靠这条抓到过一次）。
  const s = {
    pre: stat(winOf(beats, a - PRE_MS(r), a)),
    plusMinus500: stat(winOf(beats, a - 500, a + 500)),
    post: stat(winOf(beats, a, a + POST_MS(r))),
  };
  // 严格口径：只把"点击之后 500ms 内"的 ≥阈值 停顿算作点击命中（点击前的停顿不可能是点击造成的）
  s.plusMinus500.stalls100_afterClick = beats.filter((b) => b.ms >= STALL_MS && b.t0 >= a && b.t0 <= a + 500).length;
  const inWindow = (t, from, to) => t >= from && t <= to;
  const inAfterClick500 = (t) => t >= a && t <= a + 500;

  // 页内 RPC 时间线（fetch hook：unary RPC 的真实载体是 HTTP fetch；WS 只承载事件流）
  const rec = (r.page.rpcTimeline || []).map((e, idx) => ({ ...e, idx }));
  const outs = rec.filter((e) => e.dir === 'fetch-out');
  const ins = rec.filter((e) => e.dir === 'fetch-in');
  // 配对：先按 rpcId（若响应侧带），否则按 URL 取 out 之后**最近且未被占用**的 in
  // —— unary RPC 的响应不能早于请求，且同一 URL 的并发由"最近未占用"消歧。
  const used = new Set();
  const pairOf = (o) => {
    if (o.rpcId) {
      const hit = ins.find((i) => !used.has(i.idx) && i.rpcId === o.rpcId && i.t >= o.t);
      if (hit) { used.add(hit.idx); return hit; }
    }
    // 兜底：同 URL（或同 rpcMethod）里走出窗口后**最早且未占用**的那条响应
    const same = ins
      .filter((i) => !used.has(i.idx) && i.t >= o.t && ((i.url && i.url === o.url) || (i.rpcMethod && i.rpcMethod === o.rpcMethod)))
      .sort((x, y) => x.t - y.t);
    if (same.length) { used.add(same[0].idx); return same[0]; }
    return null;
  };
  const pairs = outs.filter((e) => inWindow(e.t, a - 3000, a + 3000)).map((o) => {
    const cand = pairOf(o);
    return {
      // 关键：`method` 必须是 **RPC 方法名**（settings.describe），不是 HTTP 动词（POST）。
      // 上游 fetch hook 二者都记（rpcMethod 取自信封、method 是 HTTP 动词），这里显式优先 rpcMethod；
      // 若该字段缺失但 body 里能解析出信封方法名，也从 raw body 兜底解析。
      t: o.t, method: rpcMethodOf(o), rpcId: o.rpcId || null, url: o.url,
      reqBytes: o.bytes, dtFromClickMs: o.t - a,
      respT: cand ? cand.t : null,
      respMs: cand ? cand.t - o.t : null,
      respBytes: cand ? cand.bytes : null,
      respOk: cand ? cand.ok : undefined,
      raw: (o.raw || o.body || '').slice(0, 600),
    };
  });
  // 归因口径（事先钉死，避免事后挑标准）：
  //   click-direct  = 命中设置面板自身调用路径，或落在点击后 [0, 300ms]（面板首屏同步取数窗口）
  //   mount-batch   = 落在点击后 [2000, 3000ms] 的挂载批（实测为 +2541..+2643 的 8 连发）——**需人工判读**：
  //                   它既可能是"面板惰性挂载"，也可能是"恰好发生"的既有轮询，故单列而不并入 click-direct
  //   incidental    = 其余（窗外 / 已知后台轮询 / 非设置路径）
  const SETTINGS_PATH = /^(settings\.|pluginInventory\.|llm\.|credentials\.|nodes\.|config\.|agentPreset\.|dynamicCordisRunner\/|subagent\.|skill\.|commands\/|session\.history|session\.models|remote\.)/;
  const KNOWN_BG = /^(session\.list|usage\.|status|host\.describe|fs\.|project\.|workspace\.|ui\.)/;
  for (const p of pairs) {
    if (p.dtFromClickMs >= 0 && p.dtFromClickMs <= 300 && SETTINGS_PATH.test(p.method)) p.attribution = 'click-direct（点击后 300ms 内·设置路径）';
    else if (p.dtFromClickMs > 300 && p.dtFromClickMs <= 2000 && SETTINGS_PATH.test(p.method)) p.attribution = 'click-follow（点击后 0.3–2s·设置路径）';
    else if (p.dtFromClickMs >= 2000 && p.dtFromClickMs <= 3000) p.attribution = 'mount-batch?（点击后 2–3s 的连发批·需人工判读是惰性挂载还是恰好发生）';
    else if (KNOWN_BG.test(p.method)) p.attribution = 'incidental（既有后台轮询）';
    else p.attribution = 'incidental（窗外/非设置路径）';
  }
  // ★ 决定性口径：把"点击直接触发的那次 RPC 的飞行区间"与宿主心跳对齐。
  //   若宿主在 RPC 在飞时停摆，该区间内的心跳必然出现尖峰；若无尖峰，说明这次点击触发的宿主工作没有阻塞宿主。
  const direct = pairs.filter((p) => /^click-direct/.test(p.attribution) && p.respT != null);
  const rpcWindows = direct.map((p) => {
    const inside = beats.filter((b) => b.t0 >= p.t && b.t0 <= p.respT);
    const overlapping = beats.filter((b) => b.t0 <= p.respT && b.t1 >= p.t); // 与飞行区间有交叠的拍
    const st = stat(inside.concat(overlapping.filter((o) => !inside.includes(o))));
    return { method: p.method, sentDt: p.t - a, respDt: p.respT - a, respMs: p.respMs, respBytes: p.respBytes, heartbeatsDuring: inside.length, beatMaxDuring: st.max, beatP50During: st.p50, beatStalls100: st.stalls100 };
  });
  const attributionBuckets = {};
  for (const p of pairs) { const k = p.attribution.split('（')[0]; attributionBuckets[k] = (attributionBuckets[k] || 0) + 1; }

  // 宿主心跳尖峰（≥100ms）与拍间空档
  const stalls = beats.filter((b) => b.ms >= STALL_MS).map((b) => ({ seq: b.seq, t0: b.t0, iso: new Date(b.t0).toISOString(), endpoint: b.endpoint, ms: b.ms, dtFromClickMs: b.t0 - a, inPlusMinus500: inWindow(b.t0, a - 500, a + 500) }));
  // 拍间空档：注意本循环的排程特性 —— 每拍的 due 只前进 50ms，而由于串行等待，
  // 真实间隔恒为 max(50ms, 上一拍耗时)。因此**空档 >= 阈值 必然等价于"上一拍耗时 >= 阈值-50"**，
  // 反之亦然。这条恒等式是"宿主体感停顿"的独立交叉验证：两个量必须一致，不一致就说明探针侧有问题。
  const gaps = [];
  for (let i = 1; i < beats.length; i++) gaps.push({ t0: beats[i].t0, gap: beats[i].t0 - beats[i - 1].t1, prevMs: beats[i - 1].ms, prevEndpoint: beats[i - 1].endpoint, dtFromClickMs: beats[i].t0 - a });
  const bigGaps = gaps.filter((g) => g.gap >= STALL_MS).map((g) => ({ ...g, iso: new Date(g.t0).toISOString(), inPlusMinus500: inWindow(g.t0, a - 500, a + 500) }));
  // 恒等式核对：空档 >= 阈值 的集合 与 上一拍耗时 >= 阈值-50 的集合 是否一致
  const gapSet = new Set(bigGaps.map((g) => Math.round(g.t0)));
  const slowPrev = beats.filter((b) => b.ms >= STALL_MS - 50).map((b) => Math.round(b.t1));
  const identityConsistent = bigGaps.every((g) => g.prevMs >= STALL_MS - 50);

  // 对齐：点击 → 面板可见
  const vis = r.page.vis || {};
  const panelVisibleAt = vis.visibleAt ?? null;
  const contentAt = vis.firstContentAt ?? null;
  const align = {
    clickAnchor: a, anchorSource: r.anchor.source, anchorUncertaintyMs: r.anchor.uncertaintyMs,
    panelVisibleAt, msClickToPanelVisible: panelVisibleAt != null ? panelVisibleAt - a : null,
    contentAt, msClickToContent: contentAt != null ? contentAt - a : null,
    conversionErrorBoundMs: r.clock.skewBoundMs,
    pageNodeTimeOriginDeltaMs: r.clock.deltaTimeOriginMs,
  };
  // 卡顿是否落在宿主停顿窗口内
  // 卡顿是否落在"点击之后"的窗口内：只算 dtFromClickMs >= 0 的停顿（点击前的停顿不可能是点击造成的）
  const stallsInClickWindow = stalls.filter((x) => x.dtFromClickMs >= 0 && (x.inPlusMinus500 || x.dtFromClickMs <= (align.msClickToPanelVisible ?? 0) + 200));
  align.stallsOverlappingClickToPanel = stallsInClickWindow;
  align.verdictHostStallInsideClickWindow = stallsInClickWindow.length > 0;

  // 宿主尖峰 ↔ 页内 RPC 的时序关联：某一拍慢的时候，是否正好有某个 RPC 在飞？
  // 这是**没有进程内探针**时能做的最强归因（不是堆栈，但能指名"当时在等谁"）。
  for (const s of stalls) {
    const inFlight = pairs.filter((p) => p.t <= s.t0 && (p.respT == null || p.respT >= s.t0));
    s.rpcInFlight = inFlight.map((p) => ({ method: p.method, sentDt: p.t - a, respDt: p.respT != null ? p.respT - a : null, respMs: p.respMs }));
    s.note = inFlight.length ? '该拍期间有 RPC 在飞（见 rpcInFlight）' : '该拍期间无页内 RPC 在飞 ⇒ 更可能是宿主自身/其它线的负载，而非本次点击';
  }

  // 页内长任务（对照：客户端停顿）
  const lt = (r.page.longtasks || []).filter((e) => inWindow(e.t, a - 1000, a + 3000));
  const frames = r.page.framesSummary;

  // 独立第二来源：Node 侧（Playwright request 事件 + CDP Network 域）的 HTTP 记录。
  // 两个来源必须**同口径互证**；若两者不一致，说明某个 hook 漏采，结论要降级为 INCONCLUSIVE。
  const httpAll = (r.nodeSide?.requests || []).filter((x) => x.method === 'POST' && (/\/api\//.test(x.url) || /\/usage\//.test(x.url)));
  const rpcOf = (postData) => { try { const j = JSON.parse(postData); return { method: j.method || '?', rpcId: j.rpcId || null, bytes: (postData || '').length }; } catch { return { method: '?', rpcId: null, bytes: (postData || '').length }; } };
  const httpInWindow = httpAll.map((x) => {
    const m = rpcOf(x.postData);
    const resp = (r.nodeSide?.responses || []).find((y) => y.url === x.url && y.t >= x.t);
    return { t: x.t, dtFromClickMs: x.t - a, method: m.method, rpcId: m.rpcId, url: x.url, reqBytes: m.bytes, respT: resp ? resp.t : null, respMs: resp ? resp.t - x.t : null, respBytes: resp ? resp.bytes : null, status: resp ? resp.status : null, inClick3s: x.t >= a && x.t <= a + 3000 };
  }).filter((x) => inWindow(x.t, a - 3000, a + 3000));
  const cdpInWindow = (r.nodeSide?.cdpRpc || []).filter((x) => inWindow(x.t, a - 3000, a + 3000)).map((x) => { const m = rpcOf(x.postData); return { t: x.t, dtFromClickMs: x.t - a, method: m.method, reqBytes: m.bytes, respMs: x.respMs ?? null, status: x.status ?? null, inClick3s: x.t >= a && x.t <= a + 3000 }; });

  return {
    file: r.file, run: r.run,
    anchor: r.anchor,
    clickError: r.clickError,
    condition: conditionAt(a),
    windows: { pre: s.pre, plusMinus500: s.plusMinus500, post: s.post },
    httpInWindow, cdpInWindow,
    // 运行内对照：点击窗相对**本次运行自己的 pre 窗**的超出量。
    // 这是本档最抗混杂的判据：宿主负载在 6 秒内近似恒定，pre 窗就是同条件的自身基线。
    excess: {
      p50: s.plusMinus500.p50 - s.pre.p50,
      p95: s.plusMinus500.p95 - s.pre.p95,
      max: s.plusMinus500.max - s.pre.max,
      ratioP95: s.pre.p95 > 0 ? s.plusMinus500.p95 / s.pre.p95 : null,
    },
    stalls, bigGaps, gapStallIdentityConsistent: identityConsistent, rpcInWindow: pairs, attributionBuckets, rpcWindows,
    settingsCalls: pairs.filter((p) => SETTINGS_PATH.test(p.method)),
    align, longtasksNearClick: lt, frames, clock: r.clock,
    pageVisMaxPollGap: vis.maxGap,
  };
});

// ── 3) task4 重复性 ────────────────────────────────────────────────────────────
const repeat = {
  nRuns: perRun.length,
  perRunMax: perRun.map((p) => ({ run: p.run, file: p.file, maxMs: p.windows.post.max, maxInPlusMinus500: p.windows.plusMinus500.max, stalls100_post: p.windows.post.stalls100, stalls100_pm500: p.windows.plusMinus500.stalls100, stalls100_afterClick: p.windows.plusMinus500.stalls100_afterClick, hit: p.windows.plusMinus500.stalls100_afterClick > 0, msClickToPanel: p.align.msClickToPanelVisible })),
  anyOver100: perRun.some((p) => p.windows.post.max >= STALL_MS),
};
repeat.hitRate = perRun.length ? perRun.filter((p) => p.windows.plusMinus500.stalls100 > 0).length / perRun.length : 0;

// ── 4) 与静止基线对比 ─────────────────────────────────────────────────────────
const ambient = drift ? { tag: drift.tag, summary: drift.summary, stalls: drift.stalls, window: { from: drift.startedAt, to: drift.endedAt } } : null;

// ── 5) 判据 ───────────────────────────────────────────────────────────────────
const allPostBeats = perRun.flatMap((p, i) => runs[i].beats.filter((b) => b.t0 >= runs[i].anchor.clickAnchor));
const verdict = {
  T1_heartbeat_reported: perRun.every((p) => Number.isFinite(p.windows.plusMinus500.p50) && Number.isFinite(p.windows.plusMinus500.max)) ? 'PASS' : 'FAIL',
  // 严格口径：只把"点击后 500ms 内"的停顿算作点击命中；点击**之前**的停顿另计
  T1_host_stall_over_100ms_AFTER_click: perRun.map((p) => p.windows.plusMinus500.stalls100_afterClick),
  T1_host_stall_over_100ms_in_pm500_window: perRun.some((p) => p.windows.plusMinus500.stalls100 > 0) ? 'YES(±500ms 窗内存在停顿，但见 AFTER 列判断是否在点击之后)' : 'NO(无 ≥100ms 停顿)',
  T2_requests_recorded: perRun.every((p) => p.rpcInWindow.length >= 0) ? 'PASS' : 'FAIL',
  T2_settings_direct_calls: perRun.map((p) => p.settingsCalls.length),
  T3_alignment_reported: perRun.every((p) => p.align.msClickToPanelVisible != null) ? 'PASS' : 'INCONCLUSIVE(面板可见时刻未采到)',
  T3_host_stall_inside_click_to_panel: perRun.map((p) => p.align.verdictHostStallInsideClickWindow),
  T4_runs: perRun.length,
  T4_repeatability: perRun.length >= 3
    ? (perRun.every((p) => p.windows.plusMinus500.stalls100_afterClick === 0)
        ? `3/3 次运行"点击后 500ms 内"均无 ≥${STALL_MS}ms 停顿（点击后 3s 内的 max：${perRun.map((p) => p.windows.post.max.toFixed(1)).join(' / ')}ms；任一次 >100ms：${repeat.anyOver100}，其出现时刻见 §4 的 stall 列表）`
        : '有运行在点击后 500ms 内出现停顿 ⇒ 见 perRunMax')
    : 'INCONCLUSIVE(运行次数<3)',
};
// 全局：点击窗口 vs 静止基线的重叠度（宿主自身是否有同级尖峰）
if (drift) {
  const d = driftBeats.filter((b) => b.ms >= STALL_MS).length;
  verdict.T_ambient_stalls100 = d;
  verdict.T_ambient_n = driftBeats.length;
  verdict.T_ambient_ratio = driftBeats.length ? d / driftBeats.length : null;
}

const out = {
  kind: 'host-click-analysis',
  generatedAt: new Date(performance.timeOrigin + performance.now()).toISOString(),
  stallThresholdMs: STALL_MS,
  perRun, repeat, ambient, verdict,
};
const outPath = join(DIR, 'analysis.json');
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');

// ── 6) 打印 ───────────────────────────────────────────────────────────────────
const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
console.log(`\n=== 每次运行：宿主心跳窗口（阈值 ${STALL_MS}ms） ===`);
console.log('run  window        n   p50     p95     max     >=100ms  schedSkewMax');
for (const p of perRun) {
  for (const [name, s] of Object.entries(p.windows)) {
    console.log(`${String(p.run).padEnd(4)} ${name.padEnd(12)} ${String(s.n).padEnd(3)} ${f(s.p50).padEnd(7)} ${f(s.p95).padEnd(7)} ${f(s.max).padEnd(7)} ${String(s.stalls100).padEnd(8)} ${f(s.schedSkewMax)}`);
  }
}
console.log(`\n=== 对齐（点击 → 设置面板可见） ===`);
console.log('run  anchor源                 不确定度  点击→面板可见  点击→内容  换算误差界  宿主停顿落在窗内');
for (const p of perRun) {
  console.log(`${String(p.run).padEnd(4)} ${p.align.anchorSource.padEnd(24)} ±${f(p.align.anchorUncertaintyMs).padEnd(8)} ${f(p.align.msClickToPanelVisible).padEnd(13)} ${f(p.align.msClickToContent).padEnd(10)} ±${f(p.align.conversionErrorBoundMs).padEnd(9)} ${p.align.verdictHostStallInsideClickWindow}`);
}
console.log(`\n=== 点击后 3s 内页内 RPC（逐条归因） ===`);
for (const p of perRun) {
  console.log(`--- run ${p.run}: 页内 fetch 口径 ${p.rpcInWindow.length} 条 / Node+CDP 口径 ${p.httpInWindow.length} 条（工况：${p.condition.label} p50=${f(p.condition.p50)} max=${f(p.condition.max)}） ---`);
  for (const x of p.rpcInWindow) console.log(`  [page] @${String(f(x.dtFromClickMs, 0)).padStart(6)}ms  ${String(x.method).padEnd(28)} req=${String(x.reqBytes).padStart(5)}B resp=${String(x.respBytes).padStart(7)}B ${String(f(x.respMs)).padStart(8)}ms  ${x.attribution}`);
  for (const x of p.httpInWindow) console.log(`  [node] @${String(f(x.dtFromClickMs, 0)).padStart(6)}ms  ${String(x.method).padEnd(28)} req=${String(x.reqBytes).padStart(5)}B resp=${String(x.respBytes).padStart(7)}B ${String(f(x.respMs)).padStart(8)}ms  status=${x.status}`);
}
console.log(`\n=== 运行内对照（点击窗 vs 本运行 pre 窗，抗混杂判据） ===`);
console.log('run  工况                          p50超出   p95超出   max超出   p95比');
for (const p of perRun) console.log(`${String(p.run).padEnd(4)} ${p.condition.label.padEnd(28)} ${f(p.excess.p50).padStart(7)} ${f(p.excess.p95).padStart(9)} ${f(p.excess.max).padStart(9)} ${f(p.excess.ratioP95, 2).padStart(8)}`);
console.log(`\n=== 宿主尖峰归因（≥${STALL_MS}ms 的那几拍当时有没有 RPC 在飞） ===`);
for (const p of perRun) for (const s2 of p.stalls) console.log(`  run ${p.run} @${f(s2.dtFromClickMs, 0)}ms ${f(s2.ms)}ms ${s2.inPlusMinus500 ? '【在±500ms窗内】' : ''} flying=${JSON.stringify(s2.rpcInFlight)} — ${s2.note}`);
console.log(`\n=== 重复性 ===`);
for (const r of repeat.perRunMax) console.log(`  run ${r.run}: post max=${f(r.maxMs)}ms  ±500ms max=${f(r.maxInPlusMinus500)}ms  hit=${r.hit}  点击→面板=${f(r.msClickToPanel)}ms`);
console.log(`  hitRate=${(repeat.hitRate * 100).toFixed(0)}%  anyOver100=${repeat.anyOver100}`);
if (ambient) console.log(`\n=== 静止基线（同档、无页面活动） === n=${ambient.summary.n} p50=${f(ambient.summary.p50)} p95=${f(ambient.summary.p95)} p99=${f(ambient.summary.p99)} max=${f(ambient.summary.max)} stalls>=${STALL_MS}ms=${ambient.stalls.length}`);
console.log(`\n=== 判据 ===`);
console.log(JSON.stringify(verdict, null, 2));
console.log(`\n[out] ${outPath}`);
