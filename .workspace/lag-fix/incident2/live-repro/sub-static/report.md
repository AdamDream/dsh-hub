# Static forensics — served-vs-disk-vs-rev verification and in-page fix markers

**Scope:** read-only static forensics on the live GUI at `http://127.0.0.1:3080/`.
No browser was launched. No product file was modified. No sandbox escalation was used.
All artifacts were written under `sub-static/` only.

- **Generated:** 2026-09-22T02:13:41Z (2026-09-22 10:13:41 +0800)
- **Server process:** PID 10806 — `node /home/CNS2026495165/.npm-global/bin/dsh web`
- **Machine-readable twin:** `sub-static/forensics.json`

---

## 0. Headline: PASS 4/4

| # | package | disk sha1-12 | served sha1-12 | rev in HTML | bytes | verdict |
|---|---------|--------------|----------------|-------------|-------|---------|
| 1 | `@deepseek-ai/dsh-client-ui-layout` | `82cca1a6178a` | `82cca1a6178a` | `82cca1a6178a` | 24988 | **PASS** |
| 2 | `@local/dsh-wallpaper` | `826d9217a8fc` | `826d9217a8fc` | `826d9217a8fc` | 31803 | **PASS** |
| 3 | `@deepseek-ai/dsh-client-runtime` | `5559de4ce28c` | `5559de4ce28c` | `5559de4ce28c` | 398569 | **PASS** |
| 4 | `@local/dsh-usage` | `4536b91ed282` | `4536b91ed282` | `4536b91ed282` | 72804 | **PASS** |

`served bytes == disk bytes == rev in HTML` holds for all four, and all four revs match the
revs stated in the task. Every marker string below is **present in the deployed file and in
the served bytes, and absent from the pre-image** — no package needed a "no good marker"
admission.

---

## 1. A — Disk hash, served bytes, and HTML rev

### 1.1 Disk

```
82cca1a6178a  24988  /home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js
826d9217a8fc  31803  /home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-wallpaper/lib/client.js
5559de4ce28c  398569 /home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js
4536b91ed282  72804  /home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib/client.js
```

These reproduce the revs stated in the task exactly.

> **Symlink finding (D1).** The `ui-layout` and `client-runtime` paths under
> `.dsh/profiles/node_modules/` are **symlinks**, not real files:
> ```
> @deepseek-ai/dsh-client-ui-layout -> /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-layout
> @deepseek-ai/dsh-client-runtime   -> /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime
> ```
> `@local/dsh-wallpaper` and `@local/dsh-usage` are real directories. No hash impact —
> symlink and target are the same inode, and the `.npm-global` runtime copy is byte-identical
> (`5559de4ce28c`, 398569 bytes, 4× `p2ac-fix`). This also explains why a recursive grep over
> `profiles/node_modules` **without `-L`** silently skips those two packages.

### 1.2 Served over HTTP

Each bundle was fetched to `sub-static/curl/<pkg>.js`, then hashed:

```
$ curl -s -o curl/_local_dsh-wallpaper.js \
    "http://127.0.0.1:3080/plugins/@local/dsh-wallpaper/client.js?rev=826d9217a8fc"
$ sha1sum curl/_local_dsh-wallpaper.js
826d9217a8fc…   (31803 bytes, HTTP 200)
```

All four returned **HTTP 200**, byte counts equal to disk, sha1-12 equal to disk.
Cross-check: `cmp` against the independent earlier captures in
`incident2/live-repro/raw/served-<pkg>.js` is **byte-identical for all four**.

### 1.3 Rev embedded in the served HTML

```
curl -s http://127.0.0.1:3080/ > sub-static/http/index.html     # 16611 bytes, HTTP 200
grep -o '/plugins/[^"]*client\.js?rev=[0-9a-f]*' http/index.html
```

Extracted lines (note: `client-runtime` appears **twice** in the HTML, both with the same rev):

```
/plugins/@deepseek-ai/dsh-client-runtime/client.js?rev=5559de4ce28c      (×2)
/plugins/@deepseek-ai/dsh-client-ui-layout/client.js?rev=82cca1a6178a
/plugins/@local/dsh-wallpaper/client.js?rev=826d9217a8fc
/plugins/@local/dsh-usage/client.js?rev=4536b91ed282
```

