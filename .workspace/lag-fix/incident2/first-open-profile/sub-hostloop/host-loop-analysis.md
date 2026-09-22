# Host main-thread 100% + `session.list` stall — root-cause analysis (incident2 / sub-hostloop)

- Host under test: PID **10806** = `node /home/CNS2026495165/.npm-global/bin/dsh web` (http://127.0.0.1:3080)
- Method: **read-only**. No signal was ever sent to PID 10806, no file outside this outdir was written, no GUI action, no browser.
- Deployed code root (the **actually loaded** install, not the profile copy):
  `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`
- Session window: 2026-09-22 10:33:05 → 10:38:20 (+08:00)

> Note on measurement conditions: a peer session was running its own probes concurrently during this window, so live-session event emission (and therefore the write rate below) fluctuates. That fluctuation is itself part of the evidence.

---

## 0. Executive summary

Two **distinct** facts, often conflated:

| # | Fact | Measured | Cause |
|---|---|---|---|
| **A** | Main thread burns 43–111 % of one core **continuously even with no HTTP request in flight** | user 21–38 % + **sys 21–27 %** baseline, peaks 55 % user + 45 % sys | **Write amplification**: every session-projection checkpoint re-serializes and rewrites the **entire 9.86 MB** `session_projcache.json` (2670 records × 10 rows). At active-session write-behind rates that is ~1–10 full-document rewrites/s ⇒ ~58 ms CPU each. |
| **B** | `session.list` tail latency 0.6 s … **20.9 s** | 15 s timeout (0 B), 20.89 s, 3.10 s, 7.72 s, 0.70 s, 0.60 s, 0.78 s | **B1 patch recomputation**: `attachedSubagents.sort()` comparator folds each session's **full event array twice per comparison** (O(2·m·log m·E) event visits, no memoization) + each attached session re-folded by `summarize` (and again in the cold walk), then 16-item awaited batches paid on an already-saturated loop. |

`session.list` is **not** an infinite loop and **not** a deadlock: `wchan` = `0` (state `R`, executing), and it **does** complete. The B1 `runningSubagentCount` aggregate that the brief suspected is **provably terminating** — see §4. Verdict: **(a) reproducible product defect**, amplified by state scale, with corrupt data **ruled out** (§5).

---

## 1. Repro of the live symptom

### 1.1 The 20 s stall reproduces, but the endpoint *does* complete

```
$ date -Is; timeout 15 curl -s -o /tmp/o_sessionlist -w 'session.list: HTTP %{http_code} %{time_total}s %{size_download}B\n' \
    -X POST http://127.0.0.1:3080/api/session.list -H 'content-type: application/json' \
    -d '{"type":"client-request","rpcId":"z2","method":"session.list","payload":{}}'
=== T0 2026-09-22T10:33:21+08:00 ===
exit=124 2026-09-22T10:33:36+08:00        <-- curl killed at 15 s, ZERO bytes, no headers
$ ls -la /tmp/o_sessionlist
(nothing; file never created)             <-- [exit code: 2]
```

Same request with a 60 s budget — **it succeeds**:

```
START 60s test 2026-09-22T10:34:39+08:00
session.list60: HTTP 200 20.886307s 496193B
exit=0 END 2026-09-22T10:35:00+08:00
```

Repeated series (identical request body):

```
--- call 1 2026-09-22T10:37:14+08:00   session.list: HTTP 200 7.718161s 495944B
--- call 2 2026-09-22T10:37:22+08:00   session.list: HTTP 200 0.700141s 495944B
--- call 3 2026-09-22T10:37:22+08:00   session.list: HTTP 200 0.602899s 495944B
--- call 4 2026-09-22T10:37:23+08:00   session.list: HTTP 200 0.784957s 495944B
```

And once more during the concurrency test: `SL: HTTP 200 3.100109s 495944B`.

**Answer to "does it ever complete if you wait longer": YES.** Latency is 0.60 s – 20.89 s for the *same* 495,944–496,193 B response (299 items, byte-stable). Not a hang, a **tail-latency explosion**.

### 1.2 Control endpoints are fast — and stay fast *while* `session.list` is in flight

```
=== control endpoints 2026-09-22T10:33:36+08:00 ===
settings.describe: HTTP 200 0.018908s 43534B
workspace.list:    HTTP 200 0.004116s  8793B
```

The decisive experiment — cheap endpoint polled **during** a live `session.list`:

```
=== CONCURRENCY TEST 2026-09-22T10:36:47+08:00 ===
  t=1 settings.describe HTTP 200 0.031541s 43534B
  t=2 settings.describe HTTP 200 0.010919s 43534B
  t=3 settings.describe HTTP 200 0.012089s 43534B
  t=4 settings.describe HTTP 200 0.005307s 43534B
SL: HTTP 200 3.100109s 495944B            <-- session.list in flight, then done
  t=5 settings.describe HTTP 200 0.015232s 43534B
  ...
  t=9 settings.describe HTTP 200 0.050510s 43534B
  t=12 settings.describe HTTP 200 0.012464s 43534B
=== END 2026-09-22T10:36:51+08:00 ===
```

`settings.describe` never exceeded **50 ms**, including while the 496 KB aggregation was running. **The event loop is never blocked long.** This single result rules out "the main thread is stuck in one synchronous infinite loop" and is explained in §3.

---

## 2. Main-thread CPU

### 2.1 Peaks: ~100–111 % of one core, ~half of it kernel time

```
$ date -Is; for i in 1 2; do read ... < /proc/10806/stat; sleep 5; read ... ; done
2026-09-22T10:33:05+08:00
sample1: d_utime=308 d_stime=279 ticks/5s     -> 587 ticks/5s = 117% of one core (53% user / 47% sys)
sample2: d_utime=333 d_stime=265 ticks/5s     -> 598 ticks/5s = 120% of one core (56% / 44%)
```

```
$ awk '{print "utime="$14" stime="$15" minflt="$10}' /proc/10806/stat; sleep 5; ...
utime=109668 stime=44162 minflt=113740187
utime=109943 stime=44442 minflt=114126641   -> d_utime=275 d_stime=280 (555 ticks/5s=111%), d_minflt=386454
```

```
2026-09-22T10:36:48+08:00
utime=115884 stime=49087 minflt=121502418
utime=116166 stime=49344 minflt=121968098   -> 539 ticks/5s = 108%, d_minflt=465680
```

Thread table — **only the main thread (tid 10806) is hot**; every other thread is idle:

```
tid=10806 state=R utime=93591 stime=44447      <-- the only consumer
tid=10807 state=S utime=0
tid=10808 state=S utime=5427 stime=118
tid=10809 state=S utime=5420 stime=119
tid=10810 state=S utime=5408 stime=129
tid=10811 state=S utime=5420 stime=119
tid=10812 state=S utime=0
... (12 threads total, all others ~0)
```

Derived rates during the pegged phase:
- **~77,000–93,000 minor page faults/s** (386,454–465,680 per 5 s) ⇒ ~**310–370 MB/s of freshly touched memory**. This is allocator/GC thrash, matching the reported "RSS decreasing ~110 MB/10 s".
- RSS sawtooth confirmed: `VmRSS: 4195308 kB` → `4528172 kB` **5 s later** (a ±330 MB swing).

### 2.2 The load is not constant — it tracks live-session activity

Paired sampling (5 s windows, main thread tid 10806, and full-file rewrites of `session_projcache.json` counted by mtime/size change):

```
win | writes/5s | d_utime d_stime | cpu% of one core
  1  |      7     |  103   130     |  46.6%  (user 21% sys 26%)
  2  |      8     |  188   135     |  64.6%  (user 38% sys 27%)
  3  |      8     |  112   103     |  43.0%  (user 22% sys 21%)
  4  |      5     |  124   121     |  49.0%  (user 25% sys 24%)
  5  |      5     |  180   128     |  61.6%  (user 36% sys 26%)
  6  |      3     |  184   136     |  64.0%  (user 37% sys 27%)
```

Peak window (earlier, high activity): **29 writes / 3 s** with **111 %** CPU. Low window: **3–4 writes / 5 s** with **43–61 %** CPU.
⇒ Δ≈8.7 rewrites/s ↔ Δ≈0.5 core ⇒ **≈58 ms of main-thread CPU per full-document rewrite**. Sys time never falls below ~21–27 % of a core in any window (write + fsync + rename + page-fault cost is a *constant* floor).

`wchan` of the main thread:

```
$ cat /proc/10806/task/10806/wchan
0
$ grep -E "State|Threads" /proc/10806/status
State:  R (running)
Threads: 12
```

`wchan = 0` with state `R` = the thread is **executing on-CPU, not parked on a lock or I/O wait**. There is **no blocking lock/queue deadlock** on the main thread.

---

## 3. Why other endpoints escape it

Three independent reasons, all evidence-backed:

1. **Different code path entirely.** `/api/settings.describe` → settings namespace view (pure in-memory read, no aggregation). `/api/workspace.list` → workspace registry. Neither touches `listVisibleSessionSummaries`, the projection cache, or the session persistence seam. `session.list` is the *only* unary method that walks every session.

2. **`session.list` waits ~16–20 times; the fast endpoints wait ~0 times.** This is the core of the answer to "how can a synchronous 100 %-CPU loop still service some HTTP requests?" — **there is no such synchronous loop.** The CPU is consumed by *many discrete, bounded async jobs*, each of which is a large synchronous chunk (one 9.86 MB `JSON.stringify`, one 9.86 MB write). The event loop is therefore **busy but yielding**: between two such chunks, a request needing zero/one `await` (settings.describe) is serviced in ~1–50 ms. `session.list`'s cold walk is a `for` loop over 16-item batches with an `await Promise.allSettled(...)` **per batch** (host line 2264–2288). Each batch therefore pays the queueing delay behind whatever 9.86 MB rewrite is in flight ⇒ N_batches × ~1 s stalls, while the *work* itself is milliseconds. This is exactly why the same request is 20.9 s in one phase and 0.60 s minutes later.

3. **No shared lock.** `wchan = 0` (§2.2) and the concurrent test (§1.2) both exclude a lock/queue that would serialize the endpoints against each other.

So: the loop is **broken by awaits everywhere**; nothing is "stuck". What is stuck is the *latency budget* of any handler that must await many times.

---

## 4. The exact code path `session.list` executes

File (the **loaded** install; verified by grep for the `runningSubagentCount` field that actually appears on the wire):
`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js`

| Step | Path:line | Note |
|---|---|---|
| unary route | `UNARY_ROUTES["session.list"]` → `invoke: (api,r) => api.sessions.list(r)` | fetch carrier |
| handler | **`index.js:2488`** `return ok(request, { items: await listVisibleSessionSummaries() });` | sessions domain |
| aggregation entry | **`index.js:2224`** `async function listVisibleSessionSummaries(signal)` | |
| **B1 sort (prime suspect)** | **`index.js:2237`** | see below |
| attached map | **`index.js:2241`** `attachedSessions.filter(keep).map(summarizeAttached)` | `summarizeAttached` at 2226 |
| per-row fold | **`index.js:1290`** `summarize()` → `sessionListMetadata(session.events)` at 1291 | full O(E) fold |
| cold source | **`index.js:2249`** `await persistence.list(signal)` | enumerates all persisted sessions |
| cold batches | **`index.js:2264–2288`** `for (offset += 16) { await Promise.allSettled(batch…) }` | `COLD_SUMMARY_BATCH_SIZE = 16` (line 884 in the profile copy) |
| attached re-fold | **`index.js:2271`** `if (attachedSession !== void 0) return summarizeAttached(attachedSession);` | **third** fold of the same events |
| B1 aggregate | **`index.js:1244–1274`** `annotateRunningSubagentCounts(ctx, retained)`, called at **2295** | see "not the culprit" below |

### 4.1 The prime suspect: `index.js:2237`

```js
/* dsh-lag-fix B1: 顶层全发 + subagent 最近 N 条 */
const attachedSessions = ctx.sessions.list();
const attachedSubagents = attachedSessions.filter((session) => session.header.origin === "subagent");
attachedSubagents.sort((a, b) => sessionListUpdatedAt(b.header, sessionListMetadata(b.events))
                              - sessionListUpdatedAt(a.header, sessionListMetadata(a.events)));
```

`sessionListMetadata` (`index.js:1214–1221`) is a **full fold over the entire event array with no memoization and no early exit**; `applySessionListMetadata` (`index.js:1208–1212`) is called once per event:

```js
function sessionListMetadata(events) {
	let state = { blank: true, lastPromptAt: null };
	for (const event of events) state = applySessionListMetadata(state, event);
	return state;
}
```

Called **twice per comparison**, inside a `.sort()` comparator that runs ~`m·log₂m` times, this is
**O(2 · m · log₂m · E) event visits per `session.list` call**, where `m` = attached subagent sessions and `E` = their event counts. At `m = 200`, `log₂m ≈ 7.6` ⇒ ~3,040 comparator calls ⇒ ~6,080 full event-array folds **per request**, for a value (`lastPromptAt`) that is already computed once per row by `summarize` at line 1291 and again at 2271. This is the "repeated recomputation without memoization" the brief predicted — **it is in the B1 patch, but not in the function the brief guessed.**

**Proof it is B1-introduced** (not upstream): the pre-B1 copy of the same function
`/home/CNS2026495165/.dsh/profiles/node_modules/dsh-workspace-enhancement/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js:2170` reads simply

```js
const items = ctx.sessions.list().map(summarizeAttached);
```

…with **no** `attachedSubagents.sort(...)` and no metadata-based comparator anywhere in the path. The deployed file also mtime-dates to **2026-09-21 16:54** (B1 apply window) while the profile copy is 09-15.

### 4.2 The brief's hypothesis is FALSE — `annotateRunningSubagentCounts` cannot loop forever

```js
function annotateRunningSubagentCounts(ctx, items) {          // index.js:1244
	const liveSessions = ctx.sessions.list();
	const childrenOf = new Map(); const liveStatus = new Map();
	for (const session of liveSessions) { ...build parent->children, liveStatus... }   // 1248-1255
	for (const item of items) {                                 // 1256
		if (item.origin === "subagent") continue;
		let count = 0;
		const seen = new Set([item.sessionId]);                 // 1259
		const queue = [item.sessionId];
		while (queue.length > 0) {                              // 1261
			const next = childrenOf.get(queue.shift());
			if (next === void 0) continue;
			for (const childId of next) {
				if (seen.has(childId)) continue;                // 1265  <-- terminating guard
				seen.add(childId);                              // 1266
				if (liveStatus.get(childId) === true) count += 1;
				queue.push(childId);
			}
		}
		item.runningSubagentCount = count;                      // 1271
	}
	return items;
}
```

Each descendant is enqueued **at most once** because of `seen` (line 1265–1266); a cyclic `parentSession` would also terminate. Cost = one live-session pass (1248–1255) + O(items × live descendants). With the observed 299 rows and ~12 threads' worth of live sessions this is **milliseconds — not the culprit**. Likewise the cold-side trims at 2250–2262 (`slice(0, SUBAGENT_LIST_MAX)`, `coldSubagentSeen <= SUBAGENT_LIST_MAX`) are bounded and terminate.

### 4.3 The continuous 100 % CPU — write amplification (fact **A**)

Driver — `@deepseek-ai/dsh-session-projection-cache/lib/index.js`:
- `installWritePath()` **200–218**: on every `session/event`, a per-session dirty counter/timer; at `pending >= writeEveryEvents` (**211–213**) or on the interval timer (**215–217**) or `turn/end` (**201–203**) it calls `flushSoft(session, trigger)`.
- `flushSoft` **234 → write` 159 → put` 252** → `table.put(id, {identity, rows})`.

Amplifier — `@deepseek-ai/dsh-storage-json/lib/index.js`:
- `putRecord` **169** → `publish()` → **line 220**: `const write = writeAtomic(this.path, serialize(this.descriptor.name, this.state));`
- `serialize` **68–79**: rebuilds a **fresh object graph for every record** (`tables[table] = Object.fromEntries(records)`) and returns `${JSON.stringify(document, null, 2)}\n` — i.e. the **entire unit document**, pretty-printed, for **one** record update.
- `writeAtomic` writes a temp file, **fsyncs the file**, renames, then **fsyncs the directory** (lines 10–16, 36, 44).

So a single projection checkpoint for one live session rewrites **all 2670 sessions × 10 rows = 9.86 MB**. Configured flush triggers (deployed `dsh-web-app/cordis.patch.yml:76–80`): `writeEveryEvents: 200`, `writeIntervalMs: 5000`. A live session emitting events trips the 200-event threshold repeatedly ⇒ the measured ~1–10 rewrites/s ⇒ CPU figures in §2.2.

---

## 5. Session-store state (read-only) — the scale the aggregation loops over

### 5.1 `/home/CNS2026495165/.dsh/sessions/**` — **data is intact**

```
$ ls -1 /home/CNS2026495165/.dsh/sessions | wc -l                  -> 19      (workspace buckets)
$ du -sh /home/CNS2026495165/.dsh/sessions                         -> 562M
$ find ... -type f | wc -l                                          -> 1007
$ find ... -maxdepth 2 -type d -name "session-*" | wc -l            -> 99      (top-level sessions)
$ find ... -name "session.jsonl.zstd" | wc -l                       -> 1001    (1002 at recheck)
```

Largest artifacts (all plain session logs, none absurd):

```
22808279  .../--home-CNS2026495165-dsh--/session-6a7367fe-.../session.jsonl.zstd
22770869  .../--home-CNS2026495165-Dexterous_Hand_23Dof-Dexterous_Hand_23Dof--/session-aa169d83-.../session.jsonl.zstd
13772205  .../session-b64308f0-..../session.jsonl.zstd
12245962  .../session-0b9bfaf5-..../session.jsonl.zstd
12166131  .../--home-CNS2026495165-dsh--/session-bc0b7655-..../session.jsonl.zstd
```

**Integrity check — 0 malformed:**

```
$ for f in $(find ... -name "session.jsonl.zstd"); do head -c4 "$f" | od -An -tx1; done
valid_zstd_frames=1002 malformed=0
empty files: 0
non-.zstd files: only 0-byte session.lock files
```

### 5.2 `/home/CNS2026495165/.dsh/storages/session_projcache.json` — **9.86 MB, well-formed**

```
-rw------- 1 CNS2026495165 CNS2026495165 9840074 9月 22 10:34 session_projcache.json
```

```
top-level type: dict   keys: ['unit','global','tables']
unit    = {"name": "session_projcache", "version": 3}
n session entries: 2670
row kinds (per entry): sessionStats, title, goal, tokenUsage, contextPressure,
                       contextBreakdown, subagentTiming, subagent, permissions,
                       sessionListMetadata      -> 2670 x 10 = 26,700 rows
largest entry:  8179 B (session-f280a6e9-...)      smallest: 1243 B
malformed entries: 0
blank flag distribution: {False: 2661, True: 9}
```

Byte-stable around 9.86 MB, and its size **changes on almost every rewrite** (9858246…9858944 across 29 rewrites in 3 s) — i.e. a live session's row really is being updated ~10×/s, each update republishing the whole document.

### 5.3 The listed set matches B1's cap exactly (sanity check of the path)

`session.list` returned **299 items**, which is exactly **99 top-level + 200 subagents** = `SUBAGENT_LIST_MAX = 200` (`index.js:1231–1233`). Response body 495,944–496,193 B, all rows `running:false`, `runningSubagentCount: 0`, 299/299 carrying `projections`.

---

## 6. Verdict

### **(a) Reproducible product defect on the `session.list` path** — not (b), not (c).

- **(b) corrupt/huge data is ruled out.** Every one of 1002 session logs is a valid zstd frame with 0 malformed files and no empty file; `session_projcache.json` parses cleanly, holds the declared `unit` header `{name: session_projcache, version: 3}`, all 2670 entries carry `identity` + 10 well-formed `rows` (each with `ver`/`seq`/`val`), and no single entry is large (max 8179 B). There is no pathological record to trip over. The *scale* (9.86 MB cache / 2670 records / 562 MB logs / 4.3–4.5 GB RSS) is what **amplifies** the defect, so it is state-**sized**-dependent, not state-**corrupt**-dependent. The defect is present with completely healthy data.
- **(c) not inconclusive** — the code path, the arithmetic, the `wchan`, the concurrency isolation, the pre-B1 diff and the write-rate↔CPU correlation all point the same way.

### Single most likely path:line culprit

**`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js:2237`**

```js
attachedSubagents.sort((a, b) => sessionListUpdatedAt(b.header, sessionListMetadata(b.events))
                              - sessionListUpdatedAt(a.header, sessionListMetadata(a.events)));
```

A **B1-introduced** comparator that runs a full O(events) fold **twice per comparison** inside a sort — O(2·m·log₂m·E) event visits per `session.list`, for a scalar already computed at lines 1291 and 2271. It is the dominant, non-memoized recomputation on the `session.list` path and explains the multi-second-to-20-second latency (fact **B**).

**Second, independent culprit for the *continuous* 100 % CPU (fact A):**
`@deepseek-ai/dsh-storage-json/lib/index.js:220` (`publish` → `serialize` at **68–79**, `putRecord` at **169**), invoked by `@deepseek-ai/dsh-session-projection-cache/lib/index.js:252 → 234 → 211–217` — whole-document rewrite of the 9.86 MB `session_projcache` on every single session checkpoint.

### Evidence chain (condensed)

```
live session emits events
  └─ projection-cache write-behind (projection-cache:200-218; 200 events / 5000 ms)
       └─ flushSoft(234) -> write(159) -> put(252) -> table.put
            └─ storage-json putRecord(169) -> publish -> serialize(68-79)
                 = Object.fromEntries(2670 records) + JSON.stringify(WHOLE 9.86MB doc, null, 2)
                 + writeAtomic(temp) + fsync(file) + rename + fsync(dir)
                 = ~58 ms main-thread CPU, ~20 MB garbage, per rewrite
       × 1-10 rewrites/s   ==>  43-111% of one core, sys 21-45%, 77k-93k minor faults/s,
                                RSS sawtooth 4.20-4.53 GB        [fact A: continuous burn]

GET /api/session.list
  └─ apiproxy index.js:2488 -> listVisibleSessionSummaries (2224)
       ├─ 2237 sort comparator: 2 x sessionListMetadata over full event arrays, per comparison
       ├─ 2241 map(summarizeAttached) -> summarize(1290) -> full fold per attached session
       ├─ 2249 persistence.list (all persisted sessions)
       ├─ 2264-2288 cold walk: ~16-item batches, ONE await each
       │             => 16-20 sequential trips through a loop already busy with 9.86 MB rewrites
       └─ 2271 attached sessions folded a THIRD time
     = work measured in ms, latency delivered in 0.6-20.9 s   [fact B: session.list tail latency]
     (annotateRunningSubagentCounts 1244-1274 is bounded by `seen` -> NOT the culprit)
```

### Two things this analysis explicitly rules out

1. **No infinite/unbounded loop** anywhere on the `session.list` path, and specifically **not** the B1 `runningSubagentCount` aggregate (§4.2). `session.list` completes every time (0.60 s best case).
2. **No deadlock/lock starvation**: `wchan = 0`, state `R`, and `settings.describe` answers in ≤50 ms while the stall is in progress (§1.2, §2.2).

### Fix directions (not applied — read-only task)

1. **`index.js:2237`** — hoist the fold: compute `sessionListUpdatedAt(header, sessionListMetadata(events))` **once per attached session** into a decorated array, then sort on that cached scalar (kills O(m·log m·E) → O(m·E)). Reuse the same scalar in `summarize` (1291) and in the cold walk (2271) via a per-request `Map<sessionId, updatedAt>`.
2. **`dsh-storage-json:220` / `dsh-session-projection-cache:252`** — stop rewriting the whole 9.86 MB document per record: compact JSON instead of `null, 2` (9.86 MB → ~5 MB), coalesce/debounce flushSoft so many sessions share one publish, or shard the domain per session id. Cheapest high-value step is coalescing + dropping the pretty-printer.
3. Consider a short-lived **memo of the full `session.list` response** (e.g. 250–1000 ms) so the GUI's repeat calls in the first-open burst do not each pay the full aggregation.

---

## Appendix — commands used (all read-only)

```
timeout 15 curl -s -o /tmp/o -w 'HTTP %{http_code} %{time_total}s %{size_download}B\n' \
  -X POST http://127.0.0.1:3080/api/session.list -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"z2","method":"session.list","payload":{}}'
awk '{print $14,$15}' /proc/10806/stat ; awk '{print $10}' /proc/10806/stat   # utime/stime/minflt
cat /proc/10806/task/10806/wchan
grep -E 'State|Threads|VmRSS' /proc/10806/status
ss -tn | grep :3080                        # 16 ESTABLISHED conns
du -sh /home/CNS2026495165/.dsh/sessions ; find ... -printf '%s %p\n' | sort -rn | head
head -c4 "$f" | od -An -tx1                # zstd frame magic 28b52ffd
python3 -c "json.load(open('.../session_projcache.json'))"   # structure + integrity
python3 - <<'EOF'  # paired write-rate (stat mtime_ns) vs /proc utime/stime sampling
EOF
```

Not obtainable in this scope (recorded as limitation, no escalation attempted): `/proc/10806/io` and `/proc/10806/environ` → **`权限不够` (permission denied)** for the non-owning user. A Node CPU profile would need `SIGUSR1`/`--inspect`, which the task forbids.
