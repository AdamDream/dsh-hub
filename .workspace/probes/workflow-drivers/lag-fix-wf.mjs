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

const AUDIT_PROMPT = `你是「subagent 多开卡顿修复」三阶段闭环的【审计】阶段子代理（路由 adam/deepseek-v4-flash）。只读审计 + 落盘报告，不改任何代码。

任务：基于已完成的机制审计与差异审计，核实修复方案在真实盘面上的可行性，产出「细粒度交付单元清单」（每单元：编号、文件、函数/位置、改动内容、验收标准），供执行阶段逐条落地。已由用户裁决（不得重开）：① 恢复 3 个丢失的本地补丁；② 加固 apiproxy SSE mux 会话级订阅过滤 + FrameQueue 有界化（溢出策略=丢最旧帧保 UI 响应）；③ 写重放脚本固化（防重装再清除）；④ adam deepseek-v4-flash 与 opencode deepseek-v4.1-flash 的 token 上限全部调为 990000（0.99M），避免输出截断。

必读输入（先全部读完再动手）：
- 机制审计：/home/CNS2026495165/dsh/.workspace/reports/audits/lagfix/lag-audit-mechanism.md（驱动=in-process、因果链、L3556-3574 mux 与 L1095-1127 FrameQueue 证据、修复点 §5-6）
- 差异审计：/home/CNS2026495165/dsh/.workspace/reports/audits/lagfix/lag-audit-diff.md（回退完整、3 个丢失补丁清单与 tgz 位置、cordis.patch.yml 残留 disabled 条目）
- ②b 补丁权威记录：/home/CNS2026495165/dsh/.workspace/reports/execs/subagent/execution-2b.md（两行改动的精确语义与复核 PASS）
- 补丁源：~/dsh-upgrade-backup/patched-official-files.tgz（含 3 个补丁文件，解包到工作区临时目录只读核对，勿改原 tgz）
- live 全局树（当前实际运行底座，全部 0.1.1-rc.2 原厂）：
  ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js（②b 落点）
  ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-subagent/lib/client.js（tok/s 落点）
  ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-search-deepseek/lib/index.js（x-opencode-session 落点）
  ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js（加固落点，mux L3556-3574、FrameQueue L1095-1127）
- 配置：~/.dsh/settings.yaml（adam provider 的 models 段——deepseek-v4-flash 的 maxTokens 现值；vision-adam 段——model/baseURL/apiKeyEnv/maxTokens 现值）；以及已产出的 vision-adam 新 lib：/home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy/vision-adam/lib/index.js 与其 settings 片段 .workspace/workstreams/deploy/deploy/settings-vision-adam.snippet.yaml（默认 maxTokens=2000）

必须核实并给证据（文件:行号/路径）：
1. tgz 内 3 个补丁文件的确切内容与目标路径；与 ../../reports/execs/subagent/.workspace/reports/execs/subagent/execution-2b.md 描述的 ②b 改动是否一致（解包后 diff 核对）；与 live 原厂文件是否可干净合并（补丁上下文匹配或需重新锚定——给结论）。
2. 加固设计（读 live host-apiproxy 真实代码）：
   (a) mux L3556-3574：当前如何把各会话事件广播给浏览器（找出会话关联字段、SSE 目标集合构造）；会话级订阅过滤的最小改动点（精确行号与改法建议：按什么键过滤、订阅集合从哪来、无订阅时的行为）。
   (b) FrameQueue L1095-1127：队列结构、生产/消费路径；有界化的最小改动（上限建议值、丢最旧帧的实现点——给出具体函数与行号）。
   注意：加固改动必须不破坏主会话打字机流式与 btw 侧聊（depth=0 正常 chunk 流）。
3. settings 变更规格：settings.yaml 中 adam provider models 段 deepseek-v4-flash 的 maxTokens 当前值与确切键路径；vision-adam 段当前值与确切键路径；改为 990000 的最小片段；与已产出 vision-adam 新 lib/settings 片段的合并方式（lib 默认 2000 不动，settings 优先）。
4. 重放脚本规格：脚本应含 备份（cp -r/时间戳后缀）、应用（cp 或 patch）、校验（grep 锚点/node --check/字节比对）、幂等（已应用则跳过并提示）、dry-run 模式；覆盖 3 补丁恢复 + 2 处加固 + settings 片段写入；目标路径用 live 全局树；脚本放工作区 .workspace/workstreams/deploy/deploy-lag/。
5. 验证命令清单（本环境 pnpm 不可用）：node --check、grep -n 锚点、diff/cmp 字节比对、node -e yaml 解析（settings 片段）、脚本 bash -n 语法检查。
6. 风险：任何 global 重装再抹补丁（脚本固化缓解）；宿主侧改动需重启 DSH 生效；加固对现有浏览器会话的兼容。

产出（必须）：
- 细粒度交付单元清单落盘 /home/CNS2026495165/dsh/.workspace/reports/audits/lagfix/lag-fix-audit.md（每单元：编号 U-1..U-N、目标文件、精确改动、验收标准；含 tgz 补丁与 live 文件的合并方式结论、mux/FrameQueue 精确改法、settings 片段、重放脚本规格）
- 返回结构化结论（见 schema）。

约束：只读真实代码；不确定标「未确认」；不写任何代码（报告除外；tgz 解包到工作区临时目录做只读核对可以）；你继承当前沙箱模式（可写 /home/CNS2026495165/dsh），禁止使用 sandbox_permissions。`;

