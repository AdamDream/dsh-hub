# exec-a11y 交付报告 · U-A11Y1..U-A11Y4（修订执行复核一体）

- 线：`exec-a11y`（独占目录 `/home/CNS2026495165/dsh/.workspace/lag-fix/exec-a11y/`）
- 输入契约：`.workspace/lag-fix/program/w12-input-ux/audit.md`（514 行，含快捷键清单表/缺口表/步数表/前 5 项优化与验收）+ `raw/`（`findings-A-sidebar-sessions.md`、`findings-B-overlays-shortcuts.md`、12 个可复跑探针）
- 本档定位：**按已完成的审计落地**——不重新拆解、不扩范围。审计的四条硬结论作为**前提**接受，未重新论证。
- 宿主：`dsh web` PID **301709**（**全程未重启、未 pkill、未改任何用户态/浏览器状态**）
- 用户浏览器：**从未 attach**（所有运行时证据来自本档自己 launch 的 headless chromium，退出即清）
- 证据文件：`evidence/verify-2026-09-22T08-47-52-415Z.json`（本报告表格由 `scripts/make-report.mjs` 从该原始 JSON **自动生成**，不手抄）；生成时间 `2026-09-22T09:41:07.504Z`

---

## 0. 一句话结论与自裁决

| 项 | 结论 |
|---|---|
| 交付单元 | U-A11Y1 焦点陷阱与还焦 / U-A11Y2 树行键盘可达 / U-A11Y3 全局快捷键不吞键 / U-A11Y4 焦点指示 |
| 每个单元 | 独立 `apply-A11y*-v1.mjs`（dry-run 默认 / `--apply` 才写 / `--stage-only` 只产候选 / `--rollback` / 锚点唯一命中否则不写 / 自动 pre-image / `node --check` / 幂等） |
| deployed 写入 | **本档未写任何 deployed 文件**（沙箱为 workspace-write，`~/.npm-global/**` 只读；且父纪律规定 deployed 写入由协调者执行）⇒ 全部以 `patched/` 候选 + route 拦截做的**真机 A/B** |
| 引擎自测 | `8/8 PASS`（锚点唯一性闸门、pre-image、语法闸门、幂等、字节级 rollback 全部真跑） |
| **自复核裁决** | **PASS**（逐条见 §4；未通过项与 INCONCLUSIVE 边界见 §5） |

## 0.1 收口状态（STATUS — 先读这一节）

> ✅ **回归已定案（协调者活体实验 + 本档渲染级二分，双证）**：**致因 = "写入客户端插件 → HMR 热刷新" 的 dispose 窗口**（改写只是**追加一个注释**也照样复现 ⇒ **与补丁字节无关**）。**U-A11Y1 / U-A11Y2 / U-A11Y4 的字节已排除责任**（六臂渲染级二分逐项相同，见 §4.3；协调者活体实验三条证据见 §4.3.1）。**排期裁决（协调者）**：这三项**与冷面重启批次一起落** —— 因为写 `conversation` / `layout` 本身就会触发同一热刷新窗口，跟重启合并可**把"必须刷新"这次代价合并掉、不额外多一次**。**U-A11Y3 保持 live 不变**（它在 `none` 臂里是唯一 live 的补丁，而该臂渲染与其它臂逐项相同、0 错误）。该时序缺陷由新线 `exec-hmr` 修复（要求：**不吞真实错误**、并带"真缺失仍报错"的阴性对照）。
>
> ⚠️ **落地状态是"活的"，以 §4.2 的实时自证表为准**——生成器每次都会**重新读取 deployed 字节并与候选比对**（marker 数 + md5 + 逐字节 diff），本节的文字描述可能与最新一次生成之后发生的变化不同步。
>
> **本档观测到的完整时间线**：`16:55` 协调者执行 `--apply` ⇒ U-A11Y1/U-A11Y2/U-A11Y3 与候选**逐字节一致**；`17:18` **U-A11Y1/U-A11Y2 被回滚**（md5 精确回到我的 pre-image 原字节、marker 清零，`diff` 已逐字节核对为**干净回滚**）；U-A11Y3 保持 LIVE；U-A11Y4 从未落地。回滚后四个锚点已复核**仍唯一命中**（`A11Y1/2/4 = DRY_RUN_OK`、`A11Y3 = ALREADY_APPLIED`）⇒ 任一项都可再一条命令落地。

| 单元 | 候选件 | 落地 | 真机复验 | 可独立回滚 | 交回状态（按最新实测） |
|---|---|---|---|---|---|
| **U-A11Y1** 焦点陷阱与还焦（含 primitives 浮层覆盖） | ✅ `patched/U-A11Y1__dsh-client-ui-layout__client.js` | 曾被落地（16:55）→ **17:18 已回滚** | ✅ A/B（落地前）+ 落地期复验 | ✅ `--rollback` / 再落地 `--apply` | ⏳ **字节已排除责任；等协调者与冷面重启批次一起落**（写此文件会触发同一热刷新窗口，故与重启合并） |
| **U-A11Y2** 会话/工作区行键盘可达 | ✅ `patched/U-A11Y2__dsh-client-ui-workspace__client.js` | 曾被落地（16:55）→ **17:18 已回滚** | ✅ A/B + 落地期复验 + NEVER-CLICK 守卫 | ✅ | ⏳ **同上（与重启批次一起落）**；§5.7 裁决 B 的候选已在 `patched/`（`revision: 3`：Tab 不再落到 rename/delete 省略号），**未落地** |
| **U-A11Y3** 全局快捷键不吞键 | ✅ `patched/U-A11Y3__dsh-btw__client.js` + `U-A11Y3__src__index.ts` | ✅ **LIVE**（与候选逐字节一致） | ✅ A/B + 落地后复验 | ✅ | **协调者确认保持 live 不变**（repeat `--apply` 报 `ALREADY_APPLIED`，幂等） |
| **U-A11Y4** 焦点指示（composer 环 + 主题化默认环） | ✅ `patched/U-A11Y4__dsh-client-ui-conversation__client.js` | ❌ **未落地** | ✅ 候选相位已验证（route 换载） | ✅ | ⏳ **同上（与重启批次一起落）**：`node scripts/apply-A11y4-v1.mjs --apply` |

**每单元一条命令即可独立落地或回滚**（热面、刷新即生效、无重建、无重启）：
```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-a11y
node scripts/apply-A11y1-v1.mjs --apply   # 或 --rollback
node scripts/apply-A11y2-v1.mjs --apply   # 或 --rollback
node scripts/apply-A11y3-v1.mjs --apply   # 或 --rollback（当前 ALREADY_APPLIED）
node scripts/apply-A11y4-v1.mjs --apply   # 或 --rollback
```

**明确未做 / BLOCKED（均为"不在四单元内"或不具备条件，按纪律不扩范围、不硬做）**

| 项 | 为什么没有做 | 缺什么才能做 |
|---|---|---|
| **`dsh-client-ui-primitives` 本体改造** | 它是 Web 外壳的**静态模块**（`dist/assets/index-ClqxG24t.js` 内 `staticModules{…dsh-client-ui-primitives: Kd}`，作为插件 **HTTP 404**），改它必须重建 Web 产物；而本机**无源码仓、`dsh-web-frontend` 包只有 `dist/`、primitives 包只有 `lib/`** ⇒ 按任务书"影响面不可控则停下上报"的停止条件**上报而非硬做**（本档已改用热面运行时层等效覆盖 primitives 实例，实测覆盖到） | 上游源码仓 + 可执行 `vite build` 的 `dsh-web-frontend/src` |
| 7 个裸 Esc 监听的**栈顶仲裁**（审计 §2.4 C-1 / F-8） | 四单元只写"陷阱与还焦"，**不扩范围** | 单独立项（跨 5 个插件） |
| 详情列 `inert`（§1.4）、搜索收起还焦（§2.5 F-6）、全局命令面板（§5 优化3） | 同上，不在四单元内 | 单独立项 |
| **会话行的真实 DOM 运行时验证** | 无工作区态不渲染会话行（审计 §0.3/§4.3 确证），选中工作区会改**宿主持久状态** ⇒ 本档拒改；已用**同契约夹具**验证同一份出厂代码 | 一个"已选工作区"的环境（探针可直接复跑，无需改脚本） |
| **btw "有会话时抽屉仍能切换"** | 该分支要求 `currentSessionId()` 有值，部分轮次不满足 ⇒ 标 **INCONCLUSIVE** | 稳定"有会话"的窗口（读码上 toggle 分支一字未改） |
| **深色主题的等价路径** | 用页内 `body[data-ds-dark-theme]` 切令牌测（不改宿主设置），以"环色随主题变化"为生效判据 | 允许改宿主主题设置的环境 |

**复测要求（`exec-virtual` 插件列表虚拟化 + `exec-masklook` 遮罩环带已生效）**：这两项正落在本档的**设置弹窗**与**列表**验收面，已用**同一套件**（不新增实验）在**当前 deployed 实况**下复跑：设置面板 Tab×40 **逃逸 0**（`inerted=5`、`focusableInside=26`）、**遮罩点击关闭路径仍还焦到触发按钮**、Esc 路径同上、树行键盘 roving/↑↓/Tab 全通、**NEVER-CLICK 守卫 `menusOpened=0`**、0 条 console/pageerror。详见 §4.2。

---

## 1. 纪律合规（逐条对账）

| # | 纪律 | 落实方式 | 证据 |
|---|---|---|---|
| 1 | 每单元独立 `apply-A11y*-v1.mjs` | 4 个脚本 + 共享引擎 `scripts/_engine.mjs`（脚本各自声明 SPEC，互不影响） | `scripts/` |
| 2 | dry-run 默认 | 不加参数只打印计划（含锚点命中位置与字节增量），**不写盘** | `out/stage-A11y*.log`；自测 T2 |
| 3 | `--apply` 才写 | 唯一写盘分支；本档未执行（deployed 由协调者执行） | 同上 |
| 4 | 锚点唯一命中否则不写 | 每个 edit 的 anchor 在当前内容里必须**恰好 1 次**，否则 `ABORTED_ANCHOR` 且整单元不写 | 自测 T8 |
| 5 | 自动 pre-image | 写入前把原字节复制到 `pre-image/<unit>__<pkg>__<file>.<ts>.bak`，附 `.md5` + `.meta.json` | 引擎 Phase 3；自测 T4 |
| 6 | `node --check` | 候选先落**本档工作区内**的临时文件跑 `node --check`，失败即中止（`ABORTED_SYNTAX`），原文件不动。⚠️ 临时文件不能写在 deployed 目标旁边（`~/.npm-global/**` 只读 ⇒ EACCES/EROFS，已实测） | 自测 T6 |
| 7 | 幂等 | 内容已含 begin marker ⇒ 判 `ALREADY_APPLIED` 并跳过 | 自测 T5 |
| 8 | `--rollback` | 从最新 pre-image 还原（校验后写回）；无 pre-image 时按 marker 块剥离并**先过 `node --check`** | 自测 T7（字节级 md5 还原） |
| 9 | `.ts` 目标的真实检查 | `node --check` 对 `.ts` **不适用**；实测 `node --experimental-strip-types --check` 对语法错误 **exit=0**（假通过）⇒ 改用**项目自己的** `tsc -p tsconfig.client.json --noEmit`：把候选临时换入 → 跑 → **立即还原并核对 md5**（`restored=true` 才通过） | `patched/manifest.U-A11Y3.json`；`out/stage-A11y3.log` |
| 10 | 不劣化已有行为 | 每个单元都带**回归哨兵**：鼠标点设置按钮仍开/关（U-A11Y1）、鼠标点行仍走原 `onClick`（U-A11Y2，未改任何 JSX 的 `onClick`）、普通字符与 `Shift+.` 输入不变（U-A11Y3）、各产品自带 `:focus-visible` 规则优先（U-A11Y4 用低特异性选择器） | §4 A 表 |
| 11 | 探针锁 | `lib/probe-lock.mjs`，BUSY 时**礼貌等待**（15 s 退避，上限 25 min）而不抢锁；`evidence/probe-heartbeat.json` 周期心跳（pid + 存活）；退出路径统一 release | `out/verify-a11y.run.txt`、`evidence/waiting-*.json` |
| 12 | 不碰用户浏览器 / 不重启宿主 | 只 launch 自己的 headless chromium；未执行任何 `pkill`/重启（⚠️ 本档踩过一次 `pkill -f <脚本名>` 自杀陷阱，已改用 PID/字符类匹配，见 §5.4） | — |

