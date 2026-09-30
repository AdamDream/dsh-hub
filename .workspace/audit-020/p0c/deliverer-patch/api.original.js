/**
 * `/api` 信封客户端（U6 / Route A 的唯一通道）。
 *
 * 依据裁决 §5.4（协议逐条钉死）、§6.4（URL 来源）、§6.5（**必须**用内建 `fetch`）。
 *
 * 纪律：
 *  - **不使用 `curl`**：`curl` 会遵守代理环境变量，可能把本机 loopback 请求送出机器（§6.5）；
 *  - 请求头**只**发 `content-type: application/json`：**不发** `Origin`、**不发** `Sec-Fetch-Site`、
 *    **不发** `Accept-Language`（发了 Origin/Sec-Fetch-Site 反而会被信任栅栏按 403 拒绝）；
 *  - `probe()` 的**唯一合法判据**是「HTTP 200 + 合法 JSON 信封 + `items` 是数组」；
 *    **404/405/415/HTML 一律判"对端不是可用的 DSH 实例"**（§5.4 修正 host §5.1-3，J9）；
 *  - 处理器内部异常是 **HTTP 500 + 纯文本 `handler failure: …`（不是 JSON）** ⇒ 必须当**失败**，
 *    不得当"解析错误重试"；
 *  - `workspace.create` 的 payload **只允许** `{path}`；`mkdir` 用本地 `fs.mkdirSync`，
 *    **不用** `host.createDirectory`（§7 U6）。
 */

import { EXIT, Refusal } from "./errors.js";

export const DEFAULT_ORIGIN = "http://127.0.0.1:3080";
/** 设为 `1` 时，任何指向 3080 的 origin 一律 fail-closed（U7 与全部单测都设置它）。 */
export const FORBID_3080_ENV = "DSH_OFFICE_HANDOFF_FORBID_3080";

const API_TIMEOUT_MS = 3000;

/**
 * URL 解析顺序（§6.4，钉死）：`--url` > `$DSH_WEB_URL` > `http://127.0.0.1:3080`。
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

let rpcCounter = 0;

async function callApi({ origin, method, payload, timeoutMs = API_TIMEOUT_MS, fetchImpl = globalThis.fetch }) {
  const rpcId = `dsh-office-handoff-${++rpcCounter}`;
  const body = JSON.stringify({ type: "client-request", rpcId, method, payload });
  let response;
  try {
    response = await fetchImpl(`${origin}/api/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return {
      rpcId,
      transportError: true,
      errno: error?.cause?.code ?? error?.name ?? "fetch-failed",
      message: error?.message ?? String(error),
    };
  }
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { rpcId, status: response.status, json, text };
}

/** 合法"成功"信封（§5.4）。 */
function isOkEnvelope(result, rpcId) {
  return (
    result.json !== null &&
    result.json.type === "server-response" &&
    result.json.rpcId === rpcId &&
    result.json.result !== null &&
    typeof result.json.result === "object" &&
    result.json.result.ok === true &&
    "value" in result.json.result
  );
}

/**
 * 探针：**只认**「200 + 合法信封 + `value.items` 是数组」。
 */
export async function probe(origin, options = {}) {
  const result = await callApi({
    origin,
    method: "workspace.list",
    payload: {},
    timeoutMs: options.timeoutMs ?? API_TIMEOUT_MS,
    fetchImpl: options.fetchImpl,
  });
  if (result.transportError) {
    return { ok: false, reason: "unreachable", errno: result.errno, message: result.message, origin };
  }
  // §5.4（J9）：**唯一**合法判据是「200 + 合法 JSON 信封 + value.items 是数组」。
  // 404 / 405 / 415 / HTML / 垃圾信封 / 形状不符 —— **一律**判「对端不是可用的 DSH 实例」，
  // 不得把 405 当作"通道不在"的判据，也不得把其中任何一种当成功。
  if (result.status !== 200) {
    return { ok: false, reason: "not-a-dsh-instance", detail: "http-status", httpStatus: result.status, origin, body: result.text.slice(0, 200) };
  }
  if (result.json === null) {
    return { ok: false, reason: "not-a-dsh-instance", detail: "non-json-body", httpStatus: result.status, origin, body: result.text.slice(0, 200) };
  }
  if (!isOkEnvelope(result, result.rpcId)) {
    return { ok: false, reason: "not-a-dsh-instance", detail: "bad-envelope", httpStatus: result.status, origin, envelope: result.json };
  }
  const value = result.json.result.value;
  if (!Array.isArray(value.items) || !Array.isArray(value.archivedSessionIds)) {
    return { ok: false, reason: "not-a-dsh-instance", detail: "bad-value-shape", httpStatus: result.status, origin, envelope: value };
  }
  return { ok: true, origin, items: value.items, archivedSessionIds: value.archivedSessionIds };
}

