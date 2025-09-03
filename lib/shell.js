import { Fiber, Scheduler } from "./unrated.js";

Fiber.prototype.macro = function(f) {
    f(this);
    return this;
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
