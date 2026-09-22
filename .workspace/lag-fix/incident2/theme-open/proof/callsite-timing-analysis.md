# Call-site & timing analysis — ui-layout ThemePresenter (theme-color deferred refresh)

Scope: read-only source analysis. No product file was modified; no browser was launched.
Host PID 10806, `http://127.0.0.1:3080`.

Artifacts analysed (all verified as the deployed revision — served == disk):

| artifact | path | rev |
|---|---|---|
| ui-layout client | `/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js` | `82cca1a6178a` (sha1_12), 571 lines, 24988 B |
| wallpaper client | `/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-wallpaper/lib/client.js` | `826d9217a8fc` (sha1_12), 611 lines, 31803 B |
| ui-theme client | `/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js` | 1354 lines |
| ui-settings-general | `.../@deepseek-ai/dsh-client-ui-settings-general/lib/client.js` | 604 lines |
| ui-renderer (slot outlets) | `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js` | 988 lines |
| cordis (events/fiber) | `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/src/events.ts`, `src/fiber.ts` | — |

Revision evidence (independent, from a previous session artifact, re-verified by `diff`):
- `/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/regression/verify-revs.json` → `served_rev 82cca1a6178a` / `826d9217a8fc`, `served_matches_disk: true`.
- `diff` of `live-repro/sub-static/curl/_deepseek-ai_dsh-client-ui-layout.js` vs the deployed file: identical (no output).
- Both deployed files carry the new code: `themeColorFrame` at `client.js:348`, `scheduleThemeColorRefresh` at `:359`, content-signature skip at `:418`–`:427`, `refreshThemeColor` at `:472`.

---

## 1. Who calls `ThemePresenter.apply()`?

Inside the bundle, `apply()` has exactly one class-method definition and exactly two call sites, both inside the second `ctx.effect` of the **plugin's own** `apply(ctx)` (module export, `ui-layout/lib/client.js:516`):

```
ui-layout/lib/client.js:551   ctx.effect(() => {
ui-layout/lib/client.js:552       const presenter = new ThemePresenter();
ui-layout/lib/client.js:553       presenter.apply(ctx.theme.getTheme());        // ← call site A (initial, synchronous)
ui-layout/lib/client.js:554       const off = ctx.on("theme/change", (snapshot) => {
ui-layout/lib/client.js:555           presenter.apply(snapshot);                // ← call site B (subscription)
ui-layout/lib/client.js:556       });
ui-layout/lib/client.js:557       return () => { off(); presenter.dispose(); };
ui-layout/lib/client.js:561   }, "ui-layout: theme presenter");
```

Subscription wiring (exact type):
- A **cordis event subscription** on the theme service's event name: `ctx.on("theme/change", …)` at `:554`. Not a watcher, not a store selector, not a React effect.
- The effect body runs **synchronously** when `ctx.effect(...)` is called: cordis executes the effect body inline (`cordis/src/fiber.ts:366` `const effect: Effect = runner.execute.call(this)`), and `ctx.emit` dispatches listeners **synchronously** (`cordis/src/events.ts:194-196` `emit(...args) { this.dispatch('emit', args).map(cb => cb(...args)) }`).
- The second `ctx.effect` runs immediately after the first (`:518`–`:550`, the service + `root` slot registration) because `apply(ctx)` is a straight-line function body.
- Note the name collision: `apply` at `:408` is the **ThemePresenter method**; `apply` at `:516` is the **plugin body** (`exports.apply = apply` at `:565`). The only callers of the presenter method are `:553` and `:555`.

