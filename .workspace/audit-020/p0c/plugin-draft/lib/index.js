/**
 * @local/dsh-office-route-b —— **宿主侧薄插件**（草案，未装配）。
 *
 * 目标（工单 WP5 · Route B）：让「Nautilus 右键投递一个文件」在 0.2.0 侧真的
 * 出现工作区 + 会话，且自建面只剩「投递侧触发 + 鉴权 + 白名单」。
 *
 * 分层（**这是本设计唯一需要精读的部分**）：
 *
 *   ┌─ 官方件（零代码，只在 profile 里加一行）────────────────────────────┐
 *   │ @deepseek-ai/dsh-webhook —— `ctx.webhookRuntime`                    │
 *   │   `register(rule)` / `dispatch(delivery)`；唯一内置动作 =            │
 *   │   「在 Web Workspace 里建一个普通 root Session」并带完整回滚。        │
 *   │   注意：它**没有** Config（无 `Config` 导出），也**没有** YAML 配置   │
 *   │   规则的入口 —— 规则必须由插件用 `register()` 提供。                  │
 *   └─────────────────────────────────────────────────────────────────────┘
 *   ┌─ 自建件（本文件）───────────────────────────────────────────────────┐
 *   │ 1) 一个 **非 `/api` 的精确路由** `config.path`，自建鉴权：            │
 *   │    Bearer 令牌（`ctx.credentials` 引用解析）+ 常量时间比较；          │
 *   │ 2) 请求体限长（`maxBodyBytes`）+ 只收 POST + 只收 application/json；  │
 *   │ 3) **三重白名单**（目标目录前缀 / 扩展名 / 数量与单文件字节上限），    │
 *   │    全部以**文件系统事实**（realpath + lstat/stat）为准，不信调用方；   │
 *   │ 4) 一条 `ctx.webhookRuntime.register()` 规则，把已授权的投递映射成     │
 *   │    `WebhookSessionRequest`。                                         │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * **为什么不复用官方 `dsh-webhook-github` 做入口**（工单 C2 的取舍见 REPORT）：
 * 它的四字段 Config 里 `secretEnv` 只解决**签名**，投递侧必须实现 GitHub 的
 * `x-hub-signature-256`（`sha256=<hex>` HMAC）与三个 `x-github-*` 头；而**任何
 * 形态都必须再写一个规则插件**（官方 README 明写：规则由 "User-authored rule
 * plugins" 用 `register()` 提供）。既然规则插件躲不掉，就用同一个薄插件把入口
 * 也一并做成"令牌 + 白名单"，让投递侧的改动收敛为"多一个请求头"。
 * 官方适配器已完整读源（`$B/dsh-webhook-github/lib/index.js`，193 行），本文件的
 * HTTP 部分逐条对齐它的顺序与状态码（405 → 415 → 413 → 400/401 → 503 → 202）。
 *
 * 安全边界（必须与 D17 的判决一起读）：本路由**绕开** `admit()` cookie 门
 * （`dsh-client-connection` 只在 `/api` 前缀 handler 与 `connection.rpc` 通道上
 * 调用 admit）。所以本文件自己的鉴权**就是**这一层的全部安全性。默认监听仍是
 * loopback（`$B/dsh-web-app/cordis.patch.yml:173`），**绝不允许**为了这个入口把
 * `host` 改成 `0.0.0.0`。
 *
 * 日志纪律：**令牌、请求头、请求体一个字都不进日志**。所有日志行只含
 * 规则 id / 投递号 / 具名拒绝码。
 *
 * 热配置纪律（本部署的既有坑，见 BRIEF §2.2）：标了 `.volatile()` 的字段在
 * `apply()` 里拿到的是 **cosmokit 引用对象**而不是值，必须每调用 `.get()`
 * 解包（同形参考：`@local/dsh-subagent-model/lib/index.js:44-55`、
 * `@local/dsh-workerspace/lib/index.js:56-63`）。本文件用 `snapshot()` 逐次解包。
 *
 * @module @local/dsh-office-route-b
 */

import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";

import {
  DEFAULT_EXTENSIONS,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_FILES,
  DEFAULT_ROUTE,
  DEFAULT_TOKEN_REF,
  STATUS,
  bearerTokenFromHeader,
  buildPrompt,
  buildTitle,
  checkFileEntry,
  checkWorkspacePath,
  isInsideAny,
  normalizeExtensions,
  parseNote,
  verifyToken,
} from "./core.js";

