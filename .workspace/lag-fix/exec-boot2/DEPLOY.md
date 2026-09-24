# DEPLOY — U-BOOT2 两段式启动断言（`exec-boot2` 单元）

> 状态：**补丁产物已就绪、自测与端到端实测已跑**；**deployed 写入由协调者执行**（本档无产品文件写权限）。
> 目标文件：`<dsh>/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-ClqxG24t.js`

---

## 1. 一句话

把 shell 的"**50 个插件包全部 `create` 成功才 `mountApp`**"改成"**必需集合在 `mountApp` 前断言（硬失败语义保留）+
非必需集合挂载后物化（失败以红色横幅 + `console.error` + 可查询全局对象响亮上报）**"，
并保留 `tier="all"` 一键回到旧行为。

---

## 2. 目标文件与哈希

| | 路径 | bytes | sha1-12 |
|---|---|---|---|
| 原始（当前产品） | `…/dsh-web-frontend/dist/assets/index-ClqxG24t.js` | 399,361 | `6a27728a8730` |
| 补丁候选件（**v3 最终**） | `.workspace/lag-fix/exec-boot2/candidates/C-dsh-web-frontend-index-ClqxG24t.js` | 409,299 | `29e6dacfe2c4`（sha256 `4093b7f44fbe1c44…`） |
| 备选候选件（v2，rAF 闸门版） | `candidates/ALT-v2-rAFgate-C-dsh-web-frontend-index-ClqxG24t.js` | 408,800 | `855b226617b6` |

> ⚠️ 文件名是**内容哈希**（`index-ClqxG24t.js`），但本补丁**改内容不改名** ⇒ 浏览器可能仍用缓存副本。
> 部署后必须**硬刷新**（或让用户 `Ctrl+Shift+R`），否则页面仍跑旧字节。
> 实测响应头**没有** `cache-control` / `ETag` / `Last-Modified`（`curl -sI /assets/index-ClqxG24t.js` 只有 `content-type`）。

---

## 3. 为什么只能改 dist（重建不可行的原因）

1. 本机**不存在** `apps/web` 源码树：产品包 `package.json` 的 `files` 只有 `["lib/*.js","config"]`，
   安装树内无 `apps/`、`packages/`、`src/`，全机 `find` 未找到 `dsh-web-frontend` 源码目录。
2. 该文件是 Vite/Rollup 的**压缩单行产物**（96 行、399 KB），无法从源码重建 ⇒ 只能做**锚点级文本补丁**。
3. `index-<hash>.js` 的文件名与内容绑定，**任何 `dsh` 版本升级都会以新哈希文件名覆盖**，本补丁随之失效
   （不报错、静默回到旧行为）。**升级后必须重跑 `apply-Boot2-v1.mjs` 的 dry-run 看 `ANCHOR_FAIL`。**

**维护代价（明确写在这里）**：每次 `dsh` 升级（或任何重建 Web 产物的操作）后，本补丁需重新落地；
锚点一旦不唯一命中，脚本会**一个文件都不写**并报 `ANCHOR_FAIL`（见 §7 自测证据）。

---

## 4. 改动面（三处锚点，全部唯一命中）

文件：`dist/assets/index-ClqxG24t.js`（行号为**补丁后**的行号；原始文件里这些方法都在第 93 行的压缩行内）

| 锚点 | 内容 | 位置 |
|---|---|---|
| A1 | `run()` 尾部：`await this.mountApp(c)` 之后接 `this.startDeferredTier(c)`（**不 await**） | 第 93 行 |
| A2 | `async runPluginBoot(n,i){` —— 整体替换为两段式实现 | 第 93 行起 |
| A3 | `;const da=document.getElementById("root")` —— 替换区间右界（类体收尾） | 第 220 行附近 |

新增/改写的类成员（补丁后行号）：

| 成员 | 行 | 作用 |
|---|---|---|
| `runPluginBoot` | 94 | 两段式：必需集合在 `mountApp` 前 `create` + `assertEntriesActive(n, essential)`；`tier="all"` 时走原全量路径 |
| `BOOT2_DEFAULT_TIER="deferred"` | **126** | **开关常量**（文件内可改；见 §5） |
| `BOOT2_DEFERRED_ALLOWLIST=[…20 个 id…]` | **127** | 允许延后的集合（默认 = 审计 `deferrable=yes` 去掉 `immediately` 行） |
| `bootTiers()` | 115 | 计算必需/延后集合（`deferred` / `wire12` / `all` 三模式） |
| `startDeferredTier(n)` | **146** | 挂载后启动延迟层（不阻塞 `run()`）；写 `data-dsh-boot2-mode` |
| `loadDeferredTier(n)` | 154 | **启动闸门**（第 156 行）：轮询 `[data-dsh-boot]` 启动卡消失（= React `createRoot` 已清空 `#root`、应用已接管容器）→ `requestIdleCallback(timeout 600)`；另挂 **1500 ms 硬兜底**（挂载失败 / 隐藏标签页 / 无 rAF 时也一定会启动 ⇒ 不会把「延后」变成「静默缺失」）；随后物化延后集合并逐个校验 `active` |
| `reportDeferredFailure(failed)` | **186** | **响亮上报**：`console.error` + 横幅 + 全局对象 |
| `renderDeferredFailure(failed)` | **192** | **可见形式**：`<div id="dsh-boot2-deferred-failure" data-dsh-boot2-deferred-failure="1" role="alert">`，`position:fixed; top:0; z-index:2147483647`，红色 `#b3261e`，含失败 id 与原因、可点 `×` 关闭 |
| `countActive(n)` | 218 | 统计 loader 条目总数/active 数（零回归证据） |
| `assertEntriesActive(n,i)` | **228** | 断言范围改为**按集合**；`i===void 0` 时行为与原来逐字一致 |

