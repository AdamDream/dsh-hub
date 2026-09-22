# Static quantification of the DSH Web GUI Settings modal

**Scope**: predict, purely from deployed code + read-only RPC, what each Settings section *should* cost in
DOM size and RPC traffic. Read-only: no product file was modified, no process was signalled, no browser was
launched.

**Deployed code root (canonical)**: `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`
reached through the profile symlinks at `/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/`
(and `/home/CNS2026495165/.dsh/profiles/node_modules/@local/` for the local plugins).
**Proof the code under analysis is the code the browser runs** — served bytes are byte-identical to disk:

```
$ curl -s http://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-ui-settings-plugin-inventory/client.js | md5sum
98b7d8fa7ea75dbdec4c1865743cb950   (stdin)
$ md5sum .../dsh-client-ui-settings-plugin-inventory/lib/client.js
98b7d8fa7ea75dbdec4c1865743cb950   .../lib/client.js
$ curl -s .../dsh-client-ui-settings-plugins/client.js | md5sum
f428c577f4a1ac3c542fa34bf871f115   (stdin)   == on-disk f428c577f4a1ac3c542fa34bf871f115
```

All `file:line` citations below are relative to
`/home/CNS2026495165/.dsh/profiles/node_modules/` unless a full path is given.

---

## 0. PREMISE CORRECTION (read this first) — the modal has EIGHT nav sections, not three

The brief states "exactly THREE nav sections". The deployed code and the live boot payload contradict that.

**(a) Eight unconditional `settings.section` registrations exist in loaded client modules:**

| # | id | order | label | registrant | citation |
|---|---|---|---|---|---|
| 1 | `general` | 0 | 通用设置 | `@deepseek-ai/dsh-client-ui-settings-general` | `@deepseek-ai/dsh-client-ui-settings-general/lib/client.js:585-595` |
| 2 | `models` | 10 | 模型 | `@deepseek-ai/dsh-client-ui-settings-models` | `@deepseek-ai/dsh-client-ui-settings-models/lib/client.js:2784-2792` |
| 3 | `plugins` | 15 | 插件 | `@deepseek-ai/dsh-client-ui-settings-plugins` | `@deepseek-ai/dsh-client-ui-settings-plugins/lib/client.js:1276-1287` |
| 4 | `agent-presets` | 20 | (agent preset nav) | `@deepseek-ai/dsh-client-ui-agent-preset` | `@deepseek-ai/dsh-client-ui-agent-preset/lib/client.js:1706-1713` |
| 5 | `dsh-workspace-enhancement` | 40 | (remote workspace) | `dsh-workspace-enhancement` (unscoped) | `dsh-workspace-enhancement/lib/client.js:5376-5383` |
| 6 | `@local/dsh-ssh-gui` | 50 | 分布式控制 · dsh-ssh-gui | `@local/dsh-ssh-gui` | `@local/dsh-ssh-gui/lib/client.js:987-993` |
| 7 | `@deepseek-ai/dsh-vision-adam` | 60 | vision-adam 识图设置 | `@deepseek-ai/dsh-vision-adam` | `@deepseek-ai/dsh-vision-adam/lib/client.js:201-207` |
| 8 | `@local/dsh-subagent-model` | 70 | 子代理模型 | `@local/dsh-subagent-model` | `@local/dsh-subagent-model/lib/client.js:309-315` |

None is gated by a conditional (all are plain calls inside `apply(ctx)`; checked
`grep -n "isLoopback\|if (.*) return"` on each file — no gate precedes the registration).

**(b) All eight client modules are in the live boot payload.** `GET /` returns an HTML boot document whose
module list is authoritative for what the browser loads; it contains 52 `/plugins/...client.js` URLs, among
them every registrant above:

```
/plugins/@deepseek-ai/dsh-client-ui-settings-general/client.js?rev=f733efde3f2f
/plugins/@deepseek-ai/dsh-client-ui-settings-models/client.js?rev=f12fb342db3b
/plugins/@deepseek-ai/dsh-client-ui-settings-plugins/client.js?rev=219832a33fa4
/plugins/@deepseek-ai/dsh-client-ui-agent-preset/client.js?rev=96dbaff92d41
/plugins/dsh-workspace-enhancement/client.js?rev=b295bb00e32b
/plugins/@local/dsh-ssh-gui/client.js?rev=562e71eae991
/plugins/@deepseek-ai/dsh-vision-adam/client.js?rev=24bcc3eec45c
/plugins/@local/dsh-subagent-model/client.js?rev=d0b7a565217f
```

The nav renders `rows.map(...)` over **all** `settings.section` entries sorted by order
(`@deepseek-ai/dsh-client-ui-settings-general/lib/client.js:132-143`, rows built at `:502-507`), so the nav
list has **8 buttons**, and `navIcon(row.id)` supplies an svg for every one of them (`:73-90`; `models`,
`agent-presets`, `plugins` have named icons, everything else falls through to `IconSettingsOutline16`).

**Consequence for the browser measurement**: "switching/scrolling between settings sections" is a walk over
8 sections, 5 of which are third-party pages, not over 3. Any cost model that assumes 3 is wrong. Two of the
extra sections also fire RPCs on mount (see §6). This is a load-bearing correction and is why §6 is
included even though it is outside the requested three.

---

## 1. Per-section expected DOM node count

### Method (and its limits, stated up front)

I counted **host elements** (`jsx`/`jsxs` call sites whose type argument is a lowercase tag string) in the
deployed `lib/client.js`, per component, by line-range extraction of each component's body. Then I multiplied
by the number of repeated rows/cards. Things this method **does not** capture, and which therefore make the
counts a *lower bound*:

* internals of called components (`Menu`, `PresetMenu`, `Icon`, `Slider`, `Modal`, `ProviderEditor`,
  `RiskConfirmation`, `IconChevronDownOutline14`, …) are one call site here but N DOM nodes at runtime;
