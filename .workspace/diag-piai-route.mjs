// 复刻 dsh-llm-pi-ai 的 resolveRouteModels 解析（源码 L604-678），用真实 pi-ai catalog 验证
// 用法：node diag-piai-route.mjs <settings.json 快照>
import { readFileSync } from 'node:fs';

const CATALOG = process.env.HOME + '/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@earendil-works/pi-ai/dist/providers/all.js';
const { builtinProviders, getBuiltinModels } = await import('file://' + CATALOG);

// 插件 schema 默认值（dsh-llm-pi-ai lib/index.js：defaultContextWindow / defaultMaxTokens）
const DEFAULT_CONTEXT_WINDOW = 262144;
const DEFAULT_MAX_TOKENS = 32768;

const data = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const providers = data['llm-pi-ai']?.providers ?? {};

const providerById = new Map(builtinProviders().map((p) => [p.id, p]));
const catalogModels = (provider) => {
  if (!providerById.has(provider)) return new Map();
  return new Map((getBuiltinModels(provider) ?? []).map((m) => [m.id, m]));
};
// sharedCatalogApi：catalog 模型 api 全部一致才给出答案
const sharedCatalogApi = (defaults) => {
  const apis = new Set([...defaults.values()].map((m) => m.api));
  return apis.size === 1 ? [...apis][0] : undefined;
};

function checkRoute(provider, route) {
  const defaults = catalogModels(provider);
  const providerBaseUrl = providerById.get(provider)?.baseUrl;
  const configured = route.models ?? [];
  const entries = configured.length > 0 ? configured : [...defaults.values()].map((m) => ({ id: m.id }));
  if (entries.length === 0) return 'resolves no models';
  const routeApi = sharedCatalogApi(defaults);
  const seen = new Set();
  for (const entry of entries) {
    if (!entry.id) return 'has a model with an empty id';
    if (seen.has(entry.id)) return `lists model "${entry.id}" more than once`;
    seen.add(entry.id);
    const base = defaults.get(entry.id);
    const api = route.api ?? base?.api ?? routeApi;
    if (api === undefined) return `model "${entry.id}" needs an api; the installed catalog does not describe it, so set the route's api to the wire protocol its endpoint speaks`;
    const baseUrl = route.baseURL ?? base?.baseUrl ?? providerBaseUrl;
    if (baseUrl === undefined) return `model "${entry.id}" needs a baseURL; the installed catalog does not describe this route`;
    const contextWindow = entry.contextWindow ?? base?.contextWindow ?? route.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW;
    if (!Number.isInteger(contextWindow) || contextWindow <= 0) return `model "${entry.id}" contextWindow must be a positive integer`;
    const maxTokens = entry.maxTokens ?? base?.maxTokens ?? route.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;
    if (!Number.isInteger(maxTokens) || maxTokens <= 0) return `model "${entry.id}" maxTokens must be a positive integer`;
  }
  return null;
}

let failed = 0;
for (const [provider, route] of Object.entries(providers)) {
  const issue = checkRoute(provider, route);
  const inCatalog = providerById.has(provider);
  const defaults = catalogModels(provider);
  const routeApi = sharedCatalogApi(defaults);
  if (issue) {
    failed++;
    console.log(`[INVALID] ${provider} (catalog=${inCatalog}, models=${(route.models ?? []).length}, routeApi=${routeApi ?? '(none)'}) -> ${issue}`);
  } else {
    console.log(`[OK] ${provider} (catalog=${inCatalog}, models=${(route.models ?? []).length}, routeApi=${routeApi ?? '(hand-declared route api=' + (route.api ?? 'missing') + ')'})`);
  }
}
console.log(failed === 0 ? '\n== 全部 route 可服务（llm-pi-ai 配置合法）==' : `\n== ${failed} 个 route 非法 -> llm-pi-ai 整段不可服务（assertServiceable 抛错）==`);
process.exit(failed === 0 ? 0 : 1);