/** Cordis 函数插件名。 */
export const name = "office-route-b";

/**
 * 需要的宿主服务（与官方 `dsh-webhook-github` 的 `inject` 同形）：
 *  - `webServer`       —— 路由所有者；
 *  - `webhookRuntime`  —— 规则注册面（`@deepseek-ai/dsh-webhook`）；
 *  - `credentials`     —— 令牌解析面（`$DSH_HOME/.credentials.yaml` + 启动环境分层）。
 */
export const inject = ["webServer", "webhookRuntime", "credentials"];

/** 规则 id（全局唯一；进 `MessageSourceMap.webhook.ruleId`，会话内可追溯）。 */
export const RULE_ID = "office-handoff";

/**
 * 条目 Config。
 *
 * **`.volatile()` 纪律（0.2.0 硬约束，本部署已踩过一次）**：`dsh-settings` 只暴露
 * `.volatile()` 字段；`volatileForm(schema) === undefined` 的条目会被**整条跳过**，
 * 设置页显示「设置命名空间未注册（…插件未加载？）」（`$B/dsh-settings/lib/index.js:418-419`、
 * `:505-506`）。本 schema 因此是**扁平**的（volatile 节点之下不得再放 volatile 叶子，
 * 见 `@local/dsh-wallpaper/lib/index.js:93-108`），除 `path` 外全部可热改；
 * `path` 是组合级事实（改了要重注册路由），故意不 volatile。
 */
export const Config = z.object({
  /** 适配器实例 id（进投递的 `source` 字段；非空且已 trim）。 */
  source: z.string().default("office-handoff").volatile(),
  /** 非 `/api` 的精确路径；必须是绝对、非根、无尾斜杠/查询/片段。 */
  path: z.string().default(DEFAULT_ROUTE),
  /** 令牌的**凭据引用名**（POSIX 标识符）；值经 `ctx.credentials.resolve` 每次请求解析。 */
  tokenRef: z.string().default(DEFAULT_TOKEN_REF).volatile(),
  /** 请求体字节上限。 */
  maxBodyBytes: z.number().default(DEFAULT_MAX_BODY_BYTES).volatile(),
  /** 目标目录**白名单根**（绝对路径；投递的 workspacePath 必须落在其中）。 */
  workspaceRoots: z.array(z.string()).default([]).volatile(),
  /** 扩展名白名单（含点，大小写不敏感）。 */
  extensions: z.array(z.string()).default([...DEFAULT_EXTENSIONS]).volatile(),
  /** 单个投递文件字节上限。 */
  maxFileBytes: z.number().default(DEFAULT_MAX_FILE_BYTES).volatile(),
  /** 单次投递文件数上限。 */
  maxFiles: z.number().default(DEFAULT_MAX_FILES).volatile(),
  /** 会话的 agent preset id（必须已注册，例如本部署默认的 `standard-glm`）。 */
  agentPreset: z.string().default("standard-glm").volatile(),
  /** 会话的权限 preset id（本部署 base patch 提供 read-only / workspace-write / danger-full-access）。 */
  permissionPreset: z.string().default("workspace-write").volatile(),
  /** 会话标题前缀。 */
  titlePrefix: z.string().default("办公投递").volatile(),
});

/** cosmokit 的 volatile 引用标记（`cosmokit/lib/index.js:83,116-118`）。 */
const VOLATILE_WRITE = Symbol.for("cosmokit.volatile.write");

/**
 * 解开 cosmokit volatile 引用，取当前快照；普通值原样返回。
 * `apply()` 收到的 `config` 对被标记 volatile 的字段是**引用对象**而非值，
 * 直接展开会把引用对象当成字符串用（这就是本部署 `subagent-model` 需要
 * "void 引用解包" 的同一条原因）。
 * @param {unknown} value
 * @returns {unknown}
 */
export function plain(value) {
  return value !== null && typeof value === "object" && VOLATILE_WRITE in value && typeof value.get === "function"
    ? value.get()
    : value;
}

