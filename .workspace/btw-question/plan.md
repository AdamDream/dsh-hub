# btw 问答卡片：持久化修复 + 选项行向主会话对齐 —— 交付单元（执行档照此逐条落地）

> 用户裁决（2026-09-23）：范围 = **A. 修持久化 + 观感/语义向主会话对齐**；**卡片外壳保留 btw 绿色身份，只对齐选项行**；允许 headless E2E 实证（会新建临时会话）。
> 目标锚点：goal-6a07d6f5-5d69-40c0-8d7a-e0d9ac9f651a

## 0. 事实基线（三方审计 + 协调者实测，均为已验证）

**根因（审计 A，`.workspace/btw-question/audit-a-state.md`）**
- `dsh-btw/src/client/SideChatSurface.tsx:74-79` 的 `QuestionCard` 重置 effect 依赖 `[pendingQuestion.questionId, pendingQuestion.questions]`。
- `questions` 数组身份**每次 read 都会变**：跨 JSON RPC（`dsh-api-gateway/lib/client.js:243,251,417-424`）+ strict codec 每次 `schema.parse` 重建对象图（审计 A 用 zod 4.6.2 实测：两次 parse 身份不同）。
- `dsh-btw/src/client/controller.ts:723` 轮询间隔 `running ? 220 : 700`；`:738` 每次 publish 写入新 `pendingQuestion` ⇒ 提问待答期间 **每 ~220ms** 重跑该 effect ⇒ `setDrafts(全空)` ⇒ 点选被抹。
- **协调者独立 E2E 实测（修复前）**：点击后 `aria-pressed=true` 在 166/218ms 两个采样可见，**270ms 翻回 false**，`2/56` 采样为选中 ⇒ 正是「颜色闪一下就没」（证据：`.workspace/btw-question/e2e/2026-09-23T03-24-41-842Z-before.json` + 3 张 PNG）。
- 已排除：host 侧身份稳定（`host/side-chat-service.ts:585,594-595`）；点击链路无阻断；非重挂载；CSS 类与映射都在产物里（`lib/client.js:944,1020-1021,1337`）。

**官方参照物（审计 B + 协调者 E2E 实测）**
- 官方**零 `useEffect`**，靠 `key={question.key}` 重挂 + `useMemo(...,[props.matched])` 保住草稿（官方 `client.js:336-337,348-358`）⇒ **官方同款修法就是本修复的首选**。
- 官方组件**不可复用**（导出面/座位/通道三重封死）：`dsh-client-ui-user-questions/lib/client.js:730-732` 只导出 `PendingQuestion/apply/inject`；组件跑在 `conversation.composer`（chain/session），btw 在 `shell.overlay`（root，无 `useSession`）；btw 的 `btw_ask_user` 不产生 `question/requested` 帧。⇒ **不做结构性复用。**
- 实测参照（`.workspace/btw-question/e2e/2026-09-23T03-26-30-367Z-main-ref.json`）：选项 `role="radio"`、容器 `role="radiogroup"`、`aria-checked`；选中 = `.optionSelected` + `background: var(--dsw-alias-interactive-bg-hover)`（实测 `rgba(38,49,72,0.06)`）+ `border-color: var(--dsw-alias-border-l2)`（实测 `rgba(0,0,0,0.1)`）；序号徽标 `Mbwy4a_number` 文本 `1`/`2`；`min-height:40px`、`border-radius:12px`、`padding:8px 12px 8px 8px`。
- 官方 CSS 精确值（从产物提取）：`.option{min-height:40px;border:1px solid transparent;border-radius:12px;align-items:flex-start;gap:8px;padding:8px 12px 8px 8px;transition:background-color .12s,border-color .12s;display:flex;background:0 0}`、`.optionSelected{background:var(--dsw-alias-interactive-bg-hover)}`、`.optionSelected{border-color:var(--dsw-alias-border-l2)}`、`.optionLabel{font-size:14px;font-weight:500;line-height:24px}`、`.number{background:var(--dsw-alias-bg-overlay);width:20px;height:20px;color:var(--dsw-alias-label-secondary);border-radius:6px;flex:0 0 20px;place-items:center;margin-top:2px;font-size:12px;font-weight:500;line-height:18px;display:grid}`、`.checkbox{flex:0 0 20px;place-items:center;width:20px;height:20px;margin-top:2px;display:grid}`、`.checkbox:before{content:"";border:1px solid var(--dsw-alias-border-l4);border-radius:4px;grid-area:1/1;width:14px;height:14px;transition:background-color .12s,border-color .12s}`、`.checkbox>svg{grid-area:1/1}`、`.checkboxChecked{color:var(--dsw-alias-label-primary-foreground)}`、`.checkboxChecked:before{border-color:var(--dsw-alias-label-primary);background:var(--dsw-alias-label-primary)}`。

