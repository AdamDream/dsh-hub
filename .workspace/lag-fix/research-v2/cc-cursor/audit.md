# CC ingest 游标 off-by-one：静默丢记录的实证与最小修复（source 侧已改，未部署）

- 日期：2026-09-21
- 触发来源：ingest 等价性对拍档（`research-v2/ingest-equiv/`）报告 C3/C4
- 本档工作：**独立复核 + 决定性复现 + 最小修复 + 迁移验证**
- 状态：修复已落在 **source**（`dsh-usage/lib/ingest-cc.js`）；**未**部署到 deployed、**未**重启

---

## 1. 结论：对拍档的 C3 成立，但它的 C4 结论被本档**推翻**，真实后果更严重

| 主张 | 判定 | 依据 |
|---|---|---|
| C3 `consumedBytes` 在 `endsWithNewline` 时多算 1 字节，`last_offset` 被写成 `size+1` | ✅ **成立** | 生产 `sync_state` 388 条 cc 行**逐条**满足 `last_offset = size + 1`（抽样 size=501511→501512 等）；隔离复现 pass1 得 `size=242 / last_offset=243` |
| C4「增量分支永久失效、每轮全量重扫」 | ❌ **推翻** | 未变跳过条件是 `state.mtime === mtime && state.size === size`（`ingest-cc.js:149`）。**未变文件根本不读**；**有变更的文件**满足 `size' >= last_offset(=size+1)` ⇒ 增量分支**是活的** |
| 真实后果 | ⚠️ **比"多花 CPU"严重：系统性静默丢记录** | `offset = size+1` 使 `buf.subarray(size+1)` 从新内容**第二个字节**开始解析 → 该行 JSON 解析失败 → 追加批次的第一条记录被丢弃（表现为 `failedFiles: "1 unparsable JSON lines"`）；且游标继续写成新 `size+1`，每轮复现 |

**影响面**：每次某个 CC 文件新增内容，**该批次的第一条记录必丢**（一条 50 条的追加批次丢 1 条 ≈ 2% 系统性少计）；`usage_events` 的 cc 计数因此长期偏低（当前 22,700 条）。这不是"性能项"，是**计费/统计正确性缺陷**。

## 2. 决定性复现（真实函数 + 隔离 DB，不碰真实 root/DB）

脚本：`repro-cc-cursor.mjs`（`--lib` 指向被测实现，`--tag` 命名产物）

```
A) 已部署件（未修）：
   pass1: events=1  size=242  last_offset=243  (== size+1 ✓)
   追加 1 条（文件→484）后 pass2:
     offset 取旧 last_offset=243 → 跳过新内容首字节(242)
     → {"events":1,"newEvents":0,"failed":[{"error":"1 unparsable JSON lines"}]}
   [verdict] LOSS_CONFIRMED

B) 修复实现（source ingest-cc + 真实 deployed db.js）：
   pass1: events=1  size=242  last_offset=242
   pass2: events=2  newEvents=1  failed=[]
   [verdict] NO_LOSS
```

## 3. 最小修复（source 已落地，两处）

```js
// ① 游标不再多算 1 字节
const consumedBytes = endsWithNewline
  ? Buffer.byteLength(text)                                  // ← 原文是 completeLines.join("\n") + "\n"，多算 1
  : Buffer.byteLength(completeLines.join("\n") + "\n");

// ② 遗留游标自愈：生产库里已有 388 条 size+1 的行，不夹回就仍会跳一字节
const legacyOverrun = Number(state.size) + 1 === cursor;
const usable = legacyOverrun ? Number(state.size) : cursor;
offset = size >= usable ? usable : 0;
```

②的必要性经**迁移路径实测**（`repro-legacy-migration.mjs`）：先用**旧实现**留下 `size+1` 游标并追加一条被跳过的记录，再用修复实现跑第二轮：

```
pass1(旧实现): events=1  size=242  last_offset=243
pass2(修复实现): events=2  size=484  last_offset=484  failed=[]
[verdict] SELF_HEAL_PASS
```

即修复不仅止血，还会**把当时被跳过的记录补回来**（无需手工清 `sync_state`）。

## 4. 未做 / 风险

- **未部署**：deployed `ingest-cc.js` 未改；宿主未重启，生产行为未变。
- **未在真实规模验证**：隔离 fixture 是 1 文件 2 记录；真实 388 文件 / ~1GB 规模下"自愈"那一轮会**多读一次**从旧游标到文件尾的内容（一次性成本，之后恢复增量）。
- **同批发现但本档未修**（来自对拍档，本档未独立复核）：`ingest-dsh.js:7/:191` 注释写 `INSERT OR IGNORE` 而实际是 `ON CONFLICT … DO UPDATE WHERE excluded.ts >= old.ts`；同 ts 时**末端记录胜出**（"chunk wins" 只是解析期规则）。
- **部署需重启宿主**：当前 7 条调研线是宿主进程的子代理，**此刻重启会把它们全部打断**，故部署时机必须等调研线收口后再定。

## 5. 建议的落地单元（待批准）

| 单元 | 内容 | 验收 |
|---|---|---|
| U-CC1 | 把上述两处改动以锚点补丁应用到 deployed（pre-image 备份 + `node --check`） | 补丁脚本 dry-run 锚点唯一命中 |
| U-CC2 | 重启宿主使宿主半生效 | `usage/status` ok、`failedCc` 不再随 CC 增长而累加、cc 事件数恢复增长 |
| U-CC3 | 真实规模观察一轮 | 记 `failedCc`、cc 事件增量、ingest 单次耗时（自愈轮会偏大，需区分） |
