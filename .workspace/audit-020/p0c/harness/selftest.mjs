/**
 * WP5 · Route B 草案的**不启动服务**单元级自测。
 *
 * 做什么：
 *  1. 直接 `import` 纯逻辑层 `plugin-draft/lib/core.js`，对白名单/令牌函数跑断言；
 *  2. `import` 真插件 `plugin-draft/lib/index.js`（**在真实 0.2.0-rc.2 依赖树上加载**，
 *     见 `p0c/node_modules/@deepseek-ai` 这条测试用软链），用一个**内存假 ctx**
 *     跑通 `apply()`：断言注册了一个 `kind:"exact"` 路由与一条规则；
 *  3. 用**内存假 request/response** 直接调用路由 handler，覆盖
 *     405 / 415 / 401 / 503 / 413 / 403(各具名码) / 202 全部出口；
 *  4. 断言规则把投递映射成合法的 `WebhookSessionRequest`，且**日志里从不出现令牌**。
 *
 * 不做什么：**不起监听端口、不发网络请求、不碰 ~/.dsh、不加载 cordis boot**。
 *
 * 跑法：`node /home/CNS2026495165/dsh/.workspace/audit-020/p0c/harness/selftest.mjs`
 */

import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_EXTENSIONS,
  MAX_TITLE_CHARS,
  STATUS,
  bearerTokenFromHeader,
  buildPrompt,
  buildTitle,
  checkFileEntry,
  checkWorkspacePath,
  extensionOf,
  isAllowedExtension,
  isInside,
  normalizeExtensions,
  parseNote,
  verifyToken,
} from "../plugin-draft/lib/core.js";
import { apply, authorizeDelivery, name as pluginName, inject as pluginInject, toSessionRequest } from "../plugin-draft/lib/index.js";

/* ─────────────────────────── 迷你测试骨架 ─────────────────────────── */

const results = [];
let failed = 0;

