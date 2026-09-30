/**
 * WP3 / C：全 profile 条目「设置页可服务性」登记表
 *
 * 数据源（三级）：
 *  1) 组合后的 profile 条目清单 = $A/logs/dump020.yaml（协调者用 0.2.0 自己的 dump-config 产出，
 *     顶部注释已标注 "patched by .../home/profiles/web/cordis.patch.yml"）。
 *  2) 每个条目的宿主 Config：真跑 `import(name)` 拿到模块，再按 Config / default.Config / 类静态 Config 取 schema，
 *     用 dsh-settings 源码文本实例化的 volatileForm 判定「会不会被 describe() 收录」。
 *  3) 客户端设置页：package.json `dsh.client` + lib/client.js 是否注册 settings.section + configForms.get(<ns>) 的字面量命名空间。
 *  交叉核对：$A/../verify-volatile/describe-live.json（3098 现役宿主 /api/settings/describe 实抓，只读）。
 *
 * 判定口径（工单）：**客户端有设置页 且 宿主 Config 全非 volatile ⇒ 缺口**。
 *
 * 运行： node c-serviceability.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import z from "@deepseek-ai/schemastery";
import { isVolatile } from "@deepseek-ai/cosmokit";

const A = "/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020";
const B = A + "/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai";
const DUMP = A + "/logs/dump020.yaml";
const require_ = createRequire(import.meta.url);

const out = [];
const log = (s = "") => { out.push(s); console.log(s); };

// dsh-settings 原生 volatileForm（源码切片实例化，同 A/B 脚本）
const { redactSecrets } = await import(B + "/dsh-settings/lib/index.js");
const { volatileForm, isVolatilePath } = new Function("z", "isVolatile", "redactSecrets",
  readFileSync(B + "/dsh-settings/lib/index.js", "utf8").split("\n").slice(96, 158).join("\n") +
  "\nreturn { volatileForm, isVolatilePath };",
)(z, isVolatile, redactSecrets);

// ── 1. dump020.yaml → 顶层条目 (id, name) ─────────────────────────────────────
const dumpLines = readFileSync(DUMP, "utf8").split("\n");
const entries = [];
for (let i = 0; i < dumpLines.length; i++) {
  const m = /^- id: (.+)$/.exec(dumpLines[i]);
  if (m === null) continue;
  const id = m[1].trim();
  let name;
  for (let j = i + 1; j < dumpLines.length && /^[ ]{2}\S/.test(dumpLines[j]); j++) {
    const n = /^ {2}name: (.+)$/.exec(dumpLines[j]);
    if (n !== null) { name = n[1].trim().replace(/^['"]|['"]$/g, ""); break; }
  }
  entries.push({ id, name: name ?? "(继承/无 name)", line: i + 1 });
}
log(`# WP3-C 全 profile 条目设置页可服务性登记表`);
log(`条目来源：${DUMP}（顶层 \`- id:\` 共 ${entries.length} 条）`);
log("");

// ── 2. 客户端设置页索引 ────────────────────────────────────────────────────────
const NM = A + "/home/profiles/node_modules";
function packageDir(spec) {
  for (const base of [NM, B, A + "/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules"]) {
    const segments = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    if (existsSync(`${base}/${segments}/package.json`)) return `${base}/${segments}`;
  }
  return undefined;
}
function clientInfo(dir) {
  if (dir === undefined) return { client: false, section: false, ns: [] };
  const pkgPath = `${dir}/package.json`;
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, "utf8")) : {};
  const clientFile = `${dir}/lib/client.js`;
  if (!existsSync(clientFile)) return { client: pkg.dsh?.client !== undefined, section: false, ns: [] };
  const src = readFileSync(clientFile, "utf8");
  const section = /slots\.inject\(\s*"settings\.section"/.test(src) || /name:\s*"settings\.section"/.test(src);
  const ns = new Set();
  const consts = new Map();
  for (const m of src.matchAll(/const\s+([A-Za-z0-9_$]+)\s*=\s*"([^"]*)"/g)) consts.set(m[1], m[2]);
  for (const m of src.matchAll(/configForms\.get\(\s*([^)]*?)\s*\)/g)) {
    const arg = m[1];
    if (/^".*"$/.test(arg)) ns.add(arg.slice(1, -1));
    else if (consts.has(arg)) ns.add(consts.get(arg));
    else ns.add(`<dynamic:${arg}>`);
  }
  return { client: pkg.dsh?.client !== undefined, section, ns: [...ns], dynamic: [...ns].some((n) => n.startsWith("<dynamic")) };
}

// 命名空间 → 哪些包提供设置页（只统计字面量 + 通用动态页）
const pageIndex = new Map();
const allClientPkgs = new Set();
for (const dir of [NM]) {
  // 遍历 profiles/node_modules 下的包（含 symlink 目标）
  const { readdirSync } = await import("node:fs");
  const scopes = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() || d.isSymbolicLink());
  for (const s of scopes) {
    const names = s.name.startsWith("@")
      ? readdirSync(`${dir}/${s.name}`).map((n) => `${s.name}/${n}`)
      : [s.name];
    for (const pkgName of names) {
      const info = clientInfo(`${dir}/${pkgName}`);
      if (!info.client && !existsSync(`${dir}/${pkgName}/lib/client.js`)) continue;
      if (!existsSync(`${dir}/${pkgName}/lib/client.js`)) continue;
      allClientPkgs.add(pkgName);
      for (const ns of info.ns) {
        if (ns.startsWith("<dynamic")) continue;
        if (!pageIndex.has(ns)) pageIndex.set(ns, []);
        pageIndex.get(ns).push(pkgName);
      }
      if (info.dynamic) {
        if (!pageIndex.has("<dynamic-entryId>")) pageIndex.set("<dynamic-entryId>", []);
        pageIndex.get("<dynamic-entryId>").push(pkgName);
      }
    }
  }
}
const dynamicPages = pageIndex.get("<dynamic-entryId>") ?? [];

// ── 3. 逐条目真跑 import 取 Config ─────────────────────────────────────────────
function pickSchema(mod) {
  const candidates = [];
  if (mod?.Config !== undefined) candidates.push(mod.Config);
  if (mod?.default?.Config !== undefined) candidates.push(mod.default.Config);
  for (const v of Object.values(mod ?? {})) {
    if (v !== null && v.Config !== undefined) candidates.push(v.Config);
    if (v !== null && (typeof v === "object" || typeof v === "function") && typeof v.toJSON === "function" && typeof v.type === "string") candidates.push(v);
  }
  // schemastery 的 Schema 实例 typeof === "function"（可调用），故这里同时接受 object/function
  const isSchema = (v) => v !== null && (typeof v === "object" || typeof v === "function") && typeof v.toJSON === "function" && typeof v.type === "string";
  return candidates.find(isSchema);
}
function volatileLeafPaths(schema, prefix = []) {
  if (schema.meta?.volatile) return [prefix.join(".")];
  const acc = [];
  for (const [k, child] of Object.entries(schema.dict ?? {})) acc.push(...volatileLeafPaths(child, [...prefix, k]));
  return acc;
}

const rows = [];
for (const entry of entries) {
  const isPkgName = !entry.name.startsWith("cordis:") && entry.name !== "(继承/无 name)";
  const row = { ...entry, pkg: isPkgName ? entry.name : undefined, client: false, section: false, pageNs: [], hasConfig: false, served: undefined, volatilePaths: [], note: "" };
  if (isPkgName) {
    const dir = packageDir(entry.name);
    const ci = clientInfo(dir);
    row.client = ci.client; row.section = ci.section; row.pageNs = ci.ns;
    try {
      const mod = await import(entry.name);
      const schema = pickSchema(mod);
      row.hasConfig = schema !== undefined;
      if (schema !== undefined) {
        const form = volatileForm(schema);
        row.served = form !== undefined;
        row.volatilePaths = volatileLeafPaths(schema);
      } else {
        row.served = false;
        row.note = "未发现导出 Config";
      }
    } catch (error) {
      row.served = undefined;
      row.note = `import 失败: ${String(error.message).slice(0, 80)}`;
    }
  } else {
    row.note = "非包条目（cordis:group / 继承）";
  }
  rows.push(row);
}

// ── 4. 与现役 3098 宿主实抓的 describe() 交叉核对 ──────────────────────────────
let live = [];
try {
  live = JSON.parse(readFileSync("./describe-live.json", "utf8")).result.value.namespaces.map((n) => n.ns);
} catch { /* 无实抓文件时跳过 */ }
const liveSet = new Set(live);
log(`现役 3098 宿主实抓 /api/settings/describe：${live.length} 个 served 命名空间（只读 GET/POST，未重启宿主）`);
log(`  ${live.join(", ")}`);
log("");

