# W22 · Web 前端构建与服务链路审计（传输层 / 构建产物形态 / HMR / 静态缓存）

> 线：`w22-serve`｜产出：`.workspace/lag-fix/program/w22-serve/`｜日期：2026-09-22
> 对象：`http://127.0.0.1:3080/`，宿主 **PID 2988915**（`node .../bin/dsh web`）
> 环境代际：**2026-09-22 18:11 冷面重启后**；旧宿主 301709 已退出。
> ⭐ **`U-BOOT2`（两段式启动）已落地**：壳层 `index-ClqxG24t.js` = **409,299 B / sha1-12 `29e6dacfe2c4`**（旧 `6a27728a8730` / 399,361 B）。
> ⚠️ **`U-BOOT1`（压缩）尚未落地** ⇒ 本线"无压缩"结论**仍然成立**，但"关键路径"的口径已因 U-BOOT2 改变，本报告全部按新口径重测。
> 纪律：**只读**（未重启/未 pkill/未改任何产品文件与用户 profile）；未使用 `sandbox_permissions`（本会话审批已禁用）；
> 未用浏览器做任何会改变服务端状态的请求（全部为 GET/HEAD 只读 HTTP + 本地读数）。

---

## 0. 一句话结论

| # | 问题 | 判定 | 结论强度 |
|---|---|---|---|
| **①** | **`Accept-Encoding` / `Range` 为何被忽略、加压缩的收益** | **无压缩中间件，纯属"没实现"**：两个发点都只 `writeHead(200, {content-type[, cache-control]})` 后 `res.end(body)`；**`Range` 被忽略**是因为 Node `http` **不会自动处理 Range**，而发点也没有手写实现 | **已确证**（源码 file:line + 同窗 HTTP 对照） |
| **②** | **加压缩的预期收益** | 关键路径 **6,463,519 B → 3,293,036 B（BR-q5，−49.05%）**；若只上 gzip-6 则 **→ 3,355,188 B（−48.09%）**。**注意 2.33 MB 壁纸 PNG 不可压**（占压缩后总量的 70.9%）⇒ 压缩的字节收益有**天花板** | **已确证**（用**真实字节**全量实测，非采样外推） |
| **③** | **bundle 划分是否合理 / 重复 vendor** | 重复 vendor **字节级假设被证伪**（4 KB 对齐块 **0 B** 冗余；逐字节最长相同段仅 **25,342 B = 0.303%**）；**但 lazy 通道缺失是结构性缺陷**（**48/50 包 = 99.77% 无任何按需通道**）；`assets/langs/*` 2.26 MB 确为懒加载（PASS）；tree-shake **无空间**（52 个零引用符号全被包内使用，删导出仅 ≈2 KB）；**但发现构建产物未 minify：1,188,598 B = 14.22% 可安全剥离（关键路径 711,473 B / 24.45%）** | **已确证**（子代理 A 档 + 主档复核） |
| **④** | **`?rev=` 不是内容哈希？缓存策略是否有效、有无陈旧风险** | **表述部分更正**：`rev` **确实是**磁盘内容的 sha1-12（50/50 条实测吻合），**但服务端 `serveBundle:466` 完全不消费它** ⇒ URL 里的 rev 是**装饰性的**。陈旧风险**分层判定**（§4.2）：**服务端 PASS**（逐请求现读、零 body 缓存）；**HTTP 缓存 FAIL（设计上未被排除）**（零校验器 ⇒ 304 路径不存在，条件请求 15/15 全 200）；**真实浏览器 INCONCLUSIVE**（本线禁浏览器）；**shell 更新通道 FAIL（可证明）**——`/assets/index-*.js` **不在 HMR 图内**，`U-BOOT2` 已把它的内容**就地**从 399,361 B 换成 409,299 B 而**文件名一字未变** | **分层已确证；浏览器侧 INCONCLUSIVE** |
| **⑤** | **HMR 的 `statSync`×N/500ms 成本与失效语义** | **成本可忽略**：**50–52 条 × 1.7–1.9 µs = 0.0898–0.0911 ms/轮 ⇒ 0.0182% 单核**（两档独立互证）；**失效语义 FAIL**（两条反例已构造：等长改内容 + ns 级 mtime 还原；rename 换 inode 同 mtime/size；本机 mtime 粒度 ~1 ms，300 次连写 96.99% 同刻）；**启动期 flood 证伪（0 帧）**，但发现**启动期 8,360,864 B 冗余 read+sha1（p50 5.355 ms）** | **成本/证伪已确证；失效语义 FAIL** |
| **⑥** | **静态缓存头与 304** | `/plugins/*` = `no-cache` 但**无 ETag/无 Last-Modified** ⇒ 每次导航**全量重传**（实测条件请求 **15/15 全 200**、`Range` **5/5 全 200、0 个 206**）；`/assets/*` 与 `/` = **完全没有缓存头**；`/dsh-wallpaper/*` = `private, max-age=31536000, immutable`（**唯一正确的一处**）+ SSE 发点也正确。**全站 0 个 304** | **已确证** |

---

## 1. 器械、口径与可信边界（先说清哪些数字不能用）

### 1.1 并发条件（决定绝对 ms 能否被引用）
- 本线全部测量在 **CONTENDED** 口径下：外部浏览器主进程 **1**（cmdline 口径：含 `--remote-debugging-*` 且不含 `--type=`，**绝不使用 `readlink(/proc/<pid>/exe)`**，见 BATCH-PLAN §五.17/.18）；`loadavg` **6.2 → 16.9** 全程漂移；宿主自身 CPU **53–163% 单核**。
- ⚠️ **本轮 loadavg 峰值（16.89）由我自己的探针推高**（见 §1.3 的探针自污染），已如实标注。
- ⇒ **本报告的绝对 ms 全部只作下限**；结论一律建立在**字节级判据**与**同一窗口内的对照**上。

### 1.2 新增的仪器陷阱（本线首次实测，建议全组采用）
🔴 **本机在"每请求新建连接"时存在临时端口/连接风暴峭壁**，使**连接阶梯类测量不可用**：
`conn-sensitivity.json`（同一份 essential 30 包、同一窗口、每格 6 s 静默、只变并发度，**每请求 `agent:false` 即新建连接**）：

| 并发度 | wallMs | lastEndMs | p50 | 中位单请求 TTFB |
|---|---|---|---|---|
| 1 | 2,220.6 | 1,114.5 | 10.3 | **10.3 ms** |
| 6 | 10,940.2 | 6,058.2 | 725.9 | **725.9 ms（70×）** |
| 16 | 11,381.2 | 11,283.4 | 6,293.9 | **6,293.9 ms（611×）** |
| 30 | 31.7 | 30.9 | 27.8 | 27.8 ms（回落） |
| **6 连接 + keep-alive 复用** | **14.1** | **10.3** | **1.3** | **1.3 ms** |

**读法**：同一批 2.9 MB 字节，
- **6 条全新连接/请求 ⇒ 6.06 s**；
- **6 条 keep-alive 复用 ⇒ 10.26 ms**（**590× 差**）。
⇒ 该差值是**连接建立风暴**（临时端口/内核排队），**不是** bundle 传输耗时。**任何"6 连接阶梯 ⇒ X ms"的绝对值在本机都是探针产物**；
⇒ 引阶梯结论时**只可用 w08 的浏览器内 Resource Timing 口径**（末包 779.3 ms / 挂载 930.4 ms，最平静窗），**不可用本线的外置探针绝对值**。
（本条不推翻 C3"消除六连接阶梯"的方向，但**显著削弱其本机收益估计**，见 §2.4。）

### 1.3 探针自污染（诚实清单）
- `tier-probe.mjs` 的首轮把**全 50 包 brotli 压缩**与**时序测量**跑在同一进程窗口内 ⇒ 那一轮时序（essential_6conn=3771 ms / essential_serial=1124 ms）**已作废**，改用 `transport-timing.mjs`（与压缩分离、每格静默）与 `conn-sensitivity.mjs`。
- `ladder-probe.json` 的 A/C 两组（全并发 26 连接）受同一风暴影响 ⇒ **已降级为"风暴量化"证据**，不作为传输耗时引用。

### 1.4 仪器自证
| 项 | 结果 |
|---|---|
| `rev` vs 磁盘 sha1-12 | **50/50 条全吻合**（`raw/rev-vs-disk.json`）⇒ 抓取不是盲区，且"rev = 内容哈希"得到独立确认 |
| 压缩字节判据 | 对**磁盘同一份字节**压缩，且 `compress-probe.json` 里对每个样本做了 **HTTP 取回字节 == 磁盘字节** 的 sha1 对照（`sameAsDisk`） |
| 编码协商阴性/阳性对照 | `identity` / `gzip, deflate, br` / `curl --compressed` 三种请求头**均返回 `size=4096057`（原样）**，且响应**无 `content-encoding`** |
| 304 阴性对照 | `If-None-Match: *` / `If-Modified-Since: <now>` 均 **200**（若实现正确，`*` 必得 304） |
| HTTP/2 阳性/阴性对照 | h2c prior-knowledge **报协议错误**、`--http2` upgrade **空回复**、`http_version=1.1` ⇒ h2 确实不可用（非客户端问题） |

