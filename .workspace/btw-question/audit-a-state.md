# 审计 A：btw 问答卡片「点了选项颜色不持久」的状态生命周期根因

- 审计档：只读审计（未改任何代码、未写 settings、未重启/kill 任何进程）
- 工作目录：`/home/CNS2026495165/dsh`
- 审计对象：`dsh-btw` 自绘问答卡片 `QuestionCard`（`dsh-btw/src/client/SideChatSurface.tsx:60-173`）
- 基准时点：2026-09-23；GUI 进程 `node /home/CNS2026495165/.npm-global/bin/dsh web`（PID 2649213，10:09 启动，`http://127.0.0.1:3080`）

---

## 1) 现象复述与结论（一句话）

**现象复述**：在 btw 抽屉里出现 `btw_ask_user` 问句卡片时，点击某个选项，按钮的选中态（背景/边框颜色）不持久——要么几乎看不到变化，要么闪一下就回到未选中。

**结论一句话**：`QuestionCard` 的「重置草稿」`useEffect` 的第二个依赖 `pendingQuestion.questions` 是一个**每次轮询都新建的数组**（host 经严格 zod codec 的 JSON RPC 边界下发 + 客户端 `codec.schema.parse()` 逐次重建对象图），而 `SideChatSurface` 在 `poll()` 每 **220 ms**（空闲 700 ms）就因 `publish()` 新快照而重渲染，于是该 effect 以 ~4.5 次/秒的频率把 `setDrafts(全空)` 重跑，**用户刚点选的 `selected` 在 ≈220 ms 内被清空**。这与 `state` 存储、点击链路、CSS 可见性都无关；重置不是「不生效」，而是「生效了随即被抹掉」。**主代理假设 1/2 成立且被独立证据加强；未发现别的机制在主导该现象。**

---

## 2) 机制级因果链（逐步，带 file:line）

### 步骤 0：host 侧的身份其实是稳定的（先排除 host 嫌疑）

- `dsh-btw/src/host/side-chat-service.ts:585` `const pendingQuestion = entry.pendingQuestion`
- `dsh-btw/src/host/side-chat-service.ts:594-595`
  `... (pendingQuestion === undefined ? {} : { pendingQuestion: { questionId: pendingQuestion.questionId, questions: pendingQuestion.questions } })`
  → host 只换了外层对象字面量，`questions` **复用同一个数组引用**。host 侧无身份抖动。

### 步骤 1：该结果必须穿过「JSON RPC + 严格 codec」边界，客户端侧每次重建对象图

- descriptor 声明结果是严格 codec：`dsh-btw/src/remote-descriptors.ts:32-34`
  `result: { mode: 'strict', typeSymbol, schema: readSideChatResultSchema }`
- schema 含 `pendingQuestion`：`dsh-btw/src/shared/remote.ts:151-155`（`questions: z.array(btwQuestionSchema).min(1)`）、`:174`（`pendingQuestion: btwPendingQuestionSchema.optional()`）
- 客户端远程实现（btw 注入的 `remote` 服务＝api-gateway 客户端）：`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-api-gateway/lib/client.js:29`（`super(ctx, "remote")`）、`:35`（`$mount`）
  - `:243` `const result = await connection.rpc.call("/api", endpoint, { args }, signal)` ← 真实跨进程/跨线调用
  - `:251` `value: parse(descriptor.result, result.value, endpoint, "result")`
  - `:417-424` `function parse(codec, value, ...) { … return codec.schema.parse(value) }`
- **实测（决定性）**：`node -e` 用 btw 自带 `zod@4.6.2` 对同一输入连续 `parse()`：
  `same object? false`、`parse==parse? false`、`questions same array across parses? false`、`questions same as source? false`
  → 即使不跨线，zod 也逐次**新建** `questions` 数组与每个元素对象。

⇒ **`value.pendingQuestion.questions` 每次 `sideChat/read` 都是新数组**（既跨 JSON 边界，又过 zod 重建）。

### 步骤 2：客户端把它原样写进 store，每 220 ms 发射一次新快照

