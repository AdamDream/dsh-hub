/**
 * WP3 / D 附录：重启后这两个条目会不会被 peerDependencies 兼容闸门整条 disable？
 *
 * 用官方 dsh-app-boot 自己导出的 evaluatePluginCompatibility / pluginCompatibilityWarning
 * 跑真实 profile 的 compatibility.json（$A/home/profiles/web/），并对照"无豁免"的假设。
 *
 * 背景（drill 实跑反例）：11:06 的 drill-home 副本里没有 compatibility.json，
 * 官方 stderr 就打印了 `dsh: disabling profile plugin row "vision-adam"`。
 *
 * 运行： node d-restart-compatibility.mjs
 */
import { readFileSync } from "node:fs";
import {
  evaluatePluginCompatibility, getDshRuntimeVersion, pluginCompatibilityWarning, readProfileCompatibility,
} from "@deepseek-ai/dsh-app-boot";

const A = "/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020";
const HOME_PROFILE_DIR = A + "/home/profiles/web";

const out = [];
const log = (s = "") => { out.push(s); console.log(s); };

const runtime = getDshRuntimeVersion();
log(`# WP3-D 附录：peerDependencies 兼容闸门（官方 dsh-app-boot 实跑）`);
log(`运行时版本 getDshRuntimeVersion() = ${runtime}`);
const profile = await readProfileCompatibility(HOME_PROFILE_DIR);
log(`$A/home/profiles/web 的豁免（readProfileCompatibility）= ${JSON.stringify(profile.exemptions)}`);
log(`解析告警 = ${JSON.stringify(profile.warnings ?? [])}`);

for (const [id, pkg] of [
  ["vision-adam", "@deepseek-ai/dsh-vision-adam"],
  ["subagent-model", "@local/dsh-subagent-model"],
]) {
  const manifest = JSON.parse(readFileSync(`${A}/home/profiles/node_modules/${pkg}/package.json`, "utf8"));
  const withEx = evaluatePluginCompatibility(manifest, profile.exemptions, runtime);
  const without = evaluatePluginCompatibility(manifest, {}, runtime);
  log("");
  log(`## ${id}（${pkg}@${manifest.version}）`);
  log(`   peerDependencies(@deepseek-ai/dsh-*) = ${JSON.stringify(manifest.peerDependencies)}`);
  log(`   现状（带 compatibility.json 豁免）：issue=${withEx === undefined ? "无（闸门通过，按普通行加载）" : "有"}` +
      (withEx === undefined ? "" : `  exempted=${withEx.exempted}  peers=${JSON.stringify(withEx.peers)}`));
  log(`   假设（无豁免文件）：issue=${without === undefined ? "无" : "有"}` +
      (without === undefined ? "" : `  ⇒ 该行会被整条 disable：${pluginCompatibilityWarning(without).slice(0, 120)}…`));
}