---

## 2. ① 传输层：`Accept-Encoding` / `Range` 为何被忽略 + 压缩可行改法与收益

### 2.1 根因：**没有压缩/范围中间件，且 Node `http` 不会自动做这两件事**（源码确证）
| 发点 | file:line | 实际发送的头 | 后果 |
|---|---|---|---|
| 插件 bundle | `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:479-485` | `content-type` + `cache-control: no-cache` | 无 `content-encoding`、无 `content-length`（chunked）、**无 ETag** |
| dist 静态 | `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-host-frontend-static/lib/index.js:70-71` | **仅** `content-type` | 无 `content-encoding`、无任何缓存校验器 |
| webserver 装配 | `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js:197`（`createServer`）/`:244`（`listen`） | — | 用 `node:http`；**没有可用的全局响应拦截/中间件接缝**，`registerFallback`（`:157`）只认**无人认领**的请求 |

**为什么 `Accept-Encoding` 被"忽略"**：不是拒绝了协商，而是**根本没有代码读它**——两个发点都是 `readFile` → `writeHead` → `res.end(body)`，body 恒为原始字节。
**为什么 `Range` 被忽略**：Node 的 `http` 模块**不实现** Range（不像 `express.static`/`send` 会自动处理）；发点也没有手写 206 逻辑 ⇒ 恒定 200 全量。
**为什么是 chunked**：`writeHead` 未给 `content-length`，Node 用 chunked。**负作用**：浏览器/代理无法知道总长度（无进度、无法预分配、无法做部分缓存）。

### 2.2 压缩收益（**真实字节全量实测**，非外推）
口径：**U-BOOT2 后的关键路径 = essential 30 包 + shell 资产（js+css）+ 壁纸**（deferred 20 包**已不在**关键路径上）。

| 组成 | 原始 | BR-q5 | gzip-6 | 备注 |
|---|---|---|---|---|
| essential 30 包 | **2,909,676** | **642,348 (22.1%)** | **685,926 (23.6%)** | 首屏必需，压缩收益最高 |
| shell 资产（index+vendor 的 js/css 4 件） | **1,219,583** | **316,428 (25.9%)** | **335,535 (27.5%)** | |
| 壁纸 PNG | **2,334,260** | **2,334,260 (100%)** | **2,333,727 (100%)** | **PNG 已压缩 ⇒ 不可再压** |
| **关键路径合计** | **6,463,519** | **3,293,036 = 50.95%（−49.05%）** | **3,355,188 = 51.91%（−48.09%）** | |
| （参考）deferred 20 包 | 5,451,188 | 2,553,967 | 2,609,224 | 现已不在关键路径 |
| （参考）全 50 包 | 8,413,059 | 3,210,100 (38.2%) | 3,309,594 (39.3%) | w08 旧口径 11.9 MB 里的主体 |

> 逐样本明细与"HTTP 取回字节 == 磁盘字节"的 sha1 对照见 `raw/compress-probe.json`、`raw/compress-model.json`、`raw/tier-probe.json`。
> **关键观察**：压缩后剩余 3.29 MB 中 **2.33 MB（70.9%）是那张不可压的 PNG** ⇒ **②的字节收益天花板由壁纸决定**，不是由 JS 决定。

### 2.3 压缩的**成本**（决定"现压缩"还是"预压缩"）
| 档位 | 全 50 包单核耗时 | 单包最贵项（pptmaster 4.10 MB） | 压缩比（关键路径） |
|---|---|---|---|
| brotli q1 | **31.9 ms** | 12.8 ms | 略差（essential 796,096 B） |
| brotli q4 | 60.7 ms | **26.0 ms** | ≈q5 |
| brotli q5 | 88.6 ms | 35.7 ms | **−49.05%** |
| gzip-6 | 109.7 ms | 57.0 ms | −42.36% |

⇒ **每次冷启动若逐请求现压缩，就要付一次同量级的单核成本**。而 pptmaster 发点**每请求重读磁盘、无内存缓存**（`dsh-client-modules/lib/index.js:479` 的 `await readFile(path)`）⇒ 4.1 MB 的包**每个新页面都要现压缩 35.7 ms 单核**，在并发下线性放大（BATCH-PLAN §五 的"并发口径"陷阱在此处会直接咬人）。
⇒ **可行改法**：**构建期预压缩 + 内存/磁盘 `.br` 缓存**（按 `mtime+size` 或内容哈希失效），q4 比 q5 每包省 27% 压缩时间而压缩比几乎相同 ⇒ **推荐 br-q4 预压缩**。

### 2.4 消除六连接阶梯（C3）——**方向成立，但本机收益估计必须下调**
- 事实：`nextHopProtocol=http/1.1`（`transport-probe-v2.txt`）；浏览器每源并发上限 **6**（w08 §5-C3：39 个 bundle 的 `responseEnd` 呈 446→779 ms 阶梯）。
- **HTTP/2 可行性：本机不可行**。清文本 h2c `prior-knowledge` 与 `Upgrade: h2c` **均失败**（Node 的 `createServer` 不支持 h2c），而浏览器**只在 TLS+ALPN 下用 HTTP/2** ⇒ 要上 h2 就得引入 TLS。
  ⇒ **结论：C3 在本机部署形态下"不划算"**（证书/TLS 面 vs localhost 无 RTT 的收益）。**正确的替代方向是"减少请求数"，而不是"加宽并发"**（本机 §1.2 已证明加连接数反而把尾延迟放大 70–611×）。
- 验收判据修正：**不得**再用"在飞请求数峰值 >6 且阶梯消失"作本机判据；改为"**首屏请求数下降 X%**"（可用 `?rev=` 内容寻址 + 请求合并实现）。

---

## 3. ② 构建产物形态（bundle 划分 / 去重 / tree-shake）

> 证据：二级子代理 `bundle-shape` 档（`evidence/bundle-shape.json`，schema `dsh-w22-bundle-shape/v1`，脚本 `scripts/bundle-blockdup.mjs`）+ 本主档独立复核。

### 3.1 包树与口径（主档实测，可复核）
- 插件 bundle = **52 个** `lib/client.js` 文件存在，其中 **50 个**进入 `__DSH_BOOT__` 图（`dsh-client-hmr`、`dsh-client-modules` 等以 parser-blocking `<script>` 单独下发，不在图内）。
- `__DSH_BOOT__` 图：**50 条 / 16,536 B**，`rev=05d6c7dff127`；**50/50 条 URL 都带 `?rev=`** 且 **50/50 条的 rev == 对应磁盘 sha1-12**（`raw/boot-graph-v2.json`、`raw/rev-vs-disk.json`）。
- **体积分布极端长尾**：50 包合计 **8,360,864 B**（子代理口径）/ 8,413,059 B（主档含 2 个非图内包口径），**中位数仅 39,726 B**，而 `@local/dsh-pptmaster` **4,096,057 B = 48.99%**。
- 单包集中度：ppmaster 内联 base64 预览数据 2,498,758 B + pptx-renderer 1,487,836 B = **97.3%**（w08 静态审计已确证，file 级证据见 `w08/evidence/static-inventory.json` 的 `evidence[]`）。
- 分层（U-BOOT2 落地口径）：**essential 30 条 / 2,909,676 B**、**deferred 20 条 / 5,451,188 B**（`raw/tiers.json`）。

### 3.2 重复 vendor 内联 —— **字节级 PASS（0 B），但发现"逻辑重复"FAIL**
| 判据 | 结果 |
|---|---|
| 50 包按 **4 KB 对齐块** sha1 去重（2,069 个块） | **重复块 0 个、可移除冗余字节 0 B、占比 0.000%** |
| 逐字节"最长相同段"（独立口径） | 全 50 包**只有 1 段**：**25,342 B = 0.303%**（zod，`dsh-client-connection@133,586` ↔ `dsh-api-remotes@105,426`） |
| shell vendor 与插件的块级交集 | `index-ClqxG24t.js` **0** 个匹配块、`vendor-D22_Mp1f.js` **0** 个匹配块 |
| 滑动窗口对照（4 KB 窗口、512 B 步长） | 172,032 B = 2.058%，但该数是**同一区域被重复计数** ⇒ **子代理已声明不可引用为结论**（我主档 §3.2 初稿曾引用此数，**此处更正**） |
- **结构原因（子代理 A 的根因解释）**：shell 维护**单例注册表**（`index-ClqxG24t.js:93` 注册 `react`/`react-dom`/`cordis`/`primitives`/`slots`），50 包合计只有 **9 个外部说明符 / 110 处 `require`** ⇒ **插件包结构上不内联这些 vendor**。
- ⇒ **判定 PASS**：**不存在"多个包各自内联同一 vendor"的构建缺陷**。**这条假设被证伪，不应再作为优化方向**。
- ⚠️ **但有一条 FAIL 子项（新发现，值得单列）**：**`zod` × 5 包（≈368,078 B）与 `schemastery` × 5 包（≈57,302 B）** 被**各自内联 5 次**且**都不在 shell 注册表里** ⇒ 合计 **≈425,380 B 逻辑重复**，其中落在 **essential 关键路径**的约 **320,202 B**（zod 4 载体 262,900 B + schemastery 5 载体全在 essential 57,302 B）。修法 = 把二者提为注册表单例（与 react 同构）。**注**：该 425,380 B 是**厂商标记聚类的下界估计**（量级可信、非精确）；**精确可判定的只有那 25,342 B 一段**。

