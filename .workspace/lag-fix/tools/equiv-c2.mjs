#!/usr/bin/env node
/**
 * equiv-c2.mjs — 单元 C2 等价性 / 记忆化契约验证（只读 live 文件；不写 live 树）
 *
 * A. 逻辑复刻对拍（纯函数）
 *    A1 remoteSessionIndex 内层去重：old(O(k²) filter+indexOf) vs new(Set) —
 *       逐项比较 Map 的 key 顺序与 value，覆盖重复 id、空数组、无 cwd、顺序敏感场景。
 *    A2 sessions() 记忆化：old(每次重建) vs new(按快照引用复用) —
 *       逐项比较数组内容/顺序/对象键序，并显式断言「输入未变 → 同一引用」「输入变化 → 新内容」。
 *    A3 反例断言：给出 Set 去重 ≠ 旧式去重的构造性反例，界定"语义一致"的前提。
 *
 * B. 真实 bundle 行为验证（实载 live 与 patched 交付副本，含 __ModuleLoader__ stub）
 *    B1 两份 bundle 可加载且导出面（apply / inject）一致
 *    B2 驱动 patched 的 installSidebarRowBadges，用 byId Proxy 计数投影重建：
 *       同一快照引用重复触发 → 计数不增；换新快照 → 计数 +1
 *    B2c 同一驱动下，用 route placeholder 造真远程会话，断言真实 remoteSessionIndex 输出
 *
 * C. 静态交付物断言（锚点计数 / 字节）
 *
 * 退出码：0 = 全部 PASS；1 = 存在 FAIL
 */
import { readFileSync, existsSync } from "node:fs";

const LIVE = "/home/CNS2026495165/.dsh/profiles/node_modules/dsh-workspace-enhancement/lib/client.js";
const PATCHED = "/home/CNS2026495165/dsh/.workspace/lag-fix/patched/workspace-enhancement.client.js";

let failed = 0;
const pass = (m) => console.log(`[PASS] ${m}`);
const fail = (m) => { failed++; console.log(`[FAIL] ${m}`); };
const info = (m) => console.log(`       ${m}`);

function deepEq(a, b, path = "$") {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b) return `${path}: typeof ${typeof a} !== ${typeof b}`;
  if (a === null || b === null) return `${path}: null 不匹配（${String(a)} vs ${String(b)}）`;
  if (typeof a !== "object") return `${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: 数组性不一致`;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i]))
    return `${path}: 键序/键集不一致 [${ka}] vs [${kb}]`;
  for (const k of ka) { const r = deepEq(a[k], b[k], `${path}.${k}`); if (r) return r; }
  return null;
}
const mapEntries = (m) => [...m.entries()];

// ---------------------------------------------------------------------------
// A. 逻辑复刻
// ---------------------------------------------------------------------------
// 与 live client.js:4053 routeIdOf 同规则的复刻（placeholder 路由根 → connId）
function routeIdOf(path) {
  const match = /(?:dsw-routes|dsh-ssh-routes)[\\/]([^\\/]+)/i.exec(path);
  if (match === null) return void 0;
  const id = match[1];
  if (id === void 0 || !/^[A-Za-z0-9._-]+$/.test(id)) return void 0;
  return id;
}
const R = (conn, rest = "/home/u/p") => `/home/u/.dsh/remote/dsw-routes/${conn}${rest}`;

/** 旧：ids.filter((id, index) => ids.indexOf(id) === index) */
function indexOld(sessions) {
  const localTitles = new Set();
  const byTitle = new Map();
  for (const session of sessions) {
    if (session.title === "") continue;
    const connId = session.cwd !== void 0 ? routeIdOf(session.cwd) : void 0;
    if (connId === void 0) { localTitles.add(session.title); continue; }
    byTitle.set(session.title, [...(byTitle.get(session.title) ?? []), connId]);
  }
  const index = new Map();
  for (const [title, ids] of byTitle) {
    if (localTitles.has(title)) continue;
    const unique = ids.filter((id, index) => ids.indexOf(id) === index);
    if (unique.length === 1 && unique[0] !== void 0) index.set(title, unique[0]);
  }
  return index;
}

