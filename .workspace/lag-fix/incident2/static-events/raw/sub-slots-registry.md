# Static audit: slot registry / settings-shell event semantics (read-only)

Auditor: subagent (static, read-only). No process was restarted or killed. No sandbox escalation used.

---

## 0. Scope corrections (READ FIRST — the task's stated paths are partly wrong)

Three premises in the assignment do not match the artifact on disk. I verified each by reading the
package manifests and the live bundle; everything below is cited against the **real** files.

| Assignment said | Reality | Evidence |
|---|---|---|
| `.../dsh-client-ui-slots/lib/client.js` | **Does not exist.** `dsh-client-ui-slots` ships a *host-side, cordis-free* pure core whose `main` is `lib/index.js`. There is no `lib/client.js` in that package. | `/home/CNS2026495165/dsh/dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-slots/package.json` (`"main": "lib/index.js"`, `"files": ["lib/index.js","lib/invariant.js","lib/types/**/*.d.ts"]`); `find` over the package shows only `lib/index.js`, `lib/invariant.js`, `lib/types/*.d.ts` |
| `.../dsh-client-ui-locale/lib/client.js` | **Wrong package name.** The locale client is `dsh-client-locale` (no `ui-`). `dsh-client-ui-locale` does not exist. | `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-locale/lib/client.js` (1269 lines) |
| `dsh-client-ui-slots` present under the npm-global GUI-serving tree | **Absent as a package directory.** The live `.npm-global` deployment does not ship `dsh-client-ui-slots` on disk; its code is bundled (minified) into the frontend dist and registered under the module id `"@deepseek-ai/dsh-client-ui-slots"`. | `find /home/CNS2026495165/.npm-global -type d -name dsh-client-ui-slots` → empty; `/home/CNS2026495165/.npm-global/.../dsh-web-frontend/dist/assets/index-ClqxG24t.js` contains the literal map entry `"@deepseek-ai/dsh-client-ui-slots":g6` |

**Which tree is live.** The GUI at 127.0.0.1:3080 runs `node /home/CNS2026495165/.npm-global/bin/dsh web`
(PID 10806), so `.npm-global` is the serving install. Its client plugin bundles are **byte-identical**
to the `dsh-btw` copies for the packages I audited (`diff -q` on `dsh-client-ui-settings-general/lib/client.js`
between the two trees → IDENTICAL; both 604 lines; `dsh-client-ui-settings/lib/client.js` both 1363 lines).

**Shorthand used below (each maps to an absolute path):**

- `CORE` = `/home/CNS2026495165/dsh/dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js` — readable `SlotCore` (425 lines)
- `BUNDLE` = `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-ClqxG24t.js` — the *live, minified* copy of the same code (single line, byte offsets)
- `RT` = `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js` — cordis `SlotsService` wrapper (10667 lines)
- `RENDERER` = `.../@deepseek-ai/dsh-client-ui-renderer/lib/client.js` (989 lines)
- `SG` = `.../@deepseek-ai/dsh-client-ui-settings-general/lib/client.js` (604 lines)
- `LOCALE` = `.../@deepseek-ai/dsh-client-locale/lib/client.js` (1269 lines)
- `SP` = `.../@deepseek-ai/dsh-client-ui-settings-plugins/lib/client.js`
- `SETTINGS` = `.../@deepseek-ai/dsh-client-ui-settings/lib/client.js` (1363 lines)

**Live-code equivalence check for `CORE`.** The bundled `BUNDLE` class `m6` reproduces `CORE` verbatim in
minified form; I verified the three load-bearing methods by extraction, not by inference:

- `BUNDLE`: `subscribe(n,i){const l=this.record(n);return l.listeners.add(i),()=>{l.listeners.delete(i)}}`
- `BUNDLE`: `getVersion(n){var i;return((i=this.records.get(n))==null?void 0:i.version)??0}`
- `BUNDLE`: `entries(n){var i;return((i=this.records.get(n))==null?void 0:i.entries)??ji}` (`ji` = `Object.freeze([])`, cf. `CORE:22`)

So the readable `CORE` line numbers I cite are faithful to what the browser executes.

---

## 1. `ctx.slots.subscribe(slotName, listener)` and `ctx.slots.getVersion(name)`

### (a) Verdict
`subscribe` is **(b) only on ledger version change — never immediately** — and additionally it is
**microtask-batched**, so N same-tick mutations of the key produce exactly **one** listener call.
`getVersion` is **O(1)**: one `Map.get` plus an optional-chain property read; it never iterates.
One side effect worth knowing: `subscribe` calls `record(key)`, which **allocates a record object** for a
key that was never declared, and records are never removed.

