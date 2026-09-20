/*
 * Client-side render-cost measurement for the settings lag audit.
 *
 * Renders the REAL deployed <ModelsSection> / <ProviderEditor> from
 * ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js
 * (unmodified) with React 18, for the provider catalog actually declared in
 * ~/.dsh/settings.yaml, and reports render time + produced DOM size.
 *
 * Read-only: no DSH file is written, no network call, the running GUI is untouched.
 */
import fs from 'node:fs';
import { loadBundle, react, jsxRuntime, ReactDOMServer, PROFILE_NM, initCordis } from './harness.mjs';
await initCordis();

const { createElement } = react;

/* ---------- schema stand-in, faithful to SettingsSchemaService ---------- */
const SCHEMA = {
  type: 'object',
  dict: {
    providers: {
      type: 'dict',
      inner: {
        type: 'object',
        dict: {
          api: {
            type: 'union',
            list: [{ value: 'openai-completions' }, { value: 'anthropic-messages' }, { value: 'google-generative-ai' }],
          },
          apiKeyEnv: { type: 'string' },
          baseURL: { type: 'string' },
          displayName: { type: 'string' },
          models: {
            type: 'array',
            meta: { default: [] },
            inner: {
              type: 'object',
              dict: {
                id: { type: 'string' },
                name: { type: 'string' },
                contextWindow: { type: 'number' },
                maxTokens: { type: 'number' },
              },
            },
          },
        },
      },
    },
  },
};

const schemaOps = {
  rehydrate: () => SCHEMA,
  validate: () => undefined,
  nodeAtPath: (root, p) => {
    let node = root;
    for (const key of p) {
      if (node === undefined) return undefined;
      if (node.type === 'object') node = node.dict?.[key];
      else if (node.type === 'dict' || node.type === 'array') node = node.inner;
      else return undefined;
    }
    return node;
  },
  getPath: (value, p) => {
    let cur = value;
    for (const key of p) {
      if (Array.isArray(cur)) { cur = cur[Number(key)]; continue; }
      if (typeof cur !== 'object' || cur === null) return undefined;
      cur = cur[key];
    }
    return cur;
  },
  hasPath: (value, p) => {
    if (p.length === 0) return value !== undefined;
    const parent = schemaOps.getPath(value, p.slice(0, -1));
    const key = p[p.length - 1];
    if (Array.isArray(parent)) return Number(key) < parent.length;
    if (typeof parent !== 'object' || parent === null) return false;
    return key in parent;
  },
  setPath: (root, p, v) => { const c = structuredClone(root); let t = c; for (let i = 0; i < p.length - 1; i++) t = t[p[i]]; t[p[p.length - 1]] = v; return c; },
  deletePath: (root, p) => { const c = structuredClone(root); let t = c; for (let i = 0; i < p.length - 1; i++) t = t[p[i]]; delete t[p[p.length - 1]]; return c; },
};

/* ---------- the configured catalog, read from ~/.dsh/settings.yaml ------- */
const raw = fs.readFileSync(`${process.env.HOME}/.dsh/settings.yaml`, 'utf8');

function countDeclaredModels(text) {
  const out = {};
  let inPiAi = false, provider = null, inModels = false;
  for (const line of text.split('\n')) {
    if (/^llm-pi-ai:/.test(line)) { inPiAi = true; continue; }
    if (/^[a-z]/.test(line)) { inPiAi = false; provider = null; inModels = false; }
    if (!inPiAi) continue;
    const prov = line.match(/^ {4}([A-Za-z0-9._-]+):\s*$/);
    if (prov) { provider = prov[1]; out[provider] = out[provider] ?? []; inModels = false; continue; }
    if (/^ {6}models:\s*$/.test(line)) { inModels = true; continue; }
    if (inModels && provider) {
      const id = line.match(/^ {8}- id:\s*(\S+)/);
      if (id) { out[provider].push(id[1]); continue; }
      if (/^ {6}\S/.test(line)) inModels = false;
    }
  }
  return out;
}

const declared = countDeclaredModels(raw);
console.log('=== Declared models in ~/.dsh/settings.yaml (llm-pi-ai providers) ===');
for (const [p, ids] of Object.entries(declared)) console.log(`  ${p.padEnd(14)} ${ids.length}`);
const total = Object.values(declared).reduce((a, b) => a + b.length, 0);
console.log(`  ${'TOTAL'.padEnd(14)} ${total}`);
console.log();

/* ---------- bundles ---------- */
const models = loadBundle(`${PROFILE_NM}/dsh-client-ui-settings-models`, { exportNames: ['ModelsSection', 'ProviderEditor', 'ModelListEditor', 'validateDeepSeekModels', 'modelDrafts', 'formatCapacity', 'protocolChoices'] });
console.log('settings-models bundle exports:', Object.keys(models).join(', '));
console.log();