All four revs equal the corresponding disk sha1-12. **PASS.**

### 1.4 HTTP cache behaviour (relevant to "stale cached copy")

All four responses carry `cache-control: no-cache` — no `ETag`, no `immutable`, no `max-age`.

> **Finding (D3):** the server **ignores `?rev=` for content selection**. Requesting
> `…/dsh-wallpaper/client.js?rev=deadbeef0000` returned **HTTP 200 with the identical 31803 bytes**.
> The rev is a browser cache-buster only, not a server-side content pin. So staleness is not
> prevented by the rev string; it is prevented by `no-cache` forcing revalidation. Right now the
> served bytes *are* the fixed bytes, so there is no stale-content risk at the HTTP layer — but a
> browser tab could still hold a previously-executed module in memory until reload, which is
> exactly what the section-B markers detect.

---

## 2. B — Robust, unique, in-page-detectable markers

### 2.0 Minification audit (the task's caveat did **not** materialise)

The task warned that some deployed files are readable while some pre-images are minified.
I measured it. **All eight files are readable/babel-ish; none is minified**, so identifier-name
comparison is sound for *every* package here. I still supply a string/comment marker for each
package as a mangling-proof fallback.

| file | role | max line len | `function ` decls | minified? |
|------|------|--------------|-------------------|-----------|
| layout | deployed | 2015 | 13 | no |
| layout | pre-image | 2015 | 9 | no |
| wallpaper | deployed | 294 | 29 | no |
| wallpaper | pre-image | 294 | 28 | no |
| runtime | deployed | 646 | 270 | no |
| runtime | pre-image | 646 | 270 | no |
| usage | deployed | 5866 | 34 | no |
| usage | pre-image | 5866 | 34 | no |

(The large maxima for layout/usage are single long JSX/`className` literals, not minified code —
doc comments, Chinese audit comments and full identifier names are intact throughout.)

### 2.1 `@deepseek-ai/dsh-client-ui-layout` — marker `scheduleThemeColorRefresh`

- **Kind:** identifier (bundle is not minified → reliable)
- **Occurrences in deployed: 3** · **Occurrences in pre-image: 0** · unique across the whole profile
- **Pre-image:** `exec-theme/backup/20260921092148./layout.preimage.js` (sha1 `abdb7f55acba`, 19364 bytes)

> **Your "7 hits" claim — VERIFIED as genuine markers, count CORRECTED.**
> `scheduleThemeColorRefresh` = **3** hits and `lastSignature` = **4** hits; **7 is the combined
> count** (3+4, and also 7 matching lines under `grep -E`). Neither individually has 7. Both are
> real fix additions — neither string occurs anywhere in the pre-image.

```
356-		 * @param win - the window the presenter writes into.
357-		 * @param presenter - the presenter to refresh.
358-		 */
359:		function scheduleThemeColorRefresh(win, presenter) {
360-			const winRef = win ?? globalThis;
361-			const request = winRef.requestAnimationFrame;
362-			if (typeof request !== "function") {
363-				presenter.refreshThemeColor();
```

Call site in `apply()` — the point where the forced recalculation is deferred:

```
446-				 * after all writers are done, while still observing the state this apply
447-				 * wrote. When the host cannot schedule frames it runs inline.
448-				 */
449-				this.pendingTokenSignature = tokenSignature(entries);
450:				scheduleThemeColorRefresh(this.themeColorMeta.ownerDocument?.defaultView, this);
```

Supporting marker, the skip test itself:

```
355-			/** Token names the previous apply wrote; the profile an unchanged snapshot must still satisfy. */
356-			lastTokens = [];
357-			/** Content signature of the last applied snapshot, or undefined before the first apply. */
358:			lastSignature;
```

| alternate marker | kind | deployed | pre-image |
|---|---|---|---|
| `themeColorRefreshQueue` | identifier | 4 | 0 |
| `landingIntact` | identifier | 2 | 0 |
| `Provably idempotent replay` | comment text | 1 | 0 |

