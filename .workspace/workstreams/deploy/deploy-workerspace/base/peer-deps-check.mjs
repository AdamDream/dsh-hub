#!/usr/bin/env node
/**
 * peer-deps-check.mjs — 核对 dsh-workspace-enhancement@0.1.2 的
 * `@deepseek-ai/*` peer/deps 范围 vs 本机实际安装版本（0.1.1-rc.2 家族）。
 *
 * 判定口径（与 .workspace/research/local-facts.md §C 一致）：
 *   - 使用本机 DSH 自带的 semver（npm 同源）逐范围实测；
 *   - 带预发布标签的版本要求比较器集合中存在同一 [major,minor,patch] 元组
 *     且带预发布标签的比较器（^0.1.0-rc.6 元组 0.1.0 ≠ 0.1.1 → 不满足）；
 *   - 本 profile 显式配置 autoInstallPeers:false + strict-peer-dependencies 关闭，
 *     peer 不满足 = pnpm 警告不阻断；但 dependencies 不满足会装出第二份实例，
 *     是真正要消除的（单实例原则）。
 *
 * 用法：node peer-deps-check.mjs
 */
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const semver = require("/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/semver");

const BASE_DIR = new URL(".", import.meta.url).pathname;
const basePkg = JSON.parse(readFileSync(join(BASE_DIR, "tarball", "package", "package.json"), "utf8"));
const PROFILE_MODULES = "/home/CNS2026495165/.dsh/profiles/node_modules";

function installedVersion(spec) {
  try {
    const real = realpathSync(join(PROFILE_MODULES, spec, "package.json"));
    return JSON.parse(readFileSync(real, "utf8")).version;
  } catch {
    return undefined; // 未解析（悬空软链或缺失）
  }
}

const rows = [];
const scan = (kind, name, range) => {
  const installed = installedVersion(name);
  const ok = installed !== undefined && semver.satisfies(installed, range, { includePrerelease: true });
  const strict = installed !== undefined && semver.satisfies(installed, range);
  rows.push({ kind, name, range, installed: installed ?? "MISSING", satisfies: ok, strict });
};

for (const [name, range] of Object.entries(basePkg.peerDependencies ?? {})) {
  if (name.startsWith("@deepseek-ai/")) scan("peer", name, range);
}
for (const [name, range] of Object.entries(basePkg.dependencies ?? {})) {
  if (name.startsWith("@deepseek-ai/")) scan("dep", name, range);
}

console.log("dsh-workspace-enhancement@" + basePkg.version + " — @deepseek-ai/* peer/deps vs 本机安装版本");
console.log("判定口径：strict = npm 严格 semver（预发布规则）；satisfies = includePrerelease 放行");
console.log("-".repeat(96));
for (const r of rows) {
  console.log(
    [r.kind.padEnd(4), r.name.padEnd(42), r.range.padEnd(20), String(r.installed).padEnd(12),
     r.strict ? "strict ✓" : r.satisfies ? "prerelease-ok" : "✗ 不满足"].join(" | ")
  );
}
console.log("-".repeat(96));
const deps = rows.filter((r) => r.kind === "dep");
const peers = rows.filter((r) => r.kind === "peer");
console.log(`deps @deepseek-ai 共 ${deps.length} 项：strict 满足 ${deps.filter((r) => r.strict).length}，`
  + `includePrerelease 满足 ${deps.filter((r) => r.satisfies).length}，不满足 ${deps.filter((r) => !r.satisfies).length}`);
console.log(`peers @deepseek-ai 共 ${peers.length} 项：strict 满足 ${peers.filter((r) => r.strict).length}，`
  + `includePrerelease 满足 ${peers.filter((r) => r.satisfies).length}，不满足 ${peers.filter((r) => !r.satisfies).length}`);
console.log("");
console.log("不满足（strict 且 includePrerelease 均否）清单（按 kind）:");
for (const r of rows.filter((r) => !r.satisfies)) {
  console.log(`  - [${r.kind}] ${r.name} 需要 ${r.range}，本机 ${r.installed}`);
}
