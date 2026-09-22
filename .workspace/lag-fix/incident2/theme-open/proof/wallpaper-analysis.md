# Wallpaper bundle — overlay (遮罩层) static analysis

**Scope (read-only):** `@local/dsh-wallpaper` browser half ONLY —
`/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-wallpaper/lib/client.js`
(610 lines, 31803 bytes, sha1-12 = **826d9217a8fc**, sha256-16 = `0fc4fd87fe4e4ba5`).

`sha1sum` of the file on disk is `826d9217a8fc…`, which equals both
`__DSH_BOOT__.entries["@local/dsh-wallpaper"].rev` and the `?rev=` query in
`/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/live-repro/raw/index.html:24`
⇒ **the artifact analysed here is the deployed build** (no stale-bytes ambiguity).

No product file was modified. No browser was launched. All line numbers below are
`client.js:<line>` unless the full path is written out. Cross-file citations to
`@deepseek-ai/dsh-client-ui-theme` are marked **[cross-ref, out of scope]** — they are
included only to characterise the cost of the write that the wallpaper's comparison
skips; the ui-layout bundle was not audited here.

---

## 0. Orientation — the overlay has TWO halves (DOM + token)

This is the single most important structural fact, and it is why "does it prevent a
rebuild?" has a two-part answer.

| half | artefact | created by | identity |
|---|---|---|---|
| **DOM half** | `<div>` wallpaper layer + `<div>` dark-mask layer (+ a `<style>` sheet) | `createWallpaperElement()` 220-225, `ensureMaskElement()` 228-237, `ensureWallpaperCss()` 138-167 | no `id`, no `class`, no `data-*` — inline `style` only |
| **token half** | a theme override layer keyed by source `"dsh-wallpaper:surface"` (24) that rewrites `--dsw-alias-bg-base` to a translucent `rgba()` | `shadeTokens()` 190-211 → `ctx.theme.overrideTokens(OVERRIDE_SOURCE, next)` 207 | `OVERRIDE_SOURCE` 24 |

The token half is what makes the shell translucent so the DOM half is actually
*visible*; without it the wallpaper sits at `z-index:-1` behind opaque surfaces.
The two halves are rebuilt by **different code paths with different triggers**, and the
landed comparison fix touches **only the token half**.

---

## 1. What the "wallpaper mask/overlay layer" (遮罩层) actually is

### 1a. Wallpaper layer div — the image plane

```js
220:    function createWallpaperElement() {
221:      const element = document.createElement("div");
222:      element.style.cssText = "position:fixed;inset:0;z-index:-1;pointer-events:none;width:100%;height:100%;background-size:cover;background-position:center;background-repeat:no-repeat;";
223:      document.body.prepend(element);
224:      return element;
225:    }
```

- tag `<div>`, **no id, no class, no data attribute** (221).
- parent: `document.body`, inserted with `prepend` ⇒ **first child of `<body>`** (223).
- stacking: `position:fixed; z-index:-1; pointer-events:none` — i.e. a fixed
  full-viewport plane painted at negative z, behind all non-negative-z content
  and behind the app root; `pointer-events:none` keeps it non-interactive.
- content is a CSS `background-image` (set later at 255), **not** an `<img>` element —
  there is no `<img>` anywhere on the overlay path.
- handle cached in module-scope `let wallpaperEl = null;` (132).

### 1b. Dark mask layer — the actual 遮罩层

```js
226:    /** The dark mask sits above the wallpaper (DOM order, same z-index) and
227:     *  below the UI, tinting the image without touching surface tokens. */
228:    function ensureMaskElement() {
229:      if (wallpaperEl === null) return;
230:      if (maskEl === null) {
231:        maskEl = document.createElement("div");
232:        maskEl.style.cssText = "position:fixed;inset:0;z-index:-1;pointer-events:none;width:100%;height:100%;";
233:        wallpaperEl.after(maskEl);
234:      } else if (maskEl.previousSibling !== wallpaperEl) {
235:        wallpaperEl.after(maskEl);
236:      }
237:    }
```

