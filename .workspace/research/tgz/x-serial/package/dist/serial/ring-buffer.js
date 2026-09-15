/** Fixed-capacity circular sequence buffer used for reconnectable polling. */
export class SequenceRing {
    capacity;
    values;
    head = 0;
    count = 0;
    constructor(capacity) {
        this.capacity = capacity;
        if (!Number.isSafeInteger(capacity) || capacity < 1) {
            throw new TypeError('ring capacity must be a positive safe integer');
        }
        this.values = new Array(capacity);
    }
    get size() {
        return this.count;
    }
    get earliestSeq() {
        return this.count === 0 ? undefined : this.valueAt(0).seq;
    }
    get latestSeq() {
        return this.count === 0 ? undefined : this.valueAt(this.count - 1).seq;
    }
    push(value) {
        const latest = this.latestSeq;
        if (latest !== undefined && value.seq <= latest) {
            throw new Error(`sequence must increase: ${value.seq} <= ${latest}`);
        }
        if (this.count < this.capacity) {
            this.values[this.physicalIndex(this.count)] = value;
            this.count += 1;
            return;
        }
        this.values[this.head] = value;
        this.head = (this.head + 1) % this.capacity;
    }
    clear() {
        for (let offset = 0; offset < this.count; offset += 1) {
            this.values[this.physicalIndex(offset)] = undefined;
        }
        this.head = 0;
        this.count = 0;
    }
    after(afterSeq, limit) {
        if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
            throw new TypeError('afterSeq must be a non-negative safe integer');
        }
        if (!Number.isSafeInteger(limit) || limit < 1) {
            throw new TypeError('limit must be a positive safe integer');
        }
        const earliestSeq = this.earliestSeq ?? afterSeq + 1;
        const truncated = this.count > 0 && afterSeq < earliestSeq - 1;
        const start = this.upperBound(afterSeq);
        const itemCount = Math.min(limit, this.count - start);
        const items = new Array(itemCount);
        for (let offset = 0; offset < itemCount; offset += 1) {
            items[offset] = this.valueAt(start + offset);
        }
        return { earliestSeq, truncated, items };
    }
    /** First logical offset whose sequence is greater than the requested cursor. */
    upperBound(afterSeq) {
        let low = 0;
        let high = this.count;
        while (low < high) {
            const middle = low + Math.floor((high - low) / 2);
            if (this.valueAt(middle).seq <= afterSeq)
                low = middle + 1;
            else
                high = middle;
        }
        return low;
    }
    valueAt(logicalIndex) {
        const value = this.values[this.physicalIndex(logicalIndex)];
        if (value === undefined)
            throw new Error('ring storage invariant violated');
        return value;
    }
    physicalIndex(logicalIndex) {
        return (this.head + logicalIndex) % this.capacity;
    }
}
//# sourceMappingURL=ring-buffer.js.map