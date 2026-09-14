/**
 * @local/dsh-wallpaper -- host half.
 *
 * Fork of @frog755/dsh-wallpaper (MIT). Static image wallpapers only: the
 * upstream MP4 upload / ffmpeg transcoding path is removed in this fork.
 * Images are stored under ~/.dsh/wallpapers (MEDIA_ROOT) and served from a
 * private loopback route. Wallpaper configuration (global default plus
 * per-page overrides) persists in the host user-settings document
 * (~/.dsh/settings.yaml, `wallpaper` namespace) instead of the upstream
 * localStorage + settings.json pair.
 */
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import z from "@deepseek-ai/schemastery";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";

const MEDIA_ROOT = join(homedir(), ".dsh", "wallpapers");
const ROUTE = "/dsh-wallpaper/media";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// Uploaded / imported images are always re-named <uuid>.<ext>, so only these
// extensions are ever served. jpeg is normalized to jpg on write; the alias
// is accepted in the name pattern for robustness.
const IMAGE_MIME_TO_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const IMAGE_EXT_PATTERN = /\.(png|jpe?g|webp|gif)$/i;
const CONTENT_TYPE_BY_EXT = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

/** Settings namespace owned by this plugin (kebab-case, like plugin short names). */
const WALLPAPER_NAMESPACE = settingsNamespace("wallpaper");
/** One wallpaper target's effective configuration. */
const DEFAULT_GLOBAL = { source: null, darkMask: 0, opacity: 0.8, blur: 0 };
const PageSchema = z.object({
  // null = no wallpaper for this target (falls through to the page/layer logic).
  source: z.string().default(null),
  darkMask: z.percent().default(0),
  opacity: z.percent().default(0.8),
  blur: z.number().min(0).max(60).default(0)
});
// Object-typed fields auto-default to {} in schemastery, which would make
// every page key resolve as a present (source-less) override. The union
// wrapper carries no default, so an absent page key stays absent and falls
// back to `global`; an explicit null likewise means "no override".
const OptionalPageSchema = z.union([PageSchema, z.const(null)]);
/**
 * `wallpaper` section of the user-settings document:
 *   global: the default applied when a page has no override;
 *   pages: optional per-page overrides (home / session / settings); an absent
 *   page key inherits `global`.
 */
const WallpaperSettingsSchema = z.object({
  global: PageSchema.default(DEFAULT_GLOBAL),
  pages: z.object({
    session: OptionalPageSchema,
    settings: OptionalPageSchema,
    home: OptionalPageSchema
  }).default({})
});

function ensureMediaRoot() {
  mkdirSync(MEDIA_ROOT, { recursive: true });
}

function readJsonBody(req) {
  return new Promise((resolvePromise) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try { resolvePromise(JSON.parse(body)); } catch { resolvePromise(null); }
    });
    req.on("error", () => resolvePromise(null));
  });
}

/** Stream one request body into `output`, enforcing the image size cap. */
function writeUpload(req, output) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    let settled = false;
    let opened = false;
    const stream = createWriteStream(output, { flags: "wx" });
    stream.on("open", () => { opened = true; });
    const fail = (error) => {
      if (settled) return;
      settled = true;
      const removeFile = () => { try { rmSync(output, { force: true }); } catch {} };
      stream.once("close", removeFile);
      if (opened) {
        try { stream.destroy(); } catch {}
      } else {
        // The open is asynchronous: destroying now emits 'close' before the
        // file exists, so rmSync would miss the file the pending open still
        // creates afterwards (leaving an empty orphan). Wait for the open,
        // then destroy — 'close' then fires with the file on disk.
        stream.once("open", () => { try { stream.destroy(); } catch {} });
      }
      reject(error);
    };
    const done = () => {
      if (settled) return;
      settled = true;
      resolvePromise(size);
    };
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_IMAGE_BYTES) {
        const error = new Error("Image is larger than the 10 MB upload limit.");
        error.statusCode = 413;
        fail(error);
        return;
      }
      if (!stream.write(chunk)) req.pause();
    });
    stream.on("drain", () => req.resume());
    req.on("end", () => stream.end());
    req.on("error", fail);
    stream.on("error", fail);
    stream.on("finish", done);
  });
}

function json(res, status, value, closeRequest = false, req = null) {
  const payload = JSON.stringify(value);
  if (closeRequest && req !== null) {
    // The request body was abandoned mid-flight (size cap). Answer first,
    // then drop the connection once the response has flushed.
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(payload, () => { try { req.destroy(); } catch {} });
    return;
  }
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(payload);
}

function mediaNameFromPath(pathname) {
  const name = basename(pathname);
  return /^[a-f0-9-]+\.(png|jpe?g|webp|gif)$/i.test(name) ? name : null;
}

function contentTypeFor(name) {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";
}