- tag `<div>`, **no id / class / data attribute** (231).
- parent: `document.body`, inserted with `wallpaperEl.after(maskEl)` (233) ⇒ body
  children become `[ wallpaperEl, maskEl, …appRoot ]`.
- stacking: same `position:fixed; z-index:-1; pointer-events:none`; because it is the
  **later sibling at equal z-index**, it paints **above** the wallpaper and **below**
  the UI. The tint itself is an inline `background` (261), again not a surface token.
- handle cached in `let maskEl = null;` (133).

### 1c. Surface `<style>` sheet — the third injected node (not a mask, but same lifecycle)

`ensureWallpaperCss()` (138-167) creates a `<style>` with no `id`/`class`, sets
`textContent` to 5 rules (153-165) and does `document.head.append(cssEl)` (166).
The rules neutralise the shell's own backgrounds
(`[data-phase]:not(textarea){background:transparent!important}`,
`body{--dsw-specific-sidebar-fill:transparent!important}`, sidebar-col /
better-sidebar panel rules) so the wallpaper shows through three columns.
Handle cached in `let cssEl = null;` (134); guarded by an early return at 139.

### 1d. Token override layer (the invisible overlay)

`shadeTokens(ctx, opacity)` 190-211 builds
`{"--dsw-alias-bg-base": { light: rgba(...), dark: rgba(...) }}` (195-200) and publishes
it as a theme layer via `ctx.theme.overrideTokens(OVERRIDE_SOURCE /* "dsh-wallpaper:surface" */, next)` (207), disposer cached in `overrideDispose` (135).
The base colour comes from `resolveBase()` 186-189, which reads the **composed** active
token (`snapshot.active?.tokens?.["--dsw-alias-bg-base"]`, 187) when the active scheme
matches, else the hardcoded `BASE` fallback (25).

---

## 2. Every code path that REBUILDS / RE-CREATES the overlay

### 2.1 Node-creating paths

| # | path | what it does | trigger | reachable on **first open**? | reachable on **settings open/click**? |
|---|---|---|---|---|---|
| C1 | `ensureWallpaperCss` 138-167, guarded 139 | creates `<style>`, `head.append` 166 | any `applyWallpaper` with `source !== null` while `cssEl` is null/detached | **YES** — first materialisation of a configured wallpaper | only if `cssEl` was removed in between (246/270); normally **NO** (early return 139) |
| C2 | `createWallpaperElement` 220-225, called 253 | `remove`(via 252) + `createElement` + `body.prepend` 223 | `wallpaperEl === null \|\| !document.body.contains(wallpaperEl)` (251) | **YES** — the very first materialisation; note 252 is a no-op then, so it is a pure CREATE | **YES, conditionally** — see §2.3 (page-switch / null-ness flip) and §2.4 (external detach) |
| C3 | `ensureMaskElement` create 230-233 | `createElement` + `wallpaperEl.after` 233 | `maskEl === null && darkMask > 0` (259-260) | **YES** if `darkMask > 0` on first materialisation | **YES, conditionally** — after any `releaseMaskElement`, i.e. whenever `darkMask` was 0 or the whole wallpaper was released |
| C4 | `ensureMaskElement` **re-order** 234-236 | `wallpaperEl.after(maskEl)` on an already-attached node ⇒ a DOM **MOVE** (remove+insert → one childList record with the same node in `removedNodes` and `addedNodes`) | `maskEl.previousSibling !== wallpaperEl` (234) | NO on a clean first mount (release-then-prepend at 252-253 lands the new wallpaper directly before the surviving mask, so the check is false) | only if a foreign node was inserted **between** wallpaper and mask; defensive, rarely taken |
| C5 | `shadeTokens` publish 205-207 | `overrideDispose?.()` + `overrideTokens(...)` — rebuilds the **token** layer | any `applyWallpaper` whose computed `next` differs from the cached `shadedTokens` | **YES** once (first publish; `sameShadedTokens` returns false for `undefined`, 182) | normally **NO** — short-circuited by 204 (see §3) |

