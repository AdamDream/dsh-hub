/**
 * Route B 投递客户端（U6' / **替代原 `/api` 信封客户端**）。
 *
 * 这是 `~/.local/lib/dsh-office-handoff/lib/api.js` 的**整份替换草案**，
 * 由本工单在 `p0c/` 内产出，**未落地**（越界写入禁令）。
 *
 * 为什么要换：
 *   原实现是 **Route A**（`POST ${origin}/api/${method}`，信封
 *   `{type:"client-request", rpcId, method, payload}`，**不带任何凭据**），
 *   并在 `probe()` 里调 `workspace.list`、在 ⑥ 调 `workspace.create`。
 *   在 0.2.0 上这条路**结构性失效**：
 *     * `/api/*` 的**每一个**入口都在 `dsh-client-connection` 的 `admit()` 之后
 *       ⇒ 无 cookie 一律 401（`$B/dsh-client-connection/lib/index.js:14,591,834`，
 *       README 明说 "there is no method-specific loopback tier"）；
 *     * `workspace.list` 在 0.2.0 **已被删除**（改为 `workspace/follow` 流）
 *       ⇒ 连"探针"都会 404。
 *
 * 换成什么：**Route B** —— 官方 `@deepseek-ai/dsh-webhook` 的创建原语 +
 * 自建非 `/api` 精确路由（`/office-handoff`，见 `p0c/plugin-draft/`）。
 *   * 请求：`POST ${origin}${route}`，头只多一个 `authorization: Bearer <token>`，
 *     体是 `{ workspacePath, files:[绝对路径…], note? }`；
 *   * 探针：`GET ${origin}${route}` ⇒ 期望 **405 + `allow: POST`**
 *     （零副作用、不需要令牌，证明"路由存在"）；
 *   * 成功：**202**（fire-and-forget；202 不代表规则命中或会话已建）。
 *
 * 纪律（与原件逐条一致，只增不减）：
 *   * **不使用 `curl`**（会遵守代理环境变量，可能把 loopback 请求送出机器）；
 *   * **不发** `Origin` / `Sec-Fetch-Site`（发了反而会被信任栅栏 403）；
 *   * 令牌**只从环境变量或 600 权限的文件读**，**绝不进日志/`--json` 报告/异常消息**；
 *   * 任何 HTTP 非预期状态都当**失败**，不当"重试解析"。
 */

import { readFileSync } from "node:fs";

import { EXIT, Refusal } from "./errors.js";

export const DEFAULT_ORIGIN = "http://127.0.0.1:3080";
/** 设为 `1` 时，任何指向 3080 的 origin 一律 fail-closed（保留原有硬闸门）。 */
export const FORBID_3080_ENV = "DSH_OFFICE_HANDOFF_FORBID_3080";

/** Route B 默认落点：与宿主插件 `office-route-b` 的 `config.path` 同值。 */
export const DEFAULT_ROUTE = "/office-handoff";
/** 令牌环境变量名（也是宿主侧的凭据引用名）。 */
export const TOKEN_ENV = "DSH_OFFICE_ROUTE_B_TOKEN";
/** 令牌文件路径的环境变量名（Nautilus 拿不到终端环境时用这个）。 */
export const TOKEN_FILE_ENV = "DSH_OFFICE_ROUTE_B_TOKEN_FILE";
/** 令牌文件默认位置（`0600`；与状态根同处，但**不是**投递目标目录）。 */
export const DEFAULT_TOKEN_FILENAME = "route-b.token";

const API_TIMEOUT_MS = 3000;
const TOKEN_TIMEOUT_MS = 3000;

/**
 * URL 解析顺序（保留原件语义）：`--url` > `$DSH_WEB_URL` > `http://127.0.0.1:3080`。
 * @returns {{ origin: string, source: "--url"|"DSH_WEB_URL"|"default" }}
 */
export function resolveOrigin({ urlOption = null, env = process.env } = {}) {
  let raw;
  let source;
  if (urlOption && urlOption.length > 0) {
    raw = urlOption;
    source = "--url";
  } else if ((env.DSH_WEB_URL ?? "").trim().length > 0) {
    raw = env.DSH_WEB_URL.trim();
    source = "DSH_WEB_URL";
  } else {
    raw = DEFAULT_ORIGIN;
    source = "default";
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Refusal("bad-origin", `--url / DSH_WEB_URL 不是合法 URL：${JSON.stringify(raw)}`, {
      exitCode: EXIT.USAGE,
      detail: { raw, source },
    });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Refusal("bad-origin-scheme", `只接受 http/https origin，收到 ${parsed.protocol}`, {
      exitCode: EXIT.USAGE,
      detail: { raw, source },
    });
  }
  const origin = parsed.origin;
  if (env[FORBID_3080_ENV] === "1" && parsed.port === "3080") {
    throw new Refusal(
      "origin-3080-forbidden",
      `port gate: 禁止对现役 3080 发起任何请求（${FORBID_3080_ENV}=1）：${origin}`,
      { exitCode: EXIT.FORBIDDEN_PORT, detail: { origin, source } },
    );
  }
  return { origin, source };
}

