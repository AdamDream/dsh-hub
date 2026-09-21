// db.js 桩：只提供真实 index.js 需要的那三个出口，行为由 control 注入。
import { control, sleep } from './control.js';

export function resolveDbPath() {
  return { path: '/tmp/r4-harness/fixture-usage.db', source: 'harness' };
}

export async function openUsageDb(path) {
  await sleep(control.openDelayMs);
  const handle = {
    path,
    closed: false,
    close() {
      if (this.closed) return;
      this.closed = true;
      control.closedCount += 1;
    },
    prepare() {
      return { get: () => ({ n: 0 }) };
    },
  };
  control.openedDbs.push(handle);
  return handle;
}

export function ensureSchema(_db) {
  control.ensureSchemaCalls += 1;
  if (control.schemaShouldThrow) throw new Error('harness: schema boom');
}
