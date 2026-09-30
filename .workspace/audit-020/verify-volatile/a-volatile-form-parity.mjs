/**
 * WP3 / A：修复前 vs 修复后 —— 用 dsh-settings **自己的源码文本**判定
 * 「条目是否被 describe() 收录」与「设置页每条写入路径是否 isVolatilePath 通过」。
 *
 * 关键手法（避免"凭记忆复刻"）：
 *   脚本运行时从 dsh-settings/lib/index.js 直接 **切出 97..158 行源码文本**，
 *   用 new Function 以真实依赖（z / isVolatile / redactSecrets）实例化，
 *   因此 volatileForm / plainSchema / isVolatilePath / projectForm / plainConfig
 *   与被复核的 0.2.0 运行时是同一份字节。
 *
 * 依据行号（0.2.0-rc.2，$B/dsh-settings/lib/index.js）：
 *   97-102  plainConfig        103-117 plainSchema       122-131 volatileForm
 *   141-147 projectForm        153-158 isVolatilePath
 *   418-419 describe(): volatileForm===undefined ⇒ 整条跳过
 *   436     describe(): value = projectForm(form, plainConfig(entry.fiber.config))
 *   505-507 write(): form===undefined ⇒ throw `has no volatile fields`；path 非 volatile ⇒ throw
 *
 * 运行： node a-volatile-form-parity.mjs        （cwd = 本目录，node_modules 软链到 $A/home/profiles/node_modules）
 */
import { readFileSync } from "node:fs";
import { isVolatile } from "@deepseek-ai/cosmokit";
import z from "@deepseek-ai/schemastery";

const A = "/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020";
const B = A + "/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai";
const SETTINGS_INDEX = B + "/dsh-settings/lib/index.js";
const NM = A + "/home/profiles/node_modules";

const out = [];
const log = (s = "") => { out.push(s); console.log(s); };

// ── 1. 从 dsh-settings 源码切出 97..158 行并实例化 ─────────────────────────────
const lines = readFileSync(SETTINGS_INDEX, "utf8").split("\n");
const src = lines.slice(96, 158).join("\n"); // 1-based 97..158
for (const marker of ["function plainConfig(", "function plainSchema(", "function volatileForm(", "function projectForm(", "function isVolatilePath("]) {
  if (!src.includes(marker)) throw new Error(`source slice missing ${marker}`);
}
if (!src.trimEnd().endsWith("}")) throw new Error("source slice does not end at a function boundary");
const { redactSecrets } = await import(SETTINGS_INDEX);
const fns = new Function(
  "z", "isVolatile", "redactSecrets",
  `${src}\nreturn { plainConfig, plainSchema, volatileForm, projectForm, isVolatilePath, isExpression };`,
)(z, isVolatile, redactSecrets);
const { volatileForm, isVolatilePath, plainConfig, projectForm } = fns;

log("# WP3-A 对照表：dsh-settings 原生 volatileForm / isVolatilePath");
log(`源码切片 sha256 输入：${SETTINGS_INDEX}:97-158（${src.length} 字符，逐字实例化）`);
log("");

// ── 2. 用例：改前原件（byte-identical 副本）与改后文件 ─────────────────────────
const CASES = [
  {
    label: "subagent-model 改前（volatile-fix-backup 原件）",
    file: "./before/subagent-model.index.mjs",
    pagePaths: [["provider"], ["model"]],
  },
  {
    label: "subagent-model 改后（$A/home/profiles 现文件）",
    file: NM + "/@local/dsh-subagent-model/lib/index.js",
    pagePaths: [["provider"], ["model"]],
  },
  {
    label: "vision-adam 改前（volatile-fix-backup 原件）",
    file: "./before/vision-adam.index.mjs",
    pagePaths: [["model"], ["baseURL"], ["apiKeyEnv"], ["maxTokens"]],
    nonPagePaths: [["apiKey"], ["maxBytes"], ["maxVideoBytes"], ["xApiKey"], ["sessionHeader"]],
  },
  {
    label: "vision-adam 改后（$A/home/profiles 现文件）",
    file: NM + "/@deepseek-ai/dsh-vision-adam/lib/index.js",
    pagePaths: [["model"], ["baseURL"], ["apiKeyEnv"], ["maxTokens"]],
    nonPagePaths: [["apiKey"], ["maxBytes"], ["maxVideoBytes"], ["xApiKey"], ["sessionHeader"]],
  },
  { label: "对照：官方 dsh-agent-default-model（volatile 官方同形参考）",
    file: B + "/dsh-agent-default-model/lib/index.js", pagePaths: [["provider"], ["model"], ["reasoningEffort"]] },
  { label: "对照：@local/dsh-wallpaper（上一轮同规则修好的先例）",
    file: NM + "/@local/dsh-wallpaper/lib/index.js", pagePaths: [["global"], ["pages"]] },
  { label: "对照：@local/dsh-ssh-gui（上一轮同规则修好的先例）",
    file: NM + "/@local/dsh-ssh-gui/lib/index.js", pagePaths: [["file", "maxBytes"], ["exec", "timeoutMs"], ["security", "confirmExec"]] },
  { label: "对照：@local/dsh-logfile（非 volatile，预期不收录）",
    file: NM + "/@local/dsh-logfile/lib/index.js", pagePaths: [["level"]] },
];

