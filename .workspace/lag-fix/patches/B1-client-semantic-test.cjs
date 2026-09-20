'use strict';
/**
 * B1-client-semantic-test.cjs — 单元 B1/C1 客户端改动的行为自测。单元独占命名（B1- 前缀）。
 *
 * 做法：从「已打补丁的副本」里把改动后的那一段表达式抽出来，用 new Function 在真实形状的
 * 输入上求值，验证「宿主聚合字段优先、缺失时回落到就地聚合」的取值语义。
 * 不依赖浏览器、不依赖 live 宿主。
 *
 * 运行：node patches/B1-client-semantic-test.cjs
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.dirname(__dirname);
/** 定位最新一次 dry-run 产出的副本（目录带时间戳，故按 mtime 取最新；可用环境变量覆盖）。 */
function latestArtifact(name, envOverride) {
  if (envOverride) return envOverride;
  const base = path.resolve(ROOT, 'tmp/B1');
  if (!fs.existsSync(base)) return path.resolve(base, name);
  const found = fs.readdirSync(base)
    .filter((d) => d.startsWith('dryrun'))
    .map((d) => path.join(base, d, name))
    .filter((f) => fs.existsSync(f))
    .map((f) => ({ f, m: fs.statSync(f).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return found.length > 0 ? found[0].f : path.resolve(base, name);
}

const UI = latestArtifact('b1-ui-workspace.patched.js', process.env.B1_UI_PATCHED);
const RUNTIME = latestArtifact('b1-client-runtime.patched.js', process.env.B1_RUNTIME_PATCHED);

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) console.log(`[PASS] ${name}`);
  else {
    failures += 1;
    console.log(`[FAIL] ${name}${detail ? ' — ' + detail : ''}`);
  }
};

// ---------------------------------------------------------------------------
// 1) sessionNode 的两处取值：宿主字段优先 + 回落
// ---------------------------------------------------------------------------
const uiSrc = fs.readFileSync(UI, 'utf8');
/** 从 `runningSubagentCount: <expr>, MARK注释` 抽出 <expr>（括号配平，逗号安全）。 */
const exprOf = (variable) => {
  const key = `runningSubagentCount: typeof ${variable}.runningSubagentCount`;
  const at = uiSrc.indexOf(key);
  if (at === -1) return undefined;
  let i = uiSrc.indexOf('typeof', at);
  let depth = 0;
  const start = i;
  for (; i < uiSrc.length; i++) {
    const ch = uiSrc[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
  }
  return uiSrc.slice(start, i);
};

for (const variable of ['s', 'summary']) {
  const expr = exprOf(variable);
  check(`抽到 ${variable} 的取值表达式`, typeof expr === 'string' && expr.includes('typeof'), String(expr).slice(0, 80));
  if (typeof expr !== 'string') continue;
  const descendantsGet = (id) => (id === 'root-1' ? { runningCount: 7 } : undefined);
  const evalWith = (row) =>
    new Function(
      `${variable}`,
      'descendants',
      `return (${expr});`
    )(row, { get: descendantsGet });

  // 宿主字段存在（含 0）→ 用宿主值
  check(`[${variable}] 宿主字段=3 → 取 3`, evalWith({ id: 'root-1', runningSubagentCount: 3 }) === 3);
  check(`[${variable}] 宿主字段=0 → 取 0（不是回落 7）`, evalWith({ id: 'root-1', runningSubagentCount: 0 }) === 0);
  // 宿主字段缺失 → 回落到就地聚合（原行为，保证未重启/未升级时不变）
  check(`[${variable}] 宿主字段缺失 → 回落 runningCount=7`, evalWith({ id: 'root-1' }) === 7);
  check(`[${variable}] 宿主与就地都无 → 0`, evalWith({ id: 'other' }) === 0);
  // 类型异常防御：非 number 不当成宿主值
  check(`[${variable}] 宿主字段为字符串时不采用 → 回落 7`, evalWith({ id: 'root-1', runningSubagentCount: '3' }) === 7);
  // subagent 行（被过滤掉的老会话）在 byId 里不存在时，宿主值仍然可达
  check(`[${variable}] 不在 byId 的会话靠宿主字段仍得 5`, evalWith({ id: 'cold-root', runningSubagentCount: 5 }) === 5);
}

// ---------------------------------------------------------------------------
// 2) entryCache 新鲜度判据
// ---------------------------------------------------------------------------
const runtimeSrc = fs.readFileSync(RUNTIME, 'utf8');
const chain = runtimeSrc.match(/if \(prev !== void 0 && [^)]*prev\.runningSubagentCount === entry\.runningSubagentCount\) return prev;/);
check('entryCache 判据已包含 runningSubagentCount', chain !== null);
if (chain !== null) {
  const fn = new Function(
    'prev',
    'entry',
    `const this_ = { entryCache: { get: () => prev, set: () => {} } };
     ${chain[0].replace('return prev;', 'return true;')}
     return false;`
  );
  const base = {
    updatedAt: 1, running: false, blank: true, agentPreset: 'p', parentSessionId: undefined,
    cwd: '/x', origin: undefined, title: 't', depth: 0, pendingInteraction: undefined,
    projectionValues: undefined, completed: false, runningSubagentCount: 2,
  };
  check('相同 runningSubagentCount → 复用旧条目（缓存命中）', fn({ ...base }, { ...base }) === true);
  check('计数由 2 变 3 → 不复用（状态点会刷新）', fn({ ...base }, { ...base, runningSubagentCount: 3 }) === false);
  check('计数由 3 变 2 → 不复用', fn({ ...base, runningSubagentCount: 3 }, { ...base, runningSubagentCount: 2 }) === false);
}

console.log(failures === 0 ? '\n===== 客户端语义自测全部 PASS =====' : `\n===== 客户端语义自测 ${failures} 项 FAIL =====`);
process.exit(failures === 0 ? 0 : 1);
