# P1 闸门实验执行与复核报告——「清 ESM loadCache + CJS require.cache → 重 import → 换纤维」CJS+ESM 混合纯函数热载可行性

- 档位：修订执行复核一体（路由 adam/deepseek-v4-flash）
- 日期：2026-09-16
- 任务：P1——纯函数热载闸门实验（cordis-hmr 模式最小实验），同档自复核
- 裁决输入：调研 E §3.4-4「（B/P1 前置）纯函数模块热载实验……验证 CJS+ESM 混合（CJS bundle 经 `import()` 加载，Node 22/24 双缓存）下清缓存 → 重 import → 新行为生效且旧引用无泄漏；通过后**仅**评估把该实验路径接入 B 的可行性，不直接铺开」；用户裁决"排队做"
- 隔离约束：✓ 全部实验只写 `.workspace/p1-hotswap-lab/` 与本文档；未触碰 live 树 / `~/.dsh` / 全局树任何文件；未使用 sandbox_permissions
- 必读依据：`hotreload-a-loader.md`（§2.2 双缓存、§2.3 hmr:368-385 清缓存+回滚）；`hotreload-c-upstream.md`（cordis-plugin-hmr 1.0.17 热换）；全局树 `cordis-plugin-hmr/lib/index.js`（partialReload :324-435、清缓存 :368-381、回滚 :382-385/420-432）

---

## 0. 结论摘要（TL;DR）

> **闸门：通过（机制可行、稳定、可回滚）——但仅对「纯函数叶子模块」成立，且必须以「真清 loadCache」（internal 策略）为手段；query 缓存击穿（cache-bust URL）存在依赖链失效 + loadCache 条目线性累积两大硬伤，不可作为 B 通道手段。**
>
> **B 通道建议：做——但只做「受限版」：目标限定为农场/插件 lib 下的纯函数子模块（无注册副作用、无模块级单例），换纤维沿用 cordis partialReload 的 registry 替换 + 回滚语义；不碰基础设施插件（Loader/HMR/settings/session）与任何注册/装配型模块。** 前置条件：`loader.internal` 必须可用（生产经 `node-addon-require-builtin` 已可用——运行中实例 HMR 即走此通道）；改造点集中在 `cordis-plugin-hmr`（放开 node_modules 排除/ignored）+ 按模块白名单注册 watch，属「改官方包」范畴，需一次性重启落地（鸡生蛋问题，审计 A 已述，可用通道 4 自举或批处理重启破解）。

**五个测量点判定**：

| 测量点 | 结果 | 证据 |
|---|---|---|
| ① CJS 纯函数替换 | ✅ 可行：新值生效、旧状态引用完全隔离 | T1 16/16；双缓存必须同清（probe） |
| ② ESM 纯函数替换（手段对比） | ✅ internal 真清可行且无泄漏；query 可行但依赖链失效 + 泄漏 | T2 8/8、T7、T5 |
| ③ 混合（CJS 依赖 ESM / ESM 依赖 CJS）替换 | ✅ 可行：依赖进 accepted 集合双清后入口重 import 全链新鲜 | T3 8/8 |
| ④ 失败回滚（新模块抛错 → 保留旧纤维） | ✅ 可行：缓存还原 + 旧纤维保留 + 修复后恢复 | T4 9/9 |
| ⑤ 内存（100/200 次替换） | ✅ internal 无泄漏（loadCache 恒 1、seg2 RSS +0.25MB）；query 泄漏（loadCache 净增 200） | T5 |

