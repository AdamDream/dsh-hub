const PROVIDER = 'adam';
const MODEL = 'deepseek-v4-flash';

async function callWithRetry(prompt, opts) {
  let first;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const value = await agent(prompt, { ...opts, label: `${opts.label}-attempt-${attempt + 1}` });
      if (value !== null) return value;
      first = 'agent returned null';
    } catch (error) {
      first = error instanceof Error ? error.message : String(error);
    }
  }
  return { __agentFailure: true, error: first ?? 'unknown agent failure' };
}

const auditSchema = { type: 'object', properties: { verdict: { type: 'string', enum: ['proceed', 'blocked'] }, reason: { type: 'string' }, reportPath: { type: 'string' } }, required: ['verdict', 'reason', 'reportPath'], additionalProperties: false };
const execSchema = { type: 'object', properties: { status: { type: 'string', enum: ['done', 'blocked'] }, reason: { type: 'string' }, reportPath: { type: 'string' } }, required: ['status', 'reason', 'reportPath'], additionalProperties: false };
const reviewSchema = { type: 'object', properties: { verdict: { type: 'string', enum: ['pass', 'rework'] }, findings: { type: 'string' }, reportPath: { type: 'string' } }, required: ['verdict', 'findings', 'reportPath'], additionalProperties: false };