### 3.3 可延迟性 / lazy 通道 —— **FAIL（结构性缺陷）**
- **50 包中 48 条无任何运行时按需加载通道**（`8,341,298 B = 99.77%`）：只能"启动期整包拉取"。
  - essential 30 条中 **21 条无通道**；deferred 20 条中 **18 条无通道**。
  - 唯一两个"有通道"的是 `@deepseek-ai/dsh-client-modules`（加载器本体）与 `@deepseek-ai/dsh-client-hmr`（prefetch 消费者）⇒ **本质是"包内零第二种粒度"**。
  - deferred 里体量最大且**无任何 lazy 通道**的：`ui-trajectory` 359,173 B、`btw` 335,993 B、`ui-settings-models` 131,544 B、`usage` 81,631 B、`ui-tool` 78,222 B。
- ⇒ **U-BOOT2 之所以必须用"启动协议分层"来解决，正是因为构建产物层没有按需加载通道**。**注意 U-BOOT2 的分层只在"包粒度"有效，包内零细分**（例如 pptmaster 4.1 MB 是**一个整包**，无法在包内按需）。
- 正面：`assets/langs/*`（23 个文件 / **2,258,416 B**）**确为懒加载**（`index-ClqxG24t.js:61` 的 23 处 code-state 动态 `import()`；`index.html` 0 引用）⇒ **语言包不占关键路径**（该项 PASS）。
  - （子代理澄清：文本标记类扫描给出的 11 条"疑似懒加载"多为**误报**——`lazy(` 实为 schemastery 的 `Schema.lazy`、`import(` 多为类型注解文本。**不要用泛文本标记判 lazy 通道**。）

### 3.4 构建产物**未压缩** —— **PASS（可判定的大额字节）**
- **插件 client bundle 未做 minify**（shell 已压缩、插件包没有）：注释 **601,741 B** + 字符串外缩进 **573,124 B** = **1,188,598 B = 50 包总字节的 14.22%**，**可安全剥离**，且 **50/50 条剥离后通过语法校验**（说明不是扫描器伪数）。
- **落在关键路径的部分**：essential 30 条中 **711,473 B = 该层字节的 24.45%**。
- 这是**无需改架构、无需运行时代价**的确定性字节收益（下界；真实 minify 还含标识符压缩，收益更高）。
- 口径说明：本项是"剥离注释/缩进"的**下界**；完整 minify 需 DSH 源码仓库的构建步骤（**本机只有产物，无源码仓库、无 minifier、无构建配置 ⇒ 落地位置不在本线可达范围**，见 §9）。

### 3.5 导出面 tree-shake —— **FAIL（无空间）**
- 189 个导出中 **52 个零外部引用**，但 **0 个是"整块无用"**（全部在包内被使用）⇒ **删导出语句合计仅约 2 KB**。
- 已知死导出 `ConnectionBanner`：shell `:93` **仅定义处命中 1 次**、50 包 **0 命中** ⇒ **确定零引用**，但**字节收益 INCONCLUSIVE**（其实现体在已压缩的 shell 内已被压成单/双字符标识符，无法从产物给出可信字节量；量级估计 <1 KB）。
- ⇒ **判定 FAIL**：**"加大 tree-shake 力度"在本部署没有可判定空间**，不要把它列为候选。

### 3.6 🔴 **口径警示：w08 `static-inventory.json` 已过期（13/50 条）**
- **主档独立复核**：把 w08 清单的 `bytes`/`sha1_12` 与**当前磁盘**逐一对照 ⇒ **MATCH 37/50、DRIFT 13**。
  例：`client-runtime` 398,569→**402,389**（`5559de4ce28c`→`9d1772e7d5e1`）、`ui-theme` 80,114→**117,156**、`ui-layout` 24,988→**39,726**、`dsh-client-hmr` 3,427→**4,219**、`btw` 335,348→335,993、`usage` 72,804→81,631、`ui-workspace` 114,359→127,389、`ui-renderer` 39,235→42,999、`ui-settings-general` 26,593→29,610 …（共 13 条）。
- **原因**：14:48 之后**兄弟线并发重建了产物**（16:39–18:31）。
- **影响**：任何引用该清单 `bytes` 的地方都会**偏小**（子代理 A 复核：`tiers.json.essential_bytes` 口径偏小 **77,892 B**）。
- ✅ **本报告的字节结论不受影响**：§2.2 的 6,463,519 B 是**从当前磁盘/服务端实时源重算**的（`raw/tier-probe.json` + 子代理 A 独立复现，**delta = 0**），不是抄 w08 清单。
- ⚠️ **唯一需要留意的下游影响**：`raw/tiers.json` 的**分层成员判定**源自 w08 的 `deferrable` 分类（分类语义未变），但 `ui-theme` 等 13 条的**体积**已变 ⇒ 若后续有档要按分层算字节，**必须重算，不得直接引用 `tiers.json` 里的旧数字**。

### 3.7 U-BOOT2 之后"关键路径"的口径必须改写（**算术精确闭合**）
- 旧口径（w08）：11.9 MB（= **11,914,707 B** = 全部 50 包 **8,360,864** + shell **1,219,583** + 壁纸 **2,334,260**）。
- **新口径（现在）**：**6,463,519 B**（= essential 30 的 **2,909,676** + shell 1,219,583 + 壁纸 2,334,260）。
- **闭合验证**：`11,914,707 − 5,451,188（deferred 20） = 6,463,519` —— **分毫不差**，三档独立复现（主档 `raw/tier-probe.json`、子代理 A 独立命令、w08 旧口径）⇒ **可靠**。
  > 验证算术：8,360,864（= 2,909,676 + 5,451,188）+ 1,219,583 + 2,334,260 = **11,914,707 B**（= 11.363 MiB，即 w08 说的"11.9 MB"）。
- 口径来源：`startDeferredTier` 在 `mountApp` **之后**、**不 `await`**；`assertEntriesActive(n, t.essential)` 只断言必需集合——已在**已部署字节**中核实（`/tmp/served-index.js` 内出现 `BOOT2_DEFAULT_TIER="deferred"`、`assertEntriesActive(n,t.essential)`、`startDeferredTier`）。
- ⇒ **本线后续候选不应再重复计"deferred 5.45 MB"这份收益**（那正是 w08 §C1 的收益，已被 `exec-boot2` 吃掉）。

---

## 4. ③ `?rev=` 语义与缓存策略有效性 / 陈旧风险

### 4.1 `?rev=` = 内容哈希，但**服务端不消费它**（双判据）
| 判据 | 证据 |
|---|---|
| `rev` 确实是磁盘内容的 sha1-12 | 生成点 `dsh-client-modules/lib/index.js:147-149`（`shortHash` = `sha1().slice(0,12)`）、`:414`（`initialBundleRevision`）、`:328`（`rebuilt()` 重新读文件算哈希）；**实测 50/50 条 URL 的 rev == 对应磁盘文件的 sha1-12**（`raw/rev-vs-disk.json`） |
| **服务端忽略它** | `serveBundle`（`:459-486`）只从 `pathname` 解析出包 id 与后缀（`:471-473`），**从不读 `req.url` 的 query**；`readFile(path)` 后直接 `writeHead(200, {...})`。**没有任何 `if (rev !== diskRev)` 分支** |

⇒ 准确表述应是：**"`?rev=` 是内容哈希，但它不是缓存键的有效组成部分——服务端把它当空气。"**
（这比"`?rev=` 不是内容哈希"更精确；w08 的表述在**结论方向**上成立，但归因需按此改写。）

