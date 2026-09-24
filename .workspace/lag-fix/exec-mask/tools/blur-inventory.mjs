/*
 * blur-inventory.mjs — provenance proof for the exec-mask fix.
 *
 * Answers, AT RUNTIME and arm-to-arm on the same page state:
 *   (1) which elements in the document actually carry a non-none computed
 *       backdrop-filter, with geometry / position / z-index / area (CSS px and
 *       device px) and whether they are contained in the settings overlay;
 *   (2) what document.querySelector('div[class$="_mask"]') actually returns and
 *       whether it is the SAME NODE as the element carrying class exactly
 *       `VOzbGW_mask` (this is the audit's carrier selector; if it had resolved
 *       to a different node the fix would be aimed at the wrong element);
 *   (3) whether the candidate is scoped: the mask's computed backdrop-filter
 *       becomes `none` while every OTHER element's backdrop-filter is unchanged
 *       (asserted with a whole-document hash over (domPath, backdropFilter,
 *       webkitBackdropFilter), both including and excluding the mask path);
 *   (4) the injected CSS module style tag — presence, identity and the exact
 *       `.VOzbGW_mask{…}` rule text in each arm.
 *
 * Instrument notes: the readiness predicate, the settings trigger / panel / nav
 * cell / tab selectors and the route-interception code are the SAME ones used by
 * tools/panel-compare.mjs (which are the audit's), so this is the same app state
 * and the same interception channel as the judged campaign. No in-page probe is
 * installed here on purpose: this file must be able to disagree with the probe.
 *
 * usage (wrap with tools/blur-inventory.sh so the shared lock is held):
 *   node tools/blur-inventory.mjs --bundlePatch <candidate> --arms normal,patch \
 *        --vw 2560 --vh 1440 --dsf 2 --run blurinv
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/exec-mask';
const RAW = path.join(DIR, 'raw', 'harness');
const LOGS = path.join(DIR, 'logs');
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const ARMS = argOf('--arms', 'normal,patch').split(',').map((s) => s.trim()).filter(Boolean);
const VW = Number(argOf('--vw', '2560'));
const VH = Number(argOf('--vh', '1440'));
const DSF = Number(argOf('--dsf', '2'));
const RUN = argOf('--run', 'blurinv');
const BUNDLE_PATH = '/plugins/@deepseek-ai/dsh-client-ui-settings-general/client.js';
const URL_ = process.env.DSH_URL || 'http://127.0.0.1:3080';
const BUNDLE_RE = /\/plugins\/@deepseek-ai\/dsh-client-ui-settings-general\/client\.js/;
const BUNDLE_PATCH = argOf('--bundlePatch', null);
const PATCH_BYTES = BUNDLE_PATCH ? fs.readFileSync(BUNDLE_PATCH) : null;
const PATCH_SHA = PATCH_BYTES ? crypto.createHash('sha256').update(PATCH_BYTES).digest('hex') : null;
const PREIMAGE_SHA = (() => { try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(DIR, 'preimage', 'client.js.pre'))).digest('hex'); } catch { return null; } })();
const STYLE_SEL = 'style[data-plugin-css="@deepseek-ai/dsh-client-ui-settings-general/SettingsRoot.module.css"]';
const PREIMAGE_RULE = '.VOzbGW_mask{background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur);position:absolute;inset:0}';
const PATCHED_RULE = '.VOzbGW_mask{background:var(--dsw-alias-bg-mask-1);position:absolute;inset:0}';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logLines = [];
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); logLines.push(l); };
const r2 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 100) / 100);

// The audit's readiness predicate, verbatim (panel-compare.mjs READY_FN).
const READY_FN = `() => {
  if (document.querySelector('[data-dsh-boot]')) return false;
  if (!window.__DSH_BOOT__) return false;
  if (!window.__ModuleLoader__ || window.__ModuleLoader__.mode !== 'live') return false;
  var t = document.querySelector('div[class$="_settingsArea"] button[aria-haspopup="dialog"]');
  var tree = document.querySelector('div[role="tree"]');
  if (!t || !tree) return false;
  if (!tree.querySelector('[role="treeitem"][aria-expanded]')) return false;
  return true;
}`;
const SEL = {
  trigger: 'div[class$="_settingsArea"] button[aria-haspopup="dialog"]',
  panel: 'div.VOzbGW_panel[role="dialog"][aria-modal="true"]',
  navCells: 'div[class$="_navList"] button',
  tabs: 'button[class$="_tab"]',
};

// --------------------------------------------------------------- in-page part
function inventoryFn(state) {
  const dpr = window.devicePixelRatio;
  const r2 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 100) / 100);
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const domPath = (el) => {
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && n !== document.documentElement) {
      const p = n.parentElement;
      if (!p) break;
      parts.unshift(Array.prototype.indexOf.call(p.children, n));
      n = p;
    }
    return parts.join('/');
  };
  const cls = (el) => (typeof el.className === 'string' ? el.className : (el.getAttribute('class') || ''));
  const maskExact = document.querySelector('div.VOzbGW_mask');
  const maskSel = document.querySelector('div[class$="_mask"]');
  const panel = document.querySelector('div.VOzbGW_panel');
  const maskPath = maskExact ? domPath(maskExact) : null;

  // ---- (1) every element whose computed backdrop-filter is not none
  const all = document.getElementsByTagName('*');
  const hits = [];
  let fnvAll = 0x811c9dc5, fnvNoMask = 0x811c9dc5, examined = 0;
  const fnv = (h, s) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; } return h >>> 0; };
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    let cs;
    try { cs = getComputedStyle(el); } catch { continue; }
    const bf = cs.backdropFilter || null;
    const wbf = cs.webkitBackdropFilter || null;
    const p = domPath(el);
    const row = `${p}|${bf}|${wbf}`;
    fnvAll = fnv(fnvAll, row);
    if (p !== maskPath) fnvNoMask = fnv(fnvNoMask, row);
    examined++;
    if ((bf && bf !== 'none') || (wbf && wbf !== 'none')) {
      const r = rectOf(el);
      hits.push({
        domPath: p, tagName: el.tagName, className: cls(el), classAttrEndsWith_mask: /_mask$/.test(el.getAttribute('class') || ''),
        classList: Array.prototype.slice.call(el.classList), id: el.id || null,
        rect: { x: r2(r.x), y: r2(r.y), w: r2(r.w), h: r2(r.h) },
        areaCssPx: r2(r.w * r.h), areaDevicePx: r2(r.w * r.h * dpr * dpr),
        position: cs.position, zIndex: cs.zIndex, display: cs.display, opacity: cs.opacity,
        filter: cs.filter, willChange: cs.willChange, transform: cs.transform === 'none' ? 'none' : 'set',
        background: cs.background, backgroundColor: cs.backgroundColor, inset: `${cs.top} ${cs.right} ${cs.bottom} ${cs.left}`,
        backdropFilter: bf, webkitBackdropFilter: wbf,
        containsMask: !!(maskExact && el.contains(maskExact)), isMask: el === maskExact, isMaskSelMatch: el === maskSel,
        inSettingsPanel: !!(panel && (panel === el || panel.contains(el))),
        inOverlayRoot: !!(maskExact && maskExact.parentElement && (maskExact.parentElement === el || maskExact.parentElement.contains(el))),
        inMaskSubtree: !!(maskExact && (maskExact === el || maskExact.contains(el))),
        parent: el.parentElement ? `${el.parentElement.tagName.toLowerCase()}.${cls(el.parentElement)}` : null,
        ancestorChain: (() => { const c = []; let n = el; for (let k = 0; k < 4 && n && n.nodeType === 1; k++) { c.push(`${n.tagName.toLowerCase()}${cls(n) ? '.' + cls(n).split(/\s+/).join('.') : ''}`); n = n.parentElement; } return c; })(),
      });
    }
  }

  // ---- (2) selector resolution / naming-scheme discrimination
  const selMatches = Array.prototype.map.call(document.querySelectorAll('div[class$="_mask"]'), (el) => ({ className: cls(el), domPath: domPath(el), tagName: el.tagName, rect: rectOf(el), backdropFilter: getComputedStyle(el).backdropFilter }));
  const exactMatches = Array.prototype.map.call(document.querySelectorAll('div.VOzbGW_mask'), (el) => ({ className: cls(el), domPath: domPath(el), rect: rectOf(el), backdropFilter: getComputedStyle(el).backdropFilter }));
  const schemeSurvey = [];
  const schemeCounts = { preimage_scheme_PREFIX_name: 0, shell_scheme_name_hash: 0, other_mask_class: 0 };
  for (let i = 0; i < all.length && schemeSurvey.length < 60; i++) {
    const el = all[i];
    const tokens = Array.prototype.slice.call(el.classList);
    for (const t of tokens) {
      if (!/mask/i.test(t)) continue;
      let scheme;
      if (/^[A-Za-z0-9]+_mask$/.test(t)) { scheme = 'preimage_scheme_PREFIX_name'; schemeCounts.preimage_scheme_PREFIX_name++; }
      else if (/_mask_[a-z0-9]+_\d+$/.test(t)) { scheme = 'shell_scheme_name_hash'; schemeCounts.shell_scheme_name_hash++; }
      else { scheme = 'other_mask_class'; schemeCounts.other_mask_class++; }
      schemeSurvey.push({ domPath: domPath(el), tagName: el.tagName, token: t, className: cls(el),
                          classAttrEndsWith_mask: /_mask$/.test(el.getAttribute('class') || ''),
                          matchedByAuditSelector: el === maskSel, scheme });
    }
  }
  const auditSelectorMatchCount = Array.prototype.filter.call(all, (el) => /_mask$/.test(el.getAttribute('class') || '')).length;

  // ---- (3) style tag identity + exact rule text
  const styleTags = Array.prototype.map.call(document.querySelectorAll('style'), (st) => ({
    plugin: st.dataset ? st.dataset.plugin || null : null,
    pluginCss: st.dataset ? st.dataset.pluginCss || null : null,
    textLength: (st.textContent || '').length,
    hasVOzbGWmask: /\.VOzbGW_mask\{/.test(st.textContent || ''),
    ruleText: (() => { const m = /\.VOzbGW_mask\{[^}]*\}/.exec(st.textContent || ''); return m ? m[0] : null; })(),
    hasBackdropFilterDeclInMaskRule: /\.VOzbGW_mask\{[^}]*backdrop-filter/.test(st.textContent || ''),
  }));
  const wanted = document.querySelector('style[data-plugin-css="@deepseek-ai/dsh-client-ui-settings-general/SettingsRoot.module.css"]');
  const ruleText = wanted ? (() => { const m = /\.VOzbGW_mask\{[^}]*\}/.exec(wanted.textContent || ''); return m ? m[0] : null; })() : null;

  return {
    state,
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr },
    examinedElements: examined,
    fnvAllElements: fnvAll.toString(16),
    fnvExcludingMaskPath: fnvNoMask.toString(16),
    maskPath,
    nonNoneBackdropFilterCount: hits.length,
    hits,
    selectorResolution: {
      auditSelector: 'div[class$="_mask"]',
      auditSelectorReturns: maskSel ? { tagName: maskSel.tagName, className: cls(maskSel), domPath: domPath(maskSel), backdropFilter: getComputedStyle(maskSel).backdropFilter } : null,
      auditSelectorMatchCount,
      auditSelectorMatches: selMatches,
      exactClassMatches: exactMatches,
      sameNodeAsVozbGWMask: !!(maskSel && maskExact && maskSel === maskExact),
      exactClassNodeCount: exactMatches.length,
      maskRect: maskExact ? rectOf(maskExact) : null,
      overlayRoot: maskExact && maskExact.parentElement ? { tagName: maskExact.parentElement.tagName, className: cls(maskExact.parentElement), domPath: domPath(maskExact.parentElement), childCount: maskExact.parentElement.children.length, children: Array.prototype.map.call(maskExact.parentElement.children, (c) => `${c.tagName.toLowerCase()}.${cls(c)}`) } : null,
      overlapOfPanel: (() => { if (!maskExact || !panel) return null; const a = maskExact.getBoundingClientRect(), b = panel.getBoundingClientRect(); return { maskArea: r2(a.width * a.height), panelArea: r2(b.width * b.height), ratio: r2((a.width * a.height) / (b.width * b.height)) }; })(),
      maskTokenValue: maskExact ? getComputedStyle(maskExact).getPropertyValue('--dsw-mask-blur').trim() : null,
      maskComputedBackdropFilter: maskExact ? getComputedStyle(maskExact).backdropFilter : null,
      maskComputedWebkitBackdropFilter: maskExact ? (getComputedStyle(maskExact).webkitBackdropFilter || null) : null,
      maskBackground: maskExact ? getComputedStyle(maskExact).background : null,
      namingSchemeSurvey: schemeSurvey,
      namingSchemeCounts: schemeCounts,
    },
    styleTag: {
      requestedSelector: 'style[data-plugin-css="@deepseek-ai/dsh-client-ui-settings-general/SettingsRoot.module.css"]',
      found: !!wanted,
      dataset: wanted ? { plugin: wanted.dataset.plugin || null, pluginCss: wanted.dataset.pluginCss || null } : null,
      ruleText,
      hasBackdropFilterDeclInMaskRule: ruleText ? /backdrop-filter/.test(ruleText) : null,
      allStyleTags: styleTags,
    },
  };
}

// ------------------------------------------------------------------- main
async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  fs.mkdirSync(LOGS, { recursive: true });
  const stamp = new Date().toISOString();
  log(`run=${RUN} arms=${ARMS.join('>')} vp=${VW}x${VH}@${DSF} bundlePatch=${BUNDLE_PATCH || 'none'} sha=${PATCH_SHA ? PATCH_SHA.slice(0, 12) : '-'} preimage=${PREIMAGE_SHA ? PREIMAGE_SHA.slice(0, 12) : '-'} lock=${process.env.PANEL_LOCK_PRECLAIMED === '1' ? 'preclaimed' : 'NOT-HELD'}`);
  log(`CMD: ${process.argv.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
  if (process.env.PANEL_LOCK_PRECLAIMED !== '1') log('WARNING: lock is not preclaimed — this run expects tools/blur-inventory.sh to hold it');

  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-renderer-accessibility'] });
  log(`launched chrome-headless version=${browser.version()}`);
  const results = {};
  for (const arm of ARMS) {
    const interceptions = [];
    const context = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DSF, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
    if (PATCH_BYTES && arm === 'patch') {
      await context.route(BUNDLE_RE, async (route) => {
        const req = route.request();
        interceptions.push({ url: req.url(), method: req.method(), resourceType: req.resourceType(), bytes: PATCH_BYTES.length, sha256: PATCH_SHA });
        log(`  [intercept] ${req.method()} ${req.resourceType()} ${req.url()} -> ${PATCH_BYTES.length} B sha256=${PATCH_SHA.slice(0, 12)}…`);
        await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: PATCH_BYTES });
      });
    }
    const page = await context.newPage();
    await page.addInitScript({ content: `window.__blurInventory = ${inventoryFn.toString()};` });
    const out = { run: RUN, arm, viewport: [VW, VH], dsf: DSF, startedAt: new Date().toISOString(), states: {}, interceptions };
    try {
      await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(READY_FN, null, { timeout: 90000 });
      await sleep(400);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const clickSel = async (sel) => { const l = page.locator(sel).first(); await l.waitFor({ state: 'visible', timeout: 10000 }); await l.click({ timeout: 10000 }); };
      const clickNav = async (label) => { const l = page.locator(SEL.navCells).filter({ hasText: label }).first(); await l.waitFor({ state: 'visible', timeout: 10000 }); await l.click({ timeout: 10000 }); };
      const clickTab = async (label) => { const l = page.locator('button[class$="_tab"]:visible').filter({ hasText: label }).first(); await l.waitFor({ state: 'visible', timeout: 10000 }); await l.click({ timeout: 10000 }); };
      const findScrollable = () => page.evaluate(() => {
        const panel = document.querySelector('div.VOzbGW_panel');
        if (!panel) return null;
        const all = panel.getElementsByTagName('*');
        let best = null;
        for (let i = 0; i < all.length; i++) { const e = all[i]; if (e.scrollHeight > e.clientHeight + 24 && e.clientHeight > 60) { if (!best || e.clientHeight > best.clientH) best = { el: e, clientH: e.clientHeight }; } }
        if (!best) return null;
        const r = best.el.getBoundingClientRect();
        return { cls: String(best.el.className), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(r.height / 2, 120)) };
      });
      const capture = async (state) => {
        const inv = await page.evaluate((s) => window.__blurInventory ? window.__blurInventory(s) : null, state);
        out.states[state] = inv;
        const sr = inv.selectorResolution;
        log(`  [${arm}] ${state.padEnd(26)} nonNone=${inv.nonNoneBackdropFilterCount} maskSel="${sr.auditSelectorReturns ? sr.auditSelectorReturns.className : 'null'}" sameNodeAsVOzbGW_mask=${sr.sameNodeAsVozbGWMask} maskBF=${JSON.stringify(sr.maskComputedBackdropFilter)} rule=${inv.styleTag.ruleText ? (inv.styleTag.hasBackdropFilterDeclInMaskRule ? 'PREIMAGE(with backdrop-filter)' : 'PATCHED(no backdrop-filter)') : 'no rule'}`);
        return inv;
      };

      await clickSel(SEL.trigger);
      await page.waitForSelector(SEL.panel, { state: 'visible', timeout: 15000 });
      await sleep(3000);
      await capture('open-general-scroll0');          // 通用设置 (default at open), scroll 0
      await clickNav('插件');
      await sleep(3000);
      await capture('nav-plugins-scroll0');
      await clickTab('插件列表');
      await sleep(3000);
      await capture('tab-pluginslist');
      const si = await findScrollable();
      if (si) { await page.mouse.move(si.x, si.y); for (let k = 0; k < 6; k++) { await page.mouse.wheel(0, 300); await sleep(80); } await sleep(1200); }
      await capture('tab-pluginslist-scrolled');
      // bundle identity from inside the page (post-measurement)
      out.servedBundle = await page.evaluate(async (u) => {
        const r = await fetch(u, { cache: 'no-store' });
        const b = await r.arrayBuffer();
        const d = await crypto.subtle.digest('SHA-256', b);
        return { status: r.status, bytes: b.byteLength, sha256: [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('') };
      }, URL_ + BUNDLE_PATH).catch((e) => ({ error: String(e) }));
      out.bundleVerdict = arm === 'patch'
        ? (out.servedBundle && out.servedBundle.sha256 === PATCH_SHA ? 'PATCH-SERVED' : 'PATCH-NOT-SERVED')
        : (out.servedBundle && PREIMAGE_SHA && out.servedBundle.sha256 === PREIMAGE_SHA ? 'PREIMAGE-SERVED' : 'UNEXPECTED-BUNDLE');
      log(`${arm}: servedBundle=${out.servedBundle && (out.servedBundle.sha256 || out.servedBundle.error)} verdict=${out.bundleVerdict}`);
    } catch (e) {
      out.error = String(e).split('\n').slice(0, 4).join(' | ');
      log(`${arm} ERROR: ${out.error}`);
      try { await page.screenshot({ path: path.join(LOGS, `${RUN}-${arm}-error.png`) }); } catch {}
    } finally {
      results[arm] = out;
      const f = path.join(RAW, `blur-inventory-${arm}.json`);
      fs.writeFileSync(f, JSON.stringify(out, null, 2));
      log(`wrote ${f}`);
      try { await context.close(); } catch {}
    }
  }
  // ---- arm-to-arm comparison, same page state
  const cmp = { run: RUN, generatedAt: new Date().toISOString(), viewport: [VW, VH], dsf: DSF, preimageRule: PREIMAGE_RULE, patchedRule: PATCHED_RULE, states: {} };
  if (results.normal && results.patch) {
    for (const state of Object.keys(results.normal.states)) {
      const a = results.normal.states[state], b = results.patch.states[state];
      if (!a || !b) { cmp.states[state] = { error: 'state missing in one arm', hasNormal: !!a, hasPatch: !!b }; continue; }
      const aHits = new Map(a.hits.map((h) => [h.domPath, h]));
      const bHits = new Map(b.hits.map((h) => [h.domPath, h]));
      const paths = [...new Set([...aHits.keys(), ...bHits.keys()])];
      const perElement = paths.map((p) => {
        const ha = aHits.get(p), hb = bHits.get(p);
        return {
          domPath: p, className: (ha || hb).className, isMask: !!(ha && ha.isMask) || !!(hb && hb.isMask),
          normalBackdropFilter: ha ? ha.backdropFilter : '(element had none)',
          patchBackdropFilter: hb ? hb.backdropFilter : '(element had none)',
          same: (ha ? ha.backdropFilter : 'none') === (hb ? hb.backdropFilter : 'none'),
          areaDevicePx: (ha || hb).areaDevicePx, rect: (ha || hb).rect,
        };
      });
      const nonMask = perElement.filter((x) => !x.isMask);
      cmp.states[state] = {
        nonNoneCountNormal: a.nonNoneBackdropFilterCount,
        nonNoneCountPatch: b.nonNoneBackdropFilterCount,
        maskNode: { normal: a.selectorResolution.auditSelectorReturns, patch: b.selectorResolution.auditSelectorReturns, sameNodeAsVozbGWMask: [a.selectorResolution.sameNodeAsVozbGWMask, b.selectorResolution.sameNodeAsVozbGWMask] },
        maskBackdropFilter: { normal: a.selectorResolution.maskComputedBackdropFilter, patch: b.selectorResolution.maskComputedBackdropFilter },
        everyOtherElementUnchanged: nonMask.every((x) => x.same),
        changedNonMaskElements: nonMask.filter((x) => !x.same),
        examinedElements: [a.examinedElements, b.examinedElements],
        fnvAllElements: [a.fnvAllElements, b.fnvAllElements],
        fnvExcludingMaskPath: [a.fnvExcludingMaskPath, b.fnvExcludingMaskPath],
        wholeDocumentBackdropFilterLandscapeIdenticalExceptMask: a.fnvExcludingMaskPath === b.fnvExcludingMaskPath,
        ruleText: { normal: a.styleTag.ruleText, patch: b.styleTag.ruleText },
        ruleMatchesExpectedPreimage: a.styleTag.ruleText === PREIMAGE_RULE,
        ruleMatchesExpectedPatched: b.styleTag.ruleText === PATCHED_RULE,
        styleTagFound: [a.styleTag.found, b.styleTag.found],
        perElement,
      };
      log(`compare ${state}: maskBF ${JSON.stringify(cmp.states[state].maskBackdropFilter.normal)} -> ${JSON.stringify(cmp.states[state].maskBackdropFilter.patch)}; everyOtherUnchanged=${cmp.states[state].everyOtherElementUnchanged}; landscapeExceptMaskIdentical=${cmp.states[state].wholeDocumentBackdropFilterLandscapeIdenticalExceptMask}; rule preimage=${cmp.states[state].ruleMatchesExpectedPreimage} patched=${cmp.states[state].ruleMatchesExpectedPatched}`);
    }
  }
  const cf = path.join(RAW, 'blur-inventory-compare.json');
  fs.writeFileSync(cf, JSON.stringify(cmp, null, 2));
  log(`wrote ${cf}`);
  fs.writeFileSync(path.join(LOGS, `blur-inventory-${RUN}-${stamp.replace(/[:.]/g, '').slice(0, 15)}.log`), logLines.join('\n') + '\n');
  await browser.close();
  return 0;
}
main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
