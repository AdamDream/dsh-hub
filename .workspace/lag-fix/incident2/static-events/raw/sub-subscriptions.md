# incident2 — subscription census: which subscriptions can fire DURING / IMMEDIATELY AT settings open

Audit target (shipped, read-only, no src/no sourcemap):
`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<pkg>/lib/client.js`

Extra shipped artifact resolved at runtime (not in the DSH package tree — resolved by the browser
module loader when a bundle does `require("@deepseek-ai/dsh-client-ui-slots")`):
`/home/CNS2026495165/dsh/dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js`
Evidence for that resolution: `dsh-client-ui-renderer/lib/client.js:14` (`require("@deepseek-ai/dsh-client-ui-slots")`)
and the on-disk package (`find / -name dsh-client-ui-slots` → `dsh-btw/node_modules/...`, version `0.1.1-rc.2`).

Local plugin dir: `/home/CNS2026495165/.dsh/profiles/node_modules/dsh-workspace-enhancement/lib/client.js`

**Corrections to the task's package list.**
* `dsh-client-ui-locale` **does not exist**; the package is `dsh-client-locale` (`dsh-client-locale/lib/client.js`).
* `dsh-client-ui-slots` **has no `lib/client.js`** — it is the pure core `lib/index.js` (`SlotCore`), no React, no bundle.
* `dsh-workspace-enhancement` is not a DSH package; it ships in the profile dir above (267 KB client bundle).

---

## 0. The decisive negative: `subscribe()` in this codebase never fires its listener at subscribe time

Established before the per-domain census, because it caps almost every domain at NO:

| evidence | text |
|---|---|
| `dsh-client-runtime/lib/client.js:4745-4757` | zustand vanilla `setState`/`subscribe`; `subscribe(listener)` only does `listeners.add(listener)` and returns a deleter |
| `dsh-client-runtime/lib/client.js:4787` | the **only** immediate-fire path in the whole tree: `if (options == null ? void 0 : options.fireImmediately) optListener(currentSlice, currentSlice)` — reachable only via `api.subscribe(selector, optListener, options)`; **the `fireImmediately` string appears exactly once repo-wide** (`grep -rn fireImmediately --include=client.js .` → this one line) |
| `dsh-client-runtime/lib/client.js:5401,5417` | `createSnapshotStore` uses `subscribe = (fn) => api.subscribe(fn)` — the **one-arg** form, so `optListener` is `undefined` and `fireImmediately` is unreachable through the store API |
| `dsh-client-runtime/lib/client.js:5655-5660` | `Notifier.subscribe` — add-to-Set + deleter only |
| `dsh-client-runtime/lib/client.js:5717` | `Notifier.flush` — all listener calls live here, i.e. only from a scheduled microtask/rAF or an explicit `notifyNow()` |
| `dsh-btw/.../dsh-client-ui-slots/lib/index.js:270-276` | `SlotCore.subscribe` — add-to-Set + deleter only |
| `dsh-client-ui-slots/lib/index.js:287-293` | `subscribeDeclaration` — add-to-Set + deleter only; the **synchronous** hit is `notifyDeclaration` (`:412-414`), called from `register`/`releaseEntry` (`:136`, `:380`), **not** from `subscribeDeclaration` |
| `dsh-client-locale/lib/client.js:1085-1090` | `LocaleRuntime.subscribe` — `this.listeners.add(fn); return () => this.listeners.delete(fn)`; **no immediate callback** |

So: **no domain in scope has a subscribe-then-callback immediate fire.** Every YES below is an
immediate fire that happens at a *constructor* / *inject* / *React-effect* seam, not inside `subscribe()`.

---

## 1. Census table

Legend — `Immediate-fire?`: does the *listener* run synchronously at subscribe time.
`Burst`: can one logical change produce many listener calls.

### sessions

| domain | file:line | who subscribes | immediate-fire | burst risk | React-facing |
|---|---|---|---|---|---|
| sessions | `dsh-client-runtime/lib/client.js:5655-5660` (`Notifier.subscribe`) | every uSES consumer of a Session / SessionManager | **NO** — add to `Set`, no call | **YES** — `markDirty` schedules one microtask flush (`:5662-5667`), `markFrameDirty` one rAF (`:5669-5674`), and `flush` (`:5709-5718`) skips entirely when `listeners.size === 0` (`:5711`). Every mux frame mutates: `recordMutation` (`:8252`), `handleMuxEnvelope` (`:8304`, `:8310`, `:8316`) | YES — `list`/per-session snapshots are uSES sources |
| sessions | `dsh-client-runtime/lib/client.js:8259-8261` | `SessionManager.subscribe` delegates to `Notifier` | NO | YES (same) | YES via `bindSnapshotSelector` (`dsh-client-ui-renderer/lib/client.js:154-159`) |
| sessions | `dsh-client-runtime/lib/client.js:8266-8269` | `getListSnapshot()` → `notifier.ensureFresh()` | n/a (read) | rebuild is **lazy**: `ensureFresh` rebuilds synchronously only when dirty (`:5689-5693`) | YES |
| sessions | `dsh-client-runtime/lib/client.js:8972-8974` | `SessionRuntime` ctor: `manager.subscribe(() => this.projectList())` | NO | **YES** — every manager flush rebuilds the whole projection `projectList()` (`:9272`) and `list.update/set`s, which re-fires the `list` store's subscribers. Mitigated by an explicit identity-carry patch (`/* dsh-perf-fix P2 v1 */ :8842-8890`, `:9324-9345`: `sameIdList`, per-entry `reusable` compare, whole-`byId` reuse) | indirectly (feeds `list`) |
| sessions | `dsh-client-runtime/lib/client.js:8975-8978` | `this.list.subscribe(() => { followCurrent(); provideChannel.publishCurrent(); })` | NO | **YES-by-frequency / NO-by-effect**: fires on *every* list state change, and zustand mints a new state object each `setState`, but the two bodies are idempotent — `followCurrent` early-returns on `current === this.watched` (`:9226`), `publishCurrent` early-returns on identity (`:8715`) | YES |
| sessions | `dsh-client-runtime/lib/client.js:8996-8997` | `conversation.events.subscribe(scheduleRegistryRebuild)`, `conversation.views.subscribe(...)`, wrapped in `rootCtx.effect` (`:8995-9002`) | NO | **YES** — but `scheduleRegistryRebuild` collapses to one microtask (`:8986-8994` `registryRebuildQueued` flag) | no |
| sessions | `dsh-client-runtime/lib/client.js:7445-7447`, `7452-7455` | Session conversation `subscribe` / `getSnapshot` | NO | YES (per-frame, same Notifier) | YES |
| sessions | `dsh-client-runtime/lib/client.js:5828-5842` | `projections.channel(key).face.subscribe` | NO | per-key notifier, one flush per change | YES (`useProjection`) |
| sessions | `dsh-client-ui-conversation/lib/client.js:364-369` | `queueReadFaceOf(session)` returns `subscribe: (fn) => session.subscribe(fn)` | NO (delegates) | yes — per queue mutation | YES |
| sessions | `dsh-client-ui-conversation/lib/client.js:990-992` | `InputShell` ctor: `deps.queue?.subscribe(() => this.publish())` | **NO** for the subscribe itself; the ctor then relies on `publish()` elsewhere — immediate fire here would require `fireImmediately`, which is unreachable | yes | YES (`shell.state` store) |
| sessions | `dsh-client-ui-sidebar/lib/client.js` (whole file, 321 lines) | **no subscription at all** — `grep -n subscribe` → zero hits. `SidebarRoot` (`:96`) holds only `useState`/`useEffect`/`useRef` + `renderSlot` | n/a | n/a | n/a |

