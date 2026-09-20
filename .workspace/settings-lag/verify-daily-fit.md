# usage_daily vs usage_events — measurement-backed fit report

Anchor: a single `Date.now()` = **1789886799044** → `Sun Sep 20 2026 14:48:08 GMT+0800` (TZ UTC+8, offset +480 min).
All timings: `node:sqlite` `{ readOnly: true }` + `PRAGMA temp_store=MEMORY`, single-threaded, serial loops of 3, min reported in ms to 1 decimal (µs-resolution confirms where 0.0 ms appears).
DB untouched — `md5sum` + size/mtime of `usage.db`, `-wal`, `-shm` identical before/after; `PRAGMA quick_check` = ok (scripts: `/tmp/vq/*.mjs`, raw JSON `/tmp/vq/q1.json`, `/tmp/vq/q234.json`, `/tmp/vq/q2b.json`, `/tmp/vq/final.json`).

Production range construction (`dsh-usage/lib/client.js:235-239`):

```js
if (rangeDays > 0) return { from: now - rangeDays * 86400000, to: now };
const from = customFrom ? new Date(customFrom + "T00:00:00").getTime() : undefined;
const to   = customTo   ? new Date(customTo   + "T23:59:59").getTime() : undefined;
```

---

## Q1 — usage_daily ≡ events only on day-aligned windows

`(i)` = exact `usage_events WHERE ts>=from AND ts<=to`; `(ii)` = `usage_daily WHERE day>=dayOf(from) AND day<=dayOf(to)`; `(iii)` = sanity check, `usage_events` day-floored (must equal `(ii)`).

| card | window (local) | start offset from midnight | (i) events exact req / tok | (ii) usage_daily req / tok | rel err req | rel err tok | (iii) events day-aligned |
|---|---|---|---|---|---|---|---|
| rangeDays=1 | 09-19 14:48:08 → 09-20 14:48:08 | 888 min | 0 / 0 | 0 / 0 | **+0.000 %** | **+0.000 %** | 0 / 0 |
| rangeDays=7 | 09-13 14:48:08 → 09-20 14:48:08 | 888 min | 24 931 / 4 391 030 015 | 24 931 / 4 391 030 015 | **+0.000 %** | **+0.000 %** | 24 931 / 4 391 030 015 |
| rangeDays=30 | 08-21 14:48:08 → 09-20 14:48:08 | 888 min | 80 120 / 10 310 975 630 | 81 150 / 10 419 760 029 | **+1.286 %** | **+1.055 %** | 81 150 / 10 419 760 029 |
| rangeDays=90 | 06-22 14:48:08 → 09-20 14:48:08 | 888 min | 104 907 / 14 721 117 199 | 104 907 / 14 721 117 199 | **+0.000 %** | **+0.000 %** | 104 907 / 14 721 117 199 |
| custom 08-01 → 09-18 | 08-01 00:00:00 → 09-18 23:59:59 | 0 min | 104 907 / 14 721 117 199 | 104 907 / 14 721 117 199 | **+0.000 %** | **+0.000 %** | 104 907 / 14 721 117 199 |
| custom 09-01 → 09-18 | 09-01 00:00:00 → 09-18 23:59:59 | 0 min | 63 142 / 8 601 685 903 | 63 142 / 8 601 685 903 | **+0.000 %** | **+0.000 %** | 63 142 / 8 601 685 903 |
| custom 09-10 → 09-12 **18:00** | 09-10 00:00:00 → 09-12 18:00:00 | 0 min, tail 360 min | 14 182 / 1 777 460 617 | 15 579 / 2 087 200 610 | **+9.851 %** | **+17.426 %** | 15 579 / 2 087 200 610 |
| custom 09-10 → 09-12 (aligned) | 09-10 00:00:00 → 09-12 23:59:59 | 0 min | 15 579 / 2 087 200 610 | 15 579 / 2 087 200 610 | **+0.000 %** | **+0.000 %** | 15 579 / 2 087 200 610 |
| custom 09-10T09:00 → 09-12T18:00 | partial both ends | 540 min / 360 min | 14 182 / 1 777 460 617 | 15 579 / 2 087 200 610 | **+9.851 %** | **+17.426 %** | 15 579 / 2 087 200 610 |

Wall-clock per query (`(i)` route, 30-day worst case 11.3 ms; `(ii)` route 0.0 ms — 5.0 µs by µs-resolution).

**Boundary leak decomposition.** `usage_daily` is *never smaller* than the exact window: flooring `from` to 00:00 and `to` to 23:59:59 can only add rows (head partial day + tail partial day). Measured leak for the rolling windows (head partial day at 888-min offset + tail partial day of 552 min):