const AUDIT_PROMPT = `你是 btw 插件升级 v2 三阶段闭环的【审计】阶段子代理（路由 adam/deepseek-v4-flash）。只读审计 + 落盘报告，不改任何代码。

任务：对照方案契约 v2 与真实代码，核实可行性，产出「修订后的实施方案 + 细粒度交付单元清单」（每单元：编号、文件、函数/位置、改动内容、验收标准），供执行阶段逐条落地。

必读输入（先全部读完再动手）：
- 方案契约 v2：/home/CNS2026495165/dsh/.workspace/reports/plans/btw/btw-upgrade-plan.md（裁决 R1-1..R1-10 与沿用项 R0-3/4/5，不得违背/重开）
- 现状审计：/home/CNS2026495165/dsh/.workspace/reports/audits/btw/btw-upgrade-audit.md（269 行，全部带文件:行号证据）
- 实测证据：/home/CNS2026495165/dsh/.workspace/reports/research/opencode-deepseek-v4-flash-probe.md（deepseek-v4.1-flash 实测可用 + 认证三头）、vision-flash-test.md、vision-exp-probe.md、glm53-flash-image-smoke.md
- 真实代码：/home/CNS2026495165/dsh/dsh-btw/（src/index.ts、src/host/side-chat-service.ts、src/host/btw-registry.ts、src/client/*、src/shared/remote.ts、src/remote-descriptors.ts、src/typert.host.ts、tests/、scripts/smoke-build.mjs、tsdown.config.ts）
- vision-adam 插件部署副本：~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js（只读分析；源已丢失）
- 官方包 lib（只读）：~/.dsh/profiles/web/node_modules/@deepseek-ai/ 下 dsh-llm / dsh-llm-deepseek / dsh-llm-pi-ai / dsh-subagent / dsh-agent-loop / dsh-host-apiproxy / dsh-attachment / dsh-session-query / dsh-client-runtime 等

必须核实并给文件:行号证据的关键点：
1. 主会话「图片→vision-adam 转文本」的 hook 点：读主会话用户消息进模型的完整链路（前端 session.prompt → host-apiproxy → agent-loop send/inbox → 下一轮 request），确认存在哪些可挂的宿主侧拦截点（消息事件、request 管线、pre-step、content 变换等）。明确结论：A) btw 插件宿主面可挂（给出具体 API/事件与改法）；或 B) 必须 patch 官方包（指出最小 patch 目标文件/函数/改法）。此结论决定 U-G 形态。
2. vision-adam 插件配置化改造规格：通读 lib/index.js，给出（a）当前 Config z.object 的确切字段与 settings 注册方式（installSection/命名空间、secretFields）；（b）当前如何取 API key 与认证（env/credentials/写死？给行号）；（c）图片请求构造与响应处理（含 reasoning_content 回退）；（d）配置化扩展的最小字段集（model/baseURL/apiKeyEnv/maxTokens/认证头）与向后兼容策略；（e）是否可导出可复用的 analyze 函数供 btw/主会话 import（node 解析从 @local/dsh-btw/lib 是否能 require 到 @deepseek-ai/dsh-vision-adam？给解析依据；不可行则 btw 内同款逻辑的落点建议）。
3. btw 图片链路细节：sendSideChatRequestSchema（remote.ts:93-97）加 image parts 的确切形状（对齐主壳 PromptContentPart，dsh-host-apiproxy sessions.d.ts:86-90）；transcript 图片引用的获取与渲染（attachments.saveImage 的调用/返回；客户端可显示的 URL 或 attachmentId 读取路由）；分析文本包装模板的最终措辞（按 R1-9）。
4. R2/R3 接线：host 新增 listTree/listProject 的 schema/descriptor(7到9)/typert members/client namespace/smoke 断言；枚举 API 精确签名（listDescendants、sessionQuery.listSessions、session/title 读取、最后消息预览读取）；跨会话跳转调用序列（sessions.open/openSubagent + handleSessionChange）。
5. 存量 typecheck 2 错（side-chat-service.ts:309/:799）的正确修法（读 modelSelection 定义与类型声明；类型标注/非空收窄，不改运行时语义）。
6. 测试策略：现有 tests/ 需扩展的最小集（图片 send、包装模板、分析失败报错、listTree/listProject、跳转状态）；哪些用 happy-dom、哪些纯逻辑。
7. 构建验证命令（本环境 pnpm 不可用，勿用）：node_modules/.bin 直接二进制（oxlint、tsc 三次、vitest run、tsdown、node scripts/smoke-build.mjs、publint --level error），在 /home/CNS2026495165/dsh/dsh-btw 下。

产出（必须）：
- 修订后的方案 + 细粒度交付单元清单，落盘 /home/CNS2026495165/dsh/.workspace/reports/audits/btw/btw-upgrade-impl-audit.md（每单元含验收标准与依赖；明确 U-G 是「btw 内实现」还是「官方包 patch 产物」并给证据；明确 U-H vision-adam 新 lib 的完整设计：字段、认证、导出、兼容）
- 返回结构化结论（见 schema）。

约束：只读真实代码；不确定标「未确认」；不写任何代码（报告除外）；你继承当前沙箱模式（可写 /home/CNS2026495165/dsh），禁止使用 sandbox_permissions。`;

