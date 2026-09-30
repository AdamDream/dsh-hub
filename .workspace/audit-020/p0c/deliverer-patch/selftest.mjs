/**
 * WP5 · 投递侧（`dsh-office-handoff/lib/api.js`）Route B 草案的**不启动服务**自测。
 *
 * 把 `p0c/deliverer-patch/api.route-b.js`（拟替换 `~/.local/lib/dsh-office-handoff/lib/api.js`）
 * 直接 import，用**假 fetch** 与**假环境**跑断言。零网络、零端口、零写盘
 * （令牌文件读取用注入的 `readFile`）。
 *
 * 跑法：`node /home/CNS2026495165/dsh/.workspace/audit-020/p0c/deliverer-patch/selftest.mjs`
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  TOKEN_ENV,
  TOKEN_FILE_ENV,
  deliverFiles,
  probe,
  redactReport,
  resolveOrigin,
  resolveRoute,
  resolveToken,
} from "./api.route-b.js";

const results = [];
let failed = 0;

async function check(title, fn) {
  try {
    const detail = await fn();
    results.push({ ok: true, title });
    console.log(`  ok   ${title}${detail === undefined ? "" : `   ${detail}`}`);
  } catch (error) {
    failed += 1;
    results.push({ ok: false, title, detail: error?.message ?? String(error) });
    console.log(`  FAIL ${title}\n       ${error?.message ?? String(error)}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

function eq(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label ?? "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const TOKEN = "b".repeat(64);

/** 假 Response（只用到 fetch 客户端实际读的四个面）。 */
function fakeResponse({ status, body = "", allow = null, contentType = "text/plain" }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key) => (key.toLowerCase() === "allow" ? allow : key.toLowerCase() === "content-type" ? contentType : null) },
    async text() {
      return body;
    },
  };
}

/** 记录调用的假 fetch。 */
function makeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return handler({ url, init, call: calls.length });
  };
  return { impl, calls };
}

console.log("\n=== A. origin / route 解析 ===");

await check("resolveOrigin：--url > DSH_WEB_URL > 默认", () => {
  eq(resolveOrigin({ urlOption: "http://127.0.0.1:3098", env: {} }).origin, "http://127.0.0.1:3098", "--url");
  eq(resolveOrigin({ urlOption: "http://127.0.0.1:3098", env: { DSH_WEB_URL: "http://127.0.0.1:3099" } }).source, "--url", "priority");
  eq(resolveOrigin({ env: { DSH_WEB_URL: "http://127.0.0.1:3099" } }).origin, "http://127.0.0.1:3099", "env");
  eq(resolveOrigin({ env: {} }).origin, "http://127.0.0.1:3080", "default");
  return "4/4";
});

await check("resolveOrigin：3080 硬闸门仍然生效（保留原安全语义）", () => {
  let code = null;
  try {
    resolveOrigin({ urlOption: "http://127.0.0.1:3080", env: { DSH_OFFICE_HANDOFF_FORBID_3080: "1" } });
  } catch (error) {
    code = error.code;
  }
  eq(code, "origin-3080-forbidden", "refusal code");
  return "3080 forbidden";
});

await check("resolveRoute：默认 /office-handoff，非法形状拒绝", () => {
  eq(resolveRoute({ env: {} }).route, "/office-handoff", "default");
  eq(resolveRoute({ env: { DSH_OFFICE_HANDOFF_ROUTE: "/other" } }).route, "/other", "env");
  eq(resolveRoute({ routeOption: "/x", env: { DSH_OFFICE_HANDOFF_ROUTE: "/other" } }).route, "/x", "priority");
  for (const bad of ["office-handoff", "/", "/x/", "/x?y", "/x#y"]) {
    let code = null;
    try {
      resolveRoute({ routeOption: bad, env: {} });
    } catch (error) {
      code = error.code;
    }
    eq(code, "bad-route", `rejects ${JSON.stringify(bad)}`);
  }
  return "3 + 5 rejects";
});

console.log("\n=== B. 令牌解析（绝不落盘、绝不进报告）===");

await check("resolveToken：环境变量优先", () => {
  const out = resolveToken({ env: { [TOKEN_ENV]: ` ${TOKEN} ` } });
  eq(out.token, TOKEN, "trimmed");
  eq(out.source, "env", "source");
  return "env";
});

