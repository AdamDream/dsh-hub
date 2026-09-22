# RECON — DSH Web GUI (http://127.0.0.1:3080) conditions-matrix levers

Read-only static recon (file reading + one read-only RPC + curl GET). No browser was launched.
Deployed client code root: `/home/CNS2026495165/.dsh/profiles/node_modules/` (all `file:line` below are under it unless stated).
Shell/HTML root: `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/`.

Global warning for every selector below: **there are no `data-testid` attributes anywhere in the deployed client plugins** (only `@deepseek-ai/dsh-client-ui-conversation/lib/client.js` mentions the literal string, not as a testid; a full scan of `@deepseek-ai/*/lib/*.js` + `@local/*/lib/*.js` gives no usable testid). All stable handles are `aria-*`, `role`, and CSS-module hash class suffixes (`[class$="_token"]`).

Second global warning: **the UI language follows `navigator.languages`** (`@deepseek-ai/dsh-client-locale/lib/client.js:1184-1200`: `resolveInitialLocale() → detectBrowserLocale()`, first shipped locale matching the primary subtag, else `"en"`). A headless Chromium defaulting to `en-US` renders **English** ("Settings"/"Close"/"Workspaces"), while the reporting user sees Chinese ("设置"/"关闭"). Prefer attribute selectors; if you use text, pin `locale: 'zh-CN'` on the browser context.

---

## 1. Settings entry + panel selectors

**Entry (trigger) button** — rendered by `@deepseek-ai/dsh-client-ui-settings-general/lib/client.js:203-212`, into the sidebar's `sidebar.settings` seat (`@deepseek-ai/dsh-client-ui-sidebar/lib/client.js:229-238`, seat class token `hHd-Xa_settingsArea`, map at line 58):

```js
// preferred, locale-independent, unique (scoped to the sidebar settings seat)
const settingsButton = 'div[class$="_settingsArea"] button[aria-haspopup="dialog"]';
// minimal alternative (works, but NOT unique on a page with a session open —
// the context meter in the composer also uses aria-haspopup="dialog",
// @deepseek-ai/dsh-client-ui-conversation/lib/client.js:3144-3151, as does
// a message-feedback trigger, @deepseek-ai/dsh-client-ui-message-feedback/lib/client.js:555)
const settingsButtonAlt = 'button[aria-haspopup="dialog"]';
// build-stable hash class of the trigger (only if the build is unchanged)
const settingsButtonClass = 'button.VOzbGW_trigger';   // + .VOzbGW_rail when the sidebar is in rail mode
```

Facts:
* The trigger carries `aria-haspopup="dialog"` and `aria-expanded={open}` and **no `aria-label`/`title`/`data-*`** (client.js:203-212).
* Its *content* is icon + `<span class="UQsH_q_triggerLabel">设置</span>`, but the label span **only exists when the sidebar is wide** (`TriggerContent` client.js:254-258: `wide && <span…>`). So `getByText('设置')` fails in rail/auto-collapsed mode (`width < 1024`, `dsh-client-ui-layout/lib/client.js:13` `SIDEBAR_AUTO_COLLAPSE`). In rail mode the button has no accessible name at all.
* Click handler is `setOpen(true)` (idempotent), so double-clicking is harmless.
* Labels: `zh.trigger = "设置"`, `en.trigger = "Settings"` (client.js:437-453).

**Panel root** — `SettingsPanel`, client.js:112-168. Mounted only while open (client.js:213 `open && jsx(SettingsPanel…)`), so "panel exists in the DOM" **is** "panel is open":

```js
const settingsPanelVisible = 'div.VOzbGW_panel[role="dialog"][aria-modal="true"]';
// equivalent / belt-and-braces:
const settingsPanelVisibleAlt = '[aria-haspopup="dialog"][aria-expanded="true"]';
```

DOM shape: `div.VOzbGW_overlay[role="presentation"]` › (`div.VOzbGW_mask[aria-hidden="true"]`, `div.VOzbGW_panel[role="dialog"][aria-modal="true"][aria-labelledby=<useId>]`). Class map: client.js:37-57. CSS (client.js CSS blob): `.VOzbGW_overlay{z-index:1000;position:fixed;inset:0;display:flex;justify-content:center;align-items:center}`, `.VOzbGW_mask{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur)}`, `.VOzbGW_panel{z-index:1;width:800px;max-width:calc(100vw - 48px);height:min(800px,100vh - 48px);background:var(--dsw-alias-bg-layer-2);border-radius:24px}`. **No open animation/transition** → the panel is paintable in the same frame it mounts. `--dsw-mask-blur: blur(2px)` and `--dsw-alias-bg-mask-1: #0000003d` (light) / `#00000080` (dark) come from `@deepseek-ai/dsh-client-ui-theme/lib/client.js` token CSS — i.e. **opening the panel puts a full-viewport `backdrop-filter: blur(2px)` over the wallpaper**. That mask is an in-page-toggleable element (see §4).

