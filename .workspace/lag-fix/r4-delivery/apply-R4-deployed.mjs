#!/usr/bin/env node
/**
 * apply-R4-deployed.mjs — 把 R4「旧响应/卸载保护」契约最小同构地打到 **deployed** 两个文件上。
 *
 * 为什么不是 `cp source deployed`：source 与 deployed 是**独立拷贝且功能漂移**
 * （deployed 是更新超集：hourly 粒度、trend gear、settingsScope、peakRing；index 侧还有
 * P0-b 行为开关）。整文件覆盖会静默丢掉这些功能 —— 2026-09-21 已真实踩到一次，故本脚本
 * 只做**逐处锚点替换**，且每处锚点必须**恰好命中一次**，否则拒绝写入（fail-closed）。
 *
 * 幂等：命中 `dsh-perf-fix R4 v1` 标记即视为已应用并跳过（--apply 时）。
 *
 * 用法：
 *   node apply-R4-deployed.mjs            # dry-run：只校验锚点与打印 diff 摘要，不写文件
 *   node apply-R4-deployed.mjs --apply    # 真写（先自动做 pre-image 备份到 backup/R4-deployed-<stamp>/）
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const DSH = process.env.HOME + '/.dsh/profiles/node_modules/@local/dsh-usage/lib';
const WORK = '/home/CNS2026495165/dsh/.workspace/lag-fix';
const MARK = 'dsh-perf-fix R4 v1';
const apply = process.argv.includes('--apply');

/** 统一的 client 守卫片段（与 source 同契约，缩进随锚点）。 */
const clientGuards = (i) => `${i}/* ${MARK}: 旧响应/卸载保护。RPC 不假设可取消：用单调代次 + alive
${i}   标志丢弃过期响应；setup 重新置 alive 以兼容 StrictMode 的 setup→cleanup→setup
${i}   与真实 remount；cleanup 递增代次，使上一轮在飞请求在重挂载后也无法复活。 */
${i}const aliveRef = react.useRef(true);
${i}const allGenerationRef = react.useRef(0);
${i}const sessionsGenerationRef = react.useRef(0);
${i}const statusGenerationRef = react.useRef(0);
${i}react.useEffect(() => {
${i}\taliveRef.current = true;
${i}\treturn () => {
${i}\t\taliveRef.current = false;
${i}\t\tallGenerationRef.current += 1;
${i}\t\tsessionsGenerationRef.current += 1;
${i}\t\tstatusGenerationRef.current += 1;
${i}\t};
${i}}, []);
`;

