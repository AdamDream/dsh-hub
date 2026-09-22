/**
 * Probe 4 — does the inventory register per-card event listeners?
 * The CDP gauge JSEventListeners grew by exactly +178 on each inventory mount, which
 * would imply one listener per plugin. React normally delegates at the root, so this
 * checks the actual listener objects on a card node before that claim is used.
 */
import { launchChrome, newContext, BASE, writeJson, stamp } from './lib-env.mjs';
import { INIT_HOOKS } from './lib-instrument.mjs';

const OUT = new URL('./raw/', import.meta.url).pathname;
const TAG = stamp();
const out = { base: BASE, tag: TAG, steps: [] };

const { browser } = await launchChrome({ headless: true });
try {
  const ctx = await newContext(browser);
  await ctx.addInitScript({ content: INIT_HOOKS });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('Runtime.enable');

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.getByRole('button', { name: /^设置$/ }).first().waitFor({ state: 'visible', timeout: 40000 });
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /^设置$/ }).first().click();
  await page.getByRole('button', { name: /^通用设置$/ }).first().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /^插件$/ }).first().click({ timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.getByRole('tab', { name: /^插件列表$/ }).first().click({ timeout: 10000 });
  await page.waitForSelector('[data-plugin-entry]', { timeout: 20000 });
  await page.waitForTimeout(1000);

  const { documentId } = await cdp.send('DOM.getDocument', { depth: -1 });
  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  const q = async (selector) => {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
    if (!nodeId) return null;
    const { object } = await cdp.send('DOM.resolveNode', { nodeId });
    return object;
  };
  const listeners = async (selector, label) => {
    const object = await q(selector);
    if (!object) return out.steps.push({ label, selector, found: false });
    try {
      const res = await cdp.send('DOMDebugger.getEventListeners', { objectId: object.objectId, depth: 1, pierce: true });
      out.steps.push({
        label, selector, found: true,
        listenerCount: res.listeners.length,
        listeners: res.listeners.map((l) => ({ type: l.type, useCapture: l.useCapture, scriptId: l.scriptId, lineNumber: l.lineNumber, columnNumber: l.columnNumber })),
      });
    } catch (e) {
      out.steps.push({ label, selector, found: true, error: String(e).slice(0, 300) });
    }
  };

  await listeners('[data-plugin-entry]', 'first inventory card <li>');
  await listeners('[data-plugin-entry] > button', 'first inventory card <button>');
  await listeners('[data-plugin-entry] strong', 'first inventory card <strong>');
  await listeners('[data-plugin-entry] svg', 'first inventory card chevron <svg>');
  await listeners('[role=tab][id$="-tab-all"]', 'inventory tab button');
  await listeners('body', 'body (delegation root probe)');
  out.done = true;
} catch (e) {
  out.error = String(e).slice(0, 1200);
} finally {
  await browser.close();
}
console.log(writeJson(OUT, `click4-raw-${TAG}.json`, out));