**"Visible" test the experiment should use** (mount ≠ painted):

```js
await page.waitForFunction(() => {
  const p = document.querySelector('div.VOzbGW_panel[role="dialog"][aria-modal="true"]');
  if (!p) return false;
  const r = p.getBoundingClientRect();
  const s = getComputedStyle(p);
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
});
```

Extra ready-signal: the panel **moves focus to its close button on mount** (`closeButton.current?.focus()`, client.js:108-111), so `document.activeElement` inside `.VOzbGW_panel` is a byte-level proof the panel mounted.

**Close paths** (all three in client.js:92-119, 152-161):
```js
const settingsClose = 'div.VOzbGW_panel button.VOzbGW_close';  // header ✕ button, has a visually-hidden "关闭"/"Close" label (client.js:157-160, 273-275)
// alternatives:
await page.keyboard.press('Escape');                            // document-level keydown (client.js:99-107)
await page.locator('.VOzbGW_overlay > .VOzbGW_mask').click();   // mask click closes (client.js:115-119)
```

**What mounts when the panel opens** (this is the shape of the click→visible cost):
`SettingsPanel` resolves the active section as `activeId ?? rows[0].id` (client.js:97), and rows are sorted by `order` (client.js:502-507). Registered sections: `general` order 0 (settings-general client.js:586-589), `models` order 10, `plugins` order 15. **So the General section mounts on the very first open**, which mounts every `settings.general.item`: the theme `appearance` row (order 10, `@deepseek-ai/dsh-client-ui-theme/lib/client.js:1341-1349`) and the wallpaper row (order 30, `@local/dsh-wallpaper/lib/client.js:591-602`). The wallpaper row's mount effect sets the plugin's "page = settings" signal (see §4). The `@local/dsh-usage` card is registered into `settings.plugin.item` (`@local/dsh-usage/lib/client.js:1232-1242`), which is dispatched **only inside the Plugins section's configurable tab** (`@deepseek-ai/dsh-client-ui-settings-plugins/lib/client.js:399-408, 913-923`) — it is **not** mounted by opening the panel on the General section.

---

## 2. Sidebar session row selector

Session rows are rendered by `@deepseek-ai/dsh-client-ui-workspace/lib/client.js` (`SessionNodeItem`, 693-790; row element 717-724):

```js
const sessionRow       = 'div[role="tree"] div[role="treeitem"][aria-selected]';   // one row per top-level session
const sessionRowTitle  = 'span.YDXeBa_title';                                     // inside that row
const sessionActive    = 'div.YDXeBa_sessionRow[aria-selected="true"]';           // "open/active" session
```

* `"open/active"` = `aria-selected="true"` (and the extra class `YDXeBa_selected`, map line 372-373). Row click → `onOpen(node.id)` (line 722-724).
* There is **no `data-session-id`**: identify a row by its title text (`span.YDXeBa_title`) — the title is `displayTitle` / `"New Session"` for the blank provisional row (`sessionTitle`, 108-110). Drag payload uses the raw id (`e.dataTransfer.setData("text/plain", node.id)`, 728) but that is DnD-only.
* Row actions (hover-only, `.YDXeBa_rowActions` `display:none` until `:hover`): rename/fork/archive menu anchored on `button[aria-label="会话“<title>”的操作"]` (`en`: `Session actions for <title>`, workspace client.js:775, 2259/2324).

**Grouping = by Host *Workspace entity*, not by raw cwd.** `groupByWorkspace` (147-164) iterates the `workspace.list` entities in host order and appends one synthetic `""` group for sessions that belong to no workspace; label = workspace title, or `未分组`/`Ungrouped` (`group.ungrouped`, 2217/2282). Groups with `workspaceId === undefined` have no header menu.