### 4.2 陈旧风险 —— **分层判定**（服务端 PASS，HTTP 缓存 FAIL，浏览器 INCONCLUSIVE）
- **真实事件**（本线本轮直接证据）：`/assets/index-ClqxG24t.js` 的内容被 `U-BOOT2` **就地**替换（**399,361 B / sha1-12 `6a27728a8730` → 409,299 B / sha1-12 `29e6dacfe2c4`**），而 **URL 与文件名一字未变**；其发点（`dsh-host-frontend-static/lib/index.js:70-71`）**只发 `content-type` + chunked，无 `Cache-Control`、无 `ETag`、无 `Last-Modified`**。
- **⚠️ 更硬的一条（子代理 B 档的可证明结论）**：**shell bundle 根本不在 HMR 图里**——50 条 graph row **全是** `/plugins/<id>/client.js?rev=`（实测 50/50），`bootInjections` 只预载插件 id（`dsh-client-modules/lib/index.js:198`、`:232-236`）。
  ⇒ **shell 内容变化既无 HMR 通道、也无校验器通道**，只能靠一次**全量手工重新下载 409,299 B**（或硬刷新）——**这一条是 FAIL，且不依赖浏览器实测**。
- 分面判定：
  | 面 | 判定 | 依据 |
  |---|---|---|
  | **服务端是否吐陈旧字节** | **PASS** | 两个发点都是 `readFile` **逐请求现读**、**零内存 body 缓存**（`dsh-client-modules:479`、`dsh-host-frontend-static:61`） |
  | **HTTP 缓存（浏览器/代理/CDN）** | **FAIL（设计上未被排除）** | 无任何 validator ⇒ **304 路径不存在**（实测条件请求 15/15 全 200）⇒ 一旦某层缓存存下该响应，**它再也无法被校验**；RFC 9111 §4.2.2 允许在缺显式过期信息时采用**启发式新鲜度**。本机 `webServer` 只绑回环：`dsh-web-app/lib/index.js:39` 的 `LOOPBACK_HOST = "127.0.0.1"`，其 profile 补丁把 host 钉为 `127.0.0.1`（`dsh-web-app/cordis.patch.yml:125`），且 `--host 0.0.0.0` 被**显式拒绝**（`dsh-web-app/lib/startup.js:40`）⇒ **当前没有共享代理**，故这是"规范上不被排除"而非"本机已发生" |
  | **浏览器实测** | **INCONCLUSIVE** | 本线禁用浏览器（只读纪律）。规范上无 validator ⇒ 合规缓存只能重取（安全）或按启发式发旧副本；Chrome/Firefox 的启发式新鲜度主要依赖 `Last-Modified`，缺失时通常回落 0 ⇒ **倾向重取**，但**无法在本线实测** |
  | **应用 shell 的更新通道** | **FAIL（可证明）** | 见上：shell 不在 HMR 图、无校验器 ⇒ 手工全量重下 |

### 4.3 缓存策略**是否真的有效**
| 发点 | 头 | 每导航字节成本 | 判定 |
|---|---|---|---|
| `/plugins/<id>/client.js?rev=` | `cache-control: no-cache`，**无校验器** | **每次导航全量重传**（essential 2.91 MB） | **FAIL**：`no-cache` 的语义是"必须先向源验证"，**但没有 ETag/Last-Modified 就无从验证** ⇒ 退化成"每次全量"。**这是纯损失**：既没省字节，也没拿到缓存的好处 |
| `/assets/*.js`、`/assets/*.css` | **无任何缓存头** | 每次导航**按启发式**决定（不可控） | **FAIL**：不可控 = 不可验收 |
| `/`（HTML） | **无任何缓存头** | 每次全量 + 每次现算 `renderIndex` | **FAIL**（且 `dsh-host-frontend-static/lib/index.js:81-83` 每请求 `readFile(index.html)`） |
| `/dsh-wallpaper/media/*.png` | `private, max-age=31536000, immutable` + `content-length` | **0** | **PASS**——**全站唯一正确的一处**，可作为其余发点的照抄模板 |
- **304 全站为 0**（`If-None-Match: *` 与 `If-Modified-Since: <now>` 实测均 200）。
- ⇒ 一句话：**缓存策略在当前实现下"形式上存在（`no-cache`）、实质无效（无校验器）"**。最便宜的有效修法见 §6-C2（加 ETag），比压缩更省事且**也直接消除 §4.2 的陈旧风险**。

---

## 5. ④ HMR 与热载（`statSync`×N/500ms 的成本与失效语义）

> 证据：主档独立实测（`raw/hmr-statcost.json`）+ 二级子代理 `hmr-cache` 档（`evidence/hmr-cache.md`、`evidence/hmr-cache.json`、脚本 `scripts/hmr-{watchscale,falsify}.mjs`）。两档独立实现，结论互证。

### 5.1 成本 —— **可忽略**（数字判据，两档独立互证）
| 项 | 主档实测 | 子代理 B 实测（独立实现） |
|---|---|---|
| `watched` 规模 | **52 条**（= 包树里存在 `lib/client.js` 的条目数） | **50 条**（经 SSE `/plugins/events` 首帧 `graph` 权威取得，与 `__DSH_BOOT__` 50 条一致） |
| 每次遍历 `statSync` | **0.0898 ms**（1.728 µs/次） | **0.0911 ms**（1.8829 µs/次） |
| 折算 | **0.018% 单核** | **0.0182% 单核**（判定阈值：<0.1% = 可忽略） |
- ⇒ **HMR 轮询的 CPU 成本可忽略**（PASS）。`statSync`×50 的"看起来吓人"不构成任何性能问题。
- 配置面：`pollIntervalMs` 默认 500（`dsh-client-hmr/lib/index.js:28`），**部署未覆盖 ⇒ 500 ms 实际生效**。
- **诚实边界**：本机文件恒在 page cache（1.7–1.9 µs/次）；**冷 cache / 网络挂载下会退化**——需 root `drop_caches` 且会干扰同批延迟线 ⇒ **INCONCLUSIVE（不可构造）**；替代口径（新进程首触 1.863 µs）与稳态无差异，解析上界（10× 惩罚）仍 <0.2% 单核。

### 5.2 失效语义 —— **FAIL（已构造两条反例）**
判据（`dsh-client-hmr/lib/index.js:88`）：`if (!watch.dirty && current.mtimeMs === watch.mtimeMs && current.size === watch.size) continue;`
- **已构造反例 ①**：**等长改内容 + mtime 还原**（`utimes` 写回原 ns 值）⇒ 判据全等 ⇒ 漏检。
- **已构造反例 ②**：**`rename` 换 inode**（替换文件但 mtime/size 恰好相同）⇒ `statSync` 走路径、不比较 `ino` ⇒ 漏检。
- **放大因素（实测）**：本机 **mtime 粒度约 1 ms**，**300 次连续写有 96.99% 落在同一 mtime** ⇒ **等长改动可"自然"漏检**，无需刻意构造。
- **漏检后无补偿**：客户端 `client.js:86` 对 `type:"graph"` 帧是 `break`（**直接忽略**）⇒ 图变化不参与对账 ⇒ **页面继续跑旧代码，直到手工刷新，且无任何提示**。
- **判定 FAIL**。**代价不对称**：漏检 ⇒ 静默陈旧；误报（多算一次哈希）⇒ 仅 1 次 sha1（且 `rebuilt():329` 会早退）。
- **已实测验证的最便宜修法**：把 **`ctimeMs`（或 `ino`）**加入 watch 记录（`:69-74`）与判据（`:88`）——两条反例的 `ctime` 都会变，**误报成本 ≈ 0**。（子代理已实测两者 ctime 均变。）

### 5.3 启动期 flood 假设 —— **证伪（0 帧），但发现一处纯冗余**
- `watchRow`（`:55-77`）在 `:76` **无条件**调用 `rehash` → `rebuilt(id)`；`syncWatches`（`:92-103`）启动时对**每条**各调一次 ⇒ **确实发生 50 次 `rebuilt(id)` 调用**。
- **但 SSE 帧 = 0**，两道**独立**闸门（子代理 B 用代码证明，比主档更完整）：
  - **闸门 1（主因）**：`dsh-client-modules/lib/index.js:329` 的 `if (rev === record.entry.rev) return rev;` 早退。启动瞬间重算的 rev 与 `processOne()`/`initialBundleRevision()`（`:431`、`:412-419`）用**同一算法、同一未变文件**算出的值**必然相等** ⇒ `rebuildListeners`（`:332-336`）永不触发。
  - **闸门 2（顺序双保险）**：`ctx.effect` 是**同步执行** callback 的（`cordis/lib/index.js:1134/1249`）⇒ effect #1 的 `syncWatches()`（`client-hmr:105`）**跑在** effect #2 注册 `onRebuilt`（`:145`）**之前**，此刻订阅者为 0；且 `connections`（`:115`）为空 ⇒ 广播循环 `:151` 空转。
- ⇒ **判定：启动期 flood 不成立（PASS）**——**不要**按"启动期会重载 50 个包"去优化（那会改错地方）。
- **真实代价（子代理 B 新发现）**：这 50 次 `rebuilt()` 每次都做 `readFileSync + sha1`，而 `processOne/initialBundleRevision` **已经在同一份字节上算过一次** ⇒ **纯冗余**：**8,360,864 B 重复读取 + sha1，p50 5.355 ms（min 4.485 / max 6.746）**，单线程宿主上落在启动关键路径。
  ⇒ **廉价修法（P2）**：`watchRow` 只把 `baseline` 写进 watch 记录，**不调 `rebuilt()`**（基线即表内现值）。
