# p1-hotswap-lab — P1 闸门实验（CJS+ESM 混合纯函数热载）

隔离实验项目，模拟 cordis-plugin-hmr partialReload 的「清 ESM loadCache + CJS require.cache → 重 import → 换纤维 → 失败回滚」管线。

- 宿主：`host/loadHost.js`（LoadHost，对应 loader + hmr partialReload）
- 夹具：`tests/fixtures.js`（CJS/ESM 纯函数插件 + 依赖）
- 测试：T1 CJS 换 / T2 ESM 策略对比 / T3 混合依赖 / T4 回滚 / T5 内存 / T6 module.register 评估 / T7 query 依赖链
- 运行：`npm test`（= `node --expose-internals --expose-gc run-all.mjs`）

Node：v22.23.2（本机运行实例同版本）。生产环境无 `--expose-internals`，走 `node-addon-require-builtin` 取 internal loader——本实验用 `--expose-internals` 等价访问 `internal/modules/esm/loader`，语义一致（只操作 loadCache Map）。

## 环境探针（实测）
- `loadCache instanceof Map` = **false**；ctor = `LoadCache`，原型链 `LoadCache -> SafeMap`，Map 内部槽兼容（`Map.prototype.get/delete/has.call` 可用）——**注意：审计文档称 Node 22/23 是 plain Map，实测 22.23.2 已是 LoadCache（typed slots）**，与 cordis 注释描述的 Node 24 形态一致。
- `LoadCache.delete(url)` 只把 type 槽置 undefined（不移除条目）→ 必须 `Map.prototype.delete.call(loadCache, url)` 才彻底删除（cordis hmr:368-381 的做法在本版本同样必要）。
- `module.constants` 仅含 `compileCacheStatus`——**Node 22 无公开 ESM 缓存清法**。
- `require(esm)` 在 22.23.2 **免 flag 可用**（CJS 依赖 ESM 方向成立）。
- CJS 经 `import()` 装载后**同时**出现在 loadCache 与 require.cache；只清 require.cache → 重 import 仍吃到陈旧模块；双清 → 新鲜（与 cordis hmr:353-367 注释一致）。