```js
const groupHeader        = 'div[role="tree"] div[role="treeitem"][aria-expanded]';  // project/workspace header row
const groupHeaderTitle   = 'span.YDXeBa_projectText span.YDXeBa_title';             // group label text
const groupHeaderExpanded= 'div.YDXeBa_projectRow[aria-expanded="true"]';
```
Header markup: `div.YDXeBa_projectRow[role="treeitem"][aria-expanded]` with `span.YDXeBa_folder|chevron`, `span.YDXeBa_projectText > span.YDXeBa_title`, plus `button[aria-label="工作区“<name>”的操作"]` (`Workspace actions for <name>`) and `button[aria-label="在“<name>”中新建会话"]` (`New session in <name>`) (client.js:469-536, labels 2258-2260/2323-2325). Clicking the header toggles expansion (1378-1385).

**Crucial for the experiment:** `deriveGroups` yields `sessions: expanded ? mapped : []` (191-211) and `TreeBody` maps `group.sessions` (1404-1451) — i.e. **a collapsed workspace group renders ZERO session rows** (and therefore no overflow button, since that button requires `group.sessions.length > 5`). Expansion state is persisted in the browser store `dsh.workspace.view.v5` (`groupExpansion`, client.js:26-59, `persist` at line 34; persistence impl `@deepseek-ai/dsh-client-runtime/lib/client.js:5436-5451`). The only auto-expansion is for the group containing the *current* session (1210-1219). So on a fresh page/profile the sidebar shows only ~12 group headers.

Steps to open an existing session read-only (per group): click the header, then click a row; only the first 5 rows render unless you click the expander (`button.YDXeBa_…` class token `sessionOverflowButton`, text `展开其余 {n} 个会话` / `Show {n} more`, 1452-1460; limit `COLLAPSED_SESSION_LIMIT = 5`, line 1039).

```js
await page.locator('div[role="tree"] div[role="treeitem"][aria-expanded="false"]').first().click();
await page.locator('div[role="tree"] div[role="treeitem"][aria-selected]').first().click();
```
Only sessions that pass `sessionVisible` are rendered: `origin !== "subagent"`, not archived, not blank (100-102).

---

## 3. Theme (light vs dark) — mechanism actually read by the deployed code

