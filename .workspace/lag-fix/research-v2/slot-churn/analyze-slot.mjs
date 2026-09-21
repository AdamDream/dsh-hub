/*
 * slot-churn/analyze-slot.mjs — derive the audit tables + PASS/FAIL/INCONCLUSIVE
 * verdicts from the raw measurement JSON.
 *
 * Usage: node analyze-slot.mjs raw/slot-churn-main.json
 */
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2] || 'raw/slot-churn-main.json';
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const W = j.windows || [];

const n = (x, d = 2) => (typeof x === 'number' && isFinite(x) ? Number(x.toFixed(d)) : x);
const pct = (x) => (typeof x === 'number' ? n(x * 100, 1) + '%' : x);

const out = { file, generatedAt: new Date().toISOString(), premise: j.finalPremise, lock: j.lock, windows: [], verdicts: {} };

// ---------------------------------------------------------------- premise
const p = j.finalPremise || {};
out.premiseVerdict = {
  hookAdopted: (p.inject || 0) >= 1,
  injectCalls: p.inject,
  onCommitFiberRoot: p.onCommitFiberRoot,
  rendererPackageName: p.rendererPackageName,
  rendererVersion: p.rendererVersion,
  bundleType: p.bundleType,
  hookPreexisting: p.hookPreexisting,
  hostResolve: p.hostResolve,
  verdict: (p.inject || 0) >= 1 && (p.onCommitFiberRoot || 0) > 0 ? 'PASS' : 'FAIL',
};

// ---------------------------------------------------------------- per window
for (const w of W) {
  const cr = w.commitRecords || [];
  const chain = w.ancestorChain || [];
  out.windows.push({
    name: w.name,
    requested: w.requested,
    valid: w.valid,
    invalidReasons: w.invalidReasons,
    elapsedMs: w.elapsedMs,
    commits: w.commits,
    commitsPerSec: n(w.commitsPerSec),
    sessionFrames: w.sessionFrames,
    sessionFramesPerSec: n(w.sessionFramesPerSec),
    wsPayloadTypes: (() => {
      const acc = {};
      const before = w.wsBefore || [];
      const after = w.wsAfter || [];
      return { framesDelta: w.sessionFrames, note: 'see raw wsAfter/wsBefore for per-socket counts' };
    })(),
    ancestorChain: chain,
    ancestorRendersPerCommit: w.rendersPerCommit,
    ancestorRendersOverWindow: w.ancestorRendersOverWindow,
    ancestorPropsNewOverWindow: w.ancestorPropsNewOverWindow,
    hookStatsDelta: w.hookStatsDelta,
    settingsSubtree: {
      fiberCount: w.settingsSubtreeFiberCount,
      rendersPerCommit: n(w.settingsSubtreeRendersPerCommit),
      renders: w.settingsSubtreeRenders,
      hooksRan: w.settingsSubtreeHooksRan,
      top: (w.topRenderingInsidePanel || []).slice(0, 12),
    },
    dom: {
      stableCommits: w.domStableCommits,
      changedCommits: w.domChangedCommits,
      replacedCommits: w.domReplacedCommits,
      stableFraction: pct(w.domStableFraction),
    },
    versions: {
      transitions: w.versionTransitionCount,
      transitionsPerSec: n(w.versionTransitionsPerSec),
      transitionKeys: w.versionTransitionKeys,
      gaps: w.versionTransitionGapMs,
      gen: w.versionGen,
      commitsWithDelta: w.commitsWithVersionDelta,
      commitsWithoutDelta: w.commitsWithoutVersionDelta,
      deltaKeysOnCommits: w.versionDeltaKeysOnCommits,
      end: w.versionsEnd,
    },
    crossTab: {
      domStable: w.domStableCommits,
      noVersionDelta: w.commitsWithoutVersionDelta,
      pureNoChangeButPanelRendered: w.pureNoChangeButPanelRenderedCommits,
      pureNoChangeFraction: pct(w.pureNoChangeButPanelRenderedFraction),
    },
    coreHook: w.coreHook ? {
      installed: w.coreHook.installed, how: w.coreHook.how, err: w.coreHook.err,
      bumpsInWindow: w.coreHook.bumpsInWindow,
      notifyCountInWindow: w.coreHook.notifyCountInWindow,
      subscribeCountInWindow: w.coreHook.subscribeCountInWindow,
      getVersionCountInWindow: w.coreHook.getVersionCountInWindow,
      perKey: w.coreHook.perKey, perStack: w.coreHook.perStack, topNotifyStack: Object.entries(w.coreHook.perNotifyStack || {}).sort((a, b) => b[1] - a[1]).slice(0, 5),
      sampleBumps: (w.coreHook.bumps || []).slice(-4),
    } : null,
    hostResolve: w.hostResolve,
    errors: (w.errorsNow || []).slice(0, 5),
    error: w.error || null,
  });
}

