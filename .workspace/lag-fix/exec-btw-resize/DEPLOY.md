# DEPLOY.md — btw 抽屉可拖拽调宽/调高（Phase 1 热面 + Phase 2 冷面）

- **线**：`w10-btw-resize` / 执行档 `exec-btw-resize`
- **独占目录**：`.workspace/lag-fix/exec-btw-resize/`
- **上游契约**：`program/w10-btw-resize/audit.md`（631 行，单元 U-BTW-R1…R8）
- **宿主**：PID 301709（本档**全程未重启、未发信号、未 pkill 任何浏览器**）
- **本档职责边界**：Phase 1 = 实现 + 构建 + **候选件 + 部署脚本 + 真机验证**；**deployed 写入由协调者执行**
  （本档沙箱对 `~/.dsh/...` 无写权限，且协调者已明确分工）。Phase 2 = **只准备，不落地**。

---

## 0. 一句话

| 相位 | 改动面 | 生效方式 | 本档状态 |
|---|---|---|---|
| **Phase 1** | `dsh-btw/src/client/**`（新组件/CSS/locales/store 座位 + 求解器显式尺寸分支 + hook 的 sizeRef/remeasure） | **热面**：只对 `lib/` 双向拷贝 → 刷新浏览器 | **候选已冻结 + 真机验证通过**，等协调者落 `lib/` |
| **Phase 2** | `dsh-btw/src/index.ts`（宿主 schema）+ `src/client/btw-settings.ts` + 新增 `drawer-size-settings.ts` + 抽屉接线 | **冷面**：schema 改动随宿主重启一次（`lib/index.js` 走 ESM 缓存） | **候选 + 锚点补丁脚本 + schema 预检已就绪，未落地** |

---

## 1. Phase 1（热面）落地步骤

路线必须是 **B：改源码 → 重建 → 只对 `lib/` 双向拷贝**。
（部署位 `src/` 是**旧快照**（与仓库 `diff -rq` 有 23 处差异、缺 5 个文件），运行时装单位**只吃 `lib/`**；
`.module.css` 被 lightningcss 内联进 `lib/client.js`，所以 CSS 改动**必须重建**。）

### 1.1 已冻结的候选件

> 🔴 **2026-09-22 17:15 更新（务必先读）**：a11y 线（`dsh-exec-a11y` / U-A11Y3）在 **16:55:55** 把部署位就地打了补丁
> （`d2bdd4c3…`，= 旧字节 + 一处 U-A11Y3 插入），并把同一改动写进了源码 `src/client/index.ts`。
> ⇒ 本档 16:22 冻结的 **R1 会回退他们的线上改动，禁止直接落**。已用当前源码重建 **R2 = 两边并集**：

| 项 | 值 |
|---|---|
| **应部署的候选** | `candidates/R2/lib/client.js` |
| bytes / sha256 | **361651** / **`ca6cc0ec4f992f0edd89b0e3a6fbba73f24d0231d147ee22486d292770f67cec`** |
| 内容自证 | `grep -c "dsh-btw-handle"` = 2（本档）**且** `grep -c "__dshA11yBtwChord"` = 1（a11y 线） |
| 单元/DOM 判据 | `vitest` **245 passed / 2 skipped**；影子树 DOM spec **8/8** |
| R1（**作废**） | `9aa82dc5…`（361191 B）——真机 38/40 判据跑在它上面；与 R2 的差异只有 a11y 那一处源码改动 |

> ⚠️ **pre-image 台账已过期**：`preimage/SHA256SUMS.txt` 是 16:00 前的 live（`28ccb37a…`），当前 live 是 `d2bdd4c3…`
> ⇒ `apply-BtwResize-v1.mjs` 的 drift 闸门**会拒绝写入**（设计行为）。落地前请**重新取一次 pre-image**。

> ⚠️ 以下 R1 段落保留为历史记录。

| 项 | 值 |
|---|---|
| 候选文件 | `candidates/R1/lib/client.js` |
| bytes | **361191** |
| sha256 | **`9aa82dc52c9529a3846d1a52cbd003f935635d8ba55b3147bef5cebd6a72ac63`** |
| mode | 664 |
| pre-image（改动前的部署位，从**当前 live** 取） | `preimage/client.js` sha256 **`28ccb37a360e16e924e934665ed9c06094dbdbb73491d3b07938a4856df234d3`**（335348 B） |
| pre-image 台账 | `preimage/SHA256SUMS.txt`、`preimage/META.txt` |