### 2.2 Node-destroying paths

| # | path | effect | trigger |
|---|---|---|---|
| D1 | `releaseWallpaperElement` 212-215 | `wallpaperEl.remove()` + null the handle | 240 (source null), 252 (recreate), 268 (teardown) |
| D2 | `releaseMaskElement` 216-219 | `maskEl.remove()` + null the handle | 241, 263 (`darkMask === 0`), 269 |
| D3 | `applyWallpaper` null branch 239-249 | 240-241 release both, 244-245 dispose override, 246-247 `cssEl.remove()` | resolved `source === null` |
| D4 | `teardownWallpaper` 267-274 | releases both + `cssEl.remove()` + dispose override | registered as a dispose effect at 589 |
| D5 | `overrideDispose?.()` 206 / 244 / 272 | disposes the token layer (which itself emits `theme/change`, see §3) | any republish, or removal of the wallpaper/plugin |

### 2.3 Triggers that call `applyCurrent` → `applyWallpaper` (the full list)

`applyCurrent(ctx)` 348-350 = `applyWallpaper(ctx, resolveOverride(latestValue, currentPage()))`.

| # | trigger | line | page-open / settings-click relevance |
|---|---|---|---|
| T1 | initial `sync()` inside `apply()` | **581** | **first open**, synchronous, during plugin apply |
| T2 | `settingsScope` subscription → `sync` | **582** (callback 569-580) | fires again when the settings document resolves/updates (async) ⇒ a **second** `applyWallpaper` shortly after first open |
| T3 | slot `inject` callback → `sync()` | **599** (inside 597-601) | **fires when this plugin's settings row is injected**, i.e. on the settings panel's General section opening |
| T4 | `ctx.sessions.list.subscribe` | **584-587** | on session switch ⇒ `currentPage()` flips home↔session |
| T5 | `ctx.on("theme/change", …)` | **588** | every theme/change — including the one the wallpaper's own 207 publish emits, and ui-layout's ThemePresenter republish |
| T6 | `notifySettingsOpen(true/false)` action | **518-522** (called from the row's mount/unmount effect **400-403**) | **fires on settings open AND on settings close**, only when the flag actually flips (guard 519) |
| T7 | `commitField` optimistic apply | **504** | every settings write (file pick, URL apply, each slider `onInput` step 381, override create/clear) |
| T8 | `commitField` rollback apply | **510** | failed settings write |

### 2.4 The decisive rebuild condition — READ THIS BEFORE ASSUMING "NO REBUILD"

`wallpaperEl` is re-created **only** at 251-254, and the overlay is torn down **only**
at 239-249. Inside this bundle the only writers of that state are D1/D2/D3/D4 and the
`pageState`-driven config change. Two consequences:

1. **`source` null-ness flipping across a page switch genuinely removes and re-creates
   the overlay.** `resolveOverride()` 109-112 is `pages[page] ?? normalizePage(global)`,
   and `currentPage()` 344-347 returns `"settings"` whenever the settings row is mounted
   (339, 518-521). So with a **per-page override on `session`** while the **global default
   has no wallpaper**, opening the settings panel makes `currentPage()` = `"settings"` →
   resolves to `global` → `source === null` → 240-247 **removes both divs and the `<style>`**;
   closing the panel resolves back to the session override → 250-254 **creates a new div**
   (and 233 a new mask). That is a full 遮罩层 rebuild caused purely by opening/closing the
   settings panel. Same for `home`/`session` switching (T4) and for `PAGES = ["home",
   "session", "settings"]` (26) generally.
2. **External detach is unverifiable from this file.** If anything outside this bundle
   detaches the wallpaper div from `document.body` (a shell re-mount / landing DOM
   replacement), the next `applyCurrent` — including the one triggered by a settings
   click (T3/T6) — takes the 251 branch and re-creates it. Whether the shell does that
   cannot be decided from `client.js` alone; it needs the live DOM probe in §5.

---

## 3. The landed "wallpaper 内容比较" fix — unit (iv-a)

```js
179:    // Content of the override layer shadeTokens last handed to ui-theme.
180:    let shadedTokens;
181:    function sameShadedTokens(left, right) {
182:      if (left === void 0) return false;
183:      return left["--dsw-alias-bg-base"].light === right["--dsw-alias-bg-base"].light &&
184:        left["--dsw-alias-bg-base"].dark === right["--dsw-alias-bg-base"].dark;
185:    }
```

The comparison **expression** at the guard site:

```js
204:        if (sameShadedTokens(shadedTokens, next)) return;
```

Preceded by the intent comment at 201-203 and followed by the write it protects:

```js
201:        // The source and this layer are rebuilt byte-identically on every theme change;
202:        // re-stacking identical content only re-enters every theme/change listener, so
203:        // the existing layer is kept and its redundant publish is skipped.
204:        if (sameShadedTokens(shadedTokens, next)) return;
205:        shadedTokens = next;
206:        overrideDispose?.();
207:        overrideDispose = ctx.theme.overrideTokens(OVERRIDE_SOURCE, next);
```

**Citations:** definition 181-185; guard 204; cache init 180; cache write 205; the skipped
publish 206-207; caller 265 (`shadeTokens(ctx, …)` at the end of `applyWallpaper`).

### When it DOES short-circuit

Short-circuits (`return` at 204, skipping **both** 206 and 207) iff:

- `shadedTokens !== undefined` (182), i.e. a previous publish happened in this module
  instance, **and**
- the newly computed `next["--dsw-alias-bg-base"].light` and `.dark` rgba **strings** are
  `===` the cached ones (183-184).

Because `next` (195-200) contains exactly one key and only `light`/`dark` sub-values, the
comparison is exhaustive over the layer's real content: identical `light`+`dark` ⇒ identical
layer. So for an unchanged theme snapshot **and unchanged opacity**, and with the base token
already carrying this layer's own alpha (see the fixed-point note below), it returns early.

### When it does NOT short-circuit

- First ever call in the module instance (`shadedTokens === undefined` → 182 → false).
- Any change to the base colour (real theme switch changes `resolveBase` 186-189 output).
- Any change to `opacity` (265 passes `config.opacity`) — note `toRgba` 168-178 **replaces**
  the alpha rather than compounding it (regex at 176-177 drops the source alpha), so a moved
  slider produces a genuinely different string and publishes.
- The **stale-cache hole**: `shadedTokens` is never reset when the layer is disposed
  (244-245 sets only `overrideDispose = null`; 272-273 likewise). Therefore, for a
  wallpaper config whose recomputed `next` equals the last published value:

  - set wallpaper (opacity 0.8) → publish, `shadedTokens = X`, `overrideDispose = H`;
  - remove wallpaper ("移除壁纸", 469) → `applyWallpaper` 239-249 → 244-245 disposes `H` and
    nulls `overrideDispose`, **`shadedTokens` stays `X`**;
  - re-apply the same image at the same opacity → `next === X` → **204 returns early** →
    `overrideDispose` remains `null` ⇒ **the `--dsw-alias-bg-base` shading is never
    re-registered**, so the shell base goes back to opaque while the div-based wallpaper is
    re-created at 250-254.
  - `teardownWallpaper` 267-274 has the identical hole.

  This is a static-inference defect of the fix; it is not observable from the wallpaper
  bundle alone as a *write*, and must be confirmed live (§5 probe idea: `overrideTokens`
  wrapper — after a remove→re-apply cycle, count publishes; expected 1, buggy 0).

### Scope of the protection — write-only, NOT a rebuild guard

The early return at 204 sits **after** every DOM action in `applyWallpaper`:
`ensureWallpaperCss()` 250, the create/re-create at 251-254, `backgroundImage` 255,
`filter` 256-257, and the mask work 258-264 all execute **unconditionally before**
`shadeTokens` is reached at 265. Therefore:

> **unit (iv-a) prevents a redundant *theme-layer publish*. It does NOT prevent
> overlay REBUILD, and it does not even prevent the per-apply DOM style rewrites at
> 255 / 257 / 261.** It removes exactly two `theme/change` emissions (see below) per
> unchanged apply.

What the skipped "write" actually costs — **[cross-ref, out of scope]**
`@deepseek-ai/dsh-client-ui-theme/lib/client.js:1224-1236`: `overrideTokens` sets
`seq`, `overrides.set(source, layer)`, then `publish()`; the disposer at 1231-1235 does
`overrides.delete(source)` then `publish()`. `publish()` (`…ui-theme…/client.js:1264-1268`)
does `revision += 1; snapshot = buildSnapshot(); ctx.emit("theme/change", snapshot)`.
So an **un-skipped** `shadeTokens` emits `theme/change` **twice** (dispose-publish +
set-publish), each fanning out to *every* theme subscriber — ui-layout's
`ThemePresenter.apply` and this bundle's own 588 listener included. The skip removes both
emissions. That is the real value of the fix, and it is a *token/event* saving, not a DOM one.

The `shading` re-entrancy guard (191 `if (shading) return;`, set 192, cleared 209) is what
stops the 207 publish from recursing through 588 → `applyCurrent` → `shadeTokens`: the
nested call bails at 191. Its side effect: a genuine change arriving re-entrantly is
dropped and `shadedTokens` stays stale until the next non-reentrant apply.

---

## 4. rAF / getComputedStyle / theme-change subscriber — direct answers

| asked | present in this bundle? | evidence |
|---|---|---|
| `requestAnimationFrame` deferral | **NO — absent** | `grep -nE "requestAnimationFrame\|cancelAnimationFrame"` over the file returns nothing; likewise no `setTimeout`/`setInterval`/`queueMicrotask`/`Promise`-based deferral is used to schedule DOM work. All overlay work is **synchronous** inside `applyWallpaper` 238-266. |
| `getComputedStyle` read | **NO — absent** | no `getComputedStyle`, no `getPropertyValue`, no layout reads (`offsetWidth`/`clientWidth`/`getBoundingClientRect`), no `matchMedia`, no `ResizeObserver`, no `MutationObserver`, no `addEventListener`. The frame-coalesced rAF theme-color meta refresh and the `getComputedStyle(document.body).backgroundColor` read described in the brief are **ui-layout's**, not this bundle's: they do not exist here. |
| theme/token-change subscriber | **YES** | `588: ctx.on("theme/change", () => applyCurrent(ctx));` — registered at `apply()` scope, no filter, no debounce; every theme/change runs a **full** `applyWallpaper` (including the DOM writes at 255/257 and the mask branch 258-264) and then the token comparison at 204. |
| theme reads / writes | **YES** | read: `194: const snapshot = ctx.theme.getTheme();` (one snapshot read **per apply**, rate-limited only by the theme bus). write: `207: overrideDispose = ctx.theme.overrideTokens(OVERRIDE_SOURCE, next);`. Declared dependency: `561: const inject = ["slots", "locale", "theme", "settingsScope", "sessions"];` |
| other subscribers owned by this bundle | **YES** | `582: ctx.effect(() => scope.subscribe(sync), …)` (settings doc), `584-587: ctx.sessions.list.subscribe(…)`, `591-602: ctx.slots.inject("settings.general.item", …)`. |

Net: on the wallpaper side the only "theme reaction" cost is one `getTheme()` + two
`toRgba` string builds per apply, with **no** rAF, **no** computed-style read, **no** meta
tag, and the publish itself suppressed by 204 when nothing changed.

---

## 5. Cost that occurs on first open / settings click even when the theme snapshot is UNCHANGED

**Yes. Three distinct costs, none of them gated by the 204 comparison.**

### Cost A — unconditional DOM style rewrites on every apply (attribute-level work)
Trigger: **T6** (`notifySettingsOpen` 518-522, invoked by the row's mount effect 400-403
on settings open and its cleanup on close) and **T3** (`sync()` at 599 when the row is
injected). Work performed, all *before* the comparison:

- `255: wallpaperEl.style.backgroundImage = \`url("${config.source}")\`;` — CSSOM write on every apply.
- `257: wallpaperEl.style.filter = blur > 0 ? \`blur(${blur}px)\` : "none";`
- `260: ensureMaskElement()` → the `previousSibling` reorder check at 234.
- `261: maskEl.style.background = \`rgba(0, 0, 0, ${darkMask})\`;` (when `darkMask > 0`).

When the values are byte-identical these are CSSOM no-ops and (per CSSOM/engine
semantics; **must be confirmed empirically**) should not produce `style`-attribute
mutation records — but they are still three unconditional JS→CSSOM calls plus
`resolveOverride` allocations (100-112) and `getTheme()` per settings open/close.

### Cost B — page-switch image swap / overlay rebuild
Trigger: the same **T6**/**T3** events, because `currentPage()` 344-347 flips to
`"settings"` and `resolveOverride` 109-112 then resolves a **different** config:
- if `pages.settings`/`global` resolves to a different `source`, line 255 assigns a new
  `background-image` ⇒ **a fresh image fetch + decode** of a different file (real
  main-thread and network cost, entirely independent of the theme snapshot);
- if null-ness flips, 239-249 **removes** both overlay divs + the `<style>`, and the
  return trip **re-creates** them (250-254, 233) — a genuine 遮罩层 rebuild on settings
  open/close (see §2.4.1).

### Cost C — settings-row React mount cost (adjacent, not the overlay)
Trigger: settings open (**T3**/**T6**). `WallpaperRow` 386-486 mounts; when a wallpaper is
configured it renders a **preview `<img>`**: `453: const preview = config.source === null ? null : jsx.jsx("img", { src: config.source, …})`
⇒ an extra image decode of the full-size wallpaper inside the settings modal, plus the
slider/input subtree (479-484). Independent of theme state.

