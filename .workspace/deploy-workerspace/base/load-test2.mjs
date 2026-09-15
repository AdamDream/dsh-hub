// 静态加载测试：用本机 0.1.1-rc.2 模块树解析 0.1.2 发布物全部 ESM 静态 import。
// 仅验证「import 符号在 rc.2 存在、模块可加载」——不做真 boot（boot 冒烟列入 Runbook）。
const root = "/home/CNS2026495165/dsh/.workspace/deploy-workerspace/base/loadtest/pkg";
const files = ["lib/index.js","lib/plugin.js","lib/web.js","lib/picker.js","lib/runtime.js",
               "lib/filesystem.js","lib/subprocess.js","lib/mixed.js","lib/registry.js",
               "lib/exec-tools.js","lib/hostkey.js","lib/credential.js","lib/client.js"];
const results = [];
for (const f of files) {
  try {
    const m = await import(`${root}/${f}`);
    results.push(`OK    ${f}  (exports: ${Object.keys(m).length})`);
  } catch (e) {
    results.push(`FAIL  ${f}: ${e.message.split("\n")[0]}`);
  }
}
console.log(results.join("\n"));
const fails = results.filter((r) => r.startsWith("FAIL"));
console.log(fails.length === 0 ? "\n静态加载：全部通过" : `\n静态加载：${fails.length} 个失败`);