其余 `lib/*.js|*.d.ts` 与 pre-image 逐字节相同（本次只改客户端 bundle）：见 `preimage/SHA256SUMS.txt`。

### 1.1bis 🔴 与他线的写入冲突（17:20 实测，落盘前必读）

- **源码 `src/client/index.ts`**（md5 `50ab701e0a62b8ae`）里有 `exec-a11y` 的 `/*<<dsh-exec-a11y:U-A11Y3:v1*/` … `/*>>…*/` 块（`:93–114`，含 `isEditableTarget()` 输入豁免与 `__dshA11yBtwChord` 钩子）。
  **本档从不整文件替换 src**，所以它随重建进了产物：行为级核验 `isEditableTarget`×2、`__dshA11yBtwChord`×1 都在。
- ⚠️ **但注释标记在构建产物里为 0**（minifier 剥注释）：源码 2 → 仓库 lib 0；profile 位仍有 2，只因为 a11y 用的是**文本锚点补丁**。
  ⇒ **不要**用"产物里有没有 `dsh-exec-a11y:U-A11Y3:v1` 注释"判断改动是否还在。
- **仓库 lib ≠ served**：仓库 `lib/client.js`（md5 `bdc5c240566ecd50`，R2）vs profile 挂载位（md5 `6b3245b994574bde`，仅 a11y）。
  **部署必须落到 profile 路径**；`--verify` 比的是**响应体 sha256**。
- **drift 已重新基准化**：`preimage-landing/` = 17:19 从 live 取的 profile 快照（md5 `6b3245b994574bde`，也是回滚目标）；
  原 R0 快照保留在 `preimage/`（sha256 `28ccb37a…`）不动。落地前若他线又写了 profile，`--apply` 会**按设计拒绝**，请先 `--resnapshot`。

### 1.2 落地（协调者执行）

```bash
cd /home/CNS2026495165/dsh/dsh-btw
node node_modules/tsdown/dist/run.mjs                      # 重建（幂等；产物 sha256 应等于候选件）

# 只拷 lib/（绝不拷 src/）
node /home/CNS2026495165/dsh/.workspace/lag-fix/exec-btw-resize/scripts/apply-BtwResize-v1.mjs            # dry-run：先看计划 + pre-image drift
node /home/CNS2026495165/dsh/.workspace/lag-fix/exec-btw-resize/scripts/apply-BtwResize-v1.mjs --apply --confirm-apply
```

脚本内置三项核对（审计 §4.6）：

1. **pre-image drift 闸门**：部署位当前字节必须仍等于 `preimage/SHA256SUMS.txt`，否则拒绝写入；
2. **仓库 sha256 双向核对**：候选 `client.js` 与部署位 `client.js` 必须一致；
3. **served bytes 核对**：`curl -s http://127.0.0.1:3080/plugins/@local/dsh-btw/client.js | sha256sum` 必须等于候选 sha256；
   ⚠️ `?rev=` 是 `sha1[:12]`，**不是响应体内容哈希**，不能拿它当内容判据。

等价的一行校验（落地后）：

```bash
curl -s http://127.0.0.1:3080/plugins/@local/dsh-btw/client.js | sha256sum
# 期望 9aa82dc52c9529a3846d1a52cbd003f935635d8ba55b3147bef5cebd6a72ac63  -
node /home/CNS2026495165/dsh/.workspace/lag-fix/exec-btw-resize/scripts/apply-BtwResize-v1.mjs --verify
```

落地后**刷新浏览器**即生效（`serveBundle` 每请求读盘 + `cache-control:no-cache`；`dsh-client-hmr` 在活体 boot graph 内推送 `rebuilt`）。**无需重启**。

### 1.3 回滚（同样热面）

```bash
node .../scripts/apply-BtwResize-v1.mjs --rollback --confirm-apply   # 从 preimage/ 整目录还原
# 然后刷新浏览器
```

回滚不涉及冷面、不需要重启、不影响宿主。

---

## 2. Phase 2（冷面）——为什么必须重启

