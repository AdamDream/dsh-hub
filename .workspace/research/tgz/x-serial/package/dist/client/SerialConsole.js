import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AiActivityPanel } from './AiActivityPanel.js';
import { deriveAiActivity } from './ai-activity.js';
import { clampAiPanelWidth, loadAiPanelPreferences, saveAiPanelPreferences, } from './ai-panel-preferences.js';
import { XtermSerialTerminal } from './XtermSerialTerminal.js';
import { createTerminalCheckpointCache } from './terminal-checkpoint.js';
import './serial-console.css';
const UI_MEMORY = new WeakMap();
/** Standalone serial console combining xterm with Host connection controls. */
export function SerialConsole({ store, useConversation }) {
    if (useConversation === undefined)
        return _jsx(SerialConsoleSurface, { store: store });
    return _jsx(ConversationAwareSerialConsole, { store: store, useConversation: useConversation });
}
function ConversationAwareSerialConsole({ store, useConversation, }) {
    const conversation = useConversation(selectConversation);
    const activity = useMemo(() => deriveAiActivity(conversation), [conversation]);
    return _jsx(SerialConsoleSurface, { store: store, aiActivity: activity });
}
function selectConversation(snapshot) {
    return snapshot;
}
function SerialConsoleSurface({ store, aiActivity, }) {
    const uiMemory = useMemo(() => memoryFor(store), [store]);
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    const [mode, setMode] = useState('text');
    const [follow, setFollow] = useState(true);
    const [findOpen, setFindOpen] = useState(false);
    const [hiddenBeforeSeq, setHiddenBeforeSeq] = useState(uiMemory.hiddenBeforeSeq);
    const [aiPanel, setAiPanel] = useState(loadAiPanelPreferences);
    const [aiUnread, setAiUnread] = useState(false);
    const workbenchRef = useRef(null);
    const panelWidthRef = useRef(aiPanel.width);
    const dragRef = useRef();
    const pendingWidthRef = useRef();
    const resizeFrameRef = useRef();
    const activitySignatureRef = useRef(aiActivity?.signature);
    useEffect(() => {
        const stop = store.start();
        void store.loadPorts();
        return stop;
    }, [store]);
    useEffect(() => () => {
        if (resizeFrameRef.current !== undefined)
            cancelAnimationFrame(resizeFrameRef.current);
    }, []);
    useEffect(() => {
        if (aiActivity === undefined || aiActivity.signature === activitySignatureRef.current)
            return;
        activitySignatureRef.current = aiActivity.signature;
        if (aiPanel.open)
            setAiUnread(false);
        else if (aiActivity.status !== 'idle')
            setAiUnread(true);
    }, [aiActivity, aiPanel.open]);
    const visibleEvents = useMemo(() => state.events.filter(event => event.seq > hiddenBeforeSeq).slice(-2_000), [hiddenBeforeSeq, state.events]);
    const connected = state.remote.status === 'connected';
    const busy = state.remote.status === 'opening' || state.remote.status === 'closing';
    const synchronizationStopped = state.syncFault !== undefined;
    const disconnectAvailable = connected
        || (synchronizationStopped && state.remote.status !== 'disconnected');
    const terminalInputEnabled = connected && !synchronizationStopped;
    const synchronizationError = state.syncFault ?? state.syncError;
    const checkpointKey = `${state.remote.sessionId ?? 'disconnected'}:${hiddenBeforeSeq}`;
    const toggleConnection = async () => {
        if (disconnectAvailable) {
            await store.disconnect();
            return;
        }
        const parsedBaud = Number(state.baudRate);
        if (state.selectedPath === '' || !Number.isSafeInteger(parsedBaud) || parsedBaud < 1)
            return;
        await store.connect({ path: state.selectedPath, baudRate: parsedBaud });
    };
    const setTerminalFindOpen = (open) => {
        if (open) {
            setMode('text');
            setFollow(false);
        }
        setFindOpen(open);
    };
    const setAiPanelOpen = (open) => {
        const next = { ...aiPanel, open };
        setAiPanel(next);
        saveAiPanelPreferences(next);
        if (open)
            setAiUnread(false);
    };
    const commitPanelWidth = (width) => {
        const next = { ...aiPanel, width: clampAiPanelWidth(width) };
        panelWidthRef.current = next.width;
        setAiPanel(next);
        saveAiPanelPreferences(next);
    };
    const schedulePanelWidth = (width) => {
        const next = clampAiPanelWidth(width);
        pendingWidthRef.current = next;
        panelWidthRef.current = next;
        if (resizeFrameRef.current !== undefined)
            return;
        resizeFrameRef.current = requestAnimationFrame(() => {
            resizeFrameRef.current = undefined;
            const pending = pendingWidthRef.current;
            if (pending !== undefined) {
                workbenchRef.current?.style.setProperty('--dsh-serial-ai-width', `${pending}px`);
            }
        });
    };
    const beginPanelResize = (event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startWidth: panelWidthRef.current,
        };
    };
    const resizePanel = (event) => {
        const drag = dragRef.current;
        if (drag === undefined || drag.pointerId !== event.pointerId)
            return;
        schedulePanelWidth(drag.startWidth + drag.startX - event.clientX);
    };
    const finishPanelResize = (event) => {
        const drag = dragRef.current;
        if (drag === undefined || drag.pointerId !== event.pointerId)
            return;
        dragRef.current = undefined;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        commitPanelWidth(pendingWidthRef.current ?? panelWidthRef.current);
        pendingWidthRef.current = undefined;
    };
    const resizePanelByKeyboard = (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
            return;
        event.preventDefault();
        commitPanelWidth(panelWidthRef.current + (event.key === 'ArrowLeft' ? 16 : -16));
    };
    const workbenchStyle = {
        '--dsh-serial-ai-width': `${aiPanel.width}px`,
    };
    const terminal = mode === 'text' ? (_jsx(XtermSerialTerminal, { events: visibleEvents, connected: terminalInputEnabled, follow: follow, lineEnding: state.lineEnding, checkpointKey: checkpointKey, checkpointBaseSeq: hiddenBeforeSeq, checkpointAllowed: !state.gapDetected, checkpointCache: uiMemory.checkpointCache, findOpen: findOpen, onFindOpenChange: setTerminalFindOpen, emptyLabel: synchronizationStopped
            ? 'Serial synchronization stopped. Disconnect or reload the Remote plugin to recover.'
            : connected
                ? 'Connected: Tab, arrows, paste, and terminal controls are sent directly to the board.'
                : 'Select a serial port and baud rate, then connect.', onTextInput: text => store.sendTerminalText(text), onBinaryInput: dataBase64 => store.sendTerminalBinary(dataBase64) }, checkpointKey)) : (_jsx("div", { className: "dsh-serial-hex-log", role: "log", "aria-label": "Raw serial byte events", children: visibleEvents.map(event => _jsx(HexRow, { event: event }, `${event.sessionId}:${event.seq}`)) }));
    return (_jsxs("section", { className: "dsh-serial-console", "aria-label": "Serial Console", children: [_jsxs("header", { className: "dsh-serial-toolbar", children: [_jsx("span", { className: `dsh-serial-status is-${state.remote.status}`, "aria-label": state.remote.status }), _jsxs("select", { "aria-label": "Serial port", value: state.selectedPath, disabled: connected || busy, onChange: event => { store.setSelectedPath(event.target.value); }, children: [state.ports.length === 0 && _jsx("option", { value: "", children: "No serial ports" }), state.ports.map(port => (_jsx("option", { value: port.path, children: port.friendlyName === undefined ? port.path : `${port.path} — ${port.friendlyName}` }, `${port.path}:${port.serialNumber ?? ''}`)))] }), _jsx("input", { "aria-label": "Baud rate", className: "dsh-serial-baud", value: state.baudRate, disabled: connected || busy, inputMode: "numeric", onChange: event => { store.setBaudRate(event.target.value); } }), _jsx("button", { type: "button", disabled: disconnectAvailable
                            ? busy && !synchronizationStopped
                            : busy || state.selectedPath === '' || synchronizationStopped, onClick: () => { void toggleConnection(); }, children: disconnectAvailable ? 'Disconnect' : busy ? state.remote.status : 'Connect' }), _jsxs("select", { "aria-label": "Line ending", value: state.lineEnding, disabled: !terminalInputEnabled, title: "Bytes sent by the physical Enter key", onChange: event => { store.setLineEnding(event.target.value); }, children: [_jsx("option", { value: "cr", children: "CR" }), _jsx("option", { value: "crlf", children: "CRLF" }), _jsx("option", { value: "lf", children: "LF" }), _jsx("option", { value: "none", children: "None" })] }), _jsxs("button", { type: "button", onClick: () => {
                            const next = !follow;
                            if (next)
                                setFindOpen(false);
                            setFollow(next);
                        }, "aria-pressed": follow, children: ["Follow ", follow ? '✓' : '–'] }), _jsx("button", { type: "button", onClick: () => {
                            const next = mode === 'text' ? 'hex' : 'text';
                            if (next === 'hex')
                                setFindOpen(false);
                            setMode(next);
                        }, children: mode.toUpperCase() }), _jsxs("button", { type: "button", onClick: () => { setTerminalFindOpen(!findOpen); }, "aria-pressed": findOpen, title: "Find in terminal (Ctrl+F)", children: ["Find ", findOpen ? '✓' : '–'] }), _jsx("button", { type: "button", onClick: () => {
                            setFindOpen(false);
                            const next = state.events.at(-1)?.seq ?? hiddenBeforeSeq;
                            uiMemory.hiddenBeforeSeq = next;
                            uiMemory.checkpointCache.current = undefined;
                            setHiddenBeforeSeq(next);
                        }, title: "Only clears this terminal; Host audit logs are retained", children: "Clear view" }), _jsx("button", { type: "button", onClick: () => { downloadEvents(state.events); }, children: "Export" }), aiActivity !== undefined && (_jsxs("button", { type: "button", className: "dsh-serial-ai-toggle", onClick: () => { setAiPanelOpen(!aiPanel.open); }, "aria-expanded": aiPanel.open, "aria-controls": "dsh-serial-ai-panel", children: ["AI ", aiPanel.open ? '✓' : '–', aiUnread && _jsx("span", { className: "dsh-serial-ai-unread", "aria-label": "New AI activity" })] }))] }), state.gapDetected && (_jsx("div", { className: "dsh-serial-warning", children: "Some in-memory events expired. Export the Host audit log for complete evidence." })), synchronizationError !== undefined && _jsx("div", { className: "dsh-serial-error", children: synchronizationError }), state.lastError !== undefined && _jsx("div", { className: "dsh-serial-error", children: state.lastError }), _jsxs("div", { ref: workbenchRef, className: `dsh-serial-workbench${aiPanel.open && aiActivity !== undefined ? ' is-ai-open' : ''}`, style: workbenchStyle, children: [_jsx("div", { className: "dsh-serial-terminal-pane", children: terminal }), aiPanel.open && aiActivity !== undefined && (_jsxs(_Fragment, { children: [_jsx("div", { className: "dsh-serial-ai-resizer", role: "separator", "aria-label": "Resize AI activity panel", "aria-orientation": "vertical", "aria-valuemin": 300, "aria-valuemax": 600, "aria-valuenow": aiPanel.width, tabIndex: 0, onPointerDown: beginPanelResize, onPointerMove: resizePanel, onPointerUp: finishPanelResize, onPointerCancel: finishPanelResize, onKeyDown: resizePanelByKeyboard }), _jsx("div", { id: "dsh-serial-ai-panel", className: "dsh-serial-ai-panel-seat", children: _jsx(AiActivityPanel, { activity: aiActivity, onClose: () => { setAiPanelOpen(false); } }) })] }))] })] }));
}
function memoryFor(store) {
    const existing = UI_MEMORY.get(store);
    if (existing !== undefined)
        return existing;
    const created = {
        hiddenBeforeSeq: 0,
        checkpointCache: createTerminalCheckpointCache(),
    };
    UI_MEMORY.set(store, created);
    return created;
}
function HexRow({ event }) {
    const time = new Date(event.timestamp).toLocaleTimeString(undefined, { hour12: false });
    if (event.type === 'rx') {
        return (_jsxs("div", { className: "dsh-serial-row is-rx", children: [_jsx("time", { children: time }), _jsx(Actor, { actor: "board" }), _jsx("span", { children: hexBytes(event.dataBase64) })] }));
    }
    if (event.type === 'tx') {
        return (_jsxs("div", { className: `dsh-serial-row is-${event.actor}`, title: event.toolCallId, children: [_jsx("time", { children: time }), _jsx(Actor, { actor: event.actor }), _jsx("span", { children: hexBytes(event.dataBase64) })] }));
    }
    if (event.type === 'marker') {
        return (_jsxs("div", { className: "dsh-serial-row is-system", children: [_jsx("time", { children: time }), _jsx(Actor, { actor: event.actor }), _jsxs("span", { children: ["\u2500\u2500 ", event.label, " \u2500\u2500"] })] }));
    }
    if (event.type === 'error') {
        return (_jsxs("div", { className: "dsh-serial-row is-error", children: [_jsx("time", { children: time }), _jsx(Actor, { actor: "system" }), _jsxs("span", { children: [event.code, ": ", event.message] })] }));
    }
    return (_jsxs("div", { className: "dsh-serial-row is-system", children: [_jsx("time", { children: time }), _jsx(Actor, { actor: "system" }), _jsxs("span", { children: [event.status, event.message === undefined ? '' : ` — ${event.message}`] })] }));
}
function Actor({ actor }) {
    return _jsx("span", { className: `dsh-serial-actor is-${actor}`, children: actor.toUpperCase() });
}
function hexBytes(dataBase64) {
    return decodeBase64(dataBase64).map(byte => byte.toString(16).padStart(2, '0')).join(' ');
}
function decodeBase64(value) {
    return [...globalThis.atob(value)].map(character => character.charCodeAt(0));
}
function downloadEvents(events) {
    const body = events.map(event => JSON.stringify(event)).join('\n');
    const url = URL.createObjectURL(new Blob([body, body.length === 0 ? '' : '\n'], { type: 'application/x-ndjson' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `serial-console-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
    anchor.click();
    URL.revokeObjectURL(url);
}
//# sourceMappingURL=SerialConsole.js.map