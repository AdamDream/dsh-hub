/**
 * Discovery pass: identify safe, precise locators for the Settings surface and the
 * "插件" page entry. Deliberately clicks only the settings entry and (optionally)
 * the plugins nav item — never save/apply/delete/disable.
 */
import { launchChrome, newContext, BASE, writeJson } from './lib-env.mjs';

const OUT = new URL('./raw/', import.meta.url).pathname;

const DUMP = () => {
  const rows = (sel) =>
    [...document.querySelectorAll(sel)].map((el) => ({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      aria: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      dataActive: el.getAttribute('data-active'),
      id: el.id || null,
      text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
      cls: el.className ? String(el.className).slice(0, 60) : null,
    }));
  const dialog = document.querySelector('[role=dialog], dialog, [aria-modal=true]');
  return {
    t: performance.now(),
    url: location.href,
    buttons: rows('button'),
    tabs: rows('[role=tab]'),
    tablists: rows('[role=tablist]'),
    navs: rows('nav, [role=navigation]'),
    listitems: rows('[role=list] > li').slice(0, 4),
    inputs: rows('input, select, textarea'),
    dialogPresent: Boolean(dialog),
    dialogText: ((dialog || document.body).innerText || '').replace(/\n{2,}/g, '\n').slice(0, 2500),
    counts: {
      all: document.getElementsByTagName('*').length,
      svg: document.getElementsByTagName('svg').length,
      buttons: document.getElementsByTagName('button').length,
    },
  };
};

const out = { base: BASE, steps: [] };

const { browser } = await launchChrome({ headless: true });
try {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
  });

  const t0 = Date.now();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  out.steps.push({ step: 'goto', wallMs: Date.now() - t0, dump: await page.evaluate(DUMP) });

  // Settings entry: prefer an accessible-name search over a CSS guess.
  const candidates = [
    { how: 'role=button name=/设置|Settings/i', loc: () => page.getByRole('button', { name: /设置|Settings/i }).first() },
    { how: 'data-testid/settings', loc: () => page.locator('[data-testid*=settings], [class*=settingsButton], [class*=gear]').first() },
  ];
  let opened = null;
  for (const c of candidates) {
    try {
      const loc = c.loc();
      if ((await loc.count()) === 0) continue;
      await loc.click({ timeout: 5000 });
      await page.waitForTimeout(1200);
      opened = c.how;
      break;
    } catch (e) {
      out.steps.push({ step: 'openSettings-attempt-failed', how: c.how, err: String(e).slice(0, 200) });
    }
  }
  out.openedVia = opened;
  out.steps.push({ step: 'afterOpenSettings', dump: await page.evaluate(DUMP) });
  await page.screenshot({ path: OUT + 'discover-settings.png' });

  // Try clicking a nav/tab labeled 插件 / Plugins (navigation only; no mutation controls).
  let clickedPlugins = null;
  for (const how of [
    'role=button name=/^插件$|^Plugins$/',
    'role=tab name=/^插件$|^Plugins$/',
    'text=/^插件$/',
  ]) {
    try {
      const loc =
        how.startsWith('role=button')
          ? page.getByRole('button', { name: /^插件$|^Plugins$/ }).first()
          : how.startsWith('role=tab')
            ? page.getByRole('tab', { name: /^插件$|^Plugins$/ }).first()
            : page.getByText(/^插件$/).first();
      if ((await loc.count()) === 0) continue;
      await loc.click({ timeout: 5000 });
      await page.waitForTimeout(2500);
      clickedPlugins = how;
      break;
    } catch (e) {
      out.steps.push({ step: 'clickPlugins-attempt-failed', how, err: String(e).slice(0, 200) });
    }
  }
  out.clickedPluginsVia = clickedPlugins;
  out.steps.push({ step: 'afterClickPlugins', dump: await page.evaluate(DUMP) });
  await page.screenshot({ path: OUT + 'discover-plugins.png' });

  out.consoleErrors = consoleErrors;
  out.done = true;
} catch (e) {
  out.error = String(e).slice(0, 1000);
} finally {
  await browser.close();
}

console.log(writeJson(OUT, 'discover.json', out));