- 轮询主循环：`dsh-btw/src/client/controller.ts:684-748` `poll()`；`:723` `delay = running ? 220 : 700`；`:745-747` 在 `phase==='open'` 时**无条件续排**下一次 poll。
- `dsh-btw/src/client/controller.ts:724-728` 先把上一个 `pendingQuestion` 从 `baseState` 里解构剔除；`:738` `...(value.pendingQuestion === undefined ? {} : { pendingQuestion: value.pendingQuestion })` → 写入的是**步骤 1 的新对象/新数组**。
- `dsh-btw/src/client/controller.ts:799-802` `publish(next){ this.state = Object.freeze(next); for (const listener of this.listeners) listener() }` → 每次 poll 都换 `this.state`，并同步通知订阅者。
- 「提问挂起期间 `running` 必为 true」已有代码级依据：
  - `dsh-btw/src/host/side-chat-service.ts:550` `const childRunning = entry.handle?.agent.status === 'running'`
  - `dsh-btw/src/host/side-chat-service.ts:590` `running: childRunning || queued`
  - `btw_ask_user` 是「await 一个永不立即 settle 的 Promise」的工具：`dsh-btw/src/host/side-chat-service.ts:966-993`（`:966` `return await new Promise(...)`），工具执行在回合内，回合未结束 ⇒ agent 状态仍是 `running`
  - `AgentStatus` 只有两态、且 `running` 覆盖回合排空全过程：`…/dsh-agent/lib/types/runtime-types.d.ts:39-44`（`'idle' | 'running'`）
  ⇒ 问句待答期间轮询间隔＝**220 ms**（+RTT），而非 700 ms。

### 步骤 3：`QuestionCard` 的重置 effect 被这个新数组每帧打中

- `dsh-btw/src/client/SideChatSurface.tsx:74-79`
  ```ts
  useEffect(() => {
    setDrafts(Object.fromEntries(pendingQuestion.questions.map(q => [q.id, { selected: new Set<string>(), custom: '' }])))
    setError(null)
  }, [pendingQuestion.questionId, pendingQuestion.questions])
  ```
  React 对依赖数组逐项做 `Object.is` 比较：`questionId`（uuid，稳定）不变，`questions`（步骤 1/2 的新数组）**每次都变** ⇒ 该 effect **每次 poll 后都重跑**。
- 每次重跑 = `setDrafts(全空)` ⇒ 步骤 4 刚写进去的 `selected` 被整体丢弃。
- 构建产物同源（无漂移）：`dsh-btw/lib/client.js:1252-1258`（`:1252` `useEffect`，`:1258` 即该依赖数组），与 `src` 逻辑等价。

### 步骤 4：点击本身是生效的（不是「点了没反应」）

- `dsh-btw/src/client/SideChatSurface.tsx:127-133`：`<button type="button" className={active ? css.questionOptionActive : css.questionOption} aria-pressed={active} onClick={() => toggle(...)}>`；无 `disabled`。
- `dsh-btw/src/client/SideChatSurface.tsx:81-90` `toggle()` 用函数式 `setDrafts` 生成新的 `Set` ⇒ 点击后确实进入选中态、确实会重渲染出 `questionOptionActive`。
- 因此用户看到的是「按钮点亮 → ≤220 ms 后被抹回未选中」，而非「点击丢失」。

### 步骤 5：为什么观感是「几乎没变」而不是「闪一下」

- 点击后指针仍悬停在按钮上，`:hover` 规则 `.questionOption:hover{background: var(--dsw-alias-interactive-bg-hover)}`（`dsh-btw/src/client/side-chat.module.css:347`）本身就把底色抬起来了；选中态与 hover 的**底色差异极小**，主要靠边框区分（见 §3.5 的量化）。当重置又以 220 ms 频率发生，肉眼几乎只能捕捉到「点了，但颜色没留下」。

---

## 3) 已验证事实清单

以下全部为**读代码/实测**结论，标注 file:line 或命令。

### 3.1 身份稳定性（对应任务问题 1）