/**
 * 把整份 config 的 volatile 引用解包成值快照（逐次调用 ⇒ 热改即时生效）。
 * @param {Record<string, unknown>} config
 * @returns {Record<string, unknown>}
 */
export function snapshot(config) {
  const out = {};
  for (const [key, value] of Object.entries(config ?? {})) out[key] = plain(value);
  return out;
}

/**
 * Schemastery 表达不了的事实校验（与官方适配器 `assertConfig` 同形）。
 * @param {Record<string, unknown>} config 已解包的**值**快照
 */
export function assertConfig(config) {
  if (typeof config.source !== "string" || config.source.trim() !== config.source || config.source === "") {
    throw new Error("office-route-b source must be a non-empty trimmed string");
  }
  if (
    typeof config.path !== "string" ||
    !config.path.startsWith("/") ||
    config.path === "/" ||
    config.path.endsWith("/") ||
    config.path.includes("?") ||
    config.path.includes("#")
  ) {
    throw new Error("office-route-b path must be an absolute non-root pathname without a trailing slash, query, or fragment");
  }
  if (!Array.isArray(config.workspaceRoots) || config.workspaceRoots.length === 0) {
    throw new Error("office-route-b workspaceRoots must list at least one absolute directory");
  }
  for (const root of config.workspaceRoots) {
    if (typeof root !== "string" || root === "" || !path.isAbsolute(root)) {
      throw new Error("office-route-b every workspaceRoots entry must be an absolute path");
    }
    if (root.includes("\u0000") || root.length > 4096) {
      throw new Error("office-route-b every workspaceRoots entry must be a plain absolute path");
    }
  }
  if (typeof config.tokenRef !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.tokenRef)) {
    throw new Error("office-route-b tokenRef must be a POSIX identifier (an environment-variable-shaped credential reference)");
  }
  if (!Number.isSafeInteger(config.maxBodyBytes) || config.maxBodyBytes <= 0) {
    throw new Error("office-route-b maxBodyBytes must be a positive safe integer");
  }
  if (!Number.isSafeInteger(config.maxFiles) || config.maxFiles <= 0) {
    throw new Error("office-route-b maxFiles must be a positive safe integer");
  }
  if (!Number.isSafeInteger(config.maxFileBytes) || config.maxFileBytes <= 0) {
    throw new Error("office-route-b maxFileBytes must be a positive safe integer");
  }
}

/* ─────────────────────────── HTTP 输入层（对齐官方适配器） ─────────────────────── */

/** 只发状态码，或发纯文本（绝不回显调用方数据 —— 与官方 `respond()` 一致）。 */
function respond(response, status, message) {
  if (message === undefined) {
    response.writeHead(status);
    response.end();
    return;
  }
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(message);
}

/** `content-type` 必须是 `application/json`（只容忍一个 utf-8 charset 参数）。 */
function isJsonContentType(value) {
  if (value === undefined) return false;
  const [mediaType, parameter, ...extra] = String(value).split(";").map((part) => part.trim());
  if (mediaType?.toLowerCase() !== "application/json") return false;
  if (parameter === undefined) return true;
  return extra.length === 0 && /^charset=(?:utf-8|"utf-8")$/i.test(parameter);
}

/** 声明长度解析（歧义头 ⇒ 400；超上限 ⇒ 413）。 */
function checkDeclaredLength(request, maxBodyBytes) {
  const value = request.headers["content-length"];
  if (value === undefined) return;
  if (!/^(0|[1-9]\d*)$/.test(value)) throw { code: "content-length-invalid", status: STATUS.BAD_REQUEST, message: "invalid Content-Length" };
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length > maxBodyBytes) {
    throw { code: "body-too-large", status: STATUS.PAYLOAD_TOO_LARGE, message: "request body is too large" };
  }
}

/** 有界读 UTF-8 体（对齐官方 `readBoundedUtf8Body`）。 */
async function readBoundedUtf8Body(request, maxBodyBytes) {
  try {
    checkDeclaredLength(request, maxBodyBytes);
  } catch (error) {
    request.resume();
    throw error;
  }
  const chunks = [];
  let size = 0;
  try {
    for await (const raw of request) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      size += chunk.byteLength;
      if (size > maxBodyBytes) {
        request.resume();
        throw { code: "body-too-large", status: STATUS.PAYLOAD_TOO_LARGE, message: "request body is too large" };
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error !== null && typeof error === "object" && "status" in error) throw error;
    throw { code: "body-aborted", status: STATUS.BAD_REQUEST, message: "request body was aborted" };
  }
  if (!request.complete) throw { code: "body-aborted", status: STATUS.BAD_REQUEST, message: "request body was aborted" };
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size));
  } catch {
    throw { code: "body-not-utf8", status: STATUS.BAD_REQUEST, message: "request body is not valid UTF-8" };
  }
}

