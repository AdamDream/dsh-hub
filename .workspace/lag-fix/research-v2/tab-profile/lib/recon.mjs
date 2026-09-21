/*
 * RECON (read-only): learn the real shapes before building the measurement harness.
 *
 * Answers, empirically, against the already-running GUI at 127.0.0.1:3080:
 *   A. which click target opens the settings surface, and does [role=dialog] exist
 *   B. what the settings nav items look like (tag / role / attributes / text)
 *   C. candidate "panel" containers and their node counts (panel must self-prove mounted)
 *   D. what HTTP calls the RPC layer actually issues (URL shape + body shape), esp. /usage
 *   E. the real WS frame envelope + payload discriminator shape
 *
 * Observation only. No product file, config, or host process is touched.
 */
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const URL_ = 'http://127.0.0.1:3080';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/tab-profile/raw';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KNOWN_MUX = ['session/event', 'session/subscribed', 'approval/requested', 'approval/resolved',
  'question/requested', 'question/resolved', 'session/queue', 'session/jobs', 'session/projection', 'stream/error'];
const KNOWN_HOST = ['host/session-added', 'host/session-removed', 'host/session-status', 'host/agent-error',
  'host/workspace-changed', 'host/workspace-removed', 'host/workspace-order-changed',
  'host/archived-sessions-changed', 'host/remote-event'];
const ENVELOPES = ['client-request', 'client-response', 'server-request', 'server-response'];