**主要技术障碍（如实上报）**：
1. **ESM loadCache 无公开清法**——`module.constants` 只有 `compileCacheStatus`；唯一真清路径是 internal loader（`--expose-internals` 或 `node-addon-require-builtin`，生产已可用）。这是 B 通道的唯一硬前置，且已满足。
2. **`module.register`（loader hooks）不能替代清缓存**——hook 按「唯一 URL」执行一次，同 URL 二次 import 命中 loadCache 后 hook 不重跑、也不感知缓存命中（T6）。
3. **query cache-busting 的隐性硬伤**：相对依赖的 URL 解析会剥掉 query → 依赖链不刷新（T7）；且每个版本 URL 在 loadCache 留条目，长期替换线性累积（T5：200 次 → 净增 200 条目）。
4. **Node 22.23.2 实测 loadCache 已是 `LoadCache`（typed slots）而非审计文档所记的 plain Map**——`LoadCache.delete()` 只置槽不删条目，必须 `Map.prototype.delete.call` 才彻底删除；cordis hmr 的写法（Map.prototype 直调）在本版本完全必要且可用。此为对审计基线的一个事实修正（不改变审计结论，只说明"Node 22/23 plain Map"的描述不适用于 22.23.2）。

---

## 1. 实验设计与实现

### 1.1 隔离项目：`.workspace/p1-hotswap-lab/`

```
p1-hotswap-lab/
  package.json            type: module；npm test = node --expose-internals --expose-gc run-all.mjs
  README.md               运行说明 + 环境探针记录
  host/loadHost.js        微型 loadHost（LoadHost 类）：import/require 装载 → registry 挂纤维 →
                          清缓存 → 重 import → 换纤维 → 回滚；strategies: internal | query
  tests/fixtures.js       CJS/ESM 纯函数插件 + 依赖的磁盘生成器（每测独立文件防进程内 loadCache 串扰）
  tests/assert.js         断言工具
  tests/t1-cjs.mjs        测量点①
  tests/t2-esm.mjs       测量点②（策略对比 + 泄漏观测）
  tests/t3-mixed.mjs     测量点③
  tests/t4-rollback.mjs  测量点④
  tests/t5-memory.mjs    测量点⑤（独立进程分策略，两段观测一次性成本 vs 持续泄漏）
  tests/t6-hook.mjs      module.register 评估
  tests/t7-query-dep.mjs query 策略依赖链失效验证
  run-all.mjs            全量运行器
```

### 1.2 loadHost 与 cordis 机制的对应（逐行映射）

| loadHost 实现 | 对应真实实现 |
|---|---|
| `LoadHost.load()` → import()/require() → unwrapExports → registry.set(name, fiber) | loader import + `loader.unwrapExports`（loader:746-751）+ registry.plugin（loader:532-543） |
| `hotSwap()`：备份两套缓存 → `Map.prototype.delete.call(loadCache,url)` + `delete require.cache[filepath]` → 重 import → 旧纤维 dispose → 新纤维挂 registry → 失败 restore+保留旧纤维 | hmr partialReload :368-381 清缓存、:388 重 import、:406 registry.delete、:393-400 换纤维、:382-385/420-432 回滚 |
| `extraUrls`（accepted 集合：变更文件及其依赖一并清缓存，入口重 import 时依赖按需重解析） | hmr analyzeChanges accepted 集合 + :371-381 对所有 accepted 文件清缓存 |
| fiber = { plugin, config, disposed, api, dispose() } | cordis fiber（config 沿用旧纤维，仿 reload(plugin, oldFiber._config)） |

**换纤维语义**：旧纤维 `dispose()`（模拟 cordis fiber dispose → effect 反注册），registry 指向新纤维；对外暴露的 `api` 全部替换为新模块实例，旧模块闭包/模块级状态不被新实例共享——这是"旧状态引用隔离"的判定载体。

### 1.3 夹具形态（模拟插件 A 是 CJS 纯函数、插件 B 是 ESM）

- `plugin-a.cjs`：CJS，`compute(x)=x*version`（v1:×1、v2:×2…）+ 模块级 `count` 状态（bump/getCount）
- `plugin-b.mjs`：ESM，同样结构
- 混合：`entry-esm.mjs`（ESM 入口 import CJS dep）、`entry-cjs.cjs`（CJS 入口 require ESM dep，动态 import）、`entry-esm-esmdep.mjs`（ESM→ESM 对照）
- 破坏版：模块顶层 `throw`（ESM/CJS 各一）

