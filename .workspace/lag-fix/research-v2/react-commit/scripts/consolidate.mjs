/** Build raw/FINAL.json: one self-contained evidence bundle for audit.md. */
import fs from 'node:fs';
const DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/react-commit';
const read = (p) => JSON.parse(fs.readFileSync(`${DIR}/raw/${p}`, 'utf8'));
const main = read('measure-main.json');
const ab = read('ab-nocdp.json');
const dbg = read('debug-plain.json');
const locked = read('measure-locked.json');
const lockrep = read('lock-report.json');

const panelSecsOf = (w) => Math.round((w.derived.panelSecsFraction || 0) * (w.agg.seconds || 0));
function validity(w) {
  const r = [];
  const req = w.requested;
  const act = w.agg.activeSeconds || 0;
  const panelSecs = panelSecsOf(w);
  if (req.panel === 'open' && w.panelNodesAtStart < 1) r.push('panel node count 0 at window start');
  if (req.panel === 'open' && act > 0 && panelSecs < act * 0.9) r.push('panel not mounted on >10% of commit-active seconds');
  if (req.panel === 'closed' && w.panelNodesAtStart !== 0) r.push('panel still mounted in closed window');
  if (req.net === 'active' && w.derived.sessionFrames === 0) r.push('no session/* frames in an active-stream window');
  if (req.net === 'quiet' && w.derived.sessionFrames > 0) r.push('session/* frames present in a quiet window');
  if (w.elapsedMs < main.meta.windowMs * 0.9) r.push('window shorter than requested');
  return r;
}

const windows = main.windows.map((w) => {
  const reasons = validity(w);
  const a = w.agg, d = w.derived;
  return {
    name: w.name,
    requested: w.requested,
    activeSection: [w.activeSectionAtStart, w.activeSectionAtEnd],
    sectionAction: w.sectionAction,
    panelNodes: [w.panelNodesAtStart, w.panelNodesAtEnd],
    startIso: w.startIso, endIso: w.endIso, startEpochMs: w.startEpochMs, endEpochMs: w.endEpochMs, elapsedMs: w.elapsedMs,
    sampledSeconds: a.seconds, commitActiveSeconds: a.activeSeconds, panelMountedSeconds: panelSecsOf(w),
    wsPayloadTypes: a.ws,
    commits: a.commits,
    commitsPerSec: d.commitsPerSec,
    sessionFrames: d.sessionFrames,
    sessionFramesPerSec: d.sessionFramesPerSec,
    panelRootRenders: a.tgt.panel ? a.tgt.panel.id : 0,
    panelRootRenders_pwSignal: a.tgt.panel ? a.tgt.panel.pw : 0,
    settingsRootRenders: a.tgt.root ? a.tgt.root.id : 0,
    panelRendersPerCommit: d.panelCommitsPerCommit,
    panelRendersPerSessionFrame: d.panelCommitsPerSessionFrame,
    settingsSubtreeRenders: a.sub,
    settingsSubtreeRendersPerCommit: d.subRenderedPerCommit,
    settingsSubtreeFiberCount: a.subTotalMax,
    wholeTreeRendersPerCommit: d.wholeRenderedPerCommit,
    wholeTreeFiberCount: a.wholeTotalMax,
    ancestorChain: w.ancNames,
    ancestorChainRendersPerCommit: Object.fromEntries(Object.entries(a.chain).map(([i, c]) => [i, Math.round((c / a.commits) * 1000) / 1000])),
    topRenderingComponentsInsidePanel: Object.entries(a.subNames).sort((x, y) => y[1] - x[1]).slice(0, 14),
    sessionListAtStart: w.sessionListAtStart, sessionListAtEnd: w.sessionListAtEnd,
    valid: reasons.length === 0, invalidReasons: reasons,
    harnessValidityNotes: w.invalidReasons,
    error: w.error || null,
  };
});

