#!/usr/bin/env node
/**
 * repro-cc-cursor.mjs — 用**真实** ingest-cc.js / db.js 复现 CC 游标 off-by-one 的实际后果。
 *
 * 待判定的两种解读（结论性质完全不同）：
 *   X「增量分支永久失效、每轮全量重扫」→ 只是 CPU 浪费
 *   Y「增量分支是活的，但 offset = 旧size+1 跳过新内容首字节」→ **每次追加静默丢第一条记录**
 *
 * 隔离：不使用真实 CC root、不使用真实 usage.db、不调用 resolveDbPath；
 * 只把真实模块当库用，全部路径在 .workspace/lag-fix/research-v2/cc-cursor/ 下。
 */
import { mkdirSync, writeFileSync, appendFileSync, rmSync, utimesSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i === -1 ? d : process.argv[i + 1]; };
// 默认测**已部署件**（未修版本）；用 --lib 指向其它实现（如修好的 source）即可对拍。
const LIB = argOf('--lib', '/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib');
const tag = argOf('--tag', 'deployed');
const { openUsageDb, ensureSchema } = await import(`file://${LIB}/db.js`);
const { foldCcSource } = await import(`file://${LIB}/ingest-cc.js`);
console.log(`[lib] ${LIB}  (tag=${tag})`);

const scratch = resolve(HERE, `scratch-${tag}`);
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

writeFileSync(file, rec('msg-A', '2026-09-21T06:00:00.000Z', 100));

const db = await openUsageDb(dbPath);
ensureSchema(db);

const count = () => Number(db.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE data_source='cc'").get().n);
const state = () => db.prepare('SELECT mtime, size, last_offset FROM sync_state WHERE source = ?').get(`cc:${file}`);

// ── pass 1：全量 ────────────────────────────────────────────────────────────
const r1 = foldCcSource(db, root);
const s1 = state();
const size1 = state() ? s1.size : null;
console.log('pass1:', JSON.stringify({ events: count(), scanned: r1.scanned, newEvents: r1.newEvents, failed: r1.failedFiles }));
console.log('pass1 state:', JSON.stringify(s1), ' 文件实际大小:', size1);
console.log(`  → last_offset(= ${s1.last_offset}) 是否等于 size+1：${s1.last_offset === s1.size + 1}`);

// ── 追加一条新记录（模拟 CC 继续写），并保证 mtime 变化 ────────────────────
const beforeSize = s1.size;
appendFileSync(file, rec('msg-B', '2026-09-21T06:05:00.000Z', 200));
const future = new Date(Date.now() + 2000);
utimesSync(file, future, future);

// ── pass 2：应当只读新增部分 ───────────────────────────────────────────────
const r2 = foldCcSource(db, root);
const s2 = state();
const afterSize = s2.size;
console.log('\npass2:', JSON.stringify({ events: count(), scanned: r2.scanned, newEvents: r2.newEvents, failed: r2.failedFiles }));
console.log('pass2 state:', JSON.stringify(s2));
console.log(`  本轮 offset 取值 = ${beforeSize >= s1.last_offset ? s1.last_offset : 0}（= 旧 last_offset）；新内容首字节位于 ${beforeSize}`);

const finalCount = count();
const verdict = finalCount === 2 ? 'NO_LOSS' : finalCount === 1 ? 'LOSS_CONFIRMED' : `UNEXPECTED(${finalCount})`;
console.log(`\n[verdict] ${verdict}  期望 2 条事件，实得 ${finalCount}`);
console.log(verdict === 'LOSS_CONFIRMED'
  ? '  ⇒ 解读 Y 成立：增量为活，但游标多 1 字节，追加批次的第一条记录被静默丢弃（表现为 failedFiles 的 unparsable JSON lines）'
  : '  ⇒ 未复现丢失，需要重新检查游标语义');
writeFileSync(resolve(HERE, `repro-result-${tag}.json`), JSON.stringify({ size1, s1, r1, afterSize, s2, r2, finalCount, verdict }, null, 2) + '\n');
db.close();
process.exit(0);