### What is NOT paid when the theme snapshot is unchanged
No `theme/change` emission from this bundle (204 short-circuits 206-207), hence no
ui-layout `ThemePresenter.apply` re-entry, no theme-color meta refresh, no token
snapshot rebuild (ui-theme 1264-1268). **That part of the fix works as designed** — with
the §3 stale-cache exception, which turns the skip into a *missing* publish after a
wallpaper remove→re-apply cycle.

---

## 6. Instrumentation

### 6.1 Selectors that uniquely identify the overlay from the page side

Neither div carries an `id`, `class`, or `data-*` attribute (221, 231), and the `<style>`
has none either (140). Identification therefore relies on the serialized inline `style`
attribute (which CSSOM writes with `property: value;` spacing) and on structural position.

**Primary (robust, value-based):**

```js
// wallpaper image plane
document.querySelectorAll('body > div[style*="background-size: cover"][style*="z-index: -1"]')   // expect 0..1

// dark mask (the 遮罩层): has z-index:-1 + pointer-events:none, lacks background-size
document.querySelectorAll('body > div[style*="z-index: -1"]:not([style*="background-size"])')       // expect 0..1

// both overlay divs at once
document.querySelectorAll('body > div[style*="z-index: -1"][style*="pointer-events: none"]')       // expect 0..2

// mask as the immediate following sibling of the wallpaper (order-independent of style text)
document.querySelectorAll('body > div[style*="background-size: cover"] + div')
```

