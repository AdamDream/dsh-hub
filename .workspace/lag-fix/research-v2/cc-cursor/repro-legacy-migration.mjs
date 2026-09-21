#!/usr/bin/env node
/**
 * repro-legacy-migration.mjs — 验证「遗留游标 self-heal」路径。
 *
 * 生产库 sync_state 里已有 388 条 `last_offset = size + 1` 的遗留行（旧实现的产物）。
 * 本脚本模拟真实演进：
 *   pass1 用**旧实现**（deployed）→ 留下 size+1 游标，并追加一条在旧实现下会被跳过的记录；
 *   pass2 用**修复实现** → 必须 (a) 不再跳字节，(b) 把当时被跳过的那条记录**补回来**。
 * 两个实现共用同一个隔离 DB 文件（不触碰真实 usage.db）。
 */
import { mkdirSync, writeFileSync, appendFileSync, rmSync, utimesSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OLD = '/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib';
const FIXED = resolve(HERE, 'libfixed');

const scratch = resolve(HERE, 'scratch-legacy');
rmSync(scratch, { recursive: true, force: true });
mkdirSync(resolve(scratch, 'ccroot/proj1'), { recursive: true });
const root = resolve(scratch, 'ccroot');
const file = resolve(root, 'proj1/sess.jsonl');
const dbPath = resolve(scratch, 'usage.db');

const rec = (id, ts, input) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    sessionId: 'sess-1',
    cwd: '/tmp/fixture-project',
    message: { id, usage: { input_tokens: input, output_tokens: 7, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  }) + '\n';

const load = async (lib) => {
  const db = await import(`file://${lib}/db.js`);
  const cc = await import(`file://${lib}/ingest-cc.js`);
  return { db, cc };
};

writeFileSync(file, rec('msg-A', '2026-09-21T07:00:00.000Z', 100));

// ── pass1：旧实现（留下 size+1 遗留游标）──────────────────────────────────
const oldLib = await load(OLD);
let db = await oldLib.db.openUsageDb(dbPath);
oldLib.db.ensureSchema(db);
oldLib.cc.foldCcSource(db, root);
let st = db.prepare('SELECT size, last_offset FROM sync_state WHERE source = ?').get(`cc:${file}`);
const count = () => Number(db.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE data_source='cc'").get().n);
console.log(`pass1(旧实现): events=${count()} size=${st.size} last_offset=${st.last_offset}  遗留(${st.last_offset}==size+1)=${st.last_offset === st.size + 1}`);
db.close();

// 追加一条：在旧实现下这一条会被跳过
appendFileSync(file, rec('msg-B', '2026-09-21T07:05:00.000Z', 200));
const future = new Date(Date.now() + 2000);
utimesSync(file, future, future);
const sizeAfterAppend = st.size + rec('msg-B', '2026-09-21T07:05:00.000Z', 200).length;

// ── pass2：修复实现（必须自愈：补回被跳过的记录）──────────────────────────
const fixedLib = await load(FIXED);
db = await fixedLib.db.openUsageDb(dbPath);
const r2 = fixedLib.cc.foldCcSource(db, root);
st = db.prepare('SELECT size, last_offset FROM sync_state WHERE source = ?').get(`cc:${file}`);
const finalCount = count();
console.log(`pass2(修复实现): events=${finalCount} (期望 2：A + 自愈补回的 B)  size=${st.size} last_offset=${st.last_offset}`);
console.log(`  failed=${JSON.stringify(r2.failedFiles)}`);
const ok = finalCount === 2 && st.last_offset === st.size && r2.failedFiles.length === 0;
console.log(`\n[verdict] ${ok ? 'SELF_HEAL_PASS' : 'SELF_HEAL_FAIL'}`);
writeFileSync(resolve(HERE, 'repro-legacy-migration.json'), JSON.stringify({ st, r2, finalCount, ok }, null, 2) + '\n');
db.close();
process.exit(ok ? 0 : 1);