const rows = [];
for (const c of CASES) {
  const mod = await import(c.file);
  const schema = mod.Config ?? mod.default?.Config;
  const form = schema === void 0 ? void 0 : volatileForm(schema);
  const served = form !== void 0; // describe():418-419 收录条件
  const fieldKeys = served ? Object.keys(form.dict ?? {}).map((k) => `${k}${form.dict[k]?.type ? ":" + form.dict[k].type : ""}`) : [];
  const writes = c.pagePaths.map((p) => ({ path: p.join("."), ok: served && isVolatilePath(schema, p) }));
  const nonWrites = (c.nonPagePaths ?? []).map((p) => ({ path: p.join("."), ok: served && isVolatilePath(schema, p) }));
  rows.push({ c, served, fieldKeys, writes, nonWrites, schemaKeys: schema === void 0 ? [] : Object.keys(schema.dict ?? {}) });

  log(`## ${c.label}`);
  log(`   文件: ${c.file}`);
  log(`   条目被 describe() 收录 (volatileForm !== undefined) = ${served}`);
  log(`   表单字段 = ${fieldKeys.length ? fieldKeys.join(", ") : "(无 → 命名空间不进 served 列表 → 客户端 status:'unavailable')"}`);
  for (const w of writes) log(`   设置页写入路径 ${w.path.padEnd(12)} isVolatilePath = ${w.ok}${w.ok ? "" : "   ← write() 会抛 Config field ... is not volatile / entry has no volatile fields"}`);
  for (const w of nonWrites) log(`   （非设置页字段）${w.path.padEnd(14)} isVolatilePath = ${w.ok}${w.ok ? "" : "   ← 预期 false：仍在 cordis.patch.yml 原生编辑"}`);
  log("");
}

// ── 3. 顺带证明 describe()/consumer 的投影链在 volatile 化后仍然产出标量 ────────
// describe():436 value = projectForm(form, plainConfig(entry.fiber.config))
log("## 附：describe():436 投影链（projectForm(form, plainConfig(fiber.config))）在改后 Config 上的行为");
for (const c of CASES.filter((x) => x.label.includes("改后") || x.label.includes("官方"))) {
  const mod = await import(c.file);
  const schema = mod.Config ?? mod.default?.Config;
  const form = schema === void 0 ? void 0 : volatileForm(schema);
  if (form === void 0) continue;
  // 用真实 schemastery 把 plain 配置解析成运行时形态（.volatile() 字段 ⇒ cosmokit 引用对象）
  const sample = {};
  for (const [k, child] of Object.entries(schema.dict ?? {})) {
    sample[k] = { provider: "adam", model: "deepseek-v4-pro", reasoningEffort: "high", baseURL: "https://x/v1",
      apiKeyEnv: "ADAM_API_KEY", maxTokens: 100, apiKey: "sk-literal", maxBytes: 1, maxVideoBytes: 1, xApiKey: true, sessionHeader: true,
      global: { source: "s", darkMask: 0 }, pages: {}, level: 2, maxFiles: 1, orphanWatch: true }[k] ?? child.meta?.default;
  }
  const runtime = z.resolve(sample, schema)[0];
  const volatileKeys = Object.entries(runtime).filter(([, v]) => isVolatile(v)).map(([k]) => k);
  const projected = projectForm(form, plainConfig(runtime));
  log(`   ${c.label}`);
  log(`     运行时 config 中的 volatile 引用字段 = [${volatileKeys.join(", ")}]  (typeof = ${volatileKeys.map((k) => typeof runtime[k]).join(",")})`);
  log(`     describe().value = ${JSON.stringify(projected)}`);
  log(`     全部叶子为普通标量 = ${Object.values(projected).every((v) => v === null || typeof v !== "object")}`);
}
export { out };
