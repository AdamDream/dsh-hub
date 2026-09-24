/**
 * orphan-settings.js — U-LD2：孤儿 settings 段巡检（**只上报、不改行为**）
 *
 * 靶点（w20 audit §2.1 S-1..S-6 / §2.3 W-2、W-3）：
 *   `dsh-settings` 的 `get(ns)` 对**未注册**命名空间返回 `undefined` 且**不抛**
 *   （`dsh-settings/lib/index.js:388-390`），消费方把它们吞成"静默回落"
 *   （`dsh-tool-subagent/lib/index.js:120-127`）⇒ 一个 `settings.yaml` 段
 *   可能**完全无效而零告警**。
 *
 * 本模块用**两个公开 API** 做差集（不碰产品代码、不改任何行为）：
 *   ① 已注册命名空间：`settings.describe()`（`dsh-settings/lib/index.js:352-382`，
 *      每个注册项返回 `ns`）
 *   ② 文档顶层段名：`settings.documentPath`（`:291` / `dsh-settings-file/lib/index.js:107`）
 *      指向的 YAML/JSON 文档
 *
 * 两个方向的差集都上报（措辞不同、级别相同，默认 info ⇒ 避免噪声误伤：
 * 用户保留的历史段是**正常用法**，不是错误）：
 *   A. **孤儿段**（文档里有、没人注册）⇒ 该段**静默无效**（audit W-3 的原靶点）
 *   B. **无文档段的注册**（注册了、文档里没写）⇒ **不是问题**（插件用默认值），
 *      仅在 `reportUnsectioned` 打开时作为"信息"输出
 *
 * 消费方普查（"注册了但没人 get"）**不做运行时插桩**（那会改行为）：
 * 改为读取**离线静态普查**产物（`censusPath`，由
 * `scripts/settings-orphan-census-v1.mjs` 生成），把"零静态消费点"的命名空间
 * 作为 **C** 类一起上报。
 */
import { readFileSync, watch } from 'node:fs';
import path from 'node:path';

