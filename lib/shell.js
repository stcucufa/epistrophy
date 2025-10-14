import { K } from "./util.js";
import { Fiber, ScheduledFiber, Scheduler } from "./kernel.js";

export { TransportBar } from "./transport-bar.js";

// Advanced uses of the shell may require creating a Scheduler or Fiber
// directly.
export { Scheduler, Fiber };

// Execute f with the fiber as argument and return the fiber; useful for
// appending a block of instructions to a fiber.
Fiber.prototype.append = function(f) {
    f(this);
    return this;
};

// Shorthand for call(K(x)); set the value of the fiber to a constant.
Fiber.prototype.K = function(x) {
    return this.call(K(x));
};

// Set the timescale of the fiber (inverse of rate).
Fiber.prototype.scale = function(scale) {
    // FIXME 4X03 Kernel: undo
    // FIXME 5002 Kernel: pause (fiber rate 0)
    // FIXME 5003 Kernel: fiber rate ∞
    console.assert(scale > 0 && isFinite(scale));
    return this.call((fiber, scheduler) => { scheduler.setRateForFiber(fiber, 1 / scale); });
};

// Repeat a fiber. Like `Fiber.spawn()`, a new fiber is created; if a function
// `f` is provided, it is called with the new fiber as its argument, and the
// original fiber is returned; otherwise, the new fiber is returned. The
// optional delegate method `repeatShouldEnd` should return true when the
// repetition should end and is called before every iteration with the current
// iteration count (starting at 0 before the first iteration begins).
Fiber.prototype.repeat = function(f, delegate) {
    const body = new Fiber();
    this.seq(fiber => fiber.
        call((fiber, scheduler) => {
            if (delegate?.repeatShouldEnd?.call(delegate, 0, fiber, scheduler)) {
                return;
            }
            scheduler.attachFiber(fiber, body);
        }).
        join({
            fiberWillJoin() {
                this.i = 0;
            },

            childFiberDidJoin(child, scheduler) {
                delegate?.childFiberDidJoin?.call(delegate, child, scheduler);
                const fiber = child.parent;
                if (child.error) {
                    // Any error during a repeat is an error for the repeat
                    // itself.
                    fiber.error = child.error;
                }
                this.i += 1;
                if ((fiber.error && !fiber.handlesErrors) ||
                    delegate?.repeatShouldEnd?.call(delegate, this.i, fiber, scheduler)) {
                    return;
                }
                scheduler.attachFiber(fiber, body);
            }
        })
    );
    if (typeof f === "function") {
        f(body);
        return this;
    }
    return body;
};

// Repeat a fiber while updating the value after each iteration.
Fiber.prototype.repeatValue = function(f, delegate) {
    const childFiberDidJoin = (child, scheduler) => {
        child.parent.value = child.value;
        delegate?.childFiberDidJoin?.call(delegate, child, scheduler);
    };
    return this.repeat(f, delegate ? { ...delegate, childFiberDidJoin } : { childFiberDidJoin });
};

// Repeat a fiber for every item of the (array) value of the fiber.
Fiber.prototype.each = function(f) {
    const body = new Fiber();
    this.seq(fiber => fiber.
        call((fiber, scheduler) => {
            if (fiber.value.length > 0) {
                const scheduledFiber = scheduler.attachFiber(fiber, body);
                scheduledFiber.value = fiber.value[0];
            }
        }).
        join({
            fiberWillJoin() {
                this.i = 0;
            },

            childFiberDidJoin(child, scheduler) {
                const fiber = child.parent;
                if (child.error) {
                    fiber.error = child.error;
                }
                this.i += 1;
                if ((fiber.error && !fiber.handlesErrors) || this.i >= fiber.value.length) {
                    return;
                }
                const scheduledFiber = scheduler.attachFiber(fiber, body);
                scheduledFiber.value = fiber.value[this.i];
            }
        })
    );
    if (typeof f === "function") {
        f(body);
        return this;
    }
    return body;
};

// Spawn a new fiber for every item of the (array) value of the fiber.
// FIXME 5005 Review spawn argument handling
Fiber.prototype.mapspawn = function(f) {
    const body = new Fiber();
    f(body);
    return this.call((fiber, scheduler) => {
        for (const v of fiber.value) {
            scheduler.attachFiber(fiber, body).value = v;
        }
    });
};

// Create a new fiber populated with `f`, and spawn it for every item of the
// (array) value of the fiber, then join, collecting the value of each child
// fiber in the order in which they finish.
Fiber.prototype.map = function(f) {
    return this.seq(fiber => fiber.
        mapspawn(f).
        K([]).
        join({
            childFiberDidJoin(child, scheduler) {
                const parent = child.parent;
                if (child.error) {
                    if (!parent.error) {
                        parent.error = child.error;
                        cancelSiblings(child, scheduler);
                    }
                } else {
                    parent.value.push(child.value);
                }
            }
        })
    );
};

// Create a new fiber populated with `f`, and spawn it for every item of the
// (array) value of the fiber, then join, collecting the value of each child
// fiber keeping the same order.
Fiber.prototype.maporder = function(f) {
    return this.seq(fiber => fiber.
        mapspawn(f).
        call(({ children }) => children.slice()).
        join({
            childFiberDidJoin(child, scheduler) {
                const parent = child.parent;
                if (child.error) {
                    if (!parent.error) {
                        parent.error = child.error;
                        cancelSiblings(child, scheduler);
                    }
                } else {
                    parent.value[parent.value.indexOf(child)] = child.value;
                }
            }
        })
    );
};

// Same as map but end with the value of the first child fiber that ends.
Fiber.prototype.mapfirst = function(f) {
    return this.seq(fiber => fiber.
        mapspawn(f).
        join(FirstValue)
    );
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
export const First = {
    childFiberDidJoin(child, scheduler) {
        if (!child.error) {
            cancelSiblings(child, scheduler);
        }
    }
};

// Delegate to join on first child ending, using the child value as the parent
// fiber value.
export const FirstValue = {
    childFiberDidJoin(child, scheduler) {
        if (!child.error) {
            cancelSiblings(child, scheduler);
            child.parent.value = child.value;
        }
    }
};

export function cancelSiblings(child, scheduler) {
    for (const sibling of child.parent.children) {
        scheduler.cancelFiber(sibling);
    }
}

// Create a new scheduler and a main fiber, then start the clock. The fiber is
// returned so that new instructions can be added immediately. Errors are also
// reported to the console.
export function run() {
    return new Scheduler().run();
}

// Same as above but with an existing scheduler.
Scheduler.prototype.run = function() {
    this.addEventListener("error", ({ detail: { error } }) => { console.error(error.message ?? error); })
    this.clock.start();
    const fiber = new Fiber();
    this.scheduleFiber(fiber, 0);
    return fiber;
};
