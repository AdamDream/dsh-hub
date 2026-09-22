#!/usr/bin/env node
/*
 * campaign.mjs — acquires the shared probe lock ONCE and runs every
 * minimal-page measurement phase inside that single hold.
 *
 * Why one hold instead of one hold per phase: measured on this host the lock is
 * re-acquired within seconds by sibling lines, so a per-phase acquisition loop
 * spends most of its wall time sleeping between retries and can starve outright
 * (observed: 7 consecutive 20-40 s retries lost). A single bounded hold is both
 * more likely to succeed and less thrashing for the other lines. The hold is
 * hard-capped (--maxhold, default 30 min) and released in a finally block, also
 * on SIGINT/SIGTERM, so the lock can never be leaked.
 *
 * It never kills or restarts anything; each phase is a child `measure.mjs
 * --nolock` process that launches exactly one browser at a time.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock, releaseLock, lockStatus } from './lib/lock.mjs';
import { browserCensus, loadAvg } from './lib/census.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const hit = argv.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  if (!hit) return d;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};
const PHASESEL = String(flag('phases', 'matrix'));
const MAXHOLD_MIN = Number(flag('maxhold', 30));
const LOCKWAIT_MIN = Number(flag('lockwait', 45));
const TAG = String(flag('tag', 'm1'));

const PHASES = {
  'smoke': [
    ['--mode=headless', '--cells=idle-floor,dom-transform', '--reps=1', '--settle=800', `--tag=smoke`],
  ],
  'matrix': [
    ['--mode=headless', '--all', '--reps=3', `--tag=${TAG}h`],
    ['--mode=headed', '--all', '--reps=3', '--order=cellmajor', '--reuse=1', `--tag=${TAG}d`],
  ],
  'trace': [
    ['--mode=headless', '--cells=idle-floor,dom-transform,dom-lefttop,hover-tray,hover-blur,extreme-dom', '--reps=2', '--trace=1', `--tag=${TAG}t1`],
    ['--mode=headed', '--cells=idle-floor,dom-transform,dom-lefttop,hover-tray,hover-blur,extreme-dom', '--reps=2', '--trace=1', '--order=cellmajor', '--reuse=1', `--tag=${TAG}t2`],
  ],
  'gpu': [
    ['--mode=headless', '--cells=dom-transform,canvas,hover-tray', '--reps=2', '--gpu=off', `--tag=${TAG}g1h`],
    ['--mode=headless', '--cells=dom-transform,canvas,hover-tray', '--reps=2', '--gpu=swiftshader', `--tag=${TAG}g2h`],
    ['--mode=headed', '--cells=dom-transform,canvas,hover-tray', '--reps=2', '--gpu=off', '--order=cellmajor', '--reuse=1', `--tag=${TAG}g3d`],
    ['--mode=headed', '--cells=dom-transform,canvas,hover-tray', '--reps=2', '--gpu=gpuraster', '--order=cellmajor', '--reuse=1', `--tag=${TAG}g4d`],
  ],
  'dsh': [
    ['--target=dsh', '--mode=headless', '--reps=1', '--settle=2500', `--tag=dsh1`],
  ],
};

const sel = PHASESEL.split(',');
const list = sel.flatMap((s) => PHASES[s] || []);
if (!list.length) { console.error(`no phases selected (${PHASESEL}); known: ${Object.keys(PHASES)}`); process.exit(2); }

const logfile = path.join(HERE, 'logs', `campaign-${sel.join('_')}.log`);
fs.mkdirSync(path.dirname(logfile), { recursive: true });
function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}`;
  console.log(line);
  try { fs.appendFileSync(logfile, line + '\n'); } catch { }
}

function runPhase(args) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [path.join(HERE, 'measure.mjs'), '--nolock', ...args], {
      cwd: HERE, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => process.stdout.write(d));
    child.stderr.on('data', (d) => process.stderr.write(d));
    const killer = setTimeout(() => {
      log(`phase ${args.join(' ')} exceeded its slice; terminating the child (own process only)`);
      child.kill('SIGTERM');
    }, 12 * 60 * 1000);
    child.on('exit', (code, sig) => {
      clearTimeout(killer);
      resolve({ code, sig, ms: Date.now() - t0 });
    });
  });
}

let lock = null;
let holdTimer = null;
const release = (why) => {
  if (lock && lock.token) {
    log(`releasing lock (${why})`);
    releaseLock(lock.token, log);
    lock = null;
  }
};
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { log(`caught ${sig}; releasing lock and exiting`); release(sig); process.exit(130); });
}

(async () => {
  log(`campaign start phases=${sel.join(',')} tag=${TAG} load=${JSON.stringify(loadAvg())} census=${JSON.stringify({ f: browserCensus().foreignInstanceTotal })}`);
  lock = await acquireLock({
    agent: 'incident2-minimal-page (single-hold campaign)',
    line: `label=${TAG} phases=${sel.join('+')}`,
    purpose: 'one bounded hold covering the whole minimal-page measurement matrix',
    log, maxWaitMs: LOCKWAIT_MIN * 60 * 1000,
    note: 'single browser at a time; releases with rm owner.txt && rmdir; hard cap ' + MAXHOLD_MIN + 'min',
  });
  if (!lock.ok) { log(`lock not acquired (${lock.reason}); aborting campaign`); process.exit(3); }

  holdTimer = setTimeout(() => {
    log(`hard hold cap ${MAXHOLD_MIN}min reached; releasing and aborting remaining phases`);
    release('hard-cap');
    process.exit(4);
  }, MAXHOLD_MIN * 60 * 1000);

  const results = [];
  let failedPhases = 0;
  for (const args of list) {
    log(`--- phase begin: ${args.join(' ')} | load=${JSON.stringify(loadAvg())} foreignNow=${browserCensus().foreignInstanceTotal}`);
    const r = await runPhase(args);
    log(`--- phase end: ${args.join(' ')} exit=${r.code} sig=${r.sig || '-'} in ${(r.ms / 1000).toFixed(1)}s`);
    results.push({ args, ...r });
    // Fail-fast: a phase whose runs ALL errored means the harness itself is broken,
    // so continuing would only burn the lock hold producing useless data.
    const tagArg = (args.find((a) => a.startsWith('--tag=')) || '').slice(6);
    let stats = null;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(HERE, 'raw', `${tagArg}-summary.json`), 'utf8'));
      stats = { runs: s.results.length, errored: s.results.filter((x) => x.error).length };
    } catch { }
    if (stats) log(`   ${tagArg}: ${stats.runs} runs, ${stats.errored} errored`);
    if (r.code !== 0 || (stats && stats.runs > 0 && stats.errored === stats.runs)) {
      failedPhases++;
      if (failedPhases >= 1 && (!stats || stats.errored === stats.runs)) {
        log(`phase ${tagArg} produced NO usable runs; aborting the campaign to free the lock`);
        break;
      }
    }
  }
  clearTimeout(holdTimer);
  release('campaign finished');
  fs.writeFileSync(path.join(HERE, 'logs', `campaign-${sel.join('_')}-result.json`),
    JSON.stringify({ tag: TAG, phases: sel, maxHoldMin: MAXHOLD_MIN, results, finishedAt: new Date().toISOString() }, null, 1));
  log(`campaign done: ${results.length} phases`);
  process.exit(0);
})();