const EXEC_PROMPT = `你是「subagent 多开卡顿修复」三阶段闭环的【修订并执行】阶段子代理（路由 adam/deepseek-v4-flash）。职责：严格按审计交付单元产出全部修复产物到工作区 .workspace/workstreams/deploy/deploy-lag/（部署位在 ~/.npm-global 全局树与 ~/.dsh/settings.yaml，属工作区外，由主代理部署期应用——你只产出文件与脚本，不改部署位）。不做设计决策、不扩范围；单元歧义在报告里客观描述，能落地的照做。

必读输入：
- 审计交付单元（权威）：/home/CNS2026495165/dsh/.workspace/reports/audits/lagfix/lag-fix-audit.md
- 机制审计 / 差异审计：/home/CNS2026495165/dsh/.workspace/reports/audits/lagfix/lag-audit-mechanism.md、lag-audit-diff.md；②b 记录：/home/CNS2026495165/dsh/.workspace/reports/execs/subagent/execution-2b.md
- 补丁源：~/dsh-upgrade-backup/patched-official-files.tgz；live 原厂文件参考：~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/{dsh-agent-loop,dsh-client-ui-subagent,dsh-web-search-deepseek,dsh-host-apiproxy}/lib/…；settings 参考：~/.dsh/settings.yaml（只读）

产出（全部落在 /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-lag/ 下）：
1. restore/ 目录：3 个补丁文件恢复后的完整文件副本（从 tgz 提取并按其原始改动语义落成最终形态；与审计给的合并方式一致），命名清晰（如 agent-loop.lib.index.js、client-ui-subagent.client.js、web-search-deepseek.index.js）。
2. hardening/ 目录：加固后的 host-apiproxy lib/index.js 完整副本（mux 会话级订阅过滤 + FrameQueue 有界丢最旧帧，严格按审计精确改法），以及同目录放一份改法说明（锚点行号、改动前后片段）。
3. settings/ 目录：settings.yaml 的修改片段（含注释）：adam provider models 段 deepseek-v4-flash maxTokens=990000；vision-adam 段 model=deepseek-v4.1-flash、baseURL=https://opencode.ai/zen/go/v1、apiKeyEnv=OPENCODE_GO_API_KEY、maxTokens=990000（与已产出的 .workspace/workstreams/deploy/deploy/settings-vision-adam.snippet.yaml 合并，lib 默认值 2000 不动、settings 优先）；给出「替换到 settings.yaml 的精确 diff 或完整新段」。
4. replay-lag-fix.sh：重放脚本（按审计规格：备份/应用/校验/幂等/dry-run；目标路径=live 全局树与 settings.yaml；覆盖 3 补丁+2 加固+settings 段）。脚本 chmod +x，bash -n 通过。
5. 执行报告 /home/CNS2026495165/dsh/.workspace/reports/execs/lagfix/lag-fix-exec.md：产物清单+路径、逐单元状态、每项验证结果（node --check、grep 锚点、与 tgz 补丁字节一致、yaml 解析、bash -n）、遗留问题。
6. 返回结构化结论（见 schema）。

验证要求（全在工作区产物上做，不碰部署位）：
- 3 个恢复文件与 tgz 补丁语义一致（diff 核对改动点与 ../../reports/execs/subagent/.workspace/reports/execs/subagent/execution-2b.md 描述吻合）；
- hardening 副本 node --check 通过、锚点 grep 命中、改动仅限审计指定函数；
- settings 片段 yaml.safe_load 解析通过；
- 脚本 bash -n 通过。

约束：只写 /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-lag/ 与报告文件；不得改 ~/.npm-global 与 ~/.dsh 任何文件；禁止使用 sandbox_permissions。`;