/** 新：Array.from(new Set(ids)) + unique.length === 1 */
function indexNew(sessions) {
  const localTitles = new Set();
  const byTitle = new Map();
  for (const session of sessions) {
    if (session.title === "") continue;
    const connId = session.cwd !== void 0 ? routeIdOf(session.cwd) : void 0;
    if (connId === void 0) { localTitles.add(session.title); continue; }
    byTitle.set(session.title, [...(byTitle.get(session.title) ?? []), connId]);
  }
  const index = new Map();
  for (const [title, ids] of byTitle) {
    if (localTitles.has(title)) continue;
    const unique = Array.from(new Set(ids));
    if (unique.length === 1) index.set(title, unique[0]);
  }
  return index;
}

/** 旧 sessions()：每次调用全量重建 */
function sessionsOld(getSnapshot) {
  return () => {
    const state = getSnapshot();
    if (state === void 0) return [];
    return Object.values(state.byId).map((row) => ({
      title: row.displayTitle,
      ...typeof row.cwd === "string" ? { cwd: row.cwd } : {}
    }));
  };
}

/** 新 sessions()：按快照引用记忆化（逐字复刻 patched 交付副本的闭包） */
function sessionsNew(getSnapshot) {
  let cachedState;
  let cachedRows = [];
  return () => {
    const state = getSnapshot();
    if (state === cachedState) return cachedRows;
    cachedState = state;
    cachedRows = state === void 0 ? [] : Object.values(state.byId).map((row) => ({
      title: row.displayTitle,
      ...typeof row.cwd === "string" ? { cwd: row.cwd } : {}
    }));
    return cachedRows;
  };
}

console.log("=== A. 逻辑复刻对拍（证据 A） ===");
{
  const cases = [
    ["空数组（k=0）", []],
    ["单条远程会话", [{ title: "T", displayTitle: "T", cwd: R("conn1") }]],
    ["重复 id ×3（同一 place 反复入列）", [
      { title: "T", displayTitle: "T", cwd: R("conn1") },
      { title: "T", displayTitle: "T", cwd: R("conn1") },
      { title: "T", displayTitle: "T", cwd: R("conn1") }
    ]],
    ["重复 id + 另一 connId（歧义 → 丢弃）", [
      { title: "T", displayTitle: "T", cwd: R("connA") },
      { title: "T", displayTitle: "T", cwd: R("connB") },
      { title: "T", displayTitle: "T", cwd: R("connA") }
    ]],
    ["顺序敏感：aaa 先于 bbb，各 2 次", [
      { title: "T", displayTitle: "T", cwd: R("aaaa") },
      { title: "T", displayTitle: "T", cwd: R("bbbb") },
      { title: "T", displayTitle: "T", cwd: R("aaaa") },
      { title: "T", displayTitle: "T", cwd: R("bbbb") }
    ]],
    ["顺序敏感：唯一 id 在第 4 位", [
      { title: "T", displayTitle: "T", cwd: R("aaaa") },
      { title: "T", displayTitle: "T", cwd: R("aaaa") },
      { title: "T", displayTitle: "T", cwd: R("aaaa") },
      { title: "T", displayTitle: "T", cwd: R("cccc") }
    ]],
    ["local/无 cwd 标题撞名 → 丢弃", [
      { title: "T", displayTitle: "T", cwd: void 0 },
      { title: "T", displayTitle: "T", cwd: R("conn1") }
    ]],
    ["cwd 无 placeholder → 计入 localTitles", [
      { title: "T", displayTitle: "T", cwd: "/plain/local" },
      { title: "T", displayTitle: "T", cwd: R("conn1") }
    ]],
    ["空标题跳过", [{ title: "", displayTitle: "T", cwd: R("conn1") }, { title: "K", displayTitle: "K", cwd: R("conn9") }]],
    ["多标题 Map 插入顺序固定", [
      { title: "C", displayTitle: "C", cwd: R("cc") }, { title: "A", displayTitle: "A", cwd: R("aa") },
      { title: "B", displayTitle: "B", cwd: R("bb") }, { title: "A", displayTitle: "A", cwd: R("aa") }
    ]],
    ["缺 cwd 字段（undefined）", [{ title: "T", displayTitle: "T" }, { title: "U", displayTitle: "U", cwd: R("u1") }]],
    ["非法 connId 字符（正则拒绝）", [{ title: "T", displayTitle: "T", cwd: "/x/dsw-routes/bad id/x" }]],
    ["k=1 单条重复 id", [{ title: "T", displayTitle: "T", cwd: R("x") }]]
  ];
  let ok = 0;
  for (const [name, sessions] of cases) {
    const d = deepEq(mapEntries(indexOld(sessions)), mapEntries(indexNew(sessions)));
    if (d) fail(`A1 ${name}: ${d}`); else ok++;
  }
  if (ok === cases.length) pass(`A1 remoteSessionIndex：${ok}/${cases.length} 用例逐项一致（Map 的 key 顺序 + value）`);

  // 边界：ids 含重复时确认走的是真去重路径（否则用例形同虚设）
  const probe = indexNew([
    { title: "P", displayTitle: "P", cwd: R("dup") }, { title: "P", displayTitle: "P", cwd: R("dup") }
  ]);
  if (probe.get("P") === "dup" && probe.size === 1) pass("A1 有效用例校验：'P' 两条同 conn → 去重后 size=1 且 value='dup'");
  else fail(`A1 有效用例校验失败：size=${probe.size} value=${probe.get("P")}`);
}