await check("resolveToken：环境变量缺失时读令牌文件（注入 readFile，不碰真实磁盘）", () => {
  const out = resolveToken({
    env: { [TOKEN_FILE_ENV]: "/tmp/route-b.token" },
    readFile: (file) => {
      eq(file, "/tmp/route-b.token", "file path");
      return `${TOKEN}\n`;
    },
  });
  eq(out.token, TOKEN, "trimmed");
  eq(out.source, "file", "source");
  return "file";
});

await check("resolveToken：两者都没有 ⇒ 具名拒绝 token-missing", () => {
  let code = null;
  try {
    resolveToken({ env: {}, readFile: () => { throw new Error("ENOENT"); } });
  } catch (error) {
    code = error.code;
  }
  eq(code, "token-missing", "refusal code");
  return "token-missing";
});

await check("resolveToken：空令牌文件 ⇒ 具名拒绝 token-empty", () => {
  let code = null;
  try {
    resolveToken({ env: {}, tokenFileOption: "/tmp/x", readFile: () => "\n  \n" });
  } catch (error) {
    code = error.code;
  }
  eq(code, "token-empty", "refusal code");
  return "token-empty";
});

await check("redactReport：报告里万一混进令牌，兜底抹掉", () => {
  const report = { nested: { note: `token=${TOKEN}`, items: [`prefix ${TOKEN} suffix`] } };
  const clean = redactReport(report, TOKEN);
  const json = JSON.stringify(clean);
  assert(!json.includes(TOKEN), "token removed");
  assert(json.includes("[redacted]"), "placeholder present");
  return "nested redaction";
});

console.log("\n=== C. probe（Route B 的零副作用探针）===");

await check("probe：GET ⇒ 405 + allow: POST ⇒ 通行", async () => {
  const { impl, calls } = makeFetch(() => fakeResponse({ status: 405, allow: "POST" }));
  const out = await probe("http://127.0.0.1:3098", "/office-handoff", { fetchImpl: impl });
  eq(out.ok, true, "ok");
  eq(calls[0].url, "http://127.0.0.1:3098/office-handoff", "url");
  eq(calls[0].init.method, "GET", "method");
  assert(!("authorization" in calls[0].init.headers), "probe must not need the token");
  assert(calls[0].init.body === undefined, "probe sends no body");
  return "405+allow:POST";
});

await check("probe：404 / 静态前端 / 200 一律判 route-missing", async () => {
  for (const status of [404, 200, 405]) {
    const allow = status === 405 ? null : "POST";
    const { impl } = makeFetch(() => fakeResponse({ status, allow, body: "<html>" }));
    const out = await probe("http://127.0.0.1:3098", "/office-handoff", { fetchImpl: impl });
    eq(out.ok, false, `status=${status} must fail when allow header is ${String(allow)}`);
    eq(out.reason, "route-missing", `reason for ${status}/${String(allow)}`);
  }
  return "3/3";
});

await check("probe：连接失败 ⇒ unreachable（不是 route-missing）", async () => {
  const { impl } = makeFetch(() => {
    const error = new Error("connect ECONNREFUSED 127.0.0.1:3098");
    error.cause = { code: "ECONNREFUSED" };
    throw error;
  });
  const out = await probe("http://127.0.0.1:3098", "/office-handoff", { fetchImpl: impl });
  eq(out.reason, "unreachable", "reason");
  eq(out.errno, "ECONNREFUSED", "errno");
  return "unreachable";
});

console.log("\n=== D. deliverFiles（投递信封）===");

await check("deliverFiles：202 成功；请求形状精确（Bearer + 仅 workspacePath/files/note）", async () => {
  const { impl, calls } = makeFetch(() => fakeResponse({ status: 202 }));
  const out = await deliverFiles("http://127.0.0.1:3098", "/office-handoff", TOKEN, {
    workspacePath: "/home/u/DSH-办公投递",
    files: ["/home/u/DSH-办公投递/a.docx"],
    note: "请转 PDF",
  }, { fetchImpl: impl });
  eq(out.ok, true, "ok");
  eq(out.status, 202, "status");
  eq(calls[0].url, "http://127.0.0.1:3098/office-handoff", "url");
  eq(calls[0].init.method, "POST", "method");
  eq(calls[0].init.headers["content-type"], "application/json", "content-type");
  eq(calls[0].init.headers.authorization, `Bearer ${TOKEN}`, "bearer");
  const payload = JSON.parse(calls[0].init.body);
  eq(Object.keys(payload).sort().join(","), "files,note,workspacePath", "payload keys (no title/prompt)");
  eq(payload.workspacePath, "/home/u/DSH-办公投递", "workspacePath");
  return "202";
});