const REVIEW_PROMPT = `你是「subagent 多开卡顿修复」三阶段闭环的【复核】阶段子代理（路由 adam/deepseek-v4-flash）。职责：对照「审计交付单元 + 执行报告 + 工作区产物 + live 原厂文件」，逐项复核达标、遗漏与副作用，给 通过/返工。

必读输入：
- 审计交付单元：/home/CNS2026495165/dsh/.workspace/reports/audits/lagfix/lag-fix-audit.md
- 执行报告：/home/CNS2026495165/dsh/.workspace/reports/execs/lagfix/lag-fix-exec.md
- 产物：/home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-lag/（restore/ hardening/ settings/ replay-lag-fix.sh）
- live 原厂文件（只读对照）：~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/{dsh-agent-loop,dsh-client-ui-subagent,dsh-web-search-deepseek,dsh-host-apiproxy}/lib/…；tgz：~/dsh-upgrade-backup/patched-official-files.tgz；settings：~/.dsh/settings.yaml

复核清单：
1. 逐单元验收标准是否达成（读产物真实核对，不信报告声称）：3 个补丁恢复文件与 tgz 补丁语义一致（diff 关键锚点）、②b 与 ../../reports/execs/subagent/.workspace/reports/execs/subagent/execution-2b.md 语义逐条吻合；
2. 加固正确性：mux 会话级过滤只影响广播不破坏主会话/btw chunk 流；FrameQueue 有界+丢最旧帧实现正确（读 hardening 副本相关函数）；
3. settings 片段：键路径与 live settings.yaml 现结构匹配、yaml 解析通过、maxTokens=990000 两处到位；
4. 重放脚本：备份/应用/校验/幂等/dry-run 齐全、bash -n 通过、目标路径正确；
5. 独立重跑静态验证（在产物副本上）：node --check（agent-loop/client-ui-subagent/web-search-deepseek/host-apiproxy 四份恢复/加固文件）、grep 锚点（isSubagent、mux 过滤键、FrameQueue 上限）、yaml 解析、bash -n。
6. 产出复核报告 /home/CNS2026495165/dsh/.workspace/lag-fix-review.md：逐单元 通过/返工 + 问题清单（位置/性质/建议修法）。
7. 返回结构化结论（见 schema）：verdict=pass 或 rework（findings 列出必须返工的问题）。

约束：只读代码与报告（复核报告本身除外）；禁止使用 sandbox_permissions。`;

phase('审计');
log('审计：核实 tgz 补丁可合并性、mux/FrameQueue 精确改法、settings 与重放脚本规格');
const audit = await callWithRetry(AUDIT_PROMPT, { provider: PROVIDER, model: MODEL, label: 'lag-audit', phase: '审计', schema: auditSchema });
if (audit.__agentFailure) {
  return { phase: 'audit', failed: true, error: String(audit.error ?? ''), next: '主代理裁决：审计两次失败，检查 .workspace/reports/audits/lagfix/lag-fix-audit.md 是否部分落盘后决定重跑或人工接手' };
}
if (audit.verdict !== 'proceed') {
  return { phase: 'audit', verdict: String(audit.verdict ?? ''), reason: String(audit.reason ?? ''), reportPath: String(audit.reportPath ?? ''), next: '审计判定不进入执行，主代理裁决' };
}

phase('修订并执行');
log('修订并执行：产出 restore/hardening/settings 产物与重放脚本到 .workspace/workstreams/deploy/deploy-lag/');
const exec = await callWithRetry(EXEC_PROMPT, { provider: PROVIDER, model: MODEL, label: 'lag-exec', phase: '修订并执行', schema: execSchema });
if (exec.__agentFailure || exec.status !== 'done') {
  return { phase: 'execute', failed: exec.__agentFailure ? true : false, error: exec.__agentFailure ? String(exec.error ?? '') : '', status: String(exec.status ?? ''), reason: String(exec.reason ?? ''), reportPath: String(exec.reportPath ?? ''), next: '主代理裁决：执行未全绿，检查 lag-fix-exec.md 与产物后决定续接' };
}

phase('复核');
log('复核：对照单元复核产物与脚本');
const review = await callWithRetry(REVIEW_PROMPT, { provider: PROVIDER, model: MODEL, label: 'lag-review', phase: '复核', schema: reviewSchema });
if (review.__agentFailure) {
  return { phase: 'review', failed: true, error: String(review.error ?? ''), next: '主代理裁决：复核两次失败；产物已落盘且执行阶段已本地验证，不因复核调用失败回滚，据 exec 报告人工复核' };
}
return {
  audit: { verdict: String(audit.verdict ?? ''), reportPath: String(audit.reportPath ?? '') },
  execute: { status: String(exec.status ?? ''), reportPath: String(exec.reportPath ?? '') },
  review: { verdict: String(review.verdict ?? ''), findings: String(review.findings ?? '').slice(0, 2500), reportPath: String(review.reportPath ?? '') },
  next: review.verdict === 'pass' ? '进入部署阶段（主代理，需提权 danger-full-access）：备份并应用 3 补丁 + 2 加固 + settings 990000 段到 live 全局树与 settings.yaml；重放脚本留存工作区；交付含重启与多开复现的 Runbook' : '复核返工：主代理据 findings 决定返工或人工修补',
};
