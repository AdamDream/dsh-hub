/**
 * recon.mjs — 只读侦察：确认真实 wire 形态与设置面板 DOM 门禁候选，不修改任何状态。
 * 用途：为 harden-measure.mjs 的 classifier / gate 提供实测依据。
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const URL_ = process.env.DSH_URL || "http://127.0.0.1:3080";
const OUT = process.argv[2] || "";

const INSTALL = () => {
  window.__recon = { frames: [], sockets: [], rawSamples: [] };
  const OrigWS = window.WebSocket;
  window.WebSocket = function (...args) {
    const ws = new OrigWS(...args);
    const idx = window.__recon.sockets.push({ url: String(args[0]), frames: 0 }) - 1;
    ws.addEventListener("message", (ev) => {
      window.__recon.sockets[idx].frames += 1;
      const isStr = typeof ev.data === "string";
      let topType = null, payloadType = null, method = null, keys = null;
      if (isStr) {
        try {
          const d = JSON.parse(ev.data);
          keys = Object.keys(d);
          topType = d?.type ?? null;
          method = d?.method ?? null;
          payloadType = d?.payload?.type ?? null;
          if (window.__recon.rawSamples.length < 6) {
            window.__recon.rawSamples.push(ev.data.slice(0, 700));
          }
        } catch { topType = "<unparsed>"; }
      } else {
        topType = "<non-string>";
      }
      window.__recon.frames.push({ t: performance.now(), bytes: isStr ? ev.data.length : 0, topType, payloadType, method, keys });
    });
    return ws;
  };
  window.WebSocket.prototype = OrigWS.prototype;
};

const main = async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 200)));
  await page.addInitScript(INSTALL);
  await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(12000);

  // 1) session.list RPC（正确信封）
  const rpc = await page.evaluate(async () => {
    const rpcId = crypto.randomUUID();
    const body = JSON.stringify({ type: "client-request", rpcId, method: "session.list", payload: {} });
    const res = await fetch("/api/session.list", { method: "POST", headers: { "content-type": "application/json" }, body });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    return {
      status: res.status,
      envelopeBytes: text.length,
      topKeys: parsed ? Object.keys(parsed) : null,
      type: parsed?.type ?? null,
      rpcIdEchoed: parsed?.rpcId === rpcId,
      ok: parsed?.result?.ok ?? null,
      valueKeys: parsed?.result?.value ? Object.keys(parsed.result.value) : null,
      itemsLen: Array.isArray(parsed?.result?.value?.items) ? parsed.result.value.items.length : null,
      error: parsed?.result?.error ?? null,
      head: parsed ? JSON.stringify(parsed).slice(0, 300) : text.slice(0, 300)
    };
  });

  // 2) 侦察设置入口候选
  const candidates = await page.evaluate(() => {
    const sels = [
      '[aria-label*="设置"]', '[title*="设置"]', 'button:has-text("设置")',
      '[aria-label*="Settings" i]', '[title*="Settings" i]',
      '[data-testid*="setting" i]', 'a[href*="setting" i]', '[role="dialog"]', '[role="tab"]'
    ];
    const out = {};
    for (const s of sels) {
      let n = 0;
      try { n = document.querySelectorAll(s).length; } catch { n = -1; }
      out[s] = n;
    }
    const btns = [...document.querySelectorAll("button,[role=button],[role=tab]")]
      .map((b) => ({ t: (b.innerText || "").trim().slice(0, 30), aria: b.getAttribute("aria-label"), title: b.getAttribute("title"), testid: b.getAttribute("data-testid") }))
      .filter((x) => x.t || x.aria || x.title || x.testid).slice(0, 60);
    return { counts: out, btns, domNodes: document.querySelectorAll("*").length, rootChildren: document.getElementById("root")?.children.length ?? null };
  });

  const wsSnapshot = await page.evaluate(() => {
    const r = window.__recon;
    const byTop = {}, byPayload = {}, byMethod = {}, keySets = {};
    for (const f of r.frames) {
      byTop[f.topType] = (byTop[f.topType] || 0) + 1;
      if (f.payloadType) byPayload[f.payloadType] = (byPayload[f.payloadType] || 0) + 1;
      if (f.method) byMethod[f.method] = (byMethod[f.method] || 0) + 1;
      const k = f.keys ? f.keys.join(",") : "null";
      keySets[k] = (keySets[k] || 0) + 1;
    }
    return { total: r.frames.length, byTop, byPayload, byMethod, keySets, sockets: r.sockets, rawSamples: r.rawSamples };
  });

  const report = { meta: { url: URL_, node: process.version, when: new Date().toISOString() }, rpc, candidates, wsSnapshot, consoleErrors };
  const text = JSON.stringify(report, null, 2);
  if (OUT) writeFileSync(OUT, text);
  console.log(text);
  await browser.close();
};
main().catch((e) => { console.error("[recon] FAIL", e?.message || e); process.exit(1); });
