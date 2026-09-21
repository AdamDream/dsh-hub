# 执行前审计：`ThemePresenter.apply` 触发链、工作量分解与最小修复候选

- 日期：2026-09-21（只读审计窗口 16:11–16:25）
- 范围：**只读**。未改产品文件、未重启、未 pkill、未开浏览器、未写 `~/.dsh`。所有结论来自「已有 cpu-profile 实测产物 + 真实 bundle 静态源码 + 离线重算」。
- 独占目录：`.workspace/lag-fix/exec-audit/theme/`（本文件）
- 输入证据：
  - `.workspace/lag-fix/research-v2/cpu-profile/audit.md`
  - `.workspace/lag-fix/research-v2/cpu-profile/out/analysis-cpuL.json`（14 窗口，含 `bodyStyleWrites` 每窗 delta）
  - `.workspace/lag-fix/research-v2/cpu-profile/raw/profile-cpuL-*.json`（14 份裁剪 profile，含 `selfTop` 120 与 `bundles` 函数计数）
  - `.workspace/lag-fix/research-v2/cpu-profile/raw/{apply-decisive,apply-ab,apply-ab2,theme-apply-probe,theme-apply-probe2,theme-apply-probe3}.json`
  - `.workspace/lag-fix/research-v2/cpu-profile/scripts/{capture6.mjs,probe-apply-decisive.mjs,exclusive-run.sh}`
- 静态源码（**部署态真实源码**，全部 `md5` 与 `?rev=` 已核）：
  - `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js`（455 行，`rev=abdb7f55acba`，md5 `af19ea709a1556b8c48bedfa8b31e785`）
  - `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js`（1354 行，`rev=e19c47b60a1c`）
  - `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-settings/lib/client.js`（`SettingsScopeController` / `SettingsDescribeMirror`）
  - `~/.dsh/profiles/node_modules/@local/dsh-wallpaper/lib/client.js`（597 行，`rev=fb28faf9db9a`，md5 `b9cd4747f91084065d1227fba5aa7e61`）
  - `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js`（`createSnapshotStore`）
  - `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/index.js`（`Events.dispatch/emit`）

---

## 0. 结论速览（逐条 PASS / FAIL / INCONCLUSIVE）

| # | 命题 | 判定 | 一句话 |
|---|---|---|---|
| 0.1 | `client.js:440` 订阅的是某个 store 快照 | **FAIL** | 它不是 `store.subscribe`；是 cordis 事件 `ctx.on("theme/change", …)` 的闭包（`apply` 在 `:436-446` 的 `ctx.effect` 内注册） |
| 0.2 | 「每次 `session/event` → 同一 `produce` store 新引用 → apply 重放」是完整因果链 | **FAIL（否定）** | 会话事件与 theme 快照**无任何代码路径相连**。会话链自时间合计仅 **3.2–10.1 ms/s** |
| 0.3 | 同一 `produce` 型快照 store 的「无内容比较 ⇒ 每次新引用 ⇒ 重放」机制确实存在，且确实是元凶 | **PASS** | 但它在 **ui-settings 的镜像/作用域链** 上，不在会话链上（§1.4 全链） |
| 1.1 | 触发频率可被只读判定，且已有实测下界 | **PASS** | 直接打桩计数：**6.2 /s（home）、3.7 /s（long-session）**；`cpuL` 每窗 delta 换算 **6.3–22.9 apply/s**（口径冲突未解，见 §1.6） |
| 1.2 | 单一 `ThemePresenter` 实例 | **FAIL（重要新发现）** | 同一 10 s 窗内 `dsh-client-ui-layout` bundle 出现 **2 / 4 / 6 个 `fns@366`**，即 **2–6 个并存实例**，每实例都独立 `apply` |
| 1.3 | `apply` 每次调用有 early-return / 签名比较 | **FAIL** | `:366-380` 无任何 early-return、无签名比较、无 `if changed` |
| 1.4 | `:375` 是逐属性 `setProperty`，`:378` 是 1 次 `getComputedStyle` 强制重算 | **PASS** | 逐条已钉死（§2.1、§2.3） |
| 1.5 | 本项目 body 上实际 token 数 = 1（`--dsw-alias-bg-base`） | **PASS** | 来源 `@local/dsh-wallpaper` `shadeTokens()`（`:183-198`），非第三方主题 |
| 2.1 | 「内容签名相同则跳过重放」语义安全 | **PASS（带 1 个必须补的守卫）** | 见 §3(i) 的 3 条前提 |
| 2.2 | 可去掉/延后 `:378` 强制重算 | **FAIL（不可直接删）** | 它决定唯一 DOM 可见产物 `theme-color` meta；但**可换算法/挪出热路径**（§3(ii)） |
| 2.3 | 合并逐属性 `setProperty` 为一次 `cssText` | **FAIL（本部署零收益）** | token 数 N=1；且有序列化风险（§3(iii)） |
| 3.1 | 「改它可消除可感卡顿」 | **INCONCLUSIVE，倾向「不足」** | `apply` 占 busy 的 50–80%，但残留 busy 仍有 **约 75–110 ms/s**；需 M-A/M-B 实证（§5） |

**最重要的一条**：第一 CPU 成本项确实在 `ThemePresenter.apply`，但它不是「会话事件驱动」，而是**设置链驱动的重复重放 × 2–6 个并存实例 × 每实例一次全文档 `getComputedStyle`**。修复靶点应落在下面的 (0)(i)(ii)(iii)，其中 **(0) 消除并存实例**与 **(ii) 去掉强制重算**的收益大于 (i)。

---

## 1. 触发链钉死（最高优先）

### 1.1 `:440` 到底是什么（对背景假设的第一处否定）

`dsh-client-ui-layout/lib/client.js`：

```
436  ctx.effect(() => {
437    const presenter = new ThemePresenter();
438    presenter.apply(ctx.theme.getTheme());        // 启动时一次
439    const off = ctx.on("theme/change", (snapshot) => {
440      presenter.apply(snapshot);                  // ← profile 栈里的 :440
441    });
442    return () => { off(); presenter.dispose(); };
443  }, "ui-layout: theme presenter");
```

- `:439-441` 是 **cordis 事件订阅**（`Subscription`），**不是** `store.subscribe`。所以「`:440` 订阅的是哪个 store/快照」这个问法的前提不成立：**它没有订阅 store**，它订阅的是事件名 `theme/change`。
- profile 栈里的 `index-ClqxG24t.js:11:2911` 正是 `Events.dispatch` 在 `name` 不以 `internal/` 开头时发的 `this.emit("internal/dispatch", …)`（`cordis/lib/index.js:261`）→ 与「事件派发」而非「store 通知」一致，**互为佐证**。
- 语义：`Events.emit` 是**同步**的（`cordis/lib/index.js:280-282`：`this.dispatch("emit", args).map((cb) => cb(...args))`），`dispatch` 在 `:258-264` 过滤后逐个调用。**因此整条 `publish → emit → 每个 listener` 全在调用者同一个同步栈上**，没有 rAF/microtask 批处理，也没有去重。

### 1.2 谁 emit：`ThemeRuntime.publish()`

`dsh-client-ui-theme/lib/client.js`：

```
1237  buildSnapshot() {
1238    const resolvedId = this.preference === "system" ? (this.media?.matches === true ? "dark" : "light") : this.preference;
1242    return Object.freeze({ preference, active: this.composeActive(active), themes: Object.freeze([...this.themes]), revision: this.revision });
1248  }
1264  publish() {
1265    this.revision += 1;
1266    this.snapshot = this.buildSnapshot();          // ← 每次都是新对象
1267    this.ctx.emit("theme/change", this.snapshot);  // ← 同步广播
1268  }
```

`publish()` 的**全部**调用点（`grep -n 'this.publish()'`，共 6 处，穷举）：

| 行 | 触发者 | 频率 |
|---|---|---|
| `:1137` | `prefers-color-scheme` media `change` 且 preference==="system" | 极低（OS 切换） |
| `:1179` | `setTheme(id)`（且 `:1176` 有 `if (this.preference === id) return` 去重） | 用户点选，极低 |
| `:1186` | `adopt()`：`host.subscribe(...)` 回调，**仅当 `section.preference !== this.preference` 才 publish** | ← **关键，见 §1.4** |
| `:1200` / `:1205` | `register()`（并/拆注册主题） | 启动期 |
| `:1230` / `:1234` | `overrideTokens()`（并/拆覆盖层） | ← **关键，见 §1.5** |

