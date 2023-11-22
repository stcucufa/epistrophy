// Add to a collection (Map or Set) and return the added item.
export function add(collection, ...args) {
    if (args.length === 1) {
        collection.add(args[0]);
        return args[0];
    }
    if (args.length === 2) {
        collection.set(args[0], args[1]);
        return args[1];
    }
}

// Add x to xs by the index where p becomes true, to keep an array sorted by
// some property. TODO use a better data structure for performance.
export function addBy(xs, x, p) {
    const i = xs.findIndex(p);
    if (i >= 0) {
        xs.splice(i, 0, x);
    } else {
        xs.push(x);
    }
    return x;
}

// We don’t just use assign because it does not handle getters/setters properly.
export function assign(object, ...properties) {
    for (let props of properties) {
        for (let key of Object.keys(props)) {
            Object.defineProperty(object, key, Object.getOwnPropertyDescriptor(props, key));
        }
    }
    return object;
}

// Combination of create and assign to quickly create new objects by extending
// existing ones with new properties.
export const extend = (object, ...properties) => assign(Object.create(object), ...properties);

// Render a time value as a clock time.
export function clockTime(t) {
    if (t === Infinity) {
        return "Infinity";
    }

    const h = Math.floor(t / Hour);
    const m = Math.floor((t % Hour) / Minute);
    const s = Math.floor((t % Minute) / Second);
    const ms = Math.floor(t % Second);
    return `${h > 0 ? `${h.toString().padStart(2, "0")}:` : ""}${m.toString().padStart(2, "0")}:${
        s.toString().padStart(2, "0")}${ms > 0 ? `.${ms.toString().replace(/0+$/, "")}` : ""
    }`;
}

// Return a create(properties) function for an object, allowing for default
// values for properties, and an optional init() method to be called on
// creation.
export function create(defaults = {}) {
    return function(...properties) {
        const o = extend(this, defaults, ...properties);
        if (typeof o.init === "function") {
            o.init();
        }
        return o;
    }
}

// Repeat xs infinitely.
export function* cycle(xs) {
    let i = 0;
    while (true) {
        yield(xs[i]);
        i = (i + 1) % xs.length;
    }
}

// Remove a value from an object and return it.
export function del(object, key) {
    const value = object[key];
    delete object[key];
    return value;
}

// Escape &, < and > for HTML-friendly text.
export const escapeMarkup = t => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Create a Map from a collection xs by applying a function f to every x.
// f is expected to return a [key, value] pair to be added to the Map.
export function assoc(xs, f = I) {
    const m = new Map();
    for (let i = 0, n = xs.length; i < n; ++i) {
        m.set(...f(xs[i], i));
    }
    return m;
}

// Create an object from a collection xs by applying a function f to every x.
// f is expected to return a [key, value] pair to be added to the object.
export function assoco(xs, f = I) {
    const o = {};
    for (let i = 0, n = xs.length; i < n; ++i) {
        const [key, value] = f(xs[i], i);
        o[key] = value;
    }
    return o;
}

// Clamp x between min and max.
export const clamp = (x, min, max) => Math.min(Math.max(min, x), max);

// Create a DOM element in the given namespace. Use html or svg for known
// namespaces. Attributes can be given as an optional object, followed by
// children, handling arrays and strings as text nodes.
export function element(ns, tagname, ...children) {
    const appendChild = (element, child) => {
        if (typeof child === "string") {
            element.appendChild(document.createTextNode(child));
        } else if (child instanceof Element) {
            element.appendChild(child);
        } else if (Array.isArray(child)) {
            for (let ch of child) {
                appendChild(element, ch);
            }
        }
    };

    const element = document.createElementNS(ns, tagname);
    if (isObject(children[0]) && !Array.isArray(children[0]) && !(children[0] instanceof Element)) {
        for (let [attribute, value] of Object.entries(children[0])) {
            element.setAttribute(attribute, value);
        }
    }
    appendChild(element, [...children]);
    return element;
}

export const XHTML_NS = "http://www.w3.org/1999/xhtml";
export const SVG_NS = "http://www.w3.org/2000/svg";

export const html = (...args) => element(XHTML_NS, ...args);
export const svg = (...args) => element(SVG_NS, ...args);

// True when the predicate p is true of every value of the iterator.
export function everyof(it, p, that) {
    for (const x of it) {
        if (!p.call(that, x)) {
            return false;
        }
    }
    return true;
}