1. **模块层**：`src/index.ts` 的产物是 `lib/index.js`（`tsdown.config.ts` 里 `platform:'node'`）。宿主侧插件模块在
   `dsh web` 进程里被 **ESM 缓存**，只在进程启动时读取一次 —— `docs/architecture/02-plugin-system.md:152-153`：
   「条目热载只**重新应用配置**，不重读模块（ESM 缓存）。因此『改宿主 lib 代码』永远落在冷面」。
2. **装配层**：`~/.dsh/settings.yaml` 的**值**是热②，但**schema** 变化是冷（`02-plugin-system.md:148`）。
   本档**实测复证**：schema 是 loose（未知键保留），但**已声明键的类型错会在解析期抛 `ValidationError`** ⇒
   schema 改动无法靠"值级热载"绕开（见 §2.4 预检）。

> 只做 Phase 1 时**完全不需要重启**；只有把尺寸写进 `settings.yaml`（Phase 2）才需要。

### 2.1 候选件与补丁脚本

| 文件 | 角色 |
|---|---|
| `phase2/candidate/src/index.ts` | 宿主 schema（**只增不改**：新增 `ui.width` / `ui.height`，两处 `default` 同步） |
| `phase2/candidate/src/client/btw-settings.ts` | 客户端 section 类型 / 默认值 / `decodeBtwSettings` 逐字段重建（**三处都加**，否则尺寸会被丢掉） |
| `phase2/candidate/src/client/drawer-size-settings.ts` | 新增：`useDrawerSizeSettings`（读-改-写整个 `ui` 对象 + `status==='ready' && writable` 闸门） |
| `phase2/candidate/src/client/SideChatDrawer.tsx` | 抽屉接线：settings 为**权威**、localStorage store 为**快速缓存** |
| `phase2/apply-phase2.mjs` | 锚点补丁脚本：`--emit <dir>`（渲染候选）/ `--apply --confirm-apply` / `--rollback` |
| `phase2/preimage/PREIMAGE.json` | Phase 2 三个目标文件的 pre-image sha256（建立在本档 Phase 1 之后的状态上） |