`ThemeRuntime` 构造函数在 `:1146-1148` 注册 `host.subscribe(() => this.adopt())`。`host` = `ctx.settingsScope.bind({ namespace: THEME_SETTINGS_NAMESPACE })`（`:1318`）。

### 1.3 `getTheme()` 是「稳定引用」——签名检测的可行性依据

`:1155-1157` 注释与实现都声明 `getTheme()` 返回的引用**在下一次变化前稳定**。因此 `:438` 之外的每次 `apply` 都对应一次**真的 `publish()`**（revision +1、新快照对象）。这一点很重要：**不存在「同一快照被重复投递」的噪声**，重复`apply` = 重复`publish`。

### 1.4 真正的「produce 型快照 store 无限重放」在这条链上（PASS，但不在会话链）

`ui-settings/lib/client.js`：

```
951   var SettingsScopeController = class {
981     this.store = createSnapshotStore({ status, value, base, user, revision, writable, mode });   // :981
991     this.unsubscribe = mirror.subscribe(() => { this.derive(); });                                // :991-993
1087    derive() {
1088      if (this.disposed) return;
1089      const mirrored = this.mirror.getSnapshot();
1090      if (mirrored.view === void 0) return;                                                        // ← 唯一早退
1092      const view = mirrored.view.namespaces.find((c) => c.ns === this.spec.namespace);
1093      if (view === void 0) { this.store.update((d) => { d.status = "unavailable"; d.writable = writable; }); return; }   // :1094-1098
1100      const decoded = this.decode(view);
1101      this.store.update((draft) => { … draft.value = decoded; });                                  // :1101-1109  ← 无内容比较
1110    }
```

（镜像侧：`SettingsDescribeMirror` 的 store 建于 `:1207`；对外 `subscribe` 在 `:1222-1224`；**`acceptView` 在 `:1265-1271` 用 `store.set({...before, view:{...}})` 造全新对象**；`run()` 在 `:1285`/`:1299`/`:1306` 同样 `set` 新对象。）

`createSnapshotStore`（`dsh-client-runtime/lib/client.js`）：

```
5418  update: (mutator) => {
5419    api.setState(produce(api.getState(), (draft) => { mutator(draft); }), true);   // ← 每次 produce ⇒ 新引用
5421  },
```

zustand `setState` 以 `Object.is` 判定变化 ⇒ **只要跑了 `update` 就必然通知**。于是：

```
任一 settings 变更/失效
  → SettingsDescribeMirror.store.set/update（新对象；:1265 acceptView 亦为无条件 set）
  → mirror.subscribe 回调（:991）
  → SettingsScopeController.derive()（:1087）
  → this.store.update(...) 无条件执行（:1101）          ← 无内容比较，必产生新引用
  → ThemeRuntime 的 host.subscribe(() => this.adopt())（ui-theme :1146）
  → adopt()：section.preference !== this.preference ? …
  → ThemeRuntime.publish()（ui-theme :1186 → :1264）
  → ctx.emit("theme/change")（:1267，同步）
  → 所有 `theme/change` listener 同步执行
      ├─ ui-layout :439-441 → ThemePresenter.apply()（× 实例数）   ← profile 里的 :440
      └─ dsh-wallpaper :575  → applyCurrent(ctx) → … → shadeTokens() → overrideTokens() → publish()（重入，见 §1.5）
```

`adopt()` 的 `if (section === void 0 || this.preference === section.preference) return;`（`:1184`）**只挡「写回无效偏好」，挡不住「`derive()` 每次都通知」**——因为 `derive()` 的 `store.update` 先于 `adopt()` 发生，且没有任何内容比较。

**链路的上游入口（`ui-settings:1337-1351`，本审计新核）**：

```
1341  ctx.effect(() => {
1342    const disposers = [ctx.get("remote").$on("settings/document-updated", () => {
1343      mirror.load();                       // ← 入口 A：宿主设置文档提交
1344    }), ctx.on("connection/reset", () => {
1345      mirror.load();                       // ← 入口 B：连接重建
1346    })];
1347    mirror.ensure();
```

⇒ **`mirror.load()` 只有两个触发源：`settings/document-updated`（远程失效）与 `connection/reset`**。**两者都与 `session/event` 无关**——这是「会话事件不是原因」的又一条静态硬证据：会话事件再多，也不会让 `mirror.load()` 跑一次。

**这是背景假设里「每次 X → 快照新引用 → apply 重放」机制的真实版本，只不过 X 是「设置变更/失效」，不是 `session/event`。**

### 1.5 `overrideTokens` 与 `theme/change` 形成确定性重入回响（新发现）

`@local/dsh-wallpaper/lib/client.js`：

```
548   const inject = ["slots", "locale", "theme", "settingsScope", "sessions"];
575   ctx.on("theme/change", () => applyCurrent(ctx));            // ← 第二个 theme/change listener
335   function applyCurrent(ctx) { … }                            // → applyWallpaper(ctx, config)
252       shadeTokens(ctx, clampNumber(config.opacity, 0, 1, DEFAULT_GLOBAL.opacity));
183   function shadeTokens(ctx, opacity) {
184     if (shading) return;                                       // ← 仅防同栈递归，不防「链式回响」
187     const snapshot = ctx.theme.getTheme();
188     overrideDispose?.();                                       // ← 先拆旧层
189     overrideDispose = ctx.theme.overrideTokens(OVERRIDE_SOURCE, {
190       "--dsw-alias-bg-base": { light: toRgba(resolveBase(snapshot,"light"), opacity), dark: … }
193     });
198   }
```

`overrideTokens` 在 `ui-theme` 里**无条件** `publish()`（`:1229-1230`），并**不做层内容比较**（`validateOverrides` 只校验形状）。于是：

1. `publish#1`（设置/媒体/注册）→ `emit` → 顺序遍历 listener。
2. layout 的 listener 先跑（`apply`），随后（或之前，取决于注册顺序）wallpaper 的 listener 跑 → `applyCurrent` → `shadeTokens`（`shading=false`）→ `removeProperty` 旧层 + `overrideTokens` → **`publish#2`**。
3. `publish#2` 里 `emit` 再次同步遍历全部 listener → layout 又 `apply` 一次；wallpaper 再次进入 `applyCurrent` → `shadeTokens`，此时 `shading===true` → 命中 `:184` 早退（回响到此收敛）。

⇒ **一次外部原因最多产生 2 轮 `apply`**（每实例），除非 listener 顺序让回响发生在本轮 layout 之前/之后不同位置。这解释了 profile 里 `apply` 常出现**成对**的两行实例（`apply-decisive.json` 的 `home` 与 `long-session` 都恰好 2 行），而 `cpuL` 另有 `fns@366` 更多行的窗口（§1.6）。

`OVERRIDE_SOURCE` 固定、层内容在 `shadeTokens` 未变时**逐字节相同**（`toRgba` 是纯函数），所以这次 `publish#2` 是**纯冗余**——「层内容相同 → 不 publish」是一条独立且高置信的修复候选（见 §3 候选 iv）。

### 1.6 并存实例数：同一 bundle 内 2 / 4 / 6 个 `fns@366`（新发现，重要）

`raw/profile-cpuL-*.json` 的 `bundles` 条目按 **函数对象** 计数（`fns` 字段 = 该 URL 下被采样到的不同 `node.id` 数，同一函数实例只算 1 个）：

| 窗口 | `dsh-client-ui-layout` 的 `fns` | `selfTop` 中 `apply` 行数 | 该 bundle selfMs | 窗口 `applyMs` | 一致性 |
|---|---|---|---|---|---|
| home-idle-w1 | **4** | **4** | 664.9 | 664.9 | 4 行求和 = 664.925 ✓ |
| home-idle-w2 | **4** | **4** | 384.7 | 384.7 | 4 行求和 = 384.712 ✓ |
| long-idle-w1 | 2 | 2 | 3532.3 | 3532.3 | ✓ |
| long-idle-w2 | 2 | 2 | 3594.1 | 3594.1 | ✓ |
| long-active-w1/w2 | 2 | 2 | 2561.6 / 2732.2 | 同 | ✓ |
| settings-open-t1 | **6** | 6 | 3652.0 | 3652.0 | ✓ |
| settings-open-t2 | 2 | 2 | 3081.3 | 同 | ✓ |
| settings-models-tab-t1 | **6** | 6 | 2621.8 | 同 | ✓ **且 nodes 只比 open-t2 多 20，活动相同** |
| settings-models-tab-t2 | 2 | 2 | 3486.5 | 同 | ✓ |
| settings-plugins-tab-t1/t2 | 2 / 2 | 2 / 2 | 3198.4 / 1305.3 | 同 | ✓ |
| settings-dwell-w1/w2 | 2 / 2 | 2 / 2 | 2615.4 / 1486.2 | 同 | ✓ |

