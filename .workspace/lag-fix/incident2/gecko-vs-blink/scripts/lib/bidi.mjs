/*
 * Minimal WebDriver BiDi client (no external deps; Node >= 22 native WebSocket).
 *
 * Why BiDi and not CDP: the only Gecko available on this host is the snap
 * Firefox 155 (/snap/firefox/8863). Playwright's bundled firefox build is NOT
 * present in ~/.cache/ms-playwright (only chromium-1148 +
 * chromium_headless_shell-1148), and Playwright's firefox driver requires its
 * own patched juggler build, so playwright.firefox.launch() cannot drive a
 * stock/snap Firefox. Firefox 155 also no longer serves /json/version (CDP was
 * removed), so the only remote-control channel it exposes is WebDriver BiDi:
 *   WebDriver BiDi listening on ws://127.0.0.1:<port>   (endpoint: /session)
 *
 * This client implements exactly the subset the measurement harness needs:
 *   session.new / session.end
 *   browsingContext.create / navigate / setViewport / close
 *   script.addPreloadScript / evaluate / callFunction
 *   input.performActions  (real browser-level pointer input)
 * It never runs any browser-level teardown other than closing the connection and
 * (in ff.mjs) signalling the OWN child process it spawned itself.
 */

const CONNECT_TIMEOUT_MS = 15_000;
const CMD_TIMEOUT_MS = 60_000;

export class BidiClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.eventHandlers = new Map();
    this.closed = false;
    this.lastError = null;
  }

  static async connect(baseWsUrl, { timeoutMs = CONNECT_TIMEOUT_MS } = {}) {
    const url = baseWsUrl.replace(/\/+$/, '') + '/session';
    const client = new BidiClient(url);
    await client._open(timeoutMs);
    return client;
  }

  _open(timeoutMs) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      const timer = setTimeout(() => {
        try { ws.close(); } catch { }
        reject(new Error(`BiDi connect timeout after ${timeoutMs}ms to ${this.wsUrl}`));
      }, timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); });
      ws.addEventListener('error', (ev) => {
        clearTimeout(timer);
        reject(new Error(`BiDi websocket error: ${this.lastError || (ev && ev.message) || 'unknown'}`));
      });
      ws.addEventListener('message', (ev) => this._onMessage(ev.data));
      ws.addEventListener('close', () => {
        this.closed = true;
        for (const [, p] of this.pending) p.reject(new Error('BiDi socket closed'));
        this.pending.clear();
      });
    });
  }

  _onMessage(data) {
    let msg;
    try { msg = JSON.parse(typeof data === 'string' ? data : String(data)); } catch { return; }
    if (msg.id != null && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.type === 'error') {
        const err = new Error(`BiDi ${p.method} failed: ${msg.error} ${msg.message || ''}`);
        err.bidiError = msg.error;
        err.bidiMessage = msg.message;
        p.reject(err);
      } else {
        p.resolve(msg.result);
      }
      return;
    }
    if (msg.type === 'event') {
      const hs = this.eventHandlers.get(msg.method) || [];
      for (const h of hs) { try { h(msg.params); } catch { } }
    }
  }

  on(method, handler) {
    const hs = this.eventHandlers.get(method) || [];
    hs.push(handler);
    this.eventHandlers.set(method, hs);
  }

  send(method, params = {}, { timeoutMs = CMD_TIMEOUT_MS } = {}) {
    if (this.closed) return Promise.reject(new Error('BiDi socket already closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`BiDi ${method} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }

  /* ------------------------------------------------------------- conveniences */

  async newSession(capabilities = {}) {
    // A failure here means "already in a session" on some builds; treat as fatal
    // only when the socket also cannot be used for a trivial command.
    try {
      return await this.send('session.new', { capabilities });
    } catch (e) {
      this.lastError = e.message;
      return null;
    }
  }

  async endSession() {
    try { return await this.send('session.end', {}, { timeoutMs: 5000 }); } catch { return null; }
  }

  async createContext(type = 'tab') {
    const r = await this.send('browsingContext.create', { type });
    return r.context;
  }

  async navigate(context, url, wait = 'complete') {
    return this.send('browsingContext.navigate', { context, url, wait }, { timeoutMs: 90_000 });
  }

  async closeContext(context) {
    try { return await this.send('browsingContext.close', { context }, { timeoutMs: 10_000 }); } catch { return null; }
  }

  async setViewport(context, { width, height, devicePixelRatio }) {
    const params = { context, viewport: { width, height } };
    if (devicePixelRatio != null) params.devicePixelRatio = devicePixelRatio;
    const r = await this.send('browsingContext.setViewport', params);
    if (r && r.devicePixelRatio != null) return r.devicePixelRatio;
    return null;
  }

  async addPreloadScript(functionDeclaration, contexts = undefined) {
    const params = { functionDeclaration };
    if (contexts) params.contexts = contexts;
    const r = await this.send('script.addPreloadScript', params);
    return r.script;
  }

  /** Evaluate an expression; throws with the page's own error text on page errors. */
  async evaluate(context, expression, { awaitPromise = true, timeoutMs = CMD_TIMEOUT_MS } = {}) {
    const r = await this.send('script.evaluate', {
      expression,
      target: { context },
      awaitPromise,
      resultOwnership: 'root',
    }, { timeoutMs });
    if (r && r.type === 'exception') {
      const d = r.exceptionDetails || {};
      throw new Error(`page exception: ${d.text || ''} ${(d.exception && d.exception.description) || ''}`);
    }
    return unwrap(r && r.result);
  }

  async callFunction(context, functionDeclaration, args = [], { awaitPromise = true, timeoutMs = CMD_TIMEOUT_MS } = {}) {
    const r = await this.send('script.callFunction', {
      functionDeclaration,
      target: { context },
      arguments: args.map((a) => ({ type: 'string', value: String(a) })),
      awaitPromise,
      resultOwnership: 'root',
    }, { timeoutMs });
    if (r && r.type === 'exception') {
      const d = r.exceptionDetails || {};
      throw new Error(`page exception: ${d.text || ''} ${(d.exception && d.exception.description) || ''}`);
    }
    return unwrap(r && r.result);
  }

  close() {
    try { this.ws.close(); } catch { }
    this.closed = true;
  }
}

/** BiDi RemoteValue -> plain JS (numbers/strings/bools/objects; enough for our probes). */
export function unwrap(rv) {
  if (rv == null) return null;
  switch (rv.type) {
    case 'undefined': return undefined;
    case 'null': return null;
    case 'string': return rv.value;
    case 'boolean': return rv.value;
    case 'number':
      if (rv.value === 'NaN') return NaN;
      if (rv.value === 'Infinity') return Infinity;
      if (rv.value === '-Infinity') return -Infinity;
      if (rv.value === '-0') return -0;
      return Number(rv.value);
    case 'bigint': return Number(rv.value);
    case 'array':
    case 'set':
      return (rv.value || []).map(unwrap);
    case 'object':
    case 'map': {
      const out = {};
      for (const [k, v] of rv.value || []) out[k] = unwrap(v);
      return out;
    }
    default:
      return rv.value === undefined ? null : rv.value;
  }
}