const T = '[ \\t]+';
const rules = [
  // ── deployed client.js ────────────────────────────────────────────────────
  {
    file: 'client.js',
    name: 'C1 refs + lifecycle effect',
    find: new RegExp(`(^${T}const loadAllRef = react\\.useRef\\(null\\);\\n)`, 'm'),
    replace: (m) => m[1] + clientGuards(m[1].match(/^[ \t]*/)[0]),
  },
  {
    file: 'client.js',
    name: 'C2 loadAll 头部（代次 + 首次写入门控）',
    find: new RegExp(
      `(^${T})const loadAll = react\\.useCallback\\(async \\(\\) => \\{\\n` +
        `${T}if \\(!rpcAvailable\\) \\{\\n` +
        `${T}setError\\(\\{ code: "unavailable", message: "宿主未注册 /usage RPC 通道" \\}\\);\\n` +
        `${T}return;\\n${T}\\}\\n${T}setLoading\\(true\\);\\n`,
      'm',
    ),
    replace: (m) =>
      `${m[1]}const loadAll = react.useCallback(async () => {\n` +
      `${m[1]}\tconst generation = ++allGenerationRef.current;\n` +
      `${m[1]}\tconst current = () => aliveRef.current && generation === allGenerationRef.current;\n` +
      `${m[1]}\tif (!rpcAvailable) {\n` +
      `${m[1]}\t\tif (current()) setError({ code: "unavailable", message: "宿主未注册 /usage RPC 通道" });\n` +
      `${m[1]}\t\treturn;\n${m[1]}\t}\n${m[1]}\tif (current()) setLoading(true);\n`,
  },
  {
    file: 'client.js',
    name: 'C3 loadAll 成功分支门控',
    find: /if \(calls\.slice\(0, 6\)\.every\(\(r\) => r && r\.ok\)\) \{/,
    replace: () => 'if (current() && calls.slice(0, 6).every((r) => r && r.ok)) {',
  },
  {
    file: 'client.js',
    name: 'C4 loadAll 失败分支门控',
    find: new RegExp(`\\} else \\{\\n(${T})const failed = calls\\.slice\\(0, 6\\)\\.find`),
    replace: (m) => `} else if (current()) {\n${m[1]}const failed = calls.slice(0, 6).find`,
  },
  {
    file: 'client.js',
    name: 'C5 loadAll catch + finally 门控',
    find: new RegExp(
      `\\} catch \\(cause\\) \\{\\n${T}setError\\(\\{ code: "transport", message: String\\(\\(cause && cause\\.message\\) \\|\\| cause\\) \\}\\);\\n` +
        `${T}\\} finally \\{\\n${T}setLoading\\(false\\);\\n${T}\\}`,
    ),
    replace: (m) => {
      const i = m[0].match(new RegExp(`\\n(${T})setError`))[1];
      return (
        `} catch (cause) {\n${i}if (current()) setError({ code: "transport", message: String((cause && cause.message) || cause) });\n` +
        `${i.replace(/\t$/, '')}} finally {\n${i}if (current()) setLoading(false);\n${i.replace(/\t$/, '')}}`
      );
    },
  },
  {
    file: 'client.js',
    name: 'C6 loadSessions 头部',
    find: new RegExp(`(^${T})const loadSessions = react\\.useCallback\\(async \\(\\) => \\{\\n${T}if \\(!rpcAvailable\\) return;\\n`, 'm'),
    replace: (m) =>
      `${m[1]}const loadSessions = react.useCallback(async () => {\n` +
      `${m[1]}\tconst generation = ++sessionsGenerationRef.current;\n` +
      `${m[1]}\tconst current = () => aliveRef.current && generation === sessionsGenerationRef.current;\n` +
      `${m[1]}\tif (!rpcAvailable) return;\n`,
  },
  {
    file: 'client.js',
    name: 'C7 loadSessions 写入分支门控',
    find: new RegExp(
      `(${T})if \\(result && result\\.ok\\) \\{\\n${T}setSessionRows\\(result\\.value \\|\\| \\[\\]\\);\\n${T}\\} else \\{\\n${T}setError\\(\\(result && result\\.error\\)`,
    ),
    replace: (m) => {
      const i = m[1];
      return (
        `${i}if (result && result.ok) {\n${i}\tif (current()) setSessionRows(result.value || []);\n${i}} else if (current()) {\n` +
        `${i}\tsetError((result && result.error)`
      );
    },
  },
  {
    file: 'client.js',
    name: 'C8 loadSessions catch 门控',
    find: new RegExp(
      `(${T})\\} catch \\(cause\\) \\{\\n${T}setError\\(\\{ code: "transport", message: String\\(\\(cause && cause\\.message\\) \\|\\| cause\\) \\}\\);\\n${T}\\}\\n${T}\\}, \\[rpcAvailable, rpc, dataSource, range\\.from, range\\.to, sessionFrom, sessionTo\\]\\);`,
    ),
    replace: (m) => {
      const i = m[1];
      return (
        `${i}} catch (cause) {\n${i}\tif (current()) setError({ code: "transport", message: String((cause && cause.message) || cause) });\n` +
        `${i}}\n${i}}, [rpcAvailable, rpc, dataSource, range.from, range.to, sessionFrom, sessionTo]);`
      );
    },
  },
  {
    file: 'client.js',
    name: 'C9 loadStatus 头部',
    find: new RegExp(`(^${T})const loadStatus = react\\.useCallback\\(async \\(\\) => \\{\\n${T}if \\(!rpcAvailable\\) return;\\n`, 'm'),
    replace: (m) =>
      `${m[1]}const loadStatus = react.useCallback(async () => {\n` +
      `${m[1]}\tconst generation = ++statusGenerationRef.current;\n` +
      `${m[1]}\tconst current = () => aliveRef.current && generation === statusGenerationRef.current;\n` +
      `${m[1]}\tif (!rpcAvailable) return;\n`,
  },
  {
    file: 'client.js',
    name: 'C10 loadStatus 写入门控',
    find: /if \(result && result\.ok\) setStatus\(result\.value\);/,
    replace: () => 'if (current() && result && result.ok) setStatus(result.value);',
  },

  // ── deployed index.js（host 冷面）────────────────────────────────────────
  {
    file: 'index.js',
    name: 'H1 disposed/代次状态',
    find: /(^[ \t]*let disposeTimer = null;\n)/m,
    replace: (m) =>
      `${m[1]}\t/* ${MARK}: 生命周期代次。bootstrap 的每个 await 之后都必须复查，\n` +
      `\t   否则在 await 期间被卸载时仍会打开 DB、完成首扫并安装 timer。 */\n` +
      `\tlet disposed = false;\n\tlet activationGeneration = 0;\n` +
      `\tconst isActive = (generation) => !disposed && generation === activationGeneration;\n`,
  },
  {
    file: 'index.js',
    name: 'H2 runIngest dispose 门控',
    find: /(^[ \t]*)const runIngest = async \(\) => \{\n[ \t]*if \(db === null\) return;\n/m,
    replace: (m) =>
      `${m[1]}const runIngest = async () => {\n` +
      `${m[1]}\t// dispose 之后不得再启动新 ingest（timer 已清，但飞行中的手动 refresh\n` +
      `${m[1]}\t// 或已排队 tick 仍可能落到这里）。\n` +
      `${m[1]}\tif (disposed || db === null) return;\n`,
  },
  {
    file: 'index.js',
    name: 'H3a 声明 bootstrapGeneration（deployed 原本没有这一行）',
    // ⚠️ source 在 queueMicrotask 之前有 `const bootstrapGeneration = ++activationGeneration;`，
    // 而 deployed 没有。H3 的产物引用了该标识符 —— 漏掉本规则会在宿主 bootstrap 时抛
    // ReferenceError（与 B1 的 `ctx is not defined` 同类，node --check 查不出来）。
    find: new RegExp(
      `(^${T})(// 3 \\+ 4\\. DB open, async first scan, then the periodic ingest timer\\.\\n)(^${T})queueMicrotask\\(\\(\\) => \\{`,
      'm',
    ),
    replace: (m) => `${m[1]}${m[2]}${m[1]}const bootstrapGeneration = ++activationGeneration;\n${m[3]}queueMicrotask(() => {`,
  },
  {
    file: 'index.js',
    name: 'H3 bootstrap 全链路门控 + db 延迟发布',
    find: /(^[ \t]*)queueMicrotask\(\(\) => \{\n[\s\S]*?\n\1\}\);\n/m,
    replace: (m) => {
      const i = m[1];
      return (
        `${i}queueMicrotask(() => {\n` +
        `${i}\tvoid (async () => {\n` +
        `${i}\t\tlet openedDb = null;\n` +
        `${i}\t\ttry {\n` +
        `${i}\t\t\tconst resolved = resolveDbPath();\n` +
        `${i}\t\t\topenedDb = await openUsageDb(resolved.path);\n` +
        `${i}\t\t\tif (!isActive(bootstrapGeneration)) {\n` +
        `${i}\t\t\t\ttry { openedDb?.close(); } catch { /* best effort */ }\n` +
        `${i}\t\t\t\treturn;\n${i}\t\t\t}\n` +
        `${i}\t\t\t// 只在 schema 成功且仍 active 之后才发布 db：否则 ensureSchema 抛错时\n` +
        `${i}\t\t\t// RPC getter 会拿到未初始化完成的连接，且旧代码会跳过 close → 连接泄漏。\n` +
        `${i}\t\t\tensureSchema(openedDb);\n` +
        `${i}\t\t\tif (!isActive(bootstrapGeneration)) {\n` +
        `${i}\t\t\t\ttry { openedDb.close(); } catch { /* best effort */ }\n` +
        `${i}\t\t\t\treturn;\n${i}\t\t\t}\n` +
        `${i}\t\t\tdb = openedDb;\n${i}\t\t\topenedDb = null;\n` +
        `${i}\t\t\tdbPath = resolved.path;\n${i}\t\t\tdbSource = resolved.source;\n` +
        `${i}\t\t\tlog.info(\`db ready at \${resolved.path} (\${resolved.source})\`);\n` +
        `${i}\t\t} catch (error) {\n` +
        `${i}\t\t\ttry { openedDb?.close(); } catch { /* best effort */ }\n` +
        `${i}\t\t\tlog.warn(\`db unavailable: \${error instanceof Error ? error.message : String(error)} — ingest disabled\`);\n` +
        `${i}\t\t\treturn;\n${i}\t\t}\n` +
        `${i}\t\tif (!isActive(bootstrapGeneration)) return;\n` +
        `${i}\t\tawait runIngest();\n` +
        `${i}\t\tif (!isActive(bootstrapGeneration)) return;\n` +
        `${i}\t\tdisposeTimer =\n` +
        `${i}\t\t\ttypeof ctx.setInterval === "function"\n` +
        `${i}\t\t\t\t? ctx.setInterval(runIngest, INGEST_INTERVAL_MS)\n` +
        `${i}\t\t\t\t: ctx.effect(() => {\n` +
        `${i}\t\t\t\t\t\tconst timer = setInterval(() => void runIngest(), INGEST_INTERVAL_MS);\n` +
        `${i}\t\t\t\t\t\treturn () => clearInterval(timer);\n` +
        `${i}\t\t\t\t\t}, "dsh-usage: ingest interval");\n` +
        `${i}\t\tif (!isActive(bootstrapGeneration)) {\n` +
        `${i}\t\t\ttry { disposeTimer?.(); } catch { /* best effort */ }\n` +
        `${i}\t\t\tdisposeTimer = null;\n${i}\t\t}\n` +
        `${i}\t})().catch((error) => log.warn(\`bootstrap failed: \${error instanceof Error ? error.message : String(error)}\`));\n` +
        `${i}});\n`
      );
    },
  },
  {
    file: 'index.js',
    name: 'H4 disposer 先失效代次',
    find: new RegExp(`(^${T}ctx\\.effect\\(\\n${T}\\(\\) => \\(\\) => \\{\\n)(?=${T}try \\{\\n${T}disposeTimer\\?\\.\\(\\);)`, 'm'),
    replace: (m) =>
      `${m[1]}\t\t\t/* ${MARK}: 先失效代次再清理，late timer 不会被留下。 */\n` +
      `\t\t\tdisposed = true;\n\t\t\tactivationGeneration += 1;\n`,
  },
];
let failed = 0;
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
const backupDir = path.join(WORK, `backup/R4-deployed-${stamp}`);
const candidateDir = path.join(WORK, 'r4-delivery/candidate');
const outputs = [];

for (const file of ['client.js', 'index.js']) {
  const target = path.join(DSH, file);
  const before = readFileSync(target, 'utf8');
  let text = before;
  if (before.includes(MARK)) {
    console.log(`[skip] ${file}: 已含 ${MARK}`);
    continue;
  }
  for (const rule of rules.filter((r) => r.file === file)) {
    const hits = text.match(new RegExp(rule.find.source, rule.find.flags.includes('g') ? rule.find.flags : rule.find.flags + 'g'));
    const count = hits === null ? 0 : hits.length;
    if (count !== 1) {
      console.log(`[FAIL] ${file} · ${rule.name}: 锚点命中 ${count} 次（要求恰好 1 次）→ 拒绝写入`);
      failed += 1;
      continue;
    }
    text = text.replace(rule.find, (...args) => rule.replace(args));
    console.log(`[ok]   ${file} · ${rule.name}`);
  }
  if (failed === 0) outputs.push({ file, target, text });
}

if (failed > 0) {
  console.log(`\n锚点校验失败 ${failed} 处：未写入任何文件（fail-closed）。`);
  process.exit(1);
}

for (const { file, target, text } of outputs) {
  const delta = text.length - readFileSync(target, 'utf8').length;
  console.log(`\n${file}: +${delta} bytes, ${text.split('\n').length} lines`);
  // 无论 dry-run 还是 apply，都把候选产物落盘到工作区并做语法检查：
  // 「锚点命中」不等于「产物可解析」，必须先看产物。
  mkdirSync(candidateDir, { recursive: true });
  const candidate = path.join(candidateDir, file);
  writeFileSync(candidate, text);
  try {
    execFileSync('node', ['--check', candidate], { stdio: 'pipe' });
    console.log(`[check] node --check OK (candidate ${file})`);
  } catch (error) {
    console.log(`[check] node --check FAILED (candidate ${file})\n${String(error.stderr ?? error).slice(0, 600)}`);
    process.exit(2);
  }
  if (!apply) continue;
  mkdirSync(backupDir, { recursive: true });
  copyFileSync(target, path.join(backupDir, `pre-${file}`));
  writeFileSync(target, text);
  console.log(`[applied] ${target}  (pre-image: ${backupDir}/pre-${file})`);
}

// ── 引入标识符的存在性校验 ────────────────────────────────────────────────
// node --check 只验语法：引用一个**从未声明**的标识符仍然通过语法检查，却会在运行时
// 抛 ReferenceError（B1 的 `ctx is not defined` 就是这样上线的）。本补丁引入的每个
// 标识符都必须在本文件里存在 `let/const/var/function` 声明，否则拒绝。
const introduced = {
  'client.js': ['aliveRef', 'allGenerationRef', 'sessionsGenerationRef', 'statusGenerationRef'],
  'index.js': ['disposed', 'activationGeneration', 'isActive', 'bootstrapGeneration'],
};
let missing = 0;
for (const [file, names] of Object.entries(introduced)) {
  const text = readFileSync(path.join(apply ? DSH : candidateDir, file), 'utf8');
  for (const name of names) {
    const declared = new RegExp(`(?:^|[^\\w$.])(?:let|const|var|function)\\s+${name}\\b`, 'm').test(text);
    if (!declared) {
      console.log(`[FAIL] ${file}: 引入的标识符 \`${name}\` 在本文件内没有声明 → 运行时会 ReferenceError`);
      missing += 1;
    }
  }
}
console.log(missing === 0 ? '[verify] 引入标识符全部有本文件内声明 ✓' : `[verify] ${missing} 个标识符缺声明`);
if (missing > 0) process.exit(3);

if (!apply) console.log('\n(dry-run：未写入任何文件)');
