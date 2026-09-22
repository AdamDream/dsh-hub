# sub-general-mount — first-open mount audit of `settings.general.item` registrants

Scope: the moment the Settings modal opens with `general` active, list **every** component that
mounts for the first time in the session from `renderSlot("settings.general.item", {})`, and
enumerate its mount-time work with `path:line`.

Read-only audit. No process was started, restarted or killed.

---

## 0. Artifacts audited, and one artifact-integrity finding

Shipped bundles (read from the npm-global install the GUI runs):

```
/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<pkg>/lib/client.js
```

Local plugin: the task names `/home/CNS2026495165/dsh/dsh-*/lib/client.js`, **but that is not the
live artifact for wallpaper.** Finding:

| plugin id | workspace copy | deployed (live) copy | relationship |
|---|---|---|---|
| `@local/dsh-wallpaper` | `dsh-wallpaper-local/lib/client.js` (597 lines) | `.dsh/profiles/node_modules/@local/dsh-wallpaper/lib/client.js` (610 lines) | **DIFFERS — deployed is newer** |
| `@local/dsh-usage` | `dsh-usage/lib/client.js` (592 lines) | `.dsh/profiles/node_modules/@local/dsh-usage/lib/client.js` (1249 lines) | DIFFERS (different generation; registers `settings.plugin.item`, out of scope) |
| `@local/dsh-btw` | `dsh-btw/lib/client.js` | same file content | IDENTICAL (out of scope) |
| `@deepseek-ai/dsh-taste` | `dsh-taste/lib/client.js` | not deployed | n/a (registers `sidebar.footer.action`, `shell.overlay`) |
| `@local/dsh-pptmaster`, `dsh-ssh-gui`, `dsh-subagent-model` | — | deployed only | do **not** register `settings.general.item` |

The `@local/dsh-wallpaper` delta is 13 added lines that materially change this audit: the deployed
copy already short-circuits the redundant theme publish (see §6 and §8). Citations below for
wallpaper use the **deployed** path; the stale workspace path is cited where the behavior differs.

Registrant census (only one local plugin registers the slot):

```
grep -rn 'settings.general.item' /home/CNS2026495165/.dsh/profiles/node_modules/@local/*/lib/client.js
→ @local/dsh-wallpaper/lib/client.js:591
```

Six registrants, in slot order: `agent-preset` (-25), `permission` (-20), `language` (0),
`appearance` (10), `composer-enter` (20), `wallpaper` (30).

## 0.1 Framework preconditions that govern every row (read this before the tables)

1. **Entry `inject` factories are cached, component effects are not.** `cachedRootInject(entry, actions)`
   memoises the inject result in `rootInjectCache` keyed by entry identity
   (`dsh-client-ui-renderer/lib/client.js:715`, cache at `:330`, `runInject` at `:334-342`).
   Consequence: each plugin's `inject:` callback runs **once per entry lifetime**, while the row's
   own `useEffect(..., [])` runs on **every** mount (every open of the General section).
2. **`useStore` is `useSyncExternalStoreWithSelector`** (`renderer:154-160`), and every store here is
   a zustand wrapper whose `subscribe` only registers a listener — **no synchronous listener fire at
   subscribe time** (`dsh-client-runtime/lib/client.js:5397-5427`, `defineStore` at `:5472-5502`).
3. **Every entry is wrapped in a `SlotErrorBoundary`** (`renderer:773-791`).
4. **The `general` section declares the child slot**; the item rows declare none (§7).

---

## 1. `agent-preset` — AgentPresetRow (order -25)

Registration: `dsh-client-ui-agent-preset/lib/client.js:1699-1706`.
Component: `AgentPresetRow`, `:290-329`.

