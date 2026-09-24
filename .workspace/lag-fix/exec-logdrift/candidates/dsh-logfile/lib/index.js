/**
 * @local/dsh-logfile — 宿主侧**持久日志出口**（U-LD1）+ 孤儿 settings 段巡检（U-LD2）
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 为什么需要它（w20 audit §4.1/§4.2 的双重黑洞，本单元落地其热面修法）
 *   ① 宿主**唯一** exporter 是零读取点的 1000 条内存环形缓冲
 *      （`cordis/lib/index.js:583-604`；全树无读取点）。
 *   ② 更严重：该内置 exporter **不声明 `levels`**（`:598-603`），而阈值解析是
 *      `exporter.levels?.[name] ?? exporter.levels?.default ?? this.level ?? 1`
 *      （`:474`），本部署三层活跃 patch + home 层**都没有 `logger:` 条目**
 *      ⇒ 阈值 = 1；级别定义 `error=0/info=1/warn=2/debug=3`（`:457-460`）
 *      ⇒ **`warn` 与 `debug` 连环形缓冲都进不去，被 `continue` 直接丢弃**。
 *   ⇒ 本插件做两件事：**(a) 显式声明 `levels` 打开 warn**；**(b) 把消息写进有界文件**。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 两个必须写进实现的坑（w20 audit §4.3 P-1/P-2 —— 其中 P-1 的**前提经本次实测修正**）
 *
 *   P-2（**保留原样，是硬要求**）：必须**显式**写 `levels`。不写就等于继承"被丢弃"的现状。
 *
 *   P-1（**前提修正，见 raw/probe-cordis-effect-v1.json 的 Q5/Q7 实测**）：
 *     审计原文断言"`exporter()` 的 effect 挂在根 ctx ⇒ 卸载不回收 ⇒ 必须自登记 `ctx.effect`"。
 *     实测（真实 cordis 包，离线）证明**该断言对插件作用域的调用不成立**：
 *       `logger` 服务带 tracker `{property:'ctx', noShadow:true}`，其 traceable 代理在取
 *       `prop === 'ctx'` 时**返回访问者 ctx**（`cordis/lib/index.js:123-128`）⇒ 插件内
 *       `ctx.logger.ctx === ctx`（实测 `pluginCtxIsLoggerCtx: true`）⇒ `exporter()` 里的
 *       `this.ctx.effect(...)` 落在**插件自己的 fiber** 上 ⇒ **插件卸载时自动回收**
 *       （实测：`exporters.size` 2 → 1，且卸载后同一 `warn` 不再被收到）。
 *     反例实测（`ctx.root.logger.exporter(...)`）：`exporters.size` 停在 2，卸载后仍收到
 *       `warn` ⇒ **泄漏**。⇒ 结论：**必须用插件作用域的 `ctx.logger`，绝不可用 `ctx.root.logger`**。
 *
 *   ⇒ **自登记 `ctx.effect` 仍然是必需的**，但理由不是回收 exporter，而是**回收文件句柄/刷新**：
 *     `fs.WriteStream` **没有** `unref()`（实测 `typeof stream.unref === 'undefined'`），
 *     只有插件的 effect cleanup 会 `end()` 它。两件事在同一次 cleanup 里做完、且全程幂等。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 有界性（"不得无限增长"，见 jsonl-sink.js 头部）
 *   硬顶 = `maxBytes * maxFiles`（默认 8 MiB × 3 = 24 MiB）；`maxFiles: 1` 时改为截断重开；
 *   轮转走**同步 rename**（无内存队列 ⇒ 风暴下不丢行）；单行 ≤ `maxLineBytes` 字节；`export()` **永不抛**
 *   （`Logger._method` 里 `exporter.export(message)` 无 try/catch，`cordis/lib/index.js:484`）。
 *
 * 挂载方式（热①，零重启）：`~/.dsh/profiles/web/cordis.patch.yml` 末尾追加
 *   - insert:
 *       - id: logfile
 *         name: '@local/dsh-logfile'
 *         config: { level: 2 }
 */
import { homedir } from 'node:os';
import path from 'node:path';
import { JsonlSink, clampLine } from './jsonl-sink.js';
import { installOrphanInspector } from './orphan-settings.js';

export const name = '@local/dsh-logfile';
/** 无服务依赖 ⇒ 尽早激活（也能尽早开始记录）。 */
export const inject = [];

