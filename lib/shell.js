import { Fiber, ScheduledFiber, Scheduler } from "./unrated.js";

// Execute f with the fiber as argument and return the fiber.
Fiber.prototype.macro = function(f) {
    f(this);
    return this;
};

// Set a value in its original scope, or in the fiber’s own scope if it does
// not appear in any scope.
ScheduledFiber.prototype.setValue = function(name, value) {
    const original = scope => {
        if (Object.hasOwn(scope, name)) {
            return scope;
        }
        const parent = Object.getPrototypeOf(scope);
        return scope === Object.prototype ? this.scope : original(parent);
    };
    original(this.scope)[name] = value;
};

// Event delegate that calls `preventDefault()` on the event that was handled.
export const PreventDefault = {
    eventWasHandled(event) {
        event.preventDefault();
    }
};

// Delegate to join on first child ending, cancelling all siblings.
export const First = { childFiberDidJoin: cancelSiblings };

export function cancelSiblings(child, scheduler) {
    for (const sibling of child.parent.children) {
        scheduler.cancelFiber(sibling);
    }
}

// Create a new scheduler and a main fiber, then start the clock. The fiber is
// returned so that new instructions can be added immediately. Errors are also
// reported to the console.
export function run() {
    const scheduler = new Scheduler();
    scheduler.addEventListener("error", ({ detail: { error } }) => { console.error(error.message ?? error); })
    scheduler.clock.start();
    const fiber = new Fiber();
    scheduler.scheduleFiber(fiber, 0);
    return fiber;
}