| # | 事实 | 证据 |
|---|---|---|
| 1 | store 快照对象本身**稳定**（`getSnapshot` 不新建对象） | `dsh-btw/src/client/controller.ts:107` `readonly getSnapshot = (): SideChatClientState => this.state` |
| 2 | 但每次 `publish` 必换新 state 对象并广播 | `controller.ts:799-802` |
| 3 | host 侧 `questions` 数组引用被复用（稳定） | `src/host/side-chat-service.ts:595` |
| 4 | 客户端侧 `questions` 每次 read 都是**新数组**（跨 JSON RPC + zod `schema.parse` 重建） | `dsh-api-gateway/lib/client.js:243,251,417-424`；`dsh-btw/src/remote-descriptors.ts:32-34`；`src/shared/remote.ts:151-155,174` |
| 5 | zod 4.6.2 `parse()` 逐次新建对象/数组（实测） | `cd dsh-btw && node -e "…z.parse(src) === z.parse(src)…"` → `false`；`a.questions === b.questions` → `false`；`a.questions === src.questions` → `false` |
| 6 | 轮询频率：问句待答期间 220 ms（`running` 恒真） | `controller.ts:723,745-747`；`host/side-chat-service.ts:550,590`；`dsh-agent/lib/types/runtime-types.d.ts:39-44` |

### 3.2 effect 重跑（对应任务问题 2）

| # | 事实 | 证据 |
|---|---|---|
| 7 | 重置 effect 依赖 `[questionId, questions]`，体内清空全部 draft + `setError(null)` | `src/client/SideChatSurface.tsx:74-79` |
| 8 | 构建产物里同一 effect 存在（依赖数组同形，无旧版本残留） | `lib/client.js:1252-1258` |
| 9 | 父组件用 `useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)` 订阅 store ⇒ 每次 publish 都重渲染并下发新的 `state.pendingQuestion` | `src/client/SideChatSurface.tsx:235`；调用点 `:586` |
| 10 | 结论：**每 220 ms（+RTT）重跑一次，~4.5 次/秒把选中态清空** | 由 4+7+9 推得（见 §5 置信度） |

### 3.3 挂载/卸载/重挂载（对应任务问题 3）

| # | 事实 | 证据 |
|---|---|---|
| 11 | 调用点无 `key`，条件为 `interactive && state.pendingQuestion !== undefined`；`interactive = phase==='starting'||'open'` | `src/client/SideChatSurface.tsx:585-587`、`:353` |
| 12 | `pendingQuestion` 的增删在**同一次** publish 内原子完成（上一帧的被解构剔除、新的同帧写入），不会出现「pending 期间短暂 undefined」的抖动式卸载 | `controller.ts:724-740` |
| 13 | 抽屉容器 `visible` 为假时整树卸载（`return null`），为真时是同一棵树、无 key 变化 | `src/client/SideChatDrawer.tsx:61-65,118,120-211` |
| 14 | drawer 模式与 better-sidebar 模式是不同的 surface（互斥），不会互相顶掉重挂 | `src/client/presentation.tsx:201-210` vs `SideChatDrawer.tsx:200-209` |
| 15 | 无 portal 容器切换（`ImageLightbox` 才用 portal，问句卡片不用） | `src/client/SideChatSurface.tsx:209-222` vs `:110-173` |
| 16 | `controller.getSnapshot` 稳定；父会话 `SessionFace.getSnapshot` 也是缓存字段（仅在变化时替换） ⇒ **不存在 React "getSnapshot should be cached" 隐患** | `controller.ts:107`；`dsh-client-runtime/lib/client.js:8713-8715,8761-8762`；包装见 `SideChatSurface.tsx:22-26` |
| 17 | 结论：**本次现象不是重挂载造成的**；重挂载只是次级风险路径（phase→error 再回 open、`view.visible` 抖动、回答后再问一次都会各自丢失草稿） | 由 11-16 推得 |

### 3.4 点击链路（对应任务问题 4）

| # | 事实 | 证据 |
|---|---|---|
| 18 | 按钮 `type="button"`、无 `disabled`、`onClick` 直连 `toggle` | `SideChatSurface.tsx:127-133`、`:81-90` |
| 19 | 卡片路径上无 `preventDefault`/`stopPropagation` 拦截（抽屉只在 window 上收 Escape） | `SideChatSurface.tsx:394-431`；`SideChatDrawer.tsx:107-116` |
| 20 | `pointer-events`：`.placementRoot{none}` 但 `.drawer{auto}`，后代可点 | `side-chat.module.css:13-17`、`:57` |
| 21 | `.mobileScrim{pointer-events:auto}` 只在 `(max-width:720px)` **且** bottom-sheet 下 `display:block`，且 DOM 顺序在 `.drawer` 之前（不遮抽屉） | `side-chat.module.css:31-38,676-677`；`SideChatDrawer.tsx:130-142` |
| 22 | 三个 resize 手柄是 8–18 px 边缘条（`z-index:7`），不覆盖卡片中部的选项行 | `side-chat.module.css:396-499` |
| 23 | 结论：静态面上**无点击阻断** ⇒ 点击确实改了 state（与 18/24 现象一致：是「改完被抹掉」） | 由 18-22 推得 |