export const DEFAULT_CONFIG = Object.freeze({
  /** 日志目录；`null` ⇒ `<DSH_HOME>/logs`（与 `dsh-home-paths` 同语义）。 */
  dir: null,
  /** 覆盖 harness home（默认按 `DSH_HOME` 环境变量，否则 `~/.dsh`）。 */
  dshHome: null,
  file: 'dsh-host.jsonl',
  /** **必须显式**：2 = error+info+warn；3 = 含 debug。默认 2（不含 debug，控制写盘量）。 */
  level: 2,
  maxBytes: 8 * 1024 * 1024,
  maxFiles: 3,
  maxLineBytes: 8192,
  /** 是否把原始 args 一并落盘（默认只落渲染后的 msg；打开会显著增大行宽）。 */
  keepArgs: false,
  /** 生命周期/自证报告（小文件、单文件截断策略），用于验收与自检。 */
  lifecycle: true,
  lifecycleFile: 'dsh-logfile-lifecycle.jsonl',
  lifecycleMaxBytes: 256 * 1024,
  /** U-LD2：孤儿 settings 段巡检（只上报）。 */
  orphanWatch: true,
  orphanWhitelist: [],
  orphanReportUnsectioned: false,
  /** 离线静态消费点普查产物路径（`scripts/settings-orphan-census-v1.mjs` 生成）。 */
  orphanCensusPath: null,
});

/**
 * 与 `@deepseek-ai/dsh-home-paths` 的 `resolveDshHome()` **同语义**实现
 * （`dsh-home-paths/lib/index.js:resolveDshHome/expandHomePath/defaultDshHome`）：
 * 配置优先 → 环境变量 `DSH_HOME`（trim 后非空）→ `~/.dsh`。
 * 这里**故意不 import 该包**：本插件是"观测能力"的载体，必须在任何解析失败下都能起来。
 */
export function resolveDshHome(configured, env = process.env) {
  const raw = configured ?? (typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim().length > 0 ? env.DSH_HOME.trim() : null);
  if (raw === null) return path.join(homedir(), '.dsh');
  if (raw === '~') return homedir();
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(homedir(), raw.slice(2));
  return path.resolve(raw);
}

/**
 * JSON 保真的安全序列化（用于 `%o/%O/%j` 与对象型参数）：保留数字/布尔/嵌套类型，
 * 只把 BigInt/Symbol/函数/循环引用降级为字符串。cordis 的 `defaultFormatters.o`
 * 就是裸 `JSON.stringify`（`:405-406`）⇒ 这里必须同形，否则 `{a:1}` 会渲染成 `{"a":"1"}`。
 */
