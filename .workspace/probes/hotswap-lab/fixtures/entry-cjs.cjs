
// CJS entry v1 —— require ESM dep
async function loadDep() {
  const dep = await import("./dep-esm.mjs");
  return dep;
}
module.exports = {
  entryVersion: 1,
  compute: async (x) => x * (await loadDep()).factor,
};