/* ---------- fixtures ---------- */
function buildNamespace(providerId, ids) {
  const modelsArr = ids.map((id) => ({ id, contextWindow: 1000000 }));
  const section = { apiKeyEnv: `${providerId.toUpperCase()}_API_KEY`, baseURL: 'https://example.invalid/v1', models: modelsArr };
  return {
    ns: 'llm-pi-ai',
    schema: SCHEMA,
    value: { providers: { [providerId]: section } },
    base: {},
    user: { providers: { [providerId]: section } },
    revision: 1,
  };
}

function makeFixtures(providerId, ids) {
  const ns = buildNamespace(providerId, ids);
  const rows = [{
    entry: {
      provider: providerId,
      displayName: providerId,
      settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', providerId],
      active: true,
      declared: false,
    },
    configured: true,
    removable: true,
    apiKeyEnv: `${providerId.toUpperCase()}_API_KEY`,
    credential: { configured: true, writable: true },
  }];
  return {
    ns,
    snapshot: { status: 'ready', error: null, credentialError: null, writable: true, rows, namespaces: new Map([['llm-pi-ai', ns]]) },
  };
}

const api = {
  credentials: { describe: () => new Promise(() => {}), set: () => new Promise(() => {}) },
  llm: { providers: () => new Promise(() => {}), discoverModels: () => new Promise(() => {}) },
  settings: { mutate: () => new Promise(() => {}) },
};

const t = (k) => (typeof k === 'string' ? k : String(k));

function domStats(html) {
  const tags = html.match(/<(?!\/)[a-zA-Z][^>]*>/g) ?? [];
  return {
    bytes: html.length,
    elements: tags.length,
    inputs: (html.match(/<input/g) ?? []).length,
    buttons: (html.match(/<button/g) ?? []).length,
    svgs: (html.match(/<svg/g) ?? []).length,
  };
}

function timeRender(label, element, runs = 5) {
  let html = '';
  const times = [];
  for (let i = 0; i < runs; i += 1) {
    const t0 = process.hrtime.bigint();
    html = ReactDOMServer.renderToStaticMarkup(element);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  const s = domStats(html);
  console.log(`[${label}]`);
  console.log(`  renderToString best/median: ${times[0].toFixed(2)} / ${times[(runs / 2) | 0].toFixed(2)} ms`);
  console.log(`  HTML bytes ${s.bytes} | elements ${s.elements} | <input> ${s.inputs} | <button> ${s.buttons} | <svg> ${s.svgs}`);
  return { ...s, ms: times[0] };
}

const results = {};

/* A) the Models section, every provider row collapsed (what "open Settings" does) */
{
  const { ns, snapshot } = makeFixtures('adam', declared.adam ?? []);
  const controller = { store: { getSnapshot: () => snapshot, subscribe: () => () => {} }, load: () => Promise.resolve() };
  const element = createElement(models.ModelsSection, {
    controller,
    useSnapshot: (sel) => sel(snapshot),
    api,
    schema: schemaOps,
    t,
  });
  results.collapsed = timeRender(`Models section mounted, 1 provider row, ALL collapsed (${(declared.adam ?? []).length} models in the namespace)`, element);
}

/* B) one provider editor OPEN — what clicking 编辑 does */
{
  const { ns } = makeFixtures('adam', declared.adam ?? []);
  const element = createElement(models.ProviderEditor, {
    provider: 'adam',
    displayName: 'adam',
    namespace: ns,
    schema: schemaOps,
    settingsPath: ['providers', 'adam'],
    api,
    t,
    readOnly: false,
    onClose: () => {},
  });
  results.editor = timeRender(`ProviderEditor OPEN for adam (${(declared.adam ?? []).length} model rows, <details> CLOSED)`, element);
}

/* C) scale sweep: how the cost grows with the number of declared models */
console.log();
console.log('=== Scale sweep: ProviderEditor open, N declared models ===');
for (const n of [0, 10, 25, 49, 60, 120, 300]) {
  const ids = Array.from({ length: n }, (_, i) => `model-${i}`);
  const { ns } = makeFixtures('adam', ids);
  const element = createElement(models.ProviderEditor, {
    provider: 'adam', displayName: 'adam', namespace: ns, schema: schemaOps,
    settingsPath: ['providers', 'adam'], api, t, readOnly: false, onClose: () => {},
  });
  const html = ReactDOMServer.renderToStaticMarkup(element);
  const times = [];
  for (let i = 0; i < 5; i += 1) {
    const t0 = process.hrtime.bigint();
    ReactDOMServer.renderToStaticMarkup(element);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  const s = domStats(html);
  console.log(`  N=${String(n).padStart(3)}  render ${times[0].toFixed(2)} ms  elements ${String(s.elements).padStart(5)}  inputs ${String(s.inputs).padStart(4)}  buttons ${String(s.buttons).padStart(4)}`);
}

fs.writeFileSync(`${import.meta.dirname}/render-cost.json`, JSON.stringify({ declared, total, results }, null, 1));
console.log(`\nwrote render-cost.json`);