Recommended pick: **`landingIntact`** (2 hits) or **`themeColorRefreshQueue`** (4 hits) if you want
a token that cannot plausibly collide with unrelated code — `lastSignature` is a slightly generic
name by comparison, though it *is* absent from the pre-image.

### 2.2 `@local/dsh-wallpaper` — marker `sameShadedTokens`

- **Kind:** identifier (bundle is not minified)
- **Occurrences in deployed: 2** · **Occurrences in pre-image: 0** · unique across the whole profile
- **Pre-image:** `exec-theme/backup/20260921092148./wallpaper.preimage.js` (sha1 `fb28faf9db9a`, 31079 bytes)

```
178-    }
179-    // Content of the override layer shadeTokens last handed to ui-theme.
180-    let shadedTokens;
181:    function sameShadedTokens(left, right) {
182-      if (left === void 0) return false;
183-      return left["--dsw-alias-bg-base"].light === right["--dsw-alias-bg-base"].light &&
184-        left["--dsw-alias-bg-base"].dark === right["--dsw-alias-bg-base"].dark;
185-    }
```

Call site — the early return that skips the redundant re-stack:

```
201-        // The source and this layer are rebuilt byte-identically on every theme change;
202-        // re-stacking identical content only re-enters every theme/change listener, so
203-        // the existing layer is kept and its redundant publish is skipped.
204:        if (sameShadedTokens(shadedTokens, next)) return;
205-        shadedTokens = next;
206-        overrideDispose?.();
207-        overrideDispose = ctx.theme.overrideTokens(OVERRIDE_SOURCE, next);
```

| alternate marker | kind | deployed | pre-image |
|---|---|---|---|
| `shadedTokens` | identifier | 3 | 0 |
| `rebuilt byte-identically on every theme change` | comment text | 1 | 0 |

Negative control: `shading = true` is present **1× in both** files — confirming the diff is scoped
to the fix rather than a wholesale file swap.

### 2.3 `@deepseek-ai/dsh-client-runtime` — marker `p2ac-fix`

