// @local/dsh-wallpaper -- browser half for DeepSeek Harness.
// Fork of @frog755/dsh-wallpaper (MIT): static images only (no MP4), per-page
// wallpaper overrides, a dark mask layer, URL / absolute-path sources, and
// persistence through the host settings document (settings.yaml, `wallpaper`
// namespace) via the settingsScope service instead of localStorage.
// The bundle uses DSH's lazy-CJS module table, matching the shipped ui-* shape.
window.__ModuleLoader__.load({
  id: "@local/dsh-wallpaper",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const jsx = require("react/jsx-runtime");
    const React = require("react");
    const runtime = require("@deepseek-ai/dsh-client-runtime/client");

    const SETTINGS_NS = "settings.wallpaper";
    const WALLPAPER_NAMESPACE = "wallpaper";
    const MEDIA_ROUTE = "/dsh-wallpaper/media";
    const MEDIA_URL_PATTERN = /^\/dsh-wallpaper\/media\/([a-f0-9-]+\.(?:png|jpe?g|webp|gif))$/i;
    const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
    const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    const ACCEPT_ATTRIBUTE = ".png,.jpg,.jpeg,.webp,.gif";
    const OVERRIDE_SOURCE = "dsh-wallpaper:surface";
    const BASE = { light: "rgb(255, 255, 255)", dark: "rgb(21, 21, 23)" };
    const PAGES = ["home", "session", "settings"];
    const DEFAULT_GLOBAL = { source: null, darkMask: 0, opacity: 0.8, blur: 0 };

    const zh = {
      "background.title": "壁纸",
      "background.target": "配置目标",
      "background.target.global": "全局默认",
      "background.target.home": "首页",
      "background.target.session": "会话页",
      "background.target.settings": "设置页",
      "background.target.overridden": "（已覆盖）",
      "background.choose": "选择图片",
      "background.remove": "移除壁纸",
      "background.darkMask": "暗色遮罩",
      "background.opacity": "透明度",
      "background.blur": "模糊",
      "background.url.placeholder": "图片 URL（http/https）或本机绝对路径",
      "background.url.apply": "应用",
      "background.error.tooLarge": "图片不能超过 10 MB。",
      "background.error.unsupported": "请选择 PNG、JPG、WebP 或 GIF 图片。",
      "background.error.upload": "图片上传失败，请重试。",
      "background.error.url": "请输入 http(s) URL 或以 / 开头的本机绝对路径。",
      "background.error.import": "导入失败：路径不存在、不是受支持的图片或超过 10 MB。",
      "background.override.none": "此页面未设置覆盖，当前使用全局默认壁纸。",
      "background.override.create": "创建此页覆盖",
      "background.override.clear": "清除覆盖",
      "background.readonly": "设置服务不可用，壁纸配置为只读。",
      "background.loading": "正在读取壁纸设置...",
      "background.busy": "正在处理图片...",
      "background.hint": "壁纸配置（全局默认与各页覆盖）保存在 ~/.dsh/settings.yaml 的 wallpaper 节，对所有浏览器一致；图片文件保存在 ~/.dsh/wallpapers/。遮罩与透明度仅在有壁纸时生效。"
    };
    const en = {
      "background.title": "Wallpaper",
      "background.target": "Configure",
      "background.target.global": "Global default",
      "background.target.home": "Home",
      "background.target.session": "Session",
      "background.target.settings": "Settings",
      "background.target.overridden": " (overridden)",
      "background.choose": "Choose image",
      "background.remove": "Remove wallpaper",
      "background.darkMask": "Dark mask",
      "background.opacity": "Opacity",
      "background.blur": "Blur",
      "background.url.placeholder": "Image URL (http/https) or local absolute path",
      "background.url.apply": "Apply",
      "background.error.tooLarge": "Image must be 10 MB or smaller.",
      "background.error.unsupported": "Choose a PNG, JPG, WebP, or GIF image.",
      "background.error.upload": "Image upload failed. Try again.",
      "background.error.url": "Enter an http(s) URL or a local absolute path starting with /.",
      "background.error.import": "Import failed: path missing, unsupported image type, or larger than 10 MB.",
      "background.override.none": "This page has no override and currently uses the global default wallpaper.",
      "background.override.create": "Create page override",
      "background.override.clear": "Clear override",
      "background.readonly": "Settings service unavailable; wallpaper configuration is read-only.",
      "background.loading": "Loading wallpaper settings...",
      "background.busy": "Processing image...",
      "background.hint": "Wallpaper configuration (global default and per-page overrides) is stored in the wallpaper section of ~/.dsh/settings.yaml and shared by every browser; image files live under ~/.dsh/wallpapers/. Mask and opacity only apply while a wallpaper is set."
    };

    // ---------------------------------------------------------------- config

    function clampNumber(value, min, max, fallback) {
      return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
    }
    function normalizePage(value) {
      if (value === null || typeof value !== "object") return { ...DEFAULT_GLOBAL };
      return {
        source: typeof value.source === "string" && value.source.length > 0 ? value.source : null,
        darkMask: clampNumber(value.darkMask, 0, 1, 0),
        opacity: clampNumber(value.opacity, 0, 1, DEFAULT_GLOBAL.opacity),
        blur: clampNumber(value.blur, 0, 60, 0)
      };
    }
    function normalizePages(value) {
      const pages = {};
      if (value === null || typeof value !== "object") return pages;
      for (const page of PAGES) {
        if (value[page] !== undefined && value[page] !== null) pages[page] = normalizePage(value[page]);
      }
      return pages;
    }
    /** resolveOverride(page) = pages[page] ?? global (audit §5.2 / U6). */
    function resolveOverride(value, page) {
      const pages = normalizePages(value?.pages);
      return pages[page] ?? normalizePage(value?.global);
    }
    function referencedMediaNames(value) {
      const names = new Set();
      const global = normalizePage(value?.global);
      const name = mediaNameFromUrl(global.source);
      if (name !== null) names.add(name);
      for (const page of Object.values(normalizePages(value?.pages))) {
        const pageName = mediaNameFromUrl(page.source);
        if (pageName !== null) names.add(pageName);
      }
      return [...names];
    }
    function isReferenced(url, value) {
      const name = mediaNameFromUrl(url);
      if (name === null) return true; // not a media file; nothing to delete anyway
      return referencedMediaNames(value).includes(name);
    }

    // ------------------------------------------------------------- wallpaper

    let wallpaperEl = null;
    let maskEl = null;
    let cssEl = null;
    let overrideDispose = null;
    let shading = false;

    function ensureWallpaperCss() {
      if (cssEl !== null && document.head.contains(cssEl)) return;
      cssEl = document.createElement("style");
      // The desktop shell paints the base token twice. Remove the inner layer
      // so the backdrop remains visible without making message surfaces faint.
      // The extra rules make every column of the three-column shell share the
      // exact same background as the main area, so the wallpaper (and the flat
      // theme base when no wallpaper is set) runs seamlessly across the DSH
      // sidebar, the conversation column, and third-party side panels such as
      // dsh-better-sidebar:
      //  - the sidebar column/title-row fill is transparent, so it reveals the
      //    frame background (--dsw-alias-bg-base) that the main area shows;
      //  - the better-sidebar panel root paints that same base background, and
      //    its pane/tab-bar layers stay transparent, so they do not double-blend
      //    into a different shade.
      cssEl.textContent = [
        "[data-phase]:not(textarea){background:transparent!important}",
        "body{--dsw-specific-sidebar-fill:transparent!important}",
        // On desktop (win32/darwin) the layout shell paints the sidebar column
        // with a color-mix that makes it transparent when the fill token is
        // transparent, revealing the native acrylic instead of the wallpaper.
        // Override it to the same translucent base as the centre column so the
        // wallpaper runs uniformly across the entire window.
        'html[data-dsh-desktop-platform="win32"] [class$="_sidebarCol"],html[data-dsh-desktop-platform="darwin"] [class$="_sidebarCol"]{background:var(--dsw-alias-bg-base)!important}',
        "[data-dsh-better-sidebar]>[class$=\"_panel\"],[data-dsh-better-sidebar]>[class$=\"ottomPanel\"]{background:var(--dsw-alias-bg-base)!important}",
        "[data-dsh-better-sidebar] [class$=\"_pane\"]{background:transparent!important}",
        "[data-dsh-better-sidebar] [class$=\"_tabBar\"]{background:transparent!important}"
      ].join("");
      document.head.append(cssEl);
    }
    function toRgba(color, alpha) {
      const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
      if (hex !== null) {
        let digits = hex[1];
        if (digits.length === 3) digits = digits.split("").map((item) => item + item).join("");
        const value = parseInt(digits, 16);
        return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
      }
      const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color.trim());
      return rgb === null ? color.trim() : `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;
    }
    function resolveBase(snapshot, scheme) {
      const token = snapshot.active?.tokens?.["--dsw-alias-bg-base"];
      return snapshot.active?.colorScheme === scheme && typeof token === "string" ? token : BASE[scheme];
    }
    function shadeTokens(ctx, opacity) {
      if (shading) return;
      shading = true;
      try {
        const snapshot = ctx.theme.getTheme();
        overrideDispose?.();
        overrideDispose = ctx.theme.overrideTokens(OVERRIDE_SOURCE, {
          "--dsw-alias-bg-base": {
            light: toRgba(resolveBase(snapshot, "light"), opacity),
            dark: toRgba(resolveBase(snapshot, "dark"), opacity)
          }
        });
      } finally {
        shading = false;
      }
    }
    function releaseWallpaperElement() {
      wallpaperEl?.remove();
      wallpaperEl = null;
    }
    function releaseMaskElement() {
      maskEl?.remove();
      maskEl = null;
    }
    function createWallpaperElement() {
      const element = document.createElement("div");
      element.style.cssText = "position:fixed;inset:0;z-index:-1;pointer-events:none;width:100%;height:100%;background-size:cover;background-position:center;background-repeat:no-repeat;";
      document.body.prepend(element);
      return element;
    }
    /** The dark mask sits above the wallpaper (DOM order, same z-index) and
     *  below the UI, tinting the image without touching surface tokens. */
    function ensureMaskElement() {
      if (wallpaperEl === null) return;
      if (maskEl === null) {
        maskEl = document.createElement("div");
        maskEl.style.cssText = "position:fixed;inset:0;z-index:-1;pointer-events:none;width:100%;height:100%;";
        wallpaperEl.after(maskEl);
      } else if (maskEl.previousSibling !== wallpaperEl) {
        wallpaperEl.after(maskEl);
      }
    }
    function applyWallpaper(ctx, config) {
      if (config.source === null) {
        releaseWallpaperElement();
        releaseMaskElement();
        // No wallpaper: remove both the translucent base-token shading AND the
        // surface CSS, returning the UI to its stock opaque appearance.
        overrideDispose?.();
        overrideDispose = null;
        cssEl?.remove();
        cssEl = null;
        return;
      }
      ensureWallpaperCss();
      if (wallpaperEl === null || !document.body.contains(wallpaperEl)) {
        releaseWallpaperElement();
        wallpaperEl = createWallpaperElement();
      }
      wallpaperEl.style.backgroundImage = `url("${config.source}")`;
      const blur = clampNumber(config.blur, 0, 60, 0);
      wallpaperEl.style.filter = blur > 0 ? `blur(${blur}px)` : "none";
      const darkMask = clampNumber(config.darkMask, 0, 1, 0);
      if (darkMask > 0) {
        ensureMaskElement();
        maskEl.style.background = `rgba(0, 0, 0, ${darkMask})`;
      } else {
        releaseMaskElement();
      }
      shadeTokens(ctx, clampNumber(config.opacity, 0, 1, DEFAULT_GLOBAL.opacity));
    }
    function teardownWallpaper() {
      releaseWallpaperElement();
      releaseMaskElement();
      cssEl?.remove();
      cssEl = null;
      overrideDispose?.();
      overrideDispose = null;
    }

    // ----------------------------------------------------------------- media

    function mediaNameFromUrl(url) {
      const match = MEDIA_URL_PATTERN.exec(url ?? "");
      return match === null ? null : match[1];
    }
    async function deleteMedia(url) {
      if (mediaNameFromUrl(url) === null) return;
      await fetch(url, { method: "DELETE" }).catch(() => {});
    }
    async function uploadImage(file) {
      const response = await fetch(`${MEDIA_ROUTE}/upload`, {
        method: "POST",
        headers: { "content-type": file.type },
        body: file
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || typeof result.url !== "string") throw new Error(typeof result.error === "string" ? result.error : "Image upload failed.");
      return result.url;
    }
    async function importImage(path) {
      const response = await fetch(`${MEDIA_ROUTE}/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || typeof result.url !== "string") throw new Error(typeof result.error === "string" ? result.error : "Image import failed.");
      return result.url;
    }
    async function cleanupMedia(keepNames) {
      await fetch(`${MEDIA_ROUTE}/cleanup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keep: keepNames })
      }).catch(() => {});
    }

    // ----------------------------------------------------------------- store

    // The settings row binds to this store; it mirrors the settingsScope
    // snapshot (status + resolved wallpaper section) so every browser sees the
    // same configuration and updates land live.
    function createStore() {
      return runtime.defineStore({
        init: () => ({ status: "loading", global: normalizePage(null), pages: {}, revision: -1 }),
        actions: {
          sync: (draft, snapshot) => {
            draft.status = snapshot.status;
            draft.global = normalizePage(snapshot.value?.global);
            draft.pages = normalizePages(snapshot.value?.pages);
            draft.revision = snapshot.revision ?? -1;
          }
        }
      });
    }

    // ----------------------------------------------------- page + apply state

    // DSH Web is a three-column SPA without a router. "Page" is a three-state
    // signal (audit §3.5): home = no current session, session = a current
    // session, settings = this plugin's settings row is mounted (the row only
    // mounts while the settings modal's General section is open).
    let pageState = { current: undefined, settingsOpen: false };
    let latestValue = null;
    let scopeRef = null;
    let cleanupDone = false;

    function currentPage() {
      if (pageState.settingsOpen) return "settings";
      return pageState.current === undefined || pageState.current === null ? "home" : "session";
    }
    function applyCurrent(ctx) {
      applyWallpaper(ctx, resolveOverride(latestValue, currentPage()));
    }

    // ------------------------------------------------------------------ rows

    const styles = {
      group: { borderBottom: "1px solid var(--dsw-alias-border-l2)", display: "flex", flexDirection: "column", gap: "10px", padding: "16px 0" },
      title: { color: "var(--dsw-alias-label-primary)", fontSize: "14px", fontWeight: 400, lineHeight: "22px" },
      hint: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", lineHeight: "18px" },
      button: { height: "32px", padding: "0 14px", borderRadius: "8px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-button-elevated-fill)", color: "var(--dsw-alias-label-primary)", cursor: "pointer", font: "inherit", fontSize: "13px", boxSizing: "border-box" },
      buttonDanger: { color: "var(--dsw-alias-state-error-primary)" },
      select: { height: "32px", padding: "0 10px", borderRadius: "8px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-button-elevated-fill)", color: "var(--dsw-alias-label-primary)", font: "inherit", fontSize: "13px", boxSizing: "border-box" },
      input: { flex: 1, height: "32px", padding: "0 10px", borderRadius: "8px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", font: "inherit", fontSize: "13px", boxSizing: "border-box", minWidth: "0" },
      preview: { width: "72px", height: "44px", objectFit: "cover", borderRadius: "6px", border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-fill-tertiary, rgba(127,127,127,0.15))" },
      error: { color: "var(--dsw-alias-state-error-primary)", fontSize: "12px", lineHeight: "18px" },
      actionRow: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" },
      sliderRow: { display: "flex", alignItems: "center", gap: "10px", minWidth: "240px" },
      sliderLabel: { color: "var(--dsw-alias-label-secondary)", fontSize: "13px", whiteSpace: "nowrap", width: "72px" },
      slider: { flex: 1, accentColor: "var(--dsw-alias-brand-primary)" },
      sliderValue: { color: "var(--dsw-alias-label-secondary)", fontSize: "12px", whiteSpace: "nowrap", width: "44px", textAlign: "right" }
    };

    function Slider({ label, value, min, max, step, format, disabled, onChange }) {
      const [current, setCurrent] = React.useState(value);
      React.useEffect(() => { setCurrent(value); }, [value]);
      const commit = (event) => {
        const next = Number(event.currentTarget.value);
        setCurrent(next);
        onChange(next);
      };
      return jsx.jsxs("div", { style: styles.sliderRow, children: [
        jsx.jsx("span", { style: styles.sliderLabel, children: label }),
        jsx.jsx("input", { type: "range", min, max, step, value: current, disabled, style: styles.slider, onInput: commit, onChange: commit }),
        jsx.jsx("span", { style: styles.sliderValue, children: format(current) })
      ] });
    }

    function WallpaperRow({ t, useStore, notifySettingsOpen, setSource, setValue, createOverride, clearOverride, isWritable }) {
      const status = useStore((state) => state.status);
      const globalConfig = useStore((state) => state.global);
      const pages = useStore((state) => state.pages);
      const [target, setTarget] = React.useState("global");
      const [error, setError] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [urlValue, setUrlValue] = React.useState("");
      const inputRef = React.useRef(null);

      // Settings-page signal (U12): this row mounts only while the settings
      // modal's General section is open, so its mount/unmount is the page
      // detector. Caveat (audit §3.5): switching to another settings section
      // unmounts the row and falls back to session/home wallpaper.
      React.useEffect(() => {
        notifySettingsOpen(true);
        return () => notifySettingsOpen(false);
      }, []);

      const readOnly = status !== "ready" || !isWritable();
      const readOnlyNotice = status === "loading" ? t("background.loading") : readOnly ? t("background.readonly") : null;
      const isPage = target !== "global";
      const override = isPage ? pages[target] : undefined;
      const config = isPage ? (override ?? globalConfig) : globalConfig;
      const controlsDisabled = readOnly || busy || (isPage && override === undefined);

      const onFile = (event) => {
        const file = event.target.files?.[0];
        if (file === undefined || busy) return;
        setError(null);
        if (!IMAGE_MIME_TYPES.includes(file.type)) {
          setError(t("background.error.unsupported"));
        } else if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
          setError(t("background.error.tooLarge"));
        } else {
          setBusy(true);
          uploadImage(file)
            .then((url) => { setSource(target, url); })
            .catch((cause) => setError(cause instanceof Error && cause.message ? cause.message : t("background.error.upload")))
            .finally(() => setBusy(false));
        }
        event.target.value = "";
      };
      const onApplyUrl = () => {
        const value = urlValue.trim();
        setError(null);
        if (controlsDisabled) return;
        if (/^https?:\/\//i.test(value)) {
          setSource(target, value);
          setUrlValue("");
          return;
        }
        if (value.startsWith("/")) {
          setBusy(true);
          importImage(value)
            .then((url) => { setSource(target, url); setUrlValue(""); })
            .catch((cause) => setError(cause instanceof Error && cause.message ? cause.message : t("background.error.import")))
            .finally(() => setBusy(false));
          return;
        }
        setError(t("background.error.url"));
      };

      const targetOption = (id, labelKey) => jsx.jsxs("option", { value: id, children: [
        t(labelKey),
        id !== "global" && pages[id] !== undefined ? t("background.target.overridden") : ""
      ] });
      const preview = config.source === null ? null : jsx.jsx("img", { src: config.source, alt: "", style: styles.preview });
      return jsx.jsxs("div", { style: styles.group, children: [
        jsx.jsx("div", { style: styles.title, children: t("background.title") }),
        jsx.jsxs("div", { style: styles.actionRow, children: [
          jsx.jsx("span", { style: styles.sliderLabel, children: t("background.target") }),
          jsx.jsxs("select", { value: target, disabled: readOnly, style: styles.select, onChange: (event) => { setTarget(event.target.value); setError(null); }, children: [
            targetOption("global", "background.target.global"),
            targetOption("home", "background.target.home"),
            targetOption("session", "background.target.session"),
            targetOption("settings", "background.target.settings")
          ] })
        ] }),
        isPage && override === undefined && !readOnly ? jsx.jsx("div", { style: styles.hint, children: t("background.override.none") }) : null,
        jsx.jsxs("div", { style: styles.actionRow, children: [
          preview,
          jsx.jsx("button", { type: "button", disabled: controlsDisabled, style: styles.button, onClick: () => inputRef.current?.click(), children: t("background.choose") }),
          config.source !== null ? jsx.jsx("button", { type: "button", disabled: controlsDisabled, style: { ...styles.button, ...styles.buttonDanger }, onClick: () => { setSource(target, null); }, children: t("background.remove") }) : null,
          isPage && override !== undefined ? jsx.jsx("button", { type: "button", disabled: readOnly || busy, style: styles.button, onClick: () => { clearOverride(target); setError(null); }, children: t("background.override.clear") }) : null,
          isPage && override === undefined && !readOnly ? jsx.jsx("button", { type: "button", disabled: busy, style: styles.button, onClick: () => { createOverride(target); setError(null); }, children: t("background.override.create") }) : null,
          jsx.jsx("input", { ref: inputRef, type: "file", accept: ACCEPT_ATTRIBUTE, style: { display: "none" }, onChange: onFile })
        ] }),
        jsx.jsxs("div", { style: styles.actionRow, children: [
          jsx.jsx("input", { type: "text", value: urlValue, disabled: controlsDisabled, style: styles.input, placeholder: t("background.url.placeholder"), onChange: (event) => setUrlValue(event.target.value), onKeyDown: (event) => { if (event.key === "Enter") onApplyUrl(); } }),
          jsx.jsx("button", { type: "button", disabled: controlsDisabled, style: styles.button, onClick: onApplyUrl, children: t("background.url.apply") })
        ] }),
        busy ? jsx.jsx("div", { style: styles.hint, children: t("background.busy") }) : null,
        error !== null ? jsx.jsx("div", { style: styles.error, children: error }) : null,
        readOnlyNotice !== null ? jsx.jsx("div", { style: styles.hint, children: readOnlyNotice }) : null,
        jsx.jsx(Slider, { label: t("background.darkMask"), value: Math.round(config.darkMask * 100), min: 0, max: 100, step: 1, disabled: controlsDisabled, format: (value) => `${value}%`, onChange: (value) => setValue(target, "darkMask", Math.round(value) / 100) }),
        jsx.jsx(Slider, { label: t("background.opacity"), value: Math.round(config.opacity * 100), min: 0, max: 100, step: 1, disabled: controlsDisabled, format: (value) => `${value}%`, onChange: (value) => setValue(target, "opacity", Math.round(value) / 100) }),
        jsx.jsx(Slider, { label: t("background.blur"), value: Math.round(config.blur), min: 0, max: 60, step: 1, disabled: controlsDisabled, format: (value) => `${value}px`, onChange: (value) => setValue(target, "blur", Math.round(value)) }),
        jsx.jsx("div", { style: styles.hint, children: t("background.hint") })
      ] });
    }

    // ------------------------------------------------------- settings writes

    function createRowActions(ctx, scope) {
      const snapshotValue = () => ({
        global: normalizePage(latestValue?.global),
        pages: normalizePages(latestValue?.pages)
      });
      const commitField = (field, edit) => {
        const snapshot = scope.getSnapshot();
        if (snapshot.status !== "ready" || !snapshot.writable) return false;
        const value = snapshotValue();
        const removed = edit(value[field], value) ?? [];
        // Optimistic mirror: the scope snapshot (or a failed-write recovery)
        // re-syncs this shortly; applying now keeps slider drags flicker-free
        // and lets the next rapid write build on this value.
        latestValue = value;
        applyCurrent(ctx);
        scope.set(field, value[field]).catch(() => {
          // Failed write: roll the optimistic mirror back to the persisted
          // snapshot so the UI does not keep showing an unsaved value.
          const snap = scope.getSnapshot();
          latestValue = snap.value ?? null;
          applyCurrent(ctx);
        });
        for (const url of removed) {
          if (url !== null && typeof url === "string" && !isReferenced(url, value)) deleteMedia(url);
        }
        return true;
      };
      return {
        notifySettingsOpen: (open) => {
          if (pageState.settingsOpen === open) return;
          pageState.settingsOpen = open;
          applyCurrent(ctx);
        },
        setSource: (target, source) => commitField(target === "global" ? "global" : "pages", (draft, value) => {
          if (target === "global") {
            const removed = [value.global.source];
            draft.source = source;
            return removed;
          }
          const page = draft[target] ?? normalizePage(value.global);
          const removed = [page.source];
          draft[target] = { ...page, source };
          return removed;
        }),
        setValue: (target, key, value) => commitField(target === "global" ? "global" : "pages", (draft, whole) => {
          if (target === "global") {
            draft[key] = value;
            return [];
          }
          const page = draft[target] ?? normalizePage(whole.global);
          draft[target] = { ...page, [key]: value };
          return [];
        }),
        createOverride: (page) => commitField("pages", (draft, whole) => {
          if (draft[page] === undefined) draft[page] = normalizePage(whole.global);
          return [];
        }),
        clearOverride: (page) => commitField("pages", (draft) => {
          const removed = draft[page] === undefined ? [] : [draft[page].source];
          delete draft[page];
          return removed;
        }),
        isWritable: () => {
          const snapshot = scope.getSnapshot();
          return snapshot.status === "ready" && snapshot.writable;
        }
      };
    }

    // ---------------------------------------------------------------- apply

    const inject = ["slots", "locale", "theme", "settingsScope", "sessions"];
    function apply(ctx) {
      // Surface CSS is applied only while a wallpaper is actually shown
      // (see applyWallpaper), so an unset wallpaper keeps the stock opaque UI.
      const scope = ctx.settingsScope.bind({ namespace: WALLPAPER_NAMESPACE });
      scopeRef = scope;
      const store = createStore();
      let actions;
      const sync = () => {
        const snapshot = scope.getSnapshot();
        latestValue = snapshot.value ?? null;
        actions?.sync(snapshot);
        applyCurrent(ctx);
        // Reap orphaned media once the durable configuration is known: keep
        // every file referenced by global or any page override.
        if (!cleanupDone && snapshot.status === "ready") {
          cleanupDone = true;
          cleanupMedia(referencedMediaNames(latestValue));
        }
      };
      sync();
      ctx.effect(() => scope.subscribe(sync), "dsh-wallpaper: settings sync");
      pageState.current = ctx.sessions.list.getSnapshot().current;
      ctx.effect(() => ctx.sessions.list.subscribe(() => {
        pageState.current = ctx.sessions.list.getSnapshot().current;
        applyCurrent(ctx);
      }), "dsh-wallpaper: session page tracking");
      ctx.on("theme/change", () => applyCurrent(ctx));
      ctx.effect(() => () => teardownWallpaper(), "dsh-wallpaper: cleanup");
      ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), "dsh-wallpaper: locale");
      ctx.slots.inject("settings.general.item", () => ctx.slots.register({
        name: "settings.general.item",
        id: "wallpaper",
        order: 30,
        store,
        locale: SETTINGS_NS,
        inject: (bound) => {
          actions = bound;
          sync();
          return createRowActions(ctx, scope);
        }
      }, WallpaperRow));
    }

    exports.SETTINGS_NS = SETTINGS_NS;
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
