
// ESM entry v1 —— import ESM dep
import { factor } from "./dep-esm-i.mjs";
export const entryVersion = 1;
export function compute(x) { return x * factor; }
export const factorFromDep = () => factor;
export default { entryVersion: 1, compute, factorFromDep };
