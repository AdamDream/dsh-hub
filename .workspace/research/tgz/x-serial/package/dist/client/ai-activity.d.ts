/** Minimal public Conversation snapshot surface consumed by the serial view. */
export interface SerialConversationSnapshot {
    readonly running: boolean;
    readonly partial: SerialPartialAssistant | null;
    readonly nodes: readonly SerialConversationNode[];
    readonly runningCalls: readonly SerialRunningToolCall[];
    readonly lastAgentError: string | null;
}
export type UseSerialConversation = <Selected>(selector: (snapshot: SerialConversationSnapshot) => Selected) => Selected;
export interface SerialAssistantBlock {
    readonly kind: 'text' | 'reasoning' | 'image' | 'tool-call' | 'other';
    readonly text?: string;
    readonly callId?: string;
    readonly name?: string;
}
interface SerialPartialAssistant {
    readonly turn: number;
    readonly step: number;
    readonly blocks: readonly SerialAssistantBlock[];
}
interface SerialAssistantNode {
    readonly kind: 'assistant';
    readonly seq: number;
    readonly turn: number;
    readonly step: number;
    readonly blocks: readonly SerialAssistantBlock[];
    readonly interrupted?: true;
}
interface SerialToolResultNode {
    readonly kind: 'tool-result';
    readonly seq: number;
    readonly callId: string;
    readonly call: {
        readonly name: string;
    } | null;
    readonly isError: boolean;
}
interface SerialTurnErrorNode {
    readonly kind: 'turn-error';
    readonly seq: number;
    readonly turn: number;
    readonly message: string;
    readonly code?: string;
}
interface SerialOtherNode {
    readonly kind: string;
    readonly seq: number;
}
type SerialConversationNode = SerialAssistantNode | SerialToolResultNode | SerialTurnErrorNode | SerialOtherNode;
interface SerialRunningToolCall {
    readonly callId: string;
    readonly name: string;
    readonly turn: number;
    readonly step: number;
}
export type AiActivityStatus = 'idle' | 'thinking' | 'responding' | 'using-tools' | 'complete' | 'interrupted' | 'error';
export interface AiToolActivity {
    readonly callId: string;
    readonly name: string;
    readonly status: 'requested' | 'running' | 'complete' | 'error';
}
/** Immutable, presentation-ready subset of the currently selected DSH session. */
export interface AiActivitySnapshot {
    readonly status: AiActivityStatus;
    readonly running: boolean;
    readonly turn: number | undefined;
    readonly step: number | undefined;
    readonly reasoning: string;
    readonly response: string;
    readonly tools: readonly AiToolActivity[];
    readonly error: string | undefined;
    readonly signature: string;
}
export declare const EMPTY_AI_ACTIVITY: AiActivitySnapshot;
/** Fold the public DSH Conversation snapshot into the compact serial-side viewer. */
export declare function deriveAiActivity(snapshot: SerialConversationSnapshot): AiActivitySnapshot;
export {};
//# sourceMappingURL=ai-activity.d.ts.map