async function check(title, fn) {
  try {
    const detail = await fn();
    results.push({ ok: true, title, detail: detail === undefined ? "" : String(detail) });
    console.log(`  ok   ${title}${detail === undefined ? "" : `   ${detail}`}`);
  } catch (error) {
    failed += 1;
    results.push({ ok: false, title, detail: error?.message ?? String(error) });
    console.log(`  FAIL ${title}\n       ${error?.stack?.split("\n").slice(0, 3).join("\n       ")}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

function eq(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label ?? "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/* ─────────────────────────── 内存假 ctx / request / response ─────────────────────────── */

function makeFakeCtx({ token = "T0KEN-" + "a".repeat(40), credentialsAvailable = true } = {}) {
  const state = { effects: [], routes: [], rules: [], logs: [], dispatches: [], effectsDisposed: 0 };
  const ctx = {
    effect(effectFn, label) {
      state.effects.push(label ?? "(unlabeled)");
      const disposer = effectFn();
      const plainDisposer = typeof disposer === "function" ? disposer : () => {};
      return () => {
        state.effectsDisposed += 1;
        return typeof plainDisposer === "function" ? plainDisposer() : undefined;
      };
    },
    logger: {
      warn: (line) => state.logs.push(String(line)),
      info: (line) => state.logs.push(String(line)),
      debug: (line) => state.logs.push(String(line)),
    },
    webServer: {
      register(route) {
        state.routes.push(route);
        return () => {};
      },
    },
    webhookRuntime: {
      register(rule) {
        state.rules.push(rule);
        return async () => {};
      },
      dispatch(delivery) {
        state.dispatches.push(delivery);
      },
    },
    credentials: {
      async resolve(ref) {
        state.resolvedRefs ??= [];
        state.resolvedRefs.push(String(ref));
        if (!credentialsAvailable) return undefined;
        return { value: token, source: "test" };
      },
    },
  };
  return { ctx, state, token };
}

function makeRequest({ method = "POST", headers = {}, headersDistinct, body = "" }) {
  const chunks = body === "" ? [] : [Buffer.from(body, "utf8")];
  const distinct =
    headersDistinct ??
    Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, [String(value)]]));
  return {
    method,
    headers,
    headersDistinct: distinct,
    complete: true,
    resume() {},
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function makeResponse() {
  const captured = { status: null, headers: {}, body: null };
  return {
    captured,
    setHeader(key, value) {
      captured.headers[key] = value;
    },
    writeHead(status, headers) {
      captured.status = status;
      if (headers) Object.assign(captured.headers, headers);
    },
    end(text) {
      captured.body = text ?? "";
    },
  };
}

async function callRoute(route, options) {
  const response = makeResponse();
  await route.handler(makeRequest(options), response);
  return response.captured;
}

/* ─────────────────────────── 主流程 ─────────────────────────── */

const here = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = await mkdtemp(path.join(here, "tmp-"));
const allowedRoot = path.join(tmpRoot, "allow");
const outsideRoot = path.join(tmpRoot, "outside");
const workspaceDir = path.join(allowedRoot, "ws");
const siblingDir = path.join(allowedRoot, "sibling");
await mkdir(workspaceDir, { recursive: true });
await mkdir(siblingDir, { recursive: true });
await mkdir(outsideRoot, { recursive: true });

const goodFile = path.join(workspaceDir, "report.docx");
const goodFile2 = path.join(workspaceDir, "budget.xlsx");
const badExtFile = path.join(workspaceDir, "payload.exe");
const outsideWorkspaceFile = path.join(siblingDir, "other.pdf");
await writeFile(goodFile, Buffer.alloc(1024, 7));
await writeFile(goodFile2, Buffer.alloc(2048, 7));
await writeFile(badExtFile, Buffer.alloc(16, 7));
await writeFile(outsideWorkspaceFile, Buffer.alloc(64, 7));

const symlinkFile = path.join(workspaceDir, "link.docx");
await symlink(goodFile, symlinkFile);
const symlinkEscape = path.join(allowedRoot, "escape");
await symlink(outsideRoot, symlinkEscape);

const TOKEN = "T0KEN-" + "a".repeat(40);

console.log("\n=== A. core.js 纯函数（零服务、零 DSH 依赖）===");

await check("isInside 是**纯文本**判定（调用方必须先 path.resolve）", () => {
  assert(isInside("/a/b", "/a/b") === true, "root itself");
  assert(isInside("/a/b", "/a/b/c") === true, "descendant");
  assert(isInside("/a/b", "/a/bc") === false, "prefix-without-boundary must be rejected");
  // 文本层不做规范化 ⇒ `..` 段看起来"在里面"；这正是**所有调用点都先
  // `path.resolve` / `fs.realpath` 再判定**的原因（见 checkWorkspacePath 与
  // authorizeDelivery 的 dot-dot / symlink 两个用例，它们都返回拒绝）。
  assert(isInside("/a/b", "/a/b/../x") === true, "textual only, by contract");
  eq(path.resolve("/a/b/../x"), "/a/x", "resolve is what removes the escape");
  assert(isInside("/a/b", path.resolve("/a/b/../x")) === false, "after resolve → rejected");
  return "6/6";
});

await check("extensionOf 只取最后一段 basename", () => {
  eq(extensionOf("a.docx"), ".docx", "plain");
  eq(extensionOf("A.DOCX"), ".docx", "case");
  eq(extensionOf("evil.docx.exe"), ".exe", "double ext");
  eq(extensionOf("noext"), "", "no ext");
  eq(extensionOf(".bashrc"), "", "dotfile");
  eq(extensionOf("/x/y/z/b.PDF"), ".pdf", "path");
  return "6/6";
});

await check("isAllowedExtension 白名单（大小写不敏感 / 缺省拒绝）", () => {
  assert(isAllowedExtension("a.DOCX", DEFAULT_EXTENSIONS) === true, "upper ok");
  assert(isAllowedExtension("a.exe", DEFAULT_EXTENSIONS) === false, "exe rejected");
  assert(isAllowedExtension("a", DEFAULT_EXTENSIONS) === false, "no ext rejected");
  assert(isAllowedExtension("a.sh", []) === false, "empty list rejects all");
  return "4/4";
});

await check("verifyToken：常量时间比较的真值表", () => {
  assert(verifyToken(TOKEN, TOKEN) === true, "equal");
  assert(verifyToken(TOKEN.slice(0, -1), TOKEN) === false, "prefix");
  assert(verifyToken("", TOKEN) === false, "empty provided");
  assert(verifyToken(TOKEN, "") === false, "empty expected");
  assert(verifyToken(undefined, TOKEN) === false, "undefined provided");
  assert(verifyToken(TOKEN, undefined) === false, "undefined expected");
  assert(verifyToken({}, TOKEN) === false, "non-string");
  assert(verifyToken("x", "y") === false, "tiny mismatch");
  return "8/8";
});

await check("verifyToken：长度差异既不失衡也不抛（两侧 sha256 定长）", () => {
  const huge = "z".repeat(200000);
  assert(verifyToken("a", huge) === false, "1 vs 200k");
  assert(verifyToken(huge, "a") === false, "200k vs 1");
  assert(verifyToken(huge, huge) === true, "200k vs same");
  return "3/3 (no throw, empty strings already proven false)";
});

await check("bearerTokenFromHeader：唯一 + 只认 Bearer", () => {
  assert(bearerTokenFromHeader(["Bearer abc"]).ok === true, "ok");
  assert(bearerTokenFromHeader(["Bearer abc"]).token === "abc", "token value");
  eq(bearerTokenFromHeader(undefined).status, STATUS.UNAUTHORIZED, "missing");
  eq(bearerTokenFromHeader([]).status, STATUS.UNAUTHORIZED, "empty array");
  eq(bearerTokenFromHeader(["Bearer a", "Bearer b"]).status, STATUS.UNAUTHORIZED, "duplicated");
  eq(bearerTokenFromHeader(["Basic abc"]).status, STATUS.UNAUTHORIZED, "wrong scheme");
  eq(bearerTokenFromHeader(["Bearer"]).status, STATUS.UNAUTHORIZED, "no token");
  return "7/7";
});

await check("checkWorkspacePath：绝对 + 白名单前缀（含 ../ 逃逸与 NUL）", () => {
  const roots = [allowedRoot];
  assert(checkWorkspacePath(workspaceDir, roots).ok === true, "inside root");
  eq(checkWorkspacePath("relative/dir", roots).code, "workspace-path-not-absolute", "relative");
  eq(checkWorkspacePath("/etc", roots).code, "workspace-path-outside-allowlist", "outside");
  eq(checkWorkspacePath(path.join(allowedRoot, "..", "outside"), roots).code, "workspace-path-outside-allowlist", "dot-dot escape");
  eq(checkWorkspacePath(allowedRoot, roots).ok, true, "root itself allowed");
  eq(checkWorkspacePath("", roots).code, "workspace-path-missing", "empty");
  eq(checkWorkspacePath("/x/\u0000y", roots).code, "workspace-path-invalid", "NUL");
  eq(checkWorkspacePath(workspaceDir, []).code, "workspace-root-unconfigured", "no roots");
  return "8/8";
});

await check("checkFileEntry：必须在目标目录内 + 扩展名白名单", () => {
  const base = { workspacePath: workspaceDir, extensions: DEFAULT_EXTENSIONS };
  assert(checkFileEntry({ ...base, rawPath: goodFile }).ok === true, "inside ok");
  eq(checkFileEntry({ ...base, rawPath: outsideWorkspaceFile }).code, "file-outside-workspace", "sibling dir");
  eq(checkFileEntry({ ...base, rawPath: badExtFile }).code, "file-extension-not-allowlisted", "exe");
  eq(checkFileEntry({ ...base, rawPath: "rel.docx" }).code, "file-path-not-absolute", "relative");
  eq(checkFileEntry({ ...base, rawPath: workspaceDir }).code, "file-extension-not-allowlisted", "dir has no ext");
  eq(checkFileEntry({ ...base, rawPath: `${workspaceDir}/sub/../../ws/x.docx` }).ok, true, "normalizable");
  eq(checkFileEntry({ ...base, rawPath: `${workspaceDir}/sub/../../outside/y.docx` }).code, "file-outside-workspace", "escapes via ..");
  return "7/7";
});

await check("parseNote / normalizeExtensions / buildTitle 边界", () => {
  eq(parseNote(undefined), "", "undefined");
  eq(parseNote("   "), "", "blank");
  eq(parseNote("x".repeat(5000)).length, 2000, "truncated to MAX_NOTE_CHARS");
  eq(normalizeExtensions(["DOCX", ".pdf", ".PDF", "md"]).join(","), ".docx,.pdf,.md", "normalized+deduped");
  eq(normalizeExtensions(undefined).length, DEFAULT_EXTENSIONS.length, "default");
  const long = buildTitle({ titlePrefix: "办公投递", files: [{ name: "x".repeat(400) + ".docx" }] });
  assert(long.length <= MAX_TITLE_CHARS, `title length ${long.length} <= ${MAX_TITLE_CHARS}`);
  return "6/6";
});

await check("buildPrompt：附注只在非空时出现，且被标为不可信", () => {
  const noNote = buildPrompt({ files: [{ name: "a.docx", size: 1 }], source: "office-handoff", deliveryId: "d1", workspacePath: "/w" });
  assert(!noNote.includes("不可信文本"), "no note => no untrusted block");
  const withNote = buildPrompt({ files: [{ name: "a.docx", size: 1 }], note: "帮我转 PDF", source: "office-handoff", deliveryId: "d1", workspacePath: "/w" });
  assert(withNote.includes("不可信文本"), "note => labelled untrusted");
  assert(withNote.includes("帮我转 PDF"), "note body present");
  assert(withNote.includes("a.docx"), "file list present");
  return "4/4";
});

console.log("\n=== B. index.js：模块可加载 + apply() 注册面（真实 rc2 依赖树）===");

const fake = makeFakeCtx({ token: TOKEN });
const pluginConfig = {
  source: "office-handoff",
  path: "/office-handoff",
  tokenRef: "DSH_OFFICE_ROUTE_B_TOKEN",
  maxBodyBytes: 65536,
  workspaceRoots: [allowedRoot],
  extensions: [...DEFAULT_EXTENSIONS],
  maxFileBytes: 4096,
  maxFiles: 3,
  agentPreset: "standard-glm",
  permissionPreset: "workspace-write",
  titlePrefix: "办公投递",
};

await check("模块导出面（真依赖树加载，非 mock）", () => {
  eq(pluginName, "office-route-b", "name");
  eq(pluginInject.join(","), "webServer,webhookRuntime,credentials", "inject");
  return "name/inject";
});

let route;
let rule;
await check("apply() 注册 1 条规则 + 1 个精确路由（无任何监听）", () => {
  apply(fake.ctx, pluginConfig);
  eq(fake.state.rules.length, 1, "rules");
  eq(fake.state.routes.length, 1, "routes");
  rule = fake.state.rules[0];
  route = fake.state.routes[0];
  eq(route.kind, "exact", "route kind");
  eq(route.path, "/office-handoff", "route path");
  eq(rule.id, "office-handoff", "rule id");
  eq(rule.kind, "office-handoff", "rule kind");
  assert(typeof route.handler === "function", "handler");
  return `${fake.state.effects.length} effects`;
});

console.log("\n=== C. 路由 handler：全部出口（内存假 request/response）===");

const jsonHeaders = { "content-type": "application/json" };
const authHeaders = { ...jsonHeaders, authorization: `Bearer ${TOKEN}` };

await check("GET → 405 + allow: POST（探针契约，零副作用、不需令牌）", async () => {
  const out = await callRoute(route, { method: "GET" });
  eq(out.status, STATUS.METHOD_NOT_ALLOWED, "status");
  eq(out.headers.allow, "POST", "allow header");
  return "405";
});

await check("POST text/plain → 415", async () => {
  const out = await callRoute(route, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
  eq(out.status, STATUS.UNSUPPORTED_MEDIA_TYPE, "status");
  return "415";
});

await check("POST 缺 authorization → 401", async () => {
  const out = await callRoute(route, { method: "POST", headers: jsonHeaders, body: "{}" });
  eq(out.status, STATUS.UNAUTHORIZED, "status");
  return "401";
});

await check("POST 重复 authorization 头 → 401（headersDistinct 长度≠1）", async () => {
  const out = await callRoute(route, {
    method: "POST",
    headers: authHeaders,
    headersDistinct: { "content-type": ["application/json"], authorization: [`Bearer ${TOKEN}`, `Bearer ${TOKEN}`] },
    body: "{}",
  });
  eq(out.status, STATUS.UNAUTHORIZED, "status");
  return "401";
});

await check("POST 令牌错误 → 401（且不回显令牌）", async () => {
  const out = await callRoute(route, {
    method: "POST",
    headers: { ...jsonHeaders, authorization: "Bearer wrong-token" },
    body: JSON.stringify({ workspacePath: workspaceDir, files: [goodFile] }),
  });
  eq(out.status, STATUS.UNAUTHORIZED, "status");
  assert(!out.body.includes("wrong-token"), "body must not echo the token");
  return "401";
});

await check("POST 声明长度超限 → 413", async () => {
  const out = await callRoute(route, {
    method: "POST",
    headers: { ...authHeaders, "content-length": "99999999" },
    body: "{}",
  });
  eq(out.status, STATUS.PAYLOAD_TOO_LARGE, "status");
  return "413";
});

await check("POST 令牌不可解析（凭据槽空）→ 503", async () => {
  const empty = makeFakeCtx({ credentialsAvailable: false });
  apply(empty.ctx, pluginConfig);
  const out = await callRoute(empty.state.routes[0], {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ workspacePath: workspaceDir, files: [goodFile] }),
  });
  eq(out.status, STATUS.SERVICE_UNAVAILABLE, "status");
  return "503";
});

await check("POST 目标目录在白名单外 → 403", async () => {
  const out = await callRoute(route, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ workspacePath: outsideRoot, files: [goodFile] }),
  });
  eq(out.status, STATUS.FORBIDDEN, "status");
  assert(out.body.includes("workspacePath"), "names the field");
  return "403";
});

await check("POST 目标目录符号链接逃逸 → 403", async () => {
  const out = await callRoute(route, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ workspacePath: symlinkEscape, files: [goodFile] }),
  });
  eq(out.status, STATUS.FORBIDDEN, "status");
  return "403 (symlink escape)";
});

await check("POST 目标目录不存在 → 403（宿主绝不按调用方输入 mkdir）", async () => {
  const out = await callRoute(route, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ workspacePath: path.join(workspaceDir, "nope"), files: [goodFile] }),
  });
  eq(out.status, STATUS.FORBIDDEN, "status");
  return "403";
});

await check("POST 扩展名不在白名单 → 403", async () => {
  const out = await callRoute(route, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ workspacePath: workspaceDir, files: [badExtFile] }),
  });
  eq(out.status, STATUS.FORBIDDEN, "status");
  return "403 (.exe)";
});

await check("POST 文件不在目标目录内 → 403", async () => {
  const out = await callRoute(route, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ workspacePath: workspaceDir, files: [outsideWorkspaceFile] }),
  });
  eq(out.status, STATUS.FORBIDDEN, "status");
  return "403 (sibling)";
});

await check("POST 文件是符号链接 → 403", async () => {
  const out = await callRoute(route, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ workspacePath: workspaceDir, files: [symlinkFile] }),
  });
  eq(out.status, STATUS.FORBIDDEN, "status");
  return "403 (symlink)";
});

await check("单文件超字节上限 → 403（直调 authorizeDelivery，上限 512 B）", async () => {
  const out = await authorizeDelivery({
    body: { workspacePath: workspaceDir, files: [goodFile] }, // goodFile = 1024 B
    realRoots: [allowedRoot],
    extensions: DEFAULT_EXTENSIONS,
    maxFileBytes: 512,
    maxFiles: 3,
  });
  eq(out.status, STATUS.FORBIDDEN, "status");
  eq(out.code, "file-too-large", "code");
  return "403 (1024 B > 512 B)";
});

await check("POST 文件数超上限 → 403", async () => {
  const out = await callRoute(route, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ workspacePath: workspaceDir, files: [goodFile, goodFile2, goodFile, goodFile] }),
  });
  eq(out.status, STATUS.FORBIDDEN, "status");
  return "403 (4 > maxFiles=3)";
});

await check("POST 合法投递 → 202 空体 + dispatch 一次", async () => {
  const before = fake.state.dispatches.length;
  const out = await callRoute(route, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ workspacePath: workspaceDir, files: [goodFile, goodFile2], note: "请转成 PDF 归档" }),
  });
  eq(out.status, STATUS.ACCEPTED, "status");
  eq(out.body, "", "empty body");
  eq(fake.state.dispatches.length, before + 1, "dispatch count");
  const delivery = fake.state.dispatches.at(-1);
  eq(delivery.kind, "office-handoff", "delivery kind");
  eq(delivery.workspacePath, workspaceDir, "delivery workspacePath");
  eq(delivery.files.length, 2, "delivery files");
  assert(delivery.deliveryId.startsWith("office-"), "delivery id");
  return "202 + 1 dispatch";
});

await check("规则 run() 把投递映射成合法 WebhookSessionRequest", () => {
  const delivery = fake.state.dispatches.at(-1);
  const request = rule.run(delivery, new AbortController().signal);
  assert(request !== null, "request not null");
  eq(request.workspacePath, workspaceDir, "workspacePath（绝对，workspaceRegistry.create 不 mkdir）");
  assert(path.isAbsolute(request.workspacePath), "absolute");
  eq(request.agentPreset, "standard-glm", "agentPreset");
  eq(request.permissionPreset, "workspace-write", "permissionPreset");
  assert(typeof request.title === "string" && request.title.length > 0, "title non-empty");
  assert(typeof request.prompt === "string" && request.prompt.trim().length > 0, "prompt non-empty");
  assert(request.prompt.includes("不可信文本"), "note labelled untrusted");
  assert(!("model" in request), "model omitted ⇒ 用部署默认模型");
  return `title=${JSON.stringify(request.title)}`;
});

await check("规则 run() 对空文件投递返回 null（不建会话）", () => {
  const request = rule.run({ workspacePath: workspaceDir, files: [], source: "office-handoff", deliveryId: "d0" }, new AbortController().signal);
  eq(request, null, "null");
  return "null";
});

await check("authorizeDelivery 直调：非对象体 → 400", async () => {
  const out = await authorizeDelivery({ body: [], realRoots: [allowedRoot], extensions: DEFAULT_EXTENSIONS, maxFileBytes: 4096, maxFiles: 3 });
  eq(out.status, STATUS.BAD_REQUEST, "status");
  eq(out.code, "body-not-an-object", "code");
  return "400";
});

await check("toSessionRequest 直调：空文件 → 具名拒绝", () => {
  const out = toSessionRequest({ delivery: { files: [] }, config: pluginConfig });
  eq(out.ok, false, "not ok");
  eq(out.code, "files-missing", "code");
  return "files-missing";
});

console.log("\n=== D. 日志与凭据纪律 ===");

await check("全部日志行里没有令牌字面量，也没有请求体片段", () => {
  const joined = fake.state.logs.join("\n");
  assert(!joined.includes(TOKEN), "token must never appear in logs");
  assert(!joined.includes("请转成 PDF 归档"), "request body must never appear in logs");
  return `${fake.state.logs.length} log lines inspected`;
});

await check("凭据按引用名解析（每次请求解析一次，可热轮换）", () => {
  assert(Array.isArray(fake.state.resolvedRefs) && fake.state.resolvedRefs.length > 0, "resolve called");
  assert(fake.state.resolvedRefs.every((ref) => ref === "DSH_OFFICE_ROUTE_B_TOKEN"), "resolved by ref name only");
  return `resolve(${fake.state.resolvedRefs[0]}) × ${fake.state.resolvedRefs.length}`;
});

/* ─────────────────────────── 收尾 ─────────────────────────── */

await rm(tmpRoot, { recursive: true, force: true });

const passed = results.filter((r) => r.ok).length;
console.log(`\n=== 结果：${passed}/${results.length} 通过，${failed} 失败 ===`);
if (failed > 0) {
  console.log("失败项：");
  for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.title}: ${r.detail}`);
  process.exitCode = 1;
}