---

## 2. 观测数据

### 2.0 环境探针（node v22.23.2）

| 探针 | 实测 |
|---|---|
| `loadCache instanceof Map` | **false**；ctor=`LoadCache`，原型链 `LoadCache → SafeMap`，Map 内部槽兼容 |
| `LoadCache.delete(url)` 语义 | 只把 type 槽置 undefined，**不移除条目**（size 不变） |
| `Map.prototype.delete.call(loadCache, url)` | 彻底删除（true）——cordis 写法在本版本必要且可用 |
| `module.constants` | 仅 `compileCacheStatus`——**无公开 ESM 缓存清法** |
| `require(esm)` | 22.23.2 免 flag 可用（CJS→ESM 方向成立） |
| CJS 经 import() 后双缓存 | loadCache **且** require.cache 同时命中；只清 require.cache → 重 import 仍陈旧；双清 → 新鲜（与 hmr:353-367 注释一致） |

### 2.1 测量点①：CJS 纯函数替换（T1，16/16 通过）

- import() 装载与 require() 装载两种宿主形态均验证：
  - v1 装载 → 模块级 count=2 → 磁盘改 v2 → hotSwap → `compute(10)=20`（×2 生效）
  - 新纤维 count=0（模块级状态全新）、旧纤维 count 仍=2 且 `compute(10)=10`（旧逻辑+旧状态完全隔离）
  - registry 已指向新纤维（old ≠ new，old.disposed=true）
- **双缓存同清的实证**：第一次运行时漏清 require.cache（被 import() 污染），require 场景直接吃到 v2——反向证明了"只清一侧会吃到另一侧的陈旧模块"。

### 2.2 测量点②：ESM 纯函数替换 + 手段对比（T2 8/8、T7、T5）

**手段 A：internal 真清（cordis 官方做法）**——`Map.prototype.delete.call(loadCache,url)` 后重 import：
- ✅ v2 生效、旧纤维隔离（T2 internal 3/3）
- ✅ 依赖链全刷新（T7 internal：dep 5→9 后 entry 由 50→90）
- ✅ loadCache 条目恒 1（T5：200 次替换 net=0），无泄漏

**手段 B：query cache-busting（`import(url + '?hr=N')`，不碰 internal）**：
- ✅ 叶子模块自身 v2 生效、旧纤维隔离（T2 query 3/3）
- ❌ **依赖链失效**（T7 query：dep 5→9 后 entry 仍 50）——相对依赖 URL 解析剥掉 query，命中旧缓存；除非给依赖也逐个加 query，但那等于要求源码改写 import 说明符，不可行
- ❌ **loadCache 条目线性累积**（T5 query：1→101→201，200 次净增 200 条目；heap seg2 0.57MB vs internal 0.23MB）——Node 为每个唯一 URL 保留 ModuleJob，长期热载是内存泄漏

**手段 C：module.register（loader hooks）**（T6）：
- 4 次 import()（2 个唯一 URL）→ load hook 只执行 2 次（按唯一 URL 计数）
- 同 URL 二次 import 命中 loadCache，hook 不重跑、也不感知缓存命中
- 结论：**module.register 不能使已缓存 URL 失效**，只能配合 cache-bust URL 或真清 loadCache 使用，单独无法作为热载手段

**判定：ESM 纯函数替换可行的唯一干净手段 = internal 真清 loadCache。**

### 2.3 测量点③：混合替换正确性（T3，8/8 通过）

| 方向 | 场景 | 结果 |
|---|---|---|
| ESM 入口 → CJS dep | dep 2→5，入口+dep 双清 accepted 集合 | ✅ 20→50 |
| CJS 入口 → ESM dep（免 flag require） | dep 3→7 | ✅ 30→70 |
| ESM 入口 → ESM dep（对照） | dep 4→9 | ✅ 40→90 |

