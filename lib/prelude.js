import Fiber from "./fiber.js";
import Scheduler from "./scheduler.js";
import { extend, on } from "./util.js";

export { Fiber, Scheduler };

// Setup an event listener, piggybacking on the asyncDelegate pattern used for
// the async op (including for undo).
Fiber.Ops.event = function(scheduler, target, name, delegate) {
    if (this.rate < 0) {
        return Fiber.Ops.beginasync.call(this);
    }
    const instance = this.asyncDelegate = extend(delegate ?? {}, {
        target: this.getEffectiveParameter(target),
        name: this.getEffectiveParameter(name),
        observedBegin: scheduler.now,
    });
    instance.handler = event => {
        if (this.rate <= 0 || this.asyncDelegate !== instance) {
            return;
        }
        instance.target.removeEventListener(instance.name, instance.handler);
        this.asyncDidEnd(scheduler);
    };
    instance.target.addEventListener(instance.name, instance.handler);
    return Fiber.Yield;
};

// Async op for listening to DOM events.
// TODO synchronous messages with on/message
// TODO reject events, prevent default, &c.
Fiber.prototype.event = function(target, name, delegate) {
    this.ops.push(["event", target, name, delegate]);
    this.ops.push(["endasync"]);
    return this;
};

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
export function run() {
    const scheduler = new Scheduler();
    on(scheduler, "error", ({ error }) => { console.error(error.message ?? error); });
    scheduler.clock.start();
    const fiber = new Fiber();
    scheduler.scheduleFiber(fiber);
    return fiber;
}
