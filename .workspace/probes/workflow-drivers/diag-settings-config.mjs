// 诊断：用各插件真实的 Config 校验器验证 ~/.dsh/settings.yaml 的对应段
// 目的：定位哪一段非法（settings 加载校验失败会导致整份配置回落默认值 →
//       llm-pi-ai.providers 为空 → adam / opencode-go 模型全部消失）
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ROOT = process.env.HOME + '/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai';
const data = JSON.parse(readFileSync('/home/CNS2026495165/dsh/.workspace/probes/settings-snapshots/settings-snapshot.json', 'utf8'));

// 插件包名 → settings 段键（段键 = 插件注册的 settings namespace）
const TARGETS = [
  ['dsh-llm-pi-ai', 'llm-pi-ai'],
  ['dsh-llm-deepseek', 'llm-deepseek'],
  ['dsh-vision-adam', 'vision-adam'],
  ['dsh-web-search-deepseek', 'web-search-deepseek'],
  ['dsh-wallpaper', 'wallpaper'],
];

function renderIssue(err) {
  return String(err && err.message ? err.message : err).slice(0, 400);
}

for (const [pkg, section] of TARGETS) {
  const candidates = [
    `${ROOT}/${pkg}/lib/index.js`,
    `${process.env.HOME}/.dsh/profiles/node_modules/@deepseek-ai/${pkg}/lib/index.js`,
    `${process.env.HOME}/.dsh/profiles/node_modules/@local/${pkg}/lib/index.js`,
  ];
  let loaded = null;
  let source = '';
  for (const p of candidates) {
    try { loaded = await import(pathToFileURL(p).href); source = p; break; } catch (e) {
      if (!/ERR_MODULE_NOT_FOUND/.test(String(e))) { console.log(`[LOAD-ERR] ${pkg} @ ${p}: ${renderIssue(e)}`); }
    }
  }
  if (!loaded) { console.log(`[SKIP] ${pkg}: 未找到可加载实现`); continue; }
  const Config = loaded.Config;
  const value = data[section];
  if (Config === undefined) { console.log(`[NO-SCHEMA] ${pkg}: 未导出 Config（段=${section}，值=${JSON.stringify(value)?.slice(0, 80)}）`); continue; }
  if (value === undefined) { console.log(`[ABSENT] ${pkg}: settings 无 ${section} 段`); continue; }
  try {
    const out = typeof Config === 'function' ? Config(value) : Config(value);
    const unresolved = JSON.stringify(out ?? null);
    console.log(`[PASS] ${section} (${pkg}) -> ${unresolved.slice(0, 160)}`);
  } catch (e) {
    console.log(`[FAIL] ${section} (${pkg}) -> ${renderIssue(e)}`);
  }
}

// 额外：直接观察 llm-pi-ai 解析后的 providers 段（结构层面）
const pi = data['llm-pi-ai'];
if (pi && pi.providers) {
  for (const [id, prof] of Object.entries(pi.providers)) {
    const models = prof.models ?? [];
    console.log(`[ROUTE] ${id}: api=${prof.api ?? '(none)'} baseURL=${prof.baseURL ?? '(none)'} apiKeyEnv=${prof.apiKeyEnv ?? '(none)'} models=${models.length}`);
  }
}