**部署链路（审计 C，`.workspace/btw-question/audit-c-docs-deploy.md` §3）**
- 部署位 `~/.dsh/profiles/node_modules/@local/dsh-btw` 是**实体拷贝（非符号链接）**；served 字节 == 部署位 == 仓库。
- 面别：本修复**只碰 `src/client/**` + tests + docs ⇒ 热面，不需要重启 dsh**（改 host/schema/`dsh.client`/remote 描述符才是冷面；本方案不动这些）。
- 构建：`cd /home/CNS2026495165/dsh/dsh-btw && pnpm build`（tsdown；**必须整包**，首 config `clean: true`，只 build client 会清掉宿主面产物）。
- 生效：只拷 `lib/`，然后刷新一次页面（插件 bundle 带 `cache-control: no-cache`，普通刷新即可；client-hmr 500ms stat 轮询可能已自动热重载）。

## 1. 交付单元（逐条实现，不得自行扩范围/重新拆解）

### U1 持久化根因修复（官方同款：稳定 key + 删掉重置 effect）
文件：`dsh-btw/src/client/SideChatSurface.tsx`
1. 删除 `QuestionCard` 内那段重置 `useEffect`（现 `:74-79`，body 为 `setDrafts(全空)` + `setError(null)`）。`useEffect` 在文件其它处仍在使用 ⇒ **不要删 import**。
2. `useState` 初值保持（`pendingQuestion.questions` → 空草稿 map）不变；这也让「换题=重挂=干净初始化」成立。
3. 调用点（现 `:585-587`）改为带稳定 key：
   `<QuestionCard key={pendingQuestion.questionId} pendingQuestion={state.pendingQuestion} controller={controller} t={t} />`
4. 语义验收：① 同一 `questionId`、`questions` 为新数组身份 ⇒ 草稿**不清**；② `questionId` 变化 ⇒ 重挂、草稿清空（由 U3 用例锁定）。

### U2 选项行观感/语义向官方对齐（P0 CSS + P1 结构）
文件：`dsh-btw/src/client/SideChatSurface.tsx`、`dsh-btw/src/client/side-chat.module.css:346-351`
1. **语义（当前 ARIA 结构不合法，必修）**：容器保持 `role={multi ? 'group' : 'radiogroup'}`；选项按钮改为
   `role={question.multi_select === true ? 'checkbox' : 'radio'}` + `aria-checked={active}`，**删除 `aria-pressed`**。
2. **结构**：选项行改为横向 `[前导标记][文案列]`，`align-items: flex-start; gap: 8px`：
   - 单选前导 = 序号徽标：`<span className={css.questionOptionIndex} aria-hidden="true">{index + 1}</span>`（用 `question.options.map((option, index) => ...)` 的下标）。
   - 多选前导 = 复选框：`<span className={active ? `${css.questionOptionCheck} ${css.questionOptionCheckChecked}` : css.questionOptionCheck} aria-hidden="true">{active && <IconCheckOutline14 size={12} />}</span>`（`IconCheckOutline14` 从 `@deepseek-ai/dsh-client-ui-primitives` 导入）。
   - 文案列：`<span className={css.questionOptionCopy}>` 包住 `questionOptionLabel` 与（可选的）`questionOptionDescription`，纵向排列。
   - **不要引入新依赖**（`clsx` 之类）；用模板字符串拼类名即可（与文件既有风格一致）。
3. **CSS（对齐官方实测值）**：
   ```css
   .questionOptions { display: flex; flex-direction: column; gap: 6px; }
   .questionOption, .questionOptionSelected { display: flex; flex-direction: row; align-items: flex-start; gap: 8px; width: 100%; min-height: 40px; padding: 8px 12px 8px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; text-align: left; transition: background-color .12s, border-color .12s; }
   .questionOption:hover:not(:disabled), .questionOptionSelected { background: var(--dsw-alias-interactive-bg-hover); }
   .questionOptionSelected { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); }
   .questionOptionIndex { flex: 0 0 20px; display: grid; place-items: center; width: 20px; height: 20px; margin-top: 2px; border-radius: 6px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 500; line-height: 18px; }
   .questionOptionCheck { flex: 0 0 20px; display: grid; place-items: center; width: 20px; height: 20px; margin-top: 2px; }
   .questionOptionCheck::before { content: ''; grid-area: 1 / 1; width: 14px; height: 14px; border: 1px solid var(--dsw-alias-border-l4); border-radius: 4px; transition: background-color .12s, border-color .12s; }
   .questionOptionCheck > svg { grid-area: 1 / 1; }
   .questionOptionCheckChecked { color: var(--dsw-alias-label-primary-foreground); }
   .questionOptionCheckChecked::before { border-color: var(--dsw-alias-label-primary); background: var(--dsw-alias-label-primary); }
   .questionOptionCopy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 3px; }
   .questionOptionLabel { font-size: 13px; font-weight: 500; line-height: 20px; }
   .questionOptionDescription { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
   ```
   并删除/替换旧的 `.questionOptionActive`（避免残留绿样式）。