**Persistence: the Host user-settings document, not localStorage.**
* `/home/CNS2026495165/.dsh/settings.yaml:218-219` → `ui-theme:` / `preference: light`.
* Namespace/field/default: `@deepseek-ai/dsh-client-ui-theme/lib/index.js` (`THEME_SETTINGS_NAMESPACE = "ui-theme"`, `THEME_PREFERENCE_FIELD = "preference"`, `DEFAULT_PREFERENCE = "system"`, `THEME_PREFERENCES = ["light","dark","system"]`); client mirror at `lib/client.js:979-985`. The only write entry is `ThemeRuntime.setTheme` → settings scope (`lib/client.js:1130, 1169-1181`).
* **localStorage is NOT used for the theme**: 0 occurrences of `localStorage` in `dsh-client-ui-theme/lib/client.js` and in `dsh-client-ui-layout/lib/client.js`. (localStorage *is* used by the runtime's store persistence, `dsh-client-runtime/lib/client.js:5436-5451`, e.g. the sidebar view store key `dsh.workspace.view.v5` — seeding that changes expansion/grouping, never the palette.)

**DOM truth (what CSS actually keys on):**
* `document.documentElement.style.colorScheme` = `"light" | "dark"`
* `document.body` attribute `data-ds-dark-theme` — **present ⇔ dark** (`DARK_ATTRIBUTE`, `dsh-client-ui-layout/lib/client.js:344-345`; writer at 428-430, remover at 430/482).
* Palette comes from injected CSS, not inline tokens: `body{--dsw-static…;--dsw-alias…}` for light and `body[data-ds-dark-theme]{…}` for dark, both in `@deepseek-ai/dsh-client-ui-theme/lib/client.js` (`design-platform.css` / alias-token blobs, e.g. `--dsw-alias-bg-base:var(--dsw-static-neutral-bluish-00)` vs `…bluish-950`). `BUILTIN_THEMES` register **empty token sets** (`lib/client.js:998-1006`), so by default `ThemePresenter` writes **zero** inline custom properties.

**Which mechanism is read on a fresh load: a server-rendered inline boot script, per index request.** `@deepseek-ai/dsh-client-ui-theme/lib/index.js` (`bootThemeScript`/`bootThemeInjection`) injects a body script; verified live with `curl -s http://127.0.0.1:3080/`:

```html
<body><script>(() => { const preference = "light" …
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.body.toggleAttribute('data-ds-dark-theme', dark) })()</script>
  <div id="root"></div></body>
```
`preference` is literally `"light"` on the wire right now ⇒ **every fresh page starts light**, and has already been set before any client plugin runs. After plugin activation the same two DOM fields are owned by `ThemePresenter.apply` (`dsh-client-ui-layout/lib/client.js:408-450`).

**Answers to the "force it without clicking/without editing files" question:**
| Mechanism | Effective? | Evidence |
|---|---|---|
| Seeding `localStorage` before load | **No** — theme never touches localStorage | 0 hits of `localStorage` in ui-theme/ui-layout; boot value is server-injected |
| `page.emulateMedia({ colorScheme: 'dark' })` | **No, with the current persistence** — `prefers-color-scheme` is consulted only when `preference === "system"` | `dsh-client-ui-theme/lib/client.js:1238`: `resolvedId = this.preference === "system" ? (media?.matches ? "dark":"light") : this.preference`; media query only constructed/observed at 1131-1144. Current value is `light`, so the media query is *not even registered* as a listener dependency |
| URL param / route | **No routing exists at all** | no `pushState`/`location.hash`/`replaceState` in the shell bundle (`dist/assets/index-ClqxG24t.js`) |
| Click the in-page Appearance cubes | Yes, and it **persists** (host settings write) | `lib/client.js:83-91` (`button[aria-pressed]` × 3, `setTheme(id)`), write path 1169-1181 |
| **In-page DOM force (read-only alternative, no persistence, no file change)** | **Yes, partially — see caveat** | set `document.documentElement.style.colorScheme='dark'` + `document.body.setAttribute('data-ds-dark-theme','')` |

So the **only faithful full-mechanism path is changing the persisted `ui-theme.preference`** (Appearance cube click ⇒ settings.yaml write, or a direct settings write). There is no read-only alternative that reproduces a *true* dark theme; the closest read-only alternative is the DOM force above, with these caveats:

1. **Inline token gotcha:** with the wallpaper active, the wallpaper plugin stacks a theme override layer providing `--dsw-alias-bg-base` for both schemes (`@local/dsh-wallpaper/lib/client.js:190-211`), and `ThemePresenter` writes the *active-scheme* value **inline on `<body>`** (`dsh-client-ui-layout/lib/client.js:433-436`). After a manual attribute flip the inline value is still the light one (`rgba(255,255,255,0.88)`), and inline beats `body[data-ds-dark-theme]`. To get a faithful dark, also do `document.body.style.setProperty('--dsw-alias-bg-base','rgba(15,17,21,0.88)')` (the dark value `resolveBase(snapshot,'dark')` + `opacity 0.88`, wallpaper client.js:186-200), or remove the property (which also removes the wallpaper's translucency).
2. **Reversion risk:** on the next theme publish the presenter re-checks `landingIntact` (`dsh-client-ui-layout/lib/client.js:420-427, 460-467`); because the forced `colorScheme` no longer matches the snapshot, the check fails and the presenter rewrites the light landing (removing the dark attribute). Publishes fire on settings-revision change / theme registration / wallpaper override re-stack (`theme/change`), not on a timer — so an idle measurement window keeps the forced state, but **any settings write (including opening/closing the Settings panel via the wallpaper row) may revert it.** A fresh page load definitely reverts it (boot script).
3. Light is free (the default), so for the matrix prefer: `light` = natural; `dark` = in-page force **or** (recommended if you can accept one persisted write before the run) set `ui-theme.preference: dark`/`system` and use `emulateMedia` for A/B — that is the only way `prefers-color-scheme` becomes live (line 1238).

---

## 4. Wallpaper

**Configured: YES.** `/home/CNS2026495165/.dsh/settings.yaml:199-205`:
```yaml
wallpaper:
  global:
    source: /dsh-wallpaper/media/37758c1c-9ca8-47d2-bade-3048ab825fb6.png
    darkMask: 0
    opacity: 0.88
    blur: 0
```
* Served URL verified live: `GET /dsh-wallpaper/media/37758c1c-9ca8-47d2-bade-3048ab825fb6.png` → **200, 2 334 260 bytes, `image/png`**.
* Backing file: `/home/CNS2026495165/.dsh/wallpapers/37758c1c-9ca8-47d2-bade-3048ab825fb6.png` — PNG 1810×1279 RGB, 2.2 MB.
* Plugin `@local/dsh-wallpaper` is in the live boot manifest (checked in the served `__DSH_BOOT__` JSON).

**Injected DOM (b) layer / mask) — `@local/dsh-wallpaper/lib/client.js`:**
* (a) **Wallpaper layer**: `createWallpaperElement`, lines 220-225 — `document.createElement("div")` with
  `cssText = "position:fixed;inset:0;z-index:-1;pointer-events:none;width:100%;height:100%;background-size:cover;background-position:center;background-repeat:no-repeat;"`, inserted with **`document.body.prepend(element)`** (so it precedes `#root`). Style writes afterwards: `style.backgroundImage = url("<source>")` (255) and `style.filter = blur>0 ? blur(..) : "none"` (257).
  **No id, no class, no data attribute** ⇒ select by the serialized inline style:
  ```js
  const wallpaperLayer = 'body > div[style*="background-size: cover"]';   // unique: nothing else uses cover
  // runtime bullet-proof fallback:
  // [...document.body.children].find(el => /background-size:\s*cover/.test(el.getAttribute('style')||''))
  ```
* (b) **Mask/overlay layer of this plugin**: `ensureMaskElement`, lines 226-237 — a second `div` with the same `position:fixed;inset:0;z-index:-1;pointer-events:none;width:100%;height:100%;` inserted **after** the wallpaper layer, whose background is `rgba(0,0,0,darkMask)`. It is created **only when `darkMask > 0`** and is otherwise removed (258-264). **With `darkMask: 0` the mask element does not exist at all.**
  ```js
  const wallpaperMask = 'body > div[style*="z-index: -1"]:not([style*="background-size: cover"])';  // currently matches nothing
  ```
* **The actual "frost" is not a DOM overlay**: it is a theme token override — `shadeTokens` (190-211) calls `ctx.theme.overrideTokens("--dsw-alias-bg-base", { light: rgba(baseLight,0.88), dark: rgba(baseDark,0.88) })`, and the presenter then writes that one property inline on `<body>`. So the dimming/haze selector is simply `body[style*="--dsw-alias-bg-base"]`, and its in-page neutralization is `document.body.style.removeProperty('--dsw-alias-bg-base')`.
* Surface CSS the plugin also injects (as a `<style>` tag, 138-167) that matters for measurements: `[data-phase]:not(textarea){background:transparent!important}`, `body{--dsw-specific-sidebar-fill:transparent!important}`, plus better-sidebar/desktop-column overrides.
* **Second, independent mask layer worth a condition:** the Settings modal's own mask `div.VOzbGW_overlay > div.VOzbGW_mask` carries `backdrop-filter: var(--dsw-mask-blur)` = `blur(2px)` over the whole viewport, on top of the wallpaper image. In-page neutralization: `document.querySelector('.VOzbGW_overlay > .VOzbGW_mask').style.backdropFilter = 'none'` (and `background:'transparent'` to drop the `#0000003d` dimming).

**Is removing them a pure in-page DOM operation?** Yes for the DOM nodes: no persistence, no product-file change; the plugin only re-creates a missing element when it re-applies its config (`applyWallpaper`, 238-266, called from the settings sync, session-change and `theme/change` listeners at 581-588) or when the row remounts (its mount effect flips the page signal, 396-403). Two caveats: (i) removing the **element** does not remove the **token shading**, so remove the inline `--dsw-alias-bg-base` too for the "no wallpaper" condition; (ii) the wallpaper has a **three-state page signal** (`home` / `session` / `settings`, 335-350) and `WallpaperRow` is mounted inside the settings General section — **opening Settings switches the page to `settings` and re-runs `applyWallpaper`** (`notifySettingsOpen(true)` → `applyCurrent` → `applyWallpaper(ctx, pages.settings ?? global)`), which rewrites `backgroundImage` on the full-viewport layer and re-checks the token shading. Closing the panel runs it again. Since `settings.yaml` has only `global` (no `pages.*`), the resulting config is identical each time — the re-application itself is a candidate mechanism for "click Settings ⇒ hitch" and is exactly what the matrix should toggle.

**What the already-landed theme/wallpaper fix does on each theme tick** (marker comments quoted verbatim):

1. `@deepseek-ai/dsh-client-ui-layout/lib/client.js:411-417` — content-signature skip (§comment above `const signature = scheme + "\u0000" + tokenSignature(entries)`):
   > `The publish dispatch is synchronous and every publisher mints a new snapshot object (revision + 1), so "same object" is never a usable skip test. The signature therefore covers CONTENT ONLY — colorScheme plus every token name/value — and never revision, which would make the test miss on every publish by construction.`
2. `…/dsh-client-ui-layout/lib/client.js:420-426` — the skip decision:
   > `Provably idempotent replay: the body still holds exactly the state this snapshot produced, so re-running the writes would change no computed value — it would only pay for another forced recalculation. The theme-color metadata needs no refresh either: its input is a function of exactly that state.`
   Guarded by `landingIntact` (451-467: `A skipped apply is only sound when the previous landing is provably intact, which is what keeps a concurrent writer (or a retraction by another generation) from being silently ignored.`), which checks root `color-scheme`, the body attribute, and that this presenter's own token properties are still non-empty (460-467) — i.e. **an in-page attribute flip deliberately defeats the skip.**
3. `…/dsh-client-ui-layout/lib/client.js:440-447` — rAF defer of the forced style read:
   > `The metadata value is the COMPUTED body background, so it must be read after these writes; that read is what forces a synchronous, document-wide style recalculation. Deferring it to the next animation frame collapses a whole dispatch round (and every concurrent presenter) into one read taken after all writers are done, while still observing the state this apply wrote. When the host cannot schedule frames it runs inline.`
   plus `scheduleThemeColorRefresh` (346-379, including the inline fallback and the per-window `Set`/single-frame coalescing) and the idempotent `refreshThemeColor` (468-477: a refresh whose token signature already landed is skipped).
4. `@local/dsh-wallpaper/lib/client.js:201-204` — `sameShadedTokens` skip on the wallpaper side:
   > `The source and this layer are rebuilt byte-identically on every theme change; re-stacking identical content only re-enters every theme/change listener, so the existing layer is kept and its redundant publish is skipped.`
5. Related landed fix in the same incident (usage card, not theme): `@local/dsh-usage/lib/client.js:780-783` `/* dsh-perf-fix A-gating-fix v1 */` — the IntersectionObserver gate that stops the 60 s poll while the card is off-screen, motivated at 978-982: *"while it is scrolled out of view (or the tab is in the background) it must not poll at all: every cycle costs the host ~0.3-0.5s of blocked event loop."* Other landed markers: `dsh-client-runtime/lib/client.js:8576 (P1)`, `8842 (P2)`, `9324 (P2)`; `dsh-client-ui-workspace/lib/client.js:171, 286 (B1/C1)`.

---

## 5. Session scale (dimension 5) — measured read-only

Command (allowed, read-only RPC, POST used only as the transport):
`curl -s -X POST http://127.0.0.1:3080/api/session.list -H 'content-type: application/json' -d '{"type":"client-request","rpcId":"r1","method":"session.list","payload":{}}'` (4 981 93 B) plus the same shape with `method: "workspace.list"`. Item fields: `sessionId, updatedAt, running, blank, cwd, agentPreset, origin, parentSessionId, runningSubagentCount, projections`.

* **total items = 299**
* **top-level (`origin != "subagent"`) = 99**; `origin` counter = `{subagent: 200, undefined: 99}`
* **top-level sessions grouped by cwd** (this is *not* how the sidebar groups — see below):
  31 `/home/CNS2026495165/Dexterous_Hand_23Dof/Dexterous_Hand_23Dof` · 19 `/home/CNS2026495165/Dexterous_Hand_23Dof` · 16 `/home/CNS2026495165/dsh` · 6 `/home/CNS2026495165/面试` · 4 `/home/CNS2026495165/作业` · 3 `/home/CNS2026495165/math` · 3 `/home/CNS2026495165/university` · 2 `/media/CNS2026495165/EAGET` · 2 `/home/CNS2026495165/MCU` · 2 `/home/CNS2026495165/robocon` · 2 `/home/CNS2026495165/RS` · 2 `/home/CNS2026495165/openarm` · 2 `/home/CNS2026495165/下载/motor-debugging-tool-master/Linux/x86_64` · 1 `/home/CNS2026495165/桌面` · 1 `/home/CNS2026495165/触觉产品资料` · 1 `/home/CNS2026495165/blender` · 1 `…/Dexterous_Hand_23Dof/Dexterous_Hand_23Dof/orca_core-main` · 1 `…/Dexterous_Hand_23Dof/Dexterous_Hand_23Dof/RBS_core-joint-api`
  * **fewest (top-level by cwd) = 1** (five cwds tie: `…/桌面`, `…/触觉产品资料`, `…/blender`, `…/orca_core-main`, `…/RBS_core-joint-api`)
  * **most (top-level by cwd) = 31** at `/home/CNS2026495165/Dexterous_Hand_23Dof/Dexterous_Hand_23Dof`
* **By what the sidebar actually renders (11 Host workspaces + Ungrouped)**, `workspace.list` → 11 entities; visible rows = non-subagent sessions:
  19 `Dexterous_Hand_23Dof` (`/home/CNS2026495165/Dexterous_Hand_23Dof`) ← **most as a group** · 16 `dsh` (`/home/CNS2026495165/dsh`) · 6 `面试` · 4 `作业` · 3 `university` · 3 `math` · 2 `robocon` · 2 `openarm` · 2 `RS` · 2 `MCU` · 1 `触觉产品资料` ← **fewest** · **Ungrouped (`未分组`) = 39 top-level rows** (their cwds are not registered workspaces: 31 are `/home/CNS2026495165/Dexterous_Hand_23Dof/Dexterous_Hand_23Dof`, rest scattered).
  So the DOM at most ever shows **99 rows in 12 groups**, and only ≤5 per group until the expander is clicked (or 0 while collapsed).
* **"current workspace (~99 top-level)" does not exist.** 99 is the *global* top-level total. The current workspace `/home/CNS2026495165/dsh` = workspace group `dsh` = **16 top-level rows (96 items incl. 80 subagents)**. If the experiment wants the heaviest single group, it is `Dexterous_Hand_23Dof` (19) or the Ungrouped bucket (39).
* **Can the GUI be pointed at another cwd's list by pure read-only navigation? No — there is no per-cwd view or route.** One tree lists every workspace (`workspace.list` is global; no cwd parameter), there is no router (`pushState`/hash absent from the shell bundle), and group headers only expand/collapse. The only read-only ways to surface another cwd: (a) click its group header `div[role="tree"] [role="treeitem"][aria-expanded]` (matched by its `span.YDXeBa_title` text), then the expander `展开其余 {n} 个会话`; or (b) use the sidebar search box — `button[aria-label="搜索会话"]` / `input.YDXeBa…` with `placeholder="搜索会话…"` (workspace client.js:1905-1932, 2218-2240) whose results are global and each carry `span.YDXeBa_searchResultWorkspace`; or (c) switch `groupBy` to `单列表`/`In one list` via the view-options menu (`button[aria-label="视图选项"]`, 1182-1185, 2220-2229) which flattens all 99 rows into one list.

---

## 6. Fresh-page precondition ("ready" predicate)

Boot chain the shell actually awaits (evidence):
1. `window.__DSH_BOOT__` (manifest JSON embedded in the served index — verified by curl) is handed to the module loader; the loader starts in `mode:"queue"` (bootstrap script in the served HTML) and flips to `"live"` on `create()` (`@deepseek-ai/dsh-client-modules/lib/client.js:181-183`).
2. The shell's boot kernel `Yd.run()` creates the plugin tree, prefetches the `immediately` tier, `await runPluginBoot(...)`, then `await mountApp(ctx)` where `mountApp` → `ctx.inject(["uiRenderer"], …)` (`dist/assets/index-ClqxG24t.js`, class `Yd`/`Gd`; boot splash root is the div with `data-dsh-boot`, spinner `data-dsh-boot-spinner`, `Gd.dispose()` removes it).
3. `uiRenderer.mount` is only provided after its own deps activate — `inject = ["slots", "sessions"]` (`@deepseek-ai/dsh-client-ui-renderer/lib/client.js:933-939`), and it hydrates the boot DOM then swaps in the app on the first layout effect (`BootHandoff`, 941-968) ⇒ **the boot node disappears exactly when the application tree is mounted**.
4. Sidebar interactivity additionally needs the two lists: sessions store `refreshList()` over `session.list` (`@deepseek-ai/dsh-client-runtime/lib/client.js:8070`) and workspaces store over `workspace.list` → `this.phase = "ready"` (`…/client.js:9583-9606`). Group headers render as soon as workspaces are ready; session rows also need their group expanded (§2). There is no DOM phase attribute for these stores (the `[data-phase]` attribute exists only inside the conversation composer/view, `dsh-client-ui-conversation`).

**Concrete predicate (Playwright):**
```js
await page.waitForFunction(() => {
  if (document.querySelector('[data-dsh-boot]')) return false;                  // splash still up
  if (!window.__DSH_BOOT__) return false;
  if (!window.__ModuleLoader__ || window.__ModuleLoader__.mode !== 'live') return false;
  const trigger = document.querySelector('div[class$="_settingsArea"] button[aria-haspopup="dialog"]');
  const tree = document.querySelector('div[role="tree"]');
  if (!trigger || !tree) return false;
  if (!tree.querySelector('[role="treeitem"][aria-expanded]')) return false;    // ≥1 workspace header ⇒ workspace.list settled
  return true;
}, null, { timeout: 60000 });
await page.waitForTimeout(400);   // let hydration + the first theme/wallpaper writes land before T0
```
Optional stronger stability gate for a cold load (no network events assumed): `await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))` after the predicate, so no measurement window starts inside the hydration frame.

---

## 7. Cross-check against `matrix.mjs` (same directory, other line) — two lever bugs to fix before the run

Reading the existing harness read-only (no edits by me) surfaces two conditions that will silently measure nothing:

* **Theme lever is dead as written.** `matrix.mjs:420-430` forces dark with `document.documentElement.setAttribute('data-theme','dark')` + `classList.add('dark')` + `page.emulateMedia({colorScheme:'dark'})`. **Nothing in the deployed code reads `data-theme` or a `dark` class, and `emulateMedia` is inert while `ui-theme.preference` is not `system`** (`@deepseek-ai/dsh-client-ui-theme/lib/client.js:1238`; current persistence `light`, `settings.yaml:218-219`). The correct in-page lever is `document.documentElement.style.colorScheme='dark'` **plus** `document.body.setAttribute('data-ds-dark-theme','')` **plus** `document.body.style.setProperty('--dsw-alias-bg-base','rgba(15,17,21,0.88)')` (see §3). The harness's own `renderedDark` check compares `getComputedStyle(document.body).backgroundColor`, so at least it self-reports `false` rather than silently mislabeling the condition.
* **The settings-button probe list is mostly wrong, but one entry is right.** `matrix.mjs:271-274` probes `getByRole('button',{name:'设置'})`, `button:has-text(/^设置$/)`, `[aria-label="设置"]`, `[title="设置"]`. There is no `aria-label`/`title` on the trigger, so the last two can never match; the role/name probe works **only in the wide sidebar** (the label span is not rendered in rail mode, `settings-general/lib/client.js:254-258`). Most robust: `div[class$="_settingsArea"] button[aria-haspopup="dialog"]`. Their close probe `getByRole('button',{name:'关闭'})` (`matrix.mjs:297`) is fine (accessible name comes from the visually-hidden label, `settings-general/lib/client.js:157-160`), and their `[role="dialog"]` count check (line 300) matches the panel's own `role="dialog"`.

---

## UNVERIFIED (needs a live page — no browser was launched here)

1. **Exact localStorage key** for the sidebar view store: the declaration is `persist: "dsh.workspace.view.v5"` (`dsh-client-ui-workspace/lib/client.js:34`) but `defineStore` appends `.<scopeKey>` when a scope key exists (`dsh-client-runtime/lib/client.js:5476`). Verify with `Object.keys(localStorage)` (look for `dsh.workspace.view.v5*`).
2. **Whether a fresh page has a current session** (which auto-expands its group, 1210-1219) or starts with all 12 groups collapsed and zero session rows. Also whether `groupExpansion` survives from the user's normal profile into the experiment's `storageState`.
3. **Resolved UI locale in the measurement browser** (`navigator.languages` → zh vs en; `dsh-client-locale/lib/client.js:1184-1200`). Text selectors must be pinned to it. Not determinable from source.
4. **Whether the wallpaper layer is literally `document.body.firstElementChild`** at runtime (source uses `body.prepend`, but other plugins may prepend later) — check with the `[style*="background-size: cover"]` fallback.
5. **Whether `div[class$="_settingsArea"]` has exactly one button child** (the slot renderer may add wrapper nodes) — confirm with `querySelectorAll('div[class$="_settingsArea"] button').length === 1`.
6. **Reversion of the in-page dark force:** whether any theme publish happens during an idle window (settings revision change, wallpaper row mount/unmount on panel open/close, override re-stack). Source says publishes are event-driven only, but the *observed* publish count during "open Settings" needs a `MutationObserver` on `document.body`'s attributes / a `theme/change` hook to confirm.
7. **Cost attribution for the click→panel latency** (wallpaper re-apply writing `background-image` on a 2.2 MB full-viewport layer, the 2 px `backdrop-filter` mask over it, the General-section mount) — all are code-supported hypotheses, none measured here.