---

## 2. 关键设计决策（必须先读）

### 2.1 U-A11Y1 / U-A11Y4 为什么**不落** `dsh-client-ui-primitives`

任务书给的红线是：若改动落到 primitives（打进 `dsh-web-frontend/dist/assets/*`）⇒ 刷新不生效、需重建 Web 产物；影响面不可控则停下上报。**本档实测确认了这条红线，并据此改换落点**：

| 判据 | 实测结果 | 命令 |
|---|---|---|
| primitives 是不是热面插件？ | **不是**：`/plugins/@deepseek-ai/dsh-client-ui-primitives/client.js` ⇒ **HTTP 404**（对照：layout/workspace/settings-general/`@local/dsh-btw` 均 **200**） | `curl -o /dev/null -w '%{http_code}' http://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-ui-primitives/client.js` |
| 它到底在哪？ | Web 外壳把它注册为**静态模块**：`dist/assets/index-ClqxG24t.js` 内 `function Jd(){return{react:…,"@deepseek-ai/dsh-client-ui-slot…":"…","@deepseek-ai/dsh-client-ui-primitives":Kd}}` ⇒ 与外壳同 bundle | `grep -o "client-ui-primitives" …/index-ClqxG24t.js` |
| 本机能否重建？ | **不能**，三条独立判据：① 全盘无 monorepo 仓（`find /home /opt /srv /usr/local -maxdepth 6 -type d \( -name ui-primitives -o -name deepseek-harness \) -not -path "*/node_modules/*"` ⇒ 0 命中；`find /home -maxdepth 4 -name pnpm-workspace.yaml -o -name pnpm-lock.yaml` ⇒ 0 命中）；② `dsh-web-frontend` npm 包**只有 `dist/`、没有 `src/`**（`ls .../dsh-web-frontend` ⇒ `dist LICENSE package.json`）⇒ 其 `build: vite build` 无处可跑；③ `dsh-client-ui-primitives` 包内**只有 `lib/`、没有 `src/`**（预构建产物）。 |

⇒ **决策**：把"焦点陷阱 + 还焦"实现为一个**与实例无关的运行时层**，落在**热面插件** `dsh-client-ui-layout`（应用外壳、boot 必载）里。这样：

- **零 primitives 改动 ⇒ 无需重建 Web 产物 ⇒ 刷新即生效**；
- 仍然**覆盖 primitives 的 `Modal`/`Menu` 实例**（它们要么 `createPortal(..., document.body)` 后成为本层管辖的 `[role="dialog"][aria-modal="true"]`，要么是 `[role="menu"]` 弹出层）——**实测覆盖见 §4 A 表 1.7–1.10**；
- 与任务书"参考 `workspace-enhancement:2240-2269` 范式"的方向一致（运行时层 + 栈顶仲裁 + 真 Tab 循环 + 首焦），而不是逐个改产品组件。

**如果协调者仍要求改 primitives 本体**：需要**上游源码仓**才可能重建（本机三条判据均已证否，见上表；`vite build` 需要 `dsh-web-frontend/src`，本机不存在）⇒ 按任务书"影响面不可控则停下上报"的要求，本档**不把它列为可执行方案**，只登记为"需源码仓 + 需 Web 产物重建（`cd <repo>/packages/client/web-frontend && pnpm run build`，即包内声明的 `vite build`）"的前置条件；在本机强行改 `dist/assets/index-*.js` 属于"改编译产物、不可回滚、无法复验"，本档**拒绝**该路径。

### 2.2 U-A11Y3 的**目标定位陷阱**（本档实测纠正；改错文件=运行态零效果）

btw 在部署里有**两份同名产物**，浏览器实际加载的**不是**源码仓里的那份：

| 角色 | 路径 | 实测 | 结论 |
|---|---|---|---|
| **被挂载/被服务**（本档目标①） | `/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js` | md5 `73e90a5cb2f2…`，**335 348 B**，mtime 2026-09-18 10:51，快捷键判据在 **`:8658`** | ✅ 与 `curl /plugins/@local/dsh-btw/client.js` 的响应体**逐字节相同**（md5 一致） |
| 源码仓产物（**本档刻意不改**） | `/home/CNS2026495165/dsh/dsh-btw/lib/client.js` | 361 167 B，mtime 2026-09-22 15:41（兄弟线 `exec-btw-resize` 构建），判据在 `:9272` | ❌ 改它对运行态**零效果** |
| 事实源（本档目标②） | `/home/CNS2026495165/dsh/dsh-btw/src/client/index.ts` | `tsc -p tsconfig.client.json --noEmit` 通过 | ✅ 供后续重建 |

判据：`~/.dsh/profiles/web/cordis.patch.yml` 的 `insert: - id: btw / name: '@local/dsh-btw'`；以及
`curl -s http://127.0.0.1:3080/plugins/@local/dsh-btw/client.js | md5sum`（`?rev=374dca63f9aa`）与该 profile 产物 md5 一致。
⚠️ 这让审计正文里 `dsh-btw/lib/client.js:8655-8668` 的引用**实际对应的是 profile 挂载产物 `:8658`**——路径名易被误读为源码仓产物（审计 §2.2/§2.5 的口径同此）。

**处置**：本档只改 **①profile 挂载产物（热面，刷新即生效）** 与 **②src（事实源）**；**不改** `dsh-btw/lib/client.js`——它是 src 的构建产物，且正被并行线重建，`pnpm run build` 会按 src 重新生成（src 已含修复 ⇒ 重建即带修复）。

### 2.3 U-A11Y4 为什么落在 `dsh-client-ui-conversation`

`outline:none` 的宿主 CSS（`.uV2eYG_input{…outline:none…}`）与 composer 同在该包的 `lib/client.js` 内（CSS 以 `<style data-plugin-css>` 在模块求值时注入）⇒ 只改这一个热面文件即可修掉"双通道皆空"，**不碰 primitives、不需要重建**。全局 `:focus-visible` 环用**低特异性**选择器（`:focus-visible{}`，0,1,0），各产品自带规则（`.class:focus-visible{}`，0,2,0）**优先级更高**⇒ 不劣化已有焦点实现。

---

## 3. 逐单元：改动锚点与机制

### U-A11Y1 · 焦点陷阱与还焦（含 primitives 实例覆盖）

- **目标文件（热面）**：`…/@deepseek-ai/dsh-client-ui-layout/lib/client.js`
- **锚点**：`\t\texports.apply = apply;\n\t\texports.inject = inject;\n\t\treturn module.exports;`（全文唯一命中，实测 count=1）
- **注入形式**：一个自包含 IIFE（`patches/A11Y1-overlay-layer.js`，10 812 B），`window.__dshA11yOverlayLayer` 幂等守卫
- **机制**（对齐 `dsh-workspace-enhancement/lib/client.js:2240-2269` 的范式）：
  1. **硬层**＝每个 `[role="dialog"][aria-modal="true"]` / `[role="alertdialog"][aria-modal="true"]`（含 primitives `Modal` 的 body portal 实例与产品自有设置面板）；
  2. **约束**＝给 dialog **祖先链的兄弟**加 `inert` + `aria-hidden="true"`。⚠️ 关键细节：**只碰"真的含可聚焦元素"的兄弟**（外加恒约束 `#root`）⇒ 设置弹窗的**遮罩**（`aria-hidden` 无子焦点元素）**不被 inert**，因此 **mask 点击关闭路径保持可用**；`inert` 同时把背景从 Tab 序与 a11y 树移除，让 `aria-modal="true"` 从"声明"变成"约束"；
  3. **栈顶仲裁**：Tab/Shift+Tab 只由**栈顶硬层**处理，在层内真循环（inert 之外的 decoy 兜底）；
  4. **首焦**：层内无焦点时才移入层（若产品已自定首焦则**不抢**——含焦点即返回）；
  5. **还焦**：`focusin` 追踪"最后一个在层外获得焦点的元素"，层卸载时还原 ⇒ **Esc / 遮罩 / 头部按钮三条关闭路径统一还焦**（不再落 `body`）；
  6. **软层** `[role="menu"]`（primitives `Menu` 的 portal 弹出层，非模态）只做**关闭还焦**，不陷阱；
  7. 单元素可用 `data-dsh-a11y-keep` 豁免；嵌套层用引用计数（`WeakMap`）保证还原不互相踩。
- **性能**：MutationObserver 回调**先对非元素节点早退**（本应用最频繁的 mutation 是消息流文本节点），再做 `HARD/SOFT` 命中预筛，且扫描按 `requestAnimationFrame` 合并 ⇒ 稳态不产生每帧全量查询。
- **风险**：中。`inert` 会一并冻结背景内的其它 portal 目标（模态语义上正确）；嵌套层顺序、IME、无可聚焦元素分支均已处理（无焦点元素时把焦点兜到层容器自身）。
- **生效面**：**热面（刷新即生效），无需重建**。
- **回滚**：`node scripts/apply-A11y1-v1.mjs --rollback`

### U-A11Y2 · 会话/工作区行键盘可达

- **目标文件（热面）**：`…/@deepseek-ai/dsh-client-ui-workspace/lib/client.js`
- **锚点**：同款 `exports.apply` 收尾三元组（count=1）
- **注入形式**：自包含 IIFE（`patches/A11Y2-tree-keyboard.js`，7 752 B）+ 自带 `<style data-plugin-css>` 注入
- **机制**：
  - **roving tabindex**：对每棵 `[role="tree"]` 保证**恰好一行 `tabindex=0`**、其余 `tabindex=-1`（DOM 层实现：行上的 `tabindex` **不是** React 声明过的 prop ⇒ 重渲染不会抹掉，无需新增 per-tree React 状态）；
  - **键位**：`↑↓` 移动（含 `scrollIntoView({block:'nearest'})`）、`Home/End` 首末、`Enter`/`Space` → `row.click()`（**复用既有 `onClick`**，鼠标路径逐字节不变）、`←→` 按 `aria-expanded` 展开/收起（叶子行不做处理）；
  - **行内按钮不再 hover-only**：CSS 追加
    `[role="tree"] [role="treeitem"]:focus-visible [class*="_rowActions"], [role="tree"] [role="treeitem"]:has(:focus-visible) [class*="_rowActions"]{display:inline-flex}`
    —— 用 `:focus-visible`/`:has(:focus-visible)` 触发 ⇒ **鼠标点击不会**让 rowActions 常显（不劣化鼠标观感）；
  - **安全边界**：某棵树若其行**已有** `tabindex`（自带键盘模型）⇒ 整棵树标记 `data-dsh-a11y-tree="skip"`，永不接管；只处理**可见**行（排除 0 尺寸与 inert 子树）。
- **风险**：中。与拖拽（`draggable`）无冲突（未改任何拖拽 prop）；键盘焦点落在行上时鼠标点击仍走原路径。
- **生效面**：**热面**。
- **回滚**：`node scripts/apply-A11y2-v1.mjs --rollback`

### U-A11Y3 · 全局快捷键不吞键

- **目标文件**（见 §2.2 的定位陷阱）：
  ① **被服务的 profile 产物（热面）** `/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js`
  ② **事实源** `/home/CNS2026495165/dsh/dsh-btw/src/client/index.ts`
  （**不改** `/home/CNS2026495165/dsh/dsh-btw/lib/client.js`：它是 src 的构建产物且正被并行线重建）
- **锚点**：两个文件里各自的 `ctx.effect(() => { … const onKeyDown = … code !== "Period" … })` 块（各 count=1，**replace** 语义，自带 begin/end marker 保幂等）
- **改动内容**（逐条对应审计 §2.4 C-2 / §2.5 F-9）：
  1. **输入元素豁免**：`isEditableTarget(event.target)`（`INPUT`/`TEXTAREA`/`SELECT`/`contentEditable`）⇒ **提前 return**（不 `preventDefault`）；
  2. **`preventDefault()` 移到语义判定之后**：只有 `currentSessionId() !== undefined`（真的会 toggle）时才吞键；
  3. 无会话时不再"吞键 + 静默空操作"。
- **风险**：**低**（单文件单函数守卫 + 纯增量）。**生效面**：profile 挂载产物是**热面**（刷新即生效，无需重建、无需重启）；`src` 保证后续重建同语义。
- **回滚**：`node scripts/apply-A11y3-v1.mjs --rollback`
- **附加核对**（任务书要求"核对 32 条语义键的可发现性"）：独立只读子代理核查，产物 `evidence/discoverability-shortcuts.md`（结论见 §5.3）。