| action | path:line | verbatim quote | runs on first open? | cost class |
|---|---|---|---|---|
| uSES subscribe to controller store, whole-snapshot selector | `dsh-client-ui-agent-preset/lib/client.js:291` | `const state = useAgentPreset((snapshot) => snapshot);` | yes | cheap (subscription; re-renders on any store change) |
| `useState(false)` | `:292` | `const [open, setOpen] = (0, react.useState)(false);` | yes | trivial |
| **mount effect → `load()`** | `:293-296` | `(0, react.useEffect)(() => { load(); }, [load]);` | **yes, every mount** | **RPC + host FS I/O** |
| → `load` identity (stable closure) | `:1580` | `load: () => controller.load(),` | n/a | — |
| → controller load | `:633-655` | `async load() { const roster = await beginRosterRead(this.api, this.store); ... }` | yes | RPC |
| → read guard: only refuses while `loading` | `:561-576` | `if (before.status === "loading") return void 0;` … `const roster = await readRoster(api);` | yes | — |
| → **RPC method** | `:533-535` | `const response = await api.agentPresets.list({});` | yes | network/IPC round-trip |
| → host handler | `…/@deepseek-ai/dsh-agent-presets/lib/index.js:887-889` | `async list() { return await discoverPresets(this.resolvedRoots); }` | yes | host-side |
| → discovery, **uncached** | `dsh-agent-presets/lib/index.js:270-277` | `for (const root of roots) for (const preset of await scanRoot(root)) {` | yes | per-call |
| → per root / per preset FS work | `dsh-agent-presets/lib/index.js:236-264` | `children = await readdir(dir, { withFileTypes: true });` … `await isFile(path) ? await compositionProblem(path) : …` … `await readPresetMetadata(directory)` | yes | readdir + stat + readFile |
| → YAML parse of each composition | `dsh-agent-presets/lib/index.js:194-208` | `rows = load(content, { schema: entryListSchema });` | yes | parse |
| → mirror ensure (writability) | `:646` | `await this.describeFace.ensure();` | yes | no-op when mirror ready (§5) |
| state-only second effect | `:297-300` | `if (state.writable && state.status !== "unavailable") return; setOpen(false);` | no (condition only) | trivial |
| render | `:301-328` | `jsx(PresetMenu, {...})` | yes | — |
| nested component `PresetMenu` | `:226-259` | `jsx(_deepseek_ai_dsh_client_ui_primitives.Menu, { open, … portal: true, anchor: … })` | yes | see §9 (Menu mount) |

**Confidence: HIGH.** `load()` is not gated by a "already loaded" test — `beginRosterRead` refuses
only an in-flight read (`:563`), so every re-mount of the General section issues a fresh
`agentPresets.list` and a fresh uncached filesystem discovery on the host.

## 2. `permission` — PermissionRow (order -20)

Registration: `dsh-client-ui-permission-presets/lib/client.js:441-448`.
Component: `PermissionRow`, `:63-148`.

| action | path:line | verbatim quote | runs on first open? | cost class |
|---|---|---|---|---|
| uSES whole-snapshot subscribe | `dsh-client-ui-permission-presets/lib/client.js:64` | `const state = usePermission((snapshot) => snapshot);` | yes | cheap |
| three `useState` booleans | `:65-67` | `const [open, setOpen] = (0, react.useState)(false);` | yes | trivial |
| **mount effect → `load()`** | `:68-70` | `(0, react.useEffect)(() => { load(); }, [load]);` | **yes, every mount** | store update + (conditional) RPC |
| → `load` | `:431` | `const load = () => controller.load();` | yes | — |
| → controller load | `:260-271` | `this.following ??= this.describeFace.subscribe(() => { this.derive(); });` … `this.store.update((state) => { state.status = "loading"; … })` … `await this.describeFace.ensure(); this.derive();` | yes | cheap; **`subscribe` is one-shot** (`??=`) |
| → `ensure()` semantics | `dsh-client-ui-settings/lib/client.js:1246-1251` | `if (this.inFlight !== void 0) return this.inFlight; if (this.getSnapshot().status === "idle") return this.load(); return Promise.resolve();` | yes | **no RPC when the shared mirror is already answered** |
| → mirror is ensured at boot | `dsh-client-ui-settings/lib/client.js:1340-1351` | `mirror.ensure();` inside `apply`'s invalidation effect | boot | — |
| → the only RPC on this path, if idle | `dsh-client-ui-settings/lib/client.js:1293` | `const response = await this.api.settings.describe({});` | not on this deployment's open | network |
| `derive()` fold over namespaces | `dsh-client-ui-permission-presets/lib/client.js:315-345` | `const view = mirrored.view.namespaces.find((entry) => entry.ns === PERMISSION_SETTINGS_NS);` | yes | cheap (array scan) |
| state-only second effect | `:71-76` | `if (state.writable && state.status !== "unavailable") return; setOpen(false); …` | no | trivial |
| render `Menu` (portal) | `:94-127` | `jsx(Menu, { open, … portal: true, anchor: … })` | yes | see §9 |
| render `RiskConfirmation` → `Modal` | `:128-147`; primitives `lib/index.js:2077-2088` | `if (!open) return null;` | yes | **null render** (effect returns early at `:2078-2087`) |

**Confidence: HIGH** for "no RPC on a normal first open"; **MEDIUM** for the extra store writes, which
are not independently measurable from source.

## 3. `language` — LanguageRow (order 0)

Registration: `dsh-client-locale/lib/client.js:1247-1254`.
Component: `LanguageRow`, `:908-953`.