- **Kind:** comment text (literal) — this is the *intended* marker; `exec-p2/preimage/20260921-165510/META.txt` declares `marker=/* p2ac-fix */`
- **Occurrences in deployed: 4** · **Occurrences in pre-image: 0** · unique across the whole profile
- **Pre-image:** `exec-p2/preimage/20260921-165510/client.js` (sha1 `a0fb4bb225d3`, 397957 bytes, sha256 `d71a8ca524307aa35b74c5504ce396458cd6cdd38bd2759be8e16bd1b783d69b`, matching `META.txt`'s `pre_sha256`; `CANONICAL.txt` names this stamp)

All four `p2ac-fix` sites:

```
9293-				}
9294:				const chainRowIds = new Set(); /* p2ac-fix */
9295-				if (current !== void 0 && currentAddress !== void 0) {
9296-					const seen = /* @__PURE__ */ new Set();
...
9301:						chainRowIds.add(childId); /* p2ac-fix */
...
9328:					/* p2ac-fix */ /* address-chain scoped carry-forward: only ids a visited chain step genuinely needs. */
9329-					for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0 && chainRowIds.has(id)) byId[id] = previousProjection.byId[id];
...
9342:				/* p2ac-fix */ /* key-set gate: reusing the whole previous byId object is only sound when its key set has no extra key. */
9344-				const reusableByIdKeys = previousProjection !== void 0 ? Object.keys(previousProjection.byId) : void 0;
9345-				const nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length && reusableByIdKeys.length === liveKeys.length && reusableByIdKeys.every((id) => Object.prototype.hasOwnProperty.call(byId, id)) ? previousProjection.byId : stableById;
```

| alternate marker | kind | deployed | pre-image |
|---|---|---|---|
| `chainRowIds` | identifier | 3 | 0 |
| `reusableByIdKeys` | identifier | 3 | 0 |
| `address-chain scoped carry-forward` | comment text | 1 | 0 |

**Trap avoided:** the runtime file also contains `/* dsh-perf-fix P2 v1 */`, which appears
**2× in both** deployed and pre-image — it is an *earlier* fix, **not** a usable discriminator.
Only `p2ac-fix` distinguishes this patch. Flagging it because it is exactly the kind of
misleading candidate the task warned about.

### 2.4 `@local/dsh-usage` — marker `dsh-perf-fix R4 v1`

- **Kind:** comment text (literal)
- **Occurrences in deployed: 1** · **Occurrences in pre-image: 0**
- **Pre-image:** `backup/R4-20260921-115821/deployed/client.js` (sha1 `cc6c7fb56693`, 71490 bytes, sha256 `eeb5dcf2f4bd638bdbab44fe249f24f2742a660db6aa4deb4532489a71031cc3` — exactly the value in `backup/R4-20260921-115821/SHA256SUMS`)

```
834-			const [sessionTo, setSessionTo] = react.useState("");
835-			const rpcAvailable = rpc && typeof rpc.call === "function";
836-			const loadAllRef = react.useRef(null);
837:			/* dsh-perf-fix R4 v1: 旧响应/卸载保护。RPC 不假设可取消：用单调代次 + alive
838-			   标志丢弃过期响应；setup 重新置 alive 以兼容 StrictMode 的 setup→cleanup→setup
839-			   与真实 remount；cleanup 递增代次，使上一轮在飞请求在重挂载后也无法复活。 */
840-			const aliveRef = react.useRef(true);
841-			const allGenerationRef = react.useRef(0);
842-			const sessionsGenerationRef = react.useRef(0);
843-			const statusGenerationRef = react.useRef(0);
844-			react.useEffect(() => {
845-				aliveRef.current = true;
```

The gate that proves this is live code, not a comment:

```
888-			const loadAll = react.useCallback(async () => {
889:				const generation = ++allGenerationRef.current;
890-				const current = () => aliveRef.current && generation === allGenerationRef.current;
```

| alternate marker | kind | deployed | pre-image |
|---|---|---|---|
| `aliveRef` | identifier | 6 | 0 |
| `allGenerationRef` | identifier | 4 | 0 |
| `sessionsGenerationRef` | identifier | 4 | 0 |
| `statusGenerationRef` | identifier | 4 | 0 |

Note: `dsh-perf-fix R4 v1` also appears in `@local/dsh-usage/lib/index.js` (the **host** half).
That is irrelevant to a check of the *client bundle* URL, but worth knowing if you ever grep the
whole package. `allGenerationRef` is unique to the client bundle.

Negative control: `loadAllRef` is present **2× in both** files.

### 2.5 Pre-image identity — why these are the *immediate* BEFORE

This mattered enough to verify cryptographically, because a stale earlier generation would make
the marker counts meaningless.

| package | pre-image path | sha1-12 | pairing evidence |
|---|---|---|---|
| ui-layout | `exec-theme/backup/20260921092148./layout.preimage.js` | `abdb7f55acba` | `layout.meta.json`: `preImageMd5` = md5(pre-image) = `af19ea709a1556b8c48bedfa8b31e785`; `postImageMd5` = md5(**currently deployed file**) = `684622de7914eaae058985fbeca09076` |
| wallpaper | `exec-theme/backup/20260921092148./wallpaper.preimage.js` | `fb28faf9db9a` | `wallpaper.meta.json`: `preImageMd5` = `b9cd4747f91084065d1227fba5aa7e61`; `postImageMd5` = deployed md5 `885bde89e33c33fec4ef399ba00e907c` |
| runtime | `exec-p2/preimage/20260921-165510/client.js` | `a0fb4bb225d3` | sha256 matches `META.txt` `pre_sha256`; sibling `exec-p2/candidate/client.js` sha1 == deployed sha1 |
| usage | `backup/R4-20260921-115821/deployed/client.js` | `cc6c7fb56693` | sha256 matches `SHA256SUMS`; duplicate `backup/R4-deployed-20260921063032./pre-client.js` |

Both md5 pairs match **exactly**, so the layout/wallpaper pre-images are the true immediate BEFORE,
not an earlier generation. (The `092148` in the stamp folder name is **UTC**; the local mtime is
`17:21:48 +0800` — consistent, not a discrepancy.)

Corroborating independent copies: `research-v2/root-subscriptions/raw/plugins/_deepseek-ai_dsh-client-ui-layout.js`
and `…_local_dsh-wallpaper.js` are byte-identical to the two exec-theme pre-images.

---

## 3. C — What each fix does

**`@deepseek-ai/dsh-client-ui-layout` — theme replay skipping + rAF-coalesced refresh.**
`ThemePresenter.apply()` now derives a *content-only* signature (color scheme plus an
order-independent digest of the token pairs) and returns early when it equals the last applied
signature **and** `landingIntact()` proves the document still holds exactly that state — so
provably-idempotent snapshot replays no longer rewrite every CSS variable. Separately, the
`getComputedStyle(body).backgroundColor` read (which forces a synchronous document-wide style
recalculation) is moved out of the synchronous publish dispatch into a `requestAnimationFrame`
callback, merging a whole dispatch round and all concurrent presenters into **one** read, with an
inline fallback when the host cannot schedule frames.

**`@local/dsh-wallpaper` — wallpaper content comparison.**
The `overrideTokens` payload is built into a local `next` object and compared field-by-field
against the tokens last handed to ui-theme (`shadedTokens` / `sameShadedTokens`). Because the
shading layer is rebuilt byte-identically on every theme change, the old code disposed and
re-registered it each time, re-entering every theme/change listener; the fix returns early,
keeping the existing layer and skipping the redundant publish.

**`@deepseek-ai/dsh-client-runtime` — P2-AC carry-forward narrowing + key-set gate.**
The previous subagent-projection's extra `byId` rows are now carried forward only for ids a
visited address-chain step genuinely needs (`chainRowIds`), rather than every extra key; and
whole-object reuse of the previous `byId` is only taken when the previous key set has exactly the
live key-set length and every live key is present (`reusableByIdKeys`). This stops stale subagent
rows from being resurrected and removes an unsound identity reuse that left the projection
inconsistent.

**`@local/dsh-usage` — R4 stale-response / unmount lifecycle hardening.**
A monotonic per-loader generation counter plus an `aliveRef` unmount flag are added, and every RPC
completion is gated by `current() = aliveRef.current && generation === <loader>GenerationRef.current`.
Responses from a superseded request round, and any response landing after unmount/remount, are
discarded instead of calling `setState`. Setup re-arms `aliveRef` (safe for StrictMode
`setup → cleanup → setup`), and cleanup bumps all three generations so an in-flight request from a
previous mount can never resurrect state.

---

## 4. D — Discrepancies (reported honestly; nothing invented)

| id | severity | finding |
|----|----------|---------|
| **D1** | info | Two of the four "disk paths" are **symlinks** into `.npm-global`, not real files (layout, runtime). Same inode as target; runtime has two byte-identical fixed copies. Explains `META.txt` naming the `.npm-global` target, and why `grep -r` without `-L` skips those packages. |
| **D2** | info | **Count correction for ui-layout:** `scheduleThemeColorRefresh` = 3 hits, `lastSignature` = 4 hits; the task's "7" is the *combined* count. Both verified as genuine markers (0 hits in pre-image). |
| **D3** | info | `?rev=` is a browser cache-buster only — the server ignores it (`?rev=deadbeef0000` → HTTP 200, identical bytes). All bundles ship `cache-control: no-cache`, no `ETag`/`immutable`. |
| **D4** | info | **No usage client pre-image under `r4-delivery/backup-pre/`** — that directory holds only `index.js` (sha1 `b85853ef32e7`, 8082 bytes). The correct pre-image is under `backup/R4-*`. *Resolved:* evidence is complete, just located elsewhere. |
| **D5** | info | **Two generations of usage pre-image exist.** The 2026-09-20 original is `backup-usage/deployed/backup-20260920-154018/client.js` (`30ea5722bcd8`, 66967 bytes); the immediate R4 BEFORE is `cc6c7fb56693` (71490 bytes). Diffing against the older file yields 6 hunks instead of the correct 4. **Use `cc6c7fb56693`.** Baseline stability is proven: the file's sha256 was unchanged from 2026-09-20 15:40 until the R4 apply. |
| **D6** | none | No hash mismatch, no rev mismatch, no unreadable file. All four pre-images are readable and non-minified; no file required escalation; no product file was modified. |

No missing pre-image blocks the analysis: all four packages have a cryptographically-paired
pre-image and at least one marker with **0 occurrences in the pre-image**.

---

## 5. Ready-to-paste in-page check

Open the GUI (`http://127.0.0.1:3080/`), open devtools, paste this into the console. It fetches the
exact deployed bundle URLs from the page's own origin, bypassing HTTP cache, and asserts that every
marker string is present. Treat each `pass: true` row as "the page is running the fixed code".

```js
(async () => {
  const REVS = {
    '@deepseek-ai/dsh-client-ui-layout': '82cca1a6178a',
    '@local/dsh-wallpaper':              '826d9217a8fc',
    '@deepseek-ai/dsh-client-runtime':   '5559de4ce28c',
    '@local/dsh-usage':                  '4536b91ed282',
  };
  // [package, [marker strings that MUST be present in the fixed bundle]]
  const CHECKS = [
    ['@deepseek-ai/dsh-client-ui-layout',
      ['scheduleThemeColorRefresh', 'landingIntact', 'themeColorRefreshQueue', 'lastSignature']],
    ['@local/dsh-wallpaper',
      ['sameShadedTokens', 'shadedTokens']],
    ['@deepseek-ai/dsh-client-runtime',
      ['p2ac-fix', 'chainRowIds', 'reusableByIdKeys']],
    ['@local/dsh-usage',
      ['dsh-perf-fix R4 v1', 'aliveRef', 'allGenerationRef']],
  ];

  const rows = [];
  for (const [pkg, markers] of CHECKS) {
    const url = `/plugins/${pkg}/client.js?rev=${REVS[pkg]}`;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const txt = await res.text();
      const hits = Object.fromEntries(
        markers.map((m) => [m, txt.split(m).length - 1])
      );
      rows.push({
        pkg,
        http: res.status,
        bytes: txt.length,               // markers are ASCII => chars == bytes
        missing: markers.filter((m) => hits[m] === 0),
        hits,
        pass: res.ok && markers.every((m) => hits[m] > 0),
      });
    } catch (e) {
      rows.push({ pkg, http: 'ERR', pass: false, error: String(e) });
    }
  }
  console.table(rows.map(({ pkg, http, bytes, pass, missing }) =>
    ({ pkg, http, bytes, pass, missing: (missing || []).join(',') })));
  console.log(rows);
  console.log(rows.every((r) => r.pass)
    ? 'ALL FOUR PACKAGES: fixed code is being served ✔'
    : 'FAILURE — see rows with pass:false');
  return rows;
})()
```

Expected result: four `pass: true` rows; bytes `24988 / 31803 / 398569 / 72804`; every `missing`
column empty.

**Cross-check that the four packages are actually *registered/executed*, not merely fetchable:**
`window.__ModuleLoader__` is the loader namespace each bundle calls `load({ id, factory })` on.
Confirm the four ids are present in the loaded set, e.g.:

```js
// The bundles all call window.__ModuleLoader__.load({ id: "<pkg>", ... }).
// If your build records loaded module ids, assert they contain the four package names:
Object.keys(window.__ModuleLoader__ ?? {});
```

**A note on the negative control.** You might expect fetching the *pre-image* rev
(`?rev=abdb7f55acba`) to return the old code. It will not: per finding D3 the server ignores
`?rev=` and always serves the current on-disk file. If that fetch returns `scheduleThemeColorRefresh`,
that is **not** a contradiction — it independently confirms the server serves current disk content
rather than a rev-pinned historical copy.

---

## 6. Evidence files

| file | contents |
|------|----------|
| `forensics.json` | machine-readable twin of this report (validated JSON) |
| `report.md` | this report |
| `http/index.html` | served GUI HTML (16611 bytes) used for rev extraction |
| `curl/_deepseek-ai_dsh-client-ui-layout.js` | served bytes, 24988 |
| `curl/_local_dsh-wallpaper.js` | served bytes, 31803 |
| `curl/_deepseek-ai_dsh-client-runtime.js` | served bytes, 398569 |
| `curl/_local_dsh-usage.js` | served bytes, 72804 |
| `runtime.diff` | pre-image vs deployed unified diff (3 hunks, all `p2ac-fix`) |
| `usage.diff` | pre-image vs deployed unified diff (4 hunks, all R4) |