**判读**：`bundle` 的 `selfMs` 与该窗口 `analysis` 的 `applyMs` **逐窗精确相等** ⇒ 「`dsh-client-ui-layout` bundle 的 self-time ≈ 100% 是 `apply`」，且 **`fns` 数就是并存 `ThemePresenter` 实例数**。实例数在 2–6 之间变化，且 `settings-open-t1`（6）与 `settings-models-tab-t1`（6）明显是同一次设置页交互后累积的。

**对成本的一阶影响**：`apply` 的重放次数 = `publish` 次数 × 实例数。同一份 bundle、同一套代码、同一份快照，被重复执行 2–6 次，每次都走一遍「清 token → 写 token → 强制全文档 `getComputedStyle`」。

**边界（诚实标注）**：`fns` 计数只能证明「存在多个函数实例」，**不能证明**它们都活着且都由 `theme/change` 驱动（也可能是被丢弃但仍被 V8/采样器保留的闭包——但那样不会产生 self-time，所以「有 self-time 行」本身就说明被调用）。判定「当前实际实例数」需 §4.1 的 `probe-instances.mjs`。

### 1.7 与会话事件流的关系：**无直接因果（否定）**

- `ThemeRuntime` 不持有 `session`/`sessions` 服务；`inject`（ui-theme `:1303-1309`）只有 `slots, locale, connection, remote, settingsScope`。**没有任何会话事件订阅路径**。
- 会话链的自时间（`analysis-cpuL.json` → `chainMs`）逐场景合计：**home 10.1 / long-idle 8.0 / long-active 7.0 / settings-open 5.4 / models 6.4 / plugins 3.5 / dwell 3.2 ms/s**（`buildListSnapshot`+`projectList`+`flattenLineage`+`markDirty`+`ensureFresh`+`getListSnapshot`+`querySelectorAll`）。相对 `apply` 的 105–712 ms/s，**低两个数量级**。
- 用户假说里提到的 `createSnapshotStore`（`dsh-client-runtime:5397`）与 `update`/`produce`（`:5418`）**确实存在且确实是元凶机制**，但使用者是 ui-settings（`:981`、ui-settings `SettingsDescribeMirror` `store`），**不是**会话 store，也不是 theme。
- 结论：`session/event` **不是** `apply` 的直接原因。两者只是**共享同一个上游**：宿主 agent 活跃 ⇒ 会话事件多，**同时**设置侧写入/失效也多。因此「事件率 vs apply 率」的相关性是**共同原因造成的伪相关**，不能作为因果证据。`cpu-profile/audit.md` §2.1 自己也标注了 S2/S3 对照不干净，与此一致。

**唯一仍成立的弱联系**：`dsh-client-connection` 处理 `session/event` 时**不**触及 theme（profile 中 `dsh-client-connection` selfMs 只 13.8–26.7 ms/s，且函数集中在 `handleMessage`）。

### 1.8 如何用只读手段判定触发频率（可执行）

两条完全只读的页内打桩，**不改产品文件、不改 `~/.dsh`**。

**(a) 数 `publish`（= `theme/change` 发射次数）——通过 `Events.dispatch` 包装**

```js
// probe-theme-emit.mjs 的核心页内代码（在 page.evaluate 里跑；先 await page.goto）
const install = () => {
  const S = (window.__tp = { byName: {}, listeners: {}, starts: 0 });
  // 1) 抓根 Events 原型：subscribe 一个 internal/listener，回调里的 this 就是 Events 实例
  //    cordis: Events 构造器只注册 "internal/listener"（index.js:237）—— 这是唯一的自举点
  // 2) 抓不到就从任意 DOM 事件反查不可行，改走：包装 addEventListener 无效；
  //    可靠路径是下面第 2 步的 proto 探测。
  return !!S;
};
```

更稳的等价实现（无需自举）：**直接包装 `Events.prototype.emit`**——但需要拿到 `Events` 类。页内可达路径是 `window.__DSH_BOOT__` 或模块加载器 `__ModuleLoader__`（`theme-apply-probe.json` 已证 `window.__ModuleLoader__` 存在，`typeof === "object"`，含 `load/create`；形状见 `theme-apply-probe2.json`）。**用 `__ModuleLoader__.create`/`load` 之外不直接取类**，因此推荐 **`dispatch` 探测法**：

```js
// 在页内执行：遍历所有 JS 可达对象不现实；改为在 cordis 层监听——
// cordis 允许 ctx.on("internal/dispatch", (type, name, args, thisArg) => {...}, {global:true, prepend:true})
// 而 `internal/dispatch` 是【每个 emit 都会发】的（index.js:261，name 不以 internal/ 开头时）。
// 但我们拿不到 ctx。⇒ 因此最省事、零自举的做法是下面的 (b)+(c) 组合计数：
```

**审计给出的可跑方案（无自举，纯 DOM 侧口径，靠 `apply`/写次数反推，已被本报告 §4 的既有探针验证过可用）：**

1. **`apply` 调用次数**（= `publish` 次数 × 实例数，因每实例每 publish 恰好 1 次 apply）：
   patch `CSSStyleDeclaration.prototype.removeProperty`，仅当 `this === document.body.style` 计数 → 每次 `apply` 恰好 +1（因为 `:372-373` 的 retraction 循环对每个旧 token 调一次 `removeProperty`，而实测 `appliedTokens.length === 1`，见 §2.2）。**`apply-decisive.mjs:25` 已是此口径**（`sp.removes`）。
2. **`publish` 次数**：`body` 写次数 ÷ 2 ÷ 实例数；实例数取 §4.1 probe。
3. **实例数**：`performance` 侧无法直接数；用「长窗内 `removeProperty` 计数 / (publish 次数)」闭环，或直接读 CDP profile 的 `bundles[].fns`（本报告 §1.6 就是这么做的——**这已是一条真实可跑的只读判据**）。
4. **会话事件帧序号—时间戳**：patch `WebSocket.prototype.addEventListener`，包装用户 handler 记录 `{t, payloadType}`；**必须**在 `addInitScript`（页面加载前）打，才能保证绑定发生在 App 注册之前。
5. **一次跑出可判定的东西**：把 (1)(2)(4) 的时间戳对齐到同一单调钟（`performance.timeOrigin` 一致），做 **±50 ms 窗内的交叉相关**。若 `apply` 时刻与 `session/event` 时刻的交叉相关不显著高于与 `session/projection` 或「无事件时刻」的，则**再次否定**会话事件因果；若显著，则说明确有被我静态阅读漏掉的路径（此时走 §5 M-A/M-C 反证）。

---

## 2. `apply` 的真实工作量分解（`:366-380` 全文）

部署态源码（`dsh-client-ui-layout/lib/client.js`，行号即 profile 的 `line`）：

```
366  apply(snapshot) {
367    const scheme = snapshot.active.colorScheme;                    // ① 纯读快照，无 DOM
368    document.documentElement.style.colorScheme = scheme;           // ② html.style 写 1 次（可能触发文档级 style 失效）
369    const body = document.body;
370    if (scheme === "dark") body.setAttribute(DARK_ATTRIBUTE, "");   // ③ 属性写（dark）
371    else body.removeAttribute(DARK_ATTRIBUTE);                      // ③' 属性写（light）
372    for (const name of this.appliedTokens) body.style.removeProperty(name);  // ④ N_old 次 DOM 写
373    this.appliedTokens = [];
374    for (const [name, value] of Object.entries(snapshot.active.tokens)) {
375      body.style.setProperty(name, value);                          // ⑤ N_new 次 DOM 写（profile 栈里就是这一行）
376      this.appliedTokens.push(name);
377    }
378    this.themeColorMeta.content = getComputedStyle(body).backgroundColor;   // ⑥ 强制同步重算（唯一一次）
379    if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta);
380  }
```

### 2.1 逐段判定