- **真正的残留竞态**（子代理 B 补齐）：若文件在"客户端连上 SSE 之前"变了，`rebuilt` 帧**发给空气**（`connect()` `:116-131` 只发一条 `: connected` + 当前图，**无 backlog、无重放**），客户端又忽略 `graph` 帧 ⇒ **静默丢失一次热更新**。**但不会导致服务端吐陈旧字节**——因为 `prefetch` 用的是冻结的 boot 行 URL（`dsh-client-modules/lib/client.js:170`），而服务端**忽略 `?rev=`**（`:466`），取到的**始终是当前磁盘字节**。
- ⇒ ⚠️ **耦合警告（本线最重要的一条）**：这个"自愈"**不是设计保证，而是 §4.1"服务端忽略 rev"缺陷的副作用**。**任何让服务端开始消费 `?rev=` 的改动，必须同时修这个竞态**（正解见 §6-C4b：让客户端接住已在收的 `graph` 帧并对账），否则会把"恰好自愈"变成"确定性拿到旧字节"。

---

## 6. 前三优化候选（收益 / 风险 / 验收 / 回滚 / 冷热面）

> 验收通则（沿用 BATCH-PLAN §四/§五）：**同窗对照、比值判据、保留所有 invalid 窗口**；功能回归须含 `assertEntriesActive`（必需 30 条全 active）、deferred 失败响亮上报、设置 4 个 tab、插件列表、用量 9 路 RPC、会话列表行数不回归。
> **本轮的排序依据**：`关键路径 = 6,463,519 B`（U-BOOT2 后）。**收益一律以"关键路径字节"计**（可移植判据；本机 wall 受并发污染，不可作判据）。

### C7 ★★ 壁纸 PNG → WebP（**单笔收益最大，且是压缩收益的天花板本身**）
- **改动点**：壁纸发点与资产管线（`@local/dsh-wallpaper`；`~/.dsh/wallpapers/37758c1c-….png`，PNG 1810×1279，2,334,260 B）。
- **收益（子代理 A 实测，PIL 10.2.0，内存内不落文件）**：
  | 编码 | 字节 | 相对 PNG 的节省 |
  |---|---|---|
  | PNG（现状） | 2,334,260 | — |
  | **WebP q82** | **219,126** | **−2,115,134 B（−90.6%）** |
  | WebP q75 | 175,730 | −2,158,530 B |
  | JPEG q85 | 370,626 | −1,963,634 B |
  | 无损 PNG 重压 | 2,297,276 | 仅 −36,984 B（**几乎无效**） |
  ⇒ **关键路径 6,463,519 → 4,348,385 B（−32.7%）**。**这比"给全部 JS 加压缩"还大**（后者省 3,170,483 B，但那是**不可压的 2.33 MB 之外的**部分；而本项直接消掉那 2.33 MB 主体）。
- **风险**：**用户可见观感变化**（属用户配置面）；`immutable` 长缓存意味着换了格式要换 URL（当前 upload/import 用 `randomUUID()` 命名，天然满足）。
- **验收**：① 同尺寸下该 URL `decodedBodySize ≤ 0.4 MB`；② **像素级视觉对照**（SSIM ≥0.98 或人工并排对照）；③ `mountMs` 同窗不退化（±10%）；④ 壁纸在设置页/首屏两处渲染均正常（含 `darkMask`/`opacity` 合成）。
- **回滚**：保留原 PNG 与 `settings.yaml:wallpaper.global.source` 的切换（用户配置面，可即时回退）。
- **面**：**热**（用户配置/资产，无需重启）。

### C-MIN ★★ 插件 client bundle 加 minify（**确定性字节收益、无需改架构**）
- **改动点**：插件客户端构建步骤（`lib/client.js` 的产出侧）。**注意落地位置不在本机**：本机只有产物，**无 DSH 源码仓库、无 minifier（树内无 esbuild/terser/rollup/swc）、无构建配置** ⇒ 属**源码仓库侧的构建改动**。
- **收益（子代理 A 实测，下界）**：注释 **601,741 B** + 字符串外缩进 **573,124 B** = **1,188,598 B = 50 包总字节的 14.22%**，**50/50 条剥离后通过语法校验** ⇒ 不是扫描器伪数。**落在关键路径：essential 30 条中 711,473 B = 该层的 24.45%**。
  ⇒ **关键路径 −711,473 B**（下界；完整 minify 还含标识符压缩 ⇒ 真实收益更高）。
- **风险**：低。注意 ① 必须保持 `?rev=`/`rev_wire` 语义（内容变了 rev 必须变——**这本来就是内容哈希，自动满足**）；② source map 若需要则一并产出（当前 50 包仅 1 个有 `.map`，见 §7-#22）；③ 不要在构建期引入"保留 mtime"的原子写（会触发 §5.2 的漏检）。
- **验收**：① 50 包 `decodedBodySize` 合计下降 ≥14%（关键路径 ≥24%）；② **功能零回归**：50 条 `assertEntriesActive` 全 active、`?rev=` 与磁盘 sha1-12 一致、热载仍生效；③ 首屏 `mountMs` 同窗不退化；④ 语法/加载正确性（构建期 `node --check` + 运行期 0 pageerror / 0 console error）。
- **回滚**：构建开关（产物层可整包回退旧 `client.js`）。
- **面**：**冷**（插件构建 + 重载；客户端侧改动经 HMR 生效）。

### C2 ★ 服务端压缩（**必须"预压缩 + 缓存"，且本机收益≈0**）
- **改动点**：`dsh-client-modules/lib/index.js:479-485`（插件 bundle 发点）与 `dsh-host-frontend-static/lib/index.js:70-71`（dist 静态发点）。**首选在此二处各加一个 `negotiateEncoding(req)` 前置**——因为 `dsh-host-webserver` **没有全局中间件接缝**：`registerFallback`（`:157-163`）**二次注册直接 throw**，frontend-static 已占该席位，**无法**当全局拦截器（子代理 B 已核实）。备选：`dsh-host-webserver/lib/index.js:197-207` 的 `createServer` 回调内包装 `res`（更集中，但动的是所有路由）。
- **生态面**：`compression` 包**不存在**（已核实），但 `accepts@2.0.0`、`negotiator@1.1.0`、`bytes@3.1.2`、`vary@1.1.2` 都在 ⇒ 可**零新依赖**用 Node 内置 `zlib` 实现。
- **收益（真实字节）**：关键路径 **6,463,519 → 3,293,036 B（br-q5，−49.05%）** / **→ 3,355,188 B（gz-6，−48.09%）**。
- **成本（必须计入）**：全 50 包 br-q5 **88.6 ms 单核**；pptmaster 单包 **35.7 ms**。**若逐请求现压缩，pptmaster 每个新页面都要付 35.7 ms 单核且在并发下线性放大**（发点当前**每请求重读磁盘、零内存缓存**）⇒ **必须预压缩/缓存**；推荐 **br-q4 预压缩**（每包省 27% 压缩时间、压缩比几乎相同）。
- 🔴 **本机收益≈0（子代理 B 实测）**：8.36 MB 上 **gzip CPU 112.26 ms vs loopback 传输 124.89 ms ⇒ 净 +12.6 ms（即几乎持平、略亏）**。⇒ **本项价值在远程/SSH 链路 + 异步 worker + 磁盘缓存**，不是 localhost 首屏优化。
- **风险**：① **必须排除 SSE 路由**（`/plugins/events`、`events.mux`、`events.host`——`text/event-stream` 不能被压缩缓冲破坏）；② 与 `Range` 的交互（当前无 Range，将来补时需重验）；③ 代理层重复压缩（加 `Vary: Accept-Encoding`）；④ chunked + 压缩叠加导致总长度更不可知（可顺带补 `content-length`）。
- **验收**：① `content-encoding` 存在且 `encodedBodySize/decodedBodySize ≤ 0.55`（br）/`≤ 0.60`（gz）；② 关键路径 `decodedBodySize` 合计 **≤ 3.5 MB**（br）；③ `mountMs` 同窗**不退化**（±10%）；④ 功能回归：50 条全 active、SSE 三通道不断连、`?rev=` 与磁盘 sha1-12 一致；⑤ 冷热面：**冷**（宿主代码 + 重启）。
- **回滚**：移除中间件（纯服务端、无客户端状态、无持久化副作用）。

