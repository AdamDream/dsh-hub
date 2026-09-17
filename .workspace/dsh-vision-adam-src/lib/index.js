import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { extname } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Image- and video-as-a-tool for the DeepSeek Harness.
 *
 * Registers one model-facing tool — `analyze_image` — which reads a local
 * image or video file and sends it to the configured vision model
 * (OpenAI-compatible /chat/completions; images as `image_url`, videos as a
 * Zhipu-style `video_url` content part), returning ONLY the resulting text.
 *
 * Because the tool returns plain text, it works with ANY model — including
 * text-only models. The media never enters that model's context as an image
 * block; it is consumed here by the vision model and the answer comes back as
 * text, sidestepping the host's "does not accept image input" model-switch
 * guard without patching any shipped package.
 *
 * v2 (btw 插件升级)：默认网关切换为 opencode.ai/zen/go（deepseek-v4.1-flash
 * 真实看图，见 .workspace/opencode-deepseek-v4-flash-probe.md），认证改为
 * opencode 三头（authorization Bearer + x-api-key 同 key +
 * x-opencode-session 随机 UUID，缺一不可）。网关/模型/凭据/头部开关全部可配
 * （settings vision-adam 段，Config 见下）。另导出可复用函数
 * `analyzeImageBytes` / `resolveOptions` / `resolveApiKey`，供 btw 插件
 * （U-D/U-G-1 的图片分析）运行时导入复用；`analyze_image` 工具行为不变。
 */

/** Default gateway base; `/chat/completions` is appended (opencode.ai/zen/go). */
const DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1";
/** Default vision model id served by the opencode gateway (probe 实测可看图). */
const DEFAULT_MODEL = "deepseek-v4.1-flash";
/** Default credential reference resolved per operation. */
const DEFAULT_API_KEY_ENV = "OPENCODE_GO_API_KEY";
/** Default upper bound on generated tokens per analysis (probe 实测 ≥2000). */
const DEFAULT_MAX_TOKENS = 2000;
/** Default upper bound on image bytes read from disk (20 MiB). */
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
/** Default upper bound on video bytes read from disk (50 MiB). */
const DEFAULT_MAX_VIDEO_BYTES = 50 * 1024 * 1024;
/** Attribution header sent on every request. */
const USER_AGENT = "deepseek-harness/0.3.0 (vision-adam)";

/** Image extension → media type. */
const IMAGE_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif"
};

/** Video extension → media type, sent as a Zhipu-style `video_url` content part. */
const VIDEO_TYPES = {
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo"
};

const Config = z.object({
  apiKey: z.string().role("secret"),
  apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
  baseURL: z.string().default(DEFAULT_BASE_URL),
  model: z.string().default(DEFAULT_MODEL),
  maxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS),
  maxBytes: z.number().step(1).min(1).default(DEFAULT_MAX_BYTES),
  maxVideoBytes: z.number().step(1).min(1).default(DEFAULT_MAX_VIDEO_BYTES),
  /** Send `x-api-key: <same key>` on every request (opencode three-header auth). */
  xApiKey: z.boolean().default(true),
  /** Send `x-opencode-session: <random UUID>` on every request (opencode three-header auth). */
  sessionHeader: z.boolean().default(true)
});

/** Settings namespace carrying this plugin's endpoint, model, and key reference. */
const VISION_ADAM_SETTINGS_NAMESPACE = settingsNamespace("vision-adam");

/**
 * Resolve one settings section into the options the tool serves its next call
 * with. Pure function of `config` only: credential/header resolution happens
 * in `resolveApiKey` / `analyzeImageBytes`. Old configs that only set
 * `{model, maxTokens}` stay valid — every other field falls back to its new
 * default (opencode gateway / deepseek-v4.1-flash / OPENCODE_GO_API_KEY).
 */
function resolveOptions(config) {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
  const literalApiKey = config.apiKey !== void 0 && config.apiKey.length > 0 ? config.apiKey : void 0;
  return {
    apiKeyEnv,
    ...literalApiKey === void 0 ? {} : { apiKey: literalApiKey },
    baseURL: config.baseURL ?? DEFAULT_BASE_URL,
    model: config.model ?? DEFAULT_MODEL,
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    maxBytes: config.maxBytes ?? DEFAULT_MAX_BYTES,
    maxVideoBytes: config.maxVideoBytes ?? DEFAULT_MAX_VIDEO_BYTES,
    xApiKey: config.xApiKey ?? true,
    sessionHeader: config.sessionHeader ?? true
  };
}