Answer: **both.** `apply()` runs synchronously during initial plugin mount (`:553`, called during the plugin's apply phase, i.e. inside the cordis fiber start), and on the theme service's `theme/change` event (`:554`/`:555`). There is no third caller anywhere in the bundle (grep over `lib/` shows only `:553`/`:555` plus the definitions).

## 2. Who calls `scheduleThemeColorRefresh` / `refreshThemeColor`?

```
ui-layout/lib/client.js:448-449   this.pendingTokenSignature = tokenSignature(entries);
ui-layout/lib/client.js:449       scheduleThemeColorRefresh(this.themeColorMeta.ownerDocument?.defaultView, this);   // ONLY caller of schedule…
ui-layout/lib/client.js:363               presenter.refreshThemeColor();          // fallback branch: no requestAnimationFrame
ui-layout/lib/client.js:377               for (const item of pending) item.refreshThemeColor();   // rAF body
```

- `scheduleThemeColorRefresh` has exactly **one** call site: `:449`, at the end of `apply()` (and only on the non-skipped path — the early return at `:426` bypasses it entirely).
- `refreshThemeColor` (`:472`) has exactly **two** call sites: `:363` and `:377`.
- **Synchronous flush path exists but only as a capability fallback:** `:361-365`
  ```
  const request = winRef.requestAnimationFrame;
  if (typeof request !== "function") { presenter.refreshThemeColor(); return; }
  ```
  This is a `typeof` capability check on the window object handed in (`this.themeColorMeta.ownerDocument?.defaultView`, `:449`), *not* a timer/paint-deadline fallback. In a normal browser it never fires.
- **No other flush exists.** There is no `cancelAnimationFrame`, no `setTimeout`, no `flushSync`, no microtask drain for this work anywhere in the bundle. (`cancelAnimationFrame` appears only in the two unrelated AppFrame drag/resize paths at `:140` and `:187`.)
- `refreshThemeColor` is idempotent per token signature (`:473-476`: skip when `signature === this.refreshedTokenSignature`), and `pendingTokenSignature` is only set on the non-skipped path, so repeated publishes of an unchanged snapshot produce **no** scheduled work at all.

## 3. Fresh page load — how many `apply()` calls, how many theme publishes?

### Theme service: exactly one publish at startup (in this deployment)

`ThemeRuntime` (ui-theme/lib/client.js:1111):
```
ui-theme/lib/client.js:1130    this.preference = DEFAULT_PREFERENCE;      // "system"
ui-theme/lib/client.js:1132    this.snapshot = this.buildSnapshot();      // builds, does NOT publish
ui-theme/lib/client.js:1149    this.adopt();                              // ← may publish
ui-theme/lib/client.js:1182    adopt() { const section = this.host.getSnapshot().value;
ui-theme/lib/client.js:1184              if (section === void 0 || this.preference === section.preference) return;   // no publish when equal
ui-theme/lib/client.js:1185              this.preference = section.preference;
ui-theme/lib/client.js:1186              this.publish(); }
ui-theme/lib/client.js:1264    publish() { this.revision += 1; this.snapshot = this.buildSnapshot();
ui-theme/lib/client.js:1267                this.ctx.emit("theme/change", this.snapshot); }
```
Durable preference is `ui-theme.preference: light` (`/home/CNS2026495165/.dsh/settings.yaml:218-219`), i.e. **different** from the default `system` — so `adopt()` publishes **once**, revision 1, during the theme plugin's own apply phase (`ui-theme/lib/client.js:1316-1319`, `ctx.provide("theme", theme)` at `:1319`).

`buildSnapshot()` (`:1237-1248`) resolves `system` upstream to a concrete id and freezes `{preference, active, themes, revision}`; `active` is the theme definition object itself when no override layer exists (`composeActive`, `:1256`).

### Boot order (from the served HTML boot manifest, precedent: `/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/live-repro/raw/index.html`, `globalThis["__DSH_BOOT__"]`)

```
 10  @deepseek-ai/dsh-client-ui-theme          immediately=true
 12  @deepseek-ai/dsh-client-ui-layout         immediately=false
 45  @local/dsh-wallpaper                      immediately=true
```

### Sequence on a fresh load

1. **ui-theme apply** (`ui-theme/lib/client.js:1316`): `ThemeRuntime` ctor → `adopt()` → `publish()` → synchronous `theme/change` emit at `ui-theme/lib/client.js:1267`. **At this moment ui-layout is not mounted, so nobody is listening — this publish is lost to the presenter.**
2. **ui-layout apply** (`ui-layout/lib/client.js:516`): `ctx.effect` #1 registers the `root` slot entry (`:520-545`); `ctx.effect` #2 creates the presenter and calls **apply #1** (`:553`) with `ctx.theme.getTheme()` = revision 1 (un-shaded tokens).
   - First apply: `lastSignature` is `undefined` → no skip → writes `color-scheme`, `data-ds-dark-theme`, `~N` token custom properties on `document.body` (`:428-436`), appends the `theme-color` meta (`:437`), then `:448-449` sets `pendingTokenSignature` and **schedules rAF #1**.
3. **dsh-wallpaper apply** (`@local/dsh-wallpaper/lib/client.js:562`): `sync()` at `:581` → `applyCurrent` (`:573`) → `applyWallpaper` (`:238`) → `shadeTokens` (`:190`) → `ctx.theme.overrideTokens(OVERRIDE_SOURCE, next)` at `:207` → `publish()` (`ui-theme/lib/client.js:1224-1230` → `:1264`) → **synchronous `theme/change`, revision 2**.
   - Wallpaper is registered solely by this plugin — `overrideTokens` has no other caller in any deployed bundle (grep over `profiles/node_modules/**/client.js`).
   - This is the **only** publish after ui-layout mounted in this deployment.
4. **ui-layout apply #2** via `:555`, with the shaded snapshot: tokens changed (`--dsw-alias-bg-base` → `rgba(...,0.88)`, opacity 0.88 from `settings.yaml:199-204`) → signature differs → not skipped → writes again → `pendingTokenSignature` updated → `scheduleThemeColorRefresh` at `:449` → **queue already exists, `themeColorFrame !== 0` → early return at `:372`** (so the already-scheduled rAF #1 now refreshes the *newer* signature).
5. **rAF #1 body** (`:373-378`) runs in the first rendering update after that point: `refreshThemeColor()` reads `getComputedStyle(document.body).backgroundColor` (`:475`) and sets `themeColorMeta.content`.

**Counts on a fresh load (this deployment): `ThemePresenter.apply()` is called exactly 2× — 1 initial (`:553`) + 1 event-driven (`:555`) — and 2 snapshots are published (revision 1 in the theme ctor's `adopt()`, revision 2 from the wallpaper's `overrideTokens`), of which one (revision 1) is published before ui-layout exists.** Only **one** rAF is scheduled for the whole startup, and it runs **once**.

Re-apply is then permanently inert for identical content: after apply #2, any further publish re-enters `:408`, builds the same signature, passes `landingIntact()` (`:460-467`) — the presenter's own tokens are still present — and returns at `:426` **without** touching `:449`. So unchanged snapshots schedule nothing.

## 4. rAF competition — does the deferred read necessarily share a frame with the click's React render?

**No — not "necessarily", and not in the settings-open path at all in this configuration.** Three separate facts:

### 4a. The premise itself fails here: the settings button does not produce an `apply()`

- `SettingsRoot`'s trigger (`ui-settings-general/lib/client.js:203-212`) is a plain React button whose `onClick` is `setOpen(true)` (`:208-210`) — no theme call, no publish.
- `SettingsPanel` mounts at `:213-219`; its only effects are a document `keydown` listener (`:99-107`) and `closeButton.current?.focus()` (`:109-111`). No theme write.
- The wallpaper row mounts inside the General section (`GeneralSection` renders `settings.general.item`, `ui-settings-general/lib/client.js:295-299`; wallpaper registers there at `@local/dsh-wallpaper/lib/client.js:591-602`) and its mount effect calls `notifySettingsOpen(true)` (`:400-403`) → `:518-522` → `pageState.settingsOpen = true` → `applyCurrent(ctx)` (`:521`).
- `applyCurrent` (`:348-350`) resolves the settings-page override; with only a **global** wallpaper configured (no `pages:` key in `settings.yaml:199-204`), the resolved config is byte-identical → `shadeTokens` (`:190`) returns early at **`:204`** because `sameShadedTokens` (`:181-185`) matches → **no `overrideTokens` → no publish → no `theme/change` → no `apply()` → no `scheduleThemeColorRefresh`**.
- Therefore, at settings-open time in this deployment the deferred theme-color refresh does not run at all. It also cannot run from the `theme-color` value itself: the value is a function of the body background, which does not change on settings open (the modal is a normal DOM subtree).

`apply()` (and thus a new rAF) *is* produced by a real theme change: the Appearance cubes (`ui-theme/lib/client.js:87-89` `setTheme(id)` → `:1174-1180` → `:1179 publish()`), or a wallpaper write that changes the shading (`@local/dsh-wallpaper/lib/client.js:495-511 commitField` → `:504 applyCurrent` → `:207 overrideTokens`).

### 4b. Frame mechanics, precisely

- The task that runs the click handler is queued by the browser on the user-interaction task source; React 18 processes `pointerup`/`click` as **discrete** events and flushes that update **synchronously inside the dispatched event**, so `setOpen(true)` → `SettingsPanel` mount → child mounts → `useEffect`s (including `focus()` at `:110` and `notifySettingsOpen(true)` at `:402`) all complete before the handler's task returns. (React's own scheduling is not in this bundle; this is the documented discrete-event behaviour and it is consistent with the observed node growth 596 → 767 in `live-repro/raw/recon.json`.)
- rAF callbacks run at the **start of the "update the rendering" steps**, i.e. after the current task queue has been drained for that event-loop turn and *before* style/layout/paint for the frame, because the same rendering opportunity is reached at the end of that iteration.
- A callback registered with `requestAnimationFrame` **during** frame N's rendering steps is not in frame N's callback list; it runs in the next rendering opportunity (frame N+1).
- `refreshThemeColor` deliberately **reads no layout** (`:475` is `getComputedStyle(document.body).backgroundColor` — style only, no `offsetHeight`/`getBoundingClientRect`), so it cannot flush layout; but it does force a **synchronous, document-wide style recalc** (the comment at `:351-352` states this intent).

