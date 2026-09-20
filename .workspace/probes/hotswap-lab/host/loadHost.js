/**
 * loadHost.js — 微型 loadHost：模拟 cordis-plugin-loader + cordis-plugin-hmr partialReload 的
 * 「清 ESM loadCache + CJS require.cache → 重 import → 换纤维（registry 替换）→ 失败回滚」管线。
 *
 * 对应真实实现：
 *  - loader.import / loader.unwrapExports：见 cordis-plugin-loader/lib/index.js
 *  - partialReload 缓存清理：见 cordis-plugin-hmr/lib/index.js:352-435
 *  - 换纤维：registry.delete(oldPlugin) + registry.plugin(newPlugin, oldConfig)
 *
 * 策略（strategy）：
 *  - "internal"：真清 Node internal loadCache（Map.prototype.delete.call）—— cordis 官方做法
 *  - "query"：import 带版本 query（cache-busting URL）—— 不碰 internal 的替代手段
 *  - "cjs-only"：只清 require.cache（用于纯 CJS 宿主场景对照）
 */
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const _require = createRequire(import.meta.url);

let _internal = null;
function getInternal() {
  if (_internal) return _internal;
  // Node 22 无公开 ESM 缓存清法；走 --expose-internals 取 internal loader（生产用
  // node-addon-require-builtin，语义一致——只关心 loadCache 这个 Map 的读写形态）。
  const { getOrInitializeCascadedLoader } = _require("internal/modules/esm/loader");
  _internal = getOrInitializeCascadedLoader();
  return _internal;
}

// 兼容 Node 22/23 plain Map 与 Node 24 LoadCache 子类：绕过子类覆写，直接操作 Map 槽位
const mapGet = Map.prototype.get;
const mapDelete = Map.prototype.delete;
const mapSet = Map.prototype.set;
const mapHas = Map.prototype.has;

export class LoadHost {
  constructor({ strategy = "internal", baseDir = process.cwd() } = {}) {
    this.strategy = strategy;
    this.registry = new Map(); // name -> fiber
    this.require = createRequire(pathToFileURL(baseDir + "/index.js").href);
    this.loadCache = strategy === "query" ? null : getInternal().loadCache;
    this.seq = 0;
    this.swapCount = 0;
    this.rollbackCount = 0;
  }

  /** 归一化 ESM/CJS 导出形状（仿 loader.unwrapExports：取 default，除非 default 即命名空间本体） */
  unwrapExports(ns) {
    if (ns?.default && (typeof ns.default === "function" || typeof ns.default === "object")) {
      // CJS 经 import() 装载时 default 就是 module.exports；ESM 真 default 导出也走这里
      return ns.default;
    }
    return ns;
  }

  /** 清单个 URL 的 ESM loadCache 条目（仿 hmr:368-381） */
  clearEsm(url) {
    if (this.strategy === "query") return false;
    mapDelete.call(this.loadCache, url);
    return true;
  }

  /** 清单个文件路径的 CJS require.cache 条目（仿 hmr:375-379） */
  clearCjs(filepath) {
    if (this.require.cache[filepath]) {
      delete this.require.cache[filepath];
      return true;
    }
    return false;
  }

  backup(url, filepath) {
    const esm = this.strategy === "query" ? undefined : mapGet.call(this.loadCache, url);
    const cjs = this.require.cache[filepath];
    return { esm, cjs };
  }

  restore(url, filepath, { esm, cjs }) {
    if (this.strategy !== "query" && esm !== undefined) mapSet.call(this.loadCache, url, esm);
    if (cjs) this.require.cache[filepath] = cjs;
  }

  /** 装载并挂到模拟 registry（registry 值 = fiber { plugin, config, disposed, api }） */
  async load(name, specifier, config = {}) {
    const url = this.strategy === "query"
      ? specifier + (specifier.includes("?") ? "&" : "?") + `hr=${++this.seq}`
      : specifier;
    const ns = await import(url);
    const plugin = this.unwrapExports(ns);
    const fiber = {
      name, plugin, config, disposed: false,
      api: plugin.api ?? plugin, // 插件暴露给外界的 API 面
      dispose() { this.disposed = true; },
    };
    this.registry.set(name, fiber);
    return fiber;
  }

  /**
   * 热换核心：清缓存 → 重 import → 换纤维（registry 替换）→ 失败回滚。
   * @param name  registry 里的纤维名
   * @param specifier  文件 URL（可带 query）
   * @param config  新纤维配置（缺省沿用旧纤维 config，仿 hmr reload(plugin, oldFiber._config)）
   * @param extraUrls  额外需要清缓存的 URL 数组（如被改动的依赖文件；仿 hmr accepted 循环）
   * @returns {{ok:true, fiber, old}|{ok:false, error, old}}
   */
  async hotSwap(name, specifier, config, extraUrls = []) {
    const old = this.registry.get(name);
    if (!old) throw new Error(`no fiber registered: ${name}`);
    // query 策略：为本次热换追加新 query，强制走新 URL（否则命中缓存，换不生效）
    const url = this.strategy === "query"
      ? specifier + (specifier.includes("?") ? "&" : "?") + `hr=${++this.seq}`
      : specifier;
    // 清缓存目标 = 入口 + 额外依赖（仿 hmr accepted set：变更文件及其依赖全部清）
    const targets = [url, ...extraUrls.map((u) => this.strategy === "query"
      ? u + (u.includes("?") ? "&" : "?") + `hr=${++this.seq}` : u)];
    const filepath = fileURLToPath(url.split("?")[0]);
    const nextConfig = config ?? old.config;

    // 1) 备份两套缓存（仿 hmr:368-370）
    const backups = targets.map((u) => {
      const fp = fileURLToPath(u.split("?")[0]);
      return { url: u, filepath: fp, backup: this.backup(u, fp) };
    });

    // 2) 清两套缓存（仿 hmr:371-381）
    const clearedEsm = targets.map((u) => this.clearEsm(u));
    const clearedCjs = targets.map((u) => this.clearCjs(fileURLToPath(u.split("?")[0])));

    // 3) 重 import
    let ns;
    try {
      ns = await import(url);
    } catch (error) {
      // 4) 失败回滚：恢复缓存 + 保留旧纤维（仿 hmr:382-385, 420-432）
      for (const { url: u, filepath: fp, backup } of backups) this.restore(u, fp, backup);
      this.rollbackCount++;
      return { ok: false, error, old, clearedEsm, clearedCjs };
    }
    const plugin = this.unwrapExports(ns);

    // 5) 换纤维：旧纤维 dispose + registry 替换（仿 hmr:406, 393-400）
    old.dispose();
    const fiber = {
      name, plugin, config: nextConfig, disposed: false,
      api: plugin.api ?? plugin,
      dispose() { this.disposed = true; },
    };
    this.registry.set(name, fiber);
    this.swapCount++;
    return { ok: true, fiber, old, clearedEsm, clearedCjs };
  }

  /** 观测：真实 internal loadCache 里匹配某子串的条目数（与策略无关，总是读真实缓存） */
  countCacheEntries(substr) {
    try {
      const lc = getInternal().loadCache;
      let n = 0;
      for (const k of lc.keys()) if (String(k).includes(substr)) n++;
      return n;
    } catch {
      return 0;
    }
  }

  /** 观测：require.cache 里匹配某子串的条目数 */
  countCjsEntries(substr) {
    let n = 0;
    for (const p of Object.keys(this.require.cache)) if (p.includes(substr)) n++;
    return n;
  }
}

export function fileURL(spec) {
  return pathToFileURL(spec).href;
}