**Positional fallback** (holds while the overlay is present, because of `prepend` 223 and
`after` 233): `document.body.children[0]` = wallpaper div, `document.body.children[1]` =
mask div, and `document.body.children[2]` = the app root. Treat this as corroboration only —
it breaks when the overlay is absent (D3/D4) — so gate it on the primary selector.

**The `<style>` sheet** has no CSS selector: it must be found by content scan, since CSS
cannot match element text.

```js
[...document.head.querySelectorAll('style')]
  .filter(s => s.textContent.includes('--dsw-specific-sidebar-fill'))   // cssEl, 153-165
```

**Recommended hardening (a product change, NOT applied here — read-only task):** give the
three nodes stable hooks so probes can attach without string matching, e.g.
`wallpaperEl.dataset.dshWallpaper = "image"`, `maskEl.dataset.dshWallpaper = "mask"`,
`cssEl.id = "dsh-wallpaper-surface"` at 221/231/140. With those, the selectors become
`[data-dsh-wallpaper="image"]`, `[data-dsh-wallpaper="mask"]`, `#dsh-wallpaper-surface`.

### 6.2 What a MutationObserver sees

Suggested observer (one observer catches head + body, but `head > style` records only
appear with `subtree:true`):

```js
new MutationObserver(records => {/* log */}).observe(document.documentElement, {
  childList: true, subtree: true, attributes: true, attributeOldValue: true
});
// noise control: attributeFilter: ['style']
```