* conditional branches (a JSX site inside `cond ? (…) : null`) are counted once even when it does not render;
* whitespace text nodes: the JSX transform drops whitespace-only lines, so only literal/expression children
  become text nodes — counts below follow that rule.

Counts are therefore "order of magnitude + defensible count", not exact DOM totals. Marked `UNVERIFIED`
where a gap remains.

### 1a. `general` — 6 rows, ≈ 67–71 host elements, order 10^2 (tens)

**Row multiplier = 6**, from the `settings.general.item` (list-kind) registrations, sorted by `order`:

| order | id | package | citation |
|---|---|---|---|
| −25 | `agent-preset` | `@deepseek-ai/dsh-client-ui-agent-preset` | `.../dsh-client-ui-agent-preset/lib/client.js:1699-1705` |
| −20 | `permission` | `@deepseek-ai/dsh-client-ui-permission-presets` | `.../dsh-client-ui-permission-presets/lib/client.js:441-447` |
| 0 | `language` | `@deepseek-ai/dsh-client-locale` | `.../dsh-client-locale/lib/client.js:1250-1257` |
| 10 | `appearance` | `@deepseek-ai/dsh-client-ui-theme` | `.../dsh-client-ui-theme/lib/client.js:1337-1344` |
| 20 | `composer-enter` | `@deepseek-ai/dsh-client-ui-conversation` | `.../dsh-client-ui-conversation/lib/client.js:9910-9922` |
| 30 | `wallpaper` | `@local/dsh-wallpaper` | `@local/dsh-wallpaper/lib/client.js:591-602` |

(Exhaustive: `grep -Rln 'inject("settings.general.item"'` over the whole profile `node_modules` returns
exactly these packages plus `dsh-cordis-client-runner` and `dsh-pptmaster`'s nested copies, and
`dsh-cordis-client-runner/lib/client.js:3243,3267` only *documents* the slot in a contract catalog — it does
not register into it.)

Container chain (3 fixed wrappers): `div[data-slot="settings.section"]` + `div._WvWnq_section` +
`div[data-slot="settings.general.item"]`.
`div[data-slot]` is the renderer's `SlotOutlet` anchor, `style:{display:"contents"}`
(`@deepseek-ai/dsh-client-ui-renderer/lib/client.js:740,745-749`). A `list` slot adds **no** per-entry
wrapper — entries render through `guarded(entry, key)` whose `SlotErrorBoundary` renders `children`
directly (`.../dsh-client-ui-renderer/lib/client.js:838-840,717-722`); this is why
`GeneralSection.module.css` can style `._WvWnq_section > [data-slot="settings.general.item"] > :last-child`
(`.../dsh-client-ui-settings-general/lib/client.js:278`).

Per-row host-element sites (counted in the deployed files):

| row | host sites | of which | citation |
|---|---|---|---|
| agent-preset | 4 (`div`×4) + PresetMenu(1 `button`) | + `Menu` + 1 chevron svg | `.../dsh-client-ui-agent-preset/lib/client.js:290-335`, `:226-260` |
| permission | 5 (`div`×4, `button`×1) | + `Menu` + 1 chevron svg + `RiskConfirmation` | `.../dsh-client-ui-permission-presets/lib/client.js:63-152` |
| language | 4 (`div`×3, `button`×1) | + `Menu` + 1 chevron svg | `.../dsh-client-locale/lib/client.js:908-960` |
| appearance | 4 (`div`×3, `button`×1) | + `Icon` | `.../dsh-client-ui-theme/lib/client.js:74-105` |
| composer-enter | 5 (`div`×4, `button`×1) | + `Menu` + 1 chevron svg | `.../dsh-client-ui-conversation/lib/client.js:4208-4253` |
| wallpaper | 21 (`div`×10, `button`×5, `input`×2, `span`, `select`, `option`, `img`) + 3×`Slider`(4 each = 12) = **33** | | `@local/dsh-wallpaper/lib/client.js:386-489`, `Slider` `:371-385` |

Row subtotal 5+5+4+4+5+33 = **56**, plus 3 wrappers = **59**; plus the uncounted internals of 4 `Menu`
triggers + `PresetMenu` + `Icon` (≈ +8…12) ⇒ **≈ 67–71 host elements**.
Order of magnitude **10^2 (tens)**. `UNVERIFIED` at the ±30 % level: `Menu`/`PresetMenu`/`Icon` are
`@deepseek-ai/dsh-client-ui-primitives` components shipped inside the prebuilt
`dsh-web-frontend/dist/assets/index-ClqxG24t.js` bundle, and their internal node counts were not expanded.
Even at the upper end this section is ~1/18 the size of `插件列表` (see §1c).

### 1b. `models` — 3 rows, ≈ 34 host elements, order 10^1–10^2

**Row multiplier = 3** — the number of *configured* providers, from
`configured = state.rows.filter((row) => row.configured)` (`.../dsh-client-ui-settings-models/lib/client.js:1881`),
where a row is configured iff

```
configured: namespace !== void 0 && (entry.settingsPath.length === 0 ||
             this.schema.getPath(namespace.value, entry.settingsPath) !== void 0)
```
(`.../dsh-client-ui-settings-models/lib/client.js:564-567`)

Evaluated against the live RPC (see §3 for the calls and raw results): `llm.providers` returns **39**
providers; `settings.describe` resolves `settingsPath` for exactly **3** of them —
`deepseek-official` (`settingsPath: []`), `opencode-go`, `adam` (both `['providers', <id>]` present under
`llm-pi-ai.value.providers`). `needsSetup` is false for all three because
`anyUsable = state.rows.some(providerUsable)` is true
(`.../dsh-client-ui-settings-models/lib/client.js:1762-1766`, `providerUsable` at `:609-613`;
`credentials.describe` → `DEEPSEEK_API_KEY.configured === true`), so no provider renders the much larger
setup card — all three take the `rowCard` branch (`:1931`).