{
  const mkState = (rows) => ({ byId: Object.fromEntries(rows.map((r, i) => [`s${i}`, r])) });
  const states = [
    ["byId 空", mkState([])],
    ["单行带 cwd", mkState([{ displayTitle: "a", cwd: "/p" }])],
    ["单行无 cwd（cwd 键必须缺席）", mkState([{ displayTitle: "a" }])],
    ["cwd 非字符串（null / number / 空串）", mkState([{ displayTitle: "a", cwd: null }, { displayTitle: "b", cwd: 7 }, { displayTitle: "c", cwd: "" }])],
    ["多行混合 + 顺序", mkState([{ displayTitle: "x" }, { displayTitle: "y", cwd: "/q" }, { displayTitle: "z", cwd: void 0 }, { displayTitle: "w", cwd: "" }])],
    ["行内键序不同（cwd 在前）", mkState([{ cwd: "/r", displayTitle: "k", extra: 1 }])],
    ["displayTitle 空串", mkState([{ displayTitle: "", cwd: "/s" }])],
    ["displayTitle undefined", mkState([{ cwd: "/t" }])]
  ];
  let ok = 0;
  for (const [name, st] of states) {
    const d = deepEq(sessionsOld(() => st)(), sessionsNew(() => st)());
    if (d) fail(`A2 ${name}: ${d}`); else ok++;
  }
  if (ok === states.length) pass(`A2 sessions()：${ok}/${states.length} 用例逐项一致（含键集：无 cwd 的行不得出现 cwd 键）`);
}

