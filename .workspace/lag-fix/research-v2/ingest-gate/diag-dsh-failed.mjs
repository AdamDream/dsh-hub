#!/usr/bin/env node
/**
 * diag-dsh-failed.mjs — 用**真实** foldDshSource 跑真实 sessions root，找出 failedFiles 是哪些、为什么。
 * 隔离：DB 写在 .workspace 下的临时文件；只读 sessions/；不触碰生产 usage.db、不重启宿主。
 */
import { mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = '/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib';
const { openUsageDb, ensureSchema } = await import(`file://${LIB}/db.js`);
const { foldDshSource } = await import(`file://${LIB}/ingest-dsh.js`);

const scratch = resolve(HERE, 'scratch');
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });
const db = await openUsageDb(resolve(scratch, 'diag.db'));
ensureSchema(db);

const t0 = Date.now();
const res = foldDshSource(db, undefined, {});   // undefined = 真实 sessions root
const dt = Date.now() - t0;

console.log(`fold wall = ${dt} ms`);
console.log(`scanned = ${res.scanned}  newEvents = ${res.newEvents}  failedFiles = ${res.failedFiles.length}`);
if (res.failedFiles.length > 0) {
  console.log('\n=== 失败文件明细（前 20）===');
  for (const f of res.failedFiles.slice(0, 20)) {
    console.log(`  ${String(f.file).replace('/home/CNS2026495165/.dsh/sessions/', '')}`);
    console.log(`     error: ${String(f.error).slice(0, 200)}`);
  }
}
const n = Number(db.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE data_source='dsh'").get().n);
console.log(`\n临时库事件数 = ${n}`);
db.close();