### C2b ★ `/plugins/*` 加 ETag + `/assets/*`+`/` 加 `Cache-Control`/`Last-Modified`（**最低成本、且同时修掉 §4.2 陈旧风险**）
- **改动点**：同 C2 的两个发点；`/plugins/*` 侧**内容哈希已经现成**（`clientModules` 的 `rev` = 磁盘 sha1-12，`dsh-client-modules/lib/index.js:147-149/414/328`）⇒ **只需 `res.writeHead(200, {..., etag: '"<sha1-12>"'})` 并在请求头带 `if-none-match` 时回 304**（零新计算，零新依赖）。`/assets/*` 与 `/` 侧加 `etag` + `last-modified` + `cache-control: no-cache, must-revalidate`。
- **收益**：`/plugins/*` 每次导航 **2,909,676 B → 0 B（304）**（跨导航与多标签页场景）；**并直接消除 §4.2 的陈旧风险**（有校验器才有自愈路径）。**子代理 B 的实测补充**：本机（loopback）压缩几乎持平（8.36 MB：gzip 112.26 ms CPU vs loopback 传输 124.89 ms，**净 +12.6 ms**）⇒ 进一步支持"**先做 ETag/缓存头（纯收益），压缩留给远程面**"的排序。
- 🔴 **铁律（子代理 B 档确证，违反会造成永久性热载失效）**：**绝不能给 `/plugins/*` 加 `max-age`**。
  理由：客户端把 `?rev=` **冻结在 boot 时刻**（`dsh-client-modules/lib/client.js:170` 写入一次、**此后永不刷新**）⇒ 若 `/plugins/*` 被赋予长缓存，**服务端再怎么更新，客户端 URL 不变、缓存不失效** ⇒ **HMR 永久静默失效**。
  ⇒ 正确形态是 **`no-cache` + ETag**（每次都验证、验证通过才 304）；**只有内容寻址路径（C4b）才配 `immutable`**。
- **风险**：低。注意点：**ETag 必须由内容算出**（不能用 mtime，否则 §5.2 的同一缺口会复现）；`/`（HTML）是**动态内容**（注入 boot manifest）⇒ 必须 `no-cache` 且 ETag 要覆盖注入后的字节。
- **验收**：① 同一 URL 第二次请求（带 `If-None-Match`）**返回 304 且 `content-length: 0`**；② 改内容后 ETag 变化且返回 200 新字节（**回归哨兵**：`served rev == 磁盘 sha1-12`）；③ **HMR 未回归**（改一个 client.js ⇒ 热载仍生效——**这一条正是"不能加 max-age"的回归测试**）；④ 冷热面：**冷**（宿主代码 + 重启）。
- **回滚**：去掉头部（无状态）。

### C4 ★ 把 `?rev=` 从"装饰"改成"真缓存键"（或明确删掉它）
- **证据**：§4.1（服务端完全不读 query，`serveBundle:466` 用 `new URL(...).pathname` **丢弃 query**；实测 `?rev=deadbeefcafe` 与裸 URL 的 body sha1-12 **完全相同**＝`f84a29c46a9e`）+ §5.3（客户端 `graphRows` 只在 `client-modules/client.js:170` 写一次、**永不刷新**）。
- **两条互斥的正确做法，必须二选一**（现状是"两不像"：既没有缓存、也没有校验）：
  - **C4a（最小改动）**：**服务端校验 rev**：`serveBundle` 解析 query 后把 `rev` 与当前 `shortHash(readFile(path))` 比对；不一致 ⇒ 拒绝（410/409）或 302 到新 URL。收益：把"恰好自愈"升级为**确定性正确**。
  - **C4b（收益最大，推荐与 C2b 一起做）**：**让 rev 真正参与更新**，两步：
    ① **客户端接住已经在收的 `graph` 帧**（`dsh-client-hmr/lib/client.js:86` 现为 `case "graph": break;` ⇒ 改成比对 `graph.rev` 并 reload 差异 id）⇒ **关闭 §5.3"连上 SSE 前文件已变"的静默丢帧竞态**，并让 rev 真正有意义；
    ② 服务端**校验 rev**（同 C4a）；此后可安全地把 `/plugins/<id>/client.js?rev=<sha1-12>` 做**长缓存 + `immutable`**（因为 URL 会随 `graph` 帧真正改变）。
- **风险**：C4a/C4b 必须**同时**处理"客户端 URL 里的 rev 可能落后于磁盘"这一竞态（否则会把当前的自愈变成确定性陈旧）；`graph` 帧对账要处理 `external`/注入顺序（图内已有 `orderByModuleGraph` 语义）。
- **验收**：① **陈旧哨兵**：人为构造"URL 不变而磁盘内容变"⇒ 客户端**必须**拿到新字节（**这正是本轮 `index-ClqxG24t.js` 真实事件的回归测试**）；② 50/50 rev 与磁盘 sha1-12 一致；③ 跨导航 bundle 传输字节下降 ≥90%（C4b 的 ② 生效后）；④ **HMR 回归**：改一个 client.js ⇒ 3 s 内热载生效且 `__DSH_HMR__.rebuilds` 递增。
- **回滚**：C4a 保留直通开关；C4b 保留旧路径解析。
- **面**：**冷**（宿主）+ 客户端半 HMR 面（**热**：client bundle 改动经 HMR 即时生效）。

### C5 ★ HMR 判据与启动冗余的廉价修正（**纯收益、改动极小**）
- **改动点**（二选一或都做）：
  - **① 启动冗余**：`dsh-client-hmr/lib/index.js:76` 的 `watchRow` **不再调用 `rehash`/`rebuilt`**，只写基线 ⇒ 省掉启动期 **8,360,864 B 重复 `readFileSync` + sha1（p50 5.355 ms，最大单件 pptmaster 2.25 ms）**（该哈希 `processOne/initialBundleRevision` 已算过，**:412-419**）。
  - **② 失效判据**：watch 记录（`:69-74`）与判据（`:88`）**加入 `ctimeMs`（或 `ino`）** ⇒ §5.2 两条已构造的反例**均被覆盖**（已实测两者 ctime 都变），**误报成本 ≈ 0**（`rebuilt():329` 会早退）。
- **收益**：启动关键路径 **−5.4 ms**（确定性）；消除"等长改动静默漏检"这一类**静默陈旧**（可判定性收益 > 性能收益）。
- **风险**：极低；`ctimeMs` 在某些文件系统上语义不同（需在同一回归里验证"改内容 ⇒ ctime 必变"）。
- **验收**：① 启动期 `readFileSync` 次数下降 50 次（可用 strace/计数器或用 `rehashCost` 复现脚本对照）；② **反例回归**：等长改内容 + mtime 还原 ⇒ **必须**被检出并热载（当前 FAIL 的那条）；③ HMR 正常路径未退化（`rebuilds` 计数与端到端热载时延 ±10%）。
- **回滚**：单行改动，反向 patch 即可。
- **面**：**热**（`dsh-client-hmr` 是 client bundle，改动经 HMR/刷新生效；宿主半需冷面）。

### （已落地，不再重复记账）U-BOOT2 与 U-BOOT1 的关系
- **U-BOOT2 已上线**：deferred **20 条 / 5,451,188 B** 移出关键路径 ⇒ **w08 §C1 的收益已被吃掉**。本线**不再重复计这份收益**。
- **U-BOOT1（压缩）未上线** ⇒ C2/C2b 是当前**唯一未被覆盖的传输层收益**。

### 候选优先级（按"关键路径字节收益 ÷ 风险 ÷ 面成本"，**已按 U-BOOT2 后的 6,463,519 B 口径重排**）
| 序 | 候选 | 关键路径字节收益 | 成本/风险 | 面 |
|---|---|---|---|---|
| **1** | **C7 壁纸 PNG→WebP q82** | **−2,115,134 B（−32.7%）** | 低（观感面，可回退） | **热** |
| **2** | **C-MIN 插件 bundle minify** | **−711,473 B（essential 层 −24.45%）**（下界） | 低（需源码仓库构建步骤） | **冷** |
| **3** | **C2b ETag + 缓存头/304** | 每次导航 **−2,909,676 B**（304）；**并修掉陈旧风险** | 低（哈希现成，零新依赖） | **冷** |
| 4 | C2 传输压缩（br-q4 预压缩） | −3,170,483 B（−49.05%）**含已压壁纸口径** | 中（须预压缩+缓存、排除 SSE）；**本机 wall 净 +12.6 ms** | **冷** |
| 5 | C5 HMR 廉价修正 | 0 B，但**启动 −5.4 ms** + 修掉静默陈旧 | 极低（单行级） | 热/冷 |
| 6 | C4b 客户端接 `graph` 帧 + 服务端校验 rev | 0 B（使 rev 有意义，解锁长缓存） | 中（须与 C2b 同批） | 冷+热 |
| 7 | zod/schemastery 提为注册表单例 | ≈**−320,202 B**（下界估计） | 中（跨包依赖治理） | 冷 |
| 8 | 拆分 pptmaster 单包 | 0 B（关键路径外）——减**延迟层** | 中 | 冷 |
| — | **C1/C6** | **已被 U-BOOT2 吃掉（5.45 MB）** | 不重复记账 | — |
- **C3 不做**（HTTP/2 本机不可行且方向反号）；**C9/C10 不做**（本机 INCONCLUSIVE）。