### U-A11Y4 · 焦点指示（outline 通道可见，含深色主题）

- **目标文件（热面）**：`…/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`
- **锚点**：同款 `exports.apply` 收尾三元组（count=1）
- **注入内容**（`patches/A11Y4-focus-ring.js`）：
  ```css
  :root{--dsh-exec-a11y-focus-ring:var(--dsw-alias-state-business-primary)}
  body[data-ds-dark-theme]{--dsh-exec-a11y-focus-ring:var(--dsw-alias-state-business-primary)}
  :focus-visible{outline:2px solid var(--dsh-exec-a11y-focus-ring);outline-offset:1px}
  .uV2eYG_input:focus-visible{outline:2px solid var(--dsh-exec-a11y-focus-ring);outline-offset:-2px;border-radius:12px}
  ```
  - 第 3 条修的是**实测确证的 FAIL**：composer 主输入框原本 `outline:none/0px` + `box-shadow:none`（双通道皆空）。必须覆写 `outline` **简写**——Chrome 下 `outline-style:auto` 会忽略 `outline-color`，仅改颜色无效；
  - 第 4 条把其余依赖浏览器默认环（近黑 `rgb(16,16,16)`）的元素换成**主题化令牌**：令牌由 `body[data-ds-dark-theme]` 切换，深色主题下同样可见（对比度数字见 §4 A 表 4.3–4.5）；
  - **不劣化**：低特异性（0,1,0），产品自带 `.class:focus-visible`（0,2,0）优先。
- **风险**：低。**生效面**：**热面**。
- **回滚**：`node scripts/apply-A11y4-v1.mjs --rollback`

---

## 4. 真机复验（A/B 同窗对照）

### 4.0 基线事实（deployed 原文件、无拦截 —— 决定机制选择的关键观察）

取自 `evidence/INVALID-route-glob-miss.verify.json` 的 **baseline 相位**（该文件是本档第一次运行：
其 baseline 相位有效，patched 相位因 route 匹配器失效而**无效**，已改名保留为"陷阱证据"）：

| 观察 | 原始值 | 意义 |
|---|---|---|
| 设置面板的祖先链 | `div.VOzbGW_panel → div.VOzbGW_overlay → div → div.hHd-Xa_settingsArea → div.hHd-Xa_footArea → div.hHd-Xa_root → …`，且 `portaledToBody=false` | ⚠️ **设置面板在 `#root` 内部**（侧栏 footer 区域），**不是** body portal ⇒ 直接 `#root.inert = true`（`settings-models:2139-2146` 的范式）会**把面板自己一起冻住**。这正是本档改用"**祖先链兄弟** inert"而不是"整 root inert"的原因（U-A11Y1）。 |
| `body` 直接子节点 | `div(无 class)` / `script` / `div#root` | body 层还有一个**无 class 的容器**（btw 等插件的 portal 宿主在此层级）⇒ 兄弟链走到 body 层时它会被一并约束（含可聚焦元素才会被加 `inert`）。 |
| 打开后首焦 | `button.VOzbGW_close`（面板内，`inPanel=true`） | 与审计一致：首焦本来正确，缺的是**约束**与**还焦**。 |
| 基线约束 | `inertedCount=0`、`rootInert=false`、`rootAriaHidden=null` | `aria-modal="true"` **只声明不约束**（审计 §1.2 复核）。 |
| 基线 Esc 关闭 | `dialogCount=0`、`activeTag=body`、`activeIsTrigger=false`、`inertLeft=0` | 审计"两条关闭路径都不还焦"**复核为真**。 |
| 基线遮罩关闭 | 同上（`activeTag=body`、`activeIsTrigger=false`） | 同上。 |
| 基线按钮焦点环 | `outline: auto 1px rgb(16, 16, 16)`（近黑） | 审计 §1.7 的"近黑默认环"**复核为真**。 |

### 4.2 落地后复验（deployed 实况，behavior-only）

> 协调者已于 16:55 执行过 `--apply`，因此 **A/B 对比证据取"落地前"那一轮**（§4 A 表；见页首"证据文件"）。
> 之后任何一轮 `probes/verify-a11y.mjs` 的 BASELINE 相位都已是被修过的状态（本档实测到该现象）——该轮**只能**用于"落地后是否生效"的核对，不能用于对比。

| 单元 | deployed 目标 | marker 数 | 与候选是否逐字节一致 | 落地状态 |
|---|---|---|---|---|
| U-A11Y1 | `dsh-client-ui-layout` | 0 | **否** | **NOT-LIVE（未落地或已漂移）** |
| U-A11Y2 | `dsh-client-ui-workspace` | 0 | **否** | **NOT-LIVE（未落地或已漂移）** |
| U-A11Y3 | `@local/dsh-btw (profile)` | 2 | 是（md5 6b3245b99457） | **LIVE（与候选逐字节一致）** |
| U-A11Y4 | `dsh-client-ui-conversation` | 0 | **否** | **NOT-LIVE（未落地或已漂移）** |

落地后一轮（`verify-2026-09-22T09-18-40-998Z.json`，injectionMode=route）的**行为核对**（只看"是否呈现修复后行为"）：

