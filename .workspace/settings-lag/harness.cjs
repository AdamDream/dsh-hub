/*
 * Read-only audit harness for DSH Web GUI settings lag.
 * Loads the REAL deployed settings-model / settings-shell client bundles and
 * renders <ModelsSection> with React 18 + react-dom/server to measure the
 * per-render work and the produced DOM node count.
 *
 * Nothing is written outside this directory; no DSH file is modified.
 */
'use strict';
const path = require('path');
const fs = require('fs');

const PROFILE = process.env.HOME + '/.dsh/profiles/node_modules/@deepseek-ai';
const REACT_ROOT = PROFILE + '/dsh-workspace-enhancement/node_modules';
const react = require(REACT_ROOT + '/react');
const ReactDOMServer = require(REACT_ROOT + '/react-dom/server');
const jsxRuntime = require(REACT_ROOT + '/react/jsx-runtime');

// ---- 1. Reproduce the browser module loader contract -----------------------
const loaded = new Map();
global.window = global.window || {};

function makeRequire(baseDir) {
  return function (spec) {
    switch (spec) {
      case 'react': return react;
      case 'react/jsx-runtime': return jsxRuntime;
      case 'react-dom': return require(REACT_ROOT + '/react-dom');
      default: break;
    }
    // Any other specifier is one of the sibling bundles (e.g. ui-primitives).
    const real = path.join(baseDir, '..', spec.replace(/^@deepseek-ai\//, ''));
    return loadBundle(real);
  };
}

function loadBundle(pkgDir) {
  const file = path.join(pkgDir, 'lib', 'client.js');
  if (loaded.has(file)) return loaded.get(file);
  if (!fs.existsSync(file)) throw new Error('missing bundle: ' + file);
  const api = { exports: {} };
  loaded.set(file, api.exports);
  global.window.__ModuleLoader__.load({
    id: pkgDir,
    factory: (require) => {
      const mod = { exports: {} };
      loaded.set(file, mod.exports);
      const fn = new Function('require', 'module', 'exports', 'window', 'document',
        fs.readFileSync(file, 'utf8').replace(
          /^window\.__ModuleLoader__\.load\(/,
          'return (function(){return window.__ModuleLoader__.load('));
      // Simpler: re-evaluate in this scope with the capture API below.
      const src = fs.readFileSync(file, 'utf8');
      const wrapped = 'window.__ModuleLoader__.load(' + src.slice(src.indexOf('(') + 1);
      const run = new Function('window', 'require', 'module', 'exports', 'document', 'console', wrapped);
      run(global.window, require, mod, mod.exports, undefined, console);
      return Object.assign(mod.exports, api.exports);
    },
  });
  return loaded.get(file);
}

let captured = [];
global.window.__ModuleLoader__ = {
  load(def) {
    captured.push(def);
  },
};

function instantiate(pkgDir) {
  captured = [];
  const file = path.join(pkgDir, 'lib', 'client.js');
  const src = fs.readFileSync(file, 'utf8');
  const eq = src.indexOf('(');
  const wrapped = 'window.__ModuleLoader__.load(' + src.slice(eq + 1);
  const run = new Function('window', 'require', 'document', 'console', wrapped);
  run(global.window, makeRequire(pkgDir), undefined, console);
  const def = captured[captured.length - 1];
  const mod = { exports: {} };
  const out = def.factory((spec) => makeRequire(pkgDir)(spec));
  return out === undefined ? mod.exports : out;
}

// Sibling bundles are required by name; map them to their real directories.
const SIBLING = {
  '@deepseek-ai/dsh-client-ui-primitives':
    '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client':
    '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime',
};

const bundleCache = new Map();
function requireBundle(spec) {
  if (bundleCache.has(spec)) return bundleCache.get(spec);
  const dir = SIBLING[spec] || SIBLING[spec + '/client'];
  if (!dir) throw new Error('unknown specifier ' + spec);
  const src = fs.readFileSync(path.join(dir, 'lib', 'client.js'), 'utf8');
  captured = [];
  const eq = src.indexOf('(');
  const wrapped = 'window.__ModuleLoader__.load(' + src.slice(eq + 1);
  const run = new Function('window', 'require', 'document', 'console', wrapped);
  run(global.window, (s) => (s === 'react' ? react : s === 'react/jsx-runtime' ? jsxRuntime : requireBundle(s)), undefined, console);
  const def = captured[captured.length - 1];
  const out = def.factory((s) => (s === 'react' ? react : s === 'react/jsx-runtime' ? jsxRuntime : requireBundle(s)));
  bundleCache.set(spec, out);
  return out;
}

module.exports = { react, ReactDOMServer, jsxRuntime, requireBundle, loadBundle, instantiate, PROFILE, REACT_ROOT };