// ── 5. 输出登记表 ─────────────────────────────────────────────────────────────
const isGap = (r) => r.hasPage && r.served === false;
for (const r of rows) {
  const own = r.pkg !== undefined ? pageIndex.get(r.id) : undefined;
  r.hasPage = (own?.length ?? 0) > 0 || r.section && r.pageNs.includes(r.id);
  r.pageBy = own ?? (r.section && r.pageNs.includes(r.id) ? [r.pkg] : []);
  r.inLive = liveSet.has(r.id);
}
log("## 完整登记表（200 条顶层 profile 条目）");
log("");
log("| entry id | 包名 | 有 Config | volatileForm==undefined | 客户端 dsh.client | lib/client.js 注册 settings.section | 设置页命名空间 | 该条目有设置页 | 现役 3098 已 served | 判定 |");
log("|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  const verdict = r.pkg === undefined
    ? "n/a（非包条目）"
    : isGap(r)
      ? "**缺口**：有设置页但宿主 Config 无 volatile ⇒ 设置页必显示 unavailable"
      : r.hasPage && r.served === true
        ? "OK：有设置页且可服务"
        : r.served === true
          ? (r.inLive ? "OK：宿主已 served（通用/自动表单）" : "OK：可 served（本宿主未加载/未收录）")
          : "无设置页（不适用）";
  log(`| ${r.id} | ${r.pkg ?? "—"} | ${r.pkg === undefined ? "—" : r.hasConfig ? "是" : "否"} | ${r.pkg === undefined ? "—" : r.served === undefined ? "import 失败" : r.served ? "否" : "**是**"} | ${r.client ? "有" : "—"} | ${r.section ? "是" : "—"} | ${r.pageNs.length ? r.pageNs.join(" / ") : "—"} | ${r.hasPage ? "是" : "—"} | ${r.inLive ? "是" : "否"} | ${verdict} |`);
}

