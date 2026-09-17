
// CJS 纯函数插件 v4
let count = 0;
module.exports = {
  version: 4,
  compute: (x) => x * 4,       // v1: x*1, v2: x*2, ...
  bump: () => ++count,                  // 模块级状态：新实例应重新计数
  getCount: () => count,
  name: "pluginA",
};
