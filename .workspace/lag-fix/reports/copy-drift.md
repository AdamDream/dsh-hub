# 两份 `@local/dsh-usage` 拷贝的漂移比对（只读）

- 生成时间：2026-09-20T15:39:59
- source   ：`/home/CNS2026495165/dsh/dsh-usage`（git 跟踪、可写，无需审批）
- deployed ：`/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage`（宿主实际加载，工作区外，需审批）

## 1. 逐文件比对

| 文件 | source 字节/行 | deployed 字节/行 | sha256(前12) | 结论 |
|---|---|---|---|---|
| `lib/db.js` | 22367/581 | 22913/588 | f8f7518073fc / 802834b56ab3 | **漂移** |
| `lib/client.js` | 29310/487 | 66967/1147 | 2275965aeb16 / a4f5a529f391 | **漂移** |
| `lib/index.js` | 6972/188 | 8082/216 | 8b5dd0d513e6 / 49f648c45221 | **漂移** |
| `lib/rpc.js` | 9295/221 | 10030/230 | 16e8c6caca16 / 3c91ac22f486 | **漂移** |
| `lib/ingest-cc.js` | 8129/224 | 8129/224 | 9fcaab44a529 / 9fcaab44a529 | **完全一致** |
| `lib/ingest-dsh.js` | 9717/269 | 9717/269 | f735185ef50c / f735185ef50c | **完全一致** |
| `lib/zstd.js` | 5265/139 | 5265/139 | a69419cc90cb / a69419cc90cb | **完全一致** |
| `lib/charts.js` | 7112/176 | 27396/602 | d0fbee8b394c / 57b23e271a56 | **漂移** |
| `package.json` | 1179/50 | 1226/51 | 34ec1a94d486 / d69600ea782a | **漂移** |
| `cordis.patch.yml` | 57/3 | 57/3 | 2f9075c6f4ea / 2f9075c6f4ea | **完全一致** |
| `README.md` | 6341/111 | 6341/111 | c6a8ba670b76 / c6a8ba670b76 | **完全一致** |

漂移文件（6 个）：`lib/db.js`、`lib/client.js`、`lib/index.js`、`lib/rpc.js`、`lib/charts.js`、`package.json`

## 2. 是拷贝还是链接（inode / 设备号）

| 文件 | source inode | deployed inode | 设备 | 判定 |
|---|---|---|---|---|
| `lib/db.js` | 32118476 | 32244137 | 66306 | **独立拷贝**（内容可各自漂移） |
| `lib/client.js` | 32118436 | 32244135 | 66306 | **独立拷贝**（内容可各自漂移） |
| `lib/index.js` | 32118475 | 32244136 | 66306 | **独立拷贝**（内容可各自漂移） |

## 3. 补丁替换点的两侧命中矩阵（决定「能否两侧干净应用」）

| 替换单元 | 文件 | source | deployed | 两侧均可 |
|---|---|---|---|---|
| `db-route` #0 | `lib/db.js` | 唯一命中 | 唯一命中 | ✅ |
| `db-rebuild` #0 | `lib/db.js` | 唯一命中 | 唯一命中 | ✅ |
| `client-range` #0 | `lib/client.js` | 唯一命中 | 唯一命中 | ✅ |
| `client-poll` #0 | `lib/client.js` | 唯一命中 | 唯一命中 | ✅ |
| `client-poll` #1 | `lib/client.js` | 唯一命中 | 唯一命中 | ✅ |
| `client-poll` #2 | `lib/client.js` | 唯一命中 | 唯一命中 | ✅ |
| `client-poll` #3 | `lib/client.js` | 唯一命中 | 唯一命中 | ✅ |
| `client-poll` #4 | `lib/client.js` | 唯一命中 | 唯一命中 | ✅ |
| `client-poll` #5 | `lib/client.js` | 唯一命中 | 唯一命中 | ✅ |

**结论**：✅ 全部替换点在两侧均唯一命中 —— 补丁可对任一目标干净应用，无需合并

## 4. 功能级标记（漂移内容定性）

| 文件 | 标记 | source | deployed | 说明 |
|---|---|---|---|---|
| `lib/client.js` | `TREND_ANCHOR_HOUR` | 0 | 7 | **仅 deployed 有** |
| `lib/client.js` | `trendGrain` | 0 | 7 | **仅 deployed 有** |
| `lib/client.js` | `usageDayWindow` | 0 | 4 | **仅 deployed 有** |
| `lib/client.js` | `fillBuckets` | 0 | 5 | **仅 deployed 有** |
| `lib/client.js` | `settingsScope` | 0 | 16 | **仅 deployed 有** |
| `lib/client.js` | `peakRing` | 0 | 9 | **仅 deployed 有** |
| `lib/client.js` | `granularity` | 1 | 12 | 两侧都有、数量不同 |
| `lib/db.js` | `HOUR_SQL` | 0 | 2 | **仅 deployed 有** |
| `lib/db.js` | `granularity` | 0 | 3 | **仅 deployed 有** |
| `lib/index.js` | `peakRing` | 0 | 1 | **仅 deployed 有** |
| `lib/rpc.js` | `granularity` | 7 | 9 | 两侧都有、数量不同 |
| `lib/charts.js` | `usageDayWindow` | 0 | 1 | **仅 deployed 有** |
| `lib/charts.js` | `fillBuckets` | 0 | 1 | **仅 deployed 有** |
| `lib/charts.js` | `granularity` | 0 | 6 | **仅 deployed 有** |

## 5. 漂移性质与合并策略判定

- 部署侧 `client.js` mtime 更新：是
- 本补丁只改 `queryHeatmap` / `rebuildDailyForDays`（db.js）与 `rangeDays` 窗口 / 轮询 effect（client.js）这四个**局部区域**；第 3 节的矩阵已证明这些区域在两侧**逐字节相同**，漂移发生在**这些区域之外**（部署侧多出 hourly 粒度、趋势 gear、settingsScope、peakRing 等）。
- 因此：**不需要「用某一侧覆盖另一侧」，也不需要三路合并**；两侧各自独立应用同一份补丁即可。
- ⚠️ 仍然禁止的用法：拿 source 的整份 `client.js`/`charts.js` 覆盖 deployed —— 会丢掉部署侧的hourly 粒度 / 趋势 gear / settingsScope / peakRing 等已上线功能（charts.js 更夸张：176 行 vs 602 行）。

