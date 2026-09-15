/** Fixed-capacity circular sequence buffer used for reconnectable polling. */
export interface SequenceItem {
    readonly seq: number;
}
export interface SequenceSlice<T> {
    readonly earliestSeq: number;
    readonly truncated: boolean;
    readonly items: readonly T[];
}
export declare class SequenceRing<T extends SequenceItem> {
    readonly capacity: number;
    private readonly values;
    private head;
    private count;
    constructor(capacity: number);
    get size(): number;
    get earliestSeq(): number | undefined;
    get latestSeq(): number | undefined;
    push(value: T): void;
    clear(): void;
    after(afterSeq: number, limit: number): SequenceSlice<T>;
    /** First logical offset whose sequence is greater than the requested cursor. */
    private upperBound;
    private valueAt;
    private physicalIndex;
}
//# sourceMappingURL=ring-buffer.d.ts.map