Counted from `Loaded` (`.../dsh-client-ui-settings-models/lib/client.js:1803-2110`), `open=false`,
`adding=false`, `declaring=false`, `deleteTarget=undefined`:

* section skeleton `div.section` + `h2` + `p.intro` + `ul.rows` = 4
* rows: deepseek-official 7 (`li`,`div.rowHead`,`span.rowIdentity`,`span.rowName`,`span.credentialDot`,`span.rowActions`,`button`), opencode-go 8 (+ remove button, `removable` true since `llm-pi-ai.user.providers.opencode-go` exists and `llm-pi-ai.base.providers` is empty, `:1969-1971`), adam 9 (+ `span.rowTag` because `declared === true`, `:1942-1945`) = **24**
* `div.addBlock` + `div.addActions` + 2 buttons + 2 `IconPlusOutline16` svg = **6**
* `Modal` (`open:false`) assumed to render null — **UNVERIFIED**, the `Modal` primitive is in the prebuilt bundle

**≈ 34 host elements, order 10^1–10^2.** Text nodes ≈ **13** (`rowName` + edit/remove/tag labels: 2+3+4, plus
`h2`, `p.intro`, two add-button labels). **svg = 2** (`IconPlusOutline16` ×2).

### 1c. `plugins` — 2 tabs, 3 cards / 177 cards

Section structure: `PluginsSettingsSection`
(`@deepseek-ai/dsh-client-ui-settings-plugins/lib/client.js:414-502`). Two facts dominate the numbers:

1. **Only the active section renders** — `SettingsPanel` renders
   `active !== void 0 && renderSlot("settings.section", { close: onClose }, { only: active })`
   (`.../dsh-client-ui-settings-general/lib/client.js:164`), and `renderOutletContent` filters a list slot to
   `opts.only` (`.../dsh-client-ui-renderer/lib/client.js:836-838`). Switching a nav section therefore
   **unmounts** the previous section.
2. **Within the plugins section, visited tab panels are NOT unmounted.**
   `rows.filter((row) => row.id === active || visitedIds.has(row.id)).map(...)`
   (`.../dsh-client-ui-settings-plugins/lib/client.js:489-499`) keeps every previously visited panel in the
   DOM with `hidden: !selected` (`:496`). `active` defaults to `rows[0]` (`:420`), which is `configurable`
   (order 0, `:1288-1299`), so after the first paint `visitedIds = {configurable}`. Clicking 插件列表
   (`all`, order 10, `.../dsh-client-ui-settings-plugin-inventory/lib/client.js:285-292`) adds a **second,
   simultaneously mounted** panel. `hidden` is a CSS/DOM-visibility attribute, not a render gate — the hidden
   panel's 177 cards are real DOM nodes.

#### Tab `可配置` (configurable) — 30 host elements, 3 svg, 10 text nodes

```
div.section(1) + h2(1) + p.intro(1) + div.tabs(1) + button.tab ×2(2)                     =  6
div.panel(1) + div[data-slot="settings.plugins.tab"](1) + ul.cards(1)                     =  3
3 × [ div[data-slot="settings.plugin.item"](1)                 // keyed slot anchor
    + li.card(1) + button.header(1)                            // PluginCard, open=false
    + span.headText(1) + span.name(1) + span.description(1)
    + svg IconChevronDownOutline14(1) ]                       = 21
                                                                        total elements  = 30
```
Multiplier **3** = `namespaces.length`, produced by the exact predicate in
`ConfigurablePluginsTabController.publish()`:

```js
const served = new Set(mirrored.view?.namespaces.map((view) => view.ns) ?? []);
const namespaces = this.entries().flatMap((entry) =>
  entry.options.key !== void 0 && served.has(entry.options.key) ? [entry.options.key] : []);
```
(`@deepseek-ai/dsh-client-ui-settings-plugins/lib/client.js:968-969`)

i.e. **a card renders iff a `settings.plugin.item` registration's `key` is present in the served namespace
set.** The deliberately-not-shown namespaces are the other 17 of the 20 served: only three keys are ever
registered — `shell`, `agent-loop`, `web-search-deepseek`
(`.../dsh-client-ui-settings-plugins/lib/client.js:847, 882, 994` and `:1300-1319`). `settings.describe`
serves **20** namespaces (`agent-default-model, ui-theme, locale, ui-onboarding, ui-conversation,
dsh-subagent, llm-deepseek, web-search-deepseek, agent-loop, agent-presets, session-status-board,
dsh-workerspace, vision-adam, dsh-btw, shell, permission, llm-pi-ai, wallpaper, dsh-usage, dsh-ssh-gui`), so
**17 served namespaces render no card**. The controller also skips a republish when the derived list is
unchanged (`:970-971`).

`ConfigurablePluginsTab` renders `namespaces.map(...)` — **no virtualization**
(`.../dsh-client-ui-settings-plugins/lib/client.js:401-404`). `PluginCard` is collapsed by default
(`useState(false)`, `:204`), which is why only the header subtree exists: `li, button, span.headText,
span.name, span.description, svg` (`:209-235`). An open card adds `div.body` + `div.footer` + 2 buttons +
`ValueField`/`SecretField` (`:236-269`; `ValueField` 8 sites at `:51-94`, `SecretField` 7 at `:102-137`).

#### Tab `插件列表` (all) — 1220 host elements for the panel, 178 svg, 357 text nodes

**Row multiplier = 177**, the live `pluginInventory.list` result (`entries.length === 177`, verified twice;
146 `fiberPhase: "active"`, 31 `null`/disabled). Rendered by

```js
children: filteredEntries.map((entry) => { … })
```
(`@deepseek-ai/dsh-client-ui-settings-plugin-inventory/lib/client.js:150`)

with `filteredEntries = state.snapshot.entries.filter(...)` (`:84`) — all 177 pass the empty-query filter.

Per card (`.../dsh-client-ui-settings-plugin-inventory/lib/client.js:156-207`), `open=false`:

