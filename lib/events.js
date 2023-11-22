import { get } from "./util.js";

const sources = new Map();

// Set up a listener for events from a source of a given type.
export function on(source, type, listener) {
    const listeners = get(sources, source, () => ({}));
    if (!listeners.hasOwnProperty(type)) {
        listeners[type] = new Set();
    }
    listeners[type].add(listener);
    return listener;
}

// Set up a listener for the next event from a source of a given type.
export function once(source, type, listener) {
    return on(source, type, function f(event) {
        off(source, type, f);
        if (listener.handleEvent) {
            listener.handleEvent.call(listener, event);
        } else {
            listener(event);
        }
    });
}

// Stop listening to events from a source of a given type.
export const off = (source, type, listener) => {
    sources.get(source)?.[type]?.delete(listener);
};

// Return the promise of a notification.
export const notification = (source, type) => new Promise(resolve => {
    once(source, type, resolve);
});

// Return a promise resolving when p, which gets evaluated at every
// notification, becomes false.
export const notifications = (source, type, p) => new Promise(resolve => {
    on(source, type, function handler(e) {
        if (!p(e)) {
            off(source, type, handler);
            resolve();
        }
    });
});

// Send a synchronous notification.
export const notify = (source, type, args = {}) => dispatch({
    source, type, timestamp: performance.now(), ...args
});

// Send a notification asynchronously.
export const notifyAsync = (source, type, args = {}) => Promise.resolve().then(
    () => dispatch({ source, type, timestamp: performance.now(), ...args })
);

// Dispatch an event to its listeners.
function dispatch(event) {
    const listeners = sources.get(event.source)?.[event.type];
    if (listeners) {
        for (const listener of listeners.values()) {
            if (listener.handleEvent) {
                listener.handleEvent.call(listener, event);
            } else {
                listener(event);
            }
        }
    }
    return event;
}