### 3.5 选中态可见性 + 与主会话的差异（对应任务问题 5）

| # | 事实 | 证据 |
|---|---|---|
| 24 | 源码样式：`.questionOption,.questionOptionActive{…background:transparent…}`（`:346`）、`.questionOption:hover{…}`（`:347`）、`.questionOptionActive{border-color: color-mix(in srgb,#b7e85b 60%,…); background: color-mix(in srgb,#b7e85b 12%,transparent); color: …label-primary}`（`:348`） | `src/client/side-chat.module.css:346-348` |
| 25 | 构建产物里两条规则都在、顺序正确（active 覆盖 base），且类名映射存在（**类名未失效**） | `lib/client.js:944`（同一 CSS 串内 `…SalQ5q_questionOption,.SalQ5q_questionOptionActive{background:0 0;…}` 后接 `SalQ5q_questionOptionActive{…background:#b7e85b1f}`）、`:1020-1021`（`"questionOption"/"questionOptionActive"` 映射）、`:1337`（active 三元用法） |
| 26 | `*.module.css` 有类型声明，无 TS 层失效 | `src/client/styles.d.ts:1-4` |
| 27 | **量化（暗色 token 合成计算）**：卡片底 ≈ rgb(63,68,59)；未选中填充 = 卡片底；选中填充 ≈ rgb(77,88,63) ⇒ **对比度 1.32、最大通道差 20**；边框由 rgb(49,49,51) → rgb(118,148,64) ⇒ **对比度 3.76**。作参照：官方选中态底色就是 hover token，比值 1.27。⇒ **选中态是可感知的，不是「颜色不可见」** | 由 `dsh-client-ui-theme/lib/client.js`（`--dsw-alias-interactive-bg-hover:#ffffff14`、`--dsw-alias-border-l2:#ffffff1f`、`--dsw-static-neutral-bluish-800:#353638`、`-950:#151517`）本地合成计算得出 |
| 28 | 与主会话的**结构性差异**（官方 `dsh-client-ui-user-questions/lib/client.js`）：官方是底部 composer 座位卡片（`.frame`/`.card`，`:233`），每页一题 + 进度/翻页（`:362` 起）、最小化/取消（`:479-520`）、`role="radio"|"checkbox"` + **`aria-checked`**（`:531`）、勾选 glyph（`:543`）、`optionSelected` 仅用于单选（`:529`）。btw 是「一次性平铺全部问题 + 纯 button + `aria-pressed` + 无 glyph + 硬编码 `#b7e85b`」 | `…/dsh-client-ui-user-questions/lib/client.js:233,348-370,479-573`；`SideChatSurface.tsx:116-142`；`side-chat.module.css:327,340,348` |
| 29 | 官方卡片**完全没有 useEffect**（整份官方 client bundle `grep -c useEffect` = **0**），靠 `key={question.key}` 在新提问时整树重挂（`QuestionFlow` 只有 `useState`） | 官方 `lib/client.js:349-356`（`useMemo` 构 `PendingQuestion` + `key: question.key`）、`:360-370`（`QuestionFlow` 仅 `useState` 初始化）；`grep -c useEffect …/dsh-client-ui-user-questions/lib/client.js` → `0` |
| 30 | 两条通道本就不同、不能简单复用官方卡片：btw 禁用官方 `ask_user_question`、自带 `btw_ask_user` | `src/shared/tool-policy.ts:36,43`；`src/host/side-chat-service.ts:905` |

### 3.6 源码/产物漂移与部署链路（对应任务问题 6）