```
li.card(1) > button.cardContent(1)
           > strong.cardTitle(1)            -> 1 text node (title)
           > span.cardTrailing(1)
               > [span.statusDot(1)  iff entry.enabled]     // 146 of 177
               > span.configTag(1)          -> 1 text node (已启用/已停用)
               > svg IconChevronDownOutline14(1)
```

⇒ **6 host elements per enabled card, 5 per disabled card**, **2 text nodes per card**, **exactly 1 svg per
card (no `enabled` gate)**.

```
inside ul.cards : 146×6 + 31×5                     = 1031
chrome          : div.section + div.catalog + label.search + svg(search)
                + span.visuallyHidden + input + div.catalogHeading + h3
                + span[data-plugin-count] + ul.cards  =   10
inventory content                                    1218
+ div.panel + div[data-slot="settings.plugins.tab"]     2
inventory PANEL                                      1220
configurable panel (still mounted, hidden)             24
section chrome (h2, p.intro, div.tabs, 2 tab buttons)   6
WHOLE SECTION when 插件列表 is active                1250
```

Text nodes: `span.visuallyHidden`(1) + `h3`(1) + `span[data-plugin-count]`(1, React renders the number
`177` as a text node) + 177×2 = **357**. SVG: 177 chevrons + 1 `IconSearchOutline16` = **178**; plus the
3 chevrons of the still-mounted hidden configurable panel ⇒ **181 svg inside the section**.

**Order of magnitude 10^3 (≈1.25 × 10^3 host elements).** This is the single largest Settings surface by
roughly 18×, which is the static explanation for "clicking 插件 is expensive".

---

## 2. Expected `<svg>` element count, and the "149 SVG" report

**Icon components in play** (all from `@deepseek-ai/dsh-client-ui-primitives`, shipped in
`dsh-web-frontend/dist/assets/index-ClqxG24t.js`; verified to be a single `<svg>` each — e.g.
`hs = ({size:n=14,className:i}) => f.jsx("svg",{width:n,height:n,…})` at byte offset 230278 of that bundle):

| where | component | count |
|---|---|---|
| each inventory card | `IconChevronDownOutline14` | 177 (`.../dsh-client-ui-settings-plugin-inventory/lib/client.js:188-192`) |
| inventory search box | `IconSearchOutline16` | 1 (`:117`) |
| each collapsed PluginCard | `IconChevronDownOutline14` | 3 (`.../dsh-client-ui-settings-plugins/lib/client.js:234`) |
| panel close button | `IconCloseOutline16` | 1 (`.../dsh-client-ui-settings-general/lib/client.js:157`) |
| nav, one per section | `IconSettingsOutline16` / `IconDataOutline16` / `IconPersonalizationOutline16` / `IconAgentPresetOutline16` | 8 total (`.../dsh-client-ui-settings-general/lib/client.js:73-90`) |
| `models` add buttons | `IconPlusOutline16` | 2 (`.../dsh-client-ui-settings-models/lib/client.js:2061,2077`) |

### Verdict: 149 is **not** a fixed icon set — the count is 1:1 with cards

The chevron is rendered **inside** the per-entry `.map` with no `enabled` gate
(`.../dsh-client-ui-settings-plugin-inventory/lib/client.js:188`), so the code's invariant is

```
svg(插件列表 panel) = N_cards + 1        (1 search icon)
svg(whole plugins section, 插件列表 active) = N_cards + 1 + 3
```

With today's `N_cards = 177` (RPC-verified twice) the expectation is **178** (panel) / **181** (section).

**Exact arithmetic that would produce 149:** `149 = 148 + 1` — i.e. **148 inventory cards + 1 search
icon**. That is the *only* decomposition consistent with the code. Other candidate readings are excluded:

| candidate | result | why it fails |
|---|---|---|
| one chevron per card, today's data | 177 + 1 = 178 | ≠ 149 |
| chevron only on enabled cards | 146 + 1 = 147 | chevron has no `enabled` gate (`:188`) |
| fixed icon set + N pagination dots | — | no such code path exists |

⇒ **`149` most plausibly means the inventory held 148 entries when it was measured** (`N + 1` search icon).
Whether the loader tree grew from 148 to 177 between that measurement and now, or the measurement's DOM
scope differed, is **UNVERIFIED** — the current RPC answer is stable at 177 across two calls and cannot be
rewound. What *is* verified: the number scales 1:1 with plugin cards, so a figure near 150 is a card count
plus one, never a fixed icon budget.

---

## 3. Read-only RPC used

```
POST /api/settings.describe      {"type":"client-request","rpcId":"r1","method":"settings.describe","payload":{}}
     -> ok, writable=true, hasDocument=true, namespaces=20
POST /api/llm.providers          …"method":"llm.providers"…                      -> ok, providers=39
POST /api/credentials.describe   …payload {"refs":["DEEPSEEK_API_KEY","OPENCODE_GO_API_KEY"]}
     -> DEEPSEEK_API_KEY {configured:true,source:"file",writable:true}
        OPENCODE_GO_API_KEY {configured:true,source:"file",writable:true}
POST /api/pluginInventory/list   …"method":"pluginInventory/list","payload":{"args":{}}   -> ok, entries=177
POST /ssh-gui/nodes.list         -> ok, nodes=[]          (HTTP 200; confirms the channel route shape)
POST /dsw/machines.list          -> ok, machines=[]       (HTTP 200)
```

**The `pluginInventory.list` route is NOT `/api/pluginInventory.list`.** It is
`POST /api/pluginInventory/list`. Derivation and proof:

* `@deepseek-ai/dsh-host-plugin-inventory/lib/typert.host.js` declares the invocation
  `id: '@deepseek-ai/dsh-host-plugin-inventory#pluginInventory/list'`, `namespace: 'pluginInventory'`,
  `method: 'list'`.