### workspaces

| domain | file:line | who subscribes | immediate-fire | burst risk | React-facing |
|---|---|---|---|---|---|
| workspaces | `dsh-client-runtime/lib/client.js:9741-9742` | `WorkspaceManager.subscribe` → `Notifier` | NO | yes — `markDirty` at `:9595`, `:9620`, `:9770`, `:9789`, `:9808`; `notifyNow()` at `:9820`, `:9824` (synchronous flush, guarded `if (direct)`) | YES (`useWorkspaces`) |
| workspaces | `dsh-client-runtime/lib/client.js:9748-9749` | `WorkspaceManager.getSnapshot` | n/a | `ensureFresh()` rebuild, lazy | YES |
| workspaces | `dsh-client-runtime/lib/client.js:9496-9498` | `Workspace.subscribe` | NO | `markDirty` (`:9489`) / `notifyNow` (`:9473`) | YES |
| workspaces | `dsh-client-ui-workspace/lib/client.js:2381-2386` | `flowSource(hole)` = `{ getSnapshot: () => ctx.slots.entries(hole).length > 0, subscribe: (l) => ctx.slots.subscribe(hole, l) }`; two instances created at apply time (`:2385-2386`) | **NO** — `SlotCore.subscribe` does not fire | yes-but-batched — `SlotCore.flush` is microtask-batched (`dsh-client-ui-slots/lib/index.js:401-410`, `:415-420`) | YES (boolean, cheap) |
| workspaces | `dsh-client-ui-workspace/lib/client.js` | only **one** `subscribe` occurrence in 2464 lines (the one above); the whole browser/picker is `inject` + props | n/a | n/a | n/a |
| workspaces | `dsh-workspace-enhancement/lib/client.js:5438-5439` | `installSidebarRowBadges`: `workspacesFeed?.subscribe(onChange)`, `sessionsFeed?.subscribe(onChange)` | NO | **YES — see §3 H4** | no (DOM side-effects, not React) |

### slots (ledger)

| domain | file:line | who subscribes | immediate-fire | burst risk | React-facing |
|---|---|---|---|---|---|
| slots | `dsh-btw/.../dsh-client-ui-slots/lib/index.js:270-276` | `SlotCore.subscribe(key, fn)` | **NO** — `rec.listeners.add(fn)` | batched: `markDirty` → one `queueMicrotask(flush)` per burst (`:401-410`) | YES — `SlotOutlet` uSES (`dsh-client-ui-renderer/lib/client.js:743`) |
| slots | `dsh-client-ui-slots/lib/index.js:287-293` | `subscribeDeclaration(key, fn)` | **NO** | n/a | no |
| slots | `dsh-client-ui-slots/lib/index.js:412-414` | `notifyDeclaration` — the synchronous surface | n/a | **synchronous per declaration change**, callers `register` (`:136`) and `releaseEntry` (`:380`) | no |
| slots | `dsh-client-runtime/lib/client.js:55-110` (`slots.inject`) | every plugin registering into a slot; `unsubscribe = this._core.subscribeDeclaration(key, changed)` (`:102`) then `try { reconcile() }` (`:103-104`) | **YES — but at declaration/register time, not at subscribe time.** Doc at `:41-43`: "The callback runs synchronously when the declaration already exists; otherwise it runs inside the declaring `register()` call after the declaration is committed." This is a *boot/registration* event storm, not a gear-click one | burst = #slots injected per declaration commit | no (registers entries) |
| slots | `dsh-client-runtime/lib/client.js:36-38` | ctor: `this._core.onMutate((key) => ctx.emit("slots/changed", key))` | n/a (see `onMutate` `:310-315`: add-only) | **synchronous, unbatched, one emission per mutation** — explicitly documented at `dsh-client-ui-slots/lib/index.js:303-307` | no (event bus) |
| slots | `dsh-client-runtime/lib/client.js:239-241`, `:273` | `getVersion(key)` / host face `subscribe(key, fn)` | n/a | version bumps synchronously in `markDirty` (`:402`) so a uSES snapshot is never stale | YES |

### locale