---

## 5. 开关（两个方向都实测过）

**方向 A —— 恢复旧行为（全量断言）**，任选其一：

```js
// ① 运行时（不需要改文件；推荐用于 A/B 验证）
globalThis.__DSH_BOOT2__ = { tier: "all" };        // 必须在 shell 执行前设置（addInitScript / 内联脚本）
// ② 文件内常量：把第 126 行改成
const BOOT2_DEFAULT_TIER="all";
```

**方向 B —— 回到新行为**：不设 `globalThis.__DSH_BOOT2__`（默认 `deferred`），或 `{ tier: "deferred" }`。

**诊断模式**：`{ tier: "wire12" }` = 只把审计的 **12 条启动必需闭包** 当必需集合（其余 38 条延后）。
本档实测该切分**会破坏首屏渲染**（见 `report.md` §A），**不要**在生产使用，仅用于复现/取证。

另可运行时替换延迟白名单：`globalThis.__DSH_BOOT2__ = { tier:"deferred", deferredAllow:[...ids] }`。

---

## 6. 部署步骤（协调者执行）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-boot2

# 0) 先看干跑：锚点是否唯一命中、语法是否过、frame 自检是否过
node scripts/apply-Boot2-v1.mjs
#    期望： [OK] … bytes 399361 → 409299 (Δ9938)  sha1_12 6a27728a8730 → …   syntax: OK   frame: OK

# 1) 落盘（自动写 pre-image 到 candidates/preimage/）
node scripts/apply-Boot2-v1.mjs --apply

# 2) 写后校验
sha1sum /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-ClqxG24t.js
#    期望 sha1-12 == 29e6dacfe2c4   （或与 --apply 输出的 sha256_after 一致）

# 3) 浏览器硬刷新（⌘/Ctrl+Shift+R）后自检页面
#    A. 控制台无 error；全局对象 __DSH_BOOT2_REPORT__ 存在，state=="ok"、activatedCount==50
#    B. document.documentElement.dataset.dshBoot2Mode == "deferred"
#    C. 无 <div id="dsh-boot2-deferred-failure">（没有延迟包失败）
```

**回滚**（任选）：

```bash
node scripts/apply-Boot2-v1.mjs --rollback          # 从最新 pre-image 恢复
# 或：cp candidates/preimage/<最新 preimage> <目标文件>
```

**验收链（本档用的实证器械）**：

```bash
node scripts/selftest-boot2.mjs                     # 逻辑单测 24/24（在 headless DOM 内跑，不碰产品文件）
node scripts/probe-boot2.mjs --reps 3 --tag x --shots   # 三臂 A/B/A + 失败臂端到端（需要共享锁）
```

> ⚠️ **本补丁修改的是"启动路径"**。`exec-a11y` 那批改动曾让整个会话区不可见的教训说明：
> 验收**不能只看"挂载时刻提前"**。本档验收含**整屏可渲染判据**（`#root` 矩形 >200×200、
> 视口 5×5 网格 ≥20 点落在 `#root` 内、`#root` 内可见元素 ≥300、会话区容器存在、
> 会话行/项目行 >0、正文文本 >200 字、`pageerror===0`、console error 0），逐相位落盘。

---

## 7. 本档已自证的部分（详见 `report.md`）

- **锚点唯一命中**：三锚点在产品文件里各 **1 次命中**；反向用例（人为注入重复锚点 / 空文件）⇒ `ANCHOR_FAIL`，**文件字节不变**、pre-image 目录不新增条目。
- **幂等**：对已打补丁文件再跑 ⇒ `ALREADY_APPLIED`，不写文件。
- **`--apply` / `--rollback`**：在沙箱副本上跑通，pre-image 自动生成、回滚后 sha1-12 回到 `6a27728a8730`。
- **逻辑单测 24/24**：必需/延后集合划分、开关双向、断言范围（延迟包不抛 / 全量口径仍抛）、错误文本逐字一致、失败上报四通道、横幅可关闭。

---

## 8. 已知风险与未闭合项

1. **审计的"12 条闭包"不能作为首屏必需集合**（本档实测：`wire12` 模式下 shell 抛
   `'root' has no registration — a layout entry must register into 'root' before the shell renders it`，
   DOM 停在 114 节点、无侧栏/输入框）。默认模式因此改用审计自己的 `deferrable` 分类
   （`deferrable=yes` 去掉 `immediately` ⇒ 20 条 / 5,431,021 B 延后；其余 30 条必需）。
   **这是本档对审计 C1 的偏离，已在 `report.md` §0/§A 显式上报，请协调者裁决。**
2. **白名单硬编码**：20 个 id 写在产物里。未知 id（新增插件）一律按**必需**处理（安全方向），
   因此新装插件不会因为不在白名单里而被延后。
3. **首屏观感**：延后集合在挂载后 ~250 ms 内开始物化；`conversation_render` / `settings_only` 类
   插件（如 pptmaster、btw、trajectory、tool 视图）会在挂载后补齐。实测整屏可渲染判据与
   `exec-boot` 的侧栏/输入框谓词见 `report.md` §C。
4. **没有源码可重建** ⇒ 升级即覆盖（见 §3）。