* `@deepseek-ai/dsh-api-gateway/lib/index.js:62` installs the carrier:
  `connectionCtx.connection.rpc.intercept("/api", (endpoint) => this.claimsEndpoint(endpoint), …)`.
  `claimsEndpoint` requires **exactly two path segments** (`lib/index.js:63-65`), and
  `invokeRpc` splits the endpoint on `/` into `[namespace, method]` (`lib/index.js:117-121`).
* `@deepseek-ai/dsh-client-connection/lib/index.js:310-315` (`endpointFromPath`) and `:275-301`
  (`rpcFetchHandler`) map `POST <channel>/<endpoint>` → the endpoint string, with the envelope's `method`
  required to equal the endpoint (`:289-293`).
* The payload must contain **exactly one** plain-object key, `args`
  (`lib/index.js:123-124`). `{"namespace":…,"method":…,"args":…}` fails with
  `Remote payload must contain exactly one plain-object args field` (observed live).

---

## 4. Expected text-node count per section

| section | text nodes | derivation |
|---|---|---|
| `general` | ≈ 30–35 | `children: t(...)` sites per row: 1,1,1,1,2,10 = 16; plus ≈19 expression children (`children: props.…`/`state.…`). Order 10^1–10^2. |
| `models` | 13 | `h2` + `p.intro` + per-row [name + edit] (2,3,4 with tag/remove labels) + 2 add labels |
| `plugins` → `可配置` | 10 | `h2` + `p.intro` + 2 tab labels + 3 cards × (name + description) |
| `plugins` → `插件列表` | 357 | hidden label(1) + `h3`(1) + count span(1) + 177 cards × 2 (title + 已启用/已停用) |

---

## 5. Exact RPC list per section mount, with the deciding line

### Panel-open time (independent of which section is active)

| RPC | fires when | proof |
|---|---|---|
| `settings.describe` | **once**, at client boot, via the shared mirror; never per section | `@deepseek-ai/dsh-client-ui-settings/lib/client.js:1347` `mirror.ensure()`; `ensure()` is `idle`-only (`:1246-1253`); the single wire read is `:1293` |
| `credentials.describe` | **once**, at boot, from `WebSearchCardController`'s constructor | `.../dsh-client-ui-settings-plugins/lib/client.js:1025` `this.readCredential()` → wire call at `:1053` |
| `llm.providers` + `credentials.describe` | on the first render of the models section (and thereafter on pushed invalidations — see below) | `.../dsh-client-ui-settings-models/lib/client.js:1856` `if (state.status === "idle") controller.load();` → `:548` `this.api.llm.providers({})` + `:578` `credentials.describe({refs})` |

`ctx.settingsScope.describe()` returns the shared mirror and `bind()` adds no wire read of its own —
`.../dsh-client-ui-settings/lib/client.js:1150-1153` and `:1166-1168` (`bind` → `ctx.effect(() => { this.mirror.ensure(); … })`),
with the explicit contract in the doc comment at `:1155-1165`: *"binding adds no wire read of its own"*.

### Per section

| section | RPCs on **mount of the section** | decisive line |
|---|---|---|
| `general` | **0** | `SettingsDocumentAction` only re-reads through the mirror: `controller.load()` (`.../dsh-client-ui-settings-general/lib/client.js:326-328`) → `describeFace.ensure()` (`:385`), idle-only. The 6 rows each hold scopes created at boot (`bind` adds no read). The wallpaper row's `inject` runs `sync()` (`@local/dsh-wallpaper/lib/client.js:599`) which only recomputes and re-applies the CSS layer. |
| `models` | **`llm.providers` + `credentials.describe` on the FIRST mount only**; 0 on every later mount | `:1856` is guarded by `state.status === "idle"`, and the store is a module-lifetime `ModelsSettingsStore` constructed once at `apply()` (`:2742`). |
| `plugins` (section itself; active tab = `可配置`) | **0** | `ConfigurablePluginsTabController` is constructed at boot (`.../dsh-client-ui-settings-plugins/lib/client.js:1241`) and only calls `describeFace.ensure()` (`:944`). No `ctx.remote.*` or `host.call` anywhere in the section's render path. |
| `plugins` → tab `插件列表` | **1 × `pluginInventory.list`** on the tab's first mount | `.../dsh-client-ui-settings-plugin-inventory/lib/client.js:69-82` `useEffect(… , [list, request])` calling `list()`; `list` is `:279-283` `ctx.remote.pluginInventory.list()`. |

**No client cache for the inventory.** `list` is a fresh closure created in `apply()` (`:279`) and handed to
the tab through `injected = () => ({ list })` (`:284`); its identity is stable because entry-level inject
results are memoized per entry (`@deepseek-ai/dsh-client-ui-renderer/lib/client.js:396-403` `cachedRootInject`),
so the effect key `[list, request]` changes only on retry. The data lives in component state
(`const [state, setState] = useState({ status: "loading" })`, `:68`) and dies with the component.

**Therefore, clicking the 插件 nav item:**

* does **not** fire `pluginInventory.list` if 插件列表 has not been opened yet in this panel session
  (only the `configurable` panel exists; `rows[0]` is `configurable`, `.../dsh-client-ui-settings-plugins/lib/client.js:420`);
* does **not** re-fire it when toggling between 可配置 and 插件列表, because the `all` panel stays mounted
  with `hidden: true` (visited-id retention, `:489-499`);
* **does** fire a fresh `pluginInventory.list` after the whole plugins section was unmounted and re-entered
  (leaving to `general`/`models`/… unmounts it via `{ only: active }`,
  `.../dsh-client-ui-settings-general/lib/client.js:164`), because `visitedIds` and the tab state are
  component state that resets — the user must click 插件列表 again, which remounts the tab and re-runs the
  effect. **No preload, no cache.**

**Background re-reads that are not section mounts** (worth knowing because they inflate a trace):

```js
function refreshIfLoaded(controller) {
  if (controller.store.getSnapshot().status === "idle") return;
  controller.load();
}
```
`.../dsh-client-ui-settings-models/lib/client.js:2712-2715`, wired at `:2766-2775` to
`settings/document-updated`, `credentials/reference-updated`, `llm/adapters-updated`, `connection/reset`.
Once the Models section has been opened **once**, every settings document commit and every credential/adapter
event re-issues `llm.providers` + `credentials.describe` **even while the Models section is closed**.

