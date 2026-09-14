# @local/dsh-wallpaper

[English](README.md) | [简体中文](README.zh-CN.md)

Static image wallpaper for the DeepSeek Harness Web profile — a local fork of
[@frog755/dsh-wallpaper](https://github.com/Frog755/dsh-wallpaper) 0.4.0 (MIT),
adapted for a local DSH **0.1.1-rc.2** deployment.

`@local/dsh-wallpaper` adds one settings row under **Settings → General**:

- pick an editing target: **global default**, **home**, **session**, or
  **settings** page, each page optionally overriding the global wallpaper;
- three image sources: file upload (PNG / JPG / WebP / GIF, ≤ 10 MB, stored as
  the original file), a remote `http(s)` URL, or a local absolute path (copied
  into the wallpaper directory — never served in place);
- tune a **dark mask** over the image, surface **opacity**, and **blur**;
- remove the wallpaper or clear a page override at any time.

Images are stored under `~/.dsh/wallpapers/` and served from a private loopback
route. Configuration — the global default and per-page overrides — persists in
the host user-settings document (`~/.dsh/settings.yaml`, `wallpaper` namespace),
so every browser sees the same wallpaper and changes land live.

## Differences from upstream 0.4.0

- **MP4 / ffmpeg video support removed** — this fork is static images only.
- **The fixed port-9191 webserver patch is removed** — this deployment serves
  the GUI on its own port, and persistence no longer depends on browser
  `localStorage`, so a pinned origin is unnecessary.
- **Images are no longer compressed to data URLs in browser storage.** Uploads
  stream to `~/.dsh/wallpapers/<uuid>.<ext>` (original bytes, ≤ 10 MB) and the
  wallpaper references the media route URL.
- **Persistence moved to `settings.yaml`** (upstream: `localStorage` +
  `~/.dsh/wallpapers/settings.json`): the host half registers the `wallpaper`
  settings namespace; the browser half binds it through the `settingsScope`
  service, so settings are shared across browsers and update live.
- **Per-page overrides, a dark mask layer, and URL / absolute-path sources**
  are new features (see the audit contract this fork implements).

## Requirements

- DeepSeek Harness **0.1.1-rc.2** with the Web profile; peer dependencies
  (`react`, `@deepseek-ai/cordis`, `@deepseek-ai/schemastery`,
  `@deepseek-ai/dsh-settings`, and the `dsh-client-*` packages) are provided by
  the DSH host installation.
- No external tools (no ffmpeg).

## Install (this deployment)

Run the bundled installer from the package directory:

```bash
bash install.sh
```

It copies the package to `~/.dsh/profiles/node_modules/@local/dsh-wallpaper`
(the flat fallback module directory, following the `~/.dsh/install-plugins.sh`
pattern) and appends the activation entry to
`~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: wallpaper
      name: '@local/dsh-wallpaper'
```

Restart `npx @deepseek-ai/dsh web`, then open **Settings → General → Wallpaper**.

## Settings schema (`~/.dsh/settings.yaml`)

```yaml
wallpaper:
  global:
    source: /dsh-wallpaper/media/<uuid>.png   # media URL, http(s) URL, or null
    darkMask: 0        # 0..1 dark overlay over the image
    opacity: 0.8       # 0..1 surface (base token) translucency
    blur: 0            # 0..60 px wallpaper blur
  pages:
    home:      { ... }   # optional override; absent pages fall back to global
    session:   { ... }
    settings:  { ... }
```

## What is persisted

- `~/.dsh/settings.yaml` (`wallpaper` namespace): the configuration above,
  shared by every browser.
- `~/.dsh/wallpapers/`: the image files themselves. Replacing or removing a
  wallpaper deletes its file once no target references it; startup reaps
  unreferenced files.
- No `localStorage` keys; no browser-local state.

If the settings service is unavailable, the settings row degrades to read-only
instead of failing.

## Development

The client bundle uses DSH's `window.__ModuleLoader__.load` format, so no build
step is needed. It is served by `dsh-client-modules`; `dsh-client-hmr` watches
its content and sends a rebuilt notification to the browser when it changes.

## Attribution

Upstream plugin: [@frog755/dsh-wallpaper](https://github.com/Frog755/dsh-wallpaper)
(MIT, © 2026 KinGao294 / Frog755), which itself derives from the wallpaper
component of [KinGao294/dsh-skin](https://github.com/KinGao294/dsh-skin). The
original copyright notices are retained in [LICENSE](LICENSE).