Putting those together for a publish that originates *inside* the click handler's task (as the wallpaper path would if the shading actually changed):

1. click task: React commit writes the whole modal subtree → `theme/change` emitted synchronously → `apply()` writes body tokens → `scheduleThemeColorRefresh` registers a callback for the **next** frame (N+1).
2. frame N+1's rendering steps: rAF callbacks first → the deferred `getComputedStyle(document.body)` runs **after** the click's React commit, in the same frame, against a style system React has just dirtied with 171 new nodes. That is precisely the "same frame as the click's React render" collision.
3. If instead the publish happened in an *earlier* task (e.g. the settings-scope subscription round-trip on a slider commit), the rAF runs in the next rendering opportunity, which may well be the same frame the click lands in — in which case the read runs *before* the click handler's task (rAF precedes tasks of the next iteration only if the read already drained); the exact ordering then depends on whether the click task was queued before or after that rendering opportunity.

So: **the two can share a frame, and when they do, the deferred read is ordered after React's commit and pays for a recalc that includes the modal.** It is however strictly true that the deferred read **cannot** run before the click handler's task returns, and it can never run in the same frame in which it was scheduled. Whether it shares a frame with a *given* click is timing-dependent and not deterministic — it depends on how many event-loop iterations separate the publish from the click. There is **no** code that prioritises or coordinates the two: nothing in the bundle inspects `themeColorFrame` against React work, and no `scheduler.postTask`/`requestIdleCallback` is used.