**Rebuild — overlay released (D3, triggered by resolved `source === null`, incl. settings open with a page-override §2.4.1).**
All removals land in **one** callback (same microtask), in code order 240 → 241:

| record | target | fields |
|---|---|---|
| childList | `document.body` | `removedNodes: [div.wallpaper]`, `addedNodes: []`, `nextSibling: div.mask` |
| childList | `document.body` | `removedNodes: [div.mask]`, `addedNodes: []` |
| childList | `document.head` | `removedNodes: [style]`, `addedNodes: []` (246-247) — only if `cssEl !== null` |

**Rebuild — overlay re-created (C2+C3, triggered by a later non-null apply):**

| record | target | fields |
|---|---|---|
| childList | `document.body` | `addedNodes: [div.wallpaper]`, `removedNodes: []`, `previousSibling: null`, `nextSibling: div.mask` (prepend, 223) |
| childList | `document.body` | `addedNodes: [div.mask]`, `removedNodes: []`, `previousSibling: div.wallpaper` (233) |
| childList | `document.head` | `addedNodes: [style]` (166) |

The two body records may arrive in the same callback. **Signal to distinguish a rebuild
from a rewrite:** presence of any `childList` record on `document.body`/`document.head`
whose `addedNodes`/`removedNodes` contain a node matching §6.1. A re-creation also yields a
**new node identity** — capture `window.__wpProbe.node = …` and compare object identity
across calls; identity change ⇒ rebuild, identity stable + no record ⇒ pure rewrite.