/** 把一次业务/协议失败归一成具名结果（**不抛**，因为调用方需要按 code 分支处理）。 */
function failedFrom(result, origin, method) {
  if (result.transportError) {
    return { ok: false, origin, method, reason: "unreachable", code: result.errno, message: result.message };
  }
  if (result.status === 415) {
    return { ok: false, origin, method, reason: "content-type-rejected", httpStatus: 415, message: result.text.slice(0, 200) };
  }
  if (result.status === 404 || result.status === 405) {
    // J9：`/api/<未知方法>` 是 404；405 来自静态前端 fallback（非 GET/HEAD）。两者都表示
    // "这里没有这个 API 路由"，绝不能被解读成"通道存在但方法不对"。
    return {
      ok: false,
      origin,
      method,
      reason: "endpoint-missing",
      httpStatus: result.status,
      message: "对端没有 /api/{method} 路由（DSH 未以 web 模式运行？）",
    };
  }
  if (result.status === 403) {
    return { ok: false, origin, method, reason: "forbidden-by-trust-fence", httpStatus: 403, message: result.text.slice(0, 200) };
  }
  if (result.status !== 200) {
    // ⚠️ 处理器内部异常 = HTTP 500 + 纯文本 `handler failure: …` ⇒ 当失败，不当解析错误重试。
    return {
      ok: false,
      origin,
      method,
      reason: result.json === null ? "handler-failure" : "http-error",
      httpStatus: result.status,
      message: result.text.slice(0, 300),
    };
  }
  if (result.json === null) {
    return { ok: false, origin, method, reason: "non-json-body", httpStatus: result.status, message: result.text.slice(0, 200) };
  }
  const error = result.json?.result?.error;
  return {
    ok: false,
    origin,
    method,
    reason: "business-error",
    code: error?.code ?? "unknown",
    message: error?.message ?? "",
    details: error?.details,
    envelope: result.json,
  };
}

/**
 * `workspace.create({path})` —— payload **只有** `path`（没有 title）。
 * @returns {{ok:true, workspace: object, created: boolean} | {ok:false, reason: string, code?: string, ...}}
 */
export async function createWorkspace(origin, dirPath, options = {}) {
  const result = await callApi({
    origin,
    method: "workspace.create",
    payload: { path: dirPath },
    timeoutMs: options.timeoutMs ?? API_TIMEOUT_MS,
    fetchImpl: options.fetchImpl,
  });
  if (!result.transportError && result.status === 200 && isOkEnvelope(result, result.rpcId)) {
    const value = result.json.result.value;
    if (value && value.workspace && typeof value.workspace.workspaceId === "string") {
      return { ok: true, origin, workspace: value.workspace, created: value.created === true };
    }
    return { ok: false, origin, method: "workspace.create", reason: "bad-envelope", envelope: value };
  }
  return failedFrom(result, origin, "workspace.create");
}

/**
 * `workspace.delete({workspaceId})` —— **Phase 2 才会用到**；本档只在 U7 的隔离验收里调用。
 * `workspace-not-found` 视为"已消失"（既不成功也不失败）。
 */
export async function deleteWorkspace(origin, workspaceId, options = {}) {
  const result = await callApi({
    origin,
    method: "workspace.delete",
    payload: { workspaceId },
    timeoutMs: options.timeoutMs ?? API_TIMEOUT_MS,
    fetchImpl: options.fetchImpl,
  });
  if (!result.transportError && result.status === 200 && isOkEnvelope(result, result.rpcId)) {
    return { ok: true, origin, deleted: result.json.result.value?.deleted === true };
  }
  const failure = failedFrom(result, origin, "workspace.delete");
  if (failure.reason === "business-error" && failure.code === "workspace-not-found") {
    return { ...failure, alreadyGone: true };
  }
  return failure;
}