const EXEC_BTW_PROMPT = `你是 btw 插件升级 v2 三阶段闭环的【修订并执行-btw】阶段子代理（路由 adam/deepseek-v4-flash）。职责：严格按审计交付单元中属于 dsh-btw 源码的部分逐条落地代码；不做设计决策、不扩范围、不自行拆解；单元歧义在报告里客观描述（不自行拍板），能落地的照做；若歧义阻塞核心流程，status=blocked 并说明。

必读输入：
- 审计交付单元：/home/CNS2026495165/dsh/.workspace/reports/audits/btw/btw-upgrade-impl-audit.md（权威清单；你只负责其中标为 dsh-btw 源码的部分，不含部署产物）
- 方案契约 v2：/home/CNS2026495165/dsh/.workspace/reports/plans/btw/btw-upgrade-plan.md（裁决 R1-1..R1-10，不得违背）
- 现状审计：/home/CNS2026495165/dsh/.workspace/reports/audits/btw/btw-upgrade-audit.md；实测：/home/CNS2026495165/dsh/.workspace/reports/research/opencode-deepseek-v4-flash-probe.md
- 代码：/home/CNS2026495165/dsh/dsh-btw/

执行要求：
1. 逐条实现审计报告中属于 dsh-btw 的交付单元（含存量 typecheck 2 错修复：side-chat-service.ts:309/:799）。核心：图片 send 协议（client 到 host 传图片 parts）、host 同步调 vision-adam 转文本（机制按审计 U-H/U-B 设计；若审计确定 btw 内需同款分析逻辑，严格按审计给的请求/认证/包装规格实现，配置源=settings vision-adam 段）、R1-9 模板包装、分析失败报错不发送、transcript 图片块渲染、client onPaste+迷你附件轨+viewStore images+loading/错误态、listTree/listProject remote 接线（descriptor/typert/remote/smoke 断言 7 到 9）、抽屉列表 UI+项目全部 tab+跳转、主会话 hook（若审计判定 U-G 属 btw 内实现则一并落地；若判定为官方包 patch 则不做、留给 patches 线）。
2. 补充/扩展测试（审计指定最小集），测试须真实断言。
3. 全量验证（在 /home/CNS2026495165/dsh/dsh-btw，直接二进制，不要用 pnpm）：
   node_modules/.bin/oxlint src tests tsdown.config.ts vitest.config.ts && node_modules/.bin/tsc -p tsconfig.json && node_modules/.bin/tsc -p tsconfig.client.json && node_modules/.bin/tsc -p tsconfig.tests.json && node_modules/.bin/vitest run && node_modules/.bin/tsdown && node scripts/smoke-build.mjs && node_modules/.bin/publint --level error
   预期全绿；失败先区分「你的改动引入」与「存量问题」，都要修到全绿。
4. 范围红线：只改 /home/CNS2026495165/dsh/dsh-btw/ 内文件；不得改 ~/.dsh 下任何文件、不得拷贝部署产物、不得重启进程；禁止使用 sandbox_permissions。
5. 产出执行报告 /home/CNS2026495165/dsh/.workspace/reports/execs/btw/btw-upgrade-impl-exec.md：逐单元状态（done/部分/跳过+理由）、改动文件+关键行号、验证输出摘要（vitest 总数/通过数）、遗留问题。
6. 返回结构化结论（见 schema）。

约束：忠实执行单元清单；不夹带私货；发现单元与契约冲突在报告标注（不擅自改契约）。`;

const EXEC_PATCHES_PROMPT = `你是 btw 插件升级 v2 三阶段闭环的【修订并执行-部署产物】阶段子代理（路由 adam/deepseek-v4-flash）。职责：按审计交付单元中属于「部署产物」的部分，在工作区内产出可交付文件（部署位 ~/.dsh 在工作区外，由主代理部署期应用）。不做设计决策、不扩范围。

必读输入：
- 审计交付单元：/home/CNS2026495165/dsh/.workspace/reports/audits/btw/btw-upgrade-impl-audit.md（其中 U-H vision-adam 配置化新 lib 的完整设计、以及 U-G 若审计判定「官方包 patch」时的补丁规格，是本线权威）
- 方案契约 v2：/home/CNS2026495165/dsh/.workspace/reports/plans/btw/btw-upgrade-plan.md（R1-4/R1-5/R1-9）
- 实测证据：/home/CNS2026495165/dsh/.workspace/reports/research/opencode-deepseek-v4-flash-probe.md（模型 deepseek-v4.1-flash、认证三头、请求格式）
- 现插件副本（只读参考）：~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js 与 package.json

产出（全部落在 /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy/ 下）：
1. vision-adam 配置化新 lib：.workspace/workstreams/deploy/deploy/vision-adam/lib/index.js —— 严格按审计 U-H 设计实现（Config 扩展 model/baseURL/apiKeyEnv/maxTokens/认证头，默认 model=deepseek-v4.1-flash、baseURL=https://opencode.ai/zen/go/v1、apiKeyEnv=OPENCODE_GO_API_KEY；认证三头 authorization Bearer + x-api-key 同 key + x-opencode-session 随机 UUID；保留 analyze_image 工具注册与现有调用方兼容；若审计要求则导出可复用 analyze 函数）；同目录放变更说明 .workspace/workstreams/deploy/deploy/vision-adam/CHANGES.md。用 node --check 验证语法（若因 ESM 无法 --check，用 node -e 动态 import 前先说明风险或跳过并记录）。
2. 若审计判定 U-G 需「官方包 patch」：产出补丁文件到 .workspace/workstreams/deploy/deploy/patches/（被改文件的新版本或 unified diff，标明目标绝对路径与备份/应用步骤），对象为 dsh-agent-loop 或 dsh-host-apiproxy 的消息管线最小改动；若审计判定 U-G 属 btw 内实现，则本线跳过此项并在报告注明。
3. settings.yaml 的 vision-adam 段最终形态：.workspace/workstreams/deploy/deploy/settings-vision-adam.snippet.yaml（含注释，兼容旧键）。
4. 产出执行报告 /home/CNS2026495165/dsh/.workspace/reports/execs/btw/btw-upgrade-impl-exec-patches.md：产物清单+路径、与审计 U-H/U-G 规格的逐条对应、node --check 结果、已知风险（如现有调用方兼容点）。
5. 返回结构化结论（见 schema）。

约束：只写 /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy/ 与报告文件（工作区内）；不得改 ~/.dsh 任何文件；禁止使用 sandbox_permissions。`;

