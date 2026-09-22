# First-mount profile — STATIC source analysis (incident2, sub-firstmount)

Scope: static source reading only. No product file was modified; nothing outside this output dir was written.
Evidence base: installed client bundles under the deployed profile, plus the **live boot manifest served by the running GUI** (`GET http://127.0.0.1:3080/` → `globalThis["__DSH_BOOT__"]`, captured verbatim in `_evidence/boot-manifest.json`, `_evidence/boot.html`) and the user settings document `~/.dsh/settings.yaml`.

Path shorthands used below:

| shorthand | absolute path |
|---|---|
| `LAYOUT` | `/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js` (symlink → `.npm-global/.../@deepseek-ai/dsh-client-ui-layout/lib/client.js`, 570 lines) |
| `THEME` | `/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js` (1354 lines) |
| `WALL` | `/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-wallpaper/lib/client.js` (610 lines) |
| `SET` | `/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-settings/lib/client.js` |
| `SETGEN` | `.../@deepseek-ai/dsh-client-ui-settings-general/lib/client.js` |
| `SETMODELS` | `.../@deepseek-ai/dsh-client-ui-settings-models/lib/client.js` |
| `SETPLUG` | `.../@deepseek-ai/dsh-client-ui-settings-plugins/lib/client.js` |
| `SETINV` | `.../@deepseek-ai/dsh-client-ui-settings-plugin-inventory/lib/client.js` |
| `CONN` | `.../@deepseek-ai/dsh-client-connection/lib/client.js` |

---

## 0. Framing correction (must read before 1–4)

**The first `ThemePresenter.apply` does not happen when the settings panel opens. It happens at page load, before React ever mounts the shell.**

1. Every client plugin in the boot manifest is created and awaited at boot, not on demand. The served shell bundle (`dsh-web-frontend/dist/assets/index-ClqxG24t.js`, minified single line, string-verified) contains exactly this sequence:
   `async prefetchImmediateTier(){ …this.manifest.plugins.filter(i=>i.immediately).map(i=>this.modules.prefetch(i.id)…) }`,
   `async runPluginBoot(n,i){ … const u=this.manifest.plugins.map(c=>c.id); this.page.setTotal(u.length), await i, await Promise.all(u.map(async c=>{ … const d=await l.create({name:c}); … })), await l.await(), this.assertEntriesActive(n) }`,
   and then `async mountApp(n){ await n.inject(["uiRenderer"], i=>{ i.effect(()=>i.uiRenderer.mount(this.container), "web boot: application mount") }) }`.
   So `immediately` only drives **bundle prefetch order**; **all 50 manifest entries are instantiated at page load**, and `mountApp` runs *after* plugin boot. (`_evidence/boot-manifest.json`: 50 entries, 11 with `immediately:true`.)
2. `LAYOUT` boots at manifest index **11**; `WALL` at index **44**; `SET` at 14, `SETGEN` 15, `SETMODELS` 16, `SETINV` 17, `SETPLUG` 37, theme at 9 (`_evidence/boot-manifest.json`).
3. `LAYOUT` builds the single presenter once, inside one `ctx.effect` (runs at plugin apply):
   `LAYOUT:552` `const presenter = new ThemePresenter();`
   `LAYOUT:553` `presenter.apply(ctx.theme.getTheme());`  ← **the first apply**
   `LAYOUT:554-556` `const off = ctx.on("theme/change", (snapshot) => { presenter.apply(snapshot); });`
   These are the **only two** `presenter.apply` call sites in the entire install (grep `presenter.apply` → 553, 555; `ThemePresenter` appears only in this package).
4. Settings is a React subtree: `SETGEN:177` `SettingsRoot` (`const [open, setOpen] = useState(false)`), and the panel only exists while `open` (`SETGEN:213-217 open && (0, react_jsx_runtime.jsx)(SettingsPanel, …)`). Opening the panel **cannot** re-run the plugin effect above.

Consequence for the whole investigation: opening the settings panel differs from steady state **only** to the extent that (a) the panel's own mounts issue RPCs / DOM work, and (b) the wallpaper row's mount fires `notifySettingsOpen(true)` → `applyCurrent` → possibly `overrideTokens` → `theme/change` → `presenter.apply` (`WALL:400-402,518-522,573,588`).

---

## 1. FIRST APPLY — full write path and token count

### 1.1 The path, verbatim