| action | path:line | verbatim quote | runs on first open? | cost class |
|---|---|---|---|---|
| two uSES store reads | `dsh-client-locale/lib/client.js:909-910` | `const active = useStore((s) => s.active);` / `const options = useStore((s) => s.options);` | yes | cheap |
| `useState(false)` | `:911` | `const [open, setOpen] = (0, react.useState)(false);` | yes | trivial |
| render-time `find` | `:912` | `const activeLabel = options.find((o) => o.id === active)?.label ?? active;` | yes | trivial (2 items) |
| **no `useEffect` at all** | — | (component body `:908-953`) | — | — |
| entry inject (once per entry lifetime) | `:1242-1247` | `const injected = (actions) => { bound = actions; sync(locale.getLocale()); return { setLocale: (id) => { locale.setLocale(id); } }; };` | yes (first render) | — |
| → `sync` | `:1234-1240` | `syncDocumentLanguage(snapshot.active); bound?.sync(snapshot.active, snapshot.locales.map((l) => ({ id: l.id, label: l.label })), snapshot.revision);` | yes | — |
| → **DOM write** | `:1018-1021` | `document.documentElement.lang = DOCUMENT_LANGUAGE[active];` | yes, **unconditional on every inject/sync** | `<html lang>` attribute write |
| → store write (revision-guarded) | `:968-973` | `actions: { sync: (d, active, options, revision) => { if (revision <= d.revision) return; …` | first open only | cheap |
| render `Menu` (portal) | `:925-951` | `jsx(Menu, { open, … portal: true, anchor: … })` | yes | see §9 |
| **dictionary registration at mount?** | **NO** — all `ctx.locale.register` calls live in `apply` | `apply` sites: `dsh-client-locale/lib/client.js:1222`, `:1226` (plus each feature's `ctx.effect` in its own `apply`) | — | — |

**Confidence: HIGH** (§9 verdict).

## 4. `appearance` — AppearanceRow (order 10)

Registration: `dsh-client-ui-theme/lib/client.js:1337-1344`.
Component: `AppearanceRow`, `:74-94`.

| action | path:line | verbatim quote | runs on first open? | cost class |
|---|---|---|---|---|
| single uSES store read | `dsh-client-ui-theme/lib/client.js:75` | `const preference = useStore((s) => s.preference);` | yes | cheap |
| **no `useEffect`, no `useState`, no DOM read/write** | — | body `:74-94` | — | — |
| entry inject (once per entry lifetime) | `:1330-1336` | `const injected = (actions) => { bound = actions; sync(theme.getTheme()); return { setTheme: (id) => { theme.setTheme(id); } }; };` | yes (first render) | — |
| → store write (revision-guarded, `sync` at `:1326-1328`) | `:112-116` | `actions: { sync: (d, preference, revision) => { if (revision <= d.revision) return; …` | first open only | cheap |
| 3 static buttons | `:83-91` | `children: CUBES.map(({ id, labelKey, Icon }) => jsx("button", {…}))` | yes | trivial |
| `installThemeStyles` (**5 `<style>` inserts**) | `:148-160`, called at `:1317` | `for (const [name, css] of STYLES) ctx.effect(() => { const tag = document.createElement("style"); … document.head.appendChild(tag); … })` | **NO — runs at plugin apply (client boot)** | boot, not first-open |
| module CSS auto-insert | `:26-34` | `if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + … ) === null) { const tag = document.createElement("style"); … }` | boot (module eval) | boot |
| `ThemeRuntime` construction (matchMedia, scope subscribe, adopt) | `:1111-1150`, called at `:1318` | `this.media = typeof matchMedia === "undefined" ? void 0 : matchMedia("(prefers-color-scheme: dark)");` … `ctx.effect(() => host.subscribe(() => { this.adopt(); }), …); this.adopt();` | boot | boot |

**Confidence: HIGH.** The Appearance row is the cheapest of the six: zero effects, zero RPC, zero DOM work.

## 5. `composer-enter` — EnterBehaviorRow (order 20)

Registration: `dsh-client-ui-conversation/lib/client.js:9911-9921`.
Component: `EnterBehaviorRow`, `:4208-4259`.

| action | path:line | verbatim quote | runs on first open? | cost class |
|---|---|---|---|---|
| uSES read of the busy-enter store | `dsh-client-ui-conversation/lib/client.js:4209` | `const behavior = useBusyEnter((value) => value);` | yes | cheap |
| `useState(false)` | `:4210` | `const [open, setOpen] = (0, react.useState)(false);` | yes | trivial |
| **no `useEffect`, no `load()`, no RPC** | — | body `:4208-4259` | — | — |
| entry inject (pure closure) | `:9913-9920` | `inject: () => ({ hooks: { busyEnter: submissionPolicy.busyEnter }, setBusyEnter: (behavior) => { submissionPolicy.setBusyEnter(behavior); } })` | yes (first render) | trivial |
| hook source identity | `:2439` | `busyEnter = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(DEFAULT_BUSY_ENTER_BEHAVIOR);` | n/a (built at apply) | plain value store |
| render `Menu` (portal) | `:4231-4253` | `jsx(Menu, { open, … portal: true, anchor: … })` | yes | see §9 |

**Confidence: HIGH.** Nothing but a subscription and a button.

## 6. `wallpaper` — WallpaperRow (order 30) — the only row with cross-app side effects

Registration (deployed): `.dsh/profiles/node_modules/@local/dsh-wallpaper/lib/client.js:591-602`
(stale workspace equivalent: `dsh-wallpaper-local/lib/client.js:578-591`).
Component: `WallpaperRow`, deployed `:386-486`.

| action | path:line | verbatim quote | runs on first open? | cost class |
|---|---|---|---|---|
| 4 `useState` + `useRef` | `wallpaper:387-398` | `const [target, setTarget] = React.useState("global");` | yes | trivial |
| **mount effect: page-state flip** | `wallpaper:400-403` | `React.useEffect(() => { notifySettingsOpen(true); return () => notifySettingsOpen(false); }, []);` | **yes, every open AND its unmount** | **global side effect** |
| → action | `wallpaper:518-521` | `notifySettingsOpen: (open) => { if (pageState.settingsOpen === open) return; pageState.settingsOpen = open; applyCurrent(ctx); }` | yes | — |
| → page resolver | `wallpaper:344-346` | `function currentPage() { if (pageState.settingsOpen) return "settings"; … }` | yes | — |
| → `applyCurrent` | `wallpaper:348-350` | `function applyCurrent(ctx) { applyWallpaper(ctx, resolveOverride(latestValue, currentPage())); }` | yes | — |
| → `applyWallpaper` (source set) | `wallpaper:238-268` | `ensureWallpaperCss(); if (wallpaperEl === null \|\| !document.body.contains(wallpaperEl)) { … }` | yes | DOM/style |
| → stylesheet insert, guarded | `wallpaper:138-139`, `:153-166` | `if (cssEl !== null && document.head.contains(cssEl)) return;` … `"[data-phase]:not(textarea){background:transparent!important}"` … `document.head.append(cssEl);` | **not on this deployment's open** (created at boot) | would be document-wide `!important` CSS |
| → body DOM insert, guarded | `wallpaper:220-223` | `element.style.cssText = "position:fixed;inset:0;z-index:-1;…"; document.body.prepend(element);` | not on this deployment's open (element from boot) | **`document.body` write** |
| → per-open style writes | `wallpaper:253-255`, `:262-266` | `wallpaperEl.style.backgroundImage = \`url("${config.source}")\`;` … `wallpaperEl.style.filter = …` … `releaseMaskElement();` | **yes, once per open** (the same block runs a second time only in the stale workspace copy — see the guard row) | style write / image |
| → token override | `wallpaper:190-211` | `function shadeTokens(ctx, opacity) { if (shading) return; shading = true; try { … }` | yes (called at `:268`) | — |
| → **deployed guard: redundant publish skipped** | `wallpaper:181-185` (def), `:201-207` (use) | `if (sameShadedTokens(shadedTokens, next)) return;` … `// re-stacking identical content only re-enters every theme/change listener, so the existing layer is kept and its redundant publish is skipped.` … `overrideDispose = ctx.theme.overrideTokens(OVERRIDE_SOURCE, next);` | yes | **suppresses the theme storm** |
| → stale workspace copy: **no guard** | `dsh-wallpaper-local/lib/client.js:183-198` | `overrideDispose?.(); overrideDispose = ctx.theme.overrideTokens(OVERRIDE_SOURCE, { … });` | would publish `theme/change` | global event (not live) |
| → theme/change echo | `wallpaper:588` | `ctx.on("theme/change", () => applyCurrent(ctx));` | re-entrancy source; `shading` flag bounds it | — |
| entry inject (once per entry lifetime) | `wallpaper:596-601` | `inject: (bound) => { actions = bound; sync(); return createRowActions(ctx, scope); }` | yes (first render) | one extra `applyCurrent` |
| **preview `<img>`** | `wallpaper:453` | `const preview = config.source === null ? null : jsx.jsx("img", { src: config.source, alt: "", style: styles.preview });` | **yes, every open** | image request/decode |
| `cleanupMedia` POST | `wallpaper:306-311`, guard `:342`, `:586` | `await fetch(\`${MEDIA_ROUTE}/cleanup\`, { method: "POST", … });` guarded by `if (!cleanupDone && snapshot.status === "ready")` | **not per mount** (`cleanupDone` set at boot) | network (boot only) |

Deployment evidence for the image: `~/.dsh/settings.yaml:199-204` sets
`wallpaper.global.source: /dsh-wallpaper/media/37758c1c-9ca8-47d2-bade-3048ab825fb6.png` with
`opacity: 0.88`; that file is 2 334 260 bytes, PNG 1810×1279. The host serves media with
`"cache-control": "private, max-age=31536000, immutable"`
(`.dsh/profiles/node_modules/@local/dsh-wallpaper/lib/index.js:261`), so repeat opens hit the HTTP
cache and pay decode, not transfer.

**Confidence: HIGH** on the action list and on "twice per open" (§8); **MEDIUM** on absolute cost
(decode/transfer split not determinable from source).

## 7. Nested slots: where the cascade comes from (and where it stops)

The nested-slot declaration is **not on any row** — it is on the section registrant:

```
dsh-client-ui-settings-general/lib/client.js:585-595
ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "general",
    order: 0,
    label: () => t("general.nav"),
    locale: NS,
    children: { "settings.general.item": { kind: "list", scope: "root" } }
}, GeneralSection));
```

`children` is what hands `GeneralSection` its `renderSlot` binding
(`renderer:593-597`: `if (entry.children !== void 0) { kit["renderSlot"] = boundRenderSlot(host, entry); … }`).

None of the six item registrations declares `children`
(`agent-preset:1699-1706`, `permission:441-448`, `locale:1247-1254`, `theme:1337-1344`,
`conversation:9911-9921`, `wallpaper:591-602`) → **the cascade is exactly one level deep**
(section → item) and stops at the rows.

## 8. Cascade tree mounted by the General section (item 6)

```
SettingsPanel                         settings-general:96
├─ keydown listener (document)        settings-general:99-107   [every open]
├─ closeButton.focus()                settings-general:108-111  [every open, [] deps]
├─ renderSlot("settings.header")      settings-general:129
├─ renderSlot("settings.action")      settings-general:151
├─ renderSlot("settings.close")       settings-general:159
├─ renderSlot("settings.trigger")     settings-general:211 (outside the panel)
└─ renderSlot("settings.section", {close}, {only: active})    settings-general:164
   └─ outlet + SlotErrorBoundary      renderer:752 / :773-791
      └─ GeneralSection               settings-general:295-299
         └─ renderSlot("settings.general.item", {})   settings-general:298
            └─ outlet + 6 × SlotErrorBoundary        renderer:752 / :773-791
               ├─ AgentPresetRow    :290  → PresetMenu :226 → Menu(portal) :230
               ├─ PermissionRow     :63   → Menu :94  + RiskConfirmation :128 → Modal(null)
               ├─ LanguageRow       :908  → Menu :925
               ├─ AppearanceRow     :74   → 3 buttons (no child component)
               ├─ EnterBehaviorRow  :4208 → Menu :4231
               └─ WallpaperRow      :386  → Slider ×2 (wallpaper:358) + img/select/input
```

- **Component depth: 7–8 levels** (panel → outlet → boundary → section → section outlet →
  boundary → row → Menu).
- **Registrant-level components mounted: 6 rows + 4 `Menu` + 1 `RiskConfirmation`→`Modal`(null) +
  1 `PresetMenu` + 2 `Slider` ≈ 14**, plus 7 slot outlets/boundaries ≈ **21 React components**.
- **Subscriptions created at mount:** 2 uSES per row on average (store + locale revision), i.e.
  ~12 store subscriptions + 6 locale-revision subscriptions
  (`renderer:484-487` `useLocaleRevision`, `:154-160` `bindSnapshotSelector`).
- No row renders a further slot; no row registers a slot.

## 9. Shared `Menu` mount cost (4 of the 6 rows render one, all with `portal: true`)

Primitives artifact: `/home/CNS2026495165/dsh/dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js`
(the package is a transitive dependency; the served copy is the same generation — treat exact line
numbers as MEDIUM, behavior as HIGH).

| action | path:line | verbatim quote | on mount (closed)? |
|---|---|---|---|
| layout effect returns early while closed | `primitives/lib/index.js:1536-1540` | `useLayoutEffect(() => { if (!open \|\| !portal) { setFixedPos(null); return; } …` | runs, then returns; `setFixedPos(null)` on an already-null state → React bails out |
| measure path (only when open) | `:1541-1571` | `r = rootRef.current?.getBoundingClientRect() ?? null;` … `const lw = listEl?.offsetWidth ?? 0; const lh = listEl?.offsetHeight ?? 0;` | **not mounted-closed** (click-time) |
| global listeners (only when open) | `:1574-1575`, `:1601-1602` | `window.addEventListener("scroll", place, true);` … `document.addEventListener("pointerdown", onPointerDown);` | not mounted-closed |
| portal (only when open) | `:1683`, `:1708` | `const list = open && jsxs("div", { … })` … `portal ? list !== false && createPortal(list, document.body) : list` | renders `false` — **no portal** |
| pointer-grace hook | `:1463-1484` | `useEffect(() => cancel, [cancel]);` | cleanup registration only; no timer at mount |

**Confidence: HIGH** that a closed `Menu` performs no measurement, no portal and no document listener
on mount.

---

## 10. SPECIAL FOCUS — theme plugin (`dsh-client-ui-theme/lib/client.js:1338` region)

**Verdict: there is NO "replay all theme CSS variables" / "apply palette to every element" loop in the
theme plugin, and none of it runs at first open.** Evidence:

1. Exhaustive grep over the whole bundle for DOM/style side effects:
   `grep -n 'getComputedStyle|querySelectorAll|createElement("style")|requestAnimationFrame|setInterval|setTimeout|ResizeObserver|MutationObserver|IntersectionObserver|documentElement|document.body|getBoundingClientRect|offsetHeight|offsetWidth|scrollHeight|clientHeight|setProperty|cssText|adoptedStyleSheets|styleSheets'`
   → **exactly two hits**, both stylesheet inserts:
   - `dsh-client-ui-theme/lib/client.js:29` `const tag = document.createElement("style");` (module-level, guarded by the idempotence check at `:28`)
   - `dsh-client-ui-theme/lib/client.js:151` `const tag = document.createElement("style");` (inside `installThemeStyles`'s `ctx.effect`, run at apply)
   No `getComputedStyle`, no `querySelectorAll`, no `setProperty`, no observer, no timer, no rAF.
2. `installThemeStyles` runs at apply, not at mount:
   `:1317` `installThemeStyles(ctx);` → `:150-159` iterates the 5 sheets (`:137-143`).
   The largest of them (`design_platform_css_default`, `:124`) is a single `body{…}` rule with
   hundreds of custom properties — a **client-boot** cost, not a first-open cost.
3. The only place that writes tokens onto elements is **`ThemePresenter` in `dsh-client-ui-layout`**
   (a different plugin), and it is signature-guarded:
   - `dsh-client-ui-layout/lib/client.js:408` `apply(snapshot) {`
   - `:418` `const signature = scheme + "\u0000" + tokenSignature(entries);`
   - `:420-427` `if (signature === this.lastSignature && this.landingIntact(scheme, body)) { … return; }`
   - `:428` `document.documentElement.style.colorScheme = scheme;`
   - `:429-430` `if (scheme === "dark") body.setAttribute(DARK_ATTRIBUTE, ""); else body.removeAttribute(DARK_ATTRIBUTE);`
   - `:431` `for (const name of this.appliedTokens) body.style.removeProperty(name);`
   - **`:433-436` the token write loop**: `for (const [name, value] of entries) { body.style.setProperty(name, value); this.appliedTokens.push(name); }`
   - `:437` `if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta);`
   - `:460-467` `landingIntact(...)` — `if (document.documentElement.style.colorScheme !== scheme) return false;` … `for (const name of this.lastTokens) if (body.style.getPropertyValue(name) === "") return false;`
4. **`getComputedStyle` used to derive a color — yes, exactly one site, deliberately deferred:**
   - `dsh-client-ui-layout/lib/client.js:440-447` (comment): *"The metadata value is the COMPUTED body background, so it must be read after these writes; that read is what forces a synchronous, document-wide style recalculation. Deferring it to the next animation frame collapses a whole dispatch round …"*
   - `:449` `scheduleThemeColorRefresh(this.themeColorMeta.ownerDocument?.defaultView, this);`
   - `:472-477` `refreshThemeColor() { … this.themeColorMeta.content = getComputedStyle(document.body).backgroundColor; … }`
   - This is a forced style recalculation **only when the signature changed** (it is downstream of the `:420` early return) and only on the next frame, not synchronously after the writes.
5. **How many tokens the loop can write here:** built-in themes carry no tokens —
   `dsh-client-ui-theme/lib/client.js:998-1006` `BUILTIN_THEMES = Object.freeze([Object.freeze({ id: "light", colorScheme: "light", tokens: Object.freeze({}) }), Object.freeze({ id: "dark", … tokens: Object.freeze({}) })])` — and in this deployment only the wallpaper plugin calls `overrideTokens`
   (grep over `.npm-global/.../@deepseek-ai/*/lib/client.js` and `dsh-*/lib/client.js`: the sole hit is
   `wallpaper:189` / deployed `:200`), contributing **one** token (`--dsw-alias-bg-base`).
   → the loop writes 0–1 properties, not a palette.
6. Mount-vs-change: the theme plugin's first-open work is only the entry inject
   (`:1330-1336` → `sync(theme.getTheme())` → store write at `:112-116`, revision-guarded).
   `theme/change` is emitted by `publish()` (`:1264-1268`): `this.revision += 1; this.snapshot = this.buildSnapshot(); this.ctx.emit("theme/change", this.snapshot);`
   — synchronous, but **not triggered by mounting this row**.

**Confidence: HIGH** for "no palette-replay loop in the theme plugin and no first-open theme work
beyond a store write"; **HIGH** that the layout token loop is signature-guarded; **MEDIUM** on whether
the presenter's `apply` is skipped on a given open in practice (it depends on whether the wallpaper's
override content changed, which is deterministic from source: it does not change between opens).

## 11. SPECIAL FOCUS — locale plugin (`dsh-client-locale/lib/client.js:1251` region)

**Verdict: mounting the Language row registers NO dictionary and does NOT bump the locale revision.
No global locale-subscriber notification happens on first open.** Evidence:

1. `register` is the revision bumper and it is never called from a component:
   - `dsh-client-locale/lib/client.js:1169-1181` `publish(active, localeChanged) { this.snapshot = Object.freeze({ … revision: this.snapshot.revision + 1 }); if (localeChanged) this.ctx.emit("locale/change", this.snapshot); for (const fn of [...this.listeners]) try { fn(); } catch (error) { … } }`
     (comment `:1163-1168`: *"Advance the snapshot revision and notify LocaleFace subscribers (render refresh)."*)
   - Every `ctx.locale.register(...)` call site is inside a plugin `apply`, wrapped in `ctx.effect`:
     `dsh-client-locale:1222`, `:1226`; `dsh-client-ui-theme:1320`; `dsh-client-ui-agent-preset:1574`; `dsh-client-ui-permission-presets:405-425`; `dsh-client-ui-conversation:9903`; `dsh-client-ui-settings-general:475`; and the wallpaper equivalent `wallpaper:590`.
     Grep (`grep -rn 'locale.register(' --include=client.js`) returns no hit inside any component body.
2. What mounting the row actually does (already tabulated in §3): `syncDocumentLanguage` — an
   unconditional `document.documentElement.lang` write (`:1018-1021`) — plus one revision-gated store
   write (`:968-973`), and nothing else.
3. Consumer-side cost of a `locale/change` (for contrast, since it is *not* triggered here):
   every outlet subscribes to the face revision via `useLocaleRevision`
   (`renderer:484-487` `useSyncExternalStore(subscription?.subscribe ?? noopSubscribe, subscription?.getRevision ?? zeroRevision)`),
   and `localeSeat` re-derives `t` when the revision moves
   (`renderer:439-455` `const revision = face.getSnapshot().revision; … if (cached && cached.revision === revision) return cached.t;`).

**Confidence: HIGH.**

---

## 12. Ranked: the 5 most expensive first-open mount actions

Ranked strictly by what the source shows on the first open of `general`. Nothing here is qualified
with "probably heavy".

1. **`agentPresets.list` RPC re-fired by `AgentPresetRow`'s mount effect — every open.**
   `dsh-client-ui-agent-preset/lib/client.js:293-296` → `:633-635` → `:561-576` (`if (before.status === "loading") return void 0;` is the *only* refusal) → `:533-535` (`await api.agentPresets.list({})`) → host `dsh-agent-presets/lib/index.js:887-889` → `discoverPresets` `:270-277` → `scanRoot` `:236-264` (`readdir` + per-preset `stat` + `readFile` + YAML parse via `compositionProblem` `:194-208` + `readPresetMetadata`), with **no cache at any layer**. It is the only mount action that crosses the process boundary and the only one whose work scales with deployment-side data. Confidence HIGH that it runs; the RPC's absolute latency is **INCONCLUSIVE** from source (see §13).

2. **`WallpaperRow`'s mount effect flips global page state and re-applies the wallpaper — every open, and again on unmount.**
   `wallpaper:400-403` (`React.useEffect(() => { notifySettingsOpen(true); return () => notifySettingsOpen(false); }, []);`) → `:518-521` → `:348-350` → `:238-268`: body-level style writes (`wallpaperEl.style.backgroundImage`, `.filter`, `releaseMaskElement()`), plus the token-override path `:190-211`.
   **Deployed copy: exactly one `applyWallpaper` pass and no `theme/change` emit per open.** The guard at `:204` holds because `resolveBase` (`:186-189`) reads the *already shaded* `--dsw-alias-bg-base` back out of the composed snapshot and `toRgba` (`:168-177`) replaces the alpha (rgb regex branch) instead of multiplying it — so the recomputed layer is byte-identical and `sameShadedTokens` (`:181-185`) returns true. Nothing is published, so `ctx.on("theme/change", …)` (`:588`) never echoes and the second pass never happens.
   **Stale workspace copy (`dsh-wallpaper-local/lib/client.js:183-198`, no guard): two passes plus a redundant `theme/change` emit to every listener, each open** (the echo pass is bounded at two by the `shading` flag at `wallpaper:191` / `:184` in the stale copy). Confidence HIGH on the deployed one-pass behavior and on the stale copy's two-pass behavior; MEDIUM on magnitude.

3. **`WallpaperRow`'s preview `<img>` for a 2.33 MB PNG — every open.**
   `wallpaper:453` `jsx.jsx("img", { src: config.source, alt: "", style: styles.preview })` with
   `~/.dsh/settings.yaml:199-204` pointing at
   `/dsh-wallpaper/media/37758c1c-9ca8-47d2-bade-3048ab825fb6.png` (2 334 260 bytes, 1810×1279).
   Rendered at 72×44 CSS px (`wallpaper` `styles.preview`), so the cost is decode, not layout; the host's
   `cache-control: private, max-age=31536000, immutable` (`@local/dsh-wallpaper/lib/index.js:261`)
   makes repeat opens cache-served. Confidence HIGH that the element and URL are mounted on every open; MEDIUM on decode cost.

4. **`SettingsPanel`'s two mount effects: a document-level `keydown` listener and `closeButton.current?.focus()`.**
   `dsh-client-ui-settings-general/lib/client.js:99-107` (`document.addEventListener("keydown", onKeyDown);`) and
   `:108-111` (`(0, react.useEffect)(() => { closeButton.current?.focus(); }, []);`).
   `focus()` flushes pending style/layout to resolve focusability and scroll-into-view; it is the only
   first-open DOM-read-adjacent operation in the panel chrome. Confidence HIGH that it runs on every open; MEDIUM on cost.

5. **`PermissionRow`'s mount effect: `load()` → one-shot mirror subscribe + up to two store writes + `derive()`.**
   `dsh-client-ui-permission-presets/lib/client.js:68-70` → `:260-271` (`await this.describeFace.ensure();`) →
   `ensure()` is a **no-op unless the mirror is `idle`** (`dsh-client-ui-settings/lib/client.js:1246-1251`), and the
   mirror is ensured at boot (`:1347`), so no `settings.describe` is issued on open (`:1293`). Cost is a
   subscription (guarded by `??=`, `:262`), 1–2 `store.update` calls and one namespace `find`
   (`:331`). Confidence HIGH that no RPC is issued on this deployment's open.

Not in the top five, deliberately: `AppearanceRow` (§4 — a single uSES read plus one revision-gated
store write, no effect, no RPC, no DOM), `EnterBehaviorRow` (§5 — no effect at all), the 4 closed
`Menu`s (§9 — no measurement, no portal, no listener while closed), and `LanguageRow`
(§3 — one `<html lang>` write plus one store write on the first open only).

## 13. Explicitly INCONCLUSIVE (do not read these as findings)

1. **Absolute latency of `agentPresets.list`.** Source proves the call is issued on every open and
   that the host path is uncached FS + YAML work; it does not prove how many roots/presets and how
   many bytes this deployment scans. Settle it by timing the RPC: one DevTools Performance trace
   filtered on the `agentPresets.list` request, or a host-side `strace`/timing around
   `discoverPresets`, correlated with a single General-section open.
2. **Whether the wallpaper re-apply on open costs measurable time.** Source proves the call graph and
   the number of passes (one in the deployed copy, two in the stale workspace copy); it does not prove
   the cost of those style writes. Settle it by counting `wallpaperEl.style` writes and style-recalc
   events in one trace over one open.
3. **Decode cost of the 1810×1279 preview PNG.** Cache state and decode strategy are runtime facts.
   Settle it with a Chrome trace (`Decode Image`) over one open, and by comparing a cold vs warm cache.
4. **Extra React re-renders per open.** `load()` on agent-preset/permission flips `status` to
   `loading` and back, which re-renders those rows (whole-snapshot selectors, `:291` / `:64`); the
   count is derivable but its cost is not. Settle it with the React DevTools profiler's commit
   counter for one open.
5. **Whether `document.documentElement.lang` (§3) or the wallpaper CSS `!important` rules trigger a
   document-wide recalc on open.** The `lang` write happens on the inject path only (once per entry
   lifetime); the wallpaper stylesheet insert is guarded by `document.head.contains(cssEl)`
   (`wallpaper:139`). Settle it with a Recaculate Style / Style Recalculation entry in a trace.

## 14. One structural note worth carrying into the fix round

The asymmetry between the cached entry inject (`renderer:715`) and the uncached component effect is
the whole shape of this problem: *first-render-only* work (locale's `syncDocumentLanguage`, theme's
`sync`, wallpaper's `sync()`) happens once per entry lifetime, while *effect* work
(agent-preset's `load()`, permission's `load()`, wallpaper's `notifySettingsOpen`) repeats on every
single open and close of the General section. Any change that moves work from a row's `useEffect`
into its `inject` factory would collapse repeats to one — but that is a design decision, not an
audit finding.