- 关键语义（对齐 cordis）：**变更文件（dep）必须进入 accepted 集合**——只清入口缓存不够，入口重 import 时仍会命中 dep 的旧 loadCache；accepted 集合双清（loadCache + require.cache 对每个成员）后入口重 import，依赖按需重解析，全链新鲜。
- CJS→ESM 方向在 22.23.2 无需 flag，混合链路成立。

### 2.4 测量点④：失败回滚（T4，9/9 通过）

- ESM 新版本顶层 throw → hotSwap 返回 ok=false、错误上抛 → **缓存还原（restore 备份）+ 旧纤维保留**（registry.get 仍=旧 fiber，compute 仍 v1 语义）
- CJS 新版本顶层 throw → 同上
- 修复文件后再次 hotSwap → 恢复正常（v3/v4 生效）——证明回滚后缓存未被"半死"模块污染，可继续热载

### 2.5 测量点⑤：内存观测（T5，200 次替换，独立进程）

| 指标 | internal | query |
|---|---|---|
| loadCache 条目 0→100→200 | 1→1→1（net=0） | 1→101→201（net=+200） |
| RSS seg1(0→100) | +7.26MB（一次性 warmup：JIT/解析/写盘） | +7.70MB |
| RSS seg2(100→200) | **+0.25MB（平台期，无持续泄漏）** | +0.75MB |
| heap seg2 | +0.23MB | +0.57MB |
| 平均每次替换 | 0.157ms | 0.185ms |

- internal：seg1 大额=一次性成本（首轮模块解析/文件写盘/GC 噪声），seg2 平台期 → **无泄漏**
- query：seg2 仍线性增长 + loadCache 条目确定累积 → **有泄漏**
- 单次替换毫秒级，热载性能不是问题

---

## 3. 结论判定（闸门）

### 3.1 闸门判定：**通过（受限通过）**

CJS/ESM 混合纯函数热载**机制可行、稳定、可回滚**，前提全部满足：
1. 双缓存（ESM loadCache + CJS require.cache）同清 → 新逻辑生效（T1/T3）
2. 依赖链（含 CJS↔ESM 混合方向）accepted 集合刷新 → 全链正确（T3）
3. 新模块抛错 → 保留旧纤维 + 缓存还原（T4）
4. 反复替换无内存泄漏（internal 手段，T5）
5. 手段收敛：**唯一推荐 = internal 真清 loadCache**（`Map.prototype.delete.call`）；query 与 module.register 均判不可用（T6/T7/T5）

### 3.2 技术障碍清单（如实上报）

| # | 障碍 | 性质 | 影响/对策 |
|---|---|---|---|
| O1 | ESM loadCache **无公开清法**（module.constants 无此面） | 硬约束 | 必须 internal loader（`--expose-internals` 或 `node-addon-require-builtin`）。**生产已满足**：运行中实例 HMR 即经 native addon 取 internal。B 通道无需新造轮子 |
| O2 | CJS 经 import() 双缓存并存，单清一侧吃陈旧 | 硬约束 | 双清（hmr:368-381 写法），本实验已验证 |
| O3 | query cache-busting：依赖链剥 query 失效 + loadCache 条目累积 | 设计否决 | B 通道禁用 query 手段；只走 internal 真清 |
| O4 | module.register 不能失效已缓存 URL | 设计否决 | hooks 只能配合真清使用，不作为热载手段 |
| O5 | 换纤维仅对**纯函数叶子模块**安全（无注册副作用、无模块级单例、无裸定时器/句柄） | 范围约束 | B 通道必须白名单限定，不碰基础设施插件与注册/装配型模块（审计 A §4 已列风险） |
| O6 | Node 22.23.2 loadCache 已是 LoadCache（typed slots），`LoadCache.delete()` 只置槽不删条目 | 事实修正 | `Map.prototype.delete.call` 必要；审计文档"Node 22/23 plain Map"描述不适用于 22.23.2（不改变审计结论） |