| card | head partial-day rows/tokens | tail partial-day rows/tokens | net over-count |
|---|---|---|---|
| rangeDays=1 | 0 / 0 | 0 / 0 | 0 |
| rangeDays=7 | 0 / 0 | 0 / 0 | 0 (no events exist on 09-13 or 09-20 at all) |
| rangeDays=30 | **1 030 / 108 784 399** | 0 / 0 | = the whole +1.286 % |
| rangeDays=90 | 0 / 0 | 0 / 0 | 0 (window covers the full data span 08-10..09-18) |

`rangeDays=1` and `7` measure as *exactly* equal only because this DB has no rows in the head/tail partial days (last event is 2026-09-18 19:02:02). With activity present they over-count like the 30-day case. The over-count is data-dependent, not bounded: the two 09-10→09-12 variants over-count by **+9.851 % requests / +17.426 % tokens** purely because the tail partial day (18:00→23:59 of 09-12) was busy.

**Is `now - N*86400000 → now` ever day-aligned?** No. Local midnight is `getTime() % 86400000` shifted by the +08:00 zone offset; `from`'s offset from midnight is `(now mod 86400000) - 8 h`, which changes every millisecond and equals 0 only for one instant per day. `to = now` is day-aligned only at exactly 23:59:59.999 — never in practice. The `custom` route *is* day-aligned because it hardcodes `T00:00:00`/`T23:59:59` (the last table row proves this: aligned = exact; a mid-day `to` breaks it).

> **Verdict Q1: usage_daily is exact iff both endpoints are local-day-aligned (all `custom` ranges, and any rolling range that happens to cover the full data span); every `rangeDays≥1` window derived from `Date.now()` is NOT day-aligned and over-counts — measured +1.286 % requests / +1.055 % tokens at 30 days (+1 030 requests), with a demonstrated worst case of +9.851 % / +17.426 % on a partial-day custom range.**

---

## Q2 — `data_source IN ('dsh','cc')` is worse than useless on the ts index

30-day window `1787294810505 … 1789886810505`, 80 120 rows in-window (76 % of the 104 907-row table); `dsh` 82 207 / `cc` 22 700 rows overall.

| variant | rows | min ms | EXPLAIN QUERY PLAN |
|---|---|---|---|
| (a) `WHERE ts>=? AND ts<=? AND data_source IN ('dsh','cc')` | 80 120 | **22.3** | `SEARCH usage_events USING INDEX sqlite_autoindex_usage_events_1 (data_source=?)` |
| (b) `WHERE ts>=? AND ts<=?` (no data_source) | 80 120 | **10.4** | `SEARCH usage_events USING COVERING INDEX idx_events_ts (ts>? AND ts<?)` |
| (a′) same as (a) with `data_source='dsh'` only | 80 113 | 17.7 | `SEARCH … USING INDEX sqlite_autoindex_usage_events_1 (data_source=?)` |
| (c) `SELECT ts, model, project WHERE ts window` | 80 120 | 41.2 | `SEARCH usage_events USING INDEX idx_events_ts (ts>? AND ts<?)` (non-covering) |
| (d) `SELECT ts, model, project WHERE ts window AND data_source IN (…)` | 80 120 | 38.2 | `SEARCH … USING INDEX sqlite_autoindex_usage_events_1 (data_source=?)` |
| (e) real `byDay` + `data_source IN (…)` (6 aggs, strftime, GROUP BY) | 21 | **120.2** | autoindex on `data_source`, + `USE TEMP B-TREE FOR GROUP BY` |
| (f) real `byDay`, no `data_source` | 21 | **122.2** | `SEARCH … USING NON-COVERING INDEX idx_events_ts`, + `USE TEMP B-TREE FOR GROUP BY` |

The plan never says `COVERING` once `data_source` is present, and it does **not** seek `idx_events_ts`: because `data_source IN ('dsh','cc')` covers *both* distinct values in the table, SQLite picks the UNIQUE autoindex `(data_source,session_id,dedup_key)` and treats `data_source` as an equality, then applies `ts` as a residual filter. Two independent proofs that `idx_events_ts` is bypassed:

