import { Worker } from "node:worker_threads";
import { join } from "node:path";
const p = join(process.cwd(), "scratch/probe-w4.js");
try {
  const w = new Worker(p, { type: "module" });
  const v = await new Promise((res, rej) => { w.once("message", res); w.once("error", rej); });
  console.log(JSON.stringify({ withTypeModule: v }));
  await w.terminate();
} catch (e) { console.log(JSON.stringify({ withTypeModule: "ERR " + e.message })); }
try {
  const w2 = new Worker(p);
  const v = await new Promise((res, rej) => { w2.once("message", res); w2.once("error", rej); });
  console.log(JSON.stringify({ withoutType: v }));
  await w2.terminate();
} catch (e) { console.log(JSON.stringify({ withoutType: "ERR " + e.message })); }
