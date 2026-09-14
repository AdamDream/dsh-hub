const reactStub = {
  createElement: (...args) => ({ type: args[0], props: args[1] || {}, children: args.slice(2) }),
  Fragment: "Fragment",
  useState: (init) => [typeof init === "function" ? init() : init, () => {}],
  useEffect: () => {},
  useCallback: (f) => f,
  useMemo: (f) => (typeof f === "function" ? f() : f),
  useSyncExternalStore: () => ({}),
  useRef: (v) => ({ current: v }),
};
globalThis.window = {
  __ModuleLoader__: {
    load: (entry) => {
      const face = entry.factory((name) => {
        if (name === "react") return reactStub;
        throw new Error("unexpected require: " + name);
      });
      if (entry.id !== "@local/dsh-usage") throw new Error("bad id: " + entry.id);
      if (typeof face.apply !== "function" || !Array.isArray(face.inject)) {
        throw new Error("missing exports; keys = " + Object.keys(face));
      }
      globalThis.window.__ModuleLoader__._last = face;
      return { id: entry.id, exports: face };
    },
  },
};
await import("../lib/client.js");
const face = globalThis.window.__ModuleLoader__._last;
console.log("bundle loads OK; exports =", Object.keys(face), "| inject =", JSON.stringify(face.inject));
let registered = null;
const slots = {
  inject: (name, fn) => {
    const opts = fn(); // returns ctx.slots.register(...)
    registered = opts;
    console.log("slot injected:", name, "| key:", opts.key, "| locale:", opts.locale, "| name:", opts.name);
  },
  register: (options, Component) => {
    console.log("slots.register: options.name =", options.name, "| key =", options.key, "| inject fn =", typeof options.inject === "function", "| Component =", typeof Component);
    return { ...options, Component };
  },
};
const connection = { rpc: { call: async (channel, endpoint) => { console.log("rpc.call stub:", channel, endpoint); return { ok: false, error: { code: "unavailable", message: "stub" } }; } } };
const sessions = { select: (id) => console.log("sessions.select(", id, ")") };
face.apply({ slots, connection, sessions });
console.log("apply() ran OK");
const injected = registered.inject({});
console.log("inject face keys:", Object.keys(injected), "| rpc.call:", typeof injected.rpc.call, "| sessions.select:", typeof injected.sessions.select, "| useStore:", typeof injected.useStore);