| domain | file:line | who subscribes | immediate-fire | burst risk | React-facing |
|---|---|---|---|---|---|
| locale | `dsh-client-locale/lib/client.js:1085-1090` (`LocaleRuntime.subscribe`) | renderer `LocaleFace` (`:1231` `ctx.slots.installLocale(locale)`); outlet uSES in `dsh-client-ui-renderer/lib/client.js:465-475`, `:486`; `useSections` (`dsh-client-ui-settings-general/lib/client.js:513`); plugins-tab (`dsh-client-ui-settings-plugins/lib/client.js:1269`) | **NO** — the method body is `this.listeners.add(fn); return () => { this.listeners.delete(fn) }`. **Answer to the task's explicit question: `subscribe()` does NOT call the listener with the current snapshot.** | YES (structural): `publish()` (`:1169-1181`) loops `for (const fn of [...this.listeners])`; called once per `register()` | YES (`useLocaleRevision`, `revision` number) |
| locale | `dsh-client-locale/lib/client.js:1121-1130` | `register(ns, …)` ends with `this.publish(this.snapshot.active, false)` | **Answer to the task's explicit question: YES, `register()` bumps `revision`** (`:1173` `revision: this.snapshot.revision + 1`) **and notifies every listener** | **YES — burst = 31**. `grep -c "locale.register("` across all shipped `client.js` = **31 call sites**; each fires `publish`, each of which iterates every locale listener. The file's own doc (`:1163-1167`) claims registrations stay off the `locale/change` event to avoid a "registration-heavy boot storm" — true, but the **listener fan-out is not suppressed**, only the ctx event | YES — every mounted `SlotOutlet` subscribes to the locale revision |
| locale | `dsh-client-locale/lib/client.js:1131-1142` | the `register()` disposer calls `publish(active, false)` again when a namespace is removed | NO | same fan-out on teardown/HMR | YES |
| locale | `dsh-client-locale/lib/client.js:1057-1059` | `ctx.effect(() => host.subscribe(() => this.adopt(host)), …)` (settings-scope adoption) | NO | `adopt` early-returns on equal active (`:1118`) | yes via snapshot |
| locale | `dsh-client-locale/lib/client.js:1067-1077` | `getLocale()` / `getSnapshot()` return `this.snapshot` | n/a | **stable reference between publishes** — uSES-safe; each publish mints a fresh frozen object (`:1170-1174`) | YES (stale-safe) |
| locale | `dsh-client-ui-settings-general/lib/client.js:498`, `513` | `useSections` reads `ctx.locale.getSnapshot().revision` and subscribes to locale | NO | memo guarded (§2 P1) | YES |

### theme