4. **必须保持（用户裁决的边界）**：`.questionCard` 外壳（绿色描边、绿点脉冲、绿底）**原样不动**；`questionHint`、`questionInput`、`questionError`、显式「发送回答」提交按钮**都不动**。
5. **有意偏离（写进报告，不要"顺手对齐"）**：
   - 官方选项基态边框是 `transparent`，btw 保留 `--dsw-alias-border-l2`（抽屉底色近白，全透明会退化可辨识度）。
   - 官方单选**点击即提交**，btw 保留「点选 + 发送回答」显式提交（用户心智：先选后发；且 btw 卡片还带自定义输入）。
   - `questionOptions` 保持 `gap: 6px`（官方 1px 是 composer 尺度，抽屉内会过密）。
   - 不改字段名 `multi_select`（审计 B 明确建议否决改名）；不改「单选 + custom 时是否清空 selected」的答案编码语义（P2，未授权）。

### U3 回归测试（必须有，当前 QuestionCard 零覆盖）
文件：`dsh-btw/tests/side-chat-surface.spec.tsx`（复用既有 happy-dom + `currentSnapshot` + `createRoot`/`act` 机制，见 `:89-148`）
1. 在 primitives mock（`:11` 起）补 `IconCheckOutline14: () => <span data-icon="check" />`，否则渲染报错。
2. 新增用例（用 `currentSnapshot` 赋值 + `renderSurface()` 重新 render 模拟轮询）：
   - **C1 同 questionId + 新 questions 数组身份不清空**：快照含 `pendingQuestion`（单选，2 选项）→ render → 点第 1 个选项 → 断言 `aria-checked="true"` 且 class 含 `questionOptionSelected` → 用**内容相同但对象/数组全新建**的快照再 render → 断言仍 `aria-checked="true"`。（这条是本次缺陷的直接回归锁。）
   - **C2 questionId 变化重置**：换成新 `questionId` 的快照 render → 断言两个选项都是 `aria-checked="false"`。
   - **C3 单选互斥 / 多选累加**：单选点 1 再点 2 ⇒ 1 为 false、2 为 true；多选（`multi_select: true`）点 1 点 2 ⇒ 两者皆 true。
   - **C4 ARIA 结构合法**：单选容器 `role="radiogroup"` 且选项 `role="radio"`；多选选项 `role="checkbox"`；**断言不存在 `aria-pressed`**。
   - **C5 序号/复选框前导**：单选渲染序号文本 `1`/`2`；多选渲染 `.questionOptionCheck`（有无勾选图标随 aria-checked）。
   - 前导标记用 `aria-hidden` ⇒ 断言用 `querySelector` 而非 `getByRole`。
3. 验收命令：`cd /home/CNS2026495165/dsh/dsh-btw && npx vitest run tests/side-chat-surface.spec.tsx`，随后 `npx vitest run`（全量）+ `pnpm run typecheck` + `pnpm run lint`。
4. **口径纪律（notebook D11）**：btw vitest 存在**负载敏感 flake（已加固）**。若全量首跑出现非本用例失败，按既有加固纪律隔离复跑；**不得**写成"测试全绿"或"存在回归"。

### U4 构建 + 部署（热面，不重启）
1. 现场取 pre-image（notebook D4：既有备份 ≠ live）：
   `cp -a /home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-btw/lib /home/CNS2026495165/dsh/.workspace/btw-question/preimage-lib-<stamp>` 并 `sha256sum` 留证。
2. `cd /home/CNS2026495165/dsh/dsh-btw && pnpm build`（**整包**）。
3. 只拷 lib：`cp -a /home/CNS2026495165/dsh/dsh-btw/lib/. /home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-btw/lib/`
4. 核对 served 字节（**比对响应体 md5，不要去比 `?rev=`**）：`curl -s http://127.0.0.1:3080/plugins/@local/dsh-btw/client.js | md5sum` 必须等于 `md5sum /home/CNS2026495165/dsh/dsh-btw/lib/client.js`；记录体积与新 `?rev=`。
5. 不重启 dsh。E2E harness 每次冷启动新 context 即等价于"刷新一次"。