| 段 | 行 | 内容 | DOM 影响 | 备注 |
|---|---|---|---|---|
| ① | `:367` | `snapshot.active.colorScheme` | 无 | `active` 由 `composeActive` 产出（ui-theme `:1255-1263`），无覆盖层时**按身份透传**注册定义 |
| ② | `:368` | `documentElement.style.colorScheme = scheme` | **html.style 写 1 次** | 即便值未变也写（idempotent 但**仍会 invalidate** 一次样式） |
| ③ | `:370-371` | `data-ds-dark-theme` 属性增删 | **1 次属性写** | 同上，无条件写 |
| ④ | `:372` | 旧 token 逐个 `removeProperty` | **N_old 次写** | 实测 N_old=1（见 §2.2） |
| ⑤ | `:374-377` | 新 token 逐个 `setProperty` | **N_new 次写** | 实测 N_new=1；**`setProperty` 逐属性调用，未合并** |
| ⑥ | `:378` | `getComputedStyle(body).backgroundColor` | **1 次强制 re-layout/style（全文档）** | 见 §2.3；**这是唯一强制同步重算点** |
| — | `:379` | `head.append(meta)` 仅首次 | 0（后续幂等） | `isConnected` 守卫 |

**没有 early-return、没有签名比较、没有 `if (changed)`、没有 `requestAnimationFrame`/批处理包装。** 只要 `apply` 被调用，②③④⑤⑥ **全部**执行。

### 2.2 结构性计数：每次调用的 DOM 写次数与强制重算次数

```
DOM 样式写 = 1（html.style.colorScheme）
           + N_old（body.style.removeProperty）
           + N_new（body.style.setProperty）
属性写     = 1（data-ds-dark-theme 增或删）
强制重算   = 1（getComputedStyle，且夹在「④⑤写之后」与「⑥读之后」之间 ⇒ 一定吃到本轮全部失效）
```

**本部署实测 N_old = N_new = 1**，证据三条互相独立：

1. `theme-apply-probe3.json`：`propsPerBatch = 1`（5/5 场景）、`finalBodyProps = 1`、`finalBodyStyleLen = 47`，且 `styleAttrLen` 三轮采样恒为 `[47,47,47]`。
2. `cpu-profile/audit.md` §2.4：「`body` 上被写入的样式属性**恒为 1 个**（`document.body[style]` 长度 47，多轮采样恒定）」。
3. 计数器口径自洽：`capture6.mjs:47-48` 的 `writes` **同时**统计 `setProperty` 与 `removeProperty`（`INIT_HOOKS` 里两个 wrapper 都 `window.__cpu.writes++`），而 `analysis-cpuL.json` 的 `bodyStyleWrites` 恰好是 `apply` 次数的 **2 倍** —— 与 `N_old+N_new = 2` 自洽。

⇒ **每次 `apply`：body 上 2 次写 + html 上 1 次写 + 1 次属性写 + 1 次强制全文档重算。**

该 token 的身份也已钉死：`@local/dsh-wallpaper/lib/client.js:189-194` 覆盖 `--dsw-alias-bg-base`（值为 `rgba(<resolveBase>, opacity)`）。`ui-theme` 的内建 light/dark 主题 token 表是**空对象**（`ui-theme:998-1005`，`tokens: Object.freeze({})`），所以这唯一的 body token 必然来自 wallpaper 的覆盖层，**不是**第三方主题。

### 2.3 `:378` 到底在做什么，以及为什么它贵

- **用途（唯一）**：把浏览器 UI 的 `theme-color` meta 内容同步为**计算后的** body 背景色，即 `this.themeColorMeta.content = <computed backgroundColor>`。该 meta 由 presenter 自建自持（`:354-355` 创建，`:379` 首次 append，`:388` dispose 时 remove）。
- **位置与次数**：**1 次/`apply`**，位于 `④⑤` 全部写之后（`:378` 在 `:372-377` 之后）。注释（`:360-363`）自陈：「Browser theme-color metadata follows the computed body background after those writes, so the rendered palette remains the color authority.」
- **为什么贵**：`getComputedStyle(body)` 需要**已解析的**样式（不能返回脏值），因此**强制一次同步 style recalculation**；随后读 `backgroundColor` 会进一步触发 **layout**（需要解析后的盒）。由于 body 的失效会向上（html）与向下（全子树，`color-scheme`/继承 token 变化会被整棵树继承），这次重算的规模**随文档节点数增长**——因为 `:368` 的 `colorScheme` 是一个**继承性**属性，`:374` 的自定义属性也在 body 上被整棵子树继承。
- **实测的规模效应（`cpuL`，同窗内比值，避开跨窗绝对值污染）**：

| DOM 节点 | apply/s | `applyMs`/s | **µs / 每次 apply** |
|---|---|---|---|
| 605 | 17.9 | 51.8 | **2 921** |
| 3 748 | 16.4 | 349.1 | **21 357** |
| 3 941 | 10.9 | 256.9 | **23 558** |
| 4 189 | 9.8 | 271.0 | **27 420** |
| 4 210 | 8.1 | 268.4 | **33 369** |
| 4 638 | 6.3–6.6 | 197.7–203.1 | **30 926 / 31 276** |

**节点数 ×6.2，每次 `apply` 成本 ×7.3–11.4（超出线性的 1.2–1.8× 超线性部分），而 `apply` 次数反而下降 ⇒ 总量仍上升（51.8 → 197–349 ms/s）。** 结构上完全由 ⑥ 解释：②③④⑤ 的调用次数与文档无关（常数次），唯一随文档规模变化的就是 ⑥ 的强制重算。**1–2 次属性写不可能耗 21–33 ms。**

- `applyShareOfScript` 在多窗口 **> 1（1.0–3.9）**——即 `apply` 的 self-time **超过整个 CDP `ScriptDuration`**，这正是「它的 self-time 里主要装的是非 JS 工作（Blink 样式重算）」的独立佐证（`cpu-profile/audit.md` 也据此指出过）。

### 2.4 是否可以安全加「快照内容签名相同则跳过重放」

**可以，但有 3 个必须满足的前提**（不满足任一条则不安全）：

1. **签名必须覆盖内容，而不是覆盖 `revision`**。`ThemeRuntime` 快照带 `revision`（`:1246`），且每次 `publish()` 都 +1（`:1265`）——**若签名里含 `revision`，则该优化永远不命中**（每次都不同）。正确签名 = `colourScheme + sorted(tokens 的 name/value 全量)`（或对其做稳定哈希）。签名只需覆盖 presenter 真正消费的字段：`active.colorScheme` 与 `active.tokens`（`:367`、`:374`）。
2. **必须处理「第三方/其它实例中途改过 body」的漂移**。presenter 只掌握 `this.appliedTokens`（自己的 retraction 集），并不知道别人是否也写了 body。本部署**确实有别人**：2–6 个并存实例都在写同一份 `body.style`（§1.6）。若采用「内容签名相同 → 直接 return」，那么在「实例 A 已 dispose/被换掉、或 meta 节点被移除重插」的场景下，可能出现**该写却没写**。
   **低成本守卫（建议随 (i) 一起上）**：把「跳过」条件收紧为
   `签名相同 && document.documentElement.style.colorScheme === scheme && body.hasAttribute(DARK_ATTRIBUTE) === (scheme==="dark") && this.appliedTokens.every(n => body.style.getPropertyValue(n) !== "") && this.themeColorMeta.isConnected`
   即「内容同 + 该实例自己的落地点仍在位」。这样跳过的只是**可证明幂等**的那一次。
3. **首次调用不得跳过**（`appliedTokens` 为空、`themeColorMeta` 未连接），由守卫自然覆盖。

**语义风险逐条评估（题目点名的 4 个必须仍生效的场景）：**

| 场景 | 机制 | 签名是否变化 | 是否仍生效 |
|---|---|---|---|
| dark/light 切换 | `preference` 变或 media 变 → `buildSnapshot` 换 `resolvedId` → `active.colorScheme` 变（`:1238-1244`） | **变**（`colorScheme` 在签名内） | ✅ |
| 壁纸（`--dsw-alias-bg-base` 的 `rgba(...)` 随 opacity/源图变） | `overrideTokens` → `composeActive` 重算 tokens（`:1255-1263`） | **变**（tokens 值在签名内） | ✅ |
| locale | locale **不参与** theme 快照（`ui-theme` 的 `inject` 只把 `locale` 用于设置行字典；`buildSnapshot` 无 locale 字段） | 不变 | ✅（本来就不该触发 theme 重放） |
| token 覆盖（`overrideTokens` 增/改/删层） | `composeActive` 重算 → tokens 值/键集变；**删层**时键集减少（`:1258` 只覆盖不删除，`overrides.size===0` 时 `:1256` 直接返回原 `active` ⇒ tokens 键集回落） | **变**（键集/值都在签名内） | ✅ |

⇒ **只要签名 = 内容（不含 revision），四个场景全部仍然生效。** 唯一的真实风险是上面第 2 条的漂移，已由守卫消解。

---

## 3. 最小修复候选与取舍（按证据强度排序）