| domain | file:line | who subscribes | immediate-fire | burst risk | React-facing |
|---|---|---|---|---|---|
| theme | `dsh-client-ui-theme/lib/client.js:1146-1148` | `ThemeRuntime` ctor `ctx.effect(() => host.subscribe(() => this.adopt()), …)` | NO | `adopt()` (`:1182-1187`) early-returns when `section === undefined \|\| this.preference === section.preference` | indirectly (feeds `theme/change`) |
| theme | `dsh-client-ui-theme/lib/client.js:1329` | `ctx.on("theme/change", sync)`; `sync` (`:1326-1328`) → `bound?.sync(preference, revision)` | n/a (event bus) | `sync` → `bound?.sync`. The **action is revision-guarded**: `dsh-client-ui-theme/lib/client.js:112-116` `actions: { sync: (d, preference, revision) => { if (revision <= d.revision) return; … } }` → immer returns the identical state → zustand `Object.is` bail (`dsh-client-runtime/lib/client.js:4747`) → **no notify** | YES (`AppearanceRow` `:74-75`) |
| theme | `dsh-client-ui-theme/lib/client.js:1264-1268` | `ThemeRuntime.publish()` — `revision += 1`, new snapshot, `ctx.emit("theme/change", snapshot)` | n/a | every `register`/`dispose`/`overrideTokens`/`setTheme` publishes | yes |
| theme | `dsh-client-ui-layout/lib/client.js:551-561` | `ctx.on("theme/change", (snapshot) => presenter.apply(snapshot))` — **the only "replay" path** | **not at subscribe time** (`ctx.on` is a bus registration; the presenter's own first apply is called explicitly at `:553`) | **bounded, not a per-render storm.** `ThemePresenter.apply` (`:408-450`) has a **content-signature skip**: `signature = scheme + "\0" + tokenSignature(entries)` and `if (signature === this.lastSignature && this.landingIntact(scheme, body)) return;` (`:418-427`), with the rationale comment at `:411-417` stating same-object is *not* a usable skip test because every publish mints a new snapshot. Residual cost per **non-skipped** apply: `landingIntact` (`:460-467`) reads back `lastTokens` from `body.style` — O(#tokens) `getPropertyValue` reads — then a full `removeProperty` + `setProperty` rewrite of every token (`:431-436`) | no (DOM) |
| theme | `dsh-client-ui-theme/lib/client.js:1133-1144` | `matchMedia("(prefers-color-scheme: dark)")` `change` listener | NO | gated to `this.preference === "system"` (`:1136`); OS-level, not click-level | yes |
| theme | `dsh-client-ui-theme/lib/client.js:148-160` | `installThemeStyles` — 5 `<style>` tags appended to `document.head` via `ctx.effect` | n/a — **boot only** (called from `apply` `:1317`) | 5 style insertions once; **not** re-run on settings open | no |

**Theme verdict on the prior audit's "replay/re-apply-all-css-vars on unrelated state change": NOT reproducible.**
The presenter subscribes to exactly one channel (`theme/change`), no other code path calls `apply`,
and the signature+`landingIntact` guard makes an unchanged-snapshot replay a no-op. A re-apply happens
only when `theme/change` fires, which requires `preference !== section.preference` in `adopt()`, or an
explicit `setTheme`/`register`/`overrideTokens`.

### settings

| domain | file:line | who subscribes | immediate-fire | burst risk | React-facing |
|---|---|---|---|---|---|
| settings | `dsh-client-ui-settings/lib/client.js:991-994` (`SettingsScopeController` ctor) | `mirror.subscribe(() => this.derive())` when `persistence === "host"`, then `this.derive()` | **subscribe: NO.** The ctor then calls `derive()` on the next line — so the *listener body* runs once synchronously at construction time | yes — one `derive` per mirror notification | feeds `useX` hooks |
| settings | `dsh-client-ui-settings/lib/client.js:1087-1110` (`derive`) | — | — | **YES (re-render amplifier)**: `derive()` ends in `this.store.update((draft) => { draft.revision = …; draft.base = …; draft.user = …; draft.writable = …; … })` (`:1101-1109`) — **unconditional**, no equality/identity guard against the previous values. Each `update` = `api.setState(produce(...), true)` → new state object → `Object.is` differs → **every store listener fires**, not only on a real change. Reachable from: watch/reconnect (`:1342-1346`) and `write()` (`:1057`) | YES |
| settings | `dsh-client-ui-settings/lib/client.js:1006-1008` | `SettingsScopeController.subscribe` | NO (delegates to store) | as above | YES |
| settings | `dsh-client-ui-settings/lib/client.js:1222-1224` (`SettingsDescribeMirror.subscribe`) | consumers: every scope ctor, `SettingsDocumentStore` (`dsh-client-ui-settings-general/lib/client.js:378`), permission controller (`dsh-client-ui-permission-presets/lib/client.js:262`), plugins controller (`dsh-client-ui-settings-plugins/lib/client.js:941`), agent-preset (`:646` via `ensure`) | NO | `store.set` at `:1265-1271` (`acceptView`), `:1285-1288`, `:1299-1303`, `:1306-1310`; burst bounded by `load()` coalescing (`:1230-1239` — in-flight folds + one `rerun`) and `ensure()`'s idle gate (`:1246-1251`) | YES |
| settings | `dsh-client-ui-settings/lib/client.js:1163-1173` (`SettingsScopeBinder.bind`) | `ctx.effect(() => { this.mirror.ensure(); return async () => { await controller.dispose() }; })` | — | `ensure()` is idle-gated (`:1249`), so **not** a per-bind RPC | YES |
| settings | `dsh-client-ui-settings/lib/client.js:1341-1351` | `remote.$on("settings/document-updated", () => mirror.load())`, `ctx.on("connection/reset", …)`, then `mirror.ensure()` | n/a (bus) | `load()` folds into the in-flight read (`:1232-1235`) | YES |
| settings | `dsh-client-ui-settings-general/lib/client.js:511-518` | `useSections.subscribe` = `ctx.slots.subscribe("settings.section", listener)` **+** `ctx.locale.subscribe(listener)` — a **fan-in of two sources, one disposer** | **NO** — neither source fires on subscribe; the disposer correctly releases both (`:514-517`) | a settings.section registration or a locale publish both notify (expected) | YES |
| settings | `dsh-client-ui-settings-general/lib/client.js:533` | `useOnboardingSteps.subscribe` | NO | — | YES |
| settings | `dsh-client-ui-settings-general/lib/client.js:496-509` | the section-list `getSnapshot` (task's explicit target) | n/a | **memoized behind the version guard — see §2 P1** | YES |
| settings | `dsh-client-ui-settings-general/lib/client.js:326-327` | `SettingsDocumentAction` effect → `controller.load()` | **YES at mount** — `load()` (`:377-387`) begins `this.following ??= describeFace.subscribe(...)` then **unconditionally** `store.update(status = "loading")` which fires every listener synchronously during the effect | one per panel mount (see §3 H3) | YES (`useSnapshot((s) => s)`) |
| settings | `dsh-client-ui-settings-general/lib/client.js:413-416` | `SettingsDocumentStore.dispose()` | n/a | disposer **is** called — `ctx.effect(() => () => documentController?.dispose(), …)` at `:486-488` | no |
| settings | `dsh-client-ui-settings-plugins/lib/client.js:1022-1025` | `CardForm`-style ctor: `scope.subscribe(() => this.readCredential()); this.readCredential();` | subscribe NO; the ctor **calls `readCredential()` synchronously right after** | 1 RPC per construction (see §3 H3) | YES |
| settings | `dsh-client-ui-settings-plugins/lib/client.js:941-945` | `ConfigurablePluginsTabController` ctor: `describeFace.subscribe(() => this.publish()); describeFace.ensure(); this.publish();` | **YES** — `publish()` runs synchronously in the ctor. Constructed at apply time (`:1241`), i.e. **not** from the gear | — | yes |
| settings | `dsh-client-ui-settings-plugins/lib/client.js:1245-1247` | `ctx.effect(() => ctx.slots.subscribe("settings.plugin.item", () => configurable.refresh()), …)` | NO | one `refresh()` per ledger flush | yes |
| settings | `dsh-client-ui-settings-plugins/lib/client.js:1251-1275` | plugins `tabs` getSnapshot/subscribe (same memo pattern as sections) | NO | version+revision guarded | YES |
| settings | `dsh-client-ui-settings-models/lib/client.js:2405-2411` | welcome-notice controller `load()`: `this.following ??= this.scope.subscribe(() => this.derive()); this.derive();` — the `??=` makes the **subscription** idempotent, but `derive()` runs on **every** `load()` call | **YES at each `load()` call**, and `load()` itself is unguarded | `derive()` (`:2447-2484`) ends in unconditional `store.update` in every branch | YES |
| settings | `dsh-client-ui-settings-models/lib/client.js:2705-2715` | `if (controller.store.getSnapshot().status === "idle") return;` then `controller.load()` | — | **guarded effect** (the idle check) | — |
| settings | `dsh-client-ui-settings-models/lib/client.js:2209-2211`, `2297-2299` | onboarding: `if (state.status === "idle") controller.load()` | — | **guarded** | — |
| settings | `dsh-client-ui-settings-models/lib/client.js:1417-1427` | `ModelRow`: `useEffect(() => { api.credentials.describe({ refs: [keyRef] }).then(...) }, [api.credentials, keyRef])` | — | **UNGARDED — a fresh `credentials.describe` RPC per mount.** Models section only (not the default General tab) | yes (`setKeyState`) |
| settings | `dsh-client-ui-permission-presets/lib/client.js:68-70` | `PermissionRow`: `useEffect(() => { load(); }, [load])` | **YES at mount** — `load()` (`:260-271`) does `store.update(status = "loading")` then `await ensure()` then `derive()`; the two `store.update`s fire listeners synchronously inside the effect | **General section mounts this row on every panel open** (§3 H3) | YES (`usePermission((s) => s)`) |
| settings | `dsh-client-ui-permission-presets/lib/client.js:262-264` | the `??=`-guarded mirror subscription | NO | idempotent | YES |
| settings | `dsh-client-ui-agent-preset/lib/client.js:1156-1158` | `AgentPresetSection`: `useEffect(() => { load(); }, [load])` | immediate `load()` at mount; `load` is the section controller's (`:1673`) | agent-presets section tab, not General | YES |

### React-facing uSES inventory (all 12 call sites)

| file:line | subscribe argument | reference stable? | getSnapshot returns a fresh object? |
|---|---|---|---|
| `dsh-client-ui-renderer/lib/client.js:743` | `(fn) => host.subscribe(slotKey, fn)` — **inline arrow, new per render** | **NO** | n/a (`getVersion` number) |
| `dsh-client-ui-renderer/lib/client.js:852` | `(fn) => host.subscribe("root", fn)` — **inline arrow** | **NO** | n/a |
| `dsh-client-ui-renderer/lib/client.js:486` | `subscription?.subscribe` (WeakMap-cached, `:464-475`) | YES | n/a (revision) |
| `dsh-client-ui-renderer/lib/client.js:158` | `subscribe` captured once per source (`:155`) | YES | n/a (`bindSnapshotSelector` adds a selector+equality) |
| `dsh-client-ui-commands/lib/client.js:919` | `(fn) => popup.state.subscribe(fn)` — **inline arrow** | **NO** | `popup.state.getSnapshot()` — store accessor |
| `dsh-client-ui-model-selection/lib/client.js:292` | `(fn) => directory.subscribe(fn)` — **inline arrow** | **NO** | `directory.getSnapshot()` |
| `dsh-client-ui-input-trigger/lib/client.js:761` | `(fn) => menu.subscribe(fn)` — **inline arrow** | **NO** | `menu.getSnapshot()` |
| `dsh-client-ui-conversation/lib/client.js:7322` | `views.subscribe` (`:9937` object literal, stable) | YES | `views.version` number |
| `dsh-client-ui-conversation/lib/client.js:7399` | `views.subscribe` | YES | number |

No `useSyncExternalStore` call site exists in any settings package — settings rows go through
`bindSnapshotSelector` (`subscribe`/`getSnapshot` captured once per source, **line 155-156**) via
`observableHook`'s WeakMap cache (`dsh-client-ui-renderer/lib/client.js:197-205`). This is the reason
the settings panel does **not** suffer the per-render resubscribe churn that the outlet/`SlotOutlet`
path does.

---

## 2. The five high-yield patterns, one by one

### P1 — `getSnapshot` returning a new object per call (task's explicit `dsh-client-ui-settings-general/lib/client.js:496-509`)

**Result: MEMOIZED — not a defect.**

```
496  getSnapshot: () => {
497      const version = ctx.slots.getVersion("settings.section");
498      const revision = ctx.locale.getSnapshot().revision;
499      if (version !== rowsVersion || revision !== rowsRevision) {
500          rowsVersion = version;
501          rowsRevision = revision;
502          rows = ctx.slots.entries("settings.section").map(…).sort(…);
503-507
508      }
509      return rows;
510  }
```
`rowsVersion`/`rowsRevision`/`rows` are `let` bindings in the `apply` closure (`:489-491`), so the array
is rebuilt **only** on a version or revision change and the same reference is returned otherwise.
`useSessions`-style consumers pass `(s) => s` (`:188-189`), so uSES compares by `Object.is` and bails.
The `onboardingSteps` twin (`:521-531`) is guarded identically, as is plugins' `tabs`
(`dsh-client-ui-settings-plugins/lib/client.js:1252-1265`).

Note: `ctx.slots.entries()` itself is **not** a copy — `SlotCore.entries` returns the live array
(`dsh-client-ui-slots/lib/index.js:164-166`); the version guard is what makes caching sound, because
`markDirty` bumps the version synchronously (`:401-402`).

**Other `getSnapshot` sources checked repo-wide** (`grep -rn "getSnapshot: \|getSnapshot()"`): every one
returns a memoized value or a store accessor except the `??=`-cached ones (`dsh-client-ui-cordis/lib/client.js:408`
`cache ??= new Map(pointers)`, `:1099` module-level `snapshot`; `dsh-cordis-client-runner/lib/client.js:445`,
`:699`). **No un-memoized object-returning `getSnapshot` was found anywhere in the shipped client tree.**

### P2 — subscribe inside render (not in an effect)

**No subscription is created inside a React *render body* in any settings package.** Mechanical
classification of every `subscribe(` occurrence in all shipped `client.js`:

* Inside `react.useEffect`/`useLayoutEffect`: `dsh-client-locale/lib/client.js:1057`,
  `dsh-client-ui-permission-presets/lib/client.js:69`, `dsh-client-ui-agent-preset/lib/client.js:195/294/395/1157`,
  `dsh-client-ui-settings-models/lib/client.js:2210/2298`, `dsh-client-ui-settings-general/lib/client.js:327`
  (all via `.load()` callbacks), `dsh-client-ui-cordis/lib/client.js:1317`, and the context-effect wrappers.
* Inside a **constructor** (class field / ctor body, i.e. plugin apply or controller construction):
  `dsh-client-runtime/lib/client.js:8972/8975/8996/8997/9930/9933/10001`,
  `dsh-client-ui-conversation/lib/client.js:990/2450`, `dsh-client-ui-theme/lib/client.js:1146`,
  `dsh-client-ui-settings-plugins/lib/client.js:650/941/1022`, `dsh-client-ui-permission-presets/lib/client.js:262`,
  `dsh-client-ui-settings-general/lib/client.js:378`, `dsh-client-ui-settings/lib/client.js:991`,
  `dsh-client-ui-settings-models/lib/client.js:2406`, `dsh-client-ui-agent-preset/lib/client.js:1630`
  (inside `scope.effect`), `dsh-client-ui-model-selection/lib/client.js:203` (inside `actx.effect`).
* **Inside a render body — the *subscribe factory* is created during render, which is the same hazard
  through React's subscription API**: `dsh-client-ui-renderer/lib/client.js:743` and `:852`
  (`(fn) => host.subscribe(slotKey, fn)` written inline in `SlotOutlet`/`RootOutlet`),
  `dsh-client-ui-commands/lib/client.js:919`, `dsh-client-ui-model-selection/lib/client.js:292`,
  `dsh-client-ui-input-trigger/lib/client.js:761`. uSES resubscribes whenever the `subscribe`
  reference changes, so these **unsubscribe+resubscribe on every render of the host component**;
  each `subscribe()` here also triggers uSES's post-subscribe snapshot check, which calls
  `Notifier.ensureFresh()` / the version read. Bounded work, but strictly wasted per render.
  The renderer's own doc (`:460-463`, `:476-483`) states the rule these five sites violate:
  "uSES resubscribes whenever the subscribe reference changes — fresh closures per render would
  churn one unsubscribe/resubscribe pair per outlet per render."

### P3 — `subscribe()` whose disposer is never called

| site | verdict |
|---|---|
| `dsh-client-ui-settings-general/lib/client.js:378` `SettingsDocumentStore.load()` `this.following ??= describeFace.subscribe(…)` | **disposed** — `dispose()` at `:413-416` is wired by `ctx.effect(() => () => documentController?.dispose(), …)` at `:486-488` |
| `dsh-client-ui-permission-presets/lib/client.js:262` same `??=` pattern | **disposed** — `controller.dispose()` under `ctx.effect` at `:438-440` |
| `dsh-client-ui-settings-plugins/lib/client.js:650` `CardForm` ctor `scope.subscribe(() => this.publish())` | **NO explicit disposer found** (no `dispose`/`unsubscribe` on `CardForm` in the file). The scope store is plugin-lifetime and the form is plugin-lifetime, so it is **not a panel-mount leak** — but the returned deleter is discarded. Marked **leak-by-construction, not a per-open leak** |
| `dsh-client-ui-settings-plugins/lib/client.js:1022` `scope.subscribe(() => this.readCredential())` | same as above |
| `dsh-client-ui-settings-plugins/lib/client.js:941` `describeFace.subscribe(…)` stored in `this.unsubscribe` | **disposed** (`dispose()` at `:953-956`, wired at `:1242-1244`) |
| `dsh-client-ui-settings-models/lib/client.js:2406` | `dispose()` at `:2445` sets `this.following = void 0`; the caller relation is plugin-lifetime |
| `dsh-client-ui-conversation/lib/client.js:990` `deps.queue?.subscribe(…)` | return value discarded (ctor); plugin-lifetime |
| `dsh-workspace-enhancement/lib/client.js:4448-4449` | disposed in the returned teardown (`:4478-4479`), itself under `ctx.effect` |
| **settings panel mount/unmount path** | **nothing subscribes in the panel that lacks a disposer.** `SettingsPanel` itself (`dsh-client-ui-settings-general/lib/client.js:96-169`) creates only two `document` listeners (keydown `:103`, focus `:110`) both cleaned up |

### P4 — `setState` during render, or during a subscription callback that runs synchronously at subscribe time

**F1 — `setState` during render (legitimate React derived-state pattern, but it forces an extra render
pass on the very transition that opens/switches the panel):**
`dsh-client-ui-renderer/lib/client.js:674-696` — `SessionMaybeEntry` reads `info.sessionId` in the render
body and calls `setState({ adopted, epoch })` inline three times (`:678`, `:685`, `:692`). This component
wraps `settings` in nothing (settings is `root` scope, `dsh-client-ui-settings-general/lib/client.js:555-562`
`scope: "root"`), but it wraps the conversation; so it fires on session transitions, not on the gear.

**F2 — `setState` in an effect that runs unconditionally on the open transition:**
`dsh-client-ui-settings-general/lib/client.js:192-195`
```js
192 useEffect(() => {
193     if (onboardingActive) return;
194     setCompletedOnboarding(new Set());   // new Set identity every run
195 }, [onboardingActive]);
```
Innocent when `onboardingActive` is already `false`'s steady value… but the effect returns early only
for `true`; for `false` it **always** mints a fresh `Set`, and React's bail-out cannot help because the
identity differs. This is a guaranteed extra render whenever the dependency flips, and the dependency is
`useSessions(...)`-derived (`:190`) — i.e. it is **driven by the sessions stream**, not by the panel.

**F3 — the real `Cannot update during render` / forced-sync-render hazards are the effect-time store
writes in the mount path** (immediate fire *inside* the commit, which is exactly "a subscription
callback that runs synchronously at subscribe time" in the sense that matters): see §3 H3.

**F4 — `Notifier.getSnapshot` can rebuild synchronously inside React's subscribe** because
`ensureFresh()` (`dsh-client-runtime/lib/client.js:5689-5693`) rebuilds when dirty. On the open
transition the panel's new uSES subscriptions call `getSnapshot` for the first time, so a dirty
`SessionManager`/`list` rebuild lands inside that commit. This is one rebuild that would have happened
at the next flush anyway; it is not duplicated work, but it does move it into the click.

### P5 — effects that subscribe + immediately `load()`/`ensure()` — guarded vs unguarded

| site | guarded? | evidence |
|---|---|---|
| `dsh-client-ui-settings-general/lib/client.js:326-328` → `SettingsDocumentStore.load()` `:377-387` | **UNGURADED** — `store.update(status="loading")` before `ensure()`; no `if (already loaded) return` | panel-header action, mounts with every panel open |
| `dsh-client-ui-permission-presets/lib/client.js:68-70` → `PermissionPresetSettingsController.load()` `:260-271` | **UNGURADED** | **General section item — mounts on every panel open** |
| `dsh-client-ui-agent-preset/lib/client.js:1156-1158` → section `load` | **UNGURADED** (`this.following ??=` guards the *subscription*, `derive()`/`store.update` still run) | agent-presets tab |
| `dsh-client-ui-settings-models/lib/client.js:2705-2715` | **GUARDED** — `if (status === "idle") return;` | |
| `dsh-client-ui-settings-models/lib/client.js:2209-2211`, `:2297-2299` | **GUARDED** — `if (state.status === "idle")` | |
| `dsh-client-ui-settings-models/lib/client.js:1417-1427` `credentials.describe` | **UNGURADED RPC per mount** | Models tab / model row |
| `dsh-client-ui-settings-plugins/lib/client.js:1022-1025` `readCredential()` in ctor | **UNGURADED RPC**, once per form construction | Plugins tab |
| `dsh-client-ui-settings/lib/client.js:1230-1251` `mirror.load()/ensure()` | **GUARDED** — in-flight fold + one rerun; `ensure()` acts only from `idle` | |
| `dsh-client-ui-settings/lib/client.js:1167-1172` `bind()` → `mirror.ensure()` | **GUARDED** (idle gate) | boot-time |
| `dsh-client-ui-settings-general/lib/client.js:385` `await this.describeFace.ensure()` | **GUARDED** | network only on first call |

---

## 3. Ranked "immediate-fire suspects"

Ordered by "does it fire synchronously at the settings-open transition, and how loud".

### H1 — `SettingsScopeController.derive()` writes state unconditionally → every settings row re-renders on every mirror notification
**`dsh-client-ui-settings/lib/client.js:991-995` + `:1087-1110`**
```js
991  this.unsubscribe = mirror.subscribe(() => { this.derive(); });   // subscribe: no immediate fire
994  this.derive();                                                    // <-- runs the body NOW
...
1101 this.store.update((draft) => {                                     // <-- no equality guard vs previous state
1102     draft.revision = view.revision;
1103     draft.base = view.base;
1104     draft.user = view.user;
1105     draft.writable = writable;
1106     if (decoded === void 0) return;                                 // (only this early-return stays the draft)
1107     draft.status = "ready";
1108     draft.value = decoded;
1109 });
```
(The four field writes at `:1102-1105` sit **before** the `decoded === void 0` early-return, so the draft is
always touched and immer always mints a new state object.)
Proof of the React consequence: `createSnapshotStore.update` = `api.setState(produce(...), true)`
(`dsh-client-runtime/lib/client.js:5418-5422`); zustand `setState` notifies when `!Object.is(nextState, state)`
(`:4747-4751`); immer's `produce` returns the **same** reference only when the draft is untouched, and this
draft is always touched. Consumers hold the scope store as a uSES source (`observableHook(store)`,
`dsh-client-ui-renderer/lib/client.js:590`) with identity selectors like `(s) => s`
(`dsh-client-ui-permission-presets/lib/client.js:64`) or `(s) => s.preference`
(`dsh-client-ui-theme/lib/client.js:75`) — the identity selectors re-render on **every** notify.
**Not triggered by the gear itself** (open does not touch the mirror), but it is the amplifier that turns
any settings-invalidation burst into a whole-panel re-render storm. **This is the strongest "event-storm"
finding in the settings domain.**

### H2 — `slots.inject` runs its callback synchronously; plus `notifyDeclaration` is the one synchronous ledger surface
**`dsh-client-runtime/lib/client.js:102-108`**
```js
102 unsubscribe = this._core.subscribeDeclaration(key, changed);
103 try { reconcile(); } catch (error) { stop(); throw error; }
```
with the contract stated in the same file at `:41-43`: *"The callback runs synchronously when the
declaration already exists; otherwise it runs inside the declaring `register()` call after the
declaration is committed."* `reconcile` then installs `ctx.effect(callback, …)` (`:81`), which runs the
registrant's `ctx.slots.register(...)` immediately.

The synchronous cascade is proven on the ledger side by
`dsh-btw/.../dsh-client-ui-slots/lib/index.js:125-137`:
```js
126     for (const [childKey, childSpec] of Object.entries(options.children)) { … childRec.declarationEpoch += 1; … }
135     for (const [childKey, childRec] of declarations) this.markDirty(childKey, childRec);
136     for (const [, childRec] of declarations) this.notifyDeclaration(childRec);   // <-- synchronous
```
i.e. the single `ctx.slots.register({ name: "settings.section", children: { "settings.general.item": … } }, GeneralSection)`
at `dsh-client-ui-settings-general/lib/client.js:585-595` fires `notifyDeclaration("settings.general.item")`
**inside that very call**, which synchronously runs every `ctx.slots.inject("settings.general.item", …)`
callback — permission-presets (`:441`), locale (`:1250`), theme (`:1337`), conversation (`:9910`),
agent-preset (`:1699`). **This is the only genuine "subscribe-then-callback immediately" in the codebase
that runs *registration* work** — a boot/composition storm (one per slot declaration commit), **not a
gear-click storm** (the panel opens no new declarations: `register()` is not called from `SettingsPanel`).
Flagged because the task asked specifically for the pattern.

### H3 — panel-mount effects that write a store synchronously (the actual click-time immediate fire)
Two, both in the default General panel content path:

**(a) `dsh-client-ui-permission-presets/lib/client.js:68-70` → `:260-271`**
```js
68  useEffect(() => { load(); }, [load]);
...
260 async load() {
261     if (this.disposed) return;
262     this.following ??= this.describeFace.subscribe(() => { this.derive(); });
265     this.store.update((state) => { state.status = "loading"; state.error = null; });  // <-- fires listeners NOW
269     await this.describeFace.ensure();
270     this.derive();                                                                    // <-- fires again
271 }
```
`PermissionRow` is registered as a `settings.general.item` (`:441-447`, `order: -20`) and reads
`usePermission((snapshot) => snapshot)` (`:64`) — an **identity selector**, so both writes re-render it.
The General section is the default active section (`dsh-client-ui-settings-general/lib/client.js:188`
`rows` + `:164` `renderSlot("settings.section", …, { only: active })` with `active` falling back to
`rows[0]?.id`, `:97`). **Fires on every settings open.** The `ensure()` is idle-guarded, so the wire cost
is once; the *state-write* cost is per-open.

**(b) `dsh-client-ui-settings-general/lib/client.js:326-328` → `:377-387`** — identical shape
(`store.update(status="loading" …)` at `:381-384`), reached from `SettingsPanel`'s header via
`renderSlot("settings.action", {})` (`:151`). **Fires on every settings open**, for an action that then
renders `null` until ready (`:329`).

These are the only two *click-synchronous* `setState`-class events I can prove in the settings path. Both
are one re-render each, not an unbounded storm — but they are provably unconditional per open.

### H4 — non-React event storm that *does* react to the settings modal entering the DOM
**`dsh-workspace-enhancement/lib/client.js`** (local plugin, always mounted):
```js
4445 const observer = new MutationObserver((records) => {
4446     if (records.some((record) => !isOwnBadgeMutation(record.target))) scheduleScan();
4447 });
4448 const unsubscribe = subscribe(onChange);          // sessions.list + workspaces.list feeds (:5438-5439)
4449 const unsubscribeLocale = locale.subscribe(repaintAll);
4450 const rootTarget = document.body ?? document.documentElement;
4451 observer.observe(rootTarget, { childList: true, subtree: true });
4452 document.addEventListener("click", onClick, true);
```
`document.body` + `childList` + `subtree` means **every node the settings modal inserts is a mutation
record**. `scheduleScan` (`:4407-4415`) debounces `SCAN_DELAY_MS = 120` with `SCAN_MIN_GAP_MS = 300`
(`:4062-4063`), and `scan` (`:4381-...`) then runs `document.querySelectorAll('[role="tree"]')` plus
`withdrawStale()` over every marked row. So opening Settings costs one deferred full-document
tree scan **in addition to** the React commit. `locale.subscribe(repaintAll)` also re-paints every
injected badge on any locale publish (and `register()` publishes — see H5). Unbounded-RPC risk is avoided
by the guard, so this is a *moderate* suspect, but it is the only subscriber whose input is the modal's
own DOM.

### H5 — `LocaleRuntime.register()` publishes to every listener; 31 registration sites
**`dsh-client-locale/lib/client.js:1130` (`this.publish(this.snapshot.active, false)`) → `:1169-1181`**
```js
1173     revision: this.snapshot.revision + 1
1176     for (const fn of [...this.listeners]) try { fn(); } catch (error) { … }
```
`register()` is called **31 times** across the shipped bundles (`grep -c "locale.register("` summed over all
`*/lib/client.js`); each call notifies **every** locale listener, and every mounted `SlotOutlet`
subscribes to the revision (`dsh-client-ui-renderer/lib/client.js:486`). The publish is idempotent for
consumers that use selectors, but the fan-out itself is O(listeners) per registration, and
`ctx.locale.subscribe` is **also** fanned into `useSections` (`dsh-client-ui-settings-general/lib/client.js:513`)
and the plugins `tabs` face (`dsh-client-ui-settings-plugins/lib/client.js:1269`) — a locale publish
therefore invalidates the settings nav list as well. This is a **boot-time** storm (and a
language-switch storm), not a gear-time one; it is ranked here because it is the only place where a
`register()` call does what the task hypothesized ("bump a revision and notify all listeners") —
**confirmed YES.**

### H6 — per-render resubscription in the outlet layer (not settings, but the app-wide floor)
**`dsh-client-ui-renderer/lib/client.js:743`, `:852`** — inline `subscribe` factories in the render body,
plus `dsh-client-ui-commands/lib/client.js:919`, `dsh-client-ui-model-selection/lib/client.js:292`,
`dsh-client-ui-input-trigger/lib/client.js:761`. Every render of these components performs
unsubscribe→subscribe, and each subscribe re-reads the snapshot/version. Cost scales with
outlet count × render count, so it multiplies whatever re-render the settings transition causes.
The renderer's own `:460-463` comment identifies exactly this as a defect to avoid.

### H7 — `setCompletedOnboarding(new Set())` on every non-onboarding render branch
**`dsh-client-ui-settings-general/lib/client.js:192-195`** — see §2 F2. Fresh `Set` identity every time
the effect body runs; dependency is a sessions-derived boolean (`:190`).

---

## 4. Explicit NON-findings (so they are not re-audited)

* **"subscribe fires the listener synchronously at subscribe time"** — false for *every* subscription in
  scope: `Notifier`, `SlotCore.subscribe`, `subscribeDeclaration`, `LocaleRuntime.subscribe`,
  zustand `createSnapshotStore`, `SessionProvideChannel.currentProvideInfo.subscribe`
  (`dsh-client-runtime/lib/client.js:8670-8675`), `ProjectionStore.channel().subscribe` (`:5836`),
  `ui-workspace`'s `flowSource` (`dsh-client-ui-workspace/lib/client.js:2383`).
  `fireImmediately` is unreachable through any of these APIs (see §0).
* **theme "replay / re-apply-all-css-vars on an unrelated state change"** — not reproducible; the
  presenter has a single channel and a content-signature + `landingIntact` skip
  (`dsh-client-ui-layout/lib/client.js:408-450`).
* **`dsh-client-ui-settings-general/lib/client.js:496-509` non-memoized getSnapshot** — **memoized**
  behind the version/revision guard; the same pattern holds for onboarding and plugins tabs.
* **theme preference re-sync on open** — revision-guarded action (`dsh-client-ui-theme/lib/client.js:112-116`);
  the `update` path bails through immer identity + zustand `Object.is`.
* **session list bursts** — the manager's `notifyNow()` synchronous flushes only happen on
  `select`/`selectSubagent`/`clearSelection` (`dsh-client-runtime/lib/client.js:7871`, `:7886`, `:7891`)
  and `if (direct)` workspace paths; ordinary stream traffic is `markDirty` → one microtask / one rAF.
* **`SettingsPanel` itself** — creates only two cleaned-up `document` listeners
  (`dsh-client-ui-settings-general/lib/client.js:99-107`, `:109-111`); no subscription, no RPC.
* **`dsh-client-ui-sidebar`** — zero subscriptions in the whole 321-line bundle.

## 5. INCONCLUSIVE (cannot be proven from these artifacts)

* **Which of H1/H3 actually dominates the user-visible "点设置就卡".** Static reading proves *which*
  synchronous writes happen at open, not their millisecond cost. No trace/profile was available in this
  audit; the bundles carry no timing instrumentation and I did not run the GUI.
* **Whether `SettingsScopeController.derive()`'s unconditional `store.update` actually reaches a mounted
  General row during an open.** `derive()` needs a mirror notification; whether the mirror is notified
  *during* the open sequence (e.g. by the panel's `load()`/`ensure()` settling) depends on runtime wire
  timing that cannot be derived from source. The *capability* is proven; the *coincidence with the click*
  is INCONCLUSIVE.
* **`dsh-client-ui-settings-plugins` `CardForm` scope subscriptions (`:650`, `:1022`)** — no disposer is
  retained, but I could not prove the object is ever dropped and re-created, so whether this leaks per
  panel open is INCONCLUSIVE.
* **`dsh-workspace-enhancement` `isOwnBadgeMutation` / `markedRowStillQualifies` bodies** were not traced
  line-by-line, so the per-scan cost (H4) is INCONCLUSIVE; only the trigger path
  (mutation → 120 ms debounce → 300 ms min gap → `querySelectorAll('[role="tree"]')`) is proven.
* **The exact number of `SlotOutlet` instances mounted at any moment** (needed to size H6) is
  a runtime property, not derivable from the bundles.