/** 保守的顶层键扫描（YAML 依赖不可用时的回退）：只认第 0 列的 `key:`，并跳过块标量内容。 */
export function scanTopLevelKeys(text) {
  const keys = [];
  const lines = String(text ?? '').split(/\r?\n/);
  let blockIndent = null;
  for (const line of lines) {
    if (blockIndent !== null) {
      if (line.trim() === '') continue;
      const indent = line.length - line.trimStart().length;
      if (indent > blockIndent) continue;
      blockIndent = null;
    }
    const blockStart = /^([^\s#][^:]*):\s*[|>][-+0-9]*\s*(#.*)?$/.exec(line);
    if (blockStart) { keys.push(stripKey(blockStart[1])); blockIndent = 0; continue; }
    const m = /^([A-Za-z0-9_$@./-][^:\s]*)\s*:(\s|$)/.exec(line);
    if (m) keys.push(stripKey(m[1]));
  }
  return [...new Set(keys)];
}

function stripKey(raw) {
  const k = String(raw).trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) return k.slice(1, -1);
  return k;
}

/** 用真实 YAML 解析器取顶层键；解析器不可用或解析失败时回退到 {@link scanTopLevelKeys}。 */
export async function readTopLevelKeys(documentPath, readText = (p) => readFileSync(p, 'utf8')) {
  let text;
  try { text = readText(documentPath); } catch (error) { return { ok: false, reason: `unreadable: ${String(error?.code ?? error)}`, keys: [] }; }
  if (/^\s*\{/.test(text) || /^\s*\[/.test(text)) {
    try { const v = JSON.parse(text); return { ok: true, parser: 'json', keys: Object.keys(v ?? {}) }; } catch { /* fall through */ }
  }
  try {
    const { parse } = await import('yaml');
    const doc = parse(text);
    if (doc !== null && typeof doc === 'object' && !Array.isArray(doc)) {
      return { ok: true, parser: 'yaml-package', keys: Object.keys(doc) };
    }
    return { ok: true, parser: 'yaml-package', keys: [] };
  } catch (error) {
    return { ok: true, parser: 'regex-fallback', reason: String(error?.message ?? error), keys: scanTopLevelKeys(text) };
  }
}

/** 读离线静态普查（哪个命名空间在部署树里真的有 `get("<ns>")` 消费点）。 */
export function readCensus(censusPath) {
  if (typeof censusPath !== 'string' || censusPath.length === 0) return { ok: false, reason: 'no censusPath configured' };
  try {
    const parsed = JSON.parse(readFileSync(censusPath, 'utf8'));
    const namespaces = parsed?.namespaces ?? parsed?.data ?? null;
    if (namespaces === null || typeof namespaces !== 'object') return { ok: false, reason: 'census has no namespaces map' };
    return { ok: true, generatedAt: parsed?.generatedAt ?? null, scannedFiles: parsed?.scannedFiles ?? null, namespaces };
  } catch (error) {
    return { ok: false, reason: String(error?.code ?? error?.message ?? error) };
  }
}

/** 纯函数：给定两侧集合算出两侧差集（便于离线单测）。 */
export function diffSections({ documentKeys, registeredNamespaces, whitelist = [], census = null }) {
  const wl = new Set(whitelist);
  const registered = new Set(registeredNamespaces);
  const docKeys = [...new Set(documentKeys)].filter((k) => !wl.has(k));
  const orphans = docKeys.filter((k) => !registered.has(k)).sort();
  const unsectioned = [...registered].filter((ns) => !docKeys.includes(ns)).sort();
  let unread = [];
  let unreadKnown = false;
  if (census !== null && typeof census === 'object') {
    unreadKnown = true;
    unread = [...registered].filter((ns) => {
      const entry = census[ns];
      if (entry === undefined) return true;                       // 注册了但普查里完全没有消费点记录
      const readers = typeof entry === 'number' ? entry : entry?.readers;
      return !(typeof readers === 'number' && readers > 0);
    }).sort();
  }
  return { orphans, unsectioned, unread, unreadKnown, documentKeys: docKeys, registeredNamespaces: [...registered].sort() };
}

/**
 * 安装巡检。所有上报都走 `report`/`note` 回调（由 index.js 决定级别与出口），
 * 本模块**不注册 exporter、不改 settings**，因此可以独立停用。
 *
 * @returns {{ rerun: () => Promise<object>, stop: () => void }}
 */
export function installOrphanInspector(options) {
  const {
    getSettings,
    report,           // (text, { names, kind }) => void   —— 只上报
    reportUnsectioned = false,
    whitelist = [],
    censusPath = null,
    watchDocument = true,
    debounceMs = 400,
    onNote = () => {},
  } = options;

  let lastSignature = null;
  let watcher = null;
  let timer = null;
  let stopped = false;

  const rerun = async () => {
    if (stopped) return { skipped: 'stopped' };
    let settings;
    try { settings = getSettings(); } catch (error) { return { skipped: `settings lookup threw: ${String(error?.message ?? error)}` }; }
    if (settings === void 0 || settings === null) return { skipped: 'no settings service' };
    let documentPath;
    try { documentPath = settings.documentPath; } catch (error) { return { skipped: `documentPath threw: ${String(error?.message ?? error)}` }; }
    let registeredNamespaces;
    try { registeredNamespaces = settings.describe().map((d) => d.ns); } catch (error) { return { skipped: `describe threw: ${String(error?.message ?? error)}` }; }

    if (typeof documentPath !== 'string' || documentPath.length === 0) {
      onNote('orphan-inspect-skipped', { reason: 'non-file settings provider (documentPath undefined)' });
      return { skipped: 'non-file provider', registered: registeredNamespaces.length };
    }

    const keys = await readTopLevelKeys(documentPath);
    const censusRead = readCensus(censusPath);
    if (!censusRead.ok) onNote('orphan-census-unavailable', { reason: censusRead.reason });
    const diff = diffSections({
      documentKeys: keys.ok ? keys.keys : [],
      registeredNamespaces,
      whitelist,
      census: censusRead.ok ? censusRead.namespaces : null,
    });

    const signature = JSON.stringify([diff.orphans, reportUnsectioned ? diff.unsectioned : [], censusRead.ok ? diff.unread : []]);
    const changed = signature !== lastSignature;
    lastSignature = signature;

    if (changed && diff.orphans.length > 0) {
      report(
        `settings section(s) present in ${path.basename(documentPath)} but NOT registered by any plugin` +
        ` (silently ineffective — readers get undefined): ${diff.orphans.join(', ')}`,
        { kind: 'orphan-section', names: diff.orphans, documentPath },
      );
    }
    if (changed && reportUnsectioned && diff.unsectioned.length > 0) {
      report(
        `settings namespace(s) registered with no corresponding section in ${path.basename(documentPath)} (defaults in effect — informational): ${diff.unsectioned.join(', ')}`,
        { kind: 'unsectioned-registration', names: diff.unsectioned, documentPath },
      );
    }
    if (changed && censusRead.ok && diff.unread.length > 0) {
      report(
        `settings namespace(s) registered but with ZERO static get("<ns>") consumers in the deployed tree ` +
        `(census ${censusRead.generatedAt ?? 'unknown'}): ${diff.unread.join(', ')}`,
        { kind: 'registered-but-unread', names: diff.unread, documentPath },
      );
    }
    onNote('orphan-inspect', {
      documentPath,
      parser: keys.parser ?? null,
      registryReadError: keys.ok ? null : keys.reason,
      documentKeys: diff.documentKeys,
      registered: diff.registeredNamespaces,
      orphans: diff.orphans,
      unsectioned: diff.unsectioned,
      unread: censusRead.ok ? diff.unread : null,
      censusOk: censusRead.ok,
      censusReason: censusRead.ok ? null : censusRead.reason,
      changed,
    });
    return { ...diff, parser: keys.parser ?? null, changed };

    // 注意：watch 的注册在下面（与 rerun 解耦）
  };

  if (watchDocument) {
    const settings = getSettings();
    let documentPath;
    try { documentPath = settings?.documentPath; } catch { documentPath = undefined; }
    if (typeof documentPath === 'string' && documentPath.length > 0) {
      try {
        const dir = path.dirname(documentPath);
        const base = path.basename(documentPath);
        watcher = watch(dir, { persistent: false }, (_event, filename) => {
          if (filename !== null && String(filename) !== base) return;
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(() => { timer = null; void rerun(); }, debounceMs);
          timer.unref?.();
        });
        watcher.on('error', (error) => onNote('orphan-watch-error', { reason: String(error?.message ?? error) }));
      } catch (error) {
        onNote('orphan-watch-unavailable', { reason: String(error?.message ?? error) });
      }
    }
  }

  const stop = () => {
    stopped = true;
    if (timer !== null) { clearTimeout(timer); timer = null; }
    try { watcher?.close(); } catch { /* ignore */ }
    watcher = null;
  };

  return { rerun, stop };
}