const final = {
  generatedAt: new Date().toISOString(),
  host: {
    pid: 1390375,
    pidEvidence: 'ps -p 1390375 => node /home/CNS2026495165/.npm-global/bin/dsh web (ppid 1390374 = sh -c "dsh web"; 1390362 = npm exec @deepseek-ai/dsh web)',
    url: 'http://127.0.0.1:3080',
    bootRev: main.meta.boot.bootRev,
    bundleRevs: main.meta.boot.entries,
    bootEntryCount: main.meta.boot.entryCount,
    userAgent: main.meta.ua,
    headless: true,
    viewport: '1440x900',
    nodeVersion: main.meta.nodeVersion,
  },
  premiseSelfProof: {
    verdict: 'PASS',
    hookPreexisting: main.premise.hookPreexisting,
    reactVersionReportedByInject: main.premise.injected.map((i) => i.version),
    rendererPackageName: main.premise.injected.map((i) => i.rendererPackageName),
    bundleType: main.premise.injected.map((i) => i.bundleType),
    injectCalls: main.premise.hookCalls.inject,
    onCommitFiberRoot_atBoot: main.premise.hookCalls.onCommitFiberRoot,
    onCommitFiberRoot_total: main.hookCallsFinal.onCommitFiberRoot,
    onPostCommitFiberRoot_total: main.hookCallsFinal.onPostCommitFiberRoot,
    onCommitFiberUnmount_total: main.hookCallsFinal.onCommitFiberUnmount,
    note: 'react-dom 18.3.1 production build adopts the hook at module evaluation and calls onCommitFiberRoot on every commit; the CDP-Profiler fallback was therefore NOT required.',
    resolvedSettingsFiberChainFromPanelDom: ['host:div(dialog)', 'host:div(overlay)', 'SettingsPanel', 'SettingsRoot', 'RootEntry', 'SlotErrorBoundary', 'host:div', 'SlotOutlet', '...'],
    targetNamesResolved: { panel: 'SettingsPanel', root: 'SettingsRoot' },
  },
  sessionScaleN: {
    source: 'POST /api/session.list with envelope {type:"client-request",rpcId,method:"session.list",payload:{}}',
    samples: main.windows.map((w) => ({ window: w.name, start: w.sessionListAtStart && { items: w.sessionListAtStart.items, topLevel: w.sessionListAtStart.topLevel, subagents: w.sessionListAtStart.subagents, running: w.sessionListAtStart.running, withProjections: w.sessionListAtStart.withProjections } })),
  },
  windows,
  stateDependenceExperiment: {
    script: 'scripts/ab-diagnostic.mjs --slice=60000 (no CDP network calls)',
    note: 'Same page walked through four settings states, 60s each. All four share one code path except the panel state.',
    results: ab.results.map((s) => ({
      label: s.label, activeSection: s.section, commits: s.commits,
      panelRootRendersPerCommit: s.panelPerCommit,
      ancestorChainRendersPerCommit: s.chainPerCommit,
      settingsSubtreeRendersPerCommit: s.settingsSubtreePerCommit,
      wholeTreeRendersPerCommit: s.wholePerCommit,
      topRenderingComponentsInsidePanel: s.subNamesTop,
      wsPayloadTypes: s.ws,
      remountDetectors: { alternateNull: s.altNull, dialogDomReplaced: s.domReplaced, targetSetGrew: s.setGrew },
    })),
  },
  auxiliaryShortSliceExperiment: {
    script: 'scripts/debug-target.mjs (12s slices)',
    note: 'Short slices used only to characterise which settings states show a panel-root re-render; not part of the 60s window set.',
    results: dbg.slices.map((s) => ({ label: s.label, commits: s.agg.commits, panelRootRenders: s.agg.tgt.panel ? s.agg.tgt.panel.id : 0, settingsSubtreeRenders: s.agg.sub, wsPayloadTypes: s.agg.ws })),
  },
  quietIntervention: {
    method: 'CDP Network.emulateNetworkConditions({offline:true}) on the same page',
    reversible: true,
    productStateMutated: false,
    observedEffect: 'session/* frames drop to 0 and React commits drop to 0 for the whole window',
  },
  lock: lockrep,
  lockedBatch: {
    tag: 'locked',
    file: 'raw/measure-locked.json',
    verdict: 'INCONCLUSIVE (lock held for the whole session, but 18-31 foreign browsers from 7 concurrent research lines ran during every window; 0/5 windows were exclusive)',
    windows: locked.windows.map((w) => ({
      name: w.name, requested: w.requested, activeSection: w.activeSectionAtStart,
      lockHeld: !!(w.lockAtWindowStart && w.lockAtWindowStart.present),
      foreignBrowsers: [w.censusAtWindowStart && w.censusAtWindowStart.foreignCount, w.censusAtWindowEnd && w.censusAtWindowEnd.foreignCount],
      exclusive: false,
      startIso: w.startIso, endIso: w.endIso,
      commits: w.agg.commits, sessionFrames: w.derived.sessionFrames,
      panelRootRenders: w.agg.tgt && w.agg.tgt.panel ? w.agg.tgt.panel.id : 0,
      panelRendersPerCommit: w.derived.panelCommitsPerCommit,
      settingsSubtreeRendersPerCommit: w.derived.subRenderedPerCommit,
      ancestorChainRenders: w.agg.chain,
    })),
  },
  batchVerdicts: {
    batchA_preLock: { files: ['raw/measure-main.json', 'raw/ab-nocdp.json', 'raw/debug-plain.json'], lockHeld: false, verdict: 'INCONCLUSIVE' },
    batchB_locked: { files: ['raw/measure-locked.json'], lockHeld: true, exclusive: false, verdict: 'INCONCLUSIVE' },
    stillUsable: 'contention-robust structural and ratio findings only: panel renders per commit, settings-subtree renders per commit, ancestor-chain signal, zero-on-close, zero-on-quiet, payload-type distribution. Absolute rates are NOT usable as a baseline.',
  },
  discipline: {
    clickedSaveApplyDelete: false,
    modelSwitch: false,
    usageManualRefresh: false,
    allowedLocalUiStateUsed: ['open/close settings panel (trigger click, Escape)', 'switch settings nav section', 'CDP network emulation for the quiet control'],
    singleBrowserInstance: true,
    browsersClosed: true,
    probeLockAcquiredAtomically: true,
    probeLockAcquiredAt: '2026-09-21T15:17:26+08:00',
    probeLockReleasedAt: '2026-09-21T15:44:41+08:00',
    probeLockHeldSeconds: 1635,
    preemptionOccurred: false,
    preemptionNote: 'lock was free at first check; a single atomic mkdir succeeded, so the >25min stale-owner takeover rule was never triggered',
    lockViolatedByConcurrentLines: 7,
    exclusiveWindowsAchieved: '0/5',
    orphanBrowsersAfterRelease: 0,
    concurrentPeerBrowsersObserved: 'a peer agent ran its own Playwright/browser measurement against the same GUI during W1-W8 (ps showed measure-hardening/probes/harden-measure.mjs); it is a shared-host load condition, not a second instance of this harness',
  },
};
fs.writeFileSync(`${DIR}/raw/FINAL.json`, JSON.stringify(final, null, 2));
console.log('wrote raw/FINAL.json');
console.log('windows valid:', final.windows.filter((w) => w.valid).length, '/', final.windows.length);
for (const w of final.windows) console.log(' ', w.name, 'valid=' + w.valid, 'panelPerCommit=' + w.panelRendersPerCommit, 'subPerCommit=' + (Math.round(w.settingsSubtreeRendersPerCommit * 10) / 10));
