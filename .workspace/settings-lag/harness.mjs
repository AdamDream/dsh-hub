/*
 * Read-only measurement harness for the DSH Web GUI settings lag audit.
 *
 * Loads the REAL, unmodified deployed client bundles
 *   <profile>/@deepseek-ai/dsh-client-ui-settings-STAR/lib/client.js
 * in a Node VM with a browser-module-loader shim, then renders the settings
 * sections with React 18 so the per-render work and the produced DOM can be
 * counted.
 *
 * Reads only. No DSH file is modified, no network call is made, the running
 * `dsh web` process is never touched.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const HOME = process.env.HOME;
const PROFILE_NM = `${HOME}/.dsh/profiles/node_modules/@deepseek-ai`;
const REACT_NM = `${HOME}/.dsh/profiles/node_modules/dsh-workspace-enhancement/node_modules`;

export const react = require(`${REACT_NM}/react`);
export const jsxRuntime = require(`${REACT_NM}/react/jsx-runtime`);
export const ReactDOMServer = require(`${REACT_NM}/react-dom/server`);
const primitives = require('./primitives-stub.cjs');

/* ------------------------------------------------------------------ *
 * Browser module-loader shim
 * ------------------------------------------------------------------ */
const bundleCache = new Map();

const SPEC_MAP = {
  '@deepseek-ai/dsh-client-runtime': `${PROFILE_NM}/dsh-client-runtime`,
  '@deepseek-ai/dsh-client-ui-settings': `${PROFILE_NM}/dsh-client-ui-settings`,
  '@deepseek-ai/dsh-client-ui-settings-models': `${PROFILE_NM}/dsh-client-ui-settings-models`,
  '@deepseek-ai/dsh-client-ui-settings-general': `${PROFILE_NM}/dsh-client-ui-settings-general`,
  '@deepseek-ai/dsh-client-ui-settings-plugins': `${PROFILE_NM}/dsh-client-ui-settings-plugins`,
  '@deepseek-ai/dsh-client-ui-settings-plugin-inventory': `${PROFILE_NM}/dsh-client-ui-settings-plugin-inventory`,
};

let cordisMod = null;
export async function initCordis() {
  cordisMod = await import(`${PROFILE_NM}/cordis/lib/index.js`);
  return cordisMod;
}

function resolveSpec(spec) {
  if (spec === 'react') return react;
  if (spec === 'react/jsx-runtime') return jsxRuntime;
  if (spec === 'react-dom') return require(`${REACT_NM}/react-dom`);
  if (spec === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
  if (spec === '@deepseek-ai/dsh-client-ui-slots') {
    // The deployment resolves this package only inside the web app bundle, so
    // the audit supplies the two helpers the runtime bundle actually imports.
    return {
      SlotCore: class SlotCore {},
      resolveSlotLabel: (label) => (typeof label === 'function' ? label() : label),
    };
  }
  if (spec === '@deepseek-ai/cordis') {
    if (!cordisMod) throw new Error('call initCordis() first');
    return cordisMod;
  }
  const key = spec.endsWith('/client') ? spec.slice(0, -'/client'.length) : spec;
  const dir = SPEC_MAP[key];
  if (!dir) throw new Error(`unresolved module specifier: ${spec}`);
  return loadBundle(dir);
}

/** Load one real deployed client bundle and return its exports. */
export function loadBundle(pkgDir, opts = {}) {
  const file = path.join(pkgDir, 'lib', 'client.js');
  const cacheKey = file + (opts.exportNames ? '#named' : '');
  if (bundleCache.has(cacheKey)) return bundleCache.get(cacheKey);
  if (!fs.existsSync(file)) throw new Error(`no bundle at ${file}`);

  let src = fs.readFileSync(file, 'utf8');
  if (!src.startsWith('window.__ModuleLoader__.load(')) {
    throw new Error(`unexpected bundle shape: ${file}`);
  }

  // The deployed bundles expose only `apply`/`inject`. To reach a component for
  // measurement the audit appends export statements to an IN-MEMORY copy; the
  // installed file on disk is never touched.
  if (opts.exportNames) {
    const anchor = '\t\treturn module.exports;\n';
    const at = src.lastIndexOf(anchor);
    if (at === -1) throw new Error(`no export anchor in ${file}`);
    const injected = opts.exportNames.map((n) => `\t\texports.${n} = ${n};`).join('\n') + '\n';
    src = src.slice(0, at) + injected + src.slice(at);
  }

  let captured = null;
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    structuredClone,
    JSON,
    Object,
    Array,
    Map,
    Set,
    Math,
    Number,
    String,
    RegExp,
    Error,
    TypeError,
    Promise,
    Symbol,
    Reflect,
    Date,
    Boolean,
    isNaN,
    parseInt,
    parseFloat,
    window: {
      __ModuleLoader__: {
        load(def) {
          captured = def;
        },
      },
    },
  };
  sandbox.globalThis = sandbox;
  const body = src.slice(src.indexOf('(') + 1);
  vm.runInNewContext(`window.__ModuleLoader__.load(${body}`, sandbox, { filename: file });
  if (!captured) throw new Error(`bundle never called load(): ${file}`);

  const mod = { exports: {} };
  const out = captured.factory((spec) => resolveSpec(spec));
  const exports = out === undefined ? mod.exports : out;
  bundleCache.set(cacheKey, exports);
  return exports;
}

/* ------------------------------------------------------------------ *
 * Fixtures: a settings namespace view shaped like the wire's
 * ------------------------------------------------------------------ */
let schemaSvc = null;
const wireSchemaCache = new Map();
function wireSchema(schema) {
  const key = schema;
  if (!wireSchemaCache.has(key)) wireSchemaCache.set(key, JSON.parse(JSON.stringify(schema)));
  return wireSchemaCache.get(key);
}

/**
 * Build a NamespaceView the way the deployed models page reads it.
 * @param {string} ns namespace id
 * @param {object} schema live Schemastery schema to serialize
 * @param {object} value effective (base+user) section
 * @param {object} base composition-layer section
 * @param {object} user user-layer section
 */
export function namespaceView(ns, schema, value, base, user) {
  return { ns, schema: wireSchema(schema), value, base, user, revision: 1 };
}

export function makeSchemaOps(cordis) {
  const SettingsSchemaService = findSchemaService();
  schemaSvc = new SettingsSchemaService({
    // The real service only needs a ctx for `super(ctx, name)`; it uses none of it.
    reflect: { provide() {}, get() {} },
  });
  const models = loadBundle(`${PROFILE_NM}/dsh-client-ui-settings-models`);
  return models.createSettingsSchemaOperations(schemaSvc);
}

let SchemaServiceImpl = null;
export function setSchemaServiceClass(cls) {
  SchemaServiceImpl = cls;
}
function findSchemaService() {
  if (!SchemaServiceImpl) throw new Error('setSchemaServiceClass() first');
  return SchemaServiceImpl;
}

export { primitives, PROFILE_NM, REACT_NM };