* **Scaling**: window 7 d → 16.3 ms, 30 d → 22.3 ms, 90 d (all 104 907 rows) → 37.9 ms. A ts seek would scale with the window (4.2 ms → 11.6 ms → 27.2 ms for the ts-only variant); the ds-style cost is dominated by a fixed ~104 k-entry index walk, not by the window.
* **`idx_events_ts` size**: `dbstat` = 1 769 472 B / 432 pages = 4 096 B/page ⇒ ~19.5 B per entry (ts int + rowid) ⇒ the 30-day window = 80 120 entries ≈ 328 of the 432 index pages; the whole 35 MB DB exceeds the 2 MB page cache (`cache_size=-2000`), so the ts-only scan cost is page-read bound, consistent with the ≈10 ms floor and its window-proportional growth.

**Cost of the `IN` predicate:** it converts a *covering* ts-only scan into a non-covering scan and **doubles** raw retrieval (10.4 ms → 22.3 ms). But the ts window already contains 80 120/80 120 = 100 % of rows with either source value, so the predicate *filters out nothing* yet costs **+11.9 ms**. In the full `byDay` shape the penalty is only +2/-2 ms (120.2 vs 122.2, within noise) because the per-row strftime (Q3) dwarfs it — i.e. the filter is pure overhead, and the "covered, sargable timings" framing does not survive measurement.

> **Verdict Q2: the card's `data_source IN ('dsh','cc')` does not discriminate anything (it matches 100 % of rows in-window) and it actively defeats the ts index — the planner switches to the UNIQUE autoindex and loses index-only coverage, costing ~2× on retrieval (22.3 ms vs 10.4 ms) with zero rows removed; dropping the predicate entirely is both simpler and no slower (120.2 → 122.2 ms on the full byDay query).**

---

## Q3 — residual cost of the events-side byDay/heatmap query (30-day window)

| step | min ms | times (3) | EXPLAIN QUERY PLAN |
|---|---|---|---|
| (a) `SELECT strftime('%Y-%m-%d',ts/1000,'unixepoch','localtime') d, COUNT(*) … GROUP BY d` | **104.2** | 104.2 / 104.6 / 104.4 | `SEARCH … USING COVERING INDEX idx_events_ts (ts>? AND ts<?)` + `USE TEMP B-TREE FOR GROUP BY` |
| (b) `SELECT ts, COUNT(*) … GROUP BY ts` | **15.1** | 15.1 / 16.0 / 15.9 | `SEARCH … USING COVERING INDEX idx_events_ts (ts>? AND ts<?)` — no temp b-tree |
| (c) `SELECT COUNT(*) … WHERE ts>=? AND ts<=?` | **0.9** | 0.9 / 0.9 / 0.9 | `SEARCH … USING COVERING INDEX idx_events_ts (ts>? AND ts<?)` |
| extra control: same as (a) without `GROUP BY`, i.e. strftime projected per row | **125.0** | 125.0 / 134.5 / 127.4 | covering ts scan only |
| extra control: real 6-aggregate byDay (COUNT + 4 SUMs), with `ds IN` | 120.2 | 127.4 / 121.7 / 120.2 | autoindex + temp b-tree |

Decomposition of the 104.2 ms residual, against the 0.9 ms floor:

* **(i) scanning the index range: ~0.9 ms ≈ 0.9 %.** `COUNT(*)` over the same range touches all 80 120 index entries and 328/432 pages in 0.9 ms — all pages an LRU cache evicted by the previous 120 ms full-scan invocation (~104 907 entries) needs to re-read.
* **(ii) per-row `strftime`: ~104–124 ms ≈ 100 %+.** Projecting the strftime value per row *without* any GROUP BY costs **125.0 ms** — more than the whole GROUP BY query. Materializing `strftime('%Y-%m-%d', ts/1000, 'unixepoch', 'localtime')` (plus the locals → UTC conversion the `'localtime'` modifier triggers) on 80 120 rows is the entire budget.
* **(iii) temp b-tree GROUP BY sort: ≈ 0 ms beyond strftime.** `GROUP BY ts` is *free* relative to the scan (15.1 ms vs 0.9 ms baseline for 80 120 rows → ~14 ms for 67 603 b-tree entries) because `idx_events_ts` is already ts-ordered so SQLite streams the grouping with no temp b-tree at all. The only variant needing `USE TEMP B-TREE FOR GROUP BY` is the strftime one, and (a) is *faster* than its own no-GROUP-BY control (104.2 vs 125.0 ms) — the b-tree never sorts more than 21 distinct day keys, so its cost is below run-to-run noise. The real JSON `byDay` at 120.2 ms vs 104.2 ms for COUNT-only adds ~16 ms for the four `SUM()` columns (same rows, same scan), still nowhere near the strftime term.