### (b) Evidence

`ctx.slots.subscribe` (the cordis `SlotsService` face the settings shell actually holds) delegates 1:1 to the core:

```
229:			* @returns unsubscribe.
231:			subscribe(key, fn) {
232:				return this._core.subscribe(key, fn);
233:			}
```
— `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js:231-233`

The core subscription adds to a `Set` and returns a disposer — **no synchronous invocation of `fn`**:

```
263:	/**
264:	* Subscribe to registration changes for a key (microtask-batched).
265:	* Subscribing ahead of declaration is allowed; the declaration notifies.
266:	* @param key - slot key.
267:	* @param fn - change callback.
268:	* @returns unsubscribe.
269:	*/
270:	subscribe(key, fn) {
271:		const rec = this.record(key);
272:		rec.listeners.add(fn);
273:		return () => {
274:			rec.listeners.delete(fn);
275:		};
276:	}
```
— `/home/CNS2026495165/dsh/dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js:263-276`

Notification is deferred to a microtask flush (this is why it is (b) *and* batched):

```
401:	markDirty(key, rec) {
402:		rec.version += 1;
403:		for (const fn of [...this.mutateListeners]) fn(key);
404:		this.dirty.add(rec);
405:		if (!this.flushScheduled) {
406:			this.flushScheduled = true;
407:			queueMicrotask(() => {
408:				this.flush();
409:			});
410:		}
411:	}
...
415:	flush() {
416:		this.flushScheduled = false;
417:		const dirty = [...this.dirty];
418:		this.dirty.clear();
419:		for (const rec of dirty) for (const fn of [...rec.listeners]) fn();
420:	}
```
— `/home/CNS2026495165/dsh/dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js:401-420`