const REVIEW_PROMPT = `你是 btw 插件升级 v2 三阶段闭环的【复核】阶段子代理（路由 adam/deepseek-v4-flash）。职责：对照「方案契约 v2 + 审计交付单元 + 两条执行报告 + 真实代码与产物」，逐项复核达标、遗漏与副作用，给 通过/返工。

必读输入：
- 方案契约 v2：/home/CNS2026495165/dsh/.workspace/reports/plans/btw/btw-upgrade-plan.md
- 审计交付单元：/home/CNS2026495165/dsh/.workspace/reports/audits/btw/btw-upgrade-impl-audit.md
- 执行报告：/home/CNS2026495165/dsh/.workspace/reports/execs/btw/btw-upgrade-impl-exec.md 与 /home/CNS2026495165/dsh/.workspace/reports/execs/btw/btw-upgrade-impl-exec-patches.md
- 真实代码：/home/CNS2026495165/dsh/dsh-btw/（逐单元核对；工作区根有 git 则用 git -C /home/CNS2026495165/dsh status/diff 查看）；部署产物：/home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy/

复核清单：
1. 每个交付单元验收标准是否达成（读真实代码核对，不信报告声称）。
2. 与裁决 R1-1..R1-10/R0-3/4/5 的一致性：图片宿主侧转文本+包装模板、同步+失败报错不发送、转录原图+分析文本、选择器保持三选项、主会话 hook 或补丁产物符合审计结论、vision-adam 配置化产物符合 U-H 设计（默认 deepseek-v4.1-flash + opencode + 认证三头）、跳转列表与项目总览。
3. 副作用与遗漏：协议向后兼容、smoke 断言数（7 到 9）、typecheck 全绿、既有测试未破坏、lib 产物生成成功、部署产物可应用（补丁目标路径/备份步骤完整、settings 片段合法 YAML 且与插件 Config 匹配）。
4. 独立重跑全量验证（直接二进制，不要 pnpm）：
   cd /home/CNS2026495165/dsh/dsh-btw && node_modules/.bin/oxlint src tests tsdown.config.ts vitest.config.ts && node_modules/.bin/tsc -p tsconfig.json && node_modules/.bin/tsc -p tsconfig.client.json && node_modules/.bin/tsc -p tsconfig.tests.json && node_modules/.bin/vitest run && node_modules/.bin/tsdown && node scripts/smoke-build.mjs && node_modules/.bin/publint --level error
5. 产出复核报告 /home/CNS2026495165/dsh/.workspace/btw-upgrade-impl-review.md：逐单元 通过/返工 + 问题清单（位置/性质/建议修法）。
6. 返回结构化结论（见 schema）：verdict=pass 或 rework（findings 列出必须返工的问题）。

约束：只读代码与报告（复核报告本身除外）；禁止使用 sandbox_permissions。`;