export function safeJson(value, space) {
  const seen = new WeakSet();
  try {
    const text = JSON.stringify(value, (_key, v) => {
      if (typeof v === 'bigint') return `${v}n`;
      if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`;
      if (typeof v === 'symbol') return String(v);
      if (v instanceof Error) return v.stack ?? `${v.name}: ${v.message}`;
      if (v instanceof WeakRef) return '[WeakRef]';
      if (v instanceof Map) return Object.fromEntries([...v.entries()]);
      if (v instanceof Set) return [...v];
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[circular]';       // 共享引用也会被标为 circular：宁可降级也不抛
        seen.add(v);
      }
      return v;
    }, space);
    return text === void 0 ? String(value) : text;
  } catch { return '[unserializable]'; }
}

const defaultFormatters = {
  s: (value) => String(value),
  d: (value) => String(Math.trunc(Number(value))),
  i: (value) => String(Math.trunc(Number(value))),
  f: (value) => String(Number(value)),
  o: (value) => safeJson(value),
  O: (value) => safeJson(value),
  c: () => '',
  C: (value) => String(value),          // colors: 0 ⇒ 与 cordis Logger.color 的无色分支等价
};

/** 安全序列化：循环/BigInt/Symbol/函数/超深结构一律退化为字符串，**永不抛**。 */
export function safeStringify(value, depth = 0, seen = new Set()) {
  try {
    if (value === null) return 'null';
    const t = typeof value;
    if (t === 'string') return value;
    if (t === 'number' || t === 'boolean') return String(value);
    if (t === 'bigint') return `${value}n`;
    if (t === 'undefined') return 'undefined';
    if (t === 'symbol') return String(value);
    if (t === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
    if (depth > 4) return '[depth-limit]';
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    if (Array.isArray(value)) {
      const head = value.slice(0, 20).map((v) => safeStringify(v, depth + 1, seen));
      if (value.length > 20) head.push(`…+${value.length - 20} more`);
      return `[${head.join(', ')}]`;
    }
    if (value instanceof Map) return `Map(${value.size})${safeStringify([...value.entries()].slice(0, 20), depth + 1, seen)}`;
    if (value instanceof Set) return `Set(${value.size})${safeStringify([...value].slice(0, 20), depth + 1, seen)}`;
    if (value instanceof WeakRef) return '[WeakRef]';
    if (value instanceof Date) return value.toISOString();
    if (Buffer.isBuffer(value)) return `[Buffer ${value.length}B]`;
    const out = {};
    for (const key of Object.keys(value).slice(0, 40)) {
      try { out[key] = safeStringify(value[key], depth + 1, seen); } catch { out[key] = '[unreadable]'; }
    }
    return JSON.stringify(out);
  } catch {
    try { return String(value); } catch { return '[unserializable]'; }
  }
}

/** 复刻 `Logger.format()`（`cordis/lib/index.js:431-452`）在 `colors: 0` 下的可读文本。 */
export function renderMessage(message) {
  const args = Array.isArray(message?.args) ? message.args.slice() : [];
  if (args.length === 0) return '';
  if (args[0] instanceof Error) { args[0] = args[0].stack || args[0].message; args.unshift('%s'); }
  else if (typeof args[0] !== 'string') args.unshift('%o');
  const raw = args.shift();                 // ⚠️ 只能 shift 一次（写两次 shift 会吞掉第一个参数）
  let format = typeof raw === 'string' ? raw : String(raw);
  format = String(format).replace(/%([a-zA-Z%])/g, (match, char) => {
    if (match === '%%') return '%';
    const formatter = defaultFormatters[char];
    if (typeof formatter === 'function') return formatter(args.shift());
    return match;
  });
  for (const arg of args) {
    format += ' ' + (arg !== null && typeof arg === 'object' ? safeJson(arg) : String(arg));
  }
  return format;
}

/** 把 cordis 日志消息转成一行 JSONL 记录（字段名稳定，便于 grep/统计）。 */
export function toRecord(message, options = {}) {
  const ts = typeof message?.ts === 'number' ? message.ts : Date.now();
  const record = {
    ts,
    iso: new Date(ts).toISOString(),
    type: message?.type ?? 'unknown',
    level: typeof message?.level === 'number' ? message.level : null,
    name: message?.name ?? null,
    sn: message?.sn ?? null,
    msg: renderMessage(message),
  };
  if (options.keepArgs === true) {
    record.args = (message?.args ?? []).slice(0, 20).map((a) => {
      const text = a instanceof Error ? safeStringify(a)
        : (a !== null && typeof a === 'object' ? safeJson(a) : String(a));
      return text.length > 2000 ? text.slice(0, 2000) + '…' : text;
    });
  }
  return record;
}

function normalizeConfig(config) {
  const cfg = { ...DEFAULT_CONFIG, ...(config ?? {}) };
  if (Array.isArray(cfg.orphanWhitelist) !== true) cfg.orphanWhitelist = [];
  if (typeof cfg.level !== 'number' || Number.isFinite(cfg.level) !== true) cfg.level = DEFAULT_CONFIG.level;
  return cfg;
}

function newExporterKeys(service, beforeKeys) {
  const added = [];
  for (const key of service.exporters.keys()) if (!beforeKeys.has(key)) added.push(key);
  return added;
}

export function apply(ctx, config) {
  const cfg = normalizeConfig(config);
  const dir = cfg.dir !== null && cfg.dir !== void 0 && String(cfg.dir).length > 0
    ? path.resolve(String(cfg.dir))
    : path.join(resolveDshHome(cfg.dshHome), 'logs');

  const sink = new JsonlSink({
    dir,
    file: cfg.file,
    maxBytes: cfg.maxBytes,
    maxFiles: cfg.maxFiles,
    maxLineBytes: cfg.maxLineBytes,
  });
  const lifecycle = cfg.lifecycle === true
    ? new JsonlSink({ dir, file: cfg.lifecycleFile, maxBytes: cfg.lifecycleMaxBytes, maxFiles: 1, maxLineBytes: 4096 })
    : null;

  const bootAt = Date.now();
  const note = (event, extra = {}) => {
    lifecycle?.writeRecord({ ts: Date.now(), iso: new Date().toISOString(), pid: process.pid, event, ...extra });
  };

  note('plugin-apply', {
    dir,
    file: cfg.file,
    level: cfg.level,
    maxBytes: sink.maxBytes,
    maxFiles: sink.maxFiles,
    hardCeilingBytes: sink.hardCeilingBytes,
    starterBytes: sink.bytes,
    dshHome: resolveDshHome(cfg.dshHome),
    node: process.version,
  });

  // ── 出口：显式 levels（P-2）+ 插件作用域 ctx.logger（P-1 修正后的正确写法）
  ctx.effect(() => {
    const service = ctx.logger;                       // ⚠️ 绝不可写成 ctx.root.logger（实测会泄漏）
    const keysBefore = new Set(service.exporters.keys());
    const dispose = service.exporter({
      colors: 0,
      levels: { default: cfg.level },                 // ← warn 能否进缓冲**完全**取决于这一行
      export: (message) => {
        // 永不抛：该函数在 Logger._method 的同步路径里被直接调用，抛错会污染产品侧调用点。
        try { sink.writeRecord(toRecord(message, { keepArgs: cfg.keepArgs === true })); } catch { /* swallowed by design */ }
      },
    });
    const addedKeys = newExporterKeys(service, keysBefore);
    const myKey = addedKeys.length === 1 ? addedKeys[0] : null;
    note('exporter-registered', {
      myKey,
      addedKeys,
      exportersSizeAfter: service.exporters.size,
      level: cfg.level,
      levelsDeclared: true,
      exporterCtxIsPluginCtx: service.ctx === ctx,
      sink: { path: sink.path, maxBytes: sink.maxBytes, maxFiles: sink.maxFiles, hardCeilingBytes: sink.hardCeilingBytes, starterBytes: sink.bytes },
    });
    // 阳性对照：一条 info 行。它在 level=1 的对照臂里**仍应出现**（证明 exporter 活着，
    // 而缺失的 warn 行只能由级别过滤解释）—— 见 scripts/boot-probe-v1.mjs 的 ARM-CONTROL。
    try { ctx.logger('dsh-logfile').info('host log exporter active', { file: sink.path, level: cfg.level, ceiling: sink.hardCeilingBytes }); } catch { /* ignore */ }

    return () => {
      const presentAtCleanup = myKey !== null ? service.exporters.has(myKey) : null;
      let disposeError = null;
      try { dispose(); } catch (error) { disposeError = String(error?.message ?? error); }
      const presentAfterDisposer = myKey !== null ? service.exporters.has(myKey) : null;
      note('exporter-disposed', {
        myKey,
        presentAtCleanup,
        presentAfterDisposer,
        exportersSizeAfter: service.exporters.size,
        disposeError,
        sink: sink.stats(),
        uptimeMs: Date.now() - bootAt,
      });
      sink.close();
      lifecycle?.writeRecord({ ts: Date.now(), iso: new Date().toISOString(), event: 'sink-closed', sink: sink.stats() });
      lifecycle?.close();
    };
  }, '@local/dsh-logfile: exporter');

  // ── U-LD2：孤儿 settings 段巡检（只上报，不改行为）
  // ⚠️ 必须走 `ctx.inject(['settings'], ...)`：在**非注入**的插件 ctx 上访问未注入的服务会被
  //    cordis 的 reflect 层抛 "cannot get property ... without inject"（`cordis/lib/index.js:675-676`），
  //    而 `dsh-tool-subagent` 正是把该异常吞成 `undefined` 才产生"静默回落"（audit §2.1 S-3）。
  //    这里显式声明注入 ⇒ 一旦 settings 缺失/被卸载，巡检 fiber 自动停用，**不会**误报。
  if (cfg.orphanWatch === true) {
    const report = (text, meta) => {
      try { ctx.logger('dsh-logfile').info(text, meta.names.join(',')); } catch { /* ignore */ }
      note('orphan-settings-report', meta);
    };
    try {
      ctx.inject(['settings'], (sctx) => {
        const getSettings = () => {
          try { return sctx.settings; } catch { try { return sctx.get('settings'); } catch { return void 0; } }
        };
        sctx.effect(() => {
          const inspector = installOrphanInspector({
            getSettings,
            report,
            reportUnsectioned: cfg.orphanReportUnsectioned === true,
            whitelist: cfg.orphanWhitelist,
            censusPath: cfg.orphanCensusPath,
            watchDocument: true,
            onNote: note,
          });
          Promise.resolve()
            .then(() => inspector.rerun())
            .catch((error) => note('orphan-inspect-error', { reason: String(error?.message ?? error) }));
          return () => { try { inspector.stop(); } catch { /* ignore */ } };
        }, '@local/dsh-logfile: orphan-settings');
      });
    } catch (error) {
      note('orphan-inspector-unavailable', { reason: String(error?.message ?? error) });
    }
  }

  // 暴露一个**只读**自检句柄（不提供任何写能力），供验收脚本/自检读取 sink 统计。
  try {
    ctx.provide('logfileStats', () => ({ sink: sink.stats(), level: cfg.level, dir, file: cfg.file }));
  } catch (error) {
    note('logfile-stats-provide-failed', { reason: String(error?.message ?? error) });
  }
}

export { JsonlSink, clampLine };
export default { name, inject, apply };