{
  let cur = { byId: { s0: { displayTitle: "A", cwd: "/one" } } };
  const fn = sessionsNew(() => cur);
  const r1 = fn(), r2 = fn(), r3 = fn();
  if (r1 === r2 && r2 === r3) pass("A2-memo 输入未变：连续 3 次调用返回同一数组引用");
  else fail("A2-memo 输入未变：引用不一致（记忆化失效）");
  const snap = JSON.stringify(r1);
  if (snap === JSON.stringify([{ title: "A", cwd: "/one" }])) pass(`A2-memo 内容正确：${snap}`);
  else fail(`A2-memo 内容不符：${snap}`);

  cur.byId.s0.displayTitle = "MUTATED";
  const r4 = fn();
  if (r4 === r1 && JSON.stringify(r4) === snap)
    pass("A2-memo 边界（显式声明）：同一引用下原地改内容不触发重建 —— 记忆化键=引用，不深比较");
  else fail("A2-memo 边界：同引用原地改内容却触发重建（与设计不符）");

  cur = { byId: { s0: { displayTitle: "B" }, s1: { displayTitle: "C", cwd: "/two" } } };
  const r5 = fn();
  if (r5 !== r1) pass("A2-memo 输入变化：返回新数组引用（不复用旧结果）");
  else fail("A2-memo 输入变化：仍返回旧引用（记忆化失效）");
  const want = JSON.stringify([{ title: "B" }, { title: "C", cwd: "/two" }]);
  if (JSON.stringify(r5) === want) pass("A2-memo 输入变化：内容按新快照重建且键序一致");
  else fail(`A2-memo 输入变化：内容不符 ${JSON.stringify(r5)} != ${want}`);

  const oldFn = sessionsOld(() => cur);
  if (oldFn() !== oldFn()) pass("A2-memo 对照：老实现两次调用返回不同数组（内容相同、引用不同 = 改动的真实差异）");
  else fail("A2-memo 对照：老实现竟返回同一引用（对拍无效）");

  // 快照切换时序对拍：old 与 new 在「每次调用前快照可能变」的序列上内容必须一致
  const seq = [];
  let st = { byId: { s0: { displayTitle: "1" } } };
  const oFn = sessionsOld(() => st), nFn = sessionsNew(() => st);
  const push = () => { seq.push([JSON.stringify(oFn()), JSON.stringify(nFn())]); };
  push();
  st = { byId: { s0: { displayTitle: "2" }, s2: { displayTitle: "3", cwd: "/z" } } }; push();
  push();
  st = { byId: {} }; push();
  const seqOk = seq.every(([a, b]) => a === b);
  if (seqOk) pass(`A2-memo 时序对拍：${seq.length} 步（含同快照连打/换快照/清空）内容序列一致`);
  else fail(`A2-memo 时序对拍不一致：${JSON.stringify(seq)}`);
}

{
  const ids = [NaN, NaN];
  const oldU = ids.filter((id, index) => ids.indexOf(id) === index);
  const newU = Array.from(new Set(ids));
  if (oldU.length === 0 && newU.length === 1)
    pass("A3 NaN 反例：旧式去重把 NaN 全部丢弃（0 项），Set 保留 1 项 → 二者不等价（实测 indexOf(NaN) = -1）");
  else fail(`A3 反例构造失败：old=${oldU.length} new=${newU.length}`);
  const s = ["a", "a", "", "", "b"];
  const d = deepEq(s.filter((x, i) => s.indexOf(x) === i), Array.from(new Set(s)));
  if (!d) pass("A3 字符串域：'' 与重复串上两者等价（故等价性依赖「ids 元素恒为字符串」）");
  else fail(`A3 字符串域不等价：${d}`);
  const d2 = deepEq([].filter((x, i) => [].indexOf(x) === i), Array.from(new Set([])));
  if (!d2) pass("A3 空数组：两者均为 []");
  else fail(`A3 空数组不等价：${d2}`);
}

// ---------------------------------------------------------------------------
// B. 真实 bundle 驱动
// ---------------------------------------------------------------------------
console.log("=== B. 真实 bundle 行为验证（证据 B） ===");
const liveSrc = readFileSync(LIVE, "utf8");
const patchedSrc = readFileSync(PATCHED, "utf8");