// ---------------------------------------------------------------- global verdicts
const openWindows = W.filter((w) => w.requested && w.requested.panel === 'open');
const validOpen = openWindows.filter((w) => w.valid);
const closedWindows = W.filter((w) => w.requested && w.requested.panel === 'closed');
const allValidOpenCommits = validOpen.reduce((a, w) => a + (w.commits || 0), 0);
const allValidOpenDomStable = validOpen.reduce((a, w) => a + (w.domStableCommits || 0), 0);
const allValidOpenNoVer = validOpen.reduce((a, w) => a + (w.commitsWithoutVersionDelta || 0), 0);
const allValidOpenVerTrans = validOpen.reduce((a, w) => a + (w.versionTransitionCount || 0), 0);
const allValidOpenPure = validOpen.reduce((a, w) => a + (w.pureNoChangeButPanelRenderedCommits || 0), 0);
const totalElapsed = W.reduce((a, w) => a + (w.elapsedMs || 0), 0);

const verKeys = {};
for (const w of validOpen) for (const [k, v] of Object.entries(w.versionTransitionKeys || {})) verKeys[k] = (verKeys[k] || 0) + v;
const verKeysOnCommits = {};
for (const w of validOpen) for (const [k, v] of Object.entries(w.versionDeltaKeysOnCommits || {})) verKeysOnCommits[k] = (verKeysOnCommits[k] || 0) + v;

out.aggregate = {
  windowsTotal: W.length,
  openWindows: openWindows.length,
  validOpenWindows: validOpen.length,
  validClosedWindows: closedWindows.filter((w) => w.valid).length,
  totalSampledMs: totalElapsed,
  openSampledMs: openWindows.reduce((a, w) => a + (w.elapsedMs || 0), 0),
  commitsAll: W.reduce((a, w) => a + (w.commits || 0), 0),
  commitsValidOpen: allValidOpenCommits,
  versionTransitionsValidOpen: allValidOpenVerTrans,
  versionTransitionKeysValidOpen: verKeys,
  versionDeltaKeysOnCommitsValidOpen: verKeysOnCommits,
  domStableValidOpen: allValidOpenDomStable,
  commitsWithoutVersionDeltaValidOpen: allValidOpenNoVer,
  pureNoChangeButPanelRenderedValidOpen: allValidOpenPure,
  pureFractionValidOpen: allValidOpenCommits ? pct(allValidOpenPure / allValidOpenCommits) : null,
  panelRendersPerCommit: (() => {
    const per = {};
    for (const w of validOpen) for (const [k, v] of Object.entries(w.rendersPerCommit || {})) { per[k] = per[k] || []; per[k].push(v); }
    const avg = {};
    for (const k in per) avg[k] = n(per[k].reduce((a, b) => a + b, 0) / per[k].length, 3);
    return avg;
  })(),
  settingsSubtreeRendersPerCommit: (() => {
    const v = validOpen.map((w) => w.settingsSubtreeRendersPerCommit).filter((x) => typeof x === 'number');
    return v.length ? n(v.reduce((a, b) => a + b, 0) / v.length, 2) : null;
  })(),
  microScheduled: W.map((w) => ({ name: w.name, micro: w.microEnd })),
};

