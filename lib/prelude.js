import Fiber from "./fiber.js";
import Scheduler from "./scheduler.js";
import { on } from "./util.js";

export { Fiber, Scheduler };

// Setup an event listener, piggybacking on the asyncDelegate pattern used for
// the async op (including for undo).
Fiber.Ops.event = function(scheduler, target, name, delegate) {
    if (this.rate < 0) {
        return Fiber.Ops.beginasync.call(this);
    }
    // Setup the event delegate for this instance.
    console.assert(!this.asyncDelegate);
    this.asyncDelegate = delegate;
    delegate.target = this.getEffectiveParameter(target);
    delegate.name = this.getEffectiveParameter(name);
    delegate.observedBegin = scheduler.now;
    delegate.fiber = this;
    delegate.scheduler = scheduler;
    if (typeof delegate.target.addEventListener === "function") {
        delegate.target.addEventListener(delegate.name, delegate);
    } else {
        on(delegate.target, delegate.name, delegate);
    }
    return Fiber.Yield;
};

// Listen to an event or message on a target and a name before resuming. Events
// can be filtered out if the optional `eventShouldBeIgnored` delegate method
// returns true for that event; otherwise, the optional `eventWasHandled`
// delegate method is called before resuming.
Fiber.prototype.event = function(target, name, delegate) {
    const eventDelegate = Object.assign(delegate ? Object.create(delegate) : {}, {
        asyncWasCancelled(fiber, scheduler) {
            this.target.removeEventListener(this.name, this);
        },
        handleEvent(event) {
            if (delegate?.eventShouldBeIgnored?.call(delegate, event, this.fiber, this.scheduler)) {
                return;
            }
            delegate?.eventWasHandled?.call(delegate, event, this.fiber, this.scheduler);
            this.target.removeEventListener(this.name, this);
            this.fiber.asyncDidEnd(this.scheduler);
        },
        handleMessage(message) {
            if (delegate?.eventShouldBeIgnored?.call(delegate, message, this.fiber, this.scheduler)) {
                return;
            }
            delegate?.eventWasHandled?.call(delegate, message, this.fiber, this.scheduler);
            off(this.target, this.name, this);
            this.fiber.asyncDidEnd(this.scheduler);
        }
    });
    this.ops.push(["event", target, name, eventDelegate]);
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
