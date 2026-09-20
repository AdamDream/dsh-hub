
// ESM entry v1 —— import CJS dep
import dep from "./dep-cjs.cjs";
export const entryVersion = 1;
export function compute(x) { return x * dep.factor; }
export const factorFromDep = () => dep.factor;
export default { entryVersion: 1, compute, factorFromDep };