### U5 E2E 实证（修复前/后对照）
1. 更新 `.workspace/btw-question/e2e/repro-btw-question.mjs` 的采样口径：读 `aria-checked`（兼容 `aria-pressed` 回退），并把 `questionOptionSelected` 类一起记入样本；判定逻辑不变（全程 true = PERSISTED）。
2. 跑：`cd /home/CNS2026495165/dsh && timeout 420 node .workspace/btw-question/e2e/repro-btw-question.mjs --label after --hold-ms 3000`
   期望：`VERDICT=PERSISTED`、`onSampleRatio = N/N`、无 flip（对照修复前 `REVERTED firstOn=166ms firstOff=270ms`）。
3. 重跑一次主会话参照物（部署不影响它，但用于同批次并排对照）：`node .workspace/btw-question/e2e/compare-main-question.mjs --label main-ref2`
4. **目视核验**（用户纪律）：用 `analyze_image` 看 `*-after-*.png` 与 `*-main-ref2-*.png`，确认 ① 选中态在截图里可见；② 选项行现在有 1/2 序号徽标、选中底为中性灰蓝（不再是绿色）；③ 卡片外壳仍是 btw 绿色、没有观感退化；④ 与主会话官方卡片的选中底色/边框观感一致。把结论写进报告。
5. 产出：`e2e/*-after*.json/png` + `.workspace/btw-question/exec-report.md`。

### U6 文档同步（skill 强制项）
1. `docs/program-notebook.md` §7 已知缺陷表新增 **D29**（现象 / 根因 file:line / 状态=已修复 / 证据=E2E before/after 与 U3 用例）。表格现有最大编号 D28。
2. `docs/architecture/05-performance-and-ux-program.md`：§3 btw 批行（`:80`）里的 live 指纹 `6c29b98b645d`（361 702 B）→ **换成 U4 部署后实测的新值**；§7 地图行（`:158`）同步。
3. `docs/runbooks/verify-runbook.md`：`:18`（问题卡验收步）补"选中态可见且保持（≥3s 不回落）"判据；`:41`（反向提问排查）补一条"点了不留色 ⇒ 查 `QuestionCard` 草稿态是否被轮询重置"。
4. `FEATURE-MAP.md:25`（btw 行）补日期与本次口径。
5. 顺带修正既有漂移：`docs/architecture/04-ops-deploy.md:194` 的 btw 测试文件数 `24` → `25`。
6. 可选（若时间允许，且**必须标注未实测**）：在 notebook §7 增 D30 —— `btw_ask_user` 的 item schema 是 `additionalProperties:true`（`host/side-chat-service.ts:916`）而 read 结果走 `.strict()` codec（`remote-descriptors.ts:28-32`）⇒ 模型多带键（如 `detail`）会在 read 校验炸掉；机制已验证、后果未实测。
7. **禁止改 `dsh-btw/README*.md`**：`tests/sign-contract.spec.ts:120` 断言 README 原文串，改动会连带破测。

### U7 同档自复核（必须，产出裁决）
- 跑：目标测试 + 全量 vitest + typecheck + lint + build + 部署核对 curl + E2E（after）+ 截图目视。
- 对照目标/审计检查：未动 host/wire/schema/remote 描述符（保持热面）；未动 `.questionCard` 外壳；未回滚工作区既有未提交改动（drawer resize 批次：`SideChatDrawer.tsx`、`overlay-placement.ts`、`use-overlay-placement.ts`、`lib/client.js`、未跟踪的 `SideChatResizeHandle.tsx`/`drawer-size*.ts`）；`git status` 只新增预期文件。
- **不要 git commit**（工作区已有他人/前批未提交改动，提交决策留给用户）。
- 输出自裁决：**通过 / 返工**（返工要列问题清单），并把关键命令与原始输出摘要落盘到 `.workspace/btw-question/exec-report.md`。

## 2. 纪律
- 继承当前沙箱（workspace-write 及以上）；**禁止使用 `sandbox_permissions`**；不要 kill 任何用户进程、不要重启 dsh。
- 单元有歧义 ⇒ 上报主代理澄清，**不要自行拍板**；不要扩大范围（不做结构性复用、不改字段名、不改提交语义）。
- 报告用中文，结论与证据分离，禁止把未实测项写成已验证。