> 通用约束：均为**产品文件修改**，需重启或热载（见每项「生效方式」）。本审计**不实施**任何改动。

### (0) 【证据最强，但属"结构"修复】消除并存 `ThemePresenter` 实例

- **证据**：§1.6 的 `bundles[].fns = 2/4/6`，且 bundle selfMs ≡ 窗口 `applyMs`。
- **形状**：查清为何 `ctx.effect(…, "ui-layout: theme presenter")`（`client.js:436-446`）会并存多份：
  - 若是 **effect 重放未 dispose**（HMR / 配置热更 / slot 重注册），修在**上游**：确保旧 effect 的 disposer 先跑（`off(); presenter.dispose();` 已在 `:442-445`，问题在**是否被调用**）；或把 presenter 提升为 `ctx.effect` 之外的**单一持有者**（每 plugin fiber 一个，由 `ctx.effect` 只做 dispose 兜底）。
  - 若是**同一插件被多个 entry 应用**（需在活体上确认，见 §4.1），修在插件装配侧（避免重复 `apply`）。
- **收益**：直接按倍数削减 `apply` 次数（2–6× → 1×），**不减每次成本**，但会同时削减 `RecalcStyle`（每实例 1 次强制重算）。
- **回归风险**：低（去重语义应无副作用）；唯一要守的是「切换入口后 theme 仍生效」。
- **重启/热载**：改 layout 的 client bundle ⇒ 需 **重启**（client 插件 bundle 有 `?rev=`，HMR 仅在该 bundle 重建时生效；本部署 `__DSH_BOOT__` 无 `__DSH_HMR__`，见 `theme-apply-probe.json` 的 `loaderProbe.keys`）。

### (i) 快照内容签名相同 → 跳过重放

- **证据**：`:366-380` 无任何 early-return；`getTheme()` 引用稳定（`:1155-1157`）；快照内容字段可枚举（`:1242-1247`）。
- **改动形状**（`ThemePresenter` 内新增 1 个字段 + `apply` 首部 3 行）：
  ```
  // 新增字段：lastSignature
  apply(snapshot) {
    const sig = signatureOf(snapshot.active);       // colorScheme + tokens 全量，稳定序列化
    if (sig === this.lastSignature && this.landingIntact(snapshot.active.colorScheme)) return;
    … (原 :367-379 原样) …
    this.lastSignature = sig;
  }
  ```
- **收益**：把 `publish#2..N`（§1.5 的重入回响、以及「设置失效但偏好没变」的整类重放）**直接归零**。按 §1.5 分析，**外部原因 → 2 轮 apply**，故期望削减 **≈50%** 的 apply 次数（叠加 (0) 后为 2×实例数×50%）。
- **回归风险**：低（4 个场景已逐条验证，§2.4）。**必须同时上 §2.4 前提 2 的守卫**，否则在「别人改过 body」时可能漏写。
- **重启/热载**：同 (0)。

### (ii) 去掉或延后 `:378` 的 `getComputedStyle` 强制重算

- **它到底用来干什么**：唯一用途是给 **presenter 自建的 `theme-color` meta** 提供「计算后的 body 背景色」（`:378` + `:354-355`/`:379`）。**不影响任何页面元素的实际配色**——配色由 `:368` 的 `color-scheme` 与 `:370-377` 的 token 写决定；`:378` 只写一个 `<meta name="theme-color">` 的 `content`。
- **能不能直接删**：**不能**。删掉后 `themeColorMeta.content` 保持 `""`，`<meta name="theme-color">` 会退化为无效/默认值，影响浏览器 UI 染色（移动端地址栏、PWA 标题栏）与「手机端观感」。
- **安全的替代形状（二选一）**：
  - **(ii-a) 换算法，不读 DOM**：`theme-color` 想要的就是「body 的实际背景色」。本部署 body 背景来自 `--dsw-alias-bg-base`（§2.2），其值可在**快照内**直接取得：`snapshot.active.tokens["--dsw-alias-bg-base"]`（wallpaper 已把它写成 `rgba(...)`）。因此可改为
    `this.themeColorMeta.content = snapshot.active.tokens["--dsw-alias-bg-base"] ?? ""`（或对多 token 场景取「优先级列表里第一个命中的背景色 token」）。
    **风险**：当该 token 缺失/为半透明 `rgba` 时，meta 值与「合成后的实际颜色」不完全一致——**属可接受的降级**（meta 是粗粒度 UI 提示，且「半透明」本身就无单一正确值；现在拿到的 `getComputedStyle` 值同样只是 alpha 前的颜色分量）。
  - **(ii-b) 保留但挪出热路径**：`:378` 改为在 `apply` 末尾用 `requestAnimationFrame`/`queueMicrotask` 延后执行，并加「同一帧只跑一次」合并。**风险**：延后后可能读到**下一帧**的 body 背景（若同帧内还有别的写入者，如另外 2–5 个实例），值可能取到别人写的色。⇒ **(ii-b) 必须与 (0)(i) 一起上（实例唯一 + 重放归零）才安全。**
- **收益**：这是**唯一**的强制重算点（§2.3），也是「每次 apply 成本随文档规模放大」的唯一结构性解释。按 §2.3 的表，若 (ii) 生效则每次 `apply` 的 21–33 ms 应塌到亚毫秒级。
- **重启/热载**：同 (0)。

### (iii) 把逐属性 `setProperty` 合并为一次 `style.cssText` 写入

- **本部署的收益：≈0**。`N_new = 1`（§2.2），合并 1 个属性没有任何可合并的。即便 N=10，省下的是 9 次「同任务内、同元素、同属性集」的样式写入——浏览器在 `:378` 的强制重算时**本来就把它们合并成一次重算**（这正是为什么写 N 次不会产生 N 次重算）。
- **序列化风险（为何不推荐）**：
  1. `cssText` 读取需要**序列化整个 `CSSStyleDeclaration`**（比 `setProperty` 贵），而写入会**丢弃 `appliedTokens` 之外的既有内联样式**（含 `!important` 标志与顺序信息）；
  2. token 名/值是**外部输入**（第三方主题、`overrideTokens` 的 `validateOverrides` 只校验类型，`ui-theme:1276-1288`），拼进 `cssText` 需要正确的转义与优先级（`!important`）保真——`setProperty(name, value, priority)` 的第三参在字符串拼接里没有干净对应；
  3. body 上还有 wallpaper 写入的同一个 token（§2.2），`cssText` 整段替换会让「其它实例的既有写入」被无差别清掉，使并存实例间的收敛行为改变（现在靠 `removeProperty(name)` 精确点名）。
- **结论**：**不建议做**。若将来 token 数显著增长（>20）再评估，且应改为「一次性重建整段 + 显式保留其它实例 token」而非裸 `cssText`。

### (iv) 【补充候选，证据强、改动小】`overrideTokens` 层内容相同 → 不 `publish`

- **证据**：§1.5 全链；`ui-theme:1224-1230` 无条件 `publish()`；wallpaper 每次 `theme/change` 都以**相同内容**重建同一层（`shadeTokens` + `toRgba` 纯函数）。
- **形状**：`overrideTokens(source, tokens)` 在 `this.overrides.get(source)` 存在且**逐 token 逐模式全等**时，直接返回既有 disposer，不 `publish`。
- **收益**：切断 §1.5 的重入回响，等价于把「外部原因 → 2 轮 apply」压成 1 轮。与 (i) 互为**独立**的冗余削减（(i) 在消费者侧，(iv) 在生产者侧）；两者都上不冲突。
- **回归风险**：低（比较的是同一 source 的层内容；`seq` 顺序语义在相同时不受影响）。
- **重启/热载**：改 `dsh-client-ui-theme` bundle ⇒ **需重启**。

### 取舍排序（建议落地顺序）

1. **(0) 并存实例去重** —— 证据最强（§1.6 硬数据）、倍数收益、风险最低。
2. **(ii-a) 去掉强制重算** —— 唯一能改变「每次成本随 DOM 放大」的结构性项，收益上限最高。
3. **(i) 内容签名跳过重放** —— 50% 级削减，但必须带 §2.4 的守卫；(iv) 可替代/叠加。
4. **(iv) 覆盖层内容比较** —— 小改动，切断回响。
5. **(iii) `cssText` 合并** —— **否决**。

---

## 4. 验收标准（必须可判 PASS / FAIL）

### 4.0 执行前置（硬门槛，不满足则整轮 INCONCLUSIVE）