/** Resolve the API key from the literal setting, credentials service, or launch environment. */
async function resolveApiKey(options, ctx, signal) {
  if (options.apiKey !== void 0 && options.apiKey.length > 0) return options.apiKey;
  const credentials = ctx.get("credentials");
  let resolved;
  if (credentials !== void 0) {
    resolved = (await credentials.resolve(options.apiKeyEnv))?.value;
  } else {
    const ambient = launchEnvironmentOf(ctx).get(options.apiKeyEnv);
    resolved = ambient !== void 0 && ambient.value.length > 0 ? ambient.value : void 0;
  }
  if (signal?.aborted === true) throw new Error("image analysis aborted");
  if (resolved !== void 0 && resolved.length > 0) return resolved;
  throw new Error(`vision-adam has no API key for "${options.apiKeyEnv}"; store it through the credentials service, export it in the launching environment, or set a literal "apiKey" in the vision-adam config`);
}

/** Session cwd from the tool-execution context. */
function sessionCwd(exec) {
  return exec.agent?.session?.header?.cwd;
}

/** Resolution options shared with the filesystem backend. */
function sessionResolveOptions(exec) {
  const cwd = sessionCwd(exec);
  return {
    ...cwd !== void 0 ? { cwd } : {},
    signal: exec.signal
  };
}

/**
 * One chat-completions call carrying a single image or video content part.
 * Pure function: receives base64 bytes directly (no filesystem access), so it
 * is reusable from outside the tool path (btw 插件 U-D/U-G-1 的图片分析入口).
 *
 * Auth headers (opencode 三头，缺一不可；对 adam 网关无害——可经
 * `xApiKey: false` / `sessionHeader: false` 显式关闭):
 *   authorization: Bearer <key>
 *   x-api-key: <key>                                  (xApiKey !== false)
 *   x-opencode-session: <crypto.randomUUID()>         (sessionHeader !== false)
 */
async function analyzeImageBytes(options, apiKey, mediaType, base64, question, signal) {
  const isVideo = mediaType.startsWith("video/");
  const prompt = question !== void 0 && question.trim().length > 0
    ? `Analyze the attached ${isVideo ? "video" : "image"} and answer the following question. ${question.trim()} In any case, transcribe the entire visible content of the attached ${isVideo ? "video" : "image"} as completely as possible — all text verbatim, layout, colors, element positions, objects, and captions — and, if it is a UI, screenshot, or interface, also provide a concise aesthetic and design-rationale analysis covering color scheme, visual hierarchy, alignment, readability, and concrete improvement suggestions.`
    : isVideo
      ? "Transcribe the entire visible content of the attached video as completely as possible — all text verbatim, layout, colors, element positions, objects, and how the content changes over time — and, if it shows a UI, screenshot, or interface, also provide a concise aesthetic and design-rationale analysis covering color scheme, visual hierarchy, alignment, readability, and concrete improvement suggestions."
      : "Transcribe the entire visible content of the attached image as completely as possible — all text verbatim, layout, colors, element positions, objects, and captions — and, if it is a UI, screenshot, or interface, also provide a concise aesthetic and design-rationale analysis covering color scheme, visual hierarchy, alignment, readability, and concrete improvement suggestions.";
  const headers = {
    "authorization": `Bearer ${apiKey}`,
    ...options.xApiKey === false ? {} : { "x-api-key": apiKey },
    ...options.sessionHeader === false ? {} : { "x-opencode-session": randomUUID() },
    "content-type": "application/json",
    "user-agent": USER_AGENT
  };
  // 尾斜杠归一化（2026-09-17 加固）：`${baseURL}/chat/completions` 在 baseURL 带尾斜杠时
  // 会拼出 `/v1//chat/completions`（实测网关回 "Invalid URL (POST /v1//chat/completions)"，
  // 失败工具 analyze_image）。provider 侧因 OpenAI SDK 会切前导斜杠而无症状，
  // 这条手写拼接没有消重，必须自己归一。
  const baseURL = options.baseURL.replace(/\/+$/, "");
  const response = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: options.model,
      max_tokens: options.maxTokens,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          isVideo
            ? { type: "video_url", video_url: { url: `data:${mediaType};base64,${base64}` } }
            : { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } }
        ]
      }]
    }),
    ...signal !== void 0 ? { signal } : {}
  });
  if (!response.ok) {
    let message = `vision analysis error (HTTP ${response.status})`;
    try {
      const parsed = await response.json();
      const detail = typeof parsed.error === "string" ? parsed.error : parsed.error?.message ?? parsed.error;
      if (detail !== void 0 && detail.length > 0) message = detail;
    } catch {
      // non-JSON error body; keep the HTTP status message
    }
    throw new Error(message);
  }
  const data = await response.json();
  const message = data.choices?.[0]?.message;
  // Some gateway models exhaust the budget on reasoning and return an empty
  // `content`; fall back to `reasoning_content` so a valid analysis is never
  // reported as a failure.
  const content = typeof message?.content === "string" && message.content.trim().length > 0
    ? message.content
    : message?.reasoning_content;
  if (typeof content !== "string" || content.trim().length === 0) throw new Error(`vision model returned no text for the ${isVideo ? "video" : "image"}`);
  return content.trim();
}