// V1: hook adopted in current build
out.verdicts.V1_premise_hook_adopted = out.premiseVerdict.verdict === 'PASS' ? 'PASS' : 'FAIL';
// V2: host (slot version source) reachable from page => versions actually readable
out.verdicts.V2_slot_versions_readable = (p.hostResolve && p.hostResolve.ok) ? 'PASS' : 'FAIL';
// V3: slot version churn, and whether it is a per-commit or a burst phenomenon
const bumpsValidOpen = validOpen.reduce((a, w) => a + ((w.coreHook && w.coreHook.bumpsInWindow) || 0), 0);
const notifyValidOpen = validOpen.reduce((a, w) => a + ((w.coreHook && w.coreHook.notifyCountInWindow) || 0), 0);
const getVerValidOpen = validOpen.reduce((a, w) => a + ((w.coreHook && w.coreHook.getVersionCountInWindow) || 0), 0);
out.aggregate.coreBumpsValidOpen = bumpsValidOpen;
out.aggregate.coreNotificationsValidOpen = notifyValidOpen;
out.aggregate.coreGetVersionCallsValidOpen = getVerValidOpen;
out.aggregate.coreBumpsPerCommit = allValidOpenCommits ? n(bumpsValidOpen / allValidOpenCommits, 4) : null;
if (!validOpen.length) out.verdicts.V3_version_churn_on_every_commit = 'INCONCLUSIVE (no valid open window)';
else if (bumpsValidOpen === 0 && allValidOpenVerTrans === 0) out.verdicts.V3_version_churn_on_every_commit = 'FAIL: 0 SlotCore.markDirty bumps in ' + allValidOpenCommits + ' commits => the slot version does NOT churn';
else out.verdicts.V3_version_churn_on_every_commit = 'PARTIAL/PASS: bumps=' + bumpsValidOpen + ' over ' + allValidOpenCommits + ' commits (' + n(bumpsValidOpen / Math.max(1, allValidOpenCommits), 4) + '/commit); see perStack attribution';
// V3b: fraction of open-window commits that carried NO version delta yet re-rendered the panel
out.verdicts.V3b_panel_rerenders_without_version_delta = allValidOpenCommits
  ? (allValidOpenNoVer / allValidOpenCommits > 0.5 ? 'PASS (majority of commits re-render the panel with NO slot-version change => not version-driven per commit)' : 'FAIL (version delta present on most commits)')
  : 'INCONCLUSIVE';
// V4: settings panel re-renders 1:1 with commits (reproduce the prior line)
const firstChainName = (validOpen[0] && validOpen[0].ancestorChain && validOpen[0].ancestorChain[0]) || null;
out.verdicts.V4_panel_root_renders_per_commit = (() => {
  if (!validOpen.length) return 'INCONCLUSIVE';
  const v = validOpen.map((w) => w.panelRendersPerCommit).filter((x) => typeof x === 'number');
  if (!v.length) return 'INCONCLUSIVE';
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  return `PANEL_ROOT=${firstChainName} renders/commit avg=${n(avg, 3)} => ${avg > 0.9 ? 'PASS 1:1 reproduced' : avg > 0.3 ? 'PARTIAL' : 'FAIL'}`;
})();
// V5: closed control => panel chain gone (0 renders) while commits continue
out.verdicts.V5_closed_control = (() => {
  const v = closedWindows.filter((w) => w.valid);
  if (!v.length) return 'INCONCLUSIVE (no valid closed window)';
  return v.map((w) => `${w.name}: commits=${w.commits} panelChain=${JSON.stringify(Object.keys(w.rendersPerCommit || {}))}`).join(' | ');
})();

fs.writeFileSync(path.join(path.dirname(file), 'summary-' + path.basename(file)), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
