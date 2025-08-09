import { extend, message, nop, remove } from "./util.js";

const Ops = {
    // Call f and handle its return value or error, then resume the fiber.
    // Yield until the call ends. When going backward, handle the end of a ramp.
    beginasync(scheduler, f, delegate) {
        if (this.rate > 0) {
            const instance = this.asyncDelegate = extend(delegate, { observedBegin: scheduler.now });
            f(this, scheduler).then(value => {
                if (this.asyncDelegate === instance) {
                    delegate.asyncWillEnd?.call(delegate, value, this, scheduler);
                    this.asyncDidEnd(scheduler);
                }
            }).catch(error => {
                if (this.asyncDelegate === instance) {
                    delegate.asyncWillEndWithError?.call(delegate, error, this, scheduler);
                    this.asyncDidEnd(scheduler, error);
                }
            });
            return Fiber.Yield;
        }
        // Reverse: the ramp ended, the async delegate can be deleted.
        delete this.asyncDelegate;
        scheduler.endRampForFiber(this, 0);
    },

    // When reversing an async call, simply ramp backward with the same
    // duration. A reverse function f may have been provided by reverse().
    endasync(scheduler, f) {
        if (this.rate < 0) {
            f?.(this, scheduler);
            const [, begin] = this.trace.at(-1);
            return scheduler.beginRampForFiber(this, this.now - begin, nop, 1);
        }
    },

    // Increment (or decrement) the ever count of the fiber, reversing it when
    // going backward.
    ever(_, incr) {
        this.ever += incr * (this.rate < 0 ? -1 : 1);
        console.assert(this.ever >= 0);
    },

    // Create a new instance of the join delegate, storing the begin time and
    // pending child fibers and calling the optional delegate method
    // `fiberWillJoin` with the delegate as `this`. When there are no child
    // fibers to join, end synchronously.
    beginjoin(scheduler, delegate) {
        if (this.rate > 0) {
            if (!this.children) {
                return;
            }
            console.assert(this.children.length > 0);
            this.joinDelegate = extend(delegate, { pending: new Set(this.children) });
            delegate.fiberWillJoin?.call(delegate, this, scheduler);
            return Fiber.Yield;
        }
        // Reverse: the ramp ended, the join delegate can be deleted.
        // fiberWillJoin may have had effects that we want to reverse.
        delegate.fiberWillJoinReverse?.call(delegate, this, scheduler);
        scheduler.endRampForFiber(this, 0);
    },

    // End a join: clean up and resume.
    endjoin(scheduler) {
        if (this.rate > 0) {
            // The next op has already been pushed to the trace so save the
            // children to the next to last entry, which is the endjoin.
            console.assert(this.ops[this.trace.at(-2)[0]][0] === "endjoin");
            this.trace.at(-2).push(this.children);
            delete this.joinDelegate;
            delete this.children;
        } else {
            const [, begin,, children] = this.trace.at(-1);
            this.children = children;
            scheduler.setChildFibersRate(this);
            // Always yield, even when the join was synchronous; the fiber must
            // then be scheduled if `beginRamp` does not do it.
            if (!scheduler.beginRampForFiber(this, this.now - begin, nop, 1)) {
                scheduler.scheduleFiber(this);
            }
            return Fiber.Yield;
        }
    },

    // Begin a ramp, evaluating its effective duration if necessary, or end it
    // when going backward.
    beginramp(scheduler, dur, f) {
        if (this.rate > 0) {
            const effectiveDuration = Math.max(0, this.getEffectiveParameter(dur, scheduler));
            return scheduler.beginRampForFiber(this, isNaN(effectiveDuration) ? 0 : effectiveDuration, f, 0);
        } else {
            // End back at the beginning of the ramp.
            scheduler.endRampForFiber(this, 0);
        }
    },

    // End a ramp (when going forward) or begin in reverse when going backward
    // using the same duration as when going forward.
    endramp(scheduler, f) {
        if (this.rate > 0) {
            scheduler.endRampForFiber(this, 1);
        } else {
            // Start a backward ramp with the same duration that just elapsed
            // (or if the ramp was interrupted because the fiber was cancelled,
            // with the same duration as the original ramp and picking up at
            // the point where it was interrupted, which can be recalled from
            // the trace).
            const [, begin,, dur, p] = this.trace.at(-1);
            return scheduler.beginRampForFiber(this, dur ?? this.now - begin, f, p ?? 1);
        }
    },

    // Begin a repeat by setting up the delegate (if necessary) and calling its
    // repeatShouldEnd() method with the current iteration count (starting at
    // zero). If this returns true, then skip to after the repeat, otherwise
    // attach an instance of the body fiber and yield.
    beginrepeat(scheduler, delegate, body) {
        if (this.rate > 0) {
            if (!this.joinDelegate) {
                this.joinDelegate = extend(delegate, { iteration: 0 });
            } else {
                this.joinDelegate.iteration += 1;
            }
            if (delegate.repeatShouldEnd?.call(delegate, this.joinDelegate.iteration, this, scheduler)) {
                delete this.joinDelegate;
                // Skip the next op.
                return 1;
            } else {
                const instance = scheduler.attachFiber(this, extend(body, { id: Fiber.ID++ }));
                this.joinDelegate.pending = new Set([instance]);
                return Fiber.Yield;
            }
        }
        // If there was an iteration, then a ramp began while the body is
        // reversing.
        if (scheduler.ramps.has(this)) {
            scheduler.endRampForFiber(this, 0);
        }
    },

    // End an iteration by going back to the beginning of the repeat.
    endrepeat(scheduler) {
        if (this.rate > 0) {
            // Save the body instance so that it can be unended and skip back
            // two ops to the matching beginrepeat.
            console.assert(this.ops[this.trace.at(-2)[0]][0] === "endrepeat");
            this.trace.at(-2).push(this.children);
            delete this.children;
            return -2;
        }
        // Similar to endjoin, unend the body fiber (stored above in the trace)
        // and setup a ramp for the duration (always yielding) of that fiber.
        return Ops.endjoin.call(this, scheduler);
    },

    // Attach an instance of a fiber to the parent.
    spawn(scheduler, child) {
        if (this.rate > 0) {
            const instance = scheduler.attachFiber(this, extend(child, { id: Fiber.ID++ }));
            this.trace.at(-2).push(instance);
        } else {
            const instance = this.trace.at(-1).at(-1);
            console.assert(Object.getPrototypeOf(instance) === child);
            console.assert(instance.parent === this);
            delete instance.parent;
            remove(this.children, instance);
            if (this.children.length === 0) {
                delete this.children;
            }
        }
    },

    // Call f synchronously with the fiber and scheduler as arguments.
    sync(scheduler, f, g) {
        if (this.rate > 0) {
            f(this, scheduler);
        } else {
            console.assert(this.rate < 0);
            g?.(this, scheduler);
        }
    }
};

