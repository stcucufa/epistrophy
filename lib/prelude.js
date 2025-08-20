import Fiber from "./fiber.js";
import Scheduler from "./scheduler.js";
import { on, parseOffsetValue } from "./util.js";

export { Fiber, Scheduler };

// Keep chaining when building fibers.
Fiber.prototype.macro = function(f) {
    f(this);
    return this;
};

// Pause self (setting the fiber own rate to 0).
Fiber.prototype.pause = function() {
    return this.sync(setFiberRate(0));
};

// Set the time scale of the fiber based on a duration (which is the inverse of
// the rate). For instance, 1000 is a rate of 0.001, or 1 second per unit. An
// offset value may be used instead, such as "1s" or "0:00:01" for one second.
// 0 and Infinity are handled correctly as well.
Fiber.prototype.timescale = function(dur) {
    const parsedDur = typeof dur === "number" ? dur : typeof dur === "string" ? parseOffsetValue(dur) : dur;
    if (isNaN(parsedDur)) {
        throw Error(`timescale value ${dur} is incorrect; expected a number or clock value`);
    }
    return this.sync(setFiberRate(1 / parsedDur));
};

// Undo (setting own rate to -1).
Fiber.prototype.undo = function() {
    return this.sync(setFiberRate(-1));
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
    on(scheduler, "error", ({ error }) => { console.error(error.message ?? error); });
    scheduler.clock.start();
    const fiber = new Fiber();
    scheduler.scheduleFiber(fiber);
    return fiber;
}

// Shorthand to set the fiber’s own rate. See timescale, pause and undo above.
export const setFiberRate = rate => (fiber, scheduler) => { scheduler.setFiberRate(fiber, rate); };