| # | 事实 | 证据 |
|---|---|---|
| 31 | `QuestionCard` 在构建产物里与 src **逻辑一致**，无旧版本残留 | `lib/client.js:1245`（函数起点）～`:1258`（依赖数组）vs `src/client/SideChatSurface.tsx:60-79` |
| 32 | 工作区 `dsh-btw/lib/client.js` 与 profile 副本**字节相同** | md5 均为 `6c29b98b645df00b8bc3e9279d6df93e`，size 361702，mtime 均为 `2026-09-23 10:01:27.368050513` |
| 33 | **profile 位是实体目录副本，不是符号链接** | `~/.dsh/profiles/node_modules/@local/dsh-btw` 为 `drwxrwxr-x` 真目录；`readlink -f` 返回自身；inode 不同（工作区 31720323 / profile 34768523）。与 `docs/architecture/04-ops-deploy.md` §5「自装插件位：农场的 `@local/`（真实目录，非链接）」一致 |
| 34 | **GUI 实际加载的是 profile 副本**（决定性） | `createRequire('/home/CNS2026495165/.dsh/profiles/web/cordis.patch.yml').resolve('@local/dsh-btw/client')` → `/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js`；机制见 `dsh-client-modules/lib/index.js:275-276`（`createRequire(ctx.baseUrl)` + `require.resolve('<spec>/package.json')`）、`:397`（`clientPath: join(dirname(pkgPath), clientRel)`） |
| 35 | 运行中的服务确实在发这份 bundle | `curl -s -o /tmp/btw-client.js -w '%{http_code} %{size_download}' 'http://127.0.0.1:3080/plugins/@local/dsh-btw/client.js'` → `200 361702`，md5 = `6c29b98b…`（路由：`dsh-client-modules/lib/index.js:155,466-500`，`?rev=<sha1-12>`） |
| 36 | **改客户端只需重建产物 + 覆盖 profile 副本，浏览器会自动热重载该插件模块**（无需刷新页面、无需重启 dsh） | host 半：`dsh-client-hmr/lib/index.js:28`（`pollIntervalMs` 默认 500）、`:78-91`（stat 轮询 mtime/size）、`:104-114`（`:107` `setInterval(pollWatches, pollIntervalMs)`）、`:145-152`（`/plugins/events` SSE 推 `rebuilt`）；`dsh-client-modules/lib/index.js:325-336`（`rebuilt(id)` 重新 sha1 并更新 graph，`:328` 重算 rev、`:330` 换 graphRow）；浏览器半：`dsh-client-hmr/lib/client.js:38-56`（`invalidate` + `refresh` 热换 fiber）、`:80-84`、`:27-29`（同时移除旧的 `<style data-plugin>` 注入） |
| 37 | **不重建/不拷贝 = 不生效**：只改 `dsh-btw/lib/` 不会被服务（§34 解析路径指向 profile 副本） | 由 33-35 推得 |
| 38 | 当前没有 DSH 侧 dev 构建流水线在跑（无 `pnpm run dev:web`/vite/tsdown watcher），故生效链路只依赖上条 client-hmr 轮询 | `ps aux` 仅见 `node …/bin/dsh web`（PID 2649213）与父 `dsh-restart.sh --yes` |
| 39 | host 半（`lib/index.js`）变更不在 client-hmr 覆盖面内 ⇒ 需重启 dsh；`dsh-restart.sh --watch` 默认监视 `~/.dsh/profiles/node_modules/@local`（宿主 lib） | `docs/architecture/04-ops-deploy.md:125`；`dsh-client-hmr/lib/index.js:94-102`（只 watch `clientPath`） |
| 40 | **测试面缺口**：`tests/side-chat-surface.spec.tsx`（699 行）里 `question`/`pendingQuestion` 出现 0 次 ⇒ `QuestionCard` 的草稿生命周期**无任何单测覆盖**，这是该回归能上线的直接原因 | `grep -n question tests/side-chat-surface.spec.tsx` → 空；`grep -rln "pendingQuestion\|QuestionCard" tests/` 不含该文件 |

---

## 4) 未验证项（含如何实测）