/**
 * 路由解析：`--route` > `$DSH_OFFICE_HANDOFF_ROUTE` > `/office-handoff`。
 * @returns {{ route: string, source: "--route"|"DSH_OFFICE_HANDOFF_ROUTE"|"default" }}
 */
export function resolveRoute({ routeOption = null, env = process.env } = {}) {
  let route;
  let source;
  if (typeof routeOption === "string" && routeOption.length > 0) {
    route = routeOption;
    source = "--route";
  } else if ((env.DSH_OFFICE_HANDOFF_ROUTE ?? "").trim().length > 0) {
    route = env.DSH_OFFICE_HANDOFF_ROUTE.trim();
    source = "DSH_OFFICE_HANDOFF_ROUTE";
  } else {
    route = DEFAULT_ROUTE;
    source = "default";
  }
  if (!route.startsWith("/") || route === "/" || route.endsWith("/") || route.includes("?") || route.includes("#")) {
    throw new Refusal("bad-route", `--route 必须是绝对、非根、无尾斜杠/查询/片段的路径：${JSON.stringify(route)}`, {
      exitCode: EXIT.USAGE,
      detail: { route, source },
    });
  }
  return { route, source };
}

/**
 * 令牌解析：`$DSH_OFFICE_ROUTE_B_TOKEN` > `$DSH_OFFICE_ROUTE_B_TOKEN_FILE` > `--token-file`。
 *
 * 返回体**绝不**包含令牌以外的东西；调用方**不得**把 `token` 写进报告、日志、
 * spool 记录或异常消息（本文件提供 `redactReport()` 供报告侧兜底）。
 *
 * @returns {{ token: string, source: "env"|"file", file: string|null }}
 */
export function resolveToken({ env = process.env, tokenFileOption = null, readFile = readFileSync } = {}) {
  const fromEnv = (env[TOKEN_ENV] ?? "").trim();
  if (fromEnv.length > 0) return { token: fromEnv, source: "env", file: null };

  const explicit = (tokenFileOption ?? env[TOKEN_FILE_ENV] ?? "").trim();
  const file = explicit.length > 0 ? explicit : `${(env.DSH_OFFICE_HANDOFF_STATE ?? "").trim() || defaultStateRoot(env)}/${DEFAULT_TOKEN_FILENAME}`;
  let content;
  try {
    content = readFile(file, "utf8");
  } catch {
    throw new Refusal(
      "token-missing",
      `读不到投递令牌：既没有 $${TOKEN_ENV}，也读不到令牌文件（请按 Runbook §3 生成）。`,
      { exitCode: EXIT.USAGE, detail: { file } },
    );
  }
  const token = String(content).trim();
  if (token.length === 0) {
    throw new Refusal("token-empty", "令牌文件是空的。", { exitCode: EXIT.USAGE, detail: { file } });
  }
  return { token, source: "file", file };
}

/** `$DSH_HOME/office-handoff`（与 state.js 的默认一致；此处只做字符串兜底）。 */
function defaultStateRoot(env) {
  const dshHome = (env.DSH_HOME ?? "").trim();
  const home = dshHome.length > 0 ? dshHome : `${(env.HOME ?? "").trim() || "/tmp"}/.dsh`;
  return `${home.replace(/\/+$/, "")}/office-handoff`;
}

/**
 * 把报告里可能出现的令牌字面量抹掉（**兜底**；正常路径根本不该把令牌交给报告）。
 * @template T
 * @param {T} value
 * @param {string} token
 * @returns {T}
 */
export function redactReport(value, token) {
  if (typeof token !== "string" || token.length < 8) return value;
  const json = JSON.stringify(value);
  if (json === undefined || !json.includes(token)) return value;
  return JSON.parse(json.split(token).join("[redacted]"));
}

/**
 * 一次 Route B 请求。
 * @returns {{ ok: true, status: number, text: string } | { transportError: true, errno: string, message: string } | { ok: false, status: number, allow: string|null, text: string }}
 */