### 4c. Is `themeColorFrame` one counter for all presenters? Yes — and that is a latent bug

```
ui-layout/lib/client.js:346-348
const themeColorRefreshQueue = /* @__PURE__ */ new Map();   // keyed by window object
let themeColorFrame = 0;                                    // ONE module-level handle
ui-layout/lib/client.js:366-378
let queued = themeColorRefreshQueue.get(winRef); … queued.add(presenter);
if (themeColorFrame !== 0) return;                          // ← guard is NOT per-window
themeColorFrame = request.call(winRef, () => { themeColorFrame = 0; const pending = queued; themeColorRefreshQueue.delete(winRef); for (const item of pending) item.refreshThemeColor(); });
```

- The queue is per-window (`Map` keyed by `winRef`), but the *handle* `themeColorFrame` and the *guard* are module-global. So the "one read per frame per window" intent is really "**one read per frame per document, with a single shared counter**".
- Consequence (not reachable in a one-window browser, but wrong by construction): if presenter A is scheduled on window W1 (handle set, frame pending) and presenter B is then scheduled on a *different* window W2, B is added to W2's queue but the `:372` guard returns early, so **no rAF is registered for W2 at all** and W2's `themeColorMeta.content` keeps the stale value. It is not even retried: the entry stays in `themeColorRefreshQueue` (only the rAF body deletes a window's entry, `:376`), and a later `apply()` on W2 re-adds the same presenter and reaches `:373` only if `themeColorFrame` has since returned to 0 — in which case the callback for W2's then-current queue runs and refreshes it. So the loss is bounded to the dropped window's pending update, not permanent — but the "one read per frame" contract silently becomes "one read per frame across all windows".
- The module-scope also means the handle does not span HMR re-evaluation: the module system throws on a duplicate factory registration (`dsh-client-modules/lib/client.js:200-204`) unless `invalidate()` was called first, and `invalidate()` drops the factory+record (`:302-306`) — a reload therefore resets `themeColorFrame` to 0 in the *new* copy while the *old* copy's pending callback still fires and calls `refreshThemeColor()` on the old presenter. Harmless but worth knowing.
- `themeColorFrame` is never cancelled anywhere (no `cancelAnimationFrame` for it — grep over the bundle returns only `:140` and `:187`).

## 5. Other work in ui-layout (and the slot tree) that runs in the click frame

Within **ui-layout itself**, nothing theme-related runs on settings open:
- The layout store (`createLayoutStore`, `ui-layout/lib/client.js:277-309`) is written only by drag/toggle actions (`:286-306`) and by `AppFrame`'s `setNarrow` effect (`:191-193`) and `closeDetails` on session switch (`:167-171`). Opening settings writes **no** store field → no `AppFrame` re-render.
- `AppFrame`'s `ResizeObserver` (`:172-189`) can fire if the modal changes the frame box; its callback defers the `getBoundingClientRect()` read into its own rAF (`:178-182`) — a **second, independent** rAF in this window, coalesced by its own `raf` ref, cancelled on unmount (`:187`). The modal is a fixed-position overlay sibling, so the frame box normally does not change; if it does (scrollbar appearance is the classic case — `html` scrollbar width), that is another forced layout read landing in a rendering opportunity near the click.

In the **settings/slot tree** (what actually mounts on the click):
- `SettingsPanel` mount: `ui-settings-general/lib/client.js:96-168`; effects at `:99-107` (document keydown) and `:109-111` (`closeButton.current?.focus()` — a synchronous focus, which itself can force a style recalc/layout).
- `renderSlot("settings.section", …, { only: active })` at `:164` → outlet machinery `SlotOutlet` (`ui-renderer/lib/client.js:741-750`, `uSES` subscription on `settings.section`) → list branch filters by `opts.only` (`:845`) → `GeneralSection` (`ui-settings-general/lib/client.js:295-299`) → `renderSlot("settings.general.item")` → the `ui-theme` `AppearanceRow` (`ui-theme/lib/client.js:74-93`, registered at `:1337-1344`) and the wallpaper `WallpaperRow` (`@local/dsh-wallpaper/lib/client.js:386-403`, registered at `:591-602`).
- Entry `inject` factories run **during render**, and are cached per entry (`ui-renderer/lib/client.js:334-341 runInject`, `:396-403 cachedRootInject`) — the wallpaper's `inject` (`:597-601`) calls `sync()` synchronously on first render, i.e. inside the click's render phase, which reads the settings scope and calls `applyCurrent`.
- `WallpaperRow`'s `React.useEffect` at `@local/dsh-wallpaper/lib/client.js:400-403` runs in the click's commit → `notifySettingsOpen(true)` (`:518-522`) → `applyCurrent` → possible `overrideTokens`/publish (see 4a: no-op in the current configuration).
- `SettingsDocumentAction`'s effect (`ui-settings-general/lib/client.js:326-328`) calls `controller.load()` — an async `settings.describe`/document read, so it contributes promise/microtask work, not synchronous frame work.
- `SettingsRoot`'s render-time `uSES` reads (`shellInjected`, `ui-settings-general/lib/client.js:494-535`) subscribe to `settings.section` and locale while the shell is mounted; the modal itself does not re-register slots.
- The `root` slot entry (ui-layout's `AppFrame`) is **not** re-registered and does not re-render: the settings modal lives inside `sidebar.settings` → `SettingsRoot` under the sidebar column (`ui-sidebar/lib/client.js:235-236` renders `sidebar.settings`), and the sidebar column re-renders only on layout-store/`ResizeObserver` changes.

Bottom line for the click frame: the heavy, *synchronous* work on settings open is **React mounting 171 new nodes plus a `focus()`**, and it is not accompanied by a theme publish in this configuration. The deferred theme-color read can only collide with it when a real theme/wallpaper write happens in the same interaction — and then the collision is exactly "forced document-wide style recalc immediately after React's commit, in the same rendering update".

---

## Condensed conclusions (path:line)

1. **`ThemePresenter.apply()` callers — exactly two, both in the plugin body's second `ctx.effect`:** initial synchronous call `ui-layout/lib/client.js:553`; cordis event subscription `ctx.on("theme/change", …)` `:554` → `:555`. Effect bodies run synchronously (`cordis/src/fiber.ts:366`) and `ctx.emit` is synchronous (`cordis/src/events.ts:194-196`). So: **synchronous on mount AND on a theme service event.**
2. **`scheduleThemeColorRefresh` caller: one** — the end of `apply()` at `ui-layout/lib/client.js:449`. **`refreshThemeColor` callers: two** — `:363` (inline, only when `typeof winRef.requestAnimationFrame !== "function"`, `:361-365`) and `:377` (the rAF body). No other flush, no cancel, no timer.
3. **Fresh load: `apply()` 2×, publishes 2×, rAF 1×.** Publishes: revision 1 from `ThemeRuntime.adopt()` inside the theme plugin's own apply (`ui-theme/lib/client.js:1149` → `:1186` → `:1264`/`:1267`) — **emitted before ui-layout mounts (boot order: ui-theme #10, ui-layout #12, wallpaper #45) so the presenter never sees it**; revision 2 from the wallpaper's `overrideTokens` (`@local/dsh-wallpaper/lib/client.js:207`) after ui-layout mounted, which triggers apply #2. The rAF is scheduled in apply #1 and **coalesces** both applies (`ui-layout/lib/client.js:372` guard returns for the second). Afterwards, identical snapshots are skipped by the content signature (`:418`, `:420`–`:427`) and schedule nothing.
4. **rAF competition — not "necessarily the same frame", and in this deployment not a settings-open effect at all.** The settings trigger is pure React state (`ui-settings-general/lib/client.js:208-210`); the settings page's wallpaper resolution is byte-identical, so `shadeTokens` bails at `@local/dsh-wallpaper/lib/client.js:204` and never publishes → no `apply()` → no rAF. When a real theme/wallpaper write *does* occur in the interaction: rAF callback is registered for the **next** rendering opportunity (`ui-layout/lib/client.js:373`), and that frame's rAF phase runs **after** the click task's React commit but **before** that frame's style/layout/paint — so the forced document-wide style recalc (`:475`) then includes the freshly committed modal. `themeColorFrame` is **a single module-level counter for all presenters/windows** (`:348`), guarded globally at `:372` while the queue is per-window (`:347`, `:366-369`) — cross-window schedules can be dropped; nothing prioritises, cancels, or coordinates this work.
5. **Other click-frame work:** ui-layout writes no layout-store field on settings open (`ui-layout/lib/client.js:277-309`; the only writers are `:167-171`, `:191-193`, `:212-217`), so no `AppFrame` re-render; the modal mounts inside `sidebar.settings` (`ui-settings-general/lib/client.js:536-565`, rendered by `ui-sidebar/lib/client.js:235-236`) as `SettingsPanel` (`ui-settings-general/lib/client.js:96-219`) → `renderSlot("settings.section", {only:"general"})` (`:164`) → `GeneralSection` (`:295-299`) → `settings.general.item` occupants (theme `AppearanceRow` `ui-theme/lib/client.js:1337-1344`; wallpaper `WallpaperRow` `@local/dsh-wallpaper/lib/client.js:591-602`), plus `closeButton.focus()` (`ui-settings-general/lib/client.js:109-111`) and the wallpaper mount-effect slot write `notifySettingsOpen(true)` (`@local/dsh-wallpaper/lib/client.js:400-403` → `:518-522`). A separate `AppFrame` `ResizeObserver` rAF (`ui-layout/lib/client.js:178-182`) may also fire if the frame box changes.

---

## Instrument self-proof: triggering a real theme change

Question set: can page-side JavaScript in the live GUI (`http://127.0.0.1:3080`, host PID 10806) cause a genuine new theme snapshot to be published, without a UI click and without product-file changes? Read-only analysis of the deployed bundles and the shell.

### 1. Globals exposed to the page

Exhaustive audit of every `globalThis`/`window`/`self` property reference in all 50+ deployed client bundles (`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/*/lib/client.js`) and in the shell assets (`dsh-web-frontend/dist/assets/index-ClqxG24t.js`, `vendor-D22_Mp1f.js`):

| global | written by | path:line | useful for this task? |
|---|---|---|---|
| `window.__ModuleLoader__` | inline facade in the served HTML | `incident2/live-repro/raw/index.html` (inline `<script>` in `<head>`); read at `dsh-client-modules/lib/client.js:181`, `dsh-web-frontend/dist/assets/index-ClqxG24t.js` (boot `run()`: `n.__ModuleLoader__`) | **No.** After boot it is a dead registrar (see below) |
| `window.__DSH_BOOT__` | inline bootstrap script in the served HTML | same inline script; parsed at `dsh-client-modules/lib/client.js:65-96` | **No.** Static manifest data (id/url/rev/inject/immediately) |
| `globalThis.__DSH_TRANSPORT__` | **never written in this deployment** (no assignment anywhere under `profiles/node_modules` or `dsh-web-frontend/dist`) | read once at `dsh-client-connection/lib/client.js:10410`; also read by the shell boot for `loadBundle` (`dist/assets/index-ClqxG24t.js`) | **No** in the live GUI (undefined → `WebApiClient`/native fetch) |
| `globalThis.__fxTiming` | `dsh-client-connection/lib/client.js:8799` — inside the **fixture** API client, only constructed when the page URL has a `?fixture` search param (`:10409` `new URLSearchParams(pageLocation.search).has("fixture")`) | `:8799` (assignment), `:10409` (guard) | **No** in the live GUI; and it drives history/timing/stream fixtures, not the theme |
| `globalThis.__schemastery_refs__` / `__schemastery_index__` / `__zod_globalConfig` / `__zod_globalRegistry` | schema-library internals | `dsh-client-ui-theme/lib/client.js:381`, `dsh-client-connection/lib/client.js:756`, etc. | No service access |

**Definitive answer to (1): there is NO global handle to the cordis root context, the plugin loader, or any service instance — no `__cordis__`, no `__dsh_ctx__`, no `ctx` global, no service registry on `window`/`globalThis`.** The shell keeps the root context private: its boot class stores it in a private field and only exposes the container element — `dsh-web-frontend/dist/assets/index-ClqxG24t.js` (`this.ctx = c; await this.runPluginBoot(c, u); await this.mountApp(c)`, then `mountApp(n)` → `n.inject(["uiRenderer"], …)`). No assignment of `ctx` to a global exists.

`window.__ModuleLoader__` is a closed door after boot:
- The inline facade (`raw/index.html`) defines `mode:"queue"`, `pendingQueue`, `load(registration){pendingQueue.push(registration)}`, and a `create(options)` that throws `"client-modules: window.__ModuleLoader__.create called after module-system boot"` when `mode !== "queue"`.
- The shell's boot calls `i.create({boot, staticModules, loadBundle})` (`dist/assets/index-ClqxG24t.js`), which splices the queue empty, sets `mode = "live"` and **replaces `load`** with the live registrar (`dsh-client-modules/lib/client.js:181-190`).
- That registrar rejects a second execution of a bundle: `dsh-client-modules/lib/client.js:200-204` `if (this.bootstrapIds.has(id) || this.factories.has(id)) throw new Error('… duplicate factory registration for "…" (bundle executed twice without invalidate?)')`. `invalidate()` (`:302-306`) is only reachable from HMR (`dsh-client-hmr/lib/client.js:56-65` `case "rebuilt"`).

### 2. Theme service name and event name — confirmed

- Service name: **`"theme"`**, provided by the theme plugin: `ui-theme/lib/client.js:1319` `ctx.provide("theme", theme)`.
- Event name: **`"theme/change"`**, emitted by `ThemeRuntime.publish()`: `ui-theme/lib/client.js:1264-1268` (`this.ctx.emit("theme/change", this.snapshot)`).
- Read method: **`getTheme()`** → `ui-theme/lib/client.js:1155-1157` (returns the frozen snapshot; `buildSnapshot()` `:1237-1248`).
- Consumer wiring (already established): `ui-layout/lib/client.js:553` (`ctx.theme.getTheme()`), `:554-556` (`ctx.on("theme/change", …)`).

**Can that event be published/dispatched from page side?** No. `ctx` is a cordis `Context` object held in the shell's private boot field and in each plugin's closure; the emitter is only reachable through it. `ctx.emit` is synchronous but there is no global that reaches a context, so no page-side `emit("theme/change", …)` is possible. The only other `theme/change` listeners in the tree are `ui-theme`'s own settings-row sync (`ui-theme/lib/client.js:1329`) and the wallpaper's `applyCurrent` (`@local/dsh-wallpaper/lib/client.js:588`) — both also reached only through `ctx`.

### 3. Page-visible state the theme service reads — none that a page script can mutate into a republish

Every `publish()` call site in `ui-theme/lib/client.js` (grep: `:1137`, `:1179`, `:1186`, `:1200`, `:1205`, `:1230`, `:1234` — the last six are `setTheme`/`register`/`overrideTokens`/their disposers; `publish` itself at `:1264`):

| trigger | path:line | page-reachable? |
|---|---|---|
| OS color-scheme flip | `:1131` `matchMedia("(prefers-color-scheme: dark)")`; listener installed in the ctor's effect `:1135-1144`; `onChange` returns early unless `preference === "system"`, then `:1137 publish()` | **Yes, but not from page JS** — sees the OS/browser scheme (see mechanism M1 below) |
| durable settings adoption | `:1146-1148` `ctx.effect(() => host.subscribe(() => this.adopt()))`; `adopt()` `:1182-1187` publishes when the scope's preference differs | Only via the settings pipeline (M2/M3) |
| `setTheme(id)` | `:1174-1180` (`:1179 publish()`), plus the host write `:1178 this.host.set(...)` | Needs `ctx.theme` |
| `register(definition)` / its disposer | `:1196-1207` | Needs `ctx.theme` |
| `overrideTokens(source, tokens)` / its disposer | `:1224-1235` | Needs `ctx.theme`; sole in-tree caller is the wallpaper (`@local/dsh-wallpaper/lib/client.js:207`) |

Persistence is the **host** settings document, not page-visible state: `ctx.settingsScope.bind({namespace: "ui-theme"})` (`ui-theme/lib/client.js:1318`), whose controller reads the shared describe mirror and writes through `api.settings.mutate` (`ui-settings/lib/client.js:1016-1054` — `write(op)` → `this.api.settings.mutate({ns, ops, expectedRevision})` → `mirror.acceptView`). The endpoint carries no sample/nightly flavour.

**There is no localStorage key, no cookie, no BroadcastChannel, no `storage` event listener, no resize listener, and no polling.** Evidence: a grep for `visibilitychange`, `document.hidden`, `matchMedia`, and a `storage` `addEventListener` across **all** deployed client bundles returns exactly **one** hit — `ui-theme/lib/client.js:1131` (the `prefers-color-scheme` media query). The describe mirror is read-driven only (`ui-settings/lib/client.js:1230 load()` is called from `ensure()` `:1246-1251` and from the two invalidation subscriptions `:1342-1347`: `ctx.get("remote").$on("settings/document-updated", …)` and `ctx.on("connection/reset", …)`).

### 4. Every page-reachable path to a NEW theme snapshot — enumerated

| # | mechanism | path:line | page-side reachable? |
|---|---|---|---|
| M1 | **OS/browser color-scheme change while preference is `system`** → `media` `change` → republish | `ui-theme/lib/client.js:1131`, `:1135-1144`, `:1137` | Not by page JS, but **yes by the driver**: CDP `Emulation.setEmulatedMedia({features:[{name:"prefers-color-scheme", value:"dark"}]})` changes the emulated OS scheme and fires the `change` event. **Blocked in this deployment for a different reason:** the durable preference is `light` (`~/.dsh/settings.yaml:218-219`), and `onChange` returns early unless `preference === "system"` (`:1136`) — so M1 republishes only after the preference is switched to `system` once |
| M2 | **Host writes `ui-theme.preference`** (edit `~/.dsh/settings.yaml` or any host-side settings write) → host fans out `settings/document-updated` (`dsh-settings/lib/index.js:522-526`, the only emitter) → client mirror reload (`ui-settings/lib/client.js:1342-1343`) → scope snapshot changes → `adopt()` (`ui-theme/lib/client.js:1146-1148`, `:1182-1187`) → **republish** | see left column | Not page-side (host process), but no UI click and no product patch — file edit only |
| M3 | **Connection reset** → `ctx.on("connection/reset", …)` → `mirror.load()` (`ui-settings/lib/client.js:1344-1345`) → `adopt()` → republish **iff** the preference in the document differs from the held one | same as M2 | Server/transport driven only |
| M4 | **HMR rebuild of the ui-layout bundle** → `EventSource("/plugins/events")` (`dsh-client-hmr/lib/client.js:15`, `:71-81`) receives `{type:"rebuilt", id}` → `reload(id)` (`:56-65`) → `env.modules.invalidate(moduleId)` (`cordis-client-runner/lib/client.js:551`) → fresh module factory → new `ThemePresenter` → `presenter.apply(ctx.theme.getTheme())` (`ui-layout/lib/client.js:553`) → **`apply()` on mount, hence a scheduled `refreshThemeColor`** | `dsh-client-hmr/lib/client.js:15`, `:56-65`, `:71-81`; `ui-layout/lib/client.js:516-561` | Not page-side (needs the dev server to push a rebuild), but reproducible **without any click** and without touching product *source*: the HMR source is the deployed bundle itself. Note the snapshot *content* is unchanged, so this is a mount-time `apply()`, not a new token snapshot |
| M5 | A **dynamic cordis plugin** loaded from the host (`ctx.dynamicCordisRunner`, view at `dsh-client-ui-cordis/lib/client.js:1273-1335`) | remote-driven (`ctx.remote.$on("cordis/dynamic-package"…)` `:1321-1330`) | Host/session driven; the page cannot inject one |
| M6 | Reaching `ctx.theme` / `ctx.settingsScope` / the connection `api` to call `setTheme`/`overrideTokens`/`settings.mutate` from the console | — | **Impossible**: no global exposes `ctx`, `settingsScope`, the `WebApiClient`, or the websocket transport (§1) |

**Direct answer to (4): there is NO page-side JavaScript path to publish a genuine new theme snapshot on the running page.** With no global handle to the cordis root or to any service, the page cannot call `getTheme`/`setTheme`/`overrideTokens`/`register`, cannot reach the settings scope or its wire API, and cannot re-trigger `apply()` except by making the ui-layout bundle itself re-execute (M4, server-driven). The only click-free *live* triggers are OS-level color-scheme changes (M1 — currently inert because the preference is `light`), host-side settings writes (M2), transport resets (M3), or an HMR rebuild (M4).

### Practical recommendation for instrument self-proof

The strongest **purely page-side** verification that the ui-layout theme instrument is live is the presenter's own DOM output, which is a direct function of the code path in question:

- `document.querySelector('meta[name="theme-color"]')` is created by the presenter (`ui-layout/lib/client.js:396-398`, appended `:437`) and is **only ever written by the deferred rAF callback** (`:475`), which runs only from `:377` (or the inline `:363` fallback). Its `content` therefore *is* the observable proof that `apply()` ran and that the scheduled frame actually executed.
- Its value is exactly `getComputedStyle(document.body).backgroundColor` (`:475`) — a **function of the theme state**, which the code itself names the colour authority ("the rendered palette remains the color authority", `:403-405`). Consequently it moves when the theme source changes (OS scheme, wallpaper opacity, theme preference) and does **not** move when the settings modal merely opens (the `ui-settings-general` mount does not publish — §4 of the main analysis). That is precisely the discriminator for the hypothesis under test.
- To obtain a click-free *live* perturbation for a before/after diff, the practical options are: (a) set the preference to `system` once (any means) and then drive CDP `Emulation.setEmulatedMedia` color-scheme (M1); (b) edit `ui-theme.preference` in `~/.dsh/settings.yaml` (M2); (c) trigger a client HMR rebuild of `@deepseek-ai/dsh-client-ui-layout` (M4). Options (a) and (b) change the snapshot *content*; (c) exercises the mount-time `apply()` path only.
