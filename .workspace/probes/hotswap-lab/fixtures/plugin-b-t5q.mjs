
// ESM 纯函数插件 v201
let count = 0;
export const version = 201;
export function compute(x) { return x * 201; }
export function bump() { return ++count; }
export function getCount() { return count; }
export default { version: 201, compute, bump, getCount, name: "pluginB" };