async function callRoute({ origin, route, token, method, payload, timeoutMs = API_TIMEOUT_MS, fetchImpl = globalThis.fetch }) {
  const headers = { "content-type": "application/json" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetchImpl(`${origin}${route}`, {
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return {
      transportError: true,
      errno: error?.cause?.code ?? error?.name ?? "fetch-failed",
      message: error?.message ?? String(error),
    };
  }
  const text = await response.text();
  return { ok: response.ok === true, status: response.status, allow: response.headers?.get?.("allow") ?? null, text };
}

/**
 * 探针：**只认**「GET ⇒ 405 + `allow: POST`」。
 *
 * 这是 Route B 专门留的**零副作用**健康检查契约（非 POST 在鉴权之前返回 405），
 * 因此不需要令牌、也不会建会话。替代原 Route A 的 `workspace.list` 探针。
 * @returns {{ ok: true, origin: string, route: string } | { ok: false, reason: string, httpStatus?: number, errno?: string, message?: string, origin: string, route: string }}
 */
export async function probe(origin, route, options = {}) {
  const result = await callRoute({
    origin,
    route,
    method: "GET",
    payload: undefined,
    timeoutMs: options.timeoutMs ?? API_TIMEOUT_MS,
    fetchImpl: options.fetchImpl,
  });
  if (result.transportError) {
    return { ok: false, origin, route, reason: "unreachable", errno: result.errno, message: result.message };
  }
  if (result.status !== 405 || (result.allow ?? "").toUpperCase().indexOf("POST") === -1) {
    return {
      ok: false,
      origin,
      route,
      reason: "route-missing",
      httpStatus: result.status,
      allow: result.allow,
      message: "对端没有 Route B 路由（0.2.0 未挂 office-route-b？路径写错？）",
      body: result.text.slice(0, 200),
    };
  }
  return { ok: true, origin, route };
}

/** 把一次协议/业务失败归一成具名结果（**不抛**）。 */
function failedFrom(result, origin, route) {
  if (result.transportError) {
    return { ok: false, origin, route, reason: "unreachable", code: result.errno, message: result.message };
  }
  switch (result.status) {
    case 400:
      return { ok: false, origin, route, reason: "bad-request", httpStatus: 400, message: result.text.slice(0, 200) };
    case 401:
      return { ok: false, origin, route, reason: "unauthorized", httpStatus: 401, message: "令牌被拒（宿主侧 DSH_OFFICE_ROUTE_B_TOKEN 与投递侧不一致？）" };
    case 403:
      return { ok: false, origin, route, reason: "forbidden-by-allowlist", httpStatus: 403, message: result.text.slice(0, 200) };
    case 405:
      return { ok: false, origin, route, reason: "route-missing", httpStatus: 405, message: "对端不接受 POST 到该路径（不是 Route B 路由？）" };
    case 413:
      return { ok: false, origin, route, reason: "body-too-large", httpStatus: 413, message: result.text.slice(0, 200) };
    case 415:
      return { ok: false, origin, route, reason: "content-type-rejected", httpStatus: 415, message: result.text.slice(0, 200) };
    case 503:
      return { ok: false, origin, route, reason: "ingress-unavailable", httpStatus: 503, message: result.text.slice(0, 200) };
    default:
      return {
        ok: false,
        origin,
        route,
        reason: "http-error",
        httpStatus: result.status,
        message: result.text.slice(0, 300),
      };
  }
}

/**
 * `POST /office-handoff` —— 把**已经复制到位**的副本告诉宿主，由宿主的规则建
 * 工作区 + 会话。payload **只有** `{workspacePath, files, note?}`（没有 title/prompt：
 * 标题与提示词一律由**宿主侧**生成，投递侧不给可注入的文本）。
 * @returns {{ ok: true, status: 202 } | { ok: false, reason: string, ... }}
 */
export async function deliverFiles(origin, route, token, { workspacePath, files, note = null }, options = {}) {
  const payload = { workspacePath, files };
  if (typeof note === "string" && note.length > 0) payload.note = note;
  const result = await callRoute({
    origin,
    route,
    token,
    method: "POST",
    payload,
    timeoutMs: options.timeoutMs ?? API_TIMEOUT_MS,
    fetchImpl: options.fetchImpl,
  });
  if (!result.transportError && (result.status === 202 || result.status === 200)) {
    return { ok: true, origin, route, status: result.status };
  }
  return failedFrom(result, origin, route);
}