function classify(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return { envelope: 'unparseable', payloadType: 'unparseable' }; }
  const envelope = ENVELOPES.includes(msg.type) ? msg.type : `other:${String(msg.type).slice(0, 40)}`;
  const pl = msg.payload;
  let payloadType = null;
  if (msg.type === 'server-request' && pl && typeof pl === 'object') {
    payloadType = typeof pl.type === 'string' ? pl.type
      : (typeof pl.method === 'string' ? `method:${pl.method}` : 'no-discriminator');
  } else if (msg.type === 'client-request') {
    payloadType = typeof msg.method === 'string' ? `method:${msg.method}` : 'no-method';
  }
  return { envelope, payloadType };
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-precise-memory-info',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);

  const report = { meta: { url: URL_, at: new Date().toISOString(), headless: true } };

  // ---- raw WS capture via CDP (authoritative: does not depend on page patching)
  const wsFrames = [];
  const wsSockets = [];
  await cdp.send('Network.enable', { maxTotalBufferSize: 100 * 1024 * 1024, maxResourceBufferSize: 50 * 1024 * 1024 });
  cdp.on('Network.webSocketCreated', (e) => wsSockets.push({ requestId: e.requestId, url: e.url, at: Date.now() }));
  cdp.on('Network.webSocketFrameReceived', (e) => {
    const raw = e.response?.payloadData ?? '';
    const c = classify(raw);
    const sock = wsSockets.find((s) => s.requestId === e.requestId);
    wsFrames.push({ dir: 'recv', url: sock?.url ?? null, bytes: raw.length, ...c, sample: raw.slice(0, 300), opcode: e.response?.opcode });
  });
  cdp.on('Network.webSocketFrameSent', (e) => {
    const raw = e.response?.payloadData ?? '';
    const c = classify(raw);
    const sock = wsSockets.find((s) => s.requestId === e.requestId);
    wsFrames.push({ dir: 'sent', url: sock?.url ?? null, bytes: raw.length, ...c, sample: raw.slice(0, 300), opcode: e.response?.opcode });
  });

  // ---- HTTP capture
  const http = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(URL_)) return;
    http.push({ phase: 'request', url: u, method: r.method(), at: Date.now(), postData: (r.postData() || '').slice(0, 500), rt: r.resourceType() });
  });
  page.on('response', (r) => {
    const u = r.url();
    if (!u.startsWith(URL_)) return;
    http.push({ phase: 'response', url: u, status: r.status(), at: Date.now(), headers: { 'content-length': r.headers()['content-length'], 'content-type': r.headers()['content-type'] } });
  });
  page.on('websocket', (s) => wsSockets.push({ playwrightUrl: s.url() }));

  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  report.homeUrl = page.url();

  // ---- A. find the settings trigger
  report.buttons = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button,[role="button"],a,[role="tab"],[role="menuitem"]')) {
      const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      const aria = el.getAttribute('aria-label');
      const title = el.getAttribute('title');
      if (t || aria || title) out.push({ tag: el.tagName, role: el.getAttribute('role'), text: t, aria, title, cls: (el.className || '').toString().slice(0, 80) });
    }
    return out.slice(0, 120);
  });

  const httpMarkA = http.length;
  let trigger = null;
  for (const cand of [
    () => page.locator('button[aria-label*="设置"]').first(),
    () => page.locator('[title*="设置"]').first(),
    () => page.locator('button:has-text("设置")').first(),
    () => page.locator('[aria-label*="ettings"]').first(),
  ]) {
    try { const l = cand(); if (await l.count()) { await l.click({ timeout: 4000 }); trigger = await l.getAttribute('aria-label') || 'text-match'; break; } } catch { }
  }
  await page.waitForTimeout(2500);
  report.settingsTrigger = trigger;
  report.afterOpenUrl = page.url();

  // ---- B/C. settings surface DOM
  report.settingsDom = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const pick = (el, n = 8) => {
      const out = [];
      for (const c of el.children) out.push({ tag: c.tagName, cls: (c.className || '').toString().slice(0, 100), nodes: c.getElementsByTagName('*').length, text: (c.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60) });
      return out.slice(0, n);
    };
    const navsel = ['[role="tab"]', '[role="tablist"] button', 'nav button', 'aside button', 'ul button'];
    const navs = {};
    for (const s of navsel) {
      const els = [...document.querySelectorAll(s)];
      navs[s] = { count: els.length, labels: els.map((e) => (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)).slice(0, 20), attrs: els.slice(0, 3).map((e) => ({ role: e.getAttribute('role'), cls: (e.className || '').toString().slice(0, 100), aria: e.getAttribute('aria-label'), selected: e.getAttribute('aria-selected'), dataState: e.getAttribute('data-state') })) };
    }
    return {
      hasDialog: !!dlg,
      dialogClass: dlg ? (dlg.className || '').toString().slice(0, 120) : null,
      dialogNodes: dlg ? dlg.getElementsByTagName('*').length : 0,
      dialogChildren: dlg ? pick(dlg) : [],
      dialogText: dlg ? (dlg.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 400) : null,
      navCandidates: navs,
      bodyNodes: document.getElementsByTagName('*').length,
    };
  });

  // ---- D. are there /usage-ish HTTP calls at all? now open the plugins tab
  const httpMarkB = http.length;
  const wsMarkB = wsFrames.length;
  let pluginTabClicked = null;
  try {
    const t = page.locator('[role="dialog"]').locator('text=插件').first();
    if (await t.count()) { await t.click({ timeout: 4000 }); pluginTabClicked = 'dialog text=插件'; }
  } catch { }
  if (!pluginTabClicked) {
    try { const t = page.getByText('插件', { exact: true }).first(); if (await t.count()) { await t.click({ timeout: 4000 }); pluginTabClicked = 'getByText exact 插件'; } } catch { }
  }
  await page.waitForTimeout(9000);
  report.pluginTabClicked = pluginTabClicked;
  report.pluginTabDom = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    return {
      dialogNodes: dlg ? dlg.getElementsByTagName('*').length : 0,
      activeNav: [...document.querySelectorAll('[role="tab"],[data-state]')].filter((e) => e.getAttribute('aria-selected') === 'true' || e.getAttribute('data-state') === 'active').map((e) => (e.textContent || '').trim().slice(0, 30)),
      text: dlg ? (dlg.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 1200) : null,
      hasUsageCard: !!document.querySelector('[class*="du_"]'),
      usageClasses: [...new Set([...document.querySelectorAll('[class*="du_"]')].map((e) => (e.className || '').toString().split(' ')[0]))].slice(0, 15),
      bodyNodes: document.getElementsByTagName('*').length,
    };
  });

  report.httpDuringPlugins = http.slice(httpMarkB);
  report.httpAll = http;
  report.wsDuringPlugins = wsFrames.slice(wsMarkB).map((f) => ({ dir: f.dir, url: f.url, envelope: f.envelope, payloadType: f.payloadType, bytes: f.bytes }));
  report.wsAll = wsFrames.slice(0, 60);
  report.wsSocketUrls = [...new Set(wsFrames.map((f) => f.url))];
  report.wsSockets = wsSockets;
  report.wsPayloadTypes = [...new Set(wsFrames.map((f) => f.payloadType))];
  report.httpUrls = [...new Set(http.filter((h) => h.phase === 'request').map((h) => `${h.method} ${h.url}`))];

  fs.writeFileSync(`${OUT}/recon.json`, JSON.stringify(report, null, 1));
  console.log(JSON.stringify({
    settingsTrigger: report.settingsTrigger,
    hasDialog: report.settingsDom.hasDialog,
    dialogNodes: report.settingsDom.dialogNodes,
    navCandidates: Object.fromEntries(Object.entries(report.settingsDom.navCandidates).map(([k, v]) => [k, v.count])),
    pluginTabClicked: report.pluginTabClicked,
    pluginTabDom: report.pluginTabDom,
    wsSocketUrls: report.wsSocketUrls,
    wsPayloadTypes: report.wsPayloadTypes,
    httpUrls: report.httpUrls,
    httpDuringPlugins: report.httpDuringPlugins.filter((h) => h.phase === 'request').map((h) => ({ m: h.method, u: h.url, body: h.postData?.slice(0, 200) })),
  }, null, 1));
  await browser.close();
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
