import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext()).newPage();
await page.goto('http://127.0.0.1:3080', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(7000);
const out = await page.evaluate(() => {
  const b = globalThis.__DSH_BOOT__ || {};
  const ids = (b.entries || []).map((e) => e.id);
  return {
    rev: b.rev, count: ids.length,
    slots: ids.filter((x) => /slots/i.test(x)),
    reactEntries: ids.filter((x) => /react/i.test(x)),
    all: ids,
  };
});
console.log('bootRev', out.rev, 'entries', out.count);
console.log('slots-ish entries:', JSON.stringify(out.slots));
console.log('react-ish entries:', JSON.stringify(out.reactEntries));
console.log('ALL:', JSON.stringify(out.all));
await browser.close();