const ReversibleArity = {
    endasync: 1,
    sync: 2
};

export default class Fiber {
    constructor() {
        this.ops = [];
        this.id = Fiber.ID++;
    }

    static ID = 0;
    static Yield = Symbol.for("yield");
    static Cancelled = Symbol.for("cancelled");

    // Add an async op to the fiber and return the fiber. A delegate can handle
    // the result of the call with its optional `asyncWillEndWithValue` and
    // `asyncWillEndWithError` methods that get called when the async call
    // finishes and before moving to the next op.
    async(f, delegate = {}) {
        this.ops.push(["beginasync", f, delegate]);
        this.ops.push(["endasync"]);
        return this;
    }

    // Wrap a block f (called with the fiber) into a pair of ever instructions,
    // allowing the block to be executed even when an error occurs.
    ever(f) {
        this.ops.push(["ever", 1]);
        f(this);
        this.ops.push(["ever", -1]);
        return this;
    }

    // Wait for child fibers to end, calling delegate methods before suspending
    // and anytime a child fiber ends.
    join(delegate = {}) {
        this.ops.push(["beginjoin", delegate]);
        this.ops.push(["endjoin"]);
        return this;
    }

    // Add begin/end ramp ops to the fiber with the given duration and callback.
    // Return the fiber.
    ramp(dur, f = nop) {
        this.ops.push(
            ["beginramp", dur, f],
            ["endramp", f]
        );
        return this;
    }

    // Repeat a block f an infinite number of times, or until the delegate
    // method `repeatShouldEnd()` returns true.
    repeat(f, delegate = {}) {
        const body = new Fiber();
        this.ops.push(["beginrepeat", delegate, body]);
        this.ops.push(["endrepeat"]);
        if (typeof f === "function") {
            f(body);
            return this;
        }
        return body;
    }

    // Spawn a child fiber.
    spawn(f) {
        const child = new Fiber();
        this.ops.push(["spawn", child]);
        if (typeof f === "function") {
            f(child);
            return this;
        }
        return child;
    }