复用既有器械：`.workspace/lag-fix/research-v2/cpu-profile/scripts/exclusive-run.sh`（`mkdir .probe.lock` 原子取锁 → `capture6.mjs --gatemax 120000`，且 `capture6.mjs:145` 要求 **`foreignCount === 0 && lockHeldByMe`** 才开窗）+ `census.sh` 记录 `raw/census.log`。

- **必须**：每个窗口 `bodyStyleWrites`/`recalcMsPerS` 等进入判定前先核对 `concurrency.gateOutcome === 'EXCLUSIVE'` 且 `censusStart.foreignCount === 0 && censusEnd.foreignCount === 0`。
- **必须**：`capture6.mjs` 的 `integrity` 三项（`rafOk` / `rafRateSane` / `unitOk`）全 OK。
- **理由**：`cpuL` 是在 3 个外来 `headless_shell` 并发下测的（`cpu-profile/audit.md` §0.1），本轮所有绝对值**不能**当基线——下面的阈值因此全部写成**同窗对照的比值**。

### 4.1 P0：机制判定（决定修复是否真的作用在靶心上）

| 指标 | 采集方式 | PASS | FAIL |
|---|---|---|---|
| **并存 `ThemePresenter` 实例数** | 新增 `probe-instances.mjs`：每 1 s 取一次 `document.body.style` 的写事件并按「同一次 `publish` 内的连续写段」切分；或直接读 CDP profile 的 `bundles[].fns`（§1.6 已证可用） | 修复后 **= 1**（所有场景、所有窗口） | > 1 |
| **`apply` 调用次数 / s** | `probe-apply-decisive.mjs` 的 `removes` 口径（`proto.removeProperty` 且 `this === document.body.style`） | 相对同条件基线**下降 ≥50%**，且绝对 **< 5 /s** | 无显著下降 |
| **`body.style` 写次数 / s** | `capture6.mjs` 的 `bodyStyleWrites`（每窗 delta） | 相对基线**下降 ≥50%** | 无显著下降 |
| **`theme/change` 发射次数 / s** | §1.8 的 (b)+(c) 口径反推：`removes/s ÷ 实例数` | 下降 ≥50% | 无显著下降 |

### 4.2 P1：CPU / 帧时验收（同窗对照，且必须同一 DOM 规模）

**对照方式**：同一台机、同一会话、同一场景、同一窗口时长（≥8 s）、修复前后各 **≥3 窗**；DOM 节点数差 **≤5%** 才算同规模可比（否则改判 INCONCLUSIVE）。只因 `apply` 修复而节点数不该变——若变了说明改到了别的东西。

| 指标 | 来源字段 | PASS 阈值 |
|---|---|---|
| `RecalcStyle / Task` 占比 | `recalcMs` ÷ `taskMs` | 从 **60.0%**（基线，14 窗合计）降到 **≤ 15%** |
| `applyMs / busyMs` | `applyMs` ÷ `busyMs` | 从 **0.50–0.80**（基线 7 场景）降到 **≤ 0.10** |
| `applyMs / s` | `applyMsPerS` | 相对基线**下降 ≥70%**（设置页场景） |
| `Task / s` | `taskMsPerS` | 相对基线**下降 ≥40%** |
| **>50 ms 帧数** | `rafOver50`（每 10 s 窗） | 从基线 **42–80 / 2 窗** 降到 **≤ 10 / 2 窗** |
| rAF 速率 | `rafPerS` | 从 **35.6–49 /s** 回到 **≥ 55 /s** |
| rAF **p99** | `rafP99` | 从 **50–133 ms** 降到 **≤ 33 ms** |
| rAF **p50** | `rafP50` | **必须保持 16.7 ms**（基线全程 16.7；若修复后 p50 变差 ⇒ 修复引入了新卡顿，判 FAIL） |
| LongTask 数 | `ltN` | ≥ 基线的改善（不设硬阈，因基线本身 0–18 波动大） |
| `reconcileRatio` | `busyMs ÷ (Script+RecalcStyle)` | 仍落在 **0.9–1.1**（防器械失准，不是性能阈值） |

**注意 `rafP50` 的特殊角色**：基线 p50 全程 16.7 ms（未被长帧拖移，退化全在长尾）。因此 **p50 是"没坏"的哨兵，p99/`rafOver50` 才是"变好"的判据**。

### 4.3 P2：功能回归清单（「主题真变化仍生效」）

每项都必须**在修复后活体执行**并逐条判 PASS/FAIL；执行方式一律**只读观察**（截图/DOM 探针），不点保存、不改配置。

| # | 项 | 判定方法 | PASS 判据 |
|---|---|---|---|
| R1 | **dark → light 切换** | 设置 → 通用 → 外观，切到 light（**这是唯一允许的一次真实偏好写入**，需协调者批准；或改用只读法：在页内直接 `matchMedia` 无法伪造，故必须真实切换一次） | `document.documentElement.style.colorScheme === "light"`；`body` **无** `data-ds-dark-theme`；页面视觉变亮 |
| R2 | **light → dark 切换** | 同上反向 | `colorScheme === "dark"`；`body` **有** `data-ds-dark-theme`；页面变暗 |
| R3 | **system 跟随** | 切到「跟系统」，再用 CDP `Emulation.setEmulatedMedia({features:[{name:'prefers-color-scheme',value:'dark'}]})` 翻转 | `apply` **被触发**（`removes` 计数增长）且 `data-ds-dark-theme` 跟随翻转（`ui-theme:1135-1138` 的 media listener 路径） |
| R4 | **壁纸生效（token 覆盖）** | 保持现有壁纸/透明度不变；读 `body.style.getPropertyValue("--dsw-alias-bg-base")` | 值与修复前**逐字节相同**（应为 `rgba(..., <opacity>)` 形态）；壁纸仍可见；透明度滑块变化后该值随之变化 |
| R5 | **`theme-color` meta** | 读 `document.querySelector('meta[name=theme-color]').content` | **非空**且为合法 CSS 颜色（这是 (ii) 的直接回归项；若采用 (ii-a) 则值应等于 `--dsw-alias-bg-base`） |
| R6 | **token 覆盖的增/删** | 在壁纸设置里把透明度改一次再把壁纸设为「无」 | 设「无」后 `body` 上该 token **被移除**（`appliedTokens` 收缩路径，`:372-373`）；UI 回到不透明底色 |
| R7 | **locale 不受影响** | 切语言（或只观察现有 locale） | 语言切换**不**应改变配色；且修复后语言切换仍正常（防 (i) 的签名把 locale 误纳入） |
| R8 | **设置页外观行自洽** | 读外观行的当前选中项 | 与 `document.documentElement.style.colorScheme`/`data-ds-dark-theme` 一致（`ui-theme:1326-1335` 的 `sync` 路径未被 (0) 去重破坏） |
| R9 | **刷新后冷启动一致** | 修复前后各刷新一次，比对首屏截图 | 冷启动首帧配色一致（`:438` 的首次 `apply` 未被 (i) 的跳过逻辑吃掉） |

### 4.4 边界与"不可判"声明

- 若本轮仍无法达成独占（`foreignCount > 0`），**绝对 ms、LongTask 数一律 INCONCLUSIVE**，只允许用 `applyShareOfScript`/`applyShareOfBusy`/`RecalcStyle÷Task` 这类**同窗比值**判定。
- **无法**用只读手段判定「`apply` 修复后是否消除**用户可感**卡顿」——那需要人因观察；本报告只给 CPU/帧时代理指标。

---

## 5. 因果分离实验设计（交协调者串行执行）

> 全部**只读 + 页内**，不改产品文件、不改 `~/.dsh`。所有打桩必须在 `addInitScript`（页面加载前）或 `page.evaluate` 的第一时间完成。每个变体都要 `Profiler` 起停包住，并复用 `exclusive-run.sh` 的锁与 `gateOutcome == EXCLUSIVE` 门槛。

### 5.0 三个可独立阻断的"开关"（打桩方式）

#### (K-0) 先解决"拿不到 emitter"的自举问题（本审计已找到确定可行路径）

要**数 `publish` 次数**就得碰到 `Events` 实例；页内没有 `ctx`。但 `cordis/lib/index.js:237` 给了一条**自举路径**：

```js
237   this.on("internal/listener", function(name, listener, options) {   // ← Events 构造器自己注册的第一个 listener
238     if (name === "internal/update" && !options.global) return (this.fiber._hooks["internal/update"] ??= new DisposableList())[...](listener);
239   });
```

