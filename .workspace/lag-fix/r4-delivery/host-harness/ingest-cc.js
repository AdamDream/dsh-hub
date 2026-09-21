import { control, sleep } from './control.js';

export async function foldCcSource(_db, _x, opts) {
  control.foldCalls += 1;
  await sleep(control.ingestDelayMs);
  if (opts && typeof opts.onProgress === 'function') opts.onProgress({ scanned: 1, newEvents: 1 });
  return { scanned: 1, newEvents: 1, failedFiles: [] };
}
