/**
 * T1 —— 测量点①：CJS 纯函数模块替换
 * 场景：插件 A 是 CJS 纯函数模块。
 *  1a. 经 import() 装载（cordis 实际路径：loader 一律 import()）→ 清 loadCache + require.cache → 重 import → 换纤维
 *  1b. 经 require() 装载（经典 CJS 宿主）→ 只清 require.cache → 重 require
 * 验证：新值生效、旧状态引用隔离（旧 fiber 的闭包计数不被新实例共享）
 */
import { LoadHost, fileURL } from "../host/loadHost.js";
import { ensureFixtures, writeCjsPlugin, url } from "./fixtures.js";
import { check, summary } from "./assert.js";

ensureFixtures();

async function scenario(loadMode) {
  const host = new LoadHost({ strategy: "internal" });
  const p = writeCjsPlugin(1);
  const spec = url(p);

  // 装载 v1
  let fiber;
  if (loadMode === "import") {
    fiber = await host.load("A", spec);
  } else {
    // require() 装载：先清掉可能被上一场景（import() 双缓存）污染的 require.cache
    delete host.require.cache[p];
    const plugin = host.require(p);
    fiber = { name: "A", plugin, config: {}, disposed: false, api: plugin, dispose() { this.disposed = true; } };
    host.registry.set("A", fiber);
  }
  const v1 = fiber.api;
  check(v1.version === 1 && v1.compute(10) === 10, `[${loadMode}] v1 loaded`, `compute=${v1.compute(10)}`);
  v1.bump(); v1.bump();
  check(v1.getCount() === 2, `[${loadMode}] v1 module-level state = 2`, `count=${v1.getCount()}`);

  // 磁盘改 v2
  writeCjsPlugin(2);

  // 换纤维
  const r = await host.hotSwap("A", spec);
  check(r.ok === true, `[${loadMode}] hotSwap ok`);
  const v2 = r.fiber.api;
  check(v2.version === 2 && v2.compute(10) === 20, `[${loadMode}] v2 compute takes effect`, `compute=${v2.compute(10)}`);
  check(v2.getCount() === 0, `[${loadMode}] v2 fresh module-level state (count=0)`, `count=${v2.getCount()}`);
  v2.bump();
  check(v2.getCount() === 1 && v1.getCount() === 2, `[${loadMode}] old fiber state isolated (old=2 new=1)`, `old=${v1.getCount()} new=${v2.getCount()}`);
  check(v1.compute(10) === 10, `[${loadMode}] old fiber still works with v1 logic`, `old compute=${v1.compute(10)}`);
  check(host.registry.get("A") === r.fiber && r.old !== r.fiber, `[${loadMode}] registry fiber swapped (new != old)`);
  return host;
}

console.log("== T1: CJS pure-function hot swap ==");
await scenario("import");
await scenario("require");
const ok = summary("T1");
process.exitCode = ok ? 0 : 1;