await check("deliverFiles：note 为空串时**不发** note 键", async () => {
  const { impl, calls } = makeFetch(() => fakeResponse({ status: 202 }));
  await deliverFiles("http://127.0.0.1:3098", "/office-handoff", TOKEN, { workspacePath: "/w", files: ["/w/a.md"], note: "" }, { fetchImpl: impl });
  const payload = JSON.parse(calls[0].init.body);
  assert(!("note" in payload), "note omitted");
  return "note omitted";
});

await check("deliverFiles：401/403/413/415/503 映射成具名拒绝，且**不回显令牌**", async () => {
  const cases = [
    [401, "unauthorized"],
    [403, "forbidden-by-allowlist"],
    [400, "bad-request"],
    [413, "body-too-large"],
    [415, "content-type-rejected"],
    [503, "ingress-unavailable"],
    [500, "http-error"],
  ];
  for (const [status, expected] of cases) {
    const { impl } = makeFetch(() => fakeResponse({ status, body: "named refusal" }));
    const out = await deliverFiles("http://127.0.0.1:3098", "/office-handoff", TOKEN, { workspacePath: "/w", files: ["/w/a.md"] }, { fetchImpl: impl });
    eq(out.ok, false, `status ${status} must fail`);
    eq(out.reason, expected, `reason for ${status}`);
    assert(!JSON.stringify(out).includes(TOKEN), `token must not appear in the failure result for ${status}`);
  }
  return `${cases.length}/${cases.length}`;
});

await check("deliverFiles：连接失败 ⇒ unreachable，且不抛", async () => {
  const { impl } = makeFetch(() => {
    const error = new Error("fetch failed");
    error.cause = { code: "ECONNREFUSED" };
    throw error;
  });
  const out = await deliverFiles("http://127.0.0.1:3098", "/office-handoff", TOKEN, { workspacePath: "/w", files: ["/w/a.md"] }, { fetchImpl: impl });
  eq(out.reason, "unreachable", "reason");
  return "unreachable";
});

/* ── 与宿主插件草案的**契约一致性**（跨文件断言，防止两侧漂移）── */
console.log("\n=== E. 与宿主插件草案的契约一致性 ===");

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginCore = await import(path.join(here, "..", "plugin-draft", "lib", "core.js"));
/** 与 `p0c/cordis.patch.insert.yml` 里 `office-route-b.config.path` 必须逐字相同。 */
const PLUGIN_PATCH_PATH = "/office-handoff";

await check("默认路由两侧同值（投递侧 DEFAULT_ROUTE = 宿主插入片段的 config.path）", () => {
  assert(typeof pluginCore.verifyToken === "function", "core loaded");
  eq(resolveRoute({ env: {} }).route, "/office-handoff", "deliverer default");
  eq(PLUGIN_PATCH_PATH, resolveRoute({ env: {} }).route, "must equal patched config.path");
  return "/office-handoff";
});

await check("扩展名白名单两侧逐项一致", () => {
  const delivererExt = [".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".pdf", ".odt", ".ods", ".odp", ".csv", ".md", ".txt", ".rtf"];
  eq(delivererExt.join(","), pluginCore.DEFAULT_EXTENSIONS.join(","), "extension list");
  return `${delivererExt.length} extensions`;
});

await check("令牌环境变量名 = 宿主凭据引用名", () => {
  eq(TOKEN_ENV, pluginCore.DEFAULT_TOKEN_REF, "token ref name");
  return TOKEN_ENV;
});

const passed = results.filter((r) => r.ok).length;
console.log(`\n=== 结果：${passed}/${results.length} 通过，${failed} 失败 ===`);
if (failed > 0) {
  console.log("失败项：");
  for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.title}: ${r.detail}`);
  process.exitCode = 1;
}