### 2.2 落地步骤

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-btw-resize/phase2
node apply-phase2.mjs --emit /tmp/p2                   # 先渲染到临时目录，人工 review
node apply-phase2.mjs --apply --confirm-apply          # 写仓库（锚点唯一命中 + 全量先渲染后落盘）
cd /home/CNS2026495165/dsh/dsh-btw
npx tsc --noEmit -p tsconfig.client.json && npx tsc --noEmit -p tsconfig.json
node node_modules/vitest/vitest.mjs run                # 应有 245 passed / 2 skipped
node node_modules/tsdown/dist/run.mjs                  # 重建（host lib/index.js + client lib/client.js 都会变）
node --check lib/index.js && node --check lib/client.js
# 然后按 §1.2 的 apply-BtwResize-v1.mjs 把 lib/ 拷到部署位，**并在同一次冷面批次里重启宿主**
```

回滚：

```bash
node apply-phase2.mjs --rollback          # 从 phase2/preimage 还原源码
cd /home/CNS2026495165/dsh/dsh-btw && node node_modules/tsdown/dist/run.mjs
node .../scripts/apply-BtwResize-v1.mjs --rollback --confirm-apply   # 部署位回到 Phase 1 候选
# 再重启一次（schema 回退同样是冷面）
```

⚠️ **Phase 2 与 Phase 1 的部署位字节不同**：Phase 2 会同时改 `lib/index.js`（冷）与 `lib/client.js`（热）。
若只想回退客户端而保留 schema，需分别处理；本档建议**成对落地、成对回退**。

### 2.3 关键实现注意（踩过的坑，已写进候选代码注释）

1. **`settingsScope.set(field, value)` 只支持顶层字段**（实现把 `path` 硬编码成 `[field]`）⇒
   `set('ui.width', 520)` 会写出**字面键 `"ui.width"`**。必须**读-改-写整个 `ui` 对象**：
   `scope.set('ui', { ...ui, width, height })`。
2. **`decodeBtwSettings` 是逐字段重建** ⇒ 不在 `ui` 分支里显式加 `width/height` 就会把值丢掉。三处都要改。
3. **`null` 哨兵在 schema 层不生效**（本档实测，见 §2.4）：`z.union([z.number(), z.const(null)]).default(null)`
   的默认值**被静默丢弃**（缺键时该键从解析结果里消失，即使对象级 `default` 里写了）。
   ⇒ 持久字段用 **`z.number().default(0)`，`0`/负数 = 自动**（真实尺寸恒 ≥ `MIN_WIDTH = 360`，哨兵无歧义）。
4. **权威源（U-BTW-R8 的产品裁决项）**：本档按用户决定「持久化要跟配置文件走」实现为
   **`settings.yaml` 为权威、localStorage 为快速缓存/降级兜底**：
   仅当 `status === 'ready' && writable === true` 且**原始 user 层携带该字段**时才用 settings 值播种缓存；
   `memory` 模式（非 loopback）写入是静默 no-op ⇒ 此时缓存就是唯一真相（与 Phase 1 行为一致）。
5. **不要给已声明键改类型**：`ui.banner/modelSelect/imageBadge` 原样保留。(审计 §3.6)

### 2.4 落地前预检（已完成，可复跑）

```bash
cd /home/CNS2026495165/dsh/dsh-btw
node /home/CNS2026495165/dsh/.workspace/lag-fix/exec-btw-resize/scripts/preflight-schema.mjs
# 原始证据：raw/phase2-schema-preflight.json
```

预检结论（真实 `@deepseek-ai/schemastery`，不需要重启）：

| 输入 | 候选 schema（`z.number().default(0)`） | 被否决的写法（`union().default(null)`） |
|---|---|---|
| `{}` | `ui.width=0, height=0` ✅ | `ui.width=null`（默认生效**仅**在这一格） |
| `ui: {banner:false}` | `width=0, height=0` ✅ | **`width/height` 被静默丢弃** ❌ |
| `ui: {width:520, height:700}` | 原样保留 ✅ | 原样保留 |
| `ui: {width:0}` | 保留 0（= 自动） ✅ | 保留 0 |
| `ui: {width:-5, height:99999}` | 接受（客户端再钳制） ✅ | 接受 |
| `ui: {width:"520"}` | **抛 `ValidationError`**（yaml 必须写裸数字；写进运维注意） | 抛 |
| 未知键 | 保留（schema loose） ✅ | 保留 |

---

## 3. 运维注意（Phase 2 落地后）

- `~/.dsh/settings.yaml` 的 `dsh-btw.ui.width/height` **必须是裸数字**（`width: 520`），写成引号字符串会抛
  `ValidationError`；`0`（或缺省）= 自动放置。
- 抽屉拖拽会把**整个 `ui` 子树**写回（读-改-写），因此与手工编辑 `settings.yaml` 并发时，
  后写者覆盖先写者（`SettingsConflictError`/revision 由 settingsScope 自己的恢复读兜住）。
- 尺寸写盘会触发 `bumpRevision` → `emitDocumentUpdated` → 设置 UI 重新 resolve；
  拖拽期间**不写盘**（只在 `pointerup` 提交一次），避免把设置 UI 拖进风暴。

---

## 4. 验证口径（本档实际跑过的）

| 组 | 证据 |
|---|---|
| 单元（B1/B2/B3） | `phase1/`：`node node_modules/vitest/vitest.mjs run`（既有 24 个 spec **一字未改**全绿 + 新增 explicit spec 12 例）；`scripts/b2-parity.mjs`（3456 例 × 11 字段逐例 deepEqual，0 差异） |
| DOM/键盘（A1–A7/A9、D1/D2 结构口径） | `dom-check/drawer-resize-dom.part.tsx` → 影子树 `phase1-shadow/tests/drawer-resize-dom.spec.tsx`：**8/8 PASS**（两 separator + aria 信封、pointerup 才提交且只提交一次、60 次 move 的长拖拽**观察者实例数不变且零 disconnect、零新增 window resize/scroll 监听**、`data-placement-mode` 全手势恒定、键盘全表、顶部锚定、Escape 取消不最小化、pointercancel 回滚） |
| 真机（A/C/D 组） | `scripts/verify.mjs`（自有 headless Chrome 153；候选字节经 `context.route` 就地替换真实 bundle URL，**不写部署位**）→ `raw/verify-*.json` + `logs/verify.log` + `shots/*.png` |
| 落地核对 | `scripts/apply-BtwResize-v1.mjs --verify`（sha256 双向 + served bytes） |

> 详细数字与 PASS/REWORK 见 `report.md`。