`LAYOUT:408` `apply(snapshot) {`
- `:409-410` reads `snapshot.active.colorScheme` and `Object.entries(snapshot.active.tokens)`
- `:418` `const signature = scheme + "\u0000" + tokenSignature(entries);`
- `:420` `if (signature === this.lastSignature && this.landingIntact(scheme, body)) return;` — **cannot fire on the first apply**: `lastSignature` is declared with no initializer (`LAYOUT:387`) i.e. `undefined`, and `signature` is always a string.
- `:428` `document.documentElement.style.colorScheme = scheme;` (write on `<html>`, not counted by the task but also an invalidation)
- `:429-430` `body.setAttribute/removeAttribute(DARK_ATTRIBUTE)` (`DARK_ATTRIBUTE = "data-ds-dark-theme"`, `LAYOUT:345`)
- `:431` `for (const name of this.appliedTokens) body.style.removeProperty(name);` — zero iterations on the first apply (`appliedTokens = []`, `LAYOUT:383`)
- `:433-436` `for (const [name, value] of entries) { body.style.setProperty(name, value); this.appliedTokens.push(name); }` ← **the N `setProperty` calls**
- `:437` append the `<meta name="theme-color">` node
- `:438-439` record `lastSignature` / `lastTokens`
- `:448` `this.pendingTokenSignature = tokenSignature(entries);`
- `:449` `scheduleThemeColorRefresh(this.themeColorMeta.ownerDocument?.defaultView, this);`

So N = `Object.keys(snapshot.active.tokens).length` — exactly the same set the guard's signature later covers.

### 1.2 Where the tokens come from — is there a catalog on disk?

There **is no token catalog** that determines the write set. The write set is the **composition of runtime override layers**:

- `THEME:998-1006` `BUILTIN_THEMES = [{id:"light", colorScheme:"light", tokens: Object.freeze({})}, {id:"dark", …, tokens: Object.freeze({})}]` — **the built-in theme token maps are empty objects**. The stock palette is *not* JS-written; it lives in the stylesheets injected at apply by `THEME:137-143` (`STYLES` = base / design-platform / scrollbar / gradient-shadow-text / shiki) and `THEME:148-160` `installThemeStyles`.
- `THEME:1255-1263` `composeActive(active)`: `if (this.overrides.size === 0) return active;` → `tokens = { ...active.tokens }` then, per override layer in `seq` order, `tokens[name] = modes[active.colorScheme]`.
- `THEME:1224-1236` `overrideTokens(source, tokens)` is the only way tokens enter `active.tokens`; `publish()` at `THEME:1264-1268` re-emits `theme/change`.
- Callers of `overrideTokens` in the whole deployed install: **`WALL` only** (`WALL:207`) + the dynamic-package façade `dsh-cordis-client-runner/lib/client.js:291-310` (only reachable if a dynamic client package registers layers; no dynamic client package storage exists in this deployment — `~/.dsh/storages/` contains only `usage`, `session_projcache`, `message_feedback.json`, `workspace.json`).
- The one layer that exists: `WALL:190-211` `shadeTokens()`:
  `WALL:195-200` `const next = { "--dsw-alias-bg-base": { light: toRgba(resolveBase(snapshot,"light"), opacity), dark: toRgba(resolveBase(snapshot,"dark"), opacity) } };`
  `WALL:204` `if (sameShadedTokens(shadedTokens, next)) return;` (content guard, helper at `WALL:180-185`), `WALL:207` `overrideDispose = ctx.theme.overrideTokens(OVERRIDE_SOURCE, next);` (`OVERRIDE_SOURCE = "dsh-wallpaper:surface"`, `WALL:24`).

### 1.3 Exact token count for this deployment

**1** — `--dsw-alias-bg-base`, and only when the wallpaper layer is registered. `~/.dsh/settings.yaml:199-204` has a wallpaper configured (`wallpaper.global.source = /dsh-wallpaper/media/37758c1c-….png`, `opacity: 0.88`), so the layer lands as soon as the settings mirror resolves.

Because `LAYOUT` (idx 11) applies **before** `WALL` (idx 44), and `WALL`'s layer requires the settings document (resolved asynchronously by `settings.describe`), the *very first* apply typically sees `active.tokens = {}`:

