// Do nothing.
export function nop() {
}

// Simple combinators (identity/Idiot Bird, constant/Kestrel).
export const I = x => x;
export const K = x => () => x;

// Clamp x between min and max.
export const clamp = (x, min, max) => Math.min(Math.max(x, min), max);

// Extend an object by creating a new one with additional properties.
export const extend = (x, ...props) => Object.assign(Object.create(x), ...props);

// Test whether a function is declared as async.
export const isAsync = f => Object.getPrototypeOf(f) === Object.getPrototypeOf(async function() {});

// Remove the first occurrence of `x` from the array `xs` and return it.
// `x` must be in `xs`.
export const remove = (xs, x) => {
    const index = xs.indexOf(x);
    if (index < 0) {
        throw Error("Cannot remove non-element of array");
    }
    xs.splice(index, 1)[0];
}

// Create a priority queue with a comparison function (min by default).
export class PriorityQueue extends Array {
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

// Timing specifiers from the SMIL 3.0 Timing and Synchronization module, cf.
// https://www.w3.org/TR/REC-smil/smil-timing.html#q18

const Second = 1000;
const Minute = 60 * Second;
const Hour = 60 * Minute;

// Parse a full (hours, minutes, seconds, optional fraction) or partial
// (minutes, seconds, optional fraction) clock value, or a timecount value
// (including an optional metric from h, min, s, which is the default, and ms).
// Return the parsed value as a number of milliseconds, or nothing if the value
// could not be parsed.
function parseClockValue(value) {
    value = value.replace(/\s+/g, "");
    let match;
    if (match = value.match(/^(?:([0-9]+):)?([0-5][0-9]):([0-5][0-9](?:\.[0-9]+)?)$/)) {
        // Clock value
        return Hour * parseInt(match[1] ?? "0") +
            Minute * parseInt(match[2]) +
            Second * parseFloat(match[3]);
    }
    if (match = value.match(/^([0-9]+(?:\.[0-9]+)?)(\S*)$/)) {
        // Timecount value
        const d = parseFloat(match[1]);
        switch (match[2].toLowerCase()) {
            case "h":
                return d * Hour;
            case "min":
                return d * Minute;
            case "s":
            case "":
                return d * Second;
            case "ms":
                return d;
        }
    }
}

// Parse an offset value. Return the parsed value as a number of milliseconds,
// or nothing if the value could not be parsed.
export function parseOffsetValue(offset) {
    const match = offset.match(/^\s*([+-]?)(\s*[0-9].*)/s);
    if (match) {
        const clockValue = parseClockValue(match[2]);
        if (clockValue >= 0) {
            return (match[1] === "-" ? -1 : 1) * clockValue;
        }
    }
}

// FIXME 4O06 Test: show values
export const show = x => typeof x === "symbol" ? `Symbol(${Symbol.keyFor(x) ?? ""})` : (x ?? "undefined").toString();

// Finer-grained typeof that distinguishes between different types of objects.
export const typeOf = x => typeof x !== "object" ? typeof x :
    x === null ? "null" :
    Array.isArray(x) ? "array" :
    x instanceof Function ? "object/function" :
    x instanceof String ? "object/string" :
    x instanceof RegExp ? "regex" :
    x instanceof Map ? "map" :
    x instanceof Set ? "set" : "object";

// Load an image and return once it is complete.
export const loadImage = async src => new Promise((resolve, reject) => {
    const image = new Image();
    image.src = src;
    if (image.complete) {
        resolve(image);
    } else {
        image.addEventListener("load", () => { resolve(image); });
        image.addEventListener("error", () => { reject(Error(`Cannot load image with src="${src}"`)); });
    }
});
