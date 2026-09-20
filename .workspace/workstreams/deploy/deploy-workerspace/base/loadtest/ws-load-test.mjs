const root = "/home/CNS2026495165/dsh/.workspace/deploy-workerspace/base/loadtest/pkg-ws";
try {
  const m = await import(`${root}/lib/index.js`);
  console.log("OK   dsh-workerspace lib/index.js loads; exports:", Object.keys(m).join(", "));
  console.log("inject:", JSON.stringify(m.inject), "| name:", m.name, "| Config keys:", Object.keys(m.Config.dict ? m.Config.dict : {}));
  const core = await import(`${root}/lib/core.js`);
  console.log("OK   core.js exports:", Object.keys(core).length);
} catch (e) {
  console.log("FAIL", e.message.split("\n")[0]);
  process.exit(1);
}