| apply | trigger | tokens | `setProperty` calls | guard fires? |
|---|---|---|---|---|
| #1 | `LAYOUT:553` at page-load boot | `{}` (no layer yet) | **0** (also 0 `removeProperty`) | no (`lastSignature === undefined`) |
| #2 | `theme/change` from `WALL:207` once the texture layer lands (or from theme preference adoption, see §3) | `{--dsw-alias-bg-base}` | **1** | no (signature differs) |
| #3… | later publishes | usually identical content | 0 (early return at `:420` saves it) | yes |

Ancillary catalogs that exist on disk but are **not** the write set:
- `THEME:1007-1088` `BUILTIN_INSPECT_TOKENS` — **13** entries (`--dsw-alias-bg-base`, `bg-layer-1`, `bg-layer-2`, `bg-overlay`, `border-l1`, `border-l2`, `brand-primary`, `label-primary`, `label-secondary`, `state-error-primary`, `state-success-primary`, `state-warn-primary`, `specific-sidebar-fill`), exposed read-only via `THEME:1163-1166 exportInspectTokens()` for the settings inspection surface. It is a directory, not a write plan.
- The stylesheet palette (context for invalidation scope): `THEME:124` (`design-platform.css`) declares **162 distinct** `--dsw-*` variables (324 declarations across light/dark/static/alias blocks) in one `body{…}` / `body[data-ds-dark-theme]{…}` rule set; `THEME:130` adds 187 more (`--dsw-font-*`, `--dsw-shadow-*`, gradients). All of these are resolved from the stylesheet — the presenter writes only the override layer inline on `body`.

**Verdict 1 — first-open vs steady-state: SAME.**
The first apply is *not* a settings-open event: it is page-load plugin boot. What differs between the first-ever apply and steady state is only the **first two applies of the page load** (0 then 1 `setProperty`, guard ineffective); by the time a user can open the panel the presenter is already in the skipped-replay regime (guard at `:420` returns early for identical content), and opening the panel produces **no apply at all** in this deployment's configuration (see §3). Each `body.style.setProperty` invalidates style for the whole document because `body` is the ancestor of every rendered node — but on first open there are **zero** of them (0 in the typical boot path, 1 in the worst case where the wallpaper layer lands before `LAYOUT:553`).

---

## 2. theme-color meta FIRST WRITE

### 2.1 Mechanics with exact sites

- Queue + frame id: `LAYOUT:346-348`
  `LAYOUT:347` `const themeColorRefreshQueue = new Map();` (per-window `Set` of presenters)
  `LAYOUT:348` `let themeColorFrame = 0;` (**module-global**, shared by every window/document, not per-window)
- Scheduler: `LAYOUT:359-380 scheduleThemeColorRefresh(win, presenter)`
  - `:361-364` if the window has no `requestAnimationFrame`, runs `presenter.refreshThemeColor()` **inline**
  - `:366-371` get-or-create the per-window `Set`, `queued.add(presenter)`
  - `:372` `if (themeColorFrame !== 0) return;` ← the coalescing: at most one scheduled frame for all windows
  - `:373-378` the callback resets `themeColorFrame`, takes the Set, deletes it from the map, and calls `item.refreshThemeColor()` for each distinct presenter
- Only call site of the scheduler: `LAYOUT:449` (end of `apply`). Grep confirms exactly three occurrences of the symbol: the doc comment `:346`, the definition `:359`, the call `:449`.
- The forced recalculation: `LAYOUT:472-477`
  `:473` `const signature = this.pendingTokenSignature;`
  `:474` `if (signature !== void 0 && signature === this.refreshedTokenSignature) return;` ← per-content idempotence
  `:475` `this.themeColorMeta.content = getComputedStyle(document.body).backgroundColor;` ← **forced synchronous style recalc of the whole document**
  `:476` `this.refreshedTokenSignature = signature;`
- `refreshThemeColor()` has **no other caller** anywhere.

### 2.2 How many invocations on first open, and is the first one more expensive?