// Filter the values produced by an iterator.
export const filterit = (it, p, that) => foldit(it, (xs, x) => {
    if (p.call(that, x)) {
        xs.push(x);
    }
    return xs;
}, [], that);

// Reverse the first two arguments of f (and discard any other).
export const flip = f => (x, y) => f(y, x);

// Fold over all the values produced by an iterator.
export function foldit(it, f, z, that) {
    for (const x of it) {
        z = f.call(that, z, x);
    }
    return z;
}

// Fold using the first x as the initial accumulator value.
export function fold1(xs, f, that) {
    const n = xs.length;
    if (n === 0) {
        return;
    }

    let z = xs[0];
    for (let i = 1; i < n; ++i) {
        z = f.call(that, z, xs[i]);
    }
    return z;
}

// Get an element from a Map, or create a default value from f if absent.
export function get(map, key, f) {
    if (!map.has(key)) {
        const v = f();
        map.set(key, v);
        return v;
    }
    return map.get(key);
}

// Identity combinator.
export const I = x => x;

// Promise of a loaded image element given its URL.
export const imagePromise = url => new Promise((resolve, reject) => {
    const image = new Image();
    image.src = url;
    image.onload = () => resolve(image);
    image.onerror = () => reject(Error(`Could not load image with URL "${url}"`));
});

// Intersperse the xs with y (similar to join).
export function intersperse(xs, y) {
    const zs = [];
    if (xs.length > 0) {
        const [x, ...rest] = xs;
        zs.push(x);
        for (const z of rest) {
            zs.push(y);
            zs.push(z);
        }
    }
    return zs;
}

// Distinguish async functions from sync functions.
const AsyncFunction = (async () => {}).constructor;
export const isAsync = f => f instanceof AsyncFunction;

// Test for empty strings, arrays, Sets, Maps, and objects.
export const isEmpty = x => typeof x === "string" || Array.isArray(x) ? x.length === 0 :
    x instanceof Set || x instanceof Map ? x.keys().next().done :
    isObject(x) ? Object.keys(x).length === 0 : false;

// Test if an object is iterable.
export const isIterable = x => typeof x?.[Symbol.iterator] === "function";

// Test for a number (may be infinite, but not NaN).
export const isNumber = x => typeof x === "number" && !isNaN(x);

// Test for a non-null object.
export const isObject = x => typeof x === "object" && x !== null;

// Constant combinator.
export const K = x => y => x;

// Remove a value from a map and return it.
export function mapdel(map, key) {
    const value = map.get(key);
    map.delete(key);
    return value;
}

// Map over and collect the values produced by an iterator.
export const mapit = (it, f, that) => foldit(it, (xs, x) => (xs.push(f.call(that, x)), xs), [], that);

// See floored division in
// https://en.wikipedia.org/wiki/Modulo_operation#Variants_of_the_definition.
export const mod = (a, n) => a - n * Math.floor(a / n);

// Do nothing.
export const nop = () => {};

// Normalize whitespace in a string.
export const normalizeWhitespace = string => string.trim().replace(/\s+/g, " ");

// Parse time values into a number of milliseconds, following the SMIL spec
// (https://www.w3.org/TR/2008/REC-SMIL3-20081201/smil-timing.html#TimingSyntax-Clock-value)
// roughly. Units are week (w), day (d), hour (h), minute (mn), second (s) and
// millisecond (ms). Unitless values default to ms (e.g., "500" is 500ms), and
// strings can contain several units ("1m 30s" is 90000ms).

const Second = 1000;
const Minute = 60 * Second;
const Hour = 60 * Minute;
const Day = 24 * Hour;
const Week = 7 * Day;

const Units = [
    ["weeks?|wk?", Week],
    ["days?|d", Day],
    ["hours?|hr?", Hour],
    ["min(:?utes?)?|mn", Minute],
    ["seconds?|s", Second],
    ["(:?ms)?", 1],
];

export function parseTime(string) {
    // Infinity
    if (/^\s*(infinity|indefinite|∞)\s*$/i.test(string)) {
        return Infinity;
    }

    // Clock value
    const match = string.match(/^\s*(?:([0-9]+):)?([0-5][0-9]):([0-5][0-9])(?:(\.[0-9]+))?\s*$/);
    if (match) {
        const h = match[1] ? parseInt(match[0], 10) : 0;
        const m = parseInt(match[2], 10);
        const s = parseInt(match[3], 10);
        const ms = match[4] ? parseFloat(match[4]) : 0;
        return (h * 3600000 + m * 60000 + (s + ms) * 1000);
    }

    // Timecount value
    const [t, rest] = Units.reduce(([t, rest], [unit, ms]) => {
        const match = rest.match(new RegExp(`^\\s*(\\d+(?:\\.\\d+)?)\\s*(?:${unit})`, "i"));
        return match ? [t + parseFloat(match[1]) * ms, rest.slice(match[0].length)] : [t, rest];
    }, [0, string]);
    if (/\S/.test(rest)) {
        throw Error(`unable to parse "${string}"; went as far as "${rest}".`);
    }
    return t;
}

