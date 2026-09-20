/*
 * Read-only audit harness for the DSH Web GUI settings lag investigation.
 *
 * Loads the REAL deployed settings bundles (unmodified) in a Node VM, stubs the
 * browser module loader, and renders <ModelsSection> with React 18.
 *
 * No DSH installation file is modified and no network call is made.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DSH_NM = '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai';
const PROFILE_NM = process.env.HOME + '/.dsh/profiles/node_modules/@deepseek-ai';
const REACT_NM = process.env.HOME + '/.dsh/profiles/node_modules/dsh-workspace-enhancement/node_modules';

const react = require(REACT_NM + '/react');
const jsxRuntime = require(REACT_NM + '/react/jsx-runtime');
const ReactDOMServer = require(REACT_NM + '/react-dom/server');

// ---------------------------------------------------------------------------
// Browser module loader emulation
// ---------------------------------------------------------------------------
const bundleExports = new Map();

function bundlePath(pkgDir) {
  return path.join(pkgDir, 'lib', 'client.js');
}

/** Load one real client bundle and return its exports (cached). */
function loadBundle(pkgDir) {
  const file = bundlePath(pkgDir);
  if (bundleExports.has(file)) return bundleExports.get(file);
  if (!fs.existsSync(file)) throw new Error('no bundle: ' + file);

  const src = fs.readFileSync(file, 'utf8');
  const eq = src.indexOf('(');
  if (!src.startsWith('window.__ModuleLoader__.load(')) {
    throw new Error('unexpected bundle shape: ' + file);
  }
  const body = src.slice(eq + 1);

  let captured = null;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(def) {
          captured = def;
        },
      },
    },
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    requestAnimationFrame: undefined,
    require: (spec) => resolveSpec(spec, pkgDir),
    // `document` deliberately absent: the bundles guard CSS injection with
    // `typeof document !== "undefined"`.
  };
  sandbox.globalThis = sandbox;
  const fn = vm.runInNewContext(
    'window.__ModuleLoader__.load(' + body,
    sandbox,
    { filename: file },
  );
  fn; // the call already ran
  if (!captured) throw new Error('bundle did not call load(): ' + file);
  const mod = { exports: {} };
  const out = captured.factory((spec) => resolveSpec(spec, pkgDir));
  bundleExports.set(file, out === undefined ? mod.exports : out);
  return bundleExports.get(file);
}

const SPEC_MAP = {
  '@deepseek-ai/dsh-client-ui-primitives': null, // supplied by primitives-stub.cjs
  '@deepseek-ai/dsh-client-runtime': DSH_NM + '/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-settings': PROFILE_NM + '/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-settings-models': PROFILE_NM + '/dsh-client-ui-settings-models',
};

function resolveSpec(spec, fromDir) {
  if (spec === 'react') return react;
  if (spec === 'react/jsx-runtime') return jsxRuntime;
  if (spec === 'react-dom') return require(REACT_NM + '/react-dom');
  const key = spec.endsWith('/client') ? spec.slice(0, -'/client'.length) : spec;
  if (key === '@deepseek-ai/dsh-client-ui-primitives') {
    return require('./primitives-stub.cjs');
  }
  const dir = SPEC_MAP[key];
  if (dir) return loadBundle(dir);
  // Sibling plugin bundles (brand, theme, ...) — none needed by these surfaces.
  const guess = path.join(fromDir, '..', spec.replace(/^@deepseek-ai\//, ''));
  if (fs.existsSync(bundlePath(guess))) return loadBundle(guess);
  throw new Error('cannot resolve module ' + spec + ' from ' + fromDir);
}

module.exports = { loadBundle, react, jsxRuntime, ReactDOMServer, PROFILE_NM, DSH_NM };