- `dispatch`（`:258-264`）在 `name.startsWith("internal/")` 为真时**不发** `internal/dispatch` ⇒ **不会自激**。
- `internal/listener` 在**每次 `ctx.on(...)`/`ctx.effect` 绑定**时派发，回调里的 `this` **就是那个 `Events` 实例**（`callback.bind(thisArg)`，`:263`）。
- **⇒ 只要在页面加载早期 `Events.prototype.emit("internal/listener", …)` 不行（会自激），正确做法是**：`dispatch` 的 `thisArg` 取法不可用，故改用**更简的等价物——消费者侧计数**（下 (K-A)/(K-B)），**不**去自举 `Events`。

**审计结论**：emitter 自举在 cordis 层**没有干净的零副作用入口**（唯一的自举点是构造器内的 `internal/listener`，而它要求你**已经**有一个实例）。因此**推荐统一走消费者侧口径**：`apply` 次数（`body.style.removeProperty` 计数）÷ 实例数 = `publish` 次数。该口径的每一次转换都由本报告 §2.2 的实测常数（`N_old = N_new = 1`）支撑。

**(K-A) 阻断 `theme/change` 的投递** —— 因上面的自举限制，**不推荐**（需要 `Events` 实例）。若协调者愿意多花一步，可在**产品侧**加一个只在探针 build 里存在的 `ctx.on("internal/dispatch", …)` 钩子来取 `thisArg`——但这**违反只读纪律**，故本轮**不做**。

**(K-B) 消费者侧计数（推荐，零自举，已被既有探针验证）**

```js
// 在 page.evaluate 里、INIT_HOOKS 之后执行（apply-decisive.mjs:11-30 已是此形状）
const proto = Object.getPrototypeOf(document.body.style);
const oRem = proto.removeProperty;
proto.removeProperty = function (n) {
  if (this === document.body.style) window.__tp.removes++;   // 每次 apply 恰好 +1（N_old = 1）
  return oRem.call(this, n);
};
```
⇒ `apply` 次数 = `removes`。配合 §4.1 的实例数即可反推 `publish` 次数。

**(K-C) 阻断 `:378` 的强制重算（**关键实验**，只读、页内，先例充足）**

`:378` 调用的是全局 `getComputedStyle`。页内替换它即可精确移除「强制同步重算」而**保留** `apply` 的其余全部行为：

```js
const oGCS = window.getComputedStyle;
window.getComputedStyle = function (el, pseudo) {
  if (el === document.body && (pseudo === undefined || pseudo === null) && window.__gcsBlock) {
    window.__gcsBlocked = (window.__gcsBlocked || 0) + 1;
    return { backgroundColor: "rgb(0,0,0)", getPropertyValue: () => "" };  // 假对象：不触发布局/重算
  }
  return oGCS.call(window, el, pseudo);
};
```

- **为什么这是"只读"**：不写文件、不改产品源码、不改配置；只在**这一次测量的页面生命周期内**替换一个 Web API。页面关闭即消失。
- **单侧阻断的干净性（本审计已静态验证）**：`:378` 是该 bundle 里**唯一**的 `getComputedStyle` 调用（`grep -n getComputedStyle` 在该 455 行文件中只命中 `:378` 一行），因此这个开关**只**影响目标行。
- **必须如实标注的副作用**：K-C 是**全局**替换 `window.getComputedStyle`（无法只拦 `:378` 那一次），因此**任何**其它读 `getComputedStyle(document.body)` 的代码在探针窗口内都会拿到假值。它只能用于 **CPU 归因**，**不得**在同一次运行里做任何功能判定（R1–R9 一律在**无探针**的运行里判）。
- **假对象的形状**：返回一个**极简对象**而不是 `oGCS` 的真结果——只提供 `backgroundColor`（`:378` 唯一读取的字段）与一个 `getPropertyValue` 兜底；**不要**返回真 `CSSStyleDeclaration` 的冻结副本，那会把重算成本原样带回来，实验就失去意义。
- **失败回退**：若 `window.getComputedStyle` 被冻结/非可写，退化为 **K-C'**：把 `CSSStyleDeclaration.prototype.removeProperty`/`setProperty` 在 `this === document.body.style` 时**变成 no-op**（`:378` 读到的样式不再变脏，重算成本塌到近 0，`apply` 其余代码全跑）。**代价**：K-C' 也屏蔽 wallpaper 的 token 写入效果，故 R4/R5 类功能项**不能**在 K-C' 里判。

### 5.1 M-A：基线（对照）

`exclusive-run.sh` 同参数跑 `capture6.mjs --scenarios all --reps 3 --win 8000`，记录 §4.2 全部字段。**不做任何打桩**（只保留 `capture6.mjs` 自己的 `INIT_HOOKS`）。

- **判定作用**：给出同机同条件基线；若与 `cpuL` 的比值量级一致（`applyShareOfBusy` 0.5–0.8、`RecalcStyle÷Task` ≈0.6），说明器械稳定，可进入 M-B/M-C。

### 5.2 M-B：阻断 `apply` 的重放（保留 publish、保留会话事件）

在 `INIT_HOOKS` 后追加 **K-C**（屏蔽 body 的强制重算）+ **计数器**（`removeProperty` on `document.body.style` = apply 次数）。

**同时把 `webgui` 的 WebSocket 入站帧按 `payloadType` 打时间戳**（patch `WebSocket.prototype.addEventListener`，在 `addInitScript` 里做）：

```js
const oAdd = WebSocket.prototype.addEventListener;
WebSocket.prototype.addEventListener = function (type, fn, opts) {
  if (type !== "message") return oAdd.call(this, type, fn, opts);
  return oAdd.call(this, type, function (ev) {
    try {
      const j = JSON.parse(ev.data);
      const pt = j?.payload?.type;
      if (pt) (window.__wsT = window.__wsT || []).push([performance.now(), pt]);
    } catch {}
    return fn.call(this, ev);
  }, opts);
};
```
（注意：**不要**包裹 `MessageEvent.prototype.data`——只包 `addEventListener` 的 `message`，覆盖面足够且不碰 App 的 `onmessage`；若 App 用 `onmessage` 赋值，则同时包 `WebSocket.prototype.onmessage` 的 setter。）

**产出**：① `apply` 时刻序列；② `session/event` 与 `session/projection` 时刻序列。
**判定**：
- **PASS（支持会话因果）**：`apply` 时刻与该窗口 `session/event` 时刻的 ±50 ms 命中率 **显著高于**随机置换基线（且 ≥ `session/projection` 的命中率）。
- **FAIL（否定会话因果）**：不显著 ⇒ 与 §1.7 的静态结论一致，靶点是设置链。
- **附**：本变体同时给出「(ii) 单独落地」的预期收益（`apply` 的 self-time 应大幅塌陷而 `apply` 次数不变）。

### 5.3 M-C：阻断 `theme` 重放，保留会话事件（正交对照）

**不阻断** `theme/change`、**不阻断** `getComputedStyle`；改为 **K-C'**（让 body 的 `removeProperty`/`setProperty` 变 no-op，从而 `apply` 全部代码照跑但**不产生 DOM 失效**，`:378` 的重算成本塌到 ~0）。

**判定**：
- 若 M-C 的 `RecalcStyle÷Task` 与 `>50ms 帧数` 改善量 ≈ M-B ⇒ 「成本几乎全部来自 `:378` 的强制重算」，(ii) 是主靶点。
- 若 M-C 几乎无改善而 M-B 改善巨大 ⇒ 成本来自「重放次数 × 每次写」（说明 token 数比实测的 1 多，或 `:378` 之外还有失效源），应优先 (0)+(i)。
- 若两者都改善一半 ⇒ (0)/(i)/(ii) 三者需一起上。

### 5.4 M-D（反证，可选但推荐）：只阻断会话事件

在 `MessageEvent` 层（`addInitScript`）拦截并**丢弃** `payload.type === "session/event"` 的入站帧（`return;` 不调用原 handler），**保留** `session/projection`。

- **须先确认安全性**：这会让页面处于「事件不完整」状态（渲染可能失真），**仅在一次短窗（≤8 s）测量中允许**，测完立即关页；且**不得**在 M-D 里做任何功能判定。
- **判定**：若 `apply` 次数与 `RecalcStyle` **基本不变** ⇒ **强否定**「会话事件 → apply 重放」。若显著下降 ⇒ 存在 §1.7 静态阅读未覆盖的路径，需回到源码再查（这是本轮最该警惕的反证）。

### 5.5 顺序与依赖（串行，全部持锁）