// ── 6. 缺口清单 ───────────────────────────────────────────────────────────────
// 6.0 客户端设置页索引（字面量命名空间 → 提供页面的包）
log("");
log("## 客户端设置页索引（lib/client.js 里 configForms.get(<字面量命名空间>) 的namespace → 提供方包）");
for (const [ns, pkgs] of [...pageIndex.entries()].sort()) log(`- ${ns} ← ${[...new Set(pkgs)].join(", ")}`);

// 6.1 反查：凡有设置页命名空间的包，其命名空间是否在"磁盘模块可 served"集合里
log("");
log("## 反查：有设置页的命名空间 vs 磁盘模块可 served（同类风险复查，不限于 profile 条目）");
const diskServed = new Set(rows.filter((r) => r.served === true).map((r) => r.id));
for (const [ns, pkgs] of [...pageIndex.entries()].sort()) {
  if (ns === "<dynamic-entryId>") continue;
  const ok = diskServed.has(ns);
  log(`- ${ns.padEnd(38)} 磁盘可 served=${ok ? "是" : "否"}  现役3098 served=${liveSet.has(ns) ? "是" : "否"}  ← ${[...new Set(pkgs)].join(", ")}`);
}

// 6.2 修复前 vs 修复后（用 volatile-fix-backup 原件重算这两条的判定）
log("");
log("## 修复前 / 修复后 判定差异（改前原件 = volatile-fix-backup 的 byte-identical 副本）");
const BEFORE = { "subagent-model": "./before/subagent-model.index.mjs", "vision-adam": "./before/vision-adam.index.mjs" };
for (const [id, file] of Object.entries(BEFORE)) {
  const beforeMod = await import(file);
  const beforeSchema = pickSchema(beforeMod);
  const beforeServed = beforeSchema !== undefined && volatileForm(beforeSchema) !== undefined;
  const nowRow = rows.find((r) => r.id === id);
  log(`- ${id}: 改前 volatileForm!==undefined = ${beforeServed} ⇒ 改前判定 = ${beforeServed ? "OK" : "**缺口**（有设置页但 describe() 整条跳过、write() 抛 has no volatile fields）"}；` +
      `改后 = ${nowRow.served} ⇒ ${isGap(nowRow) ? "**缺口**" : "OK"}`);
}

const noted = rows.filter((r) => r.note !== "");
if (noted.length) {
  log("");
  log(`## 解析备注（import 失败 / 未发现 Config / 非包条目）：共 ${noted.length} 条`);
  for (const r of noted) log(`- ${r.id}（${r.pkg ?? "—"}）：${r.note}`);
}

const gaps = rows.filter(isGap);
log("");
log(`## 缺口清单（判定口径：客户端有设置页 且 宿主 Config 全非 volatile）：共 ${gaps.length} 条`);
for (const g of gaps) log(`- **${g.id}**（${g.pkg}） 设置页=${g.pageBy.join(",")} volatilePaths=[${g.volatilePaths.join(",")}] 现役3098 served=${g.inLive}`);

// ── 7. 交叉核对差异 ───────────────────────────────────────────────────────────
log("");
log("## 交叉核对：脚本判定 'volatileForm!==undefined（应 served）' vs 现役 3098 实抓");
const computed = rows.filter((r) => r.served === true).map((r) => r.id);
log(`  脚本判定应 served：${computed.length} 条`);
log(`  实抓 served：${live.length} 条`);
log(`  仅脚本判定、实抓没有（= 宿主加载的模块与磁盘不一致 / 未加载 / 非唯一地址条目）：${computed.filter((x) => !liveSet.has(x)).join(", ") || "(无)"}`);
log(`  仅实抓有、脚本没判到：${live.filter((x) => !computed.includes(x)).join(", ") || "(无)"}`);

const withPageButUnservedNow = rows.filter((r) => r.hasPage && !r.inLive);
log("");
log(`## 附：有设置页但现役 3098 未 served（重启后应消失的即时缺口）：共 ${withPageButUnservedNow.length} 条`);
for (const r of withPageButUnservedNow) log(`- ${r.id}（${r.pkg}）served(磁盘模块)=${r.served}`);