function makeStubs() {
  const node = () => ({
    dataset: {}, style: {}, children: [], textContent: "", title: "",
    getAttribute: () => null, setAttribute: () => {}, removeAttribute: () => {},
    appendChild: () => {}, append: () => {}, remove: () => {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    addEventListener: () => {}, isConnected: true, parentElement: null
  });
  return {
    document: {
      body: node(), head: node(), documentElement: node(), activeElement: null,
      createElement: () => node(), addEventListener: () => {}, removeEventListener: () => {},
      querySelector: () => null, querySelectorAll: () => [], contains: () => false
    },
    MutationObserver: class { observe() {} disconnect() {} },
    Element: class {}, HTMLElement: class {}
  };
}

/** 载入 bundle，返回 exports（factory 内联 module/exports，必须由外层壳取其返回值） */
function bootBundle(src) {
  const stubs = makeStubs();
  const req = () => new Proxy({}, { get: () => () => null });
  const shell = new Function(
    "window", "require", "document", "MutationObserver", "Element", "HTMLElement", "setInterval", "setTimeout",
    `let __c; window.__ModuleLoader__={load(e){__c=e;}};\n${src}\nreturn __c.factory(require);`
  );
  return shell({ __ModuleLoader__: { load() {} } }, req, stubs.document, stubs.MutationObserver,
    stubs.Element, stubs.HTMLElement, () => 0, () => 0);
}

{
  let a = null, b = null, ea = null, eb = null;
  try { a = bootBundle(liveSrc); } catch (error) { ea = error; }
  try { b = bootBundle(patchedSrc); } catch (error) { eb = error; }
  const shape = (e) => e === null || e === void 0 ? "null"
    : `apply=${typeof e.apply},inject=${Array.isArray(e.inject) ? `array(${e.inject.length})` : typeof e.inject}`;
  if (ea) fail(`B1 live bundle 加载抛错：${ea.message}`); else pass(`B1 live bundle 加载成功：${shape(a)}`);
  if (eb) fail(`B1 patched bundle 加载抛错：${eb.message}`);
  else if (shape(a) === shape(b) && typeof b.apply === "function") pass(`B1 patched 加载成功且导出面一致：${shape(b)}`);
  else fail(`B1 导出面不一致：live ${shape(a)} vs patched ${shape(b)}`);
}

/**
 * 驱动 patched 的 installSidebarRowBadges：用 Proxy 包住 state.byId 计数 Object.values 调用
 * （sessions() 记忆化未命中才会 Object.values(byId)；命中则提前 return cachedRows）。
 */
function drivePatched(initialState) {
  let state = initialState;
  const sessionSubs = new Set();
  const workspaceSubs = new Set();
  let projections = 0;
  const wrapped = (s) => new Proxy(s, {
    ownKeys(target) { projections++; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) {
      const d = Reflect.getOwnPropertyDescriptor(target, key);
      return d === void 0 ? void 0 : { ...d, enumerable: true };
    }
  });
  state = { byId: wrapped(state.byId) };
  const getSnapshot = () => state;
  const subscribe = (fn) => { sessionSubs.add(fn); fn(); return () => sessionSubs.delete(fn); };
  const stubs = makeStubs();
  const req = () => new Proxy({}, { get: () => () => null });
  const shell = new Function(
    "window", "require", "document", "MutationObserver", "Element", "HTMLElement", "setInterval", "setTimeout",
    `let __c; window.__ModuleLoader__={load(e){__c=e;}};\n${patchedSrc}\nreturn __c.factory(require);`
  );
  const exp = shell({ __ModuleLoader__: { load() {} } }, req, stubs.document, stubs.MutationObserver,
    stubs.Element, stubs.HTMLElement, () => 0, () => 0);

  const registered = { slots: [] };
  const ctx = {
    get: (k) => {
      if (k === "sessions") return { list: { getSnapshot, subscribe } };
      // workspacesFeed 的订阅同样接到 installRowBadges 的同一个 onChange 上
      // （live: const un2 = workspacesFeed?.subscribe(onChange)）
      if (k === "workspaces") return {
        list: {
          getSnapshot: () => ({ items: [] }),
          subscribe: (fn) => { workspaceSubs.add(fn); return () => workspaceSubs.delete(fn); }
        }
      };
      return void 0;
    },
    locale: { bind: () => (() => ""), subscribe: () => () => {} },
    slots: { inject: () => {}, register: (spec) => { registered.slots.push(spec); return () => {}; } },
    workspaces: { listDirectory: async () => ({}), createDirectory: async () => ({}) },
    effect: () => {}
  };
  exp.apply(ctx);
  return {
    projections: () => projections,
    setState: (next) => { state = { byId: wrapped(next.byId) }; },
    fire: () => { for (const fn of [...sessionSubs]) fn(); },
    fireWorkspaces: () => { for (const fn of [...workspaceSubs]) fn(); },
    subCount: () => sessionSubs.size,
    wsSubCount: () => workspaceSubs.size
  };
}

{
  const h = drivePatched({ byId: { s0: { displayTitle: "A", cwd: "/one" } } });
  const p0 = h.projections();
  if (h.subCount() >= 1) pass(`B2 驱动成功：apply(ctx) 无异常，sessions 订阅数=${h.subCount()}，apply 期投影重建 ${p0} 次`);
  else fail("B2 未拿到 sessions 订阅回调（探针失配）");

  h.fire();
  const p1 = h.projections();
  if (p1 === p0) pass(`B2 同一快照引用重复触发 onChange：投影重建计数不变（${p0} → ${p1}）= 记忆化命中`);
  else fail(`B2 同一快照引用重复触发 onChange：计数增加（${p0} → ${p1}）= 记忆化未生效`);

  h.fire();
  const p2 = h.projections();
  if (p2 === p0) pass(`B2 第三次触发同快照：计数仍为 ${p2}（稳定复用）`);
  else fail(`B2 第三次触发同快照：计数 ${p2}`);

  h.setState({ byId: { s0: { displayTitle: "A", cwd: "/one" }, s1: { displayTitle: "B" } } });
  h.fire();
  const p3 = h.projections();
  if (p3 === p0 + 1) pass(`B2 换新快照触发 onChange：计数 +1（${p0} → ${p3}）= 按引用失效正确`);
  else fail(`B2 换新快照触发 onChange：计数 ${p0} → ${p3}（期望 +1）`);

  // B2d：workspaces feed 的 onChange（sessions 快照不变）—— 这正是 sessions() 记忆化唯一省成本的场景
  if (h.wsSubCount() >= 1) {
    const pw0 = h.projections();
    h.fireWorkspaces();
    const pw1 = h.projections();
    if (pw1 === pw0) pass(`B2d workspaces 订阅触发同一 onChange（sessions 快照未变）：投影重建计数不变（${pw0} → ${pw1}）= 记忆化命中`);
    else fail(`B2d workspaces 订阅触发 onChange：计数 ${pw0} → ${pw1}（记忆化未生效）`);
    h.fireWorkspaces();
    if (h.projections() === pw0) pass("B2d 再次 workspaces 订阅触发：计数仍不变（稳定命中）");
    else fail(`B2d 再次 workspaces 触发：计数 ${h.projections()}`);
    info("B2d 是 live 中 rebuildRemote 被重复调用的唯一途径：sources.sessions() 调用点仅");
    info("     remoteSessionIndex(sources.sessions()) @4222，而 rebuildRemote 仅在 onChange @4414 内被调用；");
    info("     onChange 挂在 sessions 与 workspaces 两个订阅上 → 仅 workspaces 侧变化时命中记忆化。");
  } else {
    fail("B2d 未能观察到 workspaces 订阅注册（探针失配）");
  }
}

{
  // B2c：真远程会话（route placeholder）驱动 patched，走真实 remoteSessionIndex（Set 版）不抛错
  const h = drivePatched({ byId: {} });
  h.setState({
    byId: {
      a: { displayTitle: "RT", cwd: R("conn1") },
      b: { displayTitle: "RT", cwd: R("conn1") },
      c: { displayTitle: "AMB", cwd: R("cA") },
      d: { displayTitle: "AMB", cwd: R("cB") },
      e: { displayTitle: "LOCAL", cwd: "/plain" },
      f: { displayTitle: "LOCAL", cwd: R("conn2") },
      g: { displayTitle: "" }
    }
  });
  let threw = null;
  try { h.fire(); } catch (error) { threw = error; }
  if (threw === null) pass("B2c patched 在真远程会话数据上运行 remoteSessionIndex（Set 版）无异常");
  else fail(`B2c patched 运行 remoteSessionIndex 抛错：${threw.message}`);

  // 同一数据喂两份 bundle，断言"未抛错"层面等价（不测内部 Map，因闭包不可达）
  const hl = (() => {
    const stubs = makeStubs();
    const req = () => new Proxy({}, { get: () => () => null });
    const shell = new Function("window", "require", "document", "MutationObserver", "Element", "HTMLElement", "setInterval", "setTimeout",
      `let __c; window.__ModuleLoader__={load(e){__c=e;}};\n${liveSrc}\nreturn __c.factory(require);`);
    const exp = shell({ __ModuleLoader__: { load() {} } }, req, stubs.document, stubs.MutationObserver, stubs.Element, stubs.HTMLElement, () => 0, () => 0);
    const subs = new Set();
    let state = { byId: {} };
    const ctx = {
      get: (k) => k === "sessions" ? { list: { getSnapshot: () => state, subscribe: (fn) => { subs.add(fn); fn(); return () => subs.delete(fn); } } }
        : k === "workspaces" ? { list: { getSnapshot: () => ({ items: [] }), subscribe: () => () => {} } } : void 0,
      locale: { bind: () => (() => ""), subscribe: () => () => {} },
      slots: { inject: () => {}, register: () => () => {} },
      workspaces: { listDirectory: async () => ({}), createDirectory: async () => ({}) },
      effect: () => {}
    };
    exp.apply(ctx);
    state = { byId: { a: { displayTitle: "RT", cwd: R("conn1") }, c: { displayTitle: "AMB", cwd: R("cA") }, d: { displayTitle: "AMB", cwd: R("cB") } } };
    return () => { for (const fn of [...subs]) fn(); };
  })();
  let lThrew = null;
  try { hl(); } catch (error) { lThrew = error; }
  if (lThrew === null) pass("B2c live（旧 O(k²) 版）在相同数据上同样无异常 —— 行为面等价");
  else fail(`B2c live 版抛错：${lThrew.message}（说明 B2c 不是有效对拍）`);
  info("说明：patched 实例内 remoteSessionIndex 的返回 Map 位于闭包内、外部不可达，");
  info("     故其逐项等价性由 A1 复刻对拍证明；B2/B2c 只证明真实运行期不抛错 + 记忆化命中/失效行为。");
}

// ---------------------------------------------------------------------------
console.log("=== C. 静态交付物断言 ===");
{
  const count = (s, t) => s.split(t).length - 1;
  const C1_FROM = "const unique = ids.filter((id, index) => ids.indexOf(id) === index);";
  const C1_TO = "const unique = Array.from(new Set(ids));";
  const C2_FROM = "sessions: () => {\n\t\t\t\t\tconst state = sessionsFeed?.getSnapshot();";
  const C2_TO = "sessions: (() => {";
  if (count(liveSrc, C1_FROM) === 2 && count(patchedSrc, C1_FROM) === 1)
    pass("C1 锚点 2→1：仅 remoteSessionIndex 被替换，remoteWorkspaceIndex 保留旧实现");
  else fail(`C1 锚点计数异常：live=${count(liveSrc, C1_FROM)} patched=${count(patchedSrc, C1_FROM)}`);
  if (count(patchedSrc, C1_TO) === 1) pass("C1 新 token 在 patched 中唯一");
  else fail(`C1 新 token 计数 ${count(patchedSrc, C1_TO)}`);
  if (count(liveSrc, C2_FROM) === 1 && count(patchedSrc, C2_FROM) === 0 && count(patchedSrc, C2_TO) === 1)
    pass("C2 锚点 1→0、新 token 1：sessions() 已改为记忆化闭包");
  else fail(`C2 锚点异常：live(from)=${count(liveSrc, C2_FROM)} patched(from)=${count(patchedSrc, C2_FROM)} patched(to)=${count(patchedSrc, C2_TO)}`);
  info(`字节：live=${liveSrc.length} patched=${patchedSrc.length}（+${patchedSrc.length - liveSrc.length}）`);
  if (existsSync(PATCHED)) pass("交付副本存在：patched/workspace-enhancement.client.js"); else fail("交付副本缺失");
}

console.log(failed === 0 ? "\n===== ALL PASS =====" : `\n===== ${failed} FAIL =====`);
process.exit(failed === 0 ? 0 : 1);