```
M-A（基线） ──► M-B（屏蔽 :378 重算 + 帧时间戳） ──► M-C（no-op body 写） ──► M-D（丢 session/event）
   │                    │                                  │
   │                    └─ 给出 (ii) 的预期收益             └─ 给出 (0)+(i) 的预期收益
   └─ 器械自证（ratio 0.9–1.1、rafP50 16.7、mu 记录非零）
```
每个变体 **≥2 窗**，且变体间必须**同一浏览器/同一会话/DOM 规模差 ≤5%**，否则不可比。任一窗 `gateOutcome !== 'EXCLUSIVE'` ⇒ 该窗作废重跑。

### 5.6 失败回退

| 失败 | 回退 |
|---|---|
| `getComputedStyle` 不可替换 | 用 K-C'（no-op body 的 `setProperty`/`removeProperty`） |
| `WebSocket.prototype.addEventListener` 已被包装过（`__dshPatched` 类标记） | 检查 `proto` 上的自定义标记，避免与 `capture6.mjs:45` 的 `__dshPatched` 命名冲突；用独立名 `__themeProbePatched` |
| `foreignCount > 0` 导致长期无法开窗 | 不加长等待（`exclusive-run.sh` 已 25 min 上限）；放弃本轮绝对值，只报比值并标 INCONCLUSIVE |
| 打桩后 App 报错/白屏 | 立即 `page.reload()` 核对是否有页面级异常；探针失败即作废该窗，**不得**用受污染数据填充结论 |

---

## 6. 边界：哪些是实跑、哪些是代码推断

### 6.1 实跑（本审计窗口内亲自执行/亲自重算的）

| 项 | 来源 | 性质 |
|---|---|---|
| `bundles[].fns = 2/4/6` 与 `bundle.selfMs ≡ 窗口 applyMs` | 本审计对 `raw/profile-cpuL-*.json` × 14 逐个重算 | **实跑（离线重算）**，逐窗可复现 |
| `apply/s`、`us/apply`、`recalcCount/s` 表 | 本审计由 `analysis-cpuL.json` 的 `bodyStyleWrites`(每窗 delta) 与 `wallSec` 重算 | **实跑（离线重算）** |
| 计数器口径（`writes` = `setProperty` **和** `removeProperty` 之和） | 本审计读 `capture6.mjs:47-48` | **实跑（读源码）** |
| 全部 `` path:line `` 引用 | 本审计用 `read`/`grep` 逐条核过（layout 455 行、ui-theme 1354 行、ui-settings、wallpaper 597 行、cordis index.js） | **实跑** |
| bundle `md5` 与 `?rev=` 对应关系 | 本审计 `md5sum` 四份副本 | **实跑** |
| `getComputedStyle`/`setProperty` 的调用栈 | 既有 `raw/apply-decisive.json` 的 `stacks`（上一轮线跑的） | **实跑（他人产物，本审计仅引用）** |
| 触发频率下界（6.2 /s home、3.7 /s long） | 既有 `raw/apply-decisive.json` 的 `bodyStyleWrites`(75/12.145 s、45/12.088 s) ÷ 2 | **实跑（他人产物 + 本审计换算）** |

### 6.2 代码推断（未经活体验证）

| 项 | 依据 | 为什么是推断 |
|---|---|---|
| §1.4 的「settings 链 → `derive()` 无条件 update → `adopt()` → `publish()`」是**主要**触发源 | 纯静态链路（ui-settings `:991`/`:1087-1109`、runtime `:5418`、ui-theme `:1146`/`:1182-1187`） | **未在活体上抓到触发栈**；`derive()` 是否每次都真的走到 `store.update`（例如 `mirrored.view === void 0` 的早退 `:1090`）取决于运行期状态。**这是本报告最需要活体验证的一条** |
| §1.5 的 `overrideTokens` 重入回响「最多 2 轮」 | 静态：`shading` 守卫 `:184`、`overrideTokens` 无条件 publish `:1230`、listener 顺序未定 | **顺序依赖**：`emit` 按 `dispatch` 过滤后的数组顺序调用（cordis `:263`），实际顺序 = listener 注册顺序，**未实测** |
| 「实例数 2/4/6 是**当前活着**的 presenter」 | `fns` 只证明「被采样到的不同函数对象」 | 已采样 ⇒ 被调用过；但**是否仍在 `theme/change` 列表里**未验（§4.1 P0 才能定） |
| (i) 的「削减 ≈50%」 | 由 §1.5 的「1 外部原因 → 2 轮 apply」推得 | 依赖 §1.5 的**推断**；若回响不成立则削减量更小（仅剩 §1.4 的重复 publish） |
| (ii-a) 用 `snapshot.active.tokens["--dsw-alias-bg-base"]` 替代 `getComputedStyle` | 静态：wallpaper `:189-194` 覆盖该 token；`base.css` 只在 `:root` 定义 `--dsw-font-family`（本审计从 bundle 内联 CSS 解出，全文 455 字符） | **未验证** body 的最终背景色是否**只**由该 token 决定（可能有其它 CSS 规则写 `body{background}`） |
| `apply` 的成本「几乎全部」来自 `:378` | §2.3 的规模效应表 + `applyShareOfScript > 1` | 规模效应**强烈提示**，但**未做 M-B/M-C 因果分离**（§5.2/§5.3 就是为此设计的） |

### 6.3 明确写出来的"改它不足以消除可感卡顿"

**倾向「不足」，标 INCONCLUSIVE，需 §5 的 M-B/M-C 定案。** 理由（全部来自已有实测，只用同窗比值）：

1. `apply` 占 busy 的 **0.50–0.80**（`applyShareOfBusy`，7 场景）⇒ 即使 `apply` **完全归零**，仍有 **20–50% 的非 idle 主线程工作**残留。按 `cpuL` 的 `home-idle`（busy 130.0 ms/s、apply 65.4 ms/s）估算，残留 ≈ **65 ms/s**；按 `long-idle`（busy 450.8、apply 348.9）估算残留 ≈ **100 ms/s**。
2. 残留里**第二大**的可归因项是会话链，但它只有 **3.2–10.1 ms/s**（§1.7）⇒ 残留主体是**采样表上看不到归属的散点**（`(program)`、GC、`(no-url:native/vm)` 内建、React commit、连接层），本报告**没有**把它们逐个归因。
3. `home-idle` 场景本身就是「安静」的（p50 16.7 ms、LongTask 0、`rafOver50` 6/2 窗），但其 `applyMs` 仍有 **38–65 ms/s** ⇒ **`apply` 在最轻的页面上也占掉约一半的非 idle CPU**。这说明修 `apply` 对**首页**也有效；但对**长会话/设置页**，`rafOver50` 达 42–80/2 窗、`rafPerS` 掉到 35.6–49，**残留的 100 ms/s 加上偶尔的 LongTask（设置页 15–18 个）仍可能造成可感卡顿**。
4. **因此结论**：修 `apply` 是**必要且高收益**的（它占第一，且 `RecalcStyle÷Task` 60% 的绝大部分由它产生），但**不保证**单独消除可感卡顿。判定必须走 §4.2 的 `rafOver50`/`rafP99`/`RecalcStyle÷Task` 阈值 + §5 的因果分离；若 M-B/M-C 显示 `apply` 归零后 `rafOver50` 仍 >10/2 窗，则须**追加**对残留项（GC / `(program)` / React commit）的归因。

---

## 7. 给协调者的落地建议（含单一写入者与重启边界）

| 候选 | 文件 | 是否需要重启 | 建议 |
|---|---|---|---|
| (0) 实例去重 | `dsh-client-ui-layout/lib/client.js`（`:436-446` 或上游装配） | **是**（client bundle `?rev=`） | 先做 §4.1 P0 活体确认实例数再改 |
| (i) 内容签名跳过 | 同上（`ThemePresenter`，`:347-390`） | **是** | 必须带 §2.4 守卫；与 (ii) 同文件，**同一写入者** |
| (ii) 去掉/延后 `:378` | 同上（`:378`） | **是** | 与 (i)、(0) 同文件 ⇒ **必须合并为一次改动、一次重启** |
| (iv) 覆盖层内容比较 | `dsh-client-ui-theme/lib/client.js`（`:1224-1236`） | **是** | 与上面不同文件 ⇒ 可与 layout 改动并行，但**同一轮重启** |
| (iii) `cssText` 合并 | — | — | **否决**（本部署 N=1 零收益 + 序列化风险） |

**注意**：`dsh-client-ui-layout` 与 `dsh-client-ui-theme` 都在 `~/.dsh/profiles/node_modules` 下（指向 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/...`）。**本审计严格只读、未改任何文件**；任何落地都属于协调者的写入职责，且需先确认「改这里还是改 repo 源码再重装」。
