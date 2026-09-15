export const EMPTY_AI_ACTIVITY = {
    status: 'idle',
    running: false,
    turn: undefined,
    step: undefined,
    reasoning: '',
    response: '',
    tools: [],
    error: undefined,
    signature: 'idle',
};
const NODE_SUMMARIES = new WeakMap();
/** Fold the public DSH Conversation snapshot into the compact serial-side viewer. */
export function deriveAiActivity(snapshot) {
    const summary = summarizeConversationNodes(snapshot.nodes);
    const { assistant, turnError } = summary;
    const blocks = snapshot.partial?.blocks ?? assistant?.blocks ?? [];
    const turn = snapshot.partial?.turn
        ?? snapshot.runningCalls.at(-1)?.turn
        ?? assistant?.turn
        ?? turnError?.turn;
    const step = snapshot.partial?.step
        ?? snapshot.runningCalls.at(-1)?.step
        ?? assistant?.step;
    const reasoning = joinBlockText(blocks, 'reasoning');
    const response = joinBlockText(blocks, 'text');
    const tools = deriveTools(blocks, snapshot.runningCalls, summary.toolResults);
    const newerTurnError = turnError !== undefined && turnError.seq > (assistant?.seq ?? -1);
    const error = newerTurnError
        ? formatTurnError(turnError)
        : !snapshot.running && snapshot.lastAgentError !== null
            ? snapshot.lastAgentError
            : undefined;
    const status = activityStatus(snapshot, assistant, reasoning, response, tools, error);
    const signature = [
        status,
        snapshot.running ? '1' : '0',
        turn ?? '',
        step ?? '',
        reasoning.length,
        reasoning.slice(-64),
        response.length,
        response.slice(-64),
        tools.map(tool => `${tool.callId}:${tool.status}`).join(','),
        error ?? '',
    ].join('|');
    return {
        status,
        running: snapshot.running,
        turn,
        step,
        reasoning,
        response,
        tools,
        error,
        signature,
    };
}
function activityStatus(snapshot, assistant, reasoning, response, tools, error) {
    if (error !== undefined)
        return 'error';
    if (snapshot.runningCalls.length > 0 || tools.some(tool => tool.status === 'running'))
        return 'using-tools';
    if (snapshot.running) {
        if (response !== '')
            return 'responding';
        if (reasoning !== '')
            return 'thinking';
        if (tools.length > 0)
            return 'using-tools';
        return 'thinking';
    }
    if (assistant?.interrupted === true)
        return 'interrupted';
    if (assistant !== undefined)
        return 'complete';
    return 'idle';
}
function deriveTools(blocks, runningCalls, results) {
    const running = new Map(runningCalls.map(call => [call.callId, call]));
    const tools = [];
    const seen = new Set();
    for (const block of blocks) {
        if (block.kind !== 'tool-call' || block.callId === undefined || seen.has(block.callId))
            continue;
        seen.add(block.callId);
        const result = results.get(block.callId);
        tools.push({
            callId: block.callId,
            name: block.name === undefined || block.name === '' ? 'tool' : block.name,
            status: result === undefined
                ? running.has(block.callId) ? 'running' : 'requested'
                : result.isError ? 'error' : 'complete',
        });
    }
    for (const call of runningCalls) {
        if (seen.has(call.callId))
            continue;
        seen.add(call.callId);
        tools.push({ callId: call.callId, name: call.name, status: 'running' });
    }
    return tools;
}
function joinBlockText(blocks, kind) {
    return blocks
        .filter((block) => (block.kind === kind && typeof block.text === 'string'))
        .map(block => block.text)
        .join('\n\n');
}
function formatTurnError(error) {
    return error.code === undefined ? error.message : `${error.code}: ${error.message}`;
}
function isAssistantNode(node) {
    return node.kind === 'assistant';
}
function isToolResultNode(node) {
    return node.kind === 'tool-result';
}
function isTurnErrorNode(node) {
    return node.kind === 'turn-error';
}
function summarizeConversationNodes(nodes) {
    const cached = NODE_SUMMARIES.get(nodes);
    if (cached !== undefined)
        return cached;
    let assistant;
    let turnError;
    const toolResults = new Map();
    for (const node of nodes) {
        if (isAssistantNode(node))
            assistant = node;
        else if (isTurnErrorNode(node))
            turnError = node;
        else if (isToolResultNode(node))
            toolResults.set(node.callId, node);
    }
    const summary = { assistant, turnError, toolResults };
    NODE_SUMMARIES.set(nodes, summary);
    return summary;
}
//# sourceMappingURL=ai-activity.js.map