/* ─────────────────────────── 白名单（以文件系统事实为准） ─────────────────────── */

/**
 * 对一次已解析的信封做**授权判定**。调用方给的一切都只是"声称"；这里用
 * `realpath` + `lstat`/`stat` 换成事实，再喂回 `core.js` 的纯判定。
 *
 * @param {object} input
 * @param {any} input.body 已解析的 JSON 对象
 * @param {readonly string[]} input.realRoots 白名单根的 realpath
 * @param {readonly string[]} input.extensions
 * @param {number} input.maxFileBytes
 * @param {number} input.maxFiles
 * @returns {Promise<{ ok: true, delivery: object } | { ok: false, code: string, status: number, message: string }>}
 */
export async function authorizeDelivery({ body, realRoots, extensions, maxFileBytes, maxFiles }) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, code: "body-not-an-object", status: STATUS.BAD_REQUEST, message: "request body must be a JSON object" };
  }

  /* ① 目标目录：结构性判定（绝对 + 落在白名单根内） */
  const claimed = checkWorkspacePath(body["workspacePath"], realRoots);
  if (!claimed.ok) return claimed;

  /* ② 目标目录：文件系统事实（存在、是目录、realpath 后仍在白名单根内） */
  let realDir;
  try {
    realDir = await realpath(claimed.path);
  } catch {
    // 宿主**不**为调用方造目录（`ctx.workspaceRegistry.create` 本来也不 mkdir）。
    return { ok: false, code: "workspace-path-missing-on-disk", status: STATUS.FORBIDDEN, message: "workspacePath does not exist" };
  }
  if (!isInsideAny(realDir, realRoots)) {
    return { ok: false, code: "workspace-path-symlink-escape", status: STATUS.FORBIDDEN, message: "workspacePath resolves outside the configured roots" };
  }
  try {
    const stats = await stat(realDir);
    if (!stats.isDirectory()) {
      return { ok: false, code: "workspace-path-not-a-directory", status: STATUS.FORBIDDEN, message: "workspacePath is not a directory" };
    }
  } catch {
    return { ok: false, code: "workspace-path-unreadable", status: STATUS.FORBIDDEN, message: "workspacePath is not readable" };
  }

  /* ③ 文件清单：数量 → 逐项结构判定 → 逐项事实判定 */
  const rawFiles = body["files"];
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    return { ok: false, code: "files-missing", status: STATUS.BAD_REQUEST, message: "files must be a non-empty array of absolute paths" };
  }
  if (rawFiles.length > maxFiles) {
    return { ok: false, code: "files-over-limit", status: STATUS.FORBIDDEN, message: "too many files in one delivery" };
  }

  const files = [];
  const seen = new Set();
  for (const rawPath of rawFiles) {
    const structural = checkFileEntry({ rawPath, workspacePath: realDir, extensions });
    if (!structural.ok) return structural;

    let realFile;
    try {
      realFile = await realpath(structural.path);
    } catch {
      return { ok: false, code: "file-missing-on-disk", status: STATUS.FORBIDDEN, message: "a delivered file does not exist" };
    }
    if (!isInsideAny(realFile, [realDir])) {
      return { ok: false, code: "file-symlink-escape", status: STATUS.FORBIDDEN, message: "a delivered file resolves outside the workspace directory" };
    }
    if (seen.has(realFile)) {
      return { ok: false, code: "file-duplicated", status: STATUS.BAD_REQUEST, message: "a delivered file appears twice" };
    }
    seen.add(realFile);

    let linkStats;
    let stats;
    try {
      linkStats = await lstat(structural.path);
      stats = await stat(structural.path);
    } catch {
      return { ok: false, code: "file-unreadable", status: STATUS.FORBIDDEN, message: "a delivered file is not statable" };
    }
    if (linkStats.isSymbolicLink()) {
      return { ok: false, code: "file-is-symlink", status: STATUS.FORBIDDEN, message: "a delivered file is a symbolic link" };
    }
    if (!stats.isFile()) {
      return { ok: false, code: "file-not-regular", status: STATUS.FORBIDDEN, message: "a delivered file is not a regular file" };
    }
    if (stats.size > maxFileBytes) {
      return { ok: false, code: "file-too-large", status: STATUS.FORBIDDEN, message: "a delivered file exceeds the byte ceiling" };
    }
    files.push({ path: structural.path, name: structural.name, size: stats.size });
  }

  return {
    ok: true,
    delivery: {
      workspacePath: realDir,
      files,
      note: parseNote(body["note"]),
    },
  };
}

