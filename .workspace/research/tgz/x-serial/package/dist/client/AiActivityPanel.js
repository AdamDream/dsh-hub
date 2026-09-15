import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef } from 'react';
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
const CODE_LABELS = { copyLabel: '复制代码', copiedLabel: '已复制' };
/** Compact read-only mirror of the selected DSH session's current AI activity. */
export function AiActivityPanel({ activity, onClose }) {
    const scrollRef = useRef(null);
    const followingRef = useRef(true);
    useEffect(() => {
        const element = scrollRef.current;
        if (element !== null && followingRef.current)
            element.scrollTop = element.scrollHeight;
    }, [activity.signature]);
    return (_jsxs("aside", { className: "dsh-serial-ai-panel", "aria-label": "AI activity", children: [_jsxs("header", { className: "dsh-serial-ai-header", children: [_jsx("span", { className: `dsh-serial-ai-status is-${activity.status}`, "aria-hidden": true }), _jsx("strong", { children: statusLabel(activity.status) }), activity.turn !== undefined && (_jsxs("span", { className: "dsh-serial-ai-turn", children: ["Turn ", activity.turn, activity.step === undefined ? '' : ` · Step ${activity.step}`] })), _jsx("button", { type: "button", onClick: onClose, "aria-label": "Hide AI activity", children: "\u00D7" })] }), _jsxs("div", { ref: scrollRef, className: "dsh-serial-ai-scroll", onScroll: event => {
                    const element = event.currentTarget;
                    followingRef.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 24;
                }, children: [activity.status === 'idle' && (_jsx("p", { className: "dsh-serial-ai-empty", children: "\u5728\u5E95\u90E8\u8F93\u5165\u680F\u5411\u6A21\u578B\u53D1\u9001\u6D88\u606F\u540E\uFF0C\u53EF\u5728\u8FD9\u91CC\u67E5\u770B\u5B9E\u65F6\u8FDB\u5EA6\u548C\u56DE\u590D\u3002" })), activity.reasoning !== '' && (_jsxs("details", { className: "dsh-serial-ai-reasoning", open: activity.status === 'thinking', children: [_jsxs("summary", { children: ["\u601D\u8003\u8FC7\u7A0B", activity.running ? ' · 进行中' : ''] }), _jsx(MarkdownText, { text: activity.reasoning, streaming: activity.running, codeLabels: CODE_LABELS })] })), activity.tools.length > 0 && (_jsxs("section", { className: "dsh-serial-ai-tools", "aria-label": "AI tool activity", children: [_jsx("h3", { children: "\u5DE5\u5177" }), activity.tools.map(tool => _jsx(ToolActivity, { tool: tool }, tool.callId))] })), activity.response !== '' && (_jsxs("section", { className: "dsh-serial-ai-response", "aria-label": "AI response", children: [_jsx("h3", { children: "\u56DE\u590D" }), _jsx(MarkdownText, { text: activity.response, streaming: activity.running, codeLabels: CODE_LABELS })] })), activity.error !== undefined && (_jsx("div", { className: "dsh-serial-ai-error", role: "alert", children: activity.error })), activity.running && activity.reasoning === '' && activity.response === '' && activity.tools.length === 0 && (_jsx("p", { className: "dsh-serial-ai-empty", children: "\u6A21\u578B\u6B63\u5728\u5904\u7406\u5F53\u524D\u8BF7\u6C42\u2026" }))] })] }));
}
function ToolActivity({ tool }) {
    return (_jsxs("div", { className: `dsh-serial-ai-tool is-${tool.status}`, children: [_jsx("span", { className: "dsh-serial-ai-tool-dot", "aria-hidden": true }), _jsx("code", { children: tool.name }), _jsx("span", { children: toolStatusLabel(tool.status) })] }));
}
function statusLabel(status) {
    switch (status) {
        case 'thinking': return 'AI 正在思考';
        case 'responding': return 'AI 正在回复';
        case 'using-tools': return 'AI 正在调用工具';
        case 'complete': return 'AI 已完成';
        case 'interrupted': return 'AI 已停止';
        case 'error': return 'AI 执行失败';
        default: return 'AI 浏览窗';
    }
}
function toolStatusLabel(status) {
    switch (status) {
        case 'running': return '运行中';
        case 'complete': return '已完成';
        case 'error': return '失败';
        default: return '已请求';
    }
}
//# sourceMappingURL=AiActivityPanel.js.map