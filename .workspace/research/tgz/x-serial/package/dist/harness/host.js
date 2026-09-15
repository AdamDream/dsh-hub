var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import schema from '@deepseek-ai/schemastery';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { JsonlSerialEventSink, NodeSerialPortFactory, SerialSessionManager, } from '../serial/index.js';
import { decodeSendRequest } from '../protocol.js';
export const Config = schema.object({
    logDirectory: schema.string().required(),
    ringCapacity: schema.number().step(1).min(100).default(20_000),
    snapshotLimit: schema.number().step(1).min(1).default(2_000),
});
const DEFAULT_RING_CAPACITY = 20_000;
const DEFAULT_SNAPSHOT_LIMIT = 2_000;
/** One process-wide service owns every serial RX/TX event and audit record. */
let SerialConsoleService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _listPorts_decorators;
    let _connect_decorators;
    let _disconnect_decorators;
    let _snapshot_decorators;
    let _waitSnapshot_decorators;
    let _send_decorators;
    let _mark_decorators;
    return class SerialConsoleService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _listPorts_decorators = [Remote];
            _connect_decorators = [Remote];
            _disconnect_decorators = [Remote];
            _snapshot_decorators = [Remote];
            _waitSnapshot_decorators = [Remote];
            _send_decorators = [Remote];
            _mark_decorators = [Remote];
            __esDecorate(this, null, _listPorts_decorators, { kind: "method", name: "listPorts", static: false, private: false, access: { has: obj => "listPorts" in obj, get: obj => obj.listPorts }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _connect_decorators, { kind: "method", name: "connect", static: false, private: false, access: { has: obj => "connect" in obj, get: obj => obj.connect }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _disconnect_decorators, { kind: "method", name: "disconnect", static: false, private: false, access: { has: obj => "disconnect" in obj, get: obj => obj.disconnect }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _snapshot_decorators, { kind: "method", name: "snapshot", static: false, private: false, access: { has: obj => "snapshot" in obj, get: obj => obj.snapshot }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _waitSnapshot_decorators, { kind: "method", name: "waitSnapshot", static: false, private: false, access: { has: obj => "waitSnapshot" in obj, get: obj => obj.waitSnapshot }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _send_decorators, { kind: "method", name: "send", static: false, private: false, access: { has: obj => "send" in obj, get: obj => obj.send }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _mark_decorators, { kind: "method", name: "mark", static: false, private: false, access: { has: obj => "mark" in obj, get: obj => obj.mark }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static Config = Config;
        manager = __runInitializers(this, _instanceExtraInitializers);
        constructor(ctx, config) {
            super(ctx, 'serialConsole');
            this.manager = new SerialSessionManager(new NodeSerialPortFactory(), {
                ringCapacity: config.ringCapacity ?? DEFAULT_RING_CAPACITY,
                snapshotLimit: config.snapshotLimit ?? DEFAULT_SNAPSHOT_LIMIT,
                eventSink: new JsonlSerialEventSink(config.logDirectory),
            });
            ctx.effect(() => async () => { await this.manager.close(); }, 'dsh-serial-console: close transport and audit sink');
        }
        async listPorts() {
            return await this.manager.listPorts();
        }
        async connect(request) {
            return await this.manager.connect(request);
        }
        async disconnect() {
            return await this.manager.disconnect();
        }
        snapshot(request, signal) {
            void signal;
            return this.manager.snapshot(request.afterSeq ?? 0, request.limit ?? DEFAULT_SNAPSHOT_LIMIT);
        }
        async waitSnapshot(request, signal) {
            return await this.manager.waitSnapshot(request, signal);
        }
        async send(request) {
            const bytes = decodeSendRequest(request);
            return await this.manager.send(bytes, {
                actor: request.actor,
                ...(request.text === undefined ? {} : { text: new TextDecoder().decode(bytes) }),
                ...(request.toolCallId === undefined ? {} : { toolCallId: request.toolCallId }),
            });
        }
        mark(request) {
            return this.manager.mark(request.label, request.actor, request.toolCallId);
        }
        /** Model-only bounded RX matcher; it is intentionally not a browser Remote. */
        expect(request, signal) {
            return this.manager.waitForText(request, signal);
        }
    };
})();
export { SerialConsoleService };
export default SerialConsoleService;
//# sourceMappingURL=host.js.map