### 明确证伪、不要投入的方向（避免返工）
| 方向 | 为什么不要做 |
|---|---|
| "多个包各自内联同一 vendor ⇒ 去重省字节" | **4 KB 对齐块去重 = 0 B 冗余**、逐字节最长相同段仅 **25,342 B（0.303%）**（§3.2） |
| "加大 tree-shake 力度" | 52 个零外部引用符号**全部在包内被使用**，删导出仅省 ≈2 KB（§3.5） |
| "启动期 HMR 会重载 50 个包 ⇒ 先修 flood" | **flood = 0 帧**（§5.3，双闸门），真正该修的是判据与那 5.4 ms 冗余 |
| "HMR 轮询 `statSync`×50 是性能问题" | **0.0182% 单核**（§5.1）⇒ 成本可忽略，**不要**改成 inotify |
| "上 HTTP/2 消除六连接阶梯" | 本机 h2c 不可用、浏览器需 TLS；**且加连接数会把尾延迟放大 70–611×**（§1.2） |
| "加压缩能省本机首屏 wall 时间" | loopback 上 gzip CPU 112.26 ms vs 传输 124.89 ms ⇒ **净 +12.6 ms**（§7-#23） |
| 用泛文本标记（`lazy(`/`import(`）判 lazy 通道 | 子代理实测**多为误报**（`lazy(` 是 schemastery 的 `Schema.lazy`、`import(` 多为类型注解文本）⇒ 必须用 **code-state/构建产物**证据 |

---

## 7. 逐条判定汇总

| # | 条目 | 判定 | 关键证据 |
|---|---|---|---|
| 1 | `Accept-Encoding` 被忽略的根因 = 无压缩实现 | **已确证** | `dsh-client-modules/lib/index.js:479-485`、`dsh-host-frontend-static/lib/index.js:70-71`；3 种请求头实测均 `size=4096057` |
| 2 | `Range` 被忽略的根因 = Node `http` 不自动处理 + 发点未实现 | **已确证** | `Range: bytes=0-1023` → 200；`createServer` 于 `dsh-host-webserver/lib/index.js:197` |
| 3 | 加压缩可行（零新依赖） | **PASS** | `compression` 包不存在但 `accepts/negotiator/bytes/vary` 在；Node 内置 `zlib` |
| 4 | 压缩收益（真实字节） | **PASS（−49.05% br-q5 / −42.36% gz6）** | `raw/compress-model.json`、`raw/tier-probe.json` |
| 5 | 压缩收益的天花板（PNG 不可压 70.9%） | **已确证** | PNG 2,334,260 → br 2,334,260 |
| 6 | 现压缩 vs 预压缩的成本 | **已确证（必须预压缩）** | br-q5 全 50 包 88.6 ms 单核；pptmaster 35.7 ms/请求 |
| 7 | 关键路径 = 11.9 MB（旧口径）**已失效** | **口径更正** | U-BOOT2 后为 **6,463,519 B** |
| 8a | 重复 vendor 内联 | **证伪 / PASS（0 B 冗余）** | 4 KB 对齐块 2,069 个，重复块 0；滑动窗口对照仅 2.058% |
| 8b | shell vendor 与插件包重复 | **PASS（0 个匹配块）** | `vendor-D22_Mp1f.js` / `index-ClqxG24t.js` 各 0 匹配 |
| 8c | 运行时 lazy 通道覆盖 | **FAIL（39/50 包无通道）** | `evidence/bundle-shape.json` → `lazy_scan` |
| 8d | `assets/langs/*` 懒加载 | **PASS** | 动态 `import()` 表在 `index-ClqxG24t.js` 内 |
| 9 | `?rev=` 是内容哈希但服务端不消费 | **已确证（表述更正）** | `:471-473` 只解析 pathname；50/50 rev 与磁盘 sha1-12 吻合 |
| 10 | 陈旧风险（URL 不变而内容变） | **FAIL（已实际发生）** | `index-ClqxG24t.js` 399,361 B→409,299 B 而文件名不变；发点无缓存头 |
| 11 | `/plugins/*` 缓存策略有效 | **FAIL** | `no-cache` + 无校验器 ⇒ 每次导航全量重传 |
| 12 | `/assets/*` 与 `/` 缓存策略 | **FAIL** | 无任何缓存头 |
| 13 | 壁纸发点缓存 | **PASS** | `private, max-age=31536000, immutable` + `content-length`；upload 用 `randomUUID()` 命名（`dsh-wallpaper/lib/index.js:183`、`:219`）⇒ 同 URL 字节不可变 |
| 13b | SSE 发点缓存 | **PASS** | `/plugins/events` 用 `no-cache` + `keep-alive`，语义正确 |
| 14 | 全站 304 支持 | **FAIL（0 个 304）** | 条件请求 **15/15 全 200**；`Range` **5/5 全 200（0 个 206）** |
| 14b | shell bundle 的更新通道 | **FAIL（可证明）** | shell **不在 HMR 图内**（50/50 graph row 全是 `/plugins/`）；无校验器 ⇒ 只能手工全量重下 409,299 B |
| 15 | HMR 轮询 CPU 成本 | **PASS（0.0182% 单核）** | `raw/hmr-statcost.json` + 子代理独立复现 0.0911 ms/轮 |
| 16 | HMR 轮询在冷 cache / 网络挂载下的退化 | **INCONCLUSIVE** | 需 root `drop_caches` 且会干扰同批延迟线；替代口径与稳态无差异 |
| 17 | HMR 失效语义（漏检同 mtime 同 size 变更） | **FAIL（两条反例已构造）** | `dsh-client-hmr/lib/index.js:88`；本机 mtime 粒度 ~1 ms，300 次连写 96.99% 同刻 |
| 18 | 启动期 `rebuilt` flood 假设 | **证伪 / PASS（0 帧）** | `dsh-client-modules/lib/index.js:329` 早退 + cordis `effect` 同步执行顺序双保险 |
| 18b | 启动期冗余 `readFileSync`+sha1 | **FAIL（新发现，纯冗余）** | `dsh-client-hmr/lib/index.js:76` 对 50 条各重算一次哈希，**8,360,864 B / p50 5.355 ms**，与 `:431/:414` 重复 |
| 19 | "服务端忽略 rev" 与 HMR 自愈的耦合 | **⚠️ 耦合警告** | 自愈依赖缺陷；修 §4.1 时必须同时修 §5.3（见 §6-C4b） |
| 19b | `/plugins/*` 绝不能加 `max-age` | **🔴 铁律** | 客户端 `graphRows` 冻结 rev、永不刷新（`dsh-client-modules/lib/client.js:170`）⇒ 长缓存 = HMR 永久静默失效 |
| 20 | 连接阶梯的绝对值可用性 | **FAIL（探针产物，不可引用）** | `raw/conn-sensitivity.json`：6 连接复用 10.26 ms vs 每请求新连接 6,058 ms |
| 21 | HTTP/2（h2c / TLS）本机可行性 | **FAIL（不可用/不划算）** | h2c 两种方式均失败；`http_version=1.1` |
| 22 | source map 是否在启动关键路径 | **PASS（可忽略）** | 50 包仅 **1 个**有 `.map`（336,000 B）；w08 冷启动时间线 50 个请求**零 `.map`**。残留：开 devtools 时其余 49 个 map 各 404（纯日志噪声） |
| 23 | 压缩在本机的净收益 | **≈持平（−5.4% 量级）** | 8.36 MB：gzip CPU 112.26 ms vs loopback 传输 124.89 ms ⇒ **净 +12.6 ms**（子代理 B 实测）⇒ 压缩的价值在**远程/SSH 面** |

---

## 8. 交付物与复现