**Re-order (C4, only when `maskEl.previousSibling !== wallpaperEl`, 234-235).**
`Element.after()` on an already-attached node is a move ⇒ **one** record with the *same*
node in both lists:

```
{type:'childList', target: document.body,
 removedNodes:[div.mask], addedNodes:[div.mask], previousSibling: div.wallpaper}
```

**Rewrite (no rebuild).** `attributes` records with `attributeName:"style"` on the
wallpaper/mask div (from 255/257/261). Critical caveat for reading your capture: because
those assignments re-set *identical* values when nothing changed, the expected result for
an unchanged settings-click is **no `attributes` record at all** — Blink/Gecko commit the
style attribute (and queue the record) only when the serialized value actually changes.
So: *a* `style` record on the overlay divs = a real visual change; *no* records while the
overlay identity is stable = the apply ran and was a value-level no-op. This is the
discriminator that tells you whether a settings click did any overlay work, and it is the
one item that needs empirical confirmation in the live page (no browser was run here).

**Never seen:** `characterData` records (no `textContent` rewrite after creation — 153
runs once per `<style>`), and any `attributes` record for `id`/`class`/`data-*` on the
overlay divs, because the bundle never sets them.

**Invisible to MutationObserver — the token half.** Both `overrideTokens` publishes and
the skipped ones are pure JS (`…ui-theme…/client.js:1230` / `1234` / `1264-1268`, emitting
`theme/change`). They produce **zero** DOM mutation records. To count them, instrument at
the app level — wrap `ctx.theme.overrideTokens` or subscribe count to `theme/change` —
otherwise a probe will report "no mutation" and wrongly conclude "no work", when in fact
two full theme republishes may have fanned out to every subscriber.
