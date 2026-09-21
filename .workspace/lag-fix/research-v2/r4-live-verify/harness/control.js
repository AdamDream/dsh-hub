// R4 host bootstrap 测试台的共享控制面。桩模块从这里读取可注入的延迟/故障，
// 测试用例写入这里，真实 index.js 完全不知情（它只看到正常的 db/ingest 模块）。
export const control = {
  openDelayMs: 0,
  ingestDelayMs: 0,
  schemaShouldThrow: false,
  openedDbs: [],
  closedCount: 0,
  ensureSchemaCalls: 0,
  foldCalls: 0,
  rpc: null,
  logs: [],
  createdTimers: 0,
  clearedTimers: 0,
};

export function reset(overrides = {}) {
  control.openDelayMs = 0;
  control.ingestDelayMs = 0;
  control.schemaShouldThrow = false;
  control.openedDbs = [];
  control.closedCount = 0;
  control.ensureSchemaCalls = 0;
  control.foldCalls = 0;
  control.rpc = null;
  control.logs = [];
  control.createdTimers = 0;
  control.clearedTimers = 0;
  Object.assign(control, overrides);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 与 cordis ctx 同构的最小测试上下文。 */
export function makeCtx() {
  const disposers = [];
  // timers 只记**存活**句柄：创建后立刻被 disposer 清除的 timer 会销账。
  // （曾经的插桩只记创建不销账 → 把「创建后立即清除」误报成「仍在轮询」。）
  const timers = [];
  const ctx = {
    logger: {
      info: (m) => control.logs.push(['info', m]),
      warn: (m) => control.logs.push(['warn', m]),
      error: (m) => control.logs.push(['error', m]),
    },
    settings: { register: () => control.logs.push(['info', 'settings.register']) },
    inject: (_list, fn) => fn(ctx),
    effect: (fn) => {
      const disposer = fn();
      if (typeof disposer === 'function') disposers.push(disposer);
      return disposer;
    },
    setInterval: (fn, ms) => {
      const handle = setInterval(fn, ms);
      control.createdTimers += 1;
      timers.push({ ms, handle });
      return () => {
        clearInterval(handle);
        const i = timers.findIndex((t) => t.handle === handle);
        if (i >= 0) timers.splice(i, 1);
        control.clearedTimers += 1;
      };
    },
    _timers: timers,
    _dispose: () => {
      for (const disposer of disposers.splice(0)) disposer();
    },
  };
  return ctx;
}