/* ─────────────────────────── 规则：已授权投递 → 会话请求 ─────────────────────── */

/**
 * 把一次**已授权**的投递映射成 `WebhookSessionRequest`。这里是官方 README 说的
 * "规则自己的授权判断"的落点；本实现把它放在适配器与规则两处（适配器给具名
 * 状态码，规则是权威闸门，返回 `null` 即"不建会话"）。
 * @param {object} input
 * @param {any} delivery
 * @param {object} config 已解包的值快照
 * @returns {{ ok: true, request: object } | { ok: false, code: string, status: number, message: string }}
 */
export function toSessionRequest({ delivery, config }) {
  const files = Array.isArray(delivery?.files) ? delivery.files : [];
  if (files.length === 0) {
    return { ok: false, code: "files-missing", status: STATUS.BAD_REQUEST, message: "delivery carries no files" };
  }
  const request = {
    workspacePath: delivery.workspacePath,
    title: buildTitle({ titlePrefix: config.titlePrefix, files }),
    prompt: buildPrompt({
      files,
      note: typeof delivery.note === "string" ? delivery.note : "",
      source: typeof delivery.source === "string" ? delivery.source : config.source,
      deliveryId: typeof delivery.deliveryId === "string" ? delivery.deliveryId : "(unknown)",
      workspacePath: delivery.workspacePath,
    }),
    agentPreset: config.agentPreset,
    permissionPreset: config.permissionPreset,
  };
  return { ok: true, request };
}

/* ─────────────────────────── 装配 ─────────────────────────── */

/**
 * 注册规则 + 精确路由。**不起任何服务**：只做 `ctx.*` 上的注册（与官方
 * `dsh-webhook-github` 的 `apply()` 同形）。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown>} config
 */
