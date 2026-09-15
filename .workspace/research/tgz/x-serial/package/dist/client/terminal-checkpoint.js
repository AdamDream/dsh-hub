export function createTerminalCheckpointCache() {
    return { current: undefined };
}
/**
 * Return a checkpoint only when the retained event window can continue it
 * without a session, clear-view, rewind, or truncation gap.
 */
export function takeRestorableTerminalCheckpoint(cache, lookup) {
    const checkpoint = cache.current;
    if (checkpoint === undefined)
        return undefined;
    if (!lookup.allowRestore
        || checkpoint.key !== lookup.key
        || checkpoint.baseSeq !== lookup.baseSeq
        || checkpoint.throughSeq < lookup.baseSeq) {
        cache.current = undefined;
        return undefined;
    }
    const lastSeq = lookup.events.at(-1)?.seq;
    if (lastSeq !== undefined && lastSeq < checkpoint.throughSeq) {
        cache.current = undefined;
        return undefined;
    }
    let expectedSeq = checkpoint.throughSeq + 1;
    for (const event of lookup.events) {
        if (event.seq <= checkpoint.throughSeq)
            continue;
        if (event.seq !== expectedSeq) {
            cache.current = undefined;
            return undefined;
        }
        expectedSeq += 1;
    }
    return checkpoint;
}
export function saveTerminalCheckpoint(cache, checkpoint) {
    cache.current = checkpoint;
}
//# sourceMappingURL=terminal-checkpoint.js.map