> **Verdict Q3: ~100 % of the 104 ms residual is the per-row `strftime(…, 'localtime')` (its no-GROUP-BY control alone costs 125.0 ms), while scanning the ts index range costs 0.9 ms (0.9 %) and the GROUP BY temp b-tree is immeasurable (21 keys; ≤ ~15 ms even for 67 603 key groups, and the strftime variant is *faster* than its own no-GROUP-BY control) — so optimizing the sort is pointless and the bucket expression is the only lever.**

---

## Q4 — day-aligned GROUP BY on usage_daily avoids the sort (PK prefix)

`usage_daily`: 296 rows, 31 distinct days, `dbstat` 61 440 B / 15 pages (+ PK index 36 864 B / 9 pages) — the whole table is smaller than one query's index range on `usage_events`. Table DDL: `PRIMARY KEY(day, data_source, model, project)`, `STRICT`, no other index (`sqlite_autoindex_usage_daily_1`, `origin=pk`, cols `day, data_source, model, project`).

Window `day >= '2026-08-21' AND day <= '2026-09-20'` → 137 rows out of 296, 21 distinct days.

| query | rows | min ms | min µs | EXPLAIN QUERY PLAN |
|---|---|---|---|---|
| (a) `SELECT day, SUM(requests) … GROUP BY day` | 21 | **0.0** | 18.3 | `SEARCH usage_daily USING INDEX sqlite_autoindex_usage_daily_1 (day>? AND day<?)` — **no temp b-tree** |
| (a′) same, repeated | 21 | 0.0 | 18.9 | idem |
| (b) `SELECT SUM(requests) … ` (no GROUP BY) | 1 | **0.0** | 9.1 | `SEARCH … USING INDEX sqlite_autoindex_usage_daily_1 (day>? AND day<?)` |
| (c) `SELECT day, SUM(input+output+cache_read+cache_write) … GROUP BY day` | 21 | **0.0** | 22.5 | `SEARCH … USING INDEX sqlite_autoindex_usage_daily_1 (day>? AND day<?)` |
| (c′) same tokens query, no GROUP BY | 1 | 0.0 | 12.2 | `SEARCH … USING INDEX sqlite_autoindex_usage_daily_1 (day>? AND day<?)` |
| `SELECT COUNT(*) …` | 1 | 0.0 | 5.0 | `SEARCH … USING **COVERING** INDEX sqlite_autoindex_usage_daily_1 (day>? AND day<?)` (explicit COVERING) |
| control: full table scan, no WHERE (`SELECT day, requests`) | 296 | **0.1** | 63.4 | full scan |
| control: `GROUP BY day` with no WHERE | 31 | 0.0 | 27.9 | `SCAN usage_daily USING INDEX sqlite_autoindex_usage_daily_1` — still no temp b-tree |

**Is the PK index what makes it fast?** Yes, and specifically because `day` is its **leading column**:
* The `day` range is satisfied as an index range seek (`day>? AND day<?` on `sqlite_autoindex_usage_daily_1`), i.e. the constraint is served by the PK's first key column — a `(data_source, day, …)` PK would not give this and would force a full scan.
* No `USE TEMP B-TREE FOR GROUP BY` appears in any plan: rows arrive already `day`-ordered, so SQLite streams the `SUM` accumulation group by group — contrast Q3, where the events route needs the temp b-tree plus a per-row strftime. Even the no-WHERE form stays b-tree-free (plain `SCAN` over the same index).
* Redundant predicates cannot make SQLite abandon the route: even `AND typeof(day)='text'` still plans `SEARCH … USING INDEX sqlite_autoindex_usage_daily_1`, so the index is chosen on merit, and index vs forced-scan differ by only 18.3 vs 21.1 µs because 15 pages are always hot — the win is the avoided sort and the trivially small row count, not a cold-cache page saving.
* Bound: the 30-day route reads 137/296 rows and its total cost (18.3 µs, GROUP BY included) is **~3 orders of magnitude** below the same question on `usage_events` (120.2 ms with `ds IN`, 104.2 ms without) — ~6 500× faster.

> **Verdict Q4: yes — the `(day, …)` PK prefix turns the day range into an index seek and removes `USE TEMP B-TREE FOR GROUP BY` entirely from every plan, so `usage_daily` answers both the requests (`SUM(requests)`, 18.3 µs / 0.0 ms) and the token (`SUM(input+output+cache_read+cache_write)`, 22.5 µs / 0.0 ms) per-day GROUP BY at effectively zero cost, with a sorting-free no-GROUP-BY variant at 9.1 µs and a 5.0 µs covering COUNT(*); the only caveat is that these are day-granularity answers, so they are exact only for the day-aligned ranges established in Q1.**
