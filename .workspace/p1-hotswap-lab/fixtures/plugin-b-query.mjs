
// ESM 纯函数插件 v6
let count = 0;
export const version = 6;
export function compute(x) { return x * 6; }
export function bump() { return ++count; }
export function getCount() { return count; }
export default { version: 6, compute, bump, getCount, name: "pluginB" };
