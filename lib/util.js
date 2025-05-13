export function nop() {
}

// Create a priority queue with a comparison function (min by default).
export class Queue extends Array {
    constructor(cmp = (a, b) => a - b) {
        super();
        this.cmp = cmp;
    }

    insert(x) {
        this.push(x);
        for (let i = this.length - 1; i > 0;) {
            // Index of parent
            const j = Math.floor((i - 1) / 2);
            if (this.cmp(x, this[j]) >= 0) {
                break;
            }
            this[i] = this[j];
            this[j] = x;
            i = j;
        }
        return x;
    }

    remove(at = 0) {
        const n = this.length - 1;
        if (n < 0) {
            return;
        }
        const last = this.pop();
        if (n === at) {
            return last;
        }
        const removed = this[at];
        this[at] = last;
        for (let i = at;;) {
            // Index of left and right children
            const j = 2 * i + 1;
            if (j >= n) {
                // No children
                break;
            }
            const k = j + 1;
            if (this.cmp(this[i], this[j]) <= 0) {
                // parent < left
                if (k >= n || this.cmp(this[i], this[k]) <= 0) {
                    // parent < right
                    break;
                }
                // parent > right, swap with right
                this[i] = this[k];
                this[k] = last;
                i = k;
            } else {
                // parent > left
                if (k >= n || this.cmp(this[j], this[k]) <= 0) {
                    this[i] = this[j];
                    this[j] = last;
                    i = j;
                } else if (k < n) {
                    this[i] = this[k];
                    this[k] = last;
                    i = k;
                } else {
                    break;
                }
            }
        }
        return removed;
    }
}

// Synchronous messages

const MessageTypes = new Map();

export function message(from, type, message) {
    const handlers = MessageTypes.get(type)?.get(from);
    if (!handlers) {
        return;
    }
    message = message ? Object.assign(Object.create(message), { from, type }) : { from, type };
    for (const handler of handlers) {
        if (typeof handler === "function") {
            handler(message);
        } else if (typeof handler?.handleMessage === "function") {
            handler.handleMessage(message);
        }
    }
    return;
}

export function on(from, type, handler) {
    if (!MessageTypes.has(type)) {
        MessageTypes.set(type, new Map());
    }
    const targets = MessageTypes.get(type);
    if (!targets.has(from)) {
        targets.set(from, new Set());
    }
    targets.get(from).add(handler);
    return handler;
}

export function off(from, type, handler) {
    MessageTypes.get(type)?.get(from)?.delete(handler);
}