Same for the mirror: `settings/document-updated` → `mirror.load()` → a fresh `settings.describe`
(`@deepseek-ai/dsh-client-ui-settings/lib/client.js:1343-1346`), and `bind()`ed scopes re-emit into their
subscribers — including the wallpaper's `scope.subscribe(sync)` (`@local/dsh-wallpaper/lib/client.js:582`).

---

## 6. Virtualization verdict: **nothing is virtualized**

No `react-window`, `react-virtual`, `VirtualList`, `virtualiz*`, `IntersectionObserver` or
`content-visibility` anywhere in the four settings packages (grep across
`dsh-client-ui-settings-plugins`, `dsh-client-ui-settings-plugin-inventory`, `dsh-client-ui-settings-models`,
`dsh-client-ui-settings-general` returns no match). The only `require()`s are
`react`, `react/jsx-runtime`, `@deepseek-ai/dsh-client-ui-primitives`,
`@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-runtime/client` (declared at the top of each
served bundle, e.g. `.../dsh-client-ui-settings-plugin-inventory/lib/client.js:7-9`).

Every list is a plain `.map(` over the whole array, followed by `<ul>`:

```js
// plugins → 可配置   (3 items)
children: namespaces.map((ns) => (0, react_jsx_runtime.jsx)(react.Fragment, { children: renderSlot("settings.plugin.item", {}, { entryKey: ns }) }, ns))
```
`@deepseek-ai/dsh-client-ui-settings-plugins/lib/client.js:403`

```js
// plugins → 插件列表  (177 items)
children: filteredEntries.map((entry) => { … })
```
`@deepseek-ai/dsh-client-ui-settings-plugin-inventory/lib/client.js:150`

```js
// models  (3 items)
children: configured.map((row) => {
```
`@deepseek-ai/dsh-client-ui-settings-models/lib/client.js:1909`

The only "cheapness" in the inventory is CSS: the list is a 2-column grid
(`.qSYn7G_cards{grid-template-columns:repeat(2,minmax(0,1fr))…}`,
`@deepseek-ai/dsh-client-ui-settings-plugin-inventory/lib/client.js:11`) and the scroll container is
`div.VOzbGW_options{flex:1;min-height:0;padding:0 24px 24px;overflow-y:auto}`
(`.../dsh-client-ui-settings-general/lib/client.js:28`). A plain `overflow-y:auto` container does **not**
reduce node count or layout cost; it only moves paint. So all 1250 nodes of the 插件 section are in the
DOM, laid out and hit-testable, and the hidden configurable panel's 24 nodes are additionally non-visible
but still real (`hidden: !selected`, `.../dsh-client-ui-settings-plugins/lib/client.js:496`).

**Section-presence matrix** (what the browser actually holds, per active nav item), 8 sections:

| active section | host elements in `div[data-slot="settings.section"]` | notes |
|---|---|---|
| `general` | ≈ 67–71 (+ panel chrome) | 6 rows, incl. wallpaper row |
| `models` | ≈ 34 | 3 provider rows |
| `plugins` (tab 可配置) | ≈ 30 | 3 cards |
| `plugins` (tab 插件列表) | ≈ 1250 | 177 cards + hidden 可配置 panel |
| `agent-presets` | `UNVERIFIED` (`.../dsh-client-ui-agent-preset/lib/client.js:1706-1713`; `AgentPresetSection` not quantified in this pass) | |
| `dsh-workspace-enhancement` | small; `machines.list` returned `machines: []` | 1 RPC on mount, `dsh-workspace-enhancement/lib/client.js:4570-4572` → `:4563` |
| `@local/dsh-ssh-gui` | ≈ 30 with `nodes: []` (55 `h("tag")` sites incl. a fixed 6-column table + tree; ~19 per node when non-empty) | **4 RPCs on mount**, see below |
| `@deepseek-ai/dsh-vision-adam` | ≈ 13 (`createElement` sites, `:84-192`) | |
| `@local/dsh-subagent-model` | ≈ 19 (`createElement` sites, `:118-294`) | |

### Out-of-premise but load-bearing: two extra sections fire RPCs on mount

```js
const refresh = async (silent) => {
  try {
    const [nodesValue, bindingsValue, configValue, portsValue] = await Promise.all([
      rpc(CH_SSH, "nodes.list", {}), rpc(CH_SSH, "keyref.list", {}),
      rpc(CH_SSH, "config.get", {}), rpc(CH_SSH, "serial.ports", {}),
    ]);
```
`@local/dsh-ssh-gui/lib/client.js:544-551`, with `const CH_SSH = "/ssh-gui";` (`:63`) and
`react.useEffect(() => { void refresh(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);`
(`:587`) — **four parallel RPCs on every mount** of the 分布式控制 section
(HTTP routes `POST /ssh-gui/<method>`, confirmed 200 for `serial.ports`).

```js
const refresh = async () => { … await rpc("machines.list") … };
(0, react.useEffect)(() => { refresh(); }, []);
```
`dsh-workspace-enhancement/lib/client.js:4561-4572` — one RPC per mount on the `/dsw` channel
(`POST /dsw/machines.list`, confirmed 200).

So a "switch between settings sections" loop that includes these two sections costs real network work, which
a three-section model would never predict.

---

## 7. H6 cross-reference — wallpaper trigger table

Source: `@local/dsh-wallpaper/lib/client.js` (served identically to disk;
`/plugins/@local/dsh-wallpaper/client.js?rev=826d9217a8fc`).

### Every code path that reaches `applyWallpaper`

