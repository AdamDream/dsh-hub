/**
 * Shared environment/launch helpers for the plugins-page click-cost probe.
 * Read-only w.r.t. the product: this file only drives a throwaway browser instance.
 */
import { chromium } from 'playwright';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

export const BASE = process.env.PROBE_BASE ?? 'http://127.0.0.1:3080';

/** Chrome flags that do not perturb rendering measurement. */
export const CHROME_ARGS = [
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-sync',
  '--disable-extensions',
  '--disable-default-apps',
  '--disable-features=Translate,OptimizationHints,MediaRouter',
  '--lang=zh-CN',
];

/** Launch a fresh Chrome (real channel, not bundled Chromium) on a throwaway profile. */
export async function launchChrome({ headless = true } = {}) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-profile-'));
  const browser = await chromium.launch({
    channel: 'chrome',
    headless,
    args: CHROME_ARGS,
  });
  return { browser, userDataDir };
}

/** A fresh context with zh-CN locale to match the reporting user's Chrome. */
export async function newContext(browser) {
  return browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
}

export function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function writeJson(dir, name, obj) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}
