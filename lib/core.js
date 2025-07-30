import { extend, message, nop, on, PriorityQueue, remove } from "./util.js";
import Clock from "./clock.js";

const Ops = {
    // Call f and handle its return value or error, then resume the fiber.
    // Yield until the call ends. When going backward, handle the end of a ramp.
    beginasync(scheduler, f, delegate) {
        if (this.rate > 0) {
            const instance = this.asyncDelegate = extend(delegate, { observedBegin: scheduler.now });
            f(this, scheduler).then(value => {
                if (this.asyncDelegate === instance) {
                    delegate.asyncWillEnd?.call(delegate, value, this, scheduler);
                    this.asyncEnded(scheduler);
                }
            }).catch(error => {
                if (this.asyncDelegate === instance) {
                    delegate.asyncWillEndWithError?.call(delegate, error, this, scheduler);
                    this.asyncEnded(scheduler, error);
                }
            });
            return true;
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
            return scheduler.beginRampForFiber(this, begin - this.now, nop, 1);
        }
    },

    // Increment (or decrement) the ever count of the fiber, reversing it when
    // going backward.
    ever(_, incr) {
        this.ever += incr * (this.rate < 0 ? -1 : 1);
        console.assert(this.ever >= 0);
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
            // Start a backward ramp back to the previous time (dur ≤ 0).
            const [, begin] = this.trace.at(-1);
            return scheduler.beginRampForFiber(this, begin - this.now, f, 1);
        }
    },

    // Attach an instance of a fiber to the parent.
    spawn(scheduler, child) {
        if (this.rate > 0) {
            const instance = scheduler.attachFiber(this, extend(child, { id: Fiber.ID++ }));
            this.spawns.set(instance, this.now);
        } else {
            delete child.parent;
            remove(this.children, child);
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

export class Fiber {
    constructor() {
        this.ops = [];
        this.id = Fiber.ID++;
    }

    static ID = 0;

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

    // Add begin/end ramp ops to the fiber with the given duration and callback.
    // Return the fiber.
    ramp(dur, f = nop) {
        this.ops.push(
            ["beginramp", dur, f],
            ["endramp", f]
        );
        return this;
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
                    // If we are recovering from an async error, we still need
                    // a ramp to maintain the timing of the fiber.
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
                if (Ops[op].call(this, scheduler, ...args) || this.rate === 0) {
                    yield;
                }
            } catch (error) {
                this.errorWithMessage(scheduler, error);
            }
        }
    }

    // Resume after an async call ended, updating the fiber local time.
    asyncEnded(scheduler, error) {
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

export class Scheduler {
    constructor() {
        // Create a default clock to drive the updates.
        this.clock = new Clock();
        on(this.clock, "tick", ({ begin, end }) => { this.update(begin, end); });

        // All instants (times) at which fibers are scheduled.
        this.instants = new PriorityQueue();

        // Lists of fibers scheduled at a given instant.
        this.fibersByInstant = new Map();
        this.instantsByFiber = new Map();

        // Keep track of active fibers, mapping the run generator to the fiber.
        this.fibers = new Map();

        // List of fibers that have an ongoing ramp.
        this.ramps = new Map();

        // Scheduler time.
        this.now = 0;
    }

    // Attach a child fiber like spawn does, creating it if necessary. This can
    // be used to add new child fibers while the parent is still joining. The
    // fiber is added to the spawn queue or scheduled at the current time.
    attachFiber(fiber, child) {
        if (!child) {
            child = new Fiber();
        }
        child.parent = fiber;
        if (!fiber.children) {
            fiber.children = [];
        }
        fiber.children.push(child);
        if (this.spawnQueue) {
            this.spawnQueue.push(child);
        } else {
            this.scheduleFiber(child, this.clock.now);
        }
        return child;
    }

    // Schedule a fiber to resume execution at time t (now by default). When t
    // is infinite, the fiber is not actually added to the schedule.
    scheduleFiber(fiber, t) {
        t = t ?? this.now;
        console.assert(t >= this.now);
        this.instantsByFiber.set(fiber, t);
        if (!isFinite(t)) {
            return;
        }
        if (!this.fibersByInstant.has(t)) {
            this.instants.insert(t);
            this.fibersByInstant.set(t, [fiber]);
        } else {
            this.fibersByInstant.get(t).push(fiber);
        }
        this.clock.advance();
    }

    // Reschedule a fiber by removing it from the schedule and resuming it
    // again.
    rescheduleFiber(fiber, t) {
        const instant = this.instantsByFiber.get(fiber);
        if (instant === t) {
            return;
        }
        if (isFinite(instant)) {
            remove(this.fibersByInstant.get(instant), fiber);
        }
        this.instantsByFiber.delete(fiber);
        this.scheduleFiber(fiber, t);
    }

    // The fiber is not active anymore.
    fiberEnded(fiber) {
        fiber.observedEnd = this.now;
        this.fibers.delete(fiber);
    }

    // Set the rate of the fiber, which is affected by its parent’s (if any),
    // and then set the rate of the child fibers.
    // If a ramp is ongoing, update its observed begin and duration to reflect
    // the new rate and reschedule to fiber with the new observed end.
    setFiberRate(fiber, rate) {
        if (rate === fiber.ownRate) {
            return;
        }
        const effectiveRate = rate * (fiber.parent?.rate ?? 1);
        fiber.ownRate = rate;
        this.setRateForSingleFiber(fiber, effectiveRate);
        if (fiber.children) {
            // Set the rate of all descendants in depth-first order. We then set
            // the descendants rate, and later unend them (in reverse order) if
            // reversing.
            const queue = fiber.children.slice();
            const fibers = [];
            while (queue.length > 0) {
                const fiber = queue.shift();
                this.setRateForSingleFiber(fiber, fiber.parent.rate * fiber.ownRate);
                if (fiber.observedEnd >= 0) {
                    fibers.unshift(fiber);
                }
                if (fiber.children) {
                    for (let i = fiber.children.length - 1; i >= 0; --i) {
                        queue.unshift(fiber.children[i]);
                    }
                }
            }
            if (effectiveRate < 0) {
                for (const fiber of fibers) {
                    // The unend time is the elapsed time between the observed
                    // end and the current scheduler time, but should be
                    // adjusted by rate.
                    const unend = this.now - fiber.observedEnd;
                    this.scheduleFiber(fiber, this.now - unend / rate);
                }
            }
        }
    }

    // Only set the rate for the fiber, updating ramp and async timing as
    // necessary. This is called by setFiberRate for itself and its descendants.
    setRateForSingleFiber(fiber, rate) {
        if (rate === fiber.rate) {
            return;
        }
        if (this.ramps.has(fiber)) {
            // Update the observed times of the current ramp with the new rate.
            const ramp = this.ramps.get(fiber);
            const elapsed = ramp.elapsed ?? (this.now - ramp.observedBegin) * fiber.rate;
            delete ramp.elapsed;
            if (rate === 0) {
                // Pause the ramp, recording the elapsed time for resuming
                // later.
                ramp.elapsed = elapsed;
                this.rescheduleFiber(fiber, Infinity);
            } else if (isFinite(ramp.observedDur)) {
                ramp.observedBegin = this.now - elapsed / rate;
                ramp.observedDur = ramp.dur / rate;
                ramp.observedEnd = ramp.observedBegin + ramp.observedDur;
                const end = rate > 0 ? ramp.observedEnd : ramp.observedBegin;
                this.rescheduleFiber(fiber, end);
            } else if (rate < 0) {
                // Infinite ramp now has a finite observed duration based on the elapsed time.
                ramp.observedBegin = this.now - elapsed / rate;
                this.rescheduleFiber(fiber, ramp.observedBegin);
            } else {
                ramp.observedBegin = this.now - elapsed / rate;
                this.rescheduleFiber(fiber, Infinity);
            }
        } else if (fiber.asyncDelegate && fiber.rate >= 0 && rate < 0) {
            // Reversing an async call.
            const now = this.clock.now;
            fiber.now += (now - fiber.asyncDelegate.observedBegin) * fiber.rate;
            fiber.trace.push([fiber.trace.at(-1)[0] + 1, fiber.now]);
            this.scheduleFiber(fiber);
        } else if (fiber.rate === 0) {
            // Resume the fiber, for which time has not passed.
            this.scheduleFiber(fiber);
        }
        fiber.rate = rate;
    }

    // Add a ramp object for this fiber and call its update function with a
    // starting progress value p (0 when going forward, 1 when the fiber rate
    // is negative). Return true if the fiber needs to yield. A ramp stores its
    // local begin time and duration; also its observed begin time, end time
    // and duration, and the progress callback f. When the ramp is paused
    // (because the fiber rate is zero), then keep track of the remaining time
    // for resuming.
    beginRampForFiber(fiber, dur, f, p) {
        console.assert(!this.ramps.has(fiber));
        console.assert(isFinite(dur) || p === 0);
        f(p, fiber, this);
        const begin = fiber.now + (isFinite(dur) ? p * dur : 0);
        const observedDur = dur / fiber.rate;
        console.assert(observedDur >= 0);
        const observedBegin = this.now;
        const observedEnd = this.now + observedDur;
        this.ramps.set(fiber, { begin, dur, observedBegin, observedDur, observedEnd, f });
        if (observedDur > 0) {
            this.scheduleFiber(fiber, observedEnd);
            return true;
        }
    }

    // Remove the ramp object for the fiber and call its update function with
    // the given p value (1 when going forward, 0 when backward).
    endRampForFiber(fiber, p) {
        const { f, begin, dur } = this.ramps.get(fiber);
        console.assert(isFinite(dur) || p === 0);
        fiber.now = begin + (isFinite(dur) ? p * dur : 0);
        f(p, fiber, this);
        this.ramps.delete(fiber);
    }

    // Run all fibers in the [begin, end[ time range.
    update(begin, end) {
        console.assert(this.instants.length === 0 || this.instants[0] >= begin);
        while (this.instants.length > 0 && this.instants[0] >= begin && this.instants[0] < end) {
            this.now = this.instants.remove();
            const queue = this.fibersByInstant.get(this.now);
            this.fibersByInstant.delete(this.now);
            while (queue.length > 0) {
                const fiber = queue.shift();
                this.instantsByFiber.delete(fiber);
                this.spawnQueue = [];
                if (!this.fibers.has(fiber)) {
                    this.fibers.set(fiber, fiber.run(this));
                }
                if (this.fibers.get(fiber).next().done) {
                    this.fiberEnded(fiber);
                }
                Array.prototype.unshift.apply(queue, this.spawnQueue);
            }
        }
        delete this.spawnQueue;
        this.now = end;
        for (const [fiber, ramp] of this.ramps.entries()) {
            if (Object.hasOwn(ramp, "elapsed")) {
                // Skip paused ramps.
                continue;
            }
            if (isFinite(ramp.dur)) {
                const p = (this.now - ramp.observedBegin) / ramp.observedDur;
                console.assert(p >= 0 && p <= 1);
                if (0 < p && p < 1) {
                    // f is called with p=0 when the ramp begins, and p=1 when
                    // the ramp ends. The local time is updated to reflect the
                    // current progress of the ramp.
                    fiber.now = ramp.begin + p * ramp.dur;
                    ramp.f(p, fiber, this);
                }
            } else {
                // Infinite ramps stay at p = 0, even when going backward (in
                // which case it has a finite observed duration). Local time
                // is still updated based on the observed elapsed time.
                fiber.now = (this.now - ramp.observedBegin) * fiber.rate;
                ramp.f(0, fiber, this);
            }
        }
        if (this.instants.length > 0) {
            this.clock.advance();
        }
        message(this, "update", { idle: this.fibers.size === 0 });
    }
}