| 路径 | 内容 |
|---|---|
| `audit.md`（本文件） | 结论、判定、候选、INCONCLUSIVE |
| `raw/transport-probe-v2.txt` | 传输层头部与协商实测（重启后新宿主；旧宿主版本 `raw/transport-probe.txt` 一并保留作对照） |
| `raw/compress-probe.json` | 关键路径抽样压缩实测（含"HTTP 取回字节 == 磁盘字节"sha1 对照、各档耗时） |
| `raw/compress-model.json` | **全 50 包** gzip6/br5 全量压缩模型（真实字节） |
| `raw/tier-probe.json` | 分层（essential/deferred）字节 + 压缩成本 + 分层到达时间（含 CPU 采样） |
| `raw/conn-sensitivity.json` | **连接数敏感性（§1.2 仪器陷阱的证据）** |
| `raw/transport-timing.json` | 受控传输段测量（含宿主 CPU 与 loadavg 前后快照） |
| `raw/ladder-probe.json` | 连接阶梯（**已降级为风暴量化证据**） |
| `raw/boot-graph-v2.json` | 服务端实际下发的 `__DSH_BOOT__` 图（50 条） |
| `raw/tiers.json` | U-BOOT2 分层清单（essential 30 / deferred 20） |
| `raw/rev-vs-disk.json` | 50 条 `?rev=` 与磁盘 sha1-12 的逐条对照（50/50 吻合） |
| `raw/hmr-statcost.json` | HMR 轮询成本微基准（200 采样） |
| `scripts/*` | 主档脚本（`transport-probe.sh`、`compress-probe.mjs`、`compress-model.mjs`、`tier-probe.mjs`、`conn-sensitivity.mjs`、`transport-timing.mjs`、`hmr-statcost.mjs`、`census.sh`、`proc-cpu.sh`、`measure-server.mjs`） |
| `evidence/bundle-shape.json` | 二级子代理 A 档（构建产物形态 / 4 KB 块去重 / lazy 扫描 / 字节复核）；脚本 `scripts/bundle-blockdup.mjs` |
| `evidence/hmr-cache.md` · `evidence/hmr-cache.json` | 二级子代理 B 档（HMR 语义 / 缓存头 / 304 / source map / 陈旧风险）；脚本 `scripts/{hmr-watchscale,hmr-falsify,cache-headers,cache-transport,cache-compress-cost,hmr-consolidate}.mjs` |
| `evidence/hmr-cache.md §3.3` `§5.2` | 两条**新发现**的一手依据：启动期 8,360,864 B 冗余 read+sha1（p50 5.355 ms）；gzip CPU 112.26 ms vs loopback 传输 124.89 ms |

**复现**：
```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/program/w22-serve
bash   scripts/census.sh                                   # 并发普查（cmdline 口径）
bash   scripts/transport-probe.sh                          # 传输层协商/头部/Range/304/h2c
node   scripts/compress-probe.mjs                          # 抽样压缩（含字节一致性对照）
node   scripts/compress-model.mjs                          # 全量压缩模型
DSH_HOST_PID=2988915 node scripts/tier-probe.mjs            # 分层字节 + 分层时序
DSH_HOST_PID=2988915 node scripts/conn-sensitivity.mjs      # ★ 连接数敏感性（仪器陷阱）
DSH_HOST_PID=2988915 node scripts/transport-timing.mjs      # 受控传输段测量
node   scripts/hmr-statcost.mjs                            # HMR 轮询成本
```

### 8.1 与全组纪律的对齐
- **只读**：未重启宿主、未 pkill、未改任何产品文件与用户 profile、未使用 `sandbox_permissions`。
- **并发普查**：cmdline 口径（含 `--remote-debugging-*` 且不含 `--type=`），**未使用** `readlink(/proc/<pid>/exe)`（BATCH-PLAN §五.17/.18）。
- **探针锁**：本线**未开浏览器窗口**（全部为外置只读 HTTP + 本地读数），故无需持锁；已核对当前无他线浏览器窗口（`foreignBrowserMainCount=1` 属其他线，未干扰其状态）。
- **绝对 ms 标注**：全部标注了宿主 CPU%、loadavg 前后快照与并发主进程数；探针自污染已单列（§1.3）。

---

## 9. INCONCLUSIVE 清单（诚实边界）

| # | 项 | 原因 |
|---|---|---|
| 1 | 压缩在**本机的 wall-clock 收益** | localhost 无 RTT；且宿主被并发压住时抖动极大（同批 2.9 MB 实测 10 ms ↔ 11 s）⇒ **只有字节比可移植**；子代理 B 的 loopback 对照实测为**净 +12.6 ms**（≈持平） |
| 2 | 连接阶梯的真实耗时 | 本机每请求新建连接触发临时端口/连接风暴（§1.2）⇒ 绝对值是探针产物 |
| 3 | HMR 轮询在**冷 cache / 网络挂载**下的成本 | 需 root `drop_caches` 且会干扰同批延迟线 ⇒ 不可构造；替代口径（新进程首触 1.863 µs）与稳态无差异 |
| 4 | `?rev=` 陈旧风险在**真实浏览器**中的实际命中 | 需浏览器缓存行为观测；本线两档均**未开浏览器**（遵守只读纪律）。规范层面已判定"无 validator ⇒ 无法再校验"，但 Chrome/FF 的启发式新鲜度取重取还是取旧副本无法在此实测 |
| 5 | 共享代理/CDN 侧的陈旧 | 本机 `webServer` **只绑回环**：`dsh-web-app/lib/index.js:39`（`LOOPBACK_HOST="127.0.0.1"`）+ `dsh-web-app/cordis.patch.yml:125`；`--host 0.0.0.0` 被显式拒绝（`dsh-web-app/lib/startup.js:40`）⇒ **当前没有共享代理可观测** |
| 6 | HMR 失效语义漏检的**端到端**复现 | 只在**判据级**构造了两条反例（端到端需改被 watch 的 `client.js`，违反"不改产品文件"纪律） |
| 7 | HTTP/2 在**远程部署**下的收益 | 本地无 RTT、无 TLS 现状 ⇒ 不可测 |

> **无阻塞项**：本线 5 个审计面全部有明确结论；上述 7 项均已给出"为什么不可测"而非"没测"。

---

## 10. 需要协调者裁决的事项

1. **口径更正（影响全组账本）**：`关键路径 = 11.9 MB` **已因 U-BOOT2 失效**，现为 **6,463,519 B**；deferred 的 5.45 MB **已在 U-BOOT2 中被吃掉**，**后续任何候选不得再重复计这份收益**。
2. **`?rev=` 的表述更正**：`rev` **是**磁盘内容 sha1-12（50/50 实测），**但服务端从不消费它**（`serveBundle:466` 用 `new URL().pathname` 丢弃 query；实测 `?rev=deadbeefcafe` 与裸 URL 字节 sha1 相同）。账本里若写"`?rev=` 不是内容哈希"应改为"**`?rev=` 是内容哈希但不是有效缓存键（服务端忽略 query、客户端永不刷新）**"。
3. **优先建议**：**C2b（ETag + 缓存头/304）先于 C2（压缩）** —— 成本更低（哈希现成）、**同时修掉 §4.2 的陈旧风险**，且 loopback 上净正收益；而 C2 的本机 wall 收益 ≈0（甚至净 +12.6 ms），字节收益要到**远程/SSH 面**才兑现。**C2b 必须与 C4b 同批或先于 C4b**，且**绝不给 `/plugins/*` 加 `max-age`**。
4. **⚠️ 耦合警告（会影响 `exec-hmr` 的收口）**：§5.3 的"恰好自愈"依赖 §4.1 的"服务端忽略 rev"。**任何让服务端开始消费 `?rev=` 的改动，必须同时修"客户端 URL 里的 rev 可能落后于磁盘"这一竞态**（正解 = 客户端接住已经在收的 `graph` 帧并对账，§6-C4b），否则会把当前的自愈行为变成**确定性陈旧**。
5. **C3（HTTP/2）建议不排期**（本机不可行且方向反号），改为"减少首屏请求数"口径。
6. **四条"别改错地方"请入账本**：① 重复 vendor 去重 = **0 B**（证伪）；② tree-shake = **仅 ≈2 KB 空间**（证伪）；③ 启动期 HMR flood = **0 帧**（证伪）；④ HMR 轮询成本 = **0.0182% 单核**（可忽略）。避免后续波次重复投入。
7. **新增三条确定收益**：① **壁纸 PNG→WebP q82 −2,115,134 B（−32.7%）**（单笔最大）；② **插件 bundle minify 下界 −1,188,598 B / 关键路径 −711,473 B**；③ 启动期 `rebuilt` 冗余 **8,360,864 B 重复读 + sha1（p50 5.355 ms）**。另：source map 无关键路径占用（PASS），但 devtools 下 49 个 map 各 404 的噪声可顺手消除。
8. 🔴 **数据卫生告警（会影响其他线）**：**w08 `static-inventory.json` 已过期 13/50 条**（主档独立复核：MATCH 37 / DRIFT 13；兄弟线在 16:39–18:31 并发重建了产物）。**凡引用该清单 `bytes`/`sha1` 的线都必须重算**（例：`ui-theme` 80,114→117,156、`ui-layout` 24,988→39,726、`client-runtime` 398,569→402,389）。本报告的 6,463,519 B 是**实时重算**的，不受影响；但 `raw/tiers.json` 里的**旧字节数字**不得再被引用（成员分类仍有效）。
9. **一处无法在本机落地的事项**：C-MIN 与 C2/C2b 的**落地位置不在本机**——本机只有产物，**无 DSH 源码仓库、无 minifier（树内无 esbuild/terser/rollup/swc）、无构建配置** ⇒ 属源码仓库侧改动；本线只能给出**产物侧测量下界**。**C7（壁纸）与 C5（HMR 判据）是本线唯一可在本机闭环验证的两项。**
