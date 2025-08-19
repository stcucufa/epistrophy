import Fiber from "./fiber.js";
import Scheduler from "./scheduler.js";
import { on } from "./util.js";

export { Fiber, Scheduler };

// Keep chaining when building fibers.
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
export const run = () => new Scheduler().run();

Scheduler.prototype.run = function() {
    on(this, "error", ({ error }) => { console.error(error.message ?? error); });
    this.clock.start();
    const fiber = new Fiber();
    this.scheduleFiber(fiber);
    return fiber;
};