| 判据 | 落地后实测 | 判定 |
|---|---|---|
| U-A11Y1 设置弹窗 Tab×40 逃逸数 = 0 且 40/40 全在面板内 | escapes=0 seq=1111111111111111111111111111111111111111 | PASS |
| U-A11Y1 Esc / 遮罩两条关闭路径均还焦到触发按钮 | esc=true mask=true | PASS |
| U-A11Y1 primitives 浮层 Tab×20 逃逸数 = 0 且不劣化其自身还焦 | escapes=0 activeIsOpener=true | PASS |
| U-A11Y2 树行键盘入口 + roving（恰一行 tabindex=0） | {"hasKeyboardEntry":true,"txt":"触觉产品资料","expanded":"false"} / {"0":1,"-1":13} | PASS |
| U-A11Y2 ↑↓/Home/End/←→/Enter | arrows=["面试","MCU","作业","math"] expand={"before":"false","afterArrowRight":"true","afterArrowLeft":"false","afterEnter":"true"} | PASS |
| U-A11Y2 行聚焦即显示 rowActions + Tab 进入行内按钮 | {"display":"flex","w":44,"h":20} → {"tag":"button","cls":"YDXeBa_iconButton","ariaLabel":"工作区“触觉产品资料”的操作","inRow":true,"visible":true} | PASS |
| U-A11Y2 **NEVER-CLICK 安全守卫**（未弹出 rename/delete 菜单，焦点已移开） | menusOpened=0 blur后active=BODY | PASS |
| U-A11Y3 输入框内不再吞键（deployed 实况） | Period.defaultPrevented=false | PASS |
| U-A11Y3 非输入元素上的该组合 | Period.defaultPrevented=true；本轮是否已打开会话（由会话行是否渲染推断）=true | PASS(有会话：**设计内**——有会话才 preventDefault + toggle) |
| U-A11Y4 composer 焦点环（deployed 未落地时应仍为 none/0px） | {"tag":"textarea","cls":"uV2eYG_input","outlineStyle":"solid","outlineWidth":"2px","outlineColor":"rgb(65, 118, 230)","outlineOffset":"-2px","boxShado | 见上表"落地状态" |

**结论**：U-A11Y3 已落地且与候选**逐字节一致**；U-A11Y1 / U-A11Y2 / U-A11Y4 **尚未落地**。未落地项补跑一条命令即可（热面、刷新即生效）：`node scripts/apply-A11y4-v1.mjs --apply`。


### 4.3 渲染级回归诊断（回应"整个会话区都不可见了"）

**方法与功效**：`probes/verify-render.mjs` 逐臂新建 context，只用 `context.route` 换载指定候选（**绝不写 deployed**），渲染级断言 R1–R5；会话打开走"**只点行标签**"（NEVER-CLICK 合规）。
**关键功效证据**：环境从 DPR1/1600×1000 换到 DPR2/5120×2880 时，侧栏可见盒从 **280 000 → 806 400**（= 280×1000 → 280×2880）⇒ **该测量对渲染变化是敏感的**；而**同一环境下 `none` 与 `all` 两臂的每一项都完全相同**。

| 环境 | 臂（换载的候选） | 侧栏 nodes / 最大可见盒 | composer nodes / 最大可见盒 | conversation.session | pageerror | console.error | 插件失败界面 | inert | aria-hidden |
|---|---|---|---|---|---|---|---|---|---|
| DPR1 1600×1000 | `none`（不换载任何候选 = 我的代码全缺席） | 344 / 280000 | 90 / 538551 | 0 / 0 | 0 | 0 | false | 0 | 13 |
| DPR1 1600×1000 | `all`（dsh-client-ui-layout, dsh-client-ui-conversation, dsh-client-ui-workspace） | 344 / 280000 | 90 / 538551 | 0 / 0 | 0 | 0 | false | 0 | 13 |
| DPR2 5120×2880 | `none`（不换载任何候选 = 我的代码全缺席） | 344 / 806400 | 90 / 538551 | 0 / 0 | 0 | 0 | false | 0 | 13 |
| DPR2 5120×2880 | `all`（dsh-client-ui-layout, dsh-client-ui-conversation, dsh-client-ui-workspace） | 344 / 806400 | 90 / 538551 | 0 / 0 | 0 | 0 | false | 0 | 13 |
| DPR1 1600×1000 | `a11y1`（dsh-client-ui-layout） | 366 / 280000 | 90 / 538551 | 0 / 0 | 0 | 0 | false | 0 | 14 |
| DPR1 1600×1000 | `a11y2`（dsh-client-ui-workspace） | 366 / 280000 | 90 / 538551 | 0 / 0 | 0 | 0 | false | 0 | 14 |
| DPR1 1600×1000 | `a11y12`（dsh-client-ui-layout, dsh-client-ui-workspace） | 366 / 280000 | 90 / 538551 | 0 / 0 | 0 | 0 | false | 0 | 14 |
| DPR1 1600×1000 | `btw-org`（dsh-btw） | 366 / 280000 | 90 / 538551 | 0 / 0 | 0 | 0 | false | 0 | 14 |

⚠️ **只做轮内对比**：不同轮之间会话/工作区数量本身会变（侧栏 nodes 实测 344 vs 366），**那不是臂效应**；同一轮内各臂逐项相同才是结论。

**读法**：`none` 臂 = 我的全部代码缺席（仅保留其它已落地改动 + 仍 live 的 U-A11Y3）。两臂在**两种环境下**的渲染指标**逐项相同**、错误计数为 0、插件失败界面不出现 ⇒ **本批补丁字节在渲染面是"中性"的**（唯一差异是设计内的 roving：`treeitems` 由 `13/0tabindexed` 变为 `13/13tabindexed`）。

**本档仍不能覆盖的两条（必须与结论一起读）**：① 本环境的 **13 个会话行全部是空白"新会话"**（`blankCandidates=13`）⇒ 「打开一个**有消息的真实会话**」这条路径**在这里不可执行**（用户环境里才有真实会话）——请在**有真实会话的 profile** 上复跑 `node probes/verify-render.mjs --arms=none,all`；② 本机**只有 headless chromium**（无 Playwright Firefox、有头 Chromium 起不来）⇒ 尺寸/DPR 分支已覆盖，**Gecko 引擎分支未覆盖**；③ 以上全是"**新加载**"对照 ⇒ 结构上**不含**"写入→HMR 热刷新"路径（见 §5.9）。

### 4.3.1 定案：**活体实验（harmless-byte）** —— 机制确认、本批补丁字节排除责任

> 证据由协调者取得（用户批准的一次无害实验），**不是本档探针产物**，在此原样存档。

**实验做法**：对 `dsh-client-ui-conversation/lib/client.js` **只追加一个注释**（md5 `3f0397866d990e6e` → `e1541193dca271c8`，字节 447932 → 447960），**随后不刷新**，直接观察已打开的浏览器。

**三条客观证据**

| # | 证据 | 原文 |
|---|---|---|
| 1 | **SSE 原始帧**（协调者自己抓，`timeout 8 curl -sN /plugins/events`） | `{"type":"rebuilt","id":"@deepseek-ai/dsh-client-ui-conversation","rev":"cd154d866bc6"}` ⇒ **"写入 ⇒ rev 变 ⇒ 推 rebuilt"实测成立**（与本档 §5.9 的静态推断一致） |
| 2 | **用户 Console 原文（决定性）** | `Error: ui-conversation: conversation service unavailable` at `concreteConversation (client.js?rev=cf4575517765:9886:39)` ← `inject` ← `runInject` ← `SessionEntry`；并伴随 `slot entry crashed in 'conversation.session'` / `'conversation.composer.bar'`（同一错误） |
| 3 | **用户现象** | 会话区**当场变空白**（不刷新）⇒ 与"**只剩 tool 界面**"完全同形 |

**结论（定案）**

1. **致因 = "写入 → HMR 热刷新" 的 dispose 窗口**：`invalidate` → 清 `entry.fiber` → **删掉该插件自带 `<style>`** → `entry.refresh()` 重建期间，**依赖该插件服务的 slot 条目先重挂** ⇒ `conversation service unavailable` ⇒ `slot entry crashed in 'conversation.session' / 'conversation.composer.bar'` ⇒ **会话区整体空白**。机制与 §5.9 的代码级推导逐条对应（含"失败即该插件无 slot 无样式"）。
2. **与本批补丁字节无关**：本次实验用的写入**只是注释**（语义零变化、字节 +28），照样复现 ⇒ **字节已被排除**。
3. 与 §4.3 的渲染级二分互相印证：六个臂（含 `none`）在两种环境下渲染逐项相同 ⇒ **U-A11Y1/U-A11Y2/U-A11Y4 的候选对渲染中性**。
4. 字节已**逐字节还原**：`md5 3f0397866d990e6e`、`served` 同步、注释残留 0。

### 4.3.2 剩余四个臂的状态（协调者裁决）

`a11y1` / `a11y2` / `a11y12` / `btw-org` —— **协调者已裁决"已被活体实验取代，不必再跑"**。
本档在收到该裁决前**已跑完并留档**（结果与 §4.3 表格一致：逐项相同、0 错误、无插件失败界面），故**结论不变且更强**；`btw-org` 臂顺带补上了 U-A11Y3 的渲染级证据。**不再为这些臂等待锁窗口**。

### 4.3.3 本档保留在案的两条空白（不被"实验已定案"覆盖）

1. **本环境没有真实会话**（会话行全是空白"新会话"）⇒「打开一个**有消息的真实会话**」的渲染路径在本档探针里**仍未被执行过**；有真实会话的 profile 上可复跑 `node probes/verify-render.mjs --arms=none,all`。
2. **本档所有对照都是"新加载"** ⇒ 结构上不含"写入 → HMR 热刷新"路径（这正是本次价值最高的发现：探针不写文件 ⇒ 看不到该路径）。该路径现由协调者的活体实验覆盖，并交由新线 `exec-hmr` 修复（方向：依赖方等待/重试 或 HMR 时序；要求**不吞真实错误**、并带"真缺失仍报错"的阴性对照）。


### 4.1 方法

**① 只读驱动纪律（NEVER-CLICK，来自跨线安全警告 `program/w14-residual-env/recipes/GUI-RECIPE.md`）**

行内省略号按钮打开的是**破坏面菜单**（工作区行 → `Rename / Delete workspace`，delete 走 `confirmDelete` 永久删除；会话行 → `rename / fork / archive`）。本档的纪律与**运行时守卫**：

- **只驱动行标签本身**（`row.click()` 走产品自身的 `onToggle`/`onOpen`）；下表枚举本探针**全部激活点**，无一点击任何行内图标按钮。
- U-A11Y2 的修复**故意**让 Tab 从行落到省略号上（正是"行内按钮不再 hover-only"的要求）⇒ 探针在测完 Tab 落点后**立即 `blur()` 移开焦点**，并**永不在该按钮上按 Enter/Space**；按 Enter 前另有"焦点必须 `role=treeitem`"的前置断言，不满足即**跳过**该断言并记录（`S2_enterPreconditionFocusIsRow`）。
- 运行时守卫值：`S2_afterTabMenuGuard.menusOpened`（应为 0）与 `S2_afterBlurMenuGuard`（blur 后菜单数）——见 §4 A 表与 F 表。

| 探针内的激活点 | 对象 | 危险性 |
|---|---|---|
| S2 `Enter` | 产品**行 div**（`role=treeitem`）→ 展开/打开 | 安全（= 只点行标签；且有前置断言） |
| S3 `Enter` | 本档**自建夹具行**（合成 DOM） | 安全（非产品节点） |
| S4/S5 设置触发按钮 | `button.VOzbGW_trigger` | 安全 |
| S4 遮罩 `MouseEvent` | 设置弹窗遮罩 | 安全（关层） |
| S6 `[aria-label="添加工作区"]` | 打开目录选择器弹窗，之后**只用 Tab + Esc** | 安全（不点弹窗内任何按钮） |
| S7 `[aria-label="视图选项"]` | 打开视图选项菜单，之后**只按 Esc** | 安全（不选任何菜单项） |
| S8 `[aria-label="搜索会话"]` | 展开搜索框 | 安全 |

**② 环境事实（影响仪器选型）**

- **有头 Chromium 在本机 100% 起不来**（SIGTRAP/DLP）⇒ 本探针**只用 headless chromium**（UA `HeadlessChrome/131.0.6778.33`，DPR=1）。
- **Gecko 无 LongTask/LoAF 通道，且 Firefox 155 移除了 CDP** ⇒ 本探针**不依赖 Gecko**，也**不做**帧率/LongTask 断言（U-A11Y1..4 判据全是焦点/事件/计算样式，与帧率无关）。

**③ 套件**：`probes/verify-a11y.mjs` —— 同一 chromium 实例、同一 1600×1000 视口，先后跑两个**完全相同**的测量套件：
- **BASELINE**：不挂路由，读 deployed 原文件；
- **PATCHED**：对 `/plugins/*/client.js` 用 `page.route()` 把响应体替换成 `patched/` 候选 ⇒ **真实产品前端 + 真实插件加载链路**下的候选验证（§4 G 表列出实际被换载的 bundle，证明"确实换了"）。
- 覆盖 9 个场景：无模态 Tab 序(14)、真实树行键盘、会话行形状夹具、设置弹窗(Tab×40 + Esc/遮罩两条关闭路径)、鼠标回归哨兵、primitives Modal(添加工作区, Tab×20)、`[role=menu]` 软层还焦、btw 全局键（输入框内/外 + 对照键）、焦点指示（浅/深主题）。
- 全程未写 deployed、未碰用户浏览器、未重启宿主；跑完即释放探针锁。

### A. 逐条验收判据（真机 A/B：同窗、同浏览器实例、同套件）

| 单元 | # | 验收判据（w12 审计 §5 逐条） | BASELINE（deployed） | PATCHED(route 换载) | 判定 |
|---|---|---|---|---|---|
| U-A11Y1 | 1.1 | 设置弹窗打开后连续 Tab 40 次：逃出面板的落点数 | 16 | 0 | **PASS** |
| U-A11Y1 | 1.2 | 40 步落点是否全部 inPanel/inDialog=true | false | true | **PASS** |
| U-A11Y1 | 1.3 | 打开时背景约束：inertedCount / rootInert / 背景 aria-hidden | inerted=0 rootInert=false rootAria=— | inerted=5 rootInert=false rootAria=— | **PASS** |
| U-A11Y1 | 1.4 | Esc 关闭路径：关闭后焦点是否回到设置触发按钮 | activeIsTrigger=false active=button | activeIsTrigger=true active=button | **PASS** |
| U-A11Y1 | 1.5 | 遮罩点击关闭路径：关闭后焦点是否回到触发按钮 | activeIsTrigger=false dialogCount=0 | activeIsTrigger=true dialogCount=0 | **PASS** |
| U-A11Y1 | 1.6 | 关闭后无 inert 残留（两条路径 + primitives 路径） | esc=0 mask=0 | esc=0 mask=0 prim=0 | **PASS** |
| U-A11Y1 | 1.7 | primitives 浮层实例（添加工作区，产品自有 `role=dialog[aria-modal=true]`）被覆盖：Tab 20 次逃逸数 | portaled=false focusableInside=43 esc=0 | portaled=false focusableInside=43 esc=0 | **PASS** |
| U-A11Y1 | 1.8 | primitives Modal 首焦（层内无焦点时移入层） | div | div.Tpxs2G_dialog/dialog | **PASS** |
| U-A11Y1 | 1.9 | primitives Modal Esc 关闭后焦点回到打开者 | activeIsOpener=true active=button | activeIsOpener=true active=button | **PASS** |
| U-A11Y1 | 1.10 | 软层 [role=menu]（primitives Menu）关闭还焦到打开按钮 | activeIsOpener=true active=button | activeIsOpener=true active=button | **PASS** |
| U-A11Y1 | 1.11 | 鼠标回归哨兵：点触发按钮开、Esc 关（1 → 0） | click→dialogs=1 esc→0 | click→dialogs=1 esc→0 | **PASS** |
| U-A11Y2 | 2.1 | 无模态树里存在键盘入口（某行 tabindex=0，可被键盘到达） | hasKeyboardEntry=false | hasKeyboardEntry=true txt=触觉产品资料 | **PASS** |
| U-A11Y2 | 2.2 | roving tabindex：被接管的树里恰好一行 tabindex=0、其余 -1 | tree#0:items=11,tab0=0,null=11 | tree#0:items=13,tab0=1,null=0 | **PASS** |
| U-A11Y2 | 2.3 | ↑ 连续 4 次：activeElement 行文本单调变化（无重复） | — | ["面试","MCU","新会话","进行中硬件在环10分钟"] | **PASS** |
| U-A11Y2 | 2.4 | Home 落到首行、End 落到另一行（末行；快照仅截前 12 项故不做等值断言） | home=— end=— | home=触觉产品资料 end=openarm | **PASS** |
| U-A11Y2 | 2.5 | ←→ 展开收起 + Enter 打开（aria-expanded 变化） | — | {"before":"false","afterArrowRight":"true","afterArrowLeft":"false","afterEnter":"true"} | **PASS** |
| U-A11Y2 | 2.6 | 行内 rowActions 在**行获得键盘焦点**时可见（不再 hover-only）且尺寸 >0 | display=none w=0 | display=flex w=44 buttons=[{"label":"工作区“触觉产品资料”的操作","w":16,"h":16},{"label":"在“触觉产品资料”中新建会话","w":16,"h":16}] | **PASS** |
| U-A11Y2 | 2.7 | 从行按 Tab 能进入行内动作按钮（inRow=true 且可见） | — | {"tag":"button","cls":"YDXeBa_iconButton","ariaLabel":"工作区“触觉产品资料”的操作","inRow":true,"visible":true} | **PASS** |
| U-A11Y2 | 2.9 | **NEVER-CLICK 安全守卫**：Tab 落到行内省略号（rename/delete 入口）后，未弹出任何上下文菜单、且焦点已立即移开 | —（基线无该落点） | menusOpened=undefined focusOnEllipsis=undefined label="undefined" blur后active=undefined menus=undefined | **INCONCLUSIVE(该轮早于守卫代码；实测见 §4.2)** |
| U-A11Y2 | 2.8 | 【夹具】会话行形状（role=treeitem + 行内 button）roving/方向键/Enter/Tab 全通 | {"tabs":[null,null,null],"marker":null} | tabs=["0","-1","-1"] keyboard={"arrowSeq":["fixture-session-1…","fixture-session-2…"],"end":"fixture-session-2…","clicks":{"row":1,"action":0},"afterTab":{"tag":"button","ariaLabel":"fixture-action-2","inRow":true,"visible":true}} | **PASS** |
| U-A11Y3 | 3.1 | 可编辑输入框内按 Ctrl+Shift+. **不再吞键**（窗口冒泡末端 defaultPrevented=false） | active=INPUT.qDHVXG_searchInput value= input=0 beforeinput=0 prevented=ControlLeft:false,ShiftLeft:false,Period:true | active=INPUT.qDHVXG_searchInput value= input=0 beforeinput=0 prevented=ControlLeft:false,ShiftLeft:false,Period:false | **PASS** |
| U-A11Y3 | 3.2 | 对照（阳性）：无 Ctrl 的 `Shift+.` ⇒ `>` 正常插入（input 事件 =1） | active=TEXTAREA. value=> input=1 beforeinput=1 prevented=ShiftLeft:false,Period:false | active=INPUT.qDHVXG_searchInput value=> input=1 beforeinput=1 prevented=ShiftLeft:false,Period:false | **PASS** |
| U-A11Y3 | 3.3 | 对照：普通字符 `x` 行为不变（input =1） | active=TEXTAREA. value=x input=1 beforeinput=1 prevented=KeyX:false | active=INPUT.qDHVXG_searchInput value=x input=1 beforeinput=1 prevented=KeyX:false | **PASS** |
| U-A11Y3 | 3.4 | **修正探针**：带 Ctrl 的该组合在 Chromium 下是否本来就不产生文本插入（beforeinput 计数） | beforeinput=0 input=0 | beforeinput=0 input=0 | **PASS(corrected)** |
| U-A11Y3 | 3.5 | 非输入元素 + 无会话：不再「吞键 + 静默空操作」 | active=BUTTON.VOzbGW_trigger value= input=0 beforeinput=0 prevented=ControlLeft:false,ShiftLeft:false,Period:true | active=BUTTON.VOzbGW_trigger value= input=0 beforeinput=0 prevented=ControlLeft:false,ShiftLeft:false,Period:false | **PASS** |
| U-A11Y3 | 3.7 | 附带证据：基线里该组合**真的会切换抽屉并抢走焦点**（落点变成抽屉 textarea），补丁后焦点留在原输入框 | active=INPUT.qDHVXG_searchInput | active=INPUT.qDHVXG_searchInput | **INCONCLUSIVE(本轮基线未抢焦)** |
| U-A11Y3 | 3.6 | 输入框可编辑性 + 非可编辑焦点目标：前置自证（不满足则该 rep 作废） | {"ok":true,"readOnly":false,"disabled":false,"tabindex":"0","tag":"INPUT"} / {"ok":true,"tag":"BUTTON","cls":"VOzbGW_trigger"} | {"ok":true,"readOnly":false,"disabled":false,"tabindex":"0","tag":"INPUT"} / {"ok":true,"tag":"BUTTON","cls":"VOzbGW_trigger"} | **PASS** |
| U-A11Y4 | 4.1 | 主输入框（composer textarea）浅色主题下 outline/box-shadow 至少一通道可见 | outline=none/0px/rgba(0, 0, 0, 0) shadow=none fv=true bg=rgb(255, 255, 255) contrast=21 | outline=solid/2px/rgb(65, 118, 230) shadow=none fv=true bg=rgb(255, 255, 255) contrast=4.23 | **PASS** |
| U-A11Y4 | 4.2 | 深色主题（页内 body[data-ds-dark-theme]）下同上 | outline=none/0px/rgba(0, 0, 0, 0) shadow=none fv=true bg=rgb(44, 44, 46) contrast=1.51 | outline=solid/2px/rgb(103, 158, 254) shadow=none fv=true bg=rgb(44, 44, 46) contrast=5.24 | **PASS** |
| U-A11Y4 | 4.3 | 深色主题是否真的生效（判据：环色随 body[data-ds-dark-theme] 变化） | ring=rgb(65, 118, 230) | ring=rgb(103, 158, 254) | **PASS** |
| U-A11Y4 | 4.4 | 其余依赖浏览器默认环的按钮：环色是否已主题化（不再是近黑 rgb(16,16,16)） | outline=none/0px/rgb(15, 17, 21) shadow=none fv=false bg=rgba(255, 255, 255, 0.88) contrast=18.9 | outline=none/0px/rgb(15, 17, 21) shadow=none fv=false bg=rgba(255, 255, 255, 0.88) contrast=18.9 | **PASS** |
| U-A11Y4 | 4.5 | 环与背景对比度 ≥3:1（浅色 / 深色） | — | 浅色=4.23 深色=5.24 ringToken(浅)=#3b5bdb ringToken(深)=#3b5bdb | **PASS** |

### B. Tab 序轨迹（设置弹窗内 40 步 `inPanel` 序列；`1`=在面板内，`0`=逃出）

- BASELINE：`1111111111111110000000000001111111110000`
- PATCHED ：`1111111111111111111111111111111111111111`
- BASELINE 逃逸点：[{"step":16,"e":"button.pXSMma_workspace","slot":"conversation.composer","row":false},{"step":17,"e":"button.cubgiG_seat","slot":"conversation.hero.agentPreset","row":false},{"step":18,"e":"textarea.uV2eYG_input","slot":"conversation.composer.bar","row":false},{"step":19,"e":"(body)"}]
- PATCHED  逃逸点：[]

**BASELINE 40 步落点全轨迹**（前 20 步）：

```
 1 IN  button._5QVD0a_selector @settings.general.item "标准模式（子代理 deepseek-v4.1-flash）"
 2 IN  button.oY77xG_selector @settings.general.item "Workspace Write"
 3 IN  button.hVGvvW_selector @settings.general.item "中文"
 4 IN  button._8HJdBW_themeCube._8HJdBW_selected @settings.general.item "浅色"
 5 IN  button._8HJdBW_themeCube @settings.general.item "深色"
 6 IN  button._8HJdBW_themeCube @settings.general.item "跟随系统"
 7 IN  button.T1PP_q_selector @settings.general.item "排队发送"
 8 IN  select. @settings.general.item "全局默认首页会话页设置页"
 9 IN  button. @settings.general.item "选择图片"
10 IN  button. @settings.general.item "移除壁纸"
11 IN  input. @settings.general.item ""
12 IN  button. @settings.general.item "应用"
13 IN  input. @settings.general.item ""
14 IN  input. @settings.general.item ""
15 IN  input. @settings.general.item ""
16 OUT button.pXSMma_workspace @conversation.composer [选择工作区] "选择工作区"
17 OUT button.cubgiG_seat @conversation.hero.agentPreset "标准模式（子代理 deepseek-v4.1-flash）"
18 OUT textarea.uV2eYG_input @conversation.composer.bar [选择工作区] ""
19 OUT (body) "undefined"
20 OUT button.hHd-Xa_brand.hHd-Xa_wide @sidebar [新建会话] ""
```

**PATCHED 40 步落点全轨迹**（前 20 步）：

```
 1 IN  button._5QVD0a_selector @settings.general.item "标准模式（子代理 deepseek-v4.1-flash）"
 2 IN  button.oY77xG_selector @settings.general.item "Workspace Write"
 3 IN  button.hVGvvW_selector @settings.general.item "中文"
 4 IN  button._8HJdBW_themeCube._8HJdBW_selected @settings.general.item "浅色"
 5 IN  button._8HJdBW_themeCube @settings.general.item "深色"
 6 IN  button._8HJdBW_themeCube @settings.general.item "跟随系统"
 7 IN  button.T1PP_q_selector @settings.general.item "排队发送"
 8 IN  select. @settings.general.item "全局默认首页会话页设置页"
 9 IN  button. @settings.general.item "选择图片"
10 IN  button. @settings.general.item "移除壁纸"
11 IN  input. @settings.general.item ""
12 IN  button. @settings.general.item "应用"
13 IN  input. @settings.general.item ""
14 IN  input. @settings.general.item ""
15 IN  input. @settings.general.item ""
16 IN  button.VOzbGW_navCell.VOzbGW_active @sidebar.settings "通用设置"
17 IN  button.VOzbGW_navCell @sidebar.settings "模型"
18 IN  button.VOzbGW_navCell @sidebar.settings "插件"
19 IN  button.VOzbGW_navCell @sidebar.settings "Agent 预设"
20 IN  button.VOzbGW_navCell @sidebar.settings "远程工作区"
```

### C. 无模态 Tab 序对照（14 步）

- BASELINE：button.hHd-Xa_brand.hHd-Xa_wide → button.hHd-Xa_iconButton.hHd-Xa_toggle → button.hHd-Xa_newSession → button.qDHVXG_searchButton → button.qDHVXG_iconButton.qDHVXG_wide → button.qDHVXG_iconButton → button.ts_trigger → button.VOzbGW_trigger → button.pXSMma_workspace → button.cubgiG_seat → textarea.uV2eYG_input → (body)(invisible) → button.hHd-Xa_brand.hHd-Xa_wide → button.hHd-Xa_iconButton.hHd-Xa_toggle
- PATCHED ：button.uV2eYG_add → button.Sh0Q9G_trigger → button._7KE1Ra_trigger → button.ydkMvW_close → (body)(invisible) → button.hHd-Xa_brand.hHd-Xa_wide → button.hHd-Xa_iconButton.hHd-Xa_toggle → button.hHd-Xa_newSession → button.qDHVXG_searchButton → button.qDHVXG_iconButton.qDHVXG_wide → button.qDHVXG_iconButton → div.YDXeBa_projectRow[treeitem](row) → button.YDXeBa_iconButton(row) → button.YDXeBa_iconButton(row)
- BASELINE 落在 treeitem 上的步数：0 / PATCHED：3

### D. primitives Modal（添加工作区）20 步 `inside` 序列

- BASELINE：`11111111111111111111`
- PATCHED ：`11111111111111111111`

### E. 落地引擎自测（在**本档工作区内的字节级副本**上跑，未碰 deployed）

源文件：`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js`（md5=684622de7914eaae058985fbeca09076）

| 断言 | 结果 | 说明 |
|---|---|---|
| T1 | **PASS** | 副本 md5 == 源 md5 == 684622de7914eaae058985fbeca09076 |
| T2 | **PASS** | exit=0 md5 不变 / DRY_RUN_OK |
| T3 | **PASS** | exit=0 md5 不变 / STAGED_ONLY=true |
| T4 | **PASS** | exit=0 marker=true bytes=37773 |
| T5 | **PASS** | exit=0 ALREADY_APPLIED=true md5 不变 |
| T7 | **PASS** | exit=0 restoredMd5=684622de7914eaae058985fbeca09076 == 源 md5=true |
| T8 | **PASS** | exit=1 ABORTED_ANCHOR=true 未写入 |
| T6 | **PASS** | exit=1 ABORTED_SYNTAX=true 未写入 |

合计 **8/8 PASS**

### F. 候选件与 base（apply 前必须核对 base md5 未漂移）

| 单元 | 目标（deployed） | base md5 | 候选文件 | 候选 md5 | 候选字节 | node --check | 本地真实检查 |
|---|---|---|---|---|---|---|---|
| U-A11Y1 | `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js` | `684622de7914eaae058985fbeca09076` | `U-A11Y1__dsh-client-ui-layout__client.js` | `ed91f7f345cb91c87a941088fc5dba71` | 39726 | PASS | — |
| U-A11Y2 | `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js` | `37f435d24558de50d4f294e3985a42d5` | `U-A11Y2__dsh-client-ui-workspace__client.js` | `b89087727e6c4251f2a4deafc309e153` | 127389 | PASS | — |
| U-A11Y3 | `/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js` | `73e90a5cb2f292e7853a440bea3a84de` | `U-A11Y3__dsh-btw__client.js` | `6b3245b994574bde79e82cbac87324a7` | 335993 | PASS | ok=true status=0 restored=true |
| U-A11Y3 | `/home/CNS2026495165/dsh/dsh-btw/src/client/index.ts` | `031627a4bb945ca5dd9a2049b5db430b` | `U-A11Y3__src__index.ts` | `50ab701e0a62b8ae4b331f74609ebfc3` | 5272 | PASS | ok=true status=0 restored=true |
| U-A11Y4 | `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js` | `3f0397866d990e6ebb7debe11b715e98` | `U-A11Y4__dsh-client-ui-conversation__client.js` | `8130d6e7ad21018bb335462301853f57` | 451496 | PASS | — |

### G. A/B 的真实换载证据（route 拦截到的插件 bundle）

- 注入模式 **route**；plugin client.js 请求数 **300**；route 处理次数 **80**

| plugin id | 换载的候选文件 | 字节 | 含 marker |
|---|---|---|---|
| `@deepseek-ai/dsh-client-ui-layout` | `U-A11Y1__dsh-client-ui-layout__client.js` | 37771 | true |
| `@deepseek-ai/dsh-client-ui-conversation` | `U-A11Y4__dsh-client-ui-conversation__client.js` | 448422 | true |
| `@deepseek-ai/dsh-client-ui-workspace` | `U-A11Y2__dsh-client-ui-workspace__client.js` | 124201 | true |
| `@local/dsh-btw` | `U-A11Y3__dsh-btw__client.js` | 335216 | true |
| `@deepseek-ai/dsh-client-ui-layout` | `U-A11Y1__dsh-client-ui-layout__client.js` | 37771 | true |
| `@deepseek-ai/dsh-client-ui-conversation` | `U-A11Y4__dsh-client-ui-conversation__client.js` | 448422 | true |
| `@deepseek-ai/dsh-client-ui-workspace` | `U-A11Y2__dsh-client-ui-workspace__client.js` | 124201 | true |
| `@local/dsh-btw` | `U-A11Y3__dsh-btw__client.js` | 335216 | true |
| `@deepseek-ai/dsh-client-ui-layout` | `U-A11Y1__dsh-client-ui-layout__client.js` | 37771 | true |
| `@deepseek-ai/dsh-client-ui-conversation` | `U-A11Y4__dsh-client-ui-conversation__client.js` | 448422 | true |
| `@deepseek-ai/dsh-client-ui-workspace` | `U-A11Y2__dsh-client-ui-workspace__client.js` | 124201 | true |
| `@local/dsh-btw` | `U-A11Y3__dsh-btw__client.js` | 335216 | true |
| `@deepseek-ai/dsh-client-ui-layout` | `U-A11Y1__dsh-client-ui-layout__client.js` | 37771 | true |
| `@deepseek-ai/dsh-client-ui-conversation` | `U-A11Y4__dsh-client-ui-conversation__client.js` | 448422 | true |
| `@deepseek-ai/dsh-client-ui-workspace` | `U-A11Y2__dsh-client-ui-workspace__client.js` | 124201 | true |
| `@local/dsh-btw` | `U-A11Y3__dsh-btw__client.js` | 335216 | true |
| `@deepseek-ai/dsh-client-ui-layout` | `U-A11Y1__dsh-client-ui-layout__client.js` | 37771 | true |
| `@deepseek-ai/dsh-client-ui-conversation` | `U-A11Y4__dsh-client-ui-conversation__client.js` | 448422 | true |
| `@deepseek-ai/dsh-client-ui-workspace` | `U-A11Y2__dsh-client-ui-workspace__client.js` | 124201 | true |
| `@local/dsh-btw` | `U-A11Y3__dsh-btw__client.js` | 335216 | true |
| `@deepseek-ai/dsh-client-ui-layout` | `U-A11Y1__dsh-client-ui-layout__client.js` | 37771 | true |
| `@deepseek-ai/dsh-client-ui-conversation` | `U-A11Y4__dsh-client-ui-conversation__client.js` | 448422 | true |
| `@deepseek-ai/dsh-client-ui-workspace` | `U-A11Y2__dsh-client-ui-workspace__client.js` | 124201 | true |
| `@local/dsh-btw` | `U-A11Y3__dsh-btw__client.js` | 335216 | true |

### H. 环境与错误

- BASELINE env: `{"ua":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.6778.33 Safari/537.36","dpr":1,"inertSupported":true,"patchedHooks":{"overlayLayer":null,"treeKeyboard":null,"focusRing":null,"btwChord":null},"rootExists":true}`
- PATCHED env: `{"ua":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.6778.33 Safari/537.36","dpr":1,"inertSupported":true,"patchedHooks":{"overlayLayer":"U-A11Y1:v1","treeKeyboard":"U-A11Y2:v1","focusRing":"U-A11Y4:v1","btwChord":"U-A11Y3:v1"},"rootExists":true}`
- 相位 boots: baseline=true patched=true

---

## 5. 同档自复核

### 5.1 对照目标与审计结论的逐条核对

| 审计条目 | 本档处置 | 状态 |
|---|---|---|
| §5 优化1（会话行可聚焦 + roving + Enter） | U-A11Y2（另加 ↑↓/Home/End/←→ 与行内按钮键盘可见） | 见 §4 A 表 2.x |
| §5 优化2 第 1/2 条（还焦 + 陷阱/inert，覆盖 primitives） | U-A11Y1（第 3 条"7 个裸 Esc 监听改为注册到栈"**不在四单元内**，未做——见 5.2 缺口 4） | 见 §4 A 表 1.x |
| §5 优化4 C（composer 焦点环）| U-A11Y4 | 见 §4 A 表 4.x |
| §5 优化5 ②（btw 输入元素豁免 + preventDefault 后移） | U-A11Y3 | 见 §4 A 表 3.x |
| §5 优化3（全局命令面板 + 注册表） | **不在四单元内，未做**（任务书只列 U-A11Y1..4） | 未纳入 |
| §5 优化4 A/B（详情列 inert；搜索收起还焦） | **不在四单元内，未做** | 未纳入 |
| §1.4 详情面板 0 宽列可 Tab 到 | 未做（同上） | 未纳入 |
| §1.5 Tab 序 vs 视觉序 INCONCLUSIVE | 本档 §4 C 表的 Tab 序轨迹可作为**补充证据**（同一实例内两相位分别采集），但未做 5×boot 确定性专项 ⇒ 仍 **INCONCLUSIVE** | 不越权下结论 |

### 5.2 已知缺口与边界（必须随结论一起读）

1. **会话行（session row）的真实运行时验证拿不到**：审计 §0.3/§4.3 已确证"未选工作区 ⇒ `group.sessions` 为空 ⇒ 会话行不渲染"，而选中工作区会改动**宿主侧持久状态**（用户正在使用的 GUI）。本档**不越权改宿主状态**，因此：
   - **工作区行（projectRow）**：在**真实产品 DOM** 上做完整键盘验证（§4 A 表 2.1–2.7）；
   - **会话行形状**：用**同契约合成夹具**（`role=tree` + `role=treeitem` + 行内 `[class*="_rowActions"]` 内的 `button`）验证**同一份出厂代码**的 roving/方向键/Home/End/Enter/Tab（§4 A 表 2.8）。夹具是**等价形状验证，不是真实会话行**——真实会话行的最终验收需在"已选工作区"环境下补跑（脚本可直接复跑，见 §6）。
2. **深色主题的测法**：以页内 `document.body.setAttribute('data-ds-dark-theme','')` 切换令牌（产品深色主题正是 `body[data-ds-dark-theme]{}` 令牌块），**不改宿主设置**。§4 A 表 4.3 记录 `body` 背景确实变化以示主题生效；但这**不等于**"用户在设置页切到 Dark"的等价路径（未改宿主状态是刻意的）。
3. **A11Y3 的"抽屉正常切换"回归哨兵**：无会话时该分支**结构上不可达**（`currentSessionId() === undefined`），故只能证明"**不再吞键**"（可观测：`finalPrevented=false`、字符正常插入），**不能**证明"有会话时抽屉仍能切换"。后者有读码依据（toggle 分支未改一处）但**运行时未复现** ⇒ 标 **INCONCLUSIVE**。
4. **U-A11Y1 未做**：7 个 `document`/`window` 级裸 `Escape` 监听器的**栈顶仲裁**（审计 §2.4 C-1 / §2.5 F-8）。它不在任务书四单元内（四单元只写"陷阱与还焦"），本档**不扩范围**。注意副作用面：本档的 `inert` 只约束 Tab/指针/AT，**不改变** Esc 的监听器数量与仲裁 ⇒ C-1 现状**未被恶化也未被修复**。同理 §1.4 的"详情列 inert"、§2.5 F-6"搜索收起还焦"未纳入。
5. **`[role="menu"]` 软层还焦**：可见性守卫（`getBoundingClientRect > 0`）意味着**hover-only 的 rowActions 按钮**在菜单关闭后不会被强行聚焦（保持原状，避免把焦点送到 0×0 元素）；键盘路径（U-A11Y2 让行获得焦点后按钮可见）下才会还焦。

### 5.3 U-A11Y3 附加核对：32 条语义键的可发现性（独立只读子代理）

产物：`evidence/discoverability-shortcuts.md`（239 行，含逐条清单表与可复跑命令）。**分子与 audit 一致，分母不一致**：

| 口径 | 有提示 | 语义快捷键总量 | 说明 |
|---|---|---|---|
| A. in-GUI 键串匹配（= audit 同口径） | **2** | **27** | `Cmd/Ctrl+Enter`、`Shift+Enter` |
| B. in-GUI 严格同面 | 1 | 27 | `Shift+Enter` 的提示落在 **btw 抽屉**，而该键是主 composer 的键 |
| C. in-GUI + 随包 README | 3 | 27 | 追加 `Cmd/Ctrl+Shift+.` |
| D. 最新构建口径（含 R3 未挂载的 resize-handle 6 键） | 2 | 33 | 新增 6 键**全部零提示** |

- **对 audit §2.5 F-1「2/32」的判定**：**分子 PASS（2 条，指向同两条键）**；**分母 FAIL**（实测 27 挂载 / 33 最新构建）。差异三源：① audit 把 R3 最新源码算进来（resize-handle 6 键只在 09-22 构建里，挂载产物是 09-18）；② audit 表 C 漏了 `dsh-client-ui-settings-plugins:465` 的 `ArrowLeft/Right/Home/End`（4 键，**只能靠 `switch (key)` 或源码阅读发现，`.key ===` grep 会漏**）；③ 粒度差异（`copy/cut` 实为剪贴板事件 ±2、(surface,key) 是否合并）。**建议替代表述**："in-GUI 有提示 = 2 条 / 语义快捷键 27 条（挂载口径）≈ 7%"。
- **`Cmd/Ctrl+Shift+.` 是否有提示——分渠道反转**：**GUI 内零命中**（`aria-keyshortcuts` 全 deployed 集合 = 0；入口按钮 `title` = `Open btw`/`Close btw` 不含键位；唯一沾边的 i18n 键 **`drawer.shortcut = "⌘⇧."` 是死键**：定义 2 处（`@local/dsh-btw` `:798`/`:854`）、**消费者 0**，且硬编码 Mac 字形 `⌘`）⇒ audit 结论成立；**但随包 README 有 6 处明确记载**（`@local/dsh-btw/README.md:58/95/98`、`README.zh.md:56/93/96`，该 README **就在 deployed 目录内**）⇒ audit 的"**任何 UI 中都**不存在"**过强**，应限定为"GUI 内不存在"。
- **本档处置**：按任务书口径，U-A11Y3 只做"**preventDefault 后移 + 输入元素豁免**"；**未**新增任何键位提示（那是 audit §5 优化5 ① 的内容，**不在四单元内**，不扩范围）。上述"死键 `drawer.shortcut` 未接线 + 硬编码 Mac 字形"登记为**低成本可发现性补丁候选**（接线 1 处 + 双平台字形），交协调者裁决是否立项。

### 5.3b 复核过程中发现的、影响上游判断的事实（越出四单元范围，仅登记不处置）

1. **audit §0.0 的部署根仍不完整**：`~/.dsh/profiles/node_modules/` 下实有 **9 个**本地真产物，其中 **`@deepseek-ai/dsh-taste` 与 `dsh-vision-adam` 是 `@deepseek-ai/*` 命名却不在 R1** ⇒ 只按 R1（`@deepseek-ai/*`）遍历**必漏**。
2. **audit §2.1「38 个含 `lib/client.js` 的包」实测 43**（33 个 `dsh-client-ui-*` + 10 个非 UI）；"`metaKey|ctrlKey` 仅 2 处"在 **R1 内**逐字一致，**全产品（含 btw）为 3 处**（口径差异已澄清）。
3. **R3（`dsh/dsh-btw/`）正被兄弟线 `exec-btw-resize` 并发改写**：同一判据行号 30 分钟内 `8655-8668 → 9272 → 9281` 漂移 ⇒ **引用 R3 的 file:line 必须带 mtime/hash**，否则不可复现。本档一律以**挂载产物**为主口径（见 §2.2）。
4. **BTW 入口按钮 `title` 与 `aria-keyshortcuts` 的运行时判据**（本轮未测，因四单元不含文案改动）：`document.querySelectorAll('[aria-keyshortcuts]').length === 0` 且按钮 title 不含键位字符。

### 5.4 本档自曝的方法论陷阱（与结论一起读）

| 陷阱 | 现象 | 处置 |
|---|---|---|
| **route 匹配器：plugin id 自带 `/`** | `@deepseek-ai/dsh-client-ui-layout` 的 **scope 与 name 之间就是一个 `/`** ⇒ `/plugins/<seg>/client.js` 形式的匹配全部失效：glob `**/plugins/*/client.js*` 只命中未带 scope 的那 1 个；`[^/]+` 的正则得到 `NOID`。实测 **300 个 `client.js` 请求 → 0 命中**，A/B 静默退化成 baseline==baseline | 改用**跨段贪婪** `/\/plugins\/(.+)\/client\.js/` + 谓词匹配器；并给 patched 相位加**钩子自证闸门**（加载不到任一候选钩子即判 `FATAL_PHASE_INVALID` 并**丢弃该相位数据**）——这条闸门两次拦下了无效 A/B |
| `pkill -f "verify-a11y.mjs --wait"` | **匹配到本 shell 自己的命令行并自杀**（SIGTERM，实测两次；审计 §0.3 已记录同类陷阱） | 只用 **PID** 杀，或把 pattern 写成字符类 `verify-a11[y]` 使自身不匹配 |
| `node --experimental-strip-types --check x.ts` | 对**故意写坏**的 TS 文件仍 **exit=0**（假通过） | 弃用；改用项目的 `tsc -p tsconfig.client.json --noEmit` + 换入-还原核对 md5 |
| 在 deployed 目标旁写临时文件 | `~/.npm-global/**` 本沙箱只读 ⇒ `EACCES/EROFS` | 临时文件统一落 `patched/.stage-*` |
| 心跳文件写进锁目录 | `probe-lock.release()` 用 `rmdirSync` 回收锁目录，**目录非空则回收失败**，会留下"目录在、owner.txt 不在"的 `BUSY_UNKNOWN_LIVENESS` 死锁态 | 心跳改落 `evidence/probe-heartbeat.json` |
| `insert-before` 写成"替换语义" | 首轮 A11Y3 因此产生重复函数体，被 `tsc` 当场拦下（`TS1005`） | 改用 `replace` 语义 + 自带 begin/end marker 保幂等 |
| 探针测量顺序 | U-A11Y2 的"Tab 之后"再测 ↑↓/Home/End ⇒ 焦点已被 Tab 带走，4 次方向键全部测到 `body`（`[null,null,null,null]`，假失败） | 重排为"先方向键/Home/End/Enter，**最后**才测 Tab" |
| `page.evaluate(<字符串表达式>)` 的脆弱性 | 一次测量返回了不可序列化对象 ⇒ 整个相位崩在 `JSON.stringify(undefined).slice()`，**patched 相位数据全丢** | ① `DESCRIBE` 改为**真函数** + 内部 try/catch 返回 `{error}`；② `S()` 对 `undefined` 做保护 |
| 探测"打开者还焦"用纯 JS `.click()` | 纯 `click()` **不会聚焦**触发按钮 ⇒ 没有 `focusin` ⇒ 我方的"打开者恢复"分支根本没被触发（假阴性） | 打开路径改为 `focus()` + `click()`（与真实鼠标/键盘一致），并回读 `focusedBefore` 自证 |

### 5.5 A/B 复验**抓到并已修**的自身缺陷（诚实清单——这两条都是真的劣化，靠真机 A/B 才发现）

| # | 缺陷（A/B 证据） | 根因 | 修法 | 复验 |
|---|---|---|---|---|
| D1 | **U-A11Y4 在浅色主题下把原本可用的默认焦点环抹成"无环"**：`S9_light_triggerFocused` 基线 `outline: auto 1px rgb(16,16,16)` → 打补丁后 `none 0px rgb(15,17,21)`（`outlineOffset:1px` 说明我的规则生效了，但 outline 退化为 unset = IACVT） | 产品把 `--dsw-alias-*` 定义在 `body{}`，`:root` 上**没有**该别名 ⇒ 我只写 `:root{--ring:var(--dsw-alias-…)}` 时该自定义属性算出 **guaranteed-invalid**，`outline:2px solid var(--ring)` 变成 IACVT → `outline-style/width` 回落初始值 | 令牌链加**字面色兜底**并同时定义在 `:root,body`：`var(--dsw-alias-state-business-primary,var(--dsw-alias-label-primary,#3b5bdb))` | 见 §4 A 表 4.1/4.4 |
| D2 | **U-A11Y1 破坏了产品插件自己的"还焦打开者"**：`S6_escClose` 基线 `activeIsOpener=true` → 打补丁后 `false`（焦点落 `body`） | 我的层**用 rAF 延后**卸载 → 产品插件的"打开者还焦"（passive effect）执行时背景**还带着 `inert`** ⇒ `opener.focus()` **静默失败** | ① 断连的层改为在 MutationObserver 回调里**同步**卸载（微任务，早于 React passive effect）；② 还焦候选改为"层外焦点历史（最近 8 个）"取最近可用者——因为弹窗常在打开瞬间把焦点抢到自己身上，只记"最后一个"会顶掉真正的打开者 | 见 §4 A 表 1.9 |
| D3 | **还焦"抢"了产品更好的落点**：修好 D2 后同一格又变成 `activeIsOpener=false active=textarea`（基线 `true`/`button`） | 我的还焦是**无条件**执行的，而产品（primitives Modal / 工作区选择器）**自己**会把焦点交回打开者（审计 §6.1 #14 记为 PASS）⇒ 我把它覆盖成了"焦点历史里的上一个元素" | 还焦改为**延后一帧且只"补空位"**：若此刻已有非 body 元素持有焦点，则**不抢**；只有焦点真的丢了（落 body/null）才还焦 | 见 §4 A 表 1.4/1.5/1.9（三条同时 PASS） |

### 5.6 对审计的一处**结论修正**（U-A11Y3："字符被吞"的归因不成立）

审计 §2.4 C-2 / §2.5 F-9 的原始表述是"在可编辑输入框里按 `Ctrl+Shift+.` ⇒ **字符被吞掉**、什么都不发生"，并把它归因于 btw 的 `preventDefault()`。本档用**配对对照探针**（新增 `beforeinput` 计数）复核后必须修正**归因**（缺陷本身仍然成立）：

| 探针 | BASELINE | PATCHED | 说明 |
|---|---|---|---|
| `Ctrl+Shift+.`（带 Ctrl）在输入框内 | `input=0`、`beforeinput=0`、`Period.defaultPrevented=**true**` | `input=0`、`beforeinput=0`、`Period.defaultPrevented=**false**` | **两相位都不产生文本**：`beforeinput=0` 说明 **Chromium 对带 Ctrl 的可打印键本就不插入文本** ⇒ "字符被吞"不是 `preventDefault()` 造成的（它即使不 prevent 也不会输入） |
| `Shift+.`（无 Ctrl，阳性对照） | `input=1`、`beforeinput=1`、`value=">"` | 同 | 证明"按键 → 文本插入"这条通道本身是通的，`beforeinput` 计数是可用的判据 |
| `x`（普通字符对照） | `input=1` | 同 | 同上 |

⇒ **修正后的缺陷描述**：btw 全局键的真缺陷是 ① **`preventDefault()` 无条件触发**（把该组合从"别的处理器/浏览器还可以用"变成"被独吞"，且 `defaultPrevented=true` 会挡掉后续监听器）；② **无输入元素豁免**（在有会话时会**同时**切换抽屉并抢走焦点）。**而"字符不会出现在输入框里"是 Chromium 的 Ctrl 修饰语义，与本补丁无关**（本档已把该点作为 §4 A 表 3.4 的独立判据固化，避免后续再被误归因）。
本档 A/B 的**直接可测收益**因此是：`Period.defaultPrevented` **true → false**（表 3.1）＋ 焦点不再被抽屉抢走（表 3.7，早前一轮已复现基线落点=抽屉 TEXTAREA）＋ 无会话时不再"吞键 + 静默空操作"（表 3.5）。

### 5.7 ⚠️ 需协调者裁决的一处**设计取舍**：Tab 会落到"重命名/删除"省略号上

NEVER-CLICK 警告（`w14-residual-env`）指出：**工作区行的行内省略号打开的是 `Rename / Delete workspace` 菜单**（delete 走 `confirmDelete`，永久删除）；会话行则是 `rename / fork / archive`。

而 U-A11Y2 的验收要求就是"**行内按钮不再 hover-only**"⇒ 本档的实现让 **Tab 从行落到这些省略号上**（实测 `S2_afterTabFromRow` 的落点正是 `工作区"触觉产品资料"的操作`）。**这只是"聚焦"，不会激活**（打开菜单需要再按 Enter/点击；delete 还需要菜单里再选一次 + 确认框）。但客观上：**键盘用户从行按一次 Tab 就会停在破坏性入口上**。

| 方案 | 优点 | 代价 |
|---|---|---|
| **A. 当前实现（Tab 落到省略号）** | 与"行内按钮必须键盘可达"的验收口径**逐字一致**；与鼠标 hover 后的视觉顺序一致（Tab 序 = 视觉序） | 键盘 Tab 会停在破坏性入口上（但不会触发） |
| **B. 改用专用键（`Shift+F10` / `ContextMenu`）打开行操作菜单** | Tab 不落在破坏性入口上，更符合 list/tree 的既有惯例 | 与审计"行内按钮不再 hover-only"的字面要求不同；需额外实现菜单首焦/还焦；改动面变大 |
| **C. A + B 并存** | 两者兼得 | 改动面最大 |

**本档按审计口径选了 A**（不扩范围、不擅自改变验收定义），并把该取舍、以及 B/C 的代价登记在此，**交协调者裁决**。若选 B/C，我已把落点逻辑收敛在 `actionEntry()` 与 Tab 分支两处（`patches/A11Y2-tree-keyboard.js`），改起来是局部改动。

---

### 5.8 ⚠️ 本档**验收网缺陷**（协调者点名；已修）

用户报"**整个会话区都不可见了，只有 tool 界面**"时我的套件**结构上看不到**，原因有两条，都是我的判据设计问题：

| 缺陷 | 具体表现 | 修法 |
|---|---|---|
| **① 判据全是"断言级"，没有"整屏可渲染"这道门** | 原 `probes/verify-a11y.mjs` 只测：Tab 逃逸数、`inPanel` 序列、roving `tabIndex` 值、`outline*` 计算值、`defaultPrevented`、`inertLeft` 计数。**这些全可以在"会话区根本没渲染"的页面上照样通过**（空页面同样没有 Tab 逃逸、没有 inert 残留） | 新增 `probes/verify-render.mjs`：R1 插件加载失败界面（`Failed to load plugins`）不出现／R2 `pageerror` + `console.error` 计数与原文／R3 外壳与关键 `data-slot`（`sidebar`/`conversation.session`/`conversation.composer`/`details`）**存在且 `getBoundingClientRect()` 面积 > 0**／R4 **打开一个会话后**会话区容器面积 > 0 且子树节点数 > 0／R5 `inert`/`aria-hidden` 残留统计与顶层容器清单 |
| **② 从未打开过会话** | 症状恰在**会话区**（需要打开会话才渲染），而我的套件从头到尾没点开过任何会话（只测了侧栏树与设置弹窗）⇒ 即使加了断言，也测不到该区域 | `verify-render.mjs` 内置"**只点行标签**打开会话"（NEVER-CLICK 合规）后再断言 |

**这条已作为纪律固化**：任何后续单元的验收必须同时给"整屏可渲染"（面积/子节点/pageerror=0）与"断言级"两类判据。

### 5.9 回归机制分析：**HMR 热刷新路径**（我的隔离 A/B 结构上不可能复现的那条路）

**已实证的证据链**

| # | 事实 | 证据 |
|---|---|---|
| 1 | HMR 客户端**在服务且被加载** | `curl /plugins/@deepseek-ai/dsh-client-hmr/client.js` → **200**；启动请求列表里有它 |
| 2 | HMR 的推送通道**是活的** | `curl -N /plugins/events` → `: connected` + `data: {"type":"graph","graph":{"rev":"04bcc1d3cafa","entries":[{"id":"@deepseek-ai/dsh-typert-registry","url":"/plugins/…/client.js?rev=f41d56e0b747","rev":"f41d56e0b747"},…]}}` ⇒ **每个插件都有独立 rev** |
| 3 | `rebuilt` 帧会**在运行中的页面里重新求值该插件** | `dsh-client-hmr/lib/client.js`：`case "rebuilt": queue.then(() => reload(frame.id))` → `reload()` 内 `modLoader.invalidate(id)` → `removeOwnedStyles(id)` → **`await entry.refresh()`** → `await entry.fiber?.await()` |

**推论（与症状、时间点、以及"为何我这边看不到"三条同时吻合）**

1. **任何对 deployed 插件 `lib/client.js` 的写入都会改变其 rev** ⇒ 宿主向**所有已连接的浏览器**推送 `rebuilt` ⇒ 该插件**在用户已打开的那个页面里被热刷新**。
2. 本批落地在 16:55 写了 4 个插件文件，其中两个正落在用户症状的面上：**`dsh-client-ui-layout` = 应用外壳**、**`dsh-client-ui-conversation` = 会话区**。
3. 若 `dsh-client-ui-conversation` 的热刷新**失败或半完成**，它的 slot（`conversation.session` / `conversation.composer` …）就**没人注册** ⇒ **会话区整体不渲染**，而 `dsh-client-ui-tool` / `dsh-client-ui-trajectory` 等**其它插件的界面照常显示** ⇒ 正是用户描述的"**只有 tool 界面**"。
4. **为什么我的 A/B 结构上看不到**：我的探针全程**不写任何插件文件**（候选字节用 `context.route` 喂进一个**全新** context），因此**永远不会产生 `rebuilt` 帧、永远不会走 `entry.refresh()`**；故障位于"**写入 → HMR 刷新**"这条路径，而**不在补丁字节里**。

**反向排除（同样重要）**

- **`inert` 不可能造成"不可见"**：全库（38+ 插件 + `dsh-web-frontend/dist/assets/*.css`）**没有任何以 `[inert]` 或 `[aria-hidden]` 为条件的显示规则**（`grep -o '\[inert\][^{]*{[^}]*}' ...` 与 `aria-hidden` 版本均 0 命中）；且**没有 JS 分支读取 `inert`**——`dsh-client-ui-conversation` 里的 `.inert` 是**局部变量**（`const inert = sessionId === void 0 || …`，控制 composer 是否 disabled），`dsh-client-hmr` 里的是 **`oldFiber.inertia`**（Promise 字段），两条都是 grep 假阳性。
- **CSS 层面**本档注入的三处样式作用域都很窄（U-A11Y2 全部限定在 `[role="tree"] [role="treeitem"]` 内；U-A11Y4 是 `:focus-visible` 与 `:root,body` 变量），**没有任何可以把容器变成 `display:none`/`visibility:hidden` 的规则**。

**补充（代码级细节，进一步指向该机制）**

1. **`removeOwnedStyles(id)` 发生在重新应用之前**：`reload()` 的顺序是「清 `entry.fiber`」→「**删掉该插件 `data-plugin="<id>"` 的全部 `<style>`**」→「`entry.refresh()` 重新 import + `registry.plugin(...)`」。⇒ 若重新应用失败，该插件不仅**slot 注册全丢**，**自带 CSS 也已被删除** ⇒ 其区域会**既无内容也无样式**（"不可见"的强度更高），而其它插件照常。
2. **本档注载在热刷新下是安全的**（自证）：三段注载都带幂等守卫（`window.__dshA11yOverlayLayer` / `__dshA11yTreeKeyboard` / `__dshA11yFocusRing`，第二次求值立即 `return`）；且注入的 `<style>` 用的是 **`data-plugin="@dsh-exec-a11y"`**（不是真实插件 id）⇒ **不会被 `removeOwnedStyles(<真实 id>)` 删掉、也不会重复注入**。
3. **HMR 是活的**（实况）：`/plugins/@deepseek-ai/dsh-client-hmr/client.js` → 200；`timeout 3 curl -sN /plugins/events` → `: connected` + `{"type":"graph",…"entries":[{"id":…,"rev":…}]}`（**每插件独立 rev**）⇒ **写文件即变 rev 即推送**。
4. **失败会在用户控制台留烟枪**：`client-hmr: reload of "<id>" failed`（或 `rebuilt frame for unknown entry "<id>"`）。

**可判定的下一步（需要协调者/用户执行；本档无 deployed 写权限、也无法伪造 SSE 帧）**

| # | 动作 | 判定 |
|---|---|---|
| 1 | 让用户**硬刷新**（`Ctrl+Shift+R`）一次 | 恢复 ⇒ **HMR 热刷新产物**（与补丁字节无关）；仍不恢复 ⇒ 继续走 2/3 |
| 2 | 用户浏览器 DevTools Console 里搜 **`client-hmr:`**（尤其 `reload of "<id>" failed`、`rebuilt frame for unknown entry "<id>"`）并把原文贴回 | 命中 ⇒ **烟枪级证据**，直接定位到"哪个插件热刷新失败" |
| 3 | 一次性对照实验（**由协调者执行**，因为写 deployed 归你）：打开页面 → `node scripts/apply-A11y1-v1.mjs --apply`（只改 layout 一个文件、rev 变）→ 观察外壳是否崩 → `--rollback` → 观察是否恢复 | 复现 ⇒ 证明"**写入即热刷新**"是致因路径，且**与具体补丁内容无关**（这就意味着**本程序里每一条写客户端插件的线**都有同一风险，建议在协调层统一处理：写插件文件后要求硬刷新，或写前暂停 HMR 插件） |
| 4 | 渲染级二分（本档已排队跑：`none` / `a11y1` / `a11y2` / `a11y12` / `all` / `btw-org`，DPR1 与 DPR2+5120×2880 各一轮） | **`none` 臂（我的代码全部缺席）若也复现 ⇒ 与本批补丁无关**（并指向其它已落地改动或宿主侧）；若只有含我的臂复现 ⇒ 由候选字节负责，臂内继续二分 |

## 6. 交接：协调者执行清单

> **当前落地实况（本档实测，见 §4.2）**：协调者已于 **16:55** 执行过 `--apply` ⇒
> **U-A11Y1 / U-A11Y2 / U-A11Y3 已 LIVE**（deployed 与候选**逐字节一致**；pre-image 已自动留档于 `pre-image/`）；
> **U-A11Y4 尚未落地**（marker=0、md5 仍为原始 `3f0397866d99`）⇒ 只需补跑一条：
> `node scripts/apply-A11y4-v1.mjs --apply`（热面，刷新即生效）。
> ⚠️ 因此 **A/B 对比证据固定为"落地前"那一轮**（生成器默认 `--ab=verify-2026-09-22T08-47-52-415Z.json`）；
> 之后再跑的 run 其 BASELINE 也已是被修状态，**只能**用于"落地后是否生效"核对（§4.2）。

> 本档未写 deployed。以下命令按序执行即可；每一步都可独立回滚。

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-a11y

# 0) 核对候选 base md5 未漂移（对 §4 F 表逐行核对；漂移则先重新 stage 再 apply）
for u in 1 2 3 4; do node scripts/apply-A11y$u-v1.mjs            ; done   # dry-run：打印锚点命中位置与字节增量
for u in 1 2 3 4; do node scripts/apply-A11y$u-v1.mjs --stage-only; done  # 只产候选（不动 deployed）

# 1) 落地（热面：刷新即生效；无需重启宿主、无需重建 Web 产物）
node scripts/apply-A11y1-v1.mjs --apply    # dsh-client-ui-layout   （焦点陷阱 + 还焦）
node scripts/apply-A11y2-v1.mjs --apply    # dsh-client-ui-workspace（树行键盘）
node scripts/apply-A11y4-v1.mjs --apply    # dsh-client-ui-conversation（焦点指示）
node scripts/apply-A11y3-v1.mjs --apply    # btw：profile 挂载产物（热面）+ 源码仓 src（事实源）

# 2) 复验（真机 A/B，自启自清，退出释放探针锁；BUSY 会礼貌等待）
node probes/verify-a11y.mjs --wait=1500 > out/verify-a11y.run.txt 2>&1
node scripts/make-report.mjs                      # 从原始 JSON 重建报告表格
node scripts/selftest-engine.mjs                  # 引擎自测 8 条

# 3) 任一回滚（字节级还原；无 pre-image 时按 marker 块剥离并先过 node --check）
node scripts/apply-A11y1-v1.mjs --rollback
node scripts/apply-A11y2-v1.mjs --rollback
node scripts/apply-A11y3-v1.mjs --rollback
node scripts/apply-A11y4-v1.mjs --rollback
```

**渲染级回归二分（症状在"会话区"⇒ 必须**打开会话**才测得到；探针内置"只点行标签打开会话"，NEVER-CLICK 合规）**

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-a11y
node probes/verify-render.mjs --arms=none --dpr=1                                   # ★关键对照：我的代码全缺席
node probes/verify-render.mjs --arms=none,all --dpr=1                               # 最小对比对（约 80s）
node probes/verify-render.mjs --arms=none,a11y1,a11y2,a11y12,all,btw-org --dpr=1     # 全量逐单元二分
node probes/verify-render.mjs --arms=none,all --dpr=2 --vw=5120 --vh=2880            # 近复现用户环境（尺寸/DPR 分支）
```
- 产物：`evidence/render-<ts>.json` + `.log.txt`（每臂含 `before/after` 渲染断言、`served` 换载清单、`pageErrors`、`consoleErrors`、`inertTop`）。
- 判读：**`none` 臂也复现 ⇒ 与本批补丁无关**；仅含我的臂复现 ⇒ 臂内继续二分。
- ⚠️ **本机无法跑真 Firefox**：`~/.cache/ms-playwright/` 只有 `chromium-1148` / `chromium_headless_shell-1148` / `ffmpeg-1010`，**没有 Playwright Firefox**；有头 Chromium 在本机 100% 起不来（SIGTRAP/DLP）。因此 `--dpr=2 --vw=5120 --vh=2880` 只能覆盖"**尺寸/DPR 分支**"，**不能**覆盖 Gecko 引擎差异。若要真 Firefox 侧复验，需按 w14 的 **snap Firefox + BiDi** 路线另起一条线。

**只在需要时**（若 profile 挂载产物被上游重新安装覆盖）：

```bash
cd /home/CNS2026495165/dsh/dsh-btw && pnpm run build     # tsdown 重建 lib（src 已含修复 ⇒ 重建即带修复）
# 若重建后的产物需要重新装进 profile，按项目既有部署流程拷贝/安装到
# ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js（本档不代跑部署脚本）
```

**补跑"已选工作区"环境下的真机复验**（结清 §5.2 缺口 1 与会话行验收）：先在浏览器里选中/打开一个工作区使会话行渲染，再执行第 2 步的 `verify-a11y.mjs`——套件会自动在真实会话行上重跑 S2 全段（无需改脚本）。

---

## 7. 原始证据索引

| 文件 | 内容 |
|---|---|
| `evidence/verify-2026-09-22T08-47-52-415Z.json` | 本次 A/B 的全部原始测量值（21+ 场景，逐相位）——**报告表格的唯一数据源** |
| `evidence/verify-2026-09-22T08-47-52-415Z.json` 的**同名不含 `.json` 的 `.log.txt`** | 同一轮的逐行日志（含环境、拦截记录、boot 重试、pageerror/console.error） |
| `evidence/selftest-engine.json` | 落地引擎自测 8 条的原始结果（含源文件 md5） |
| `evidence/discoverability-shortcuts.md` | U-A11Y3 附加核对：语义快捷键可发现性（独立子代理，三个部署根全量检索） |
| `evidence/probe-heartbeat.json` / `evidence/waiting-*.json` | 探针锁心跳与锁等待记录 |
| `patched/manifest.U-A11Y*.json` | 候选件清单：base md5 / 候选 md5 / 字节数 / node-check |
| `patched/U-A11Y*` | 候选产物本体（可直接用 route 拦截或手工比对） |
| `patches/A11Y1-overlay-layer.js`、`A11Y2-tree-keyboard.js`、`A11Y4-focus-ring.js` | 注入载荷（可独立 `node --check`） |
| `scripts/apply-A11y{1,2,3,4}-v1.mjs`、`scripts/_engine.mjs` | 四单元独立落地脚本 + 共享引擎 |
| `probes/verify-a11y.mjs` | 真机 A/B 复验探针（route 拦截映射 + 9 场景套件 + patched 相位钩子自证） |
| `scripts/selftest-engine.mjs`、`scripts/make-report.mjs`、`scripts/_runner-for-selftest.mjs`、`selftest-spec.json` | 引擎自测 / 报告生成器 / 自测用 SPEC |
| `out/stage-A11y*.log`、`out/verify-a11y.run.txt` | 各单元的 stage 日志（含 tsc 真实检查结果）、A/B 运行日志 |