- **On the first open of the settings panel: 0 in this deployment.** `refreshThemeColor` is reachable only through `apply` (`:449`), and (see §3) no theme publish occurs when the panel opens with the current `settings.yaml` (no per-page wallpaper override). This answers the parent's hypothesis directly: the theme-color read is a **page-load** cost, not a first-open cost.
- **On a page load** the count is bounded by the number of applies, not by the number of presenters: applies #1/#2 (+ possibly a preference-adoption apply, §3) → `queued.add()` collapses them into one Set entry, `:372` allows one frame, so **exactly 1** `getComputedStyle` runs for the whole round, and the `:474` signature guard can suppress even that if another refresh for the same content already landed.
- **Yes, the first invocation is structurally more expensive than any later one, and it is the only one that exists in steady state:**
  - its input was *just* invalidated at `:428-436` (colorScheme on `<html>`, the dark attribute on `body`, the layer's `setProperty` on `body`) → dirty style tree that only `getComputedStyle` forces to resolve;
  - at page load the freshly appended theme stylesheets (`THEME:148-160`, appended at boot) are also being resolved for the first time, so the same read resolves the initial palette;
  - later applies are skipped entirely at `:420`, so they cost **0** reads. The fix therefore moved ~all of this cost to the page-load phase and left the steady state at ~0, which matches the observed "steady state apply ≈ 0".
- Coalescing caveats worth recording: `themeColorFrame` is global rather than per-window (`:348`), so a second window can piggy-back on the first window's frame (correctness-preserving because the per-window Set is drained inside the callback, but the cross-window timer belongs to whichever window scheduled first); and `dispose()` (`LAYOUT:479-489`) does **not** remove the presenter from the queued Set, so a dispose between `:449` and the frame callback still runs one refresh on a disposed presenter.

**Verdict 2 — first-open vs steady-state: SAME (both zero), with the real first write belonging to page load.**
Where a first open *does* publish (a per-page wallpaper override for `settings`, see §3), the delta versus steady state is exactly **+1** coalesced `getComputedStyle` on a body whose style that same apply just invalidated (1 `setProperty`) — i.e. one forced recalc per open, not per token and not per presenter.

---

## 3. Does opening the settings panel cause a THEME PUBLISH?

### 3.1 Complete list of publish triggers

`ThemeRuntime.publish()` (`THEME:1264-1268`) is called from, and only from:

| # | site | trigger |
|---|---|---|
| 1 | `THEME:1174-1180 setTheme(id)` | user clicks a cube in `AppearanceRow` (registration `THEME:1338-1346`, inject `:1330-1336`; component `THEME:74-90`, `onClick` `:87-89` → `setTheme(id)` `:88` → `theme.setTheme(id)` `:1333-1334`) — user gesture only; `THEME:1176` returns early if the preference is unchanged; `THEME:1180` also writes the preference through the settings scope |
| 2 | `THEME:1146-1149` `ctx.effect(() => host.subscribe(() => this.adopt()))` + initial `this.adopt()` | the `ui-theme` **settings scope** snapshot changes; `THEME:1182-1186 adopt()` sets `this.preference` and publishes **only if the accepted value differs** ("Adopt the scope's accepted durable preference **without writing it back**") |
| 3 | `THEME:1224-1236 overrideTokens(...)` and its disposer | a layer is stacked/removed (`WALL:207` stacks; disposer invoked at `WALL:244` when no source resolves and at `WALL:272` in `teardownWallpaper`) |
| 4 | `THEME:1198-1212 register(definition)` (+ its disposer) | theme registration; no caller in this composition |
| 5 | `THEME:1139-1145` `prefers-color-scheme` `change` listener | OS scheme flip while preference is `system` |

Nothing else calls `emit("theme/change")` (`THEME:1267` is the only emitter; `ctx.on("theme/change", …)` subscribers: `LAYOUT:554`, `WALL:588`, `THEME:1329` row sync).

### 3.2 What the settings panel open actually does

- The panel opening mounts `settings.action` → `SettingsDocumentAction` (`SETGEN:324`), whose effect calls `controller.load()` (`SETGEN:326-327`). `SettingsDocumentStore.load()` (`SETGEN:383-392`) only `subscribe`s and calls `describeFace.ensure()` (`SETGEN:385`) — **no write, no wire read when the mirror is already ready**; the RPC `api.settings.openDocument({})` (`SETGEN:400`) fires only on a **button click** (`SETGEN:333-345`, onClick `:340-342`, refused while `opening` at `SETGEN:395`).
- The General section mounts `settings.general.item` rows (`SETGEN:585-595`). Of these, none writes a setting on mount: `THEME:1338-1346` (Appearance row, writes only on click), `WALL:386-402` (wallpaper row, writes only on user edits through `commitField`, `WALL:490-515`), `SETGEN`-external rows `@local/dsh-subagent-model`, `…/dsh-client-ui-permission-presets`, `…/dsh-client-ui-agent-preset`, `dsh-client-locale`, `dsh-client-ui-conversation` — the ones that "load" on mount (`permission-presets/lib/client.js:68-69` → `:260-271`; `agent-preset/lib/client.js:293-295` → `:633`) read through the shared describe mirror / roster RPC and never write.
- **The one theme-relevant thing that does happen on first open: the wallpaper row's own mount.**
  `WALL:400-402` `useEffect(() => { notifySettingsOpen(true); return () => notifySettingsOpen(false); }, [])`
  `WALL:518-522` `notifySettingsOpen: (open) => { if (pageState.settingsOpen === open) return; pageState.settingsOpen = open; applyCurrent(ctx); }`
  `WALL:596-601` the slot's `inject: (bound) => { actions = bound; sync(); … }` also re-runs on bind.
  `applyCurrent` (`WALL:348`) → `applyWallpaper` (`WALL:238`) → when a source is resolved it creates/reuses the layer element and calls `shadeTokens(ctx, opacity)` (`WALL:265`).
  `shadeTokens` is **content-compared before writing** (`WALL:180-185 sameShadedTokens`, `WALL:201-203` comment, `WALL:204 if (sameShadedTokens(shadedTokens, next)) return;`): identical `--dsw-alias-bg-base` light/dark values → early return, **no `overrideTokens`, no publish**.
  Page resolution: `WALL:350-353 currentPage()` returns `"settings"` while the row is mounted; `WALL:110-113 resolveOverride(value, page) = pages[page] ?? normalizePage(value.global)`; `PAGES = ["home","session","settings"]` (`WALL:26`).
  `~/.dsh/settings.yaml:199-204` defines **only `wallpaper.global`** (no `pages:` key, no `pages.settings` override) → the settings page resolves to the same `{source, opacity 0.88}` as home → `sameShadedTokens` is true → **no publish on open**.

**Verdict 3 — first-open vs steady-state: SAME in this deployment (no theme publish on open, hence no re-entry into `apply`, hence no theme-color write).**
**Config-dependent counter-case (would be DIFFERENT):** if `wallpaper.pages.settings` (or `pages.home` vs `pages.settings`) resolved to a *different* source/opacity than the page shown before opening the panel, `shadeTokens` would stack a new layer content → `overrideTokens` → `publish()` → `LAYOUT:555` `presenter.apply` with a **different** signature → guard at `:420` does not fire → 1 `removeProperty` + **1 `setProperty`** + 1 scheduled (coalesced) `getComputedStyle`. That is the only path by which the settings panel itself can re-enter the theme write path; it is currently inactive, and it is a **content-guard-limited** single extra apply, not a per-token storm.

### 3.3 Wallpaper overlay layer: lazy or at page load?

- The wallpaper **plugin** is `immediately:true` in the live manifest (index 44) → its `apply` runs at page load (`WALL:571-604`): `sync()` at `:581`, scope subscription at `:582`, session subscription at `:583-586`, `ctx.on("theme/change", () => applyCurrent(ctx))` at `:588`.
- The overlay **DOM element** is created lazily, inside `applyWallpaper`, only when a source is resolved:
  `WALL:250-255` `ensureWallpaperCss(); if (wallpaperEl === null || !document.body.contains(wallpaperEl)) { releaseWallpaperElement(); wallpaperEl = createWallpaperElement(); }` (`createWallpaperElement` = `WALL:220-228`, `document.body.prepend`, `position:fixed; inset:0; z-index:-1`).
- So: with the current global wallpaper the element **exists from page load** (the `sync()` at `:581` fires as soon as the settings snapshot is accepted); it is created at settings open **only** if the *pre-page* resolution yields no source and the settings-page resolution does (per-page `pages.settings` override), or if a source is set interactively. The `settingsOpen` flag is not what creates it — a wallpaper configured for `home`/`session` is already painted before the panel exists.
- Lazy-on-open is also used for the token shading: no source → `WALL:239-249` removes the element, the mask and the surface CSS and disposes the override layer (`WALL:244 overrideDispose?.()` → publish, if a layer existed).

---

## 4. RPC coalescing on first open

Wire surface (for the "settings.get" item in the brief): the settings API exposes **`settings.describe`, `settings.openDocument`, `settings.update`, `settings.replace`, `settings.mutate`** — there is **no `settings.get`** in the client (`CONN:6480-6484` API face; the forwarded-method switch at `CONN:10193-10197`). Other relevant methods: `credentials.describe/set/unset` (`CONN:10198-10200`), `llm.providers` / `llm.models` / `llm.discoverModels` (`CONN:10201-10203`), `agentPreset.list/read/copy/select/remove/openDocument` (`CONN:10186-10192`), `pluginInventory.list` (remote face, `SETINV:280`).

Default landing: the settings panel renders **only the active section** (`SETGEN:164` `renderSlot("settings.section", { close }, { only: active })`, `active = rows[0]?.id` when nothing was requested, `SETGEN:97`), and the General section registers with `order: 0` (`SETGEN:585-595`) while models is `order: 10` (`SETMODELS:2785-2787`), plugins `15` (`SETPLUG:1277-1279`), agent-presets `20` (`agent-preset:1707-1709`). So the **first open lands on General** and the other sections' components do not mount at all.

| RPC | package | call site | fired when | guarded against a second open? |
|---|---|---|---|---|
| `settings.describe` | `dsh-client-ui-settings` | `SET:1293` (`api.settings.describe({})` inside `SettingsDescribeMirror.run`) | **page load**: `SET:1347 mirror.ensure()` in the plugin's own `ctx.effect` (`SET:1337-1350`); also each `SET:1342 settings/document-updated` and `SET:1344 connection/reset`; each scope bind does a no-op `ensure()` (`SET:1168`) | **Yes, "already loaded" semantics** — `ensure()` (`SET:1246-1251`) reads only from `idle`; `load()` (`SET:1230-1237`) folds concurrent calls into the in-flight read + one rerun. A second open adds **zero** reads |
| `settings.openDocument` | `dsh-client-ui-settings-general` | `SETGEN:400` | **user click** on the header "open configuration file" button (`SETGEN:340-342`; the row effect `SETGEN:326-327` only `ensure()`s) | n/a (gesture); `open()` refuses while `opening` (`SETGEN:395`) |
| `settings.mutate` | permission-presets / models / plugins rows | `permission-presets:290`, `SETMODELS:1131,1475,1740`, `SETPLUG:803/807` scope writes | user edits/saves only | n/a |
| `llm.providers` | `dsh-client-ui-settings-models` | `SETMODELS:548` (`Promise.all([this.api.llm.providers({}), this.describeFace.ensure()])`) | **first view of the Models section** (`order:10`), via `if (state.status === "idle") controller.load()` at `SETMODELS:1856` (also `:2210`, `:2298` for the onboarding dialogs) | **Yes** — `status === "idle"` gate on a module-lifetime controller: leaving and re-entering the Models section skips the read |
| `credentials.describe` (models) | `dsh-client-ui-settings-models` | `SETMODELS:578` | same load as above, only when `refs.length > 0` | as above (idle-gated) |
| `credentials.describe` (plugins) | `dsh-client-ui-settings-plugins` | `SETPLUG:1057` (`readCredential()`) | first view of the Plugins section (`order:15`) **and** expansion of a credential field | no cache, but per-field and gesture-driven; `SETPLUG:944 describeFace.ensure()` in the tab controller constructor (`SETPLUG:924-946`) is a no-op once the mirror is ready |
| `pluginInventory.list` | `dsh-client-ui-settings-plugin-inventory` | `SETINV:280` (`await ctx.remote.pluginInventory.list()`), component effect at `SETINV:70-85` | **first view of the Plugins section's "all" tab** (`SETINV:283-290`, registered into `settings.plugins.tab`) | **No persistent cache** — the tab component re-fetches on every mount (deps `[list, request]`, `SETINV:85`); only the manual `retry` counter is local |
| `agentPresets.list` | `dsh-client-ui-agent-preset` | `agent-preset:535` (`readRoster` ← `beginRosterRead` `:561-575` ← `AgentPresetSettingsController.load()` `:633`) | **page load AND every settings open**: page load via the session-header label `AgentPresetLabel` (`:191-196`, `load()` only when `preset !== undefined`) and via the composer seat; the General row mounts on every panel open (`AgentPresetRow:290-295`, effect `:293-295`; inject `:1578-1582`) | **No "already loaded" cache** — `beginRosterRead` only refuses a read *already in flight* (`:561-575`); a re-open re-issues it |
| `agentPresets.list` (seat/section variants) | `agent-preset` | `:1441` (seat), `:569` (section) | chip in a blank session / Agent Presets section (`order:20`), plus `settings/document-updated` and `connection/reset` refreshes (`:1584-1596`) | in-flight-only refusal, same helper |
| `usage` channel (`rpc.call(CHANNEL, "summary"/"timeseries"/"heatmap"/"byModel"/"byProject"/"byDay")`, `@local/dsh-usage/lib/client.js:910-915`, + `setInterval` poll at `:986-996`) | `@local/dsh-usage` | card registered into `settings.plugin.item` (`:1231-1240`) | first view of the Plugins section → "Configurable" tab (`SETPLUG:1288-1299`) | no; polls on an interval while mounted |

**Verdict 4 — first-open vs steady-state: DIFFERENT only for the roster read.**
On the literal first open of the settings panel (General section, the default), the **only** network read the panel itself issues is `agentPresets.list` (General row mount). Everything else the brief lists is either already done at page load (`settings.describe`), deferred to a *different* section's first view (`llm.providers`, `credentials.describe`, `pluginInventory.list`, `usage.*`), or gesture-driven (`settings.openDocument`, `settings.mutate`). `agentPresets.list` is **not** guarded by an "already loaded" cache, so it is issued on first open *and* on every subsequent open — i.e. it is a first-open RPC but not a first-open-*only* one; the genuinely first-open-only reads are the models/pluginInventory/credentials ones, and they belong to the first view of *their* section.

---

## Summary

| # | question | verdict | short answer |
|---|---|---|---|
| 1 | full first-apply write path / token count | **SAME** | First apply is **page-load boot** (`LAYOUT:553`), not settings open. Guard at `:420` cannot fire (`lastSignature === undefined`). Tokens come only from runtime override layers — the built-in themes carry `tokens: {}` (`THEME:998-1006`); the only layer is the wallpaper's `--dsw-alias-bg-base` (`WALL:195-207`) ⇒ **N = 0 on the first apply, 1 on the second**; no token *catalog* on disk (the 13-entry `BUILTIN_INSPECT_TOKENS` at `THEME:1007-1088` is an inspection directory) |
| 2 | theme-color meta first write | **SAME** (real first write is at page load) | `refreshThemeColor` only reachable via `apply` → `scheduleThemeColorRefresh` (`:449`, `:359-380`), coalesced to **≤1 `getComputedStyle` per frame per window**; first-ever call is the expensive one (body just invalidated at `:428-436`, stylesheets just appended by `THEME:148-160`), later applies are skipped at `:420` ⇒ 0. On a first open (config permitting a publish) the delta is exactly **+1** forced recalc |
| 3 | theme publish on settings open | **SAME** (config-dependent, would be DIFFERENT with a per-page wallpaper override) | Theme publishes only from `setTheme` / `adopt` / `overrideTokens` / `register` / media change (`THEME:1139-1268`). Opening the panel writes nothing; the only re-entry path is the wallpaper row's `notifySettingsOpen` → `applyCurrent` → `shadeTokens`, and `sameShadedTokens` (`WALL:180-204`) early-returns because `~/.dsh/settings.yaml:199-204` has no `pages.settings` override. Overlay element is created lazily inside `applyWallpaper` (`WALL:250-255`) — with the current global wallpaper it already exists at page load |
| 4 | RPCs on first open | **DIFFERENT** (roster read only) | First open (General, default section) issues **`agentPresets.list`** (`agent-preset:535` via `:633` ← row effect `:293-295`) — re-issued every open (no loaded-cache, only in-flight dedupe at `:561-575`). `settings.describe` already ran at page load (`SET:1347`, idle-gated `ensure()` at `:1246-1251`); `llm.providers`+`credentials.describe` (`SETMODELS:548,578`) are idle-gated and belong to the first Models-section view; `pluginInventory.list` (`SETINV:280`, effect `:70-85`) re-fetches on each Plugins-tab mount; `settings.openDocument` (`SETGEN:400`), all `settings.mutate` writes, `credentials.describe` for plugin fields (`SETPLUG:1057`) and the `usage` channel (`dsh-usage:910-915`) are gesture/still-later |

Not covered by static reading (no live trace was taken, per scope): actual wall-clock cost of the single forced recalc, and whether the wallpaper layer lands before or after `LAYOUT:553` on a given load (both orders are analysed above; they differ only in whether the "first" apply writes 0 or 1 property).
