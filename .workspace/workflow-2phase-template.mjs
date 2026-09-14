// ============================================================================
// workflow-2phase-template.mjs — 两阶段闭环编排模板（审计 → 修订执行复核一体）
// 方法论依据：~/.dsh/AGENTS.md §2（2026-09-12 用户裁决废止独立复核的三阶段流水线：
// 独立复核缺执行上下文、无意义重搜耗时；复核并入执行档一体完成）。
// 用法：复制本文件 → 替换 TASK 与两个 PROMPT → workflow 工具调用（script 参数=文件内容）。
// 规则：
//  - 各阶段统一显式路由 adam/deepseek-v4-flash（不依赖默认模型）。
//  - 磁盘是记忆，run 只是调度：阶段子代理把产物落盘，脚本只传路径与裁决摘要；
//    run 中断后从磁盘接力（子代理动手前核对文件现状）。
//  - schema 只允许 type/oneOf/properties/required/additionalProperties/items/enum/const
//    与 title/description/default/examples；其余关键字会致命报错。
//  - 修订执行复核档自裁决 rework = 业务裁决（不是调用失败），返回主代理裁决是否返工。
// ============================================================================

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

// 阶段一：审计（读真实代码 → 差距 → 修订方案 + 细粒度交付单元）
const auditSchema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['proceed', 'blocked'] },
    reason: { type: 'string' },
    reportPath: { type: 'string' },
  },
  required: ['verdict', 'reason', 'reportPath'],
  additionalProperties: false,
};

// 阶段二：修订执行复核一体（同一 agent：逐条落地 + 全量验证 + 自裁决 pass/rework）
const execReviewSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    verdict: { type: 'string', enum: ['pass', 'rework'] },
    reason: { type: 'string' },
    reportPath: { type: 'string' },
  },
  required: ['status', 'verdict', 'reason', 'reportPath'],
  additionalProperties: false,
};

// TASK：一句话目标（可判定完成）；AUDIT_PROMPT / EXEC_REVIEW_PROMPT 按任务改写。
const TASK = '示例任务：对 <目标> 做两阶段闭环。';

const AUDIT_PROMPT = `你是两阶段闭环的【审计】阶段子代理（路由 adam/deepseek-v4-flash）。只读审计 + 落盘报告，不改任何代码。
任务：${TASK}
必读：<真实代码路径 / 现状审计 / 方案契约>（先全部读完再动手）。
必须核实：<关键点清单，给文件:行号证据>。
产出：细粒度交付单元清单落盘 <报告路径>（每单元：编号、文件、函数/位置、改动内容、验收标准）。
返回：见 schema。不确定标「未确认」；禁止使用 sandbox_permissions。`;

const EXEC_REVIEW_PROMPT = `你是两阶段闭环的【修订执行复核一体】阶段子代理（路由 adam/deepseek-v4-flash）。
职责：严格按审计交付单元逐条落地代码，并在同一档内完成自复核——不另派独立复核 agent（用户已裁决废止，
独立复核缺执行上下文、无意义重搜耗时）。不做设计决策、不扩范围；单元歧义在报告里客观描述，能落地的照做。
必读：审计交付单元 <报告路径>（权威清单）、方案契约 <路径>。
执行：1) 动手前核对文件现状（git/磁盘，避免覆盖既有改动）；2) 逐条实现交付单元；
3) 补充/扩展测试（真实断言）；4) 全量验证 <验证命令，直接二进制>，预期全绿，失败都修到全绿。
5) 自复核（复核一体）：对照目标与审计结论检查遗漏与副作用，把自裁决（pass/rework + 问题清单）写入报告。
产出：执行+复核报告落盘 <报告路径>（逐单元状态、改动文件+关键行号、验证输出摘要、遗留问题、自裁决）。
返回：见 schema。约束：只改 <工作区目录> 内文件；不得改部署位；禁止使用 sandbox_permissions。`;

phase('审计');
log('阶段一：审计（读真实代码、出方案、拆交付单元）');
const audit = await callWithRetry(AUDIT_PROMPT, { provider: PROVIDER, model: MODEL, label: 'audit', phase: '审计', schema: auditSchema });
if (audit.__agentFailure) {
  return { phase: 'audit', failed: true, error: String(audit.error ?? ''), next: '主代理裁决：审计两次失败，检查报告是否部分落盘后决定重跑或人工接手' };
}
if (audit.verdict !== 'proceed') {
  return { phase: 'audit', verdict: String(audit.verdict ?? ''), reason: String(audit.reason ?? ''), reportPath: String(audit.reportPath ?? ''), next: '审计判定不进入执行（无需修改/否决），主代理裁决' };
}

phase('修订执行复核');
log('阶段二：修订执行复核一体（同一 agent 落地 + 全量验证 + 自裁决）');
const execReview = await callWithRetry(EXEC_REVIEW_PROMPT, { provider: PROVIDER, model: MODEL, label: 'exec-review', phase: '修订执行复核', schema: execReviewSchema });
if (execReview.__agentFailure) {
  return { phase: 'exec-review', failed: true, error: String(execReview.error ?? ''), next: '主代理裁决：执行档两次失败；检查产物与报告后从磁盘接力（不得因调用失败回滚已通过本地验证的实现）' };
}
return {
  audit: { verdict: String(audit.verdict ?? ''), reportPath: String(audit.reportPath ?? '') },
  execReview: { status: String(execReview.status ?? ''), verdict: String(execReview.verdict ?? ''), reason: String(execReview.reason ?? '').slice(0, 2500), reportPath: String(execReview.reportPath ?? '') },
  next: execReview.status === 'done' && execReview.verdict === 'pass'
    ? '进入部署阶段（主代理）：按执行档报告部署 + Runbook'
    : '执行档自裁决 rework/blocked：主代理据报告裁决返工或人工修补',
};