1. **浏览器端「点击—持久性」的端到端断言**（唯一能 100% 闭环的一步；静态证据已足够指向结论，但按纪律列为待实测）
   - 触发一个真实 `btw_ask_user` 后，用 Playwright（`/home/CNS2026495165/playwright_scratch/node_modules`）打开 `http://127.0.0.1:3080`，展开 btw 抽屉，点击某选项，然后以 50 ms 采样 3 s：
     - `document.querySelectorAll('[data-dsh-btw-root] button[aria-pressed="true"]').length`
     - 该按钮 `className` 是否持续含 `SalQ5q_questionOptionActive`
   - 期望（根因成立）：`aria-pressed="true"` 在点击后**短暂为 1**，随后在 ≤ ~250 ms 内回落为 0；className 同步回退。
   - 反证条件：若 `aria-pressed="true"` 能稳定保持 > 3 s，则根因不成立，须回到 §3.4 复查点击链路。
2. **hover 掩蔽效应的视觉确认**：§3.5-27 表明选中态可感知（1.32 / 边框 3.76），但「hover 底色与选中底色几乎同值」会让鼠标点击时观感更弱。需要像素级截图对比（hover-only vs active）来定量确认，而非仅凭合成计算。
3. **`<720px` bottom-sheet 模式下的点击不被 scrim 吞**：静态结论是「不吞」（§3.4-21），但该分支需在窄视口实测一次（scrim 在 bottom-sheet 下 `display:block`）。
4. **本轮 client.js 同步到 profile 的**确切**执行者/命令**：我确认了「工作区与 profile 两份同字节、mtime 纳秒级相同、目录 mtime 更早 ⇒ 是就地覆盖写（而非新建/改目录项），且只有 client.js 被同步（其余 host 产物仍是 9-18 版本）」，但**没有在仓库里找到执行该同步的脚本**（`grep -rln "profiles/node_modules/@local"` 命中的都是 docs/reports）。⇒ 部署命令需由审计 C 或执行档从 `.workspace` 历史记录/runbook 中钉死，不要凭猜。
5. **回答后再次提问**（questionId 变化 → 卡片应以新空草稿重挂）与 **phase→error 再回 open** 的重挂路径未实测；修复后建议补一条回归（见 §6 验收）。

---

## 5) 对根因的置信度

| 环节 | 置信度 | 依据 |
|---|---|---|
| `pendingQuestion.questions` 每次 read/轮询都是**新数组** | **~99%（已验证事实）** | 跨 JSON RPC（`dsh-api-gateway/lib/client.js:243`）+ 客户端严格 codec `schema.parse`（`:251,417-424`）+ zod 4.6.2 实测身份不保持（§3.1-5） |
| 该 effect 因此**每次 poll 重跑**并把 `selected` 清空 | **~97%（高置信推断）** | 依赖数组字面量（`SideChatSurface.tsx:74-79`）+ React `Object.is` 逐项比较语义 + 父层确实在每次 publish 后重渲染下发新对象（`:235,:586`）。唯一未做的是一次真机观测（§4-1） |
| 重置频率 ≈ **220 ms**（不是 700 ms） | **~90%（高置信推断）** | `running = childRunning||queued`（`host:550,590`）+ `AgentStatus` 仅 idle/running 且 running 覆盖整回合（`runtime-types.d.ts:39-44`）+ `btw_ask_user` 是回合内 await（`host:966-993`）。若某实现细节让 `running` 在等待期变假，则频率降为 700 ms——**结论不变，只是从「几乎无变化」变成「闪一下」** |
| 「不是 CSS 不可见、不是点击被吞、不是重挂载丢失」 | **~95%（已验证事实/静态排除）** | §3.5-25/27（类名与对比度实测）、§3.4（无禁用/无拦截/无遮挡）、§3.3-16（getSnapshot 均稳定、无重挂载触发点） |
| 与主代理假设 1/2 的关系 | **一致，且被加强** | 未发现替代机制；唯一补充是「严格 codec 的 zod 重建」这一层——即使将来把 RPC 改成同进程直调，只要 codec 是 `strict` 就仍会重建，所以修复必须落在**客户端依赖身份**上，而不是尝试在 host 保住对象引用 |

---

## 6) 修复方向选项（不写实现代码）

> 前提：两阶段纪律下先修「持久性」，再谈「观感对齐」。持久性不修，任何观感对齐都无法验证。

### 选项 A（最小改动，推荐）

**思路**：让草稿的生命周期锚定在**唯一的稳定身份**上，而不是易变数组身份。

