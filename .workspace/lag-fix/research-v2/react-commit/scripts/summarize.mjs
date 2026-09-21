/** Turn the raw measurement JSON into the tables used by audit.md. */
import fs from 'node:fs';
const DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/react-commit';
const tag = process.argv[2] || 'main';
const r = JSON.parse(fs.readFileSync(`${DIR}/raw/measure-${tag}.json`, 'utf8'));

const n = (x, d = 2) => (x === null || x === undefined ? 'n/a' : (Math.round(x * 10 ** d) / 10 ** d));
const pct = (x) => (x === null || x === undefined ? 'n/a' : (x * 100).toFixed(1) + '%');

const out = { tag, meta: r.meta, premise: null, windows: [], groups: {} };

out.premise = {
  hookPreexisting: r.premise.hookPreexisting,
  injected: r.premise.injected,
  hookCalls_atBoot: r.premise.hookCalls,
  hookCalls_final: r.hookCallsFinal,
  panelFiberChain: (r.premise.panelChain || []).slice(0, 8),
  targetNames: r.finalProbe && r.finalProbe.targetNames,
  ancNames: Object.fromEntries(Object.entries(r.windows.find((w) => w.ancNames && Object.keys(w.ancNames).length)?.ancNames || {})),
};

for (const w of r.windows) {
  const a = w.agg || {};
  const d = w.derived || {};
  const row = {
    name: w.name,
    valid: w.valid,
    invalidReasons: w.invalidReasons,
    requested: w.requested,
    activeSection: [w.activeSectionAtStart, w.activeSectionAtEnd],
    sectionAction: w.sectionAction,
    panelNodesStart: w.panelNodesAtStart,
    panelNodesEnd: w.panelNodesAtEnd,
    seconds: a.seconds,
    activeSeconds: a.activeSeconds,
    commits: a.commits,
    commitsPerSec: n(d.commitsPerSec),
    ws: a.ws,
    sessionFrames: d.sessionFrames,
    sessionFramesPerSec: n(d.sessionFramesPerSec),
    panelRenders_id: a.tgt && a.tgt.panel ? a.tgt.panel.id : 0,
    panelRenders_pw: a.tgt && a.tgt.panel ? a.tgt.panel.pw : 0,
    rootRenders_id: a.tgt && a.tgt.root ? a.tgt.root.id : 0,
    panelRendersPerCommit: n(d.panelCommitsPerCommit),
    panelRendersPerSessionFrame: n(d.panelCommitsPerSessionFrame, 4),
    settingsSubtreeRenders: a.sub,
    settingsSubtreeTotalFibers: a.subTotalMax,
    settingsSubtreeRendersPerCommit: n(d.subRenderedPerCommit),
    wholeTreeRenders: a.wholePw,
    wholeTreeTotalFibers: a.wholeTotalMax,
    wholeRendersPerCommit: n(d.wholeRenderedPerCommit),
    chainIndexNames: w.ancNames,
    chainRendersPerCommit: (() => {
      const o = {};
      for (const [i, c] of Object.entries(a.chain || {})) o[i] = n(c / (a.commits || 1), 4);
      return o;
    })(),
    subNamesTop: Object.entries(a.subNames || {}).sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => `${k}=${v}`),
    sessionListStart: w.sessionListAtStart && { items: w.sessionListAtStart.items, topLevel: w.sessionListAtStart.topLevel, subagents: w.sessionListAtStart.subagents, running: w.sessionListAtStart.running, withProjections: w.sessionListAtStart.withProjections },
    sessionListEnd: w.sessionListAtEnd && { items: w.sessionListAtEnd.items, topLevel: w.sessionListAtEnd.topLevel, running: w.sessionListAtEnd.running },
    err: w.error || null,
  };
  out.windows.push(row);
}

function group(name, pred) {
  const ws = out.windows.filter(pred);
  const sum = (k) => ws.reduce((a, w) => a + (w[k] || 0), 0);
  const valid = ws.filter((w) => w.valid);
  return {
    n: ws.length, nValid: valid.length,
    names: ws.map((w) => w.name),
    seconds: sum('seconds'),
    commits: sum('commits'),
    sessionFrames: sum('sessionFrames'),
    sessionEventFrames: ws.reduce((a, w) => a + ((w.ws['session/event'] || 0)), 0),
    sessionProjectionFrames: ws.reduce((a, w) => a + ((w.ws['session/projection'] || 0)), 0),
    panelRenders_id: sum('panelRenders_id'),
    panelRendersPerCommit: ws.reduce((a, w) => a + w.commits, 0) ? sum('panelRenders_id') / sum('commits') : null,
    panelRendersPerSessionFrame: sum('sessionFrames') ? sum('panelRenders_id') / sum('sessionFrames') : null,
    commitsPerSessionFrame: sum('sessionFrames') ? sum('commits') / sum('sessionFrames') : null,
    commitsPerSec: sum('seconds') ? sum('commits') / sum('seconds') : null,
    settingsSubtreeRendersPerCommit: sum('commits') ? sum('settingsSubtreeRenders') / sum('commits') : null,
    wholeRendersPerCommit: sum('commits') ? sum('wholeTreeRenders') / sum('commits') : null,
  };
}

out.groups = {
  active_open_models: group('active_open_models', (w) => w.requested.net === 'active' && w.requested.panel === 'open' && w.requested.section === 'models'),
  active_open_general: group('active_open_general', (w) => w.requested.net === 'active' && w.requested.panel === 'open' && w.requested.section === 'general'),
  active_closed: group('active_closed', (w) => w.requested.net === 'active' && w.requested.panel === 'closed'),
  quiet_open_models: group('quiet_open_models', (w) => w.requested.net === 'quiet' && w.requested.panel === 'open'),
  quiet_closed: group('quiet_closed', (w) => w.requested.net === 'quiet' && w.requested.panel === 'closed'),
};

fs.writeFileSync(`${DIR}/raw/summary-${tag}.json`, JSON.stringify(out, null, 2));

console.log('=== PREMISE ===');
console.log(JSON.stringify(out.premise, null, 1));
console.log('\n=== WINDOWS ===');
for (const w of out.windows) {
  console.log(`${w.name} valid=${w.valid} ${JSON.stringify(w.invalidReasons)} sec=${JSON.stringify(w.activeSection)} panelNodes=${w.panelNodesStart}->${w.panelNodesEnd} secs=${w.seconds}`);
  console.log(`   commits=${w.commits} (${w.commitsPerSec}/s) sessionFrames=${w.sessionFrames} (event=${w.ws['session/event'] || 0} proj=${w.ws['session/projection'] || 0}) wsAll=${JSON.stringify(w.ws)}`);
  console.log(`   panelRenders(id)=${w.panelRenders_id} pw=${w.panelRenders_pw} perCommit=${w.panelRendersPerCommit} perSessionFrame=${w.panelRendersPerSessionFrame}`);
  console.log(`   settingsSubtree=${w.settingsSubtreeRenders} (${w.settingsSubtreeRendersPerCommit}/commit of ${w.settingsSubtreeTotalFibers} fibers) wholeTree=${w.wholeTreeRenders} (${w.wholeRendersPerCommit}/commit of ${w.wholeTreeTotalFibers})`);
  console.log(`   chain perCommit=${JSON.stringify(w.chainRendersPerCommit)} names=${JSON.stringify(w.chainIndexNames)}`);
  console.log(`   subTop=${w.subNamesTop.join(', ')}`);
}
console.log('\n=== GROUPS ===');
console.log(JSON.stringify(out.groups, null, 1));
