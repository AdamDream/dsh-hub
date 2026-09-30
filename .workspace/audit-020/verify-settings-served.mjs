#!/usr/bin/env node
/**
 * 重启后验收检查（只读）：直接问运行中的 0.2.0 宿主「settings 面到底 serve 了哪些命名空间」。
 *
 * 为什么需要它：设置页报「设置命名空间未注册」时，浏览器里看不到原因；
 * 这个脚本走的是与浏览器**完全相同**的 RPC 通道（`/api` + client-request 信封，
 * 依据 `$B/dsh-client-connection/lib/client.js:1209-1231`），拿到的就是设置页会看到的事实。
 * 端点形状：POST `/api/settings/describe`；body = {type:'client-request',rpcId,method:'settings/describe',payload:{args:{}}}
 *   （method 必须用斜杠形式；payload 必须恰好含一个 plain-object `args` —— 见 dsh-api-gateway/lib/index.js:1225-1229）
 *
 * 用法：
 *   node verify-settings-served.mjs [port]      # 默认 3098
 * 退出码：0 = 期望的命名空间全部 served；1 = 有缺口（或宿主未启动）
 */
import { readFileSync, existsSync } from "node:fs";

const A = "/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020";
const port = process.argv[2] ?? "3098";
const base = `http://127.0.0.1:${port}`;

/** 本轮必须 served 的命名空间（= 用户点名的两个 + P0-B 投放的三个）。 */
const REQUIRED = ["subagent-model", "vision-adam", "wallpaper", "ssh-gui"];

function tokenFromLog() {
  const candidates = [`${A}/logs/web-${port}.log`, `${A}/logs/drill-${port}.log`];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    const matches = [...text.matchAll(/token=([A-Za-z0-9_-]+)/g)];
    if (matches.length > 0) return matches.at(-1)[1];
  }
  return undefined;
}

async function authCookie() {
  const token = tokenFromLog();
  if (token === undefined) return undefined;
  const response = await fetch(`${base}/?token=${token}`, { redirect: "manual" });
  const raw = response.headers.getSetCookie?.() ?? [];
  const cookie = raw.map((c) => c.split(";")[0]).join("; ");
  return cookie.length > 0 ? cookie : undefined;
}

async function describe(cookie) {
  const rpcId = `verify-${Date.now()}`;
  const response = await fetch(`${base}/api/settings/describe`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie === undefined ? {} : { cookie }) },
    body: JSON.stringify({ type: "client-request", rpcId, method: "settings/describe", payload: { args: {} } })
  });
  if (!response.ok) throw new Error(`transport failure: HTTP ${response.status}`);
  const body = await response.json();
  if (body?.type !== "server-response") throw new Error(`unexpected envelope: ${JSON.stringify(body).slice(0, 200)}`);
  if (body.result?.ok !== true) throw new Error(`rpc not ok: ${JSON.stringify(body.result).slice(0, 300)}`);
  return body.result.value;
}

const cookie = await authCookie();
const view = await describe(cookie);
const served = view.namespaces.map((n) => n.ns).sort();
const servedSet = new Set(served);

console.log(`host            : ${base}`);
console.log(`writable        : ${view.writable}`);
console.log(`served count    : ${served.length}`);
console.log(`served          : ${served.join(", ")}`);
console.log("");
let missing = 0;
for (const ns of REQUIRED) {
  const row = view.namespaces.find((n) => n.ns === ns);
  if (row === undefined) {
    missing += 1;
    console.log(`MISSING  ${ns}`);
    continue;
  }
  let value;
  try { value = JSON.stringify(row.value); } catch { value = "<unserializable>"; }
  console.log(`OK       ${ns}  applies=${row.applies} revision=${row.revision} value=${value}`);
}
console.log("");
if (missing === 0) {
  console.log("RESULT: PASS — 设置页将能渲染这 4 个条目。");
  process.exit(0);
}
console.log(`RESULT: FAIL — ${missing} 个命名空间未 served。`);
console.log("提示：若这是重启前的老进程，属预期（宿主内存里仍是旧模块）；请重启后再跑一次。");
process.exit(1);