### 3.3 B 通道最终建议：**做——受限版（有条件投入）**

- **做**：目标 = 农场 `@local/*` 插件 lib 下的纯函数子模块（审计 A/E 点名：ssh-gui keyRef 解析、usage 聚合函数、btw prompt-transform 等）——最高频改码面（E §3.1-①）且天然满足"无注册副作用"。
- **改造点**（属改官方包，一次性重启落地）：
  1. `cordis-plugin-hmr`：解除 `loadDependencies`/`isExcluded`/ignored 对目标目录的 node_modules 排除 + 目标模块不进 externals（或对白名单特判）；
  2. 覆写/旁路 `loader.exit()`（现为空实现，审计 A §1.3）；
  3. 对白名单模块注册精确 watch（仿 registerConfig 或独立 watcher），变更 → partialReload 语义。
- **不做**：宿主框架代码热载（externals 语义）、基础设施插件（Loader/HMR/settings/session）、注册/装配型模块、含模块级单例/连接池的模块。
- **回滚面**：cordis partialReload 回滚已内建（本实验 T4 复刻验证）；部署回滚沿用既有 patch 重放/备份体系。
- **成本/收益**：中等投入（3 个官方包边界 + 白名单），收益对准最高频重启原因①；与 P0-D（自动重启）互补——D 兜底非白名单改动，B 消除白名单内迭代重启。

> 注：本实验在 `--expose-internals` 下访问 internal loader，与生产的 `node-addon-require-builtin` 通道仅"取句柄方式"不同，缓存读写语义完全一致（只操作 loadCache Map），结论可迁移。

---

## 4. 同档自复核（本档内完成）

| 复核项 | 结果 |
|---|---|
| 是否只写隔离目录 + 报告 | ✅ 仅 `.workspace/p1-hotswap-lab/` + 本文档；未触 live 树 / `~/.dsh` / 全局树 |
| 是否使用 sandbox_permissions | ✅ 未使用 |
| 全量测试真实运行 | ✅ `node --expose-internals --expose-gc run-all.mjs` → **8/8 runs passed**（T1 16/16、T2 8/8、T3 8/8、T4 9/9、T5 2/2、T6 2/2、T7 2/2） |
| 是否覆盖任务全部测量点 | ✅ ① T1；② T2+T6+T7；③ T3；④ T4；⑤ T5（含 query 对照） |
| 结论是否来自实测 | ✅ 每个判定均有对应测试/探针输出；对审计的 2 处修正（LoadCache 形态、require(esm) 免 flag）均附探针证据 |
| 歧义/越界 | 无设计决策（闸门判定与 B 建议按任务要求的"给结论"范围执行，未实现 B 本体）；query 策略 T2 首次跑出的"泄漏=0"经查为测试污染（同进程 loadCache 串扰），已用独立文件/独立进程修正后重测，非实验结论翻案 |

**自裁决：通过。**

## 5. 复现方法

```bash
cd /home/CNS2026495165/dsh/.workspace/p1-hotswap-lab
npm test                 # = node --expose-internals --expose-gc run-all.mjs
# 单测：
node --expose-internals tests/t1-cjs.mjs
node --expose-internals tests/t3-mixed.mjs
node --expose-internals --expose-gc tests/t5-memory.mjs internal
node --expose-internals --expose-gc tests/t5-memory.mjs query
```

## 6. 证据索引

- 实验代码：`.workspace/p1-hotswap-lab/`（host/loadHost.js、tests/t1..t7、fixtures.js、run-all.mjs）
- 运行输出：本节第 2 章各表（完整 stdout 见各测试直接运行输出，可复现）
- 机制依据：`hotreload-a-loader.md` §2.2/§2.3；`hotreload-c-upstream.md` §2.2；全局树 `cordis-plugin-hmr/lib/index.js` :324-435
- 环境：node v22.23.2（与运行实例同版本）；npm 10.9.8