// Partition an array into two arrays according to a predicate. The first
// array of the pair contains all items from the source array for which the
// predicate is true, and the second array the items for which it is false.
export const partition = (xs, p) => xs.reduce(([t, f], x) => {
    (p(x) ? t : f).push(x);
    return [t, f];
}, [[], []]);

// Push an item to an array and return the item.
export function push(xs, x) {
    xs.push(x);
    return x;
}

// Create an iterator for all numbers between from and to, with a given step.
export function* range(from = 0, to = Infinity, step = 1) {
    const s = sign(step);
    if (s !== 0 && s * from <= s * to) {
        for (let i = 0; s * (from + i) <= s * to; i += step) {
            yield from + i;
        }
    }
}

// Remove the first occurrence of an item from an array and return it, assuming
// that it is present at least once.
export function remove(xs, x) {
    const index = xs.indexOf(x);
    console.assert(index >= 0);
    xs.splice(index, 1);
    return x;
}

// Remove all child nodes from a parent node and return it.
export function removeChildren(node) {
    for (let child = node.firstChild; child;) {
        const sibling = child.nextSibling;
        child.remove();
        child = sibling;
    }
    return node;
}

// Iterate through an array in reverse.
export function* reverse(xs) {
    for (let i = xs.length - 1; i >= 0; --i) {
        yield(xs[i]);
    }
}

// Wrap a function that throws in a try/catch and just ignore errors.
export const safe = f => (...args) => {
    try {
        return f(...args);
    } catch (_) {
    }
}

// Fisher-Yates shuffle (https://en.wikipedia.org/wiki/Fisher–Yates_shuffle).
export function shuffle(xs) {
    for (let i = xs.length - 1; i >= 1; --i) {
        const j = Math.floor(Math.random() * (i + 1));
        const x = xs[j];
        xs[j] = xs[i];
        xs[i] = x;
    }
    return xs;
}

// Sign of a number, with 0 for 0.
export const sign = x => x < 0 ? -1 : x > 0 ? 1 : 0;

// Ensure that an array has only a single item and return it.
export function single(xs) {
    if (xs.length === 1) {
        return xs[0];
    }
    throw Error("Expected a single value");
}

// snd(x, y) = y
export const snd = flip(I);

// True when the predicate p is true of at least one value of the iterator.
export function someof(it, p, that) {
    for (const x of it) {
        if (p.call(that, x)) {
            return true;
        }
    }
    return false;
}

// Render a time value as a time count.
export const timecount = t => t === Infinity ? "Infinity" : [
    [Math.floor(t / Week), "w"],
    [Math.floor((t % Week) / Day), "d"],
    [Math.floor((t % Day) / Hour), "h"],
    [Math.floor((t % Hour) / Minute), "mn"],
    [Math.floor((t % Minute) / Second), "s"],
    [Math.floor(t % Second), "ms"]
].filter(([v]) => v > 0).flat().join("") || "0";

// Promise wrapper for setTimeout()
export const timeout = async t => new Promise(resolve => { setTimeout(resolve, t); });

// TODO
export function todo() {
    throw Error("TODO");
}

// Finer-grained typeof.
export const typeOf = x => typeof x !== "object" ? typeof x :
    x === null ? "null" :
    Array.isArray(x) ? "array" :
    x instanceof Function ? "object/function" :
    x instanceof String ? "string" :
    x instanceof RegExp ? "regex" :
    x instanceof Map ? "map" :
    x instanceof Set ? "set" : "object";

// All values from an object (including its prototype)
export function values(object) {
    const vs = [];
    for (const property in object) {
        vs.push(object[property]);
    }
    return vs;
}

// Zip two arrays together.
export function zip(xs, ys) {
    const zs = [];
    const n = Math.min(xs.length, ys.length);
    for (let i = 0; i < n; ++i) {
        zs.push([xs[i], ys[i]]);
    }
    return zs;
}

// Zip an array of keys with an array of values into an object.
export const zipo = (keys, vals) => assoco(zip(keys, vals));