function deleteMedia(name) {
  if (name === null) return false;
  const file = resolve(MEDIA_ROOT, name);
  if (!file.startsWith(resolve(MEDIA_ROOT)) || !existsSync(file)) return false;
  rmSync(file, { force: true });
  return true;
}

function normalizedExt(name) {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return ext === "jpeg" ? "jpg" : ext;
}

export const inject = ["webServer"];

export function apply(ctx) {
  ensureMediaRoot();
  // Register the durable `wallpaper` settings section when the optional
  // settings service is composed (same pattern as the local ui-theme host).
  ctx.inject(["settings"], (settingsCtx) => {
    settingsCtx.settings.register(WALLPAPER_NAMESPACE, WallpaperSettingsSchema);
  });
  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: ROUTE,
    async handler(req, res) {
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "POST" && url.pathname === `${ROUTE}/upload`) {
        const mime = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        const ext = IMAGE_MIME_TO_EXT[mime];
        if (ext === undefined) return json(res, 415, { error: "Only PNG, JPEG, WebP, and GIF uploads are supported." });
        const declaredLength = Number(req.headers["content-length"]);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
          return json(res, 413, { error: "Image is larger than the 10 MB upload limit." }, true, req);
        }
        const id = randomUUID();
        const output = join(MEDIA_ROOT, `${id}.${ext}`);
        try {
          await writeUpload(req, output);
          return json(res, 201, { url: `${ROUTE}/${id}.${ext}`, size: statSync(output).size });
        } catch (error) {
          const status = error instanceof Error && typeof error.statusCode === "number" ? error.statusCode : 500;
          if (status === 413) return json(res, status, { error: error instanceof Error ? error.message : "Image upload failed." }, true, req);
          return json(res, status, { error: error instanceof Error ? error.message : "Image upload failed." });
        }
      }
      if (req.method === "POST" && url.pathname === `${ROUTE}/import`) {
        const body = await readJsonBody(req);
        if (body === null || typeof body.path !== "string" || body.path.length === 0) {
          return json(res, 400, { error: "Invalid import request: expected a JSON body {path}." });
        }
        if (!isAbsolute(body.path)) {
          return json(res, 400, { error: "Import path must be absolute." });
        }
        const name = basename(body.path);
        if (!IMAGE_EXT_PATTERN.test(name)) {
          return json(res, 415, { error: "Only PNG, JPEG, WebP, and GIF files can be imported." });
        }
        let stats;
        try {
          stats = statSync(body.path);
        } catch {
          return json(res, 404, { error: "Import path does not exist." });
        }
        if (!stats.isFile()) {
          return json(res, 400, { error: "Import path is not a regular file." });
        }
        if (stats.size > MAX_IMAGE_BYTES) {
          return json(res, 413, { error: "Image is larger than the 10 MB import limit." });
        }
        const ext = normalizedExt(name);
        const id = randomUUID();
        const output = join(MEDIA_ROOT, `${id}.${ext}`);
        try {
          // Only ever a COPY into MEDIA_ROOT: the route never serves the
          // source path directly, so this cannot become an arbitrary file read.
          copyFileSync(body.path, output);
        } catch {
          return json(res, 500, { error: "Failed to copy the image into the wallpaper directory." });
        }
        return json(res, 201, { url: `${ROUTE}/${id}.${ext}`, size: statSync(output).size });
      }
      if (req.method === "POST" && url.pathname === `${ROUTE}/cleanup`) {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          try {
            const request = JSON.parse(body);
            const keep = new Set(Array.isArray(request.keep) ? request.keep.filter((name) => typeof name === "string") : []);
            let deleted = 0;
            for (const name of readdirSync(MEDIA_ROOT)) {
              if (/^[a-f0-9-]+\.(png|jpe?g|webp|gif)$/i.test(name) && !keep.has(name)) {
                rmSync(join(MEDIA_ROOT, name), { force: true });
                deleted += 1;
              }
            }
            json(res, 200, { deleted });
          } catch {
            json(res, 400, { error: "Invalid cleanup request." });
          }
        });
        return;
      }
      if (req.method === "DELETE") {
        const deleted = deleteMedia(mediaNameFromPath(url.pathname));
        return json(res, deleted ? 200 : 404, { deleted });
      }
      if (req.method === "GET") {
        const name = mediaNameFromPath(url.pathname);
        if (name === null) return json(res, 404, { error: "Not found." });
        const file = resolve(MEDIA_ROOT, name);
        if (!file.startsWith(resolve(MEDIA_ROOT)) || !existsSync(file)) return json(res, 404, { error: "Not found." });
        const stats = statSync(file);
        res.writeHead(200, { "content-type": contentTypeFor(name), "content-length": stats.size, "cache-control": "private, max-age=31536000, immutable" });
        createReadStream(file).pipe(res);
        return;
      }
      json(res, 405, { error: "Method not allowed." });
    }
  }), "dsh-wallpaper: media route");
}
