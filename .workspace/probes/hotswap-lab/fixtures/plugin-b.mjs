
// ESM 纯函数插件 v3
let count = 0;
export const version = 3;
export function compute(x) { return x * 3; }
export function bump() { return ++count; }
export function getCount() { return count; }
export default { version: 3, compute, bump, getCount, name: "pluginB" };