phase('审计');
log('审计阶段：核实主会话 hook 可行性、vision-adam 改造规格，产出交付单元');
const audit = await callWithRetry(AUDIT_PROMPT, { provider: PROVIDER, model: MODEL, label: 'audit-v2', phase: '审计', schema: auditSchema });
if (audit.__agentFailure) {
  return { phase: 'audit', failed: true, error: String(audit.error ?? ''), next: '主代理裁决：审计两次失败，检查 .workspace/reports/audits/btw/btw-upgrade-impl-audit.md 是否部分落盘后决定重跑或人工接手' };
}
if (audit.verdict !== 'proceed') {
  return { phase: 'audit', verdict: String(audit.verdict ?? ''), reason: String(audit.reason ?? ''), reportPath: String(audit.reportPath ?? ''), next: '审计判定不进入执行，主代理裁决' };
}

phase('修订并执行');
log('修订并执行阶段：双线并行（btw 源码 / 部署产物）');
const [execBtw, execPatches] = await parallel([
  () => callWithRetry(EXEC_BTW_PROMPT, { provider: PROVIDER, model: MODEL, label: 'exec-btw', phase: '修订并执行', schema: execSchema }),
  () => callWithRetry(EXEC_PATCHES_PROMPT, { provider: PROVIDER, model: MODEL, label: 'exec-patches', phase: '修订并执行', schema: execSchema }),
]);
if (execBtw.__agentFailure || execPatches.__agentFailure || execBtw.status !== 'done' || execPatches.status !== 'done') {
  return {
    phase: 'execute',
    btw: execBtw.__agentFailure ? { failed: true, error: String(execBtw.error ?? '') } : { status: String(execBtw.status ?? ''), reason: String(execBtw.reason ?? ''), reportPath: String(execBtw.reportPath ?? '') },
    patches: execPatches.__agentFailure ? { failed: true, error: String(execPatches.error ?? '') } : { status: String(execPatches.status ?? ''), reason: String(execPatches.reason ?? ''), reportPath: String(execPatches.reportPath ?? '') },
    next: '主代理裁决：执行未全绿，检查两份 exec 报告与 git diff 后决定续接',
  };
}

phase('复核');
log('复核阶段：对照契约与交付单元复核实现与产物');
const review = await callWithRetry(REVIEW_PROMPT, { provider: PROVIDER, model: MODEL, label: 'review-v2', phase: '复核', schema: reviewSchema });
if (review.__agentFailure) {
  return { phase: 'review', failed: true, error: String(review.error ?? ''), next: '主代理裁决：复核两次失败；实现已落盘且执行阶段已本地验证，不因复核调用失败回滚，据 exec 报告人工复核' };
}
return {
  audit: { verdict: String(audit.verdict ?? ''), reportPath: String(audit.reportPath ?? '') },
  execute: {
    btw: { status: String(execBtw.status ?? ''), reportPath: String(execBtw.reportPath ?? '') },
    patches: { status: String(execPatches.status ?? ''), reportPath: String(execPatches.reportPath ?? '') },
  },
  review: { verdict: String(review.verdict ?? ''), findings: String(review.findings ?? '').slice(0, 2500), reportPath: String(review.reportPath ?? '') },
  next: review.verdict === 'pass' ? '进入部署阶段（主代理）：备份并替换 vision-adam lib + settings.yaml vision-adam 段 + 拷 btw lib 到 @local + 若产出官方补丁则备份并应用 + 交付重启验证 Runbook' : '复核返工：主代理据 findings 决定返工或人工修补',
};