    // Add a sync op to the fiber and return it.
    sync(f) {
        this.ops.push(["sync", f]);
        return this;
    }

    // Provide a custom reverse effect to ops that allow it.
    reverse(f) {
        if (this.ops.length === 0) {
            throw Error("Nothing to reverse");
        }
        const op = this.ops.at(-1);
        const arity = ReversibleArity[op[0]];
        if (isNaN(arity)) {
            throw Error(`Cannot provide a reverse effect for ${op[0]}`);
        }
        if (op.length > arity) {
            throw Error(`Already provided a reverse effect for ${op[0]}`);
        }
        op.push(f);
        return this;
    }

    // Run all ops, building a trace of the execution of instructions. When
    // going forward, the last element in the trace gives the index of the
    // next instruction to execute as well as the current local time. Executing
    // an instruction returns true when the fiber should yield. The generator
    // returns when reaching the end of the sequence, or when an error occurs.
    *run(scheduler) {
        if (!Object.hasOwn(this, "now")) {
            this.now = 0;
            this.trace = [[0, this.now]];
            this.spawns = new Map();
            this.ever = 0;
            this.rate = this.parent?.rate ?? 1;
            this.ownRate = 1;
            this.scope = this.parent ? Object.create(this.parent.scope) : {};
            this.parent?.childFiberWillBegin(this);
        }
        if (this.rate === 0) {
            yield;
        }
        for (
            let n = this.ops.length, [ip] = this.trace.at(-1);
            ((this.rate > 0 && 0 <= ip && ip < n) || (this.rate < 0 && this.trace.length > 1));
        ) {
            let allowError = this.ever > 0;
            if (this.rate < 0) {
                // FIXME 4M08 Core: redo
                const [nextip, end, error] = this.trace.pop();
                ip = nextip - 1;
                this.error = error;
                if (error && !allowError) {
                    // If we are recovering from an async error or from a
                    // cancelled ramp, we still need to ramp back.
                    const [_, begin, unerror] = this.trace.at(-1);
                    if (begin < end && error !== unerror) {
                        console.assert(!unerror);
                        allowError = true;
                    }
                }
            }
            const [op, ...args] = this.ops[ip];
            if (this.rate > 0) {
                ip += 1;
                this.trace.push([ip, this.now, this.error]);
            }
            if (this.error && !allowError && op !== "ever") {
                continue;
            }
            try {
                const v = Ops[op].call(this, scheduler, ...args);
                if (v === Fiber.Yield || this.rate === 0) {
                    yield;
                } else if (typeof v === "number") {
                    ip += v;
                }
            } catch (error) {
                this.errorWithMessage(scheduler, error);
            }
        }
    }

    // Resume after an async call ended, updating the fiber local time.
    asyncDidEnd(scheduler, error) {
        console.assert(this.rate >= 0);
        const now = scheduler.clock.now;
        this.now += (now - this.asyncDelegate.observedBegin) * this.rate;
        delete this.asyncDelegate;
        if (this.rate > 0) {
            scheduler.scheduleFiber(this, now);
        }
        if (error) {
            this.errorWithMessage(scheduler, error);
        }
        return true;
    }

    // When a fiber begins, set its spawn time to keep track of its local time.
    childFiberWillBegin(fiber) {
        console.assert(!this.spawns.has(fiber));
        this.spawns.set(fiber, this.now);
    }

    // Handle child fibers ending when a join is in progress. Return true when
    // all child fibers have ended.
    childFiberDidEnd(fiber, scheduler) {
        if (!this.joinDelegate) {
            return;
        }
        const end = this.spawns.get(fiber) + fiber.now;
        console.assert(end >= this.now);
        this.now = end;
        this.spawns.delete(fiber);
        console.assert(this.joinDelegate.pending.has(fiber));
        this.joinDelegate.pending.delete(fiber);
        const delegate = Object.getPrototypeOf(this.joinDelegate);
        delegate.childFiberDidJoin?.call(delegate, fiber, scheduler);
        return this.joinDelegate.pending.size === 0;
    }

    // Set the error field of the result and send a message to report it.
    errorWithMessage(scheduler, error) {
        this.error = error;
        message(scheduler, "error", { fiber: this, error });
    }

    // Evaluate a parameter if necessary, or pass its value through.
    getEffectiveParameter(value, scheduler) {
        if (typeof value === "function") {
            return value(this, scheduler);
        }
        return value;
    }
}
