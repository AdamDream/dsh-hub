const A = "/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020";
const mod = await import(A + "/home/profiles/node_modules/@local/dsh-subagent-model/lib/index.js");
console.log("subagent-model Config keys:", Object.keys(mod.Config.dict));
console.log("volatile flags:", Object.fromEntries(Object.entries(mod.Config.dict).map(([k,v])=>[k, v.meta.volatile])));
const z = (await import("@deepseek-ai/schemastery")).default;
console.log("z resolved from:", import.meta.resolve("@deepseek-ai/schemastery"));
const resolved = z.resolve({provider:"adam", model:"deepseek-v4-pro"}, mod.Config)[0];
console.log("resolved:", resolved.provider, typeof resolved.provider, Object.getOwnPropertySymbols(resolved.provider).map(String));