/** Resolve a model-supplied path into read bytes, recording the observation. */
async function readImageBytes(ctx, exec, filePath, maxBytes) {
  const target = await ctx.fs.resolve(filePath, sessionResolveOptions(exec));
  const info = await ctx.fs.stat(target, exec.signal);
  if (info === void 0) {
    ctx.emit("fs/observed", target, { kind: "absent" }, exec);
    throw new Error(`cannot read "${target.displayPath}": not found`);
  }
  if (info.type !== "file") throw new Error(`cannot read "${target.displayPath}": not a regular file`);
  const data = await ctx.fs.readBytes(target, exec.signal, maxBytes);
  ctx.emit("fs/observed", target, { kind: "present", version: info.version }, exec);
  return data;
}

const inject = ["tools", "fs", "systemPrompt"];
const name = "vision-adam";

/** Register the image-analysis tool, its system-prompt hint, and settings. */
function apply(ctx, config) {
  let current = () => config;
  installSettingsSection(ctx, VISION_ADAM_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source;
    },
    onChange: () => {}
  });

  ctx.systemPrompt.section({
    name: "tool:analyze-image",
    order: 100,
    text: "Use the analyze_image tool to understand image and video files. It returns text (the file is sent to a vision model behind the scenes), so it works even when the current model cannot receive images directly. Prefer it whenever a task mentions an image or video file or asks about its content."
  });

  const options = () => resolveOptions(current());
  ctx.tools.register(defineTool({
    name: "analyze_image",
    description: "Analyze a PNG/JPEG/WebP/GIF image file or an MP4/M4V/WebM/MOV/MKV/AVI video file with a multimodal model and return a text description or answer. Returns text only, so it works with ANY model — including text-only models that cannot receive images directly. Use this whenever you need to understand what is in an image or video. The returned description prefers a complete transcription of the visible content (text, layout, colors, element positions) plus an aesthetic/design-rationale assessment when applicable.",
    parameters: {
      file_path: {
        type: "string",
        required: true,
        description: "Path to the image (PNG/JPEG/WebP/GIF) or video (MP4/M4V/WebM/MOV/MKV/AVI) file, resolved by the filesystem backend."
      },
      question: {
        type: "string",
        description: "Optional specific question about the image or video; omit for a general description."
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: {
            type: "string",
            required: true
          }
        }
      },
      render: (_args, value) => [{
        type: "text",
        text: value.text
      }]
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.file_path.trim().length === 0) throw new Error("file_path must be a non-empty string");
      const ext = extname(args.file_path).toLowerCase();
      const mediaType = IMAGE_TYPES[ext] ?? VIDEO_TYPES[ext];
      if (mediaType === void 0) throw new Error(`cannot analyze "${args.file_path}": analyze_image accepts PNG/JPEG/WebP/GIF images and MP4/M4V/WebM/MOV/MKV/AVI videos`);
      const opts = options();
      const apiKey = await resolveApiKey(opts, ctx, exec.signal);
      const data = await readImageBytes(ctx, exec, args.file_path, mediaType.startsWith("video/") ? opts.maxVideoBytes : opts.maxBytes);
      const base64 = Buffer.from(data).toString("base64");
      const text = await analyzeImageBytes(opts, apiKey, mediaType, base64, args.question, exec.signal);
      return { text };
    }
  }));
}

export {
  Config,
  VISION_ADAM_SETTINGS_NAMESPACE,
  IMAGE_TYPES,
  VIDEO_TYPES,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_API_KEY_ENV,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_VIDEO_BYTES,
  resolveOptions,
  resolveApiKey,
  analyzeImageBytes,
  apply,
  inject,
  name
};