| # | call site | user interaction that fires it | citation |
|---|---|---|---|
| T1 | `sync()` → `applyCurrent(ctx)` | plugin boot (once) | `:569-580` (`applyCurrent` at `:573`), invoked `:581` |
| T2 | `scope.subscribe(sync)` → `sync()` | **any** settings-scope change: the first `settings.describe` answer, every settings write, every `settings/document-updated` | `:582` |
| T3 | `settings.general.item` entry `inject` → `sync()` | first injection of the wallpaper row entry (once per entry identity; `cachedRootInject` memoizes) | `:591-602` (`sync()` at `:599`); memoization `@deepseek-ai/dsh-client-ui-renderer/lib/client.js:396-403` |
| T4 | `notifySettingsOpen(open)` | **General section entered / left** (see below) | `:517-522` |
| T5 | `commitField` optimistic mirror | every wallpaper control edit (file pick, URL apply, slider drag, override create/clear) | `:503-504` |
| T6 | `commitField` write-failure rollback | a failed settings write for the wallpaper namespace | `:508-510` |
| T7 | `sessions.list.subscribe(...)` | switching the current session | `:584-587` |
| T8 | `ctx.on("theme/change", …)` | theme switch (light/dark) | `:588` |

Mount/unmount of the row itself:

```js
// Settings-page signal (U12): this row mounts only while the settings
// modal's General section is open, so its mount/unmount is the page detector.
// Caveat (audit §3.5): switching to another settings section
// unmounts the row and falls back to session/home wallpaper.
React.useEffect(() => {
  notifySettingsOpen(true);
  return () => notifySettingsOpen(false);
}, []);
```
`@local/dsh-wallpaper/lib/client.js:396-403`

### (a) Does switching a settings section **AWAY** from General fire `applyWallpaper`? → **YES**

Leaving General unmounts `WallpaperRow` (only the active section renders:
`.../dsh-client-ui-settings-general/lib/client.js:164`), the cleanup at `:402` runs
`notifySettingsOpen(false)`, and the wrapper at `:518-521` does not short-circuit because
`pageState.settingsOpen` was `true`:

```js
notifySettingsOpen: (open) => {
  if (pageState.settingsOpen === open) return;   // :519 — guard
  pageState.settingsOpen = open;                 // :520
  applyCurrent(ctx);                             // :521 — fires
},
```

### (b) Does switching **TO** General fire one? → **YES**

Entering General mounts the row, the effect calls `notifySettingsOpen(true)` (`:401`), the same wrapper runs
`applyCurrent(ctx)` (`:521`).

### (c) Are the applied values byte-identical when there is no page override, and is there a content-skip guard?

**Config confirms the no-page-override case.** `/home/CNS2026495165/.dsh/settings.yaml:199-204` has only a
`global` key:

```yaml
wallpaper:
  global:
    source: /dsh-wallpaper/media/37758c1c-9ca8-47d2-bade-3048ab825fb6.png
    darkMask: 0
    opacity: 0.88
    blur: 0
```

There is **no `pages:` key**, so:

```js
function normalizePages(value) {
  const pages = {};
  if (value === null || typeof value !== "object") return pages;   // → {} for undefined
  for (const page of PAGES) { … }
  return pages;
}
/** resolveOverride(page) = pages[page] ?? global (audit §5.2 / U6). */
function resolveOverride(value, page) {
  const pages = normalizePages(value?.pages);
  return pages[page] ?? normalizePage(value?.global);              // always the global branch here
}
```
`@local/dsh-wallpaper/lib/client.js:100-112`

`normalizePages(undefined)` → `{}` ⇒ `pages[page]` is `undefined` for **every** page key, so
`resolveOverride` returns `normalizePage(value?.global)` regardless of whether `currentPage()` is
`"settings"` (`:345`), `"home"` or `"session"` (`:346`). The four fields
(`source`, `darkMask: 0`, `opacity: 0.88`, `blur: 0`) are therefore **byte-identical** across the
General↔other transition. Only the object identity differs (`normalizePage` builds a fresh object each call).

**Content-skip guard in that path: NONE.** `applyWallpaper` writes unconditionally:

```js
function applyWallpaper(ctx, config) {
  if (config.source === null) { … return; }
  ensureWallpaperCss();
  if (wallpaperEl === null || !document.body.contains(wallpaperEl)) { … }
  wallpaperEl.style.backgroundImage = `url("${config.source}")`;   // :255 — no equality check
  const blur = clampNumber(config.blur, 0, 60, 0);
  wallpaperEl.style.filter = blur > 0 ? `blur(${blur}px)` : "none"; // :257 — writes "none" again
  const darkMask = clampNumber(config.darkMask, 0, 1, 0);
  if (darkMask > 0) { ensureMaskElement(); … } else { releaseMaskElement(); }
  shadeTokens(ctx, clampNumber(config.opacity, 0, 1, DEFAULT_GLOBAL.opacity));
}
```
`@local/dsh-wallpaper/lib/client.js:238-266`

The only two guards anywhere in the apply path are elsewhere and neither short-circuits the DOM writes:

```js
function ensureWallpaperCss() {
  if (cssEl !== null && document.head.contains(cssEl)) return;     // :139 — CSS tag only
```
```js
// The source and this layer are rebuilt byte-identically on every theme change;
// re-stacking identical content only re-enters every theme/change listener, so
// the existing layer is kept and its redundant publish is skipped.
if (sameShadedTokens(shadedTokens, next)) return;                  // :204 — token publish only
```
`@local/dsh-wallpaper/lib/client.js:138-139` and `:190-211`

So per General↔other transition the browser performs, on a **full-viewport** element, a `background-image`
(incl. `url(...)`) style write plus a `filter` write, an `ensureMaskElement`/`releaseMaskElement` call
(a no-op here because `darkMask === 0` ⇒ `releaseMaskElement()` on a `null` element, `:216-219`), and a
`shadeTokens` call that returns at `:204` — i.e. **two full-viewport style invalidations per section switch,
with identical values and no skip.** Whether Blink re-decodes the bitmap for an identical
`background-image` string is a **browser** question and is `UNVERIFIED` here (no browser may be launched);
the style/compositing invalidation itself is unconditional in the code.