- A1：把 `QuestionCard` 的重置 effect 去掉，改为在调用点用 `key={pendingQuestion.questionId}` 让「换题=重挂=干净初始化」（`SideChatSurface.tsx:586`）。这正是官方插件的做法：官方用 `key={question.key}` 重挂 `QuestionFlow`，且 `QuestionFlow` **没有任何重置 effect**（`…/dsh-client-ui-user-questions/lib/client.js:349-356,360-370`）——因而这同时是「与主会话一致」的最小落地。
- A2（等价）：保留 effect 但把依赖收窄为 `[pendingQuestion.questionId]`。身份成立性有代码依据：host 每次提问 `const questionId = randomUUID()`（`src/host/side-chat-service.ts:967`），且拒绝并发第二个问题（`:962-964`）⇒ 同一 `questionId` 不会被复用于另一组问题。

- 影响面：仅 `dsh-btw/src/client/SideChatSurface.tsx`（1 处调用点 ± 1 个 effect）；CSS/结构/视觉零改动；host 与 wire 契约零改动。
- 风险：
  - A2 依赖「questionId 永不复用」这一 host 不变量（当前成立，但属于隐式契约）；A1 用重挂消除该依赖，更稳，**建议 A1**。
  - 重挂会丢弃「用户已输入的自定义文本」，但那只在**换题**时发生，语义正确（换题本应重来）。
  - 需同步重建 `lib/client.js` 并覆盖 profile 副本（§3.6-36/37），否则页面毫无变化。

### 选项 B（中等，不推荐优先）

**思路**：把 `drafts` 提升到 controller/view-store，按 `questionId` 归档，使任何重渲染都无法清除。
- 影响面：controller 或 view-store 新增状态、`QuestionCard` 改为受控；测试面需新增 spec。
- 风险：状态面扩大（多会话/park-restore 时草稿要不要随 `parkedByParent` 走？），收益与 A 等价但 diff 大得多；仅在 A 的 `key` 方案被发现与重挂语义冲突时才考虑。

### 选项 C（结构性，需审计 B 的裁决）

**思路**：直接复用官方 `QuestionComposer`/`QuestionFlow` 以达成「与主会话完全一致」。
- 已知阻塞（本轮已读到的硬约束，供审计 B 参考）：
  - 通道不同：btw 显式排除官方 `ask_user_question` 并自带 `btw_ask_user`（`src/shared/tool-policy.ts:36,43`；`src/host/side-chat-service.ts:905`），官方组件消费的是官方 pending-question carrier（`QuestionComposer(props.matched)`）。
  - 形态不同：官方卡片是 **composer 座位**的对话内容宽度卡片（`.frame`/`.card`，`max-height:min(60vh,520px)`，`…/client.js:233`），嵌进 `overflow:hidden` 的抽屉（`side-chat.module.css:40-67`）意味着布局语义要重构。
  - 复用面：官方包对外只暴露 slot 注册（`QuestionComposer` 非公开导出面），复用可能需非公开路径。
- 风险：高（跨包私有 API、布局重构、双通道语义对齐）；收益主要在「外观/ARIA 完全一致」，与用户当前诉求（点了要留住）无直接关系。

### 选项 D（正交的小步对齐，建议在 A 之后紧随）

- 语义：`aria-pressed` + `role="group"/"radiogroup"` 的组合不符合 ARIA 单选语义；官方用 `role="radio"|"checkbox"` + `aria-checked`（官方 `…/client.js:531`）。
- 视觉：用 `--dsw-alias-*` token 取代硬编码 `#b7e85b`（`side-chat.module.css:327,340,348`）；可加勾选 glyph；可选「一题一屏 + 进度」。这些是「和主会话一致」的真正差距项，但**必须在 A 之后再动**。

### 修复后的验收（交给执行档）

1. `cd /home/CNS2026495165/dsh/dsh-btw && pnpm run build` → `cp lib/client.js ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js`
2. 观察 `window.__DSH_HMR__.rebuilds` 自增（`dsh-client-hmr/lib/client.js:61-76`）确认热重载发生；必要时刷新页面。
3. Playwright 断言：点击选项后 3 s 内 `aria-pressed="true"` 与 `SalQ5q_questionOptionActive` **持续保持**；再点第二个选项（单选场景）能正确切换。
4. 补一条单测填 §3.6-40 的覆盖缺口：给定「同一 `questionId`、`questions` 为**新数组**」的 props 连续重渲染，断言 `selected` 不被清空。
