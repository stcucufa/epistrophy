import { Fiber, ScheduledFiber, Scheduler } from "./unrated.js";

// Execute f with the fiber as argument and return the fiber.
Fiber.prototype.macro = function(f) {
    f(this);
    return this;
};

// Repeat a fiber. Like `Fiber.spawn()`, a new fiber is created; if a function
// `f` is provided, it is called with the new fiber as its argument, and the
// original fiber is returned; otherwise, the new fiber is returned. The
// optional delegate method `repeatShouldEnd` should return true when the
// repetition should end and is called before every iteration with the current
// iteration count (starting at 0 before the first iteration begins).
Fiber.prototype.repeat = function(f, delegate) {
    const body = new Fiber();
    this.
        sync((fiber, scheduler) => {
            if (delegate?.repeatShouldEnd?.call(delegate, 0, fiber, scheduler)) {
                return;
            }
            scheduler.attachFiber(fiber, body);
        }).
        join({
            iterationCount: 0,
            childFiberDidJoin(child, scheduler) {
                delegate?.childFiberDidJoin?.call(delegate, child, scheduler);
                this.iterationCount += 1;
                const fiber = child.parent;
                if ((fiber.error && !fiber.handlesErrors) ||
                    delegate?.repeatShouldEnd?.call(delegate, this.iterationCount, fiber, scheduler)) {
                    return;
                }
                scheduler.attachFiber(fiber, body);
            }
        });
    if (typeof f === "function") {
        f(body);
        return this;
    }
    return body;
};

// Set a value in its original scope, or in the fiber’s own scope if it does
// not appear in any scope.
ScheduledFiber.prototype.setOriginalValue = function(name, value) {
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