**Bonus (bounded) loop risk, quantified.** `shadeTokens` → `ctx.theme.overrideTokens(...)` (`:207`) →
`ThemeService.overrideTokens` calls `this.publish()` (`.../dsh-client-ui-theme/lib/client.js:1224-1233`) →
`this.ctx.emit("theme/change", this.snapshot)` (`:1264-1267`) → T8 → `applyCurrent` → `applyWallpaper`
again. It terminates after exactly **one** extra pass: the nested `shadeTokens` returns immediately at
`:191` (`if (shading) return;`, set at `:192`), and every later call returns at `:204` because
`shadedTokens` was already assigned at `:205` before the publish at `:207`. Net effect: the **first**
applyWallpaper after a token change costs **2** applyWallpaper passes; steady-state section switches cost 1.

---

## 8. Mask CSS, wallpaper layer, and painted-area ratio

### Exact values

```css
.VOzbGW_overlay{ z-index:1000; justify-content:center; align-items:center; display:flex; position:fixed; inset:0 }
.VOzbGW_mask   { background:var(--dsw-alias-bg-mask-1); backdrop-filter:var(--dsw-mask-blur); position:absolute; inset:0 }
.VOzbGW_panel  { z-index:1; background:var(--dsw-alias-bg-layer-2); width:800px;
                 max-width:calc(100vw - 48px); height:min(800px,100vh - 48px); … }
.VOzbGW_options{ flex:1; min-height:0; padding:0 24px 24px; overflow-y:auto }
```
`@deepseek-ai/dsh-client-ui-settings-general/lib/client.js:28` (the whole `VOzbGW_*` stylesheet is one string
literal; keys mapped at `:44`).

Resolved tokens:

| token | value | source |
|---|---|---|
| `--dsw-alias-bg-mask-1` | `#0000003d` (light) / `#00000080` (`body[data-ds-dark-theme]`) | `.../dsh-client-ui-theme/lib/client.js:124` (`design_platform_css_default`) |
| `--dsw-mask-blur` | `blur(2px)` | `.../dsh-client-ui-theme/lib/client.js:130` (`gradient_shadow_text_css_default`) |

So the mask is `background: #0000003d; backdrop-filter: blur(2px)` (light theme) —
a **full-viewport** `backdrop-filter`, which forces the compositor to render the backdrop into a texture and
run a 2 px blur over the entire surface every raster.

Wallpaper layer element properties (created imperatively, not from a stylesheet):

```js
element.style.cssText = "position:fixed;inset:0;z-index:-1;pointer-events:none;width:100%;height:100%;" +
                        "background-size:cover;background-position:center;background-repeat:no-repeat;";
document.body.prepend(element);
```
`@local/dsh-wallpaper/lib/client.js:220-225`. Dark mask layer (only when `darkMask > 0`; here `0`, so absent):
`position:fixed;inset:0;z-index:-1;pointer-events:none;width:100%;height:100%` (`:228-236`).

Plus a whole-UI translucent token layer: `shadeTokens` overrides
`--dsw-alias-bg-base: {light: rgba(<base>,0.88), dark: rgba(<base>,0.88)}`
(`@local/dsh-wallpaper/lib/client.js:190-207`, opacity `0.88` from `settings.yaml:203`), which makes every
app surface see through to the wallpaper — another full-viewport blend on every repaint.

### Area ratio (panel 800×800 CSS px, viewport 1440×900)

| surface | geometry | area (px²) |
|---|---|---|
| viewport / overlay (`position:fixed;inset:0`) | 1440 × 900 | 1 296 000 |
| wallpaper layer (`position:fixed;inset:0;width:100%;height:100%`) | 1440 × 900 | 1 296 000 |
| backdrop-filter mask (`.VOzbGW_mask`, `inset:0` inside the overlay) | 1440 × 900 | 1 296 000 |
| panel (`width:800px`; `height:min(800px, 900 − 48)` = 800) | 800 × 800 | 640 000 |

* **(wallpaper + mask) / panel = 2 592 000 / 640 000 = 4.05**
* mask / panel = 2.025
* wallpaper / panel = 2.025
* viewport / panel = 2.025

i.e. **4.05 × the panel's area is painted for a modal whose visible content occupies one panel**, and
1.62 × the panel's area is painted *outside* the panel (the visible dimmed ring).
The mask and the wallpaper are both siblings/ancestors of the panel, so the panel's opaque
`--dsw-alias-bg-layer-2` background does **not** excuse the mask's blur work — the blur is computed for the
full 1 296 000 px² before the panel is composited on top.

---

## 9. UNVERIFIED items (explicit)

| item | why |
|---|---|
| Exact DOM totals (as opposed to host-element sites) | Child components (`Menu`, `PresetMenu`, `Icon`, `Modal`, `ProviderEditor`, `RiskConfirmation`, `Slider` internals) live in the prebuilt `dsh-web-frontend/dist/assets/index-ClqxG24t.js` bundle and were not expanded; no browser may be launched to measure. Counts are lower bounds. |
| `agent-presets` section DOM size | Its `AgentPresetSection` component was not quantified in this pass (`@deepseek-ai/dsh-client-ui-agent-preset/lib/client.js:1706-1713`). |
| Whether `Modal` renders nothing when `open:false` | Primitive internals not inspected; assumed null in the `models` count. |
| The provenance of the reported `149 SVG` | Code arithmetic says `N_cards + 1`; today's `N_cards = 177` ⇒ 178. `149 = 148 + 1` implies 148 entries at measurement time, which cannot be reproduced (the RPC is stable at 177 across two calls, and the loader tree has no history endpoint I may read). |
| Whether Blink re-decodes an identical `background-image` string | Browser behaviour; out of scope for a static pass, and no browser may be launched. |
| Actual event-loop / layout timings | Not derivable statically; this document only supplies the independent expectation for the browser measurement. |