Module-level contract docstring (author's own statement of the semantics):

```
30:	* Change propagation contract: versions bump and {@link SlotCore.onMutate}
31:	* fires synchronously per mutation (registry state is consistent when they
32:	* fire); {@link SlotCore.subscribeDeclaration} fires synchronously for each
33:	* declaration lifetime boundary; {@link SlotCore.subscribe} notifications
34:	* batch per microtask, so N same-tick mutations produce one notification per
35:	* touched key.
```
— `/home/CNS2026495165/dsh/dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js:30-35`

`getVersion` — O(1), a single `Map.get`:

```
294:	/**
295:	* Monotonic version for a key, bumped synchronously per mutation so a
296:	* uSES getSnapshot read is never stale when its batched notification lands.
297:	* @param key - slot key.
298:	* @returns current version (0 for untouched keys).
299:	*/
300:	getVersion(key) {
301:		return this.records.get(key)?.version ?? 0;
302:	}
```
— `/home/CNS2026495165/dsh/dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js:294-302`

The delegating service face, same cost:

```
239:			getVersion(key) {
240:				return this._core.getVersion(key);
241:			}
```
— `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js:239-241`

The `record()` allocation side effect of subscribing to an undeclared key:

```
384:	record(key) {
385:		let rec = this.records.get(key);
386:		if (!rec) {
387:			rec = {
388:				spec: void 0,
389:				declaredBy: void 0,
390:				parent: void 0,
391:				declarationEpoch: 0,
392:				entries: NO_ENTRIES,
393:				version: 0,
394:				listeners: /* @__PURE__ */ new Set(),
395:				declarationListeners: /* @__PURE__ */ new Set()
396:			};
397:			this.records.set(key, rec);
398:		}
399:		return rec;
400:	}
```
— `/home/CNS2026495165/dsh/dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js:384-400`

### (c) Confidence
**HIGH.** Two independent artifacts agree (readable `CORE` + live minified `BUNDLE` extraction), the
cordis service is a pure pass-through, and the author's docstring states the microtask batching explicitly.
The O(1) claim is HIGH because the body is literally `this.records.get(key)?.version ?? 0` with no loop
(`Map.get` is the only data-structure touch).

---

## 2. `ctx.slots.inject(slotName, factory)` semantics

### (a) Verdict
It is **NOT a version-keyed factory**. `ctx.slots.inject(key, callback)` installs an effect for each
**declaration lifetime** of the slot, keyed on `declarationEpoch` — **not** on the ledger version.
Therefore: (i) it **does invoke the callback synchronously at inject time when the slot is already
declared** (line 104), and (ii) it **re-invokes it only when the declaration collapses and is re-declared**
— it does **not** re-run when a sibling entry registers. Its memoization axis is the **declaration epoch**,
not the version (`active`/`activeEpoch` guard at line 75).

Separately, the **entry-level** `inject` option (`inject: shellInjected` in SG) is memoized **per entry
object** — invoked once per registration, not per render and not per version.

### (b) Evidence

```
41:			* Install an effect for each declaration lifetime of a slot. The callback
42:			* runs synchronously when the declaration already exists; otherwise it runs
43:			* inside the declaring `register()` call after the declaration is committed.
44:			* Collapse disposes the effect and a later declaration runs it again.
...
55:			inject(key, callback) {
56:				const ctx = this.ctx;
57:				const disposeController = ctx.effect(() => {
...
71:					const reconcile = () => {
72:						if (stopped) return;
73:						const spec = this._core.specDynamic(key);
74:						const epoch = this._core.declarationEpoch(key);
75:						if (active !== void 0 && activeEpoch === epoch) return;
76:						const dispose = active;
77:						active = void 0;
78:						activeEpoch = void 0;
79:						dispose?.();
80:						if (spec === void 0) return;
81:						const disposeEffect = ctx.effect(callback, `slots.inject(${JSON.stringify(key)}): declaration`);
82:						active = () => {
83:							disposeEffect();
84:						};
85:						activeEpoch = epoch;
86:					};
...
102:					unsubscribe = this._core.subscribeDeclaration(key, changed);
103:					try {
104:						reconcile();
105:					} catch (error) {
```
— `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js:41-105`

The re-invocation channel is `subscribeDeclaration`, and the core documents that **ordinary entry
mutations do not notify it**:

```
277:	/**
278:	* Subscribe to declaration lifetime boundaries for a key. Notifications
279:	* are synchronous so declaration teardown finishes before a subsequent
280:	* same-tick registration can observe stale resources. Ordinary entry
281:	* mutations do not notify this surface. A children table commits every
282:	* sibling declaration before its first notification.
```
— `/home/CNS2026495165/dsh/dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js:277-282`

`notifyDeclaration` is reached from exactly two places — a `children` table commit and `releaseEntry`
(collapse) — never from an ordinary entry mutation:

```
135:			for (const [, childRec] of declarations) this.markDirty(childKey, childRec);
136:			for (const [, childRec] of declarations) this.notifyDeclaration(childRec);
...
379:			this.markDirty(childKey, childRec);
380:			this.notifyDeclaration(childRec);
```
— `/home/CNS2026495165/dsh/dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js:135-136` and `:379-380`

The **entry-level** inject face is cached on the entry object (WeakMap), so the factory runs once per
registration and the resulting prop/hook object identity is stable across renders:

```
396:		function cachedRootInject(entry, actions) {
397:			let props = rootInjectCache.get(entry);
398:			if (!props) {
399:				props = runInject(entry, void 0, actions);
400:				rootInjectCache.set(entry, props);
401:			}
402:			return props;
403:		}
```
— `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js:396-403`

(The root path that renders `sidebar.settings`, i.e. the settings shell, uses exactly this cache:
`return renderEntry(slotKey, Comp, kit, standard, cachedRootInject(entry, actions), ...)` —
`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js:711-716`.)

### (c) Confidence
**HIGH.** The epoch guard, the `subscribeDeclaration` (rather than `subscribe`) wiring, and the "ordinary
entry mutations do not notify this surface" docstring all agree, and I confirmed `notifyDeclaration` has
only the two call sites above (`grep -n notifyDeclaration CORE` → 136, 380, plus the definition at 412).
**One caveat (MEDIUM on intent, HIGH on code):** `ctx.effect(callback, ...)` means the callback's
*disposer* lifetime is the declaration; the callback body itself is invoked synchronously at `reconcile()`
when the slot is already declared (line 104) — this is the "immediate" part of the answer.

---

## 3. `renderSlot(name, props, { only })` semantics

### (a) Verdict
`only` is a **post-sort equality filter on the row's `id`**: `list.filter((item) => item.id === opts.only)`.
It filters **list** slots only (the `only` branch sits in the list-kind tail of the dispatcher); single/keyed
read `opts.entryKey` and chain uses `select`/`overlay`.
`renderSlot` **does subscribe to the ledger**: the returned element is a `SlotOutlet` that calls
`useSyncExternalStore((fn) => host.subscribe(slotKey, fn), () => host.getVersion(slotKey))` — so a mutation
of *any* entry in that slot schedules a React re-render of the outlet (subject to uSES's version-equality
short-circuit: a notification whose `getVersion` value is unchanged does not re-render).
The binding itself is **identity-stable per entry** (WeakMap), so it does not churn subscriptions per render.

### (b) Evidence

`only` filtering, after the sort:

```
844:			let list = [...rows].sort((a, b) => a.order - b.order);
845:			if (opts?.only !== void 0) list = list.filter((item) => item.id === opts.only);
846:			if (list.length === 0) return (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: opts?.fallback ?? null });
```
— `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js:844-846`

Note the rows fed into that filter come from `entriesOfSlot` (winner projection, **fresh array per call**)
plus a second pass over raw `entries` to append dead-cell markers:

```
829:			const rows = host.entriesOfSlot(slotKey).map((entry) => ({
830:				entry,
831:				id: entry.options.id,
832:				order: entry.options.order ?? 0
833:			}));
```
— `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js:829-833`

The outlet subscribes to the ledger **and** to the locale face on every mounting:

```
741:		function SlotOutlet({ slotKey, ownerProps, opts }) {
742:			const host = useHost();
743:			(0, react.useSyncExternalStore)((fn) => host.subscribe(slotKey, fn), () => host.getVersion(slotKey));
744:			useLocaleRevision(host.locale);
```
— `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js:741-744`

The binding is per-entry and cached (identity-stable), and each *invocation* re-checks liveness:

```
281:		function boundRenderSlot(host, entry) {
282:			let binding = renderSlotCache.get(entry);
283:			if (!binding) {
284:				binding = (key, owner, opts) => {
285:					if (!host.isLive(entry)) throw new _deepseek_ai_dsh_client_ui_slots.StaleAuthorizationError(`renderSlot('${key}') from a disposed registration`);
286:					const declared = entry.children?.[key];
287:					if (declared === void 0) throw new _deepseek_ai_dsh_client_ui_slots.SlotOwnershipError(`slot '${key}' is not declared by this entry's children`);
288:					if (declared.kind === "chain") throw new _deepseek_ai_dsh_client_ui_slots.SlotOwnershipError(`slot '${key}' is declared 'chain' — use renderSlotChain`);
289:					return (0, react_jsx_runtime.jsx)(SlotOutlet, {
290:						slotKey: key,
291:						ownerProps: owner,
292:						opts
293:					});
294:				};
295:				renderSlotCache.set(entry, binding);
296:			}
297:			return binding;
298:		}
```
— `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js:281-298`

### (c) Confidence
**HIGH** for both the `only` semantics and the subscription (the uSES call is unconditional in the
component body). **MEDIUM** only for the phrasing "causing a React re-render when any entry changes":
React *schedules* an update on every `subscribe` notification, but whether a commit happens depends on
whether `getVersion`'s value changed, i.e. the uSES comparison. I state that nuance rather than flattening it.

---

## 4. `register(options, Component)` and `entries(name)`

### (a) Verdict — one premise corrected, one confirmed
- **`entries(name)` does NOT allocate a new array per call.** It returns the record's **cached array
  reference** (`rec.entries`), or a **shared frozen empty array** `NO_ENTRIES` for undeclared keys. The
  premise in the assignment ("does `entries()` allocate a new array each call … line 502 and 525 call it
  inside `getSnapshot`") is **FALSE for `SlotCore.entries`**. The fresh-array variant is
  `entriesOfSlot` (used by the *renderer*, not by `getSnapshot`), and its own docstring says so.
- **`register` writes a NEW ledger version unconditionally — even when the entry is identical.** There is
  no identity/equality dedupe and no "no-op" path: every successful `register` appends, re-sorts, reassigns
  `rec.entries`, and calls `markDirty`, which does `rec.version += 1` and schedules a microtask flush.

### (b) Evidence

`entries` — cached reference, O(1), no allocation:

```
156:	* Snapshot the registered entries for a key. Returns the cached array
157:	* reference (stable between mutations — safe as a uSES getSnapshot source);
158:	* empty for keys not (or no longer) declared, so renderers may probe ahead
159:	* of plugin load order.
...
164:	entries(key) {
165:		return this.records.get(key)?.entries ?? NO_ENTRIES;
166:	}
```
— `/home/CNS2026495165/dsh/dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js:156-166` (`NO_ENTRIES` = `Object.freeze([])`, `:22`)

`entriesOfSlot` — the one that *does* build a fresh array, and says it is not a getSnapshot source:

```
173:	* @returns the winning entry per occupied cell (empty while undeclared).
174:	* Builds a fresh array per call — a render body read, not a uSES getSnapshot source.
...
179:	entriesOfSlot(key) {
180:		const rec = this.records.get(key);
181:		if (!rec?.spec) return NO_ENTRIES;
182:		const kind = rec.spec.kind;
183:		if (kind === "chain") return rec.entries;
184:		const heads = [];
185:		const seenCells = /* @__PURE__ */ new Set();
...
193:		return heads;
194:	}
```
— `/home/CNS2026495165/dsh/dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js:174-194`

`register` writes a new version unconditionally:

```
121:		const next = [...rec.entries, entry];
122:		next.sort(spec.kind === "list" ? (a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0) || (a.options.order ?? 0) - (b.options.order ?? 0) : (a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0));
123:		rec.entries = next;
124:		this.markDirty(options.name, rec);
```
— `/home/CNS2026495165/dsh/dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js:121-124`
combined with `markDirty`'s `rec.version += 1` at `/home/CNS2026495165/dsh/dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js:402`.
The only validation that can reject a re-registration is a **priority collision** (same `id`/`key` at the
same priority), not entry equality: `:82-87`.

Each `register` also fans out to the runtime event bridge once per mutation:

```
34:			constructor(ctx) {
35:				super(ctx, "slots");
36:				this._core.onMutate((key) => {
37:					ctx.emit("slots/changed", key);
38:				});
```
— `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js:34-38`

### (c) Confidence
**HIGH** on both. The `entries` refutation is HIGH because the body is a single `Map.get` with no
allocation branch, corroborated byte-for-byte in the live bundle (`entries(n){…:i.entries??ji}`). The
"new version even when identical" claim is HIGH because `register` has no equality check anywhere before
`markDirty` (I read the whole method, `CORE:64-144`).

---

## 5. Immediate-callback census for the settings shell

### (a) Verdict table

| Subscription source | Subscribe-time synchronous fire? | Evidence |
|---|---|---|
| `useSections` → `sections.subscribe` | **NO** — two sub-subscriptions, both non-firing | `SG:511-518`; `RT:231-233`; `CORE:270-276`; `LOCALE:1085-1090` |
| ↳ inner `ctx.slots.subscribe("settings.section", listener)` | **NO** | `SG:512` → `RT:231-233` → `CORE:270-276` |
| ↳ inner `ctx.locale.subscribe(listener)` | **NO** | `SG:513` → `LOCALE:1085-1090` |
| `useOnboardingSteps` → `ctx.slots.subscribe("settings.onboarding", listener)` | **NO** | `SG:533`; `CORE:270-276` |
| `useSessions` → `host.sessions.list.subscribe` | **NO** | `RENDERER:540`, `RENDERER:154-160`; `RT:8963-8971`; `RT:5397-5426`; zustand `RT:4754-4760` |
| `ctx.locale.subscribe` (as used anywhere) | **NO** | `LOCALE:1085-1090` |
| (framework) `useSyncExternalStoreWithSelector` shim | **NO** — it only hands `subscribe` to React | `RENDERER:92-139` (esp. `:132`) |

**Every one of the six subscription channels in the settings shell is non-firing at subscribe time.**
There is no `fireImmediately` path in play: the `fireImmediately` branch exists in the bundled
`subscribeWithSelector` middleware but is only taken when `options.fireImmediately` is passed with a
selector+listener pair, and `createSnapshotStore` calls `api.subscribe(fn)` with a **single argument**
(selector position), so the branch is skipped.

### (b) Evidence

The shell's two hook faces, verbatim:

```
511:					subscribe: (listener) => {
512:						const offLedger = ctx.slots.subscribe("settings.section", listener);
513:						const offLocale = ctx.locale.subscribe(listener);
514:						return () => {
515:							offLedger();
516:							offLocale();
517:						};
518:					}
```
— `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js:511-518`

```
533:					subscribe: (listener) => ctx.slots.subscribe("settings.onboarding", listener)
```
— `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js:533`

`ctx.locale` is the `LocaleRuntime` instance provided directly (no wrapper layer), and its `subscribe`
only adds to a `Set`:

```
1085:			subscribe(fn) {
1086:				this.listeners.add(fn);
1087:				return () => {
1088:					this.listeners.delete(fn);
1089:				};
1090:			}
```
— `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-locale/lib/client.js:1085-1090`
(`ctx.provide("locale", locale)` — `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-locale/lib/client.js:1230`)

`useSessions` is `observableHook(host.sessions.list)`, i.e. a uSES-with-selector over the sessions store:

```
539:					root: {
540:						useSessions: observableHook(host.sessions.list),
541:						useWorkspaces: observableHook(host.workspaces.list)
542:					},
```
— `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js:539-542`

```
154:		function bindSnapshotSelector(w) {
155:			const subscribe = (fn) => w.subscribe(fn);
156:			const getSnapshot = () => w.getSnapshot();
157:			return function useSelector(sel, eq) {
158:				return (0, import_with_selector.useSyncExternalStoreWithSelector)(subscribe, getSnapshot, void 0, sel, eq);
159:			};
160:		}
```
— `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js:154-160`

`sessions.list` is `createSnapshotStore(...)`:

```
8963:				this.list = createSnapshotStore({
8964:					ids: [],
...
8971:				});
```
— `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js:8963-8971`

whose `subscribe` bottoms out in zustand-vanilla `subscribe` — add to `Set`, no fire:

```
4754:			const subscribe = (listener) => {
4755:				listeners.add(listener);
4756:				return () => listeners.delete(listener);
4757:			};
```
— `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js:4754-4757`

and the middleware wrapper is a pass-through for the one-argument call:

```
4774:			api.subscribe = (selector, optListener, options) => {
4775:				let listener = selector;
4776:				if (optListener) {
...
4788:					if (options == null ? void 0 : options.fireImmediately) optListener(currentSlice, currentSlice);
4789:				}
4790:				return origSubscribe(listener);
```
— `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js:4774-4790`
and the store's own wrapper is `subscribe: (fn) => subscribe(fn)` at
`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js:5417`
(with `getSnapshot: () => api.getState()` at `:5416`; for stores created without `flush: "raf"` that
`subscribe` is `(fn) => api.subscribe(fn)` from `:5401`).

### (c) Confidence
**HIGH** for all six. Each channel was traced to a concrete `Set.add`-and-return body, and for the two
delegating layers (`SlotsService`, `createSnapshotStore`) I read the delegation itself rather than assuming it.

---

## 6. Per-render cost of the trigger row

### (a) Verdict
- `getVersion` **is called on every single `getSnapshot` invocation**, unconditionally, as the first
  statement — `SG:497` (settings.section) and `SG:522` (settings.onboarding). It is **O(1)** (one `Map.get`
  plus property read; `CORE:300-302`). It touches a Map; it does **not** scan an array, and it is **not** a
  counter read on a shared integer — the `version` field lives on the per-key record object.
- `ctx.locale.getSnapshot().revision` (`SG:498`) is **O(1)**: `getSnapshot` returns the cached, frozen
  snapshot object; `.revision` is a plain property read (`LOCALE:1075-1077`, field set at `:1051-1055`
  and `:1170-1174`).
- The `.map(...).sort(...)` rebuild is **guarded**: it runs only when `version !== rowsVersion ||
  revision !== rowsRevision` (`SG:499-508`). So the per-read cost in the steady state is two `Map.get`s
  plus one property read — not a rebuild.
- **Correction to the premise:** the premise says `getSnapshot` calls `getVersion` + `entries(name).map().sort()`
  "when the version changed". The `getVersion` half is right; the `entries` half does **not allocate** —
  `entries` returns the cached array (`CORE:164-166`); the allocation is the `.map()` and `.sort()` in the
  shell itself, and only on change.

### (b) Evidence

The exact per-read sequence (note the version/revision reads precede the guard):

```
496:					getSnapshot: () => {
497:						const version = ctx.slots.getVersion("settings.section");
498:						const revision = ctx.locale.getSnapshot().revision;
499:						if (version !== rowsVersion || revision !== rowsRevision) {
500:							rowsVersion = version;
501:							rowsRevision = revision;
502:							rows = ctx.slots.entries("settings.section").map((e) => ({
503:								/* v8 ignore next -- list-slot registration requires id (SlotCore rejects an entry without one) */
504:								id: e.options.id ?? "",
505:								order: e.options.order ?? 0,
506:								label: (0, _deepseek_ai_dsh_client_ui_slots.resolveSlotLabel)(e.options.label) ?? ""
507:							})).sort((a, b) => a.order - b.order);
508:						}
509:						return rows;
510:					},
```
— `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js:496-510`

```
520:				onboardingSteps: {
521:					getSnapshot: () => {
522:						const version = ctx.slots.getVersion("settings.onboarding");
523:						if (version !== onboardingVersion) {
524:							onboardingVersion = version;
525:							onboardingSteps = ctx.slots.entries("settings.onboarding").map((e) => ({
```
— `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js:520-525`

The cache variables are closure state of `apply()`, shared by everything that calls this face:

```
489:			let rowsVersion = -1;
490:			let rowsRevision = -1;
491:			let rows = [];
492:			let onboardingVersion = -1;
493:			let onboardingSteps = [];
```
— `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js:489-493`

Locale `getSnapshot` is a cached-object return; `revision` is a field:

```
1075:			getSnapshot() {
1076:				return this.snapshot;
1077:			}
```
— `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-locale/lib/client.js:1075-1077`

**How often `getSnapshot` runs.** The hooks are uSES-with-selector; the shim calls `getSnapshot` during
render and on every store notification, and re-runs the selector `(s)=>s` each time:

```
132:				var d = r(a, c[0], c[1]);
133:				u(function() {
134:					f.hasValue = !0;
135:					f.value = d;
136:				}, [d]);
```
— `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js:132-136`

Because the shell returns a **stable `rows` reference** when nothing changed, the `(s)=>s` selector plus
`Object.is` short-circuits the re-render — the *guard* is what prevents a re-render storm; the reads
themselves are the only per-notification cost. **I did not measure listener counts or timings at runtime;
this section is a static reading of the code paths, not a profile.**

### (c) Confidence
**HIGH** on all four static claims (each is a single-expression body or an explicit guard). **INCONCLUSIVE**
on the *magnitude* of the trigger-row cost in wall-clock terms: that requires runtime instrumentation
(React commit counts / profiler traces), which this read-only static audit does not produce. I am not
substituting an estimate for a measurement.

---

## 7. Subscriber / registrant census (first settings open)

All counts below are from `grep` over the live `.npm-global` client bundles. **Static call-site counts are
HIGH-confidence; the number of *live mounted* subscribers at a given instant is not statically derivable**
and is marked as such.

### 7.1 Registrants into `settings.section` — **4 entries**

| id | order | registrant | evidence |
|---|---|---|---|
| `general` | 0 | `dsh-client-ui-settings-general` | `SG:585-595` |
| `models` | 10 | `dsh-client-ui-settings-models` | `.../dsh-client-ui-settings-models/lib/client.js:2784-2790` |
| `plugins` | 15 | `dsh-client-ui-settings-plugins` | `.../dsh-client-ui-settings-plugins/lib/client.js:1276-1283` |
| `agent-presets` | 20 | `dsh-client-ui-agent-preset` | `.../dsh-client-ui-agent-preset/lib/client.js:1706-1713` |

`dsh-client-ui-settings-plugin-inventory` does **not** register into `settings.section`; it contributes
into `settings.plugins.tab` (`.../dsh-client-ui-settings-plugin-inventory/lib/client.js:285-286`).

### 7.2 `slots.subscribe("settings.section", …)` — **2 subscribers on first open**

1. **`SettingsRoot`'s `useSections`** (uSES) — created when the shell entry first renders. `sidebar.settings`
   is rendered by the sidebar footer (`.../dsh-client-ui-sidebar/lib/client.js:236` —
   `children: renderSlot("sidebar.settings", { wide })`), so this subscription exists **from app mount,
   long before the Settings button is clicked**.
2. **`SlotOutlet("settings.section")`** (uSES, `RENDERER:743`) — only exists while the panel is open with
   `active !== void 0` (`SG:164`).

### 7.3 `slots.inject("settings.section", …)` — **4 declaration-lifetime controllers**

`SG:585`, `.../dsh-client-ui-agent-preset/lib/client.js:1706`,
`.../dsh-client-ui-settings-models/lib/client.js:2784`,
`.../dsh-client-ui-settings-plugins/lib/client.js:1276` → each installs one
`subscribeDeclaration` listener (`RT:102`) **plus** one `ctx.effect`. Per §2 these are **not** woken by
sibling entry registrations, so they do not participate in the per-entry mutation fanout.

### 7.4 `locale.subscribe(…)` — **call sites statically enumerable, live count NOT**

Only **two** direct `ctx.locale.subscribe(...)` call sites exist in the whole live bundle:

- `SG:513` (settings shell's `sections` hook) — alive from app mount.
- `.../dsh-client-ui-settings-plugins/lib/client.js:1269` (that section's `tabs` hook) — alive only while
  the Plugins section is mounted.

On top of those, **every mounted `SlotOutlet` subscribes to the locale face** via `useLocaleRevision`
(`RENDERER:744` → `RENDERER:484-487` → `RENDERER:469`). The number of live locale subscribers therefore
equals the number of mounted outlets in the whole shell, which is a runtime property, not a static one →
**INCONCLUSIVE for an exact figure.**

### 7.5 Other ledger subscribers that coexist (not `settings.section`, listed for completeness)

- `ctx.slots.subscribe("settings.plugin.item", …)` inside `ctx.effect` — registered at **plugin activation**,
  not at click: `.../dsh-client-ui-settings-plugins/lib/client.js:1245-1247`.
- `slots.subscribe("conversation.view", …)`: `.../dsh-client-ui-conversation/lib/client.js:9937`.
- `ctx.slots.subscribe(hole, listener)` (generic): `.../dsh-client-ui-workspace/lib/client.js:2383`.
- `sessions.list.subscribe(...)` at sessions-service construction:
  `RT:8975-8978`.
- `settings.onboarding` registrants: 2 (`.../dsh-client-ui-settings-models/lib/client.js:2791` and `:2797`),
  with 1 subscriber (`SG:533`).

### 7.6 Leak assessment

No unbounded leak found on these paths: the `shellInjected` disposer closes **both** child subscriptions
(`SG:514-517`), and React's uSES invokes it on unmount; the `settings.plugin.item` subscription is owned by
`ctx.effect`. The one non-leak-but-unbounded growth is `CORE.record()`: `subscribe()` allocates a permanent
record for any key, and `records` is never pruned (`CORE:384-400`). Bounded in practice here by a small
fixed key set.

### (c) Confidence
**HIGH** for every count in 7.1–7.3 and for the two `ctx.locale.subscribe` call sites (exhaustive `grep`
over `.../@deepseek-ai/*/lib/client.js`). **INCONCLUSIVE** for the live locale-subscriber total (§7.4) and
for any "N subscribers at time T" figure — those need runtime instrumentation.

---

## Appendix A — extra static findings (outside the 7 questions, flagged as such)

These are relevant to the lag investigation but were not asked for. Both are pure source readings.

**A1. `renderSlot(...)` performs an O(#slot-records) liveness scan on every invocation.**
Each call to the binding runs `if (!host.isLive(entry))` (`RENDERER:285`), and `isLive` iterates **every
record in the ledger** with an `Array.includes` per record:

```
152:	isLive(entry) {
153:		for (const rec of this.records.values()) if (rec.entries.includes(entry)) return true;
154:		return false;
155:	}
```
— `/home/CNS2026495165/dsh/dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js:152-155`
(`Map` iteration follows insertion order, so the scan length depends on where the entry's slot was declared.)
The settings shell issues **four** `renderSlot` calls per render — `settings.action` (`SG:151`),
`settings.close` (`SG:159`), `settings.section` (`SG:164`), `settings.trigger` (`SG:211`) — so each
`SettingsRoot` render implies four such scans. Confidence **HIGH** on the code path; **INCONCLUSIVE** on
the wall-clock significance (needs profiling).

**A2. Every dictionary registration publishes a locale revision and notifies every locale subscriber
synchronously.** `LocaleRuntime.register(ns, …)` ends in `this.publish(this.snapshot.active, false)`
(`LOCALE:1130`; removal path `:1141`), and `publish` bumps `revision` and synchronously calls every
listener:

```
1169:			publish(active, localeChanged) {
1170:				this.snapshot = Object.freeze({
1171:					active,
1172:					locales: this.snapshot.locales,
1173:					revision: this.snapshot.revision + 1
1174:				});
1175:				if (localeChanged) this.ctx.emit("locale/change", this.snapshot);
1176:				for (const fn of [...this.listeners]) try {
1177:					fn();
1178:				} catch (error) {
1179:					console.error("locale subscriber crashed:", error);
1180:				}
1181:			}
```
— `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-locale/lib/client.js:1169-1181`

So boot-time dictionary registration is a fanout of (#plugins registering dictionaries) × (#live locale
subscribers) — and every outlet is a locale subscriber (A-render path via `RENDERER:744`). `setLocale`
deliberately suppresses republish when unchanged (`LOCALE:1106`), but `register` does not. Confidence
**HIGH** on the mechanism; **INCONCLUSIVE** on counts/significance without a trace.

---

## Appendix B — method recap

`read`/`grep`/`sed` only, plus two read-only `node -e` extractions that printed byte windows from the
frontend bundle (no files written outside this report, no process touched). No `sandbox_permissions` used.
The `ps` call was read-only and used solely to identify which install the GUI serves from.
