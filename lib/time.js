import { isNumber, parseTime, safe } from "./util.js";

// Add times, may become unresolved if either is unresolved.
export const add = (x, y) => isUnresolved(x) ? (y === Infinity ? y : unresolved) :
    (isUnresolved(y) ? (x === Infinity ? x : unresolved) : x + y);

// Check a duration/time argument, which may be a string or a number, and return
// a number ≥ 0.
export function check(t) {
    if (typeof t === "string") {
        t = safe(parseTime)(t);
    }
    return isNumber(t) && t > 0 ? t : 0;
}

// Compare times, return a negative result if x < y, 0 if x = y, and positive
// if x > 0 (suitable for sorting and the priority queue).
export const cmp = (x, y) => {
    // Treat unresolved as indefinite—and return 0 when both values are
    // indefinite (or unresolved).
    const d = (isUnresolved(x) ? Infinity : x) - (isUnresolved(y) ? Infinity : y);
    return isNaN(d) ? 0 : d;
}

// Distinguish between unresolved, definite and indefinite times.
export const isUnresolved = t => t === null;
export const isResolved = isNumber;
export const isDefinite = Number.isFinite;
export const isIndefinite = t => t === Infinity;

// Max of two times.
export function max(x, y) {
    if (isUnresolved(x)) {
        if (isUnresolved(y)) {
            return unresolved;
        }
        if (y === Infinity) {
            // max(u, ∞) = ∞
            return y;
        }
        // max(u, t) = u
        return x;
    }
    if (isUnresolved(y)) {
        if (x === Infinity) {
            // max(∞, v) = ∞
            return x;
        }
        // max(t, v) = v
        return y;
    }
    // Simple max for definite times
    return Math.max(x, y);
}

// Read a time value (number or string).
export function read(t) {
    if (typeof t === "string") {
        t = parseTime(t);
    }
    if (!(t >= 0)) {
        throw Error("invalid time value");
    }
    return t;
}

// Show a time.
export const show = t => isUnresolved(t) ? "#" : isDefinite(t) ? t.toString() : isIndefinite(t) ? "∞" : "";

// Unresolved is just null.
export const unresolved = null;