export function apply(ctx, config) {
  assertConfig(snapshot(config));

  /**
   * 逐次读取的生效配置（volatile 引用每次解包 ⇒ 设置页热改立即生效）。
   * @returns {{ source: string, path: string, tokenRef: string, maxBodyBytes: number,
   *   extensions: string[], roots: string[], maxFileBytes: number, maxFiles: number,
   *   agentPreset: string, permissionPreset: string, titlePrefix: string }}
   */
  const current = () => {
    const values = snapshot(config);
    assertConfig(values);
    return {
      ...values,
      extensions: normalizeExtensions(values.extensions),
      roots: values.workspaceRoots.map((root) => path.resolve(root)),
    };
  };

  /* ── 规则：kind 与路由投递的 kind 对齐；run 返回 null 或一个 Session 请求 ── */
  ctx.effect(
    () =>
      ctx.webhookRuntime.register({
        id: RULE_ID,
        kind: snapshot(config).source,
        run(delivery) {
          let effective;
          try {
            effective = current();
          } catch {
            ctx.logger.warn(`office-route-b: rule=${RULE_ID} refused: config-invalid`);
            return null;
          }
          const mapped = toSessionRequest({ delivery, config: effective });
          if (!mapped.ok) {
            ctx.logger.warn(`office-route-b: rule=${RULE_ID} refused: ${mapped.code}`);
            return null;
          }
          return mapped.request;
        },
      }),
    `office-route-b: rule(${RULE_ID})`,
  );

  /* ── 白名单根：只在装配期按组合里的固定绝对路径创建一次（永不按调用方输入 mkdir） ── */
  ctx.effect(() => {
    let cancelled = false;
    void (async () => {
      for (const root of current().roots) {
        if (cancelled) return;
        try {
          await mkdir(root, { recursive: true });
        } catch (error) {
          ctx.logger.warn(`office-route-b: cannot prepare workspace root (${error instanceof Error ? error.name : "error"})`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, "office-route-b: workspace roots");

  /* ── 路由：非 /api 精确路径；鉴权自建；返回 202 不等规则结算 ── */
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: snapshot(config).path,
        async handler(request, response) {
          // ① 方法（探针契约：非 POST ⇒ 405 + allow: POST，零副作用且不需要令牌）
          if (request.method !== "POST") {
            response.setHeader("allow", "POST");
            respond(response, STATUS.METHOD_NOT_ALLOWED, "method not allowed");
            return;
          }
          try {
            const effective = current();

            // ② content-type
            if (!isJsonContentType(request.headers["content-type"])) {
              respond(response, STATUS.UNSUPPORTED_MEDIA_TYPE, "content type must be application/json");
              return;
            }

            // ③ 鉴权。顺序刻意与官方一致：**有界读体**是验签/验令牌的前提，
            //    但令牌永不进日志、永不回显。
            const bearer = bearerTokenFromHeader(request.headersDistinct?.["authorization"]);
            const textPromise = readBoundedUtf8Body(request, effective.maxBodyBytes);
            if (!bearer.ok) {
              await textPromise.catch(() => undefined);
              respond(response, bearer.status, bearer.message);
              return;
            }
            let expected = "";
            try {
              const credential = await ctx.credentials.resolve(credentialRef(effective.tokenRef));
              expected = typeof credential?.value === "string" ? credential.value : "";
            } catch {
              expected = "";
            }
            if (expected === "") {
              await textPromise.catch(() => undefined);
              respond(response, STATUS.SERVICE_UNAVAILABLE, "office handoff token is unavailable");
              return;
            }
            const text = await textPromise;
            if (!verifyToken(bearer.token, expected)) {
              respond(response, STATUS.UNAUTHORIZED, "invalid handoff token");
              return;
            }

            // ④ JSON
            let body;
            try {
              body = JSON.parse(text);
            } catch {
              respond(response, STATUS.BAD_REQUEST, "request body is not valid JSON");
              return;
            }

            // ⑤ 三重白名单（目录前缀 / 扩展名 / 数量与单文件字节）
            const realRoots = [];
            for (const root of effective.roots) {
              try {
                realRoots.push(await realpath(root));
              } catch {
                realRoots.push(root); // 尚未创建的根：授权阶段会判为不可用
              }
            }
            const authorized = await authorizeDelivery({
              body,
              realRoots,
              extensions: effective.extensions,
              maxFileBytes: effective.maxFileBytes,
              maxFiles: effective.maxFiles,
            });
            if (!authorized.ok) {
              respond(response, authorized.status, authorized.message);
              return;
            }

            // ⑥ 投递（fire-and-forget；202 不表示规则命中或会话建成）
            const delivery = {
              kind: effective.source,
              source: effective.source,
              deliveryId: `office-${randomUUID()}`,
              receivedAt: Date.now(),
              workspacePath: authorized.delivery.workspacePath,
              files: authorized.delivery.files,
              note: authorized.delivery.note,
            };
            try {
              ctx.webhookRuntime.dispatch(delivery);
            } catch {
              ctx.logger.warn("office-route-b: dispatch unavailable");
              respond(response, STATUS.SERVICE_UNAVAILABLE, "webhook runtime is unavailable");
              return;
            }
            respond(response, STATUS.ACCEPTED);
          } catch (error) {
            // 只有**本文件自己抛的**具名错误才带 `status` + 固定文案；
            // 任何意外错误一律 503 + 固定文案（绝不回显路径/内部信息）。
            const named = error !== null && typeof error === "object" && typeof error.status === "number" && typeof error.message === "string";
            const status = named ? error.status : STATUS.SERVICE_UNAVAILABLE;
            const message = named ? error.message : "office handoff ingress is unavailable";
            if (status === STATUS.SERVICE_UNAVAILABLE) ctx.logger.warn("office-route-b: request failed");
            respond(response, status, message);
          }
        },
      }),
    `office-route-b: ${snapshot(config).path}`,
  );
}
