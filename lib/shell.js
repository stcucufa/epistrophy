import { extend, K } from "./util.js";
import { Fiber, ScheduledFiber, Scheduler } from "./kernel.js";

export { TransportBar } from "./transport-bar.js";

// Advanced uses of the shell may require creating a Scheduler or Fiber
// directly.
export { Scheduler, Fiber };

// Give a name to a fiber and set its ID.
Fiber.prototype.named = function(name) {
    this.name = name ?? Symbol();
    this.id = this.name.toString();
    return this;
};

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

// Set the rate of the fiber.
Fiber.prototype.rate = function(rate) {
    // FIXME 4X03 Kernel: undo
    console.assert(rate >= 0);
    return this.call(fiber => { fiber.scheduler.setRateForFiber(fiber, rate); });
};

// Set the timescale of the fiber (inverse of rate). A scale of 0 is the same
// as an infinite rate.
Fiber.prototype.scale = function(scale) {
    // FIXME 4X03 Kernel: undo
    console.assert(scale >= 0);
    return this.call(fiber => { fiber.scheduler.setRateForFiber(fiber, 1 / scale); });
};

// Spawn a fiber that loops indefinitely; i.e., that jumps back to its first
// instruction as soon as it reaches its last.
Fiber.prototype.loop = function(f) {
    const child = this.spawn();
    f(child);
    child.call(fiber => { fiber.ip = 0; });
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
    const instance = extend(delegate);
    this.
        call(fiber => {
            if (instance.repeatShouldEnd?.(0, fiber)) {
                return;
            }
            fiber.scheduler.attachFiber(fiber, body);
        }).
        join({
            fiberWillJoin(fiber) {
                this.i = 0;
                this.child = fiber.children.at(-1);
            },

            finalChildFiberDidJoin(child) {
                if (child !== this.child) {
                    return;
                }
                instance.childFiberDidJoin?.(child);
                const fiber = child.parent;
                if (child.error) {
                    // Any error during a repeat is an error for the repeat
                    // itself.
                    fiber.error = child.error;
                }
                this.i += 1;
                // FIXME 5505 Uncaught exception if repeatShouldEnd throws
                try {
                    if ((fiber.error && !fiber.handlesErrors) ||
                        instance.repeatShouldEnd?.(this.i, fiber)) {
                        return true;
                    }
                } catch (error) {
                    fiber.errorWithMessage(error);
                    return true;
                }
                this.child = fiber.scheduler.attachFiber(fiber, body);
            }
        })
    if (typeof f === "function") {
        f(body);
        return this;
    }
    return body;
};

// Repeat a fiber while updating the value after each iteration.
Fiber.prototype.repeatValue = function(f, delegate) {
    const childFiberDidJoin = child => {
        child.parent.value = child.value;
        delegate?.childFiberDidJoin?.call(this, child);
    };
    return this.repeat(f, delegate ? { ...delegate, childFiberDidJoin } : { childFiberDidJoin });
};

// Repeat a fiber for every item of the (array) value of the fiber.
Fiber.prototype.each = function(f) {
    const body = new Fiber();
    this.
        call(fiber => {
            if (fiber.value.length > 0) {
                fiber.scheduler.attachFiberWithValue(fiber, body, fiber.value[0]);
            }
        }).
        join({
            fiberWillJoin() {
                this.i = 0;
                this.child = fiber.children.at(-1);
            },

            finalChildFiberDidJoin(child) {
                if (child !== this.child) {
                    return;
                }
                const fiber = child.parent;
                if (child.error) {
                    fiber.error = child.error;
                }
                this.i += 1;
                if ((fiber.error && !fiber.handlesErrors) || this.i >= fiber.value.length) {
                    return true;
                }
                this.child = fiber.scheduler.attachFiberWithValue(fiber, body, fiber.value[this.i]);
            }
        });
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
    return this.call(fiber => {
        for (const value of fiber.value) {
            fiber.scheduler.attachFiberWithValue(fiber, body, value);
        }
    });
};

// Create a new fiber populated with `f`, and spawn it for every item of the
// (array) value of the fiber, then join, collecting the value of each child
// fiber in the order in which they finish.
Fiber.prototype.map = function(f) {
    return this.
        mapspawn(f).
        join({
            fiberWillJoin(fiber) {
                this.children = new Set(fiber.children.slice(fiber.children.length - fiber.value.length));
                fiber.value = [];
            },

            finalChildFiberDidJoin(child) {
                if (!this.children.has(child)) {
                    return;
                }
                this.children.delete(child);
                const parent = child.parent;
                if (child.error) {
                    if (!parent.error) {
                        parent.error = child.error;
                        cancelSiblings(child);
                    }
                } else {
                    parent.value.push(child.value);
                }
                return this.children.size === 0;
            }
        });
};

// Create a new fiber populated with `f`, and spawn it for every item of the
// (array) value of the fiber, then join, collecting the value of each child
// fiber keeping the same order.
Fiber.prototype.maporder = function(f) {
    return this.
        mapspawn(f).
        join({
            fiberWillJoin(fiber) {
                this.children = new Map(fiber.children.slice(fiber.children.length - fiber.value.length).map(
                    (child, i) => [child, i]
                ));
                fiber.value = [];
            },

            childFiberDidJoin(child) {
                if (!this.children.has(child)) {
                    return;
                }
                const index = this.children.get(child);
                this.children.delete(child);
                const parent = child.parent;
                if (child.error) {
                    if (!parent.error) {
                        parent.error = child.error;
                        cancelSiblings(child);
                    }
                } else {
                    parent.value[index] = child.value;
                }
                return children.size === 0;
            }
        });
};

// Same as map but end with the value of the first child fiber that ends.
Fiber.prototype.mapfirst = function(f) {
    return this.
        mapspawn(f).
        join(FirstValue);
};

// The name of a scheduled fiber is the name of the fiber it is an instance of.
Object.defineProperty(ScheduledFiber.prototype, "name", {
    enumerable: true,
    get() {
        return this.fiber.name;
    }
});

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
    childFiberDidJoin(child) {
        if (!child.error) {
            cancelSiblings(child);
        }
    }
};

// Delegate to join on first child ending, using the child value as the parent
// fiber value.
export const FirstValue = {
    childFiberDidJoin(child) {
        if (!child.error) {
            cancelSiblings(child);
            child.parent.value = child.value;
        }
    }
};

export function cancelSiblings(child) {
    for (const sibling of child.parent.children) {
        sibling.scheduler.cancelFiber(sibling);
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

// Attach a fiber and set its initial value.
Scheduler.prototype.attachFiberWithValue = function(fiber, child, value) {
    const scheduledFiber = this.attachFiber(fiber, child);
    scheduledFiber.value = value;
    return scheduledFiber;
};
