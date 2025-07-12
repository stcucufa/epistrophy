import { extend, message, nop, on, parseOffsetValue, PriorityQueue, remove } from "./util.js";
import Clock from "./clock.js";

const Ops = {
    // Call f and handle its return value or error, then resume the fiber.
    // Yield until the call ends.
    async(scheduler, f, delegate) {
        const instance = this.asyncDelegate = extend(delegate, { observedBegin: scheduler.clock.now });
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
    },

    // Begin or end a ramp, based on the fiber rate. Ramp instructions are in
    // pair, the first one to be executed yields until the ramp ends, at which
    // point the matching ramp (with an opposite begin flag) notifies the
    // scheduler.
    ramp(scheduler, dur, f, begin) {
        const direction = this.rate > 0 ? 1 : -1;
        if ((begin && this.rate > 0) || (!begin && this.rate < 0)) {
            const effectiveDuration = this.getEffectiveParameter(dur, scheduler);
            if (effectiveDuration >= 0) {
                return scheduler.beginRampForFiber(this, effectiveDuration * direction, f);
            }
            // Invalid duration: skip the next ramp op.
            this.ip += direction;
        } else {
            scheduler.endRampForFiber(this);
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
    async: 3,
    sync: 2
};

export class Fiber {
    constructor() {
        this.ops = [];
    }

    // Default time scale for the fiber. Use Scheduler.setFiberRate to update.
    rate = 1;

    // Add an async op to the fiber and return the fiber. A delegate can handle
    // the result of the call with its optional `asyncWillEndWithValue` and
    // `asyncWillEndWithError` methods that get called when the async call
    // finishes and before moving to the next op.
    async(f, delegate = {}) {
        this.ops.push(["async", f, delegate]);
        return this;
    }

    // Add begin/end ramp ops to the fiber with the given duration and callback.
    // Return the fiber.
    ramp(dur, f = nop) {
        this.ops.push(
            ["ramp", dur, f, true],
            ["ramp", dur, f, false]
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

    // Run all ops. An op returns true when it needs to yield. The generator
    // returns when reaching the end of the sequence, or when an error occurs.
    // FIXME 4M02 Core: either
    *run(scheduler) {
        this.now = 0;
        this.ip = 0;
        if (this.rate === 0) {
            yield;
        }
        while (!this.error && (this.rate < 0 ? 1 : 0) <= this.ip && this.ip < this.ops.length) {
            if (this.rate < 0) {
                this.ip -= 1;
            }
            const [op, ...args] = this.ops[this.ip];
            if (this.rate > 0) {
                this.ip += 1;
            }
            try {
                if (Ops[op].call(this, scheduler, ...args) || this.rate === 0) {
                    yield;
                }
            } catch (error) {
                this.errorWithMessage(error);
            }
        }
    }

    // Resume after an async call ended, updating the fiber local time.
    asyncEnded(scheduler, error) {
        console.assert(this.rate >= 0);
        const now = scheduler.clock.now;
        const dur = (now - this.asyncDelegate.observedBegin) * this.rate;
        delete this.asyncDelegate;
        if (this.rate > 0) {
            scheduler.scheduleFiber(this, now);
        }
        if (error) {
            this.errorWithMessage(error);
        }
    }

    // Set the error field of the result and report it to the console.
    errorWithMessage(error) {
        this.error = error;
        console.error(error.message ?? error);
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

    // Schedule a fiber to resume execution at time t (now by default). If the
    // deferred flag is set, resume at the end of the instant (this is used for
    // joining).
    scheduleFiber(fiber, t, deferred = false) {
        t = t ?? this.now;
        console.assert(t >= this.now);
        console.assert(!this.instantsByFiber.has(fiber));
        if (!isFinite(t)) {
            return;
        }
        this.instantsByFiber.set(fiber, t);
        if (!this.fibersByInstant.has(t)) {
            this.instants.insert(t);
            this.fibersByInstant.set(t, [fiber]);
        } else {
            this.fibersByInstant.get(t).push(fiber);
        }
        if (isFinite(t)) {
            this.clock.advance();
        }
    }

    // Reschedule a fiber by removing it from the schedule and resuming it
    // again.
    rescheduleFiber(fiber, t) {
        const instant = this.instantsByFiber.get(fiber);
        if (instant === t) {
            return;
        }
        remove(this.fibersByInstant.get(instant), fiber);
        this.instantsByFiber.delete(fiber);
        this.scheduleFiber(fiber, t);
    }

    // The fiber is not active anymore.
    fiberEnded(fiber) {
        this.fibers.delete(fiber);
    }

    // Set the rate of the fiber. If a ramp is ongoing, update its observed
    // begin and duration to reflect the new rate and reschedule to fiber with
    // the new observed end.
    setFiberRate(fiber, rate) {
        if (rate === fiber.rate) {
            return;
        }
        if (this.ramps.has(fiber)) {
            // Update the observed times of the current ramp with the new rate.
            const ramp = this.ramps.get(fiber);
            const remaining = ramp.remaining ?? ramp.observedEnd - this.now;
            if (rate === 0) {
                // Pause the ramp, recording the remaining time for resuming
                // later.
                ramp.remaining = remaining;
                this.rescheduleFiber(fiber, Infinity);
            } else {
                ramp.observedEnd = this.now + remaining / rate;
                ramp.observedDur = ramp.dur / rate;
                ramp.observedBegin = ramp.observedEnd - ramp.observedDur;
                const end = rate > 0 ? ramp.observedEnd : ramp.observedBegin;
                if (fiber.rate === 0) {
                    delete ramp.remaining;
                    this.scheduleFiber(fiber, end);
                } else {
                    this.rescheduleFiber(fiber, end);
                }
            }
        } else if (fiber.rate === 0) {
            // Resume the fiber, for which time has not passed.
            this.scheduleFiber(fiber);
        }
        fiber.rate = rate;
    }

    // Add a ramp object for this fiber and call its update function with p=0
    // (or p=1 when the fiber rate is negative). Return true if the fiber needs
    // to yield. A ramp stores its local begin time and duration; also its
    // observed begin time, end time and duration, and the progress callback f.
    // When the ramp is paused (because the fiber rate is zero), then keep
    // track of the remaining time for resuming.
    beginRampForFiber(fiber, dur, f) {
        console.assert(!this.ramps.has(fiber));
        f(fiber.rate < 0 ? 1 : 0, fiber, this);
        const begin = this.now + (fiber.rate < 0 ? dur : 0);
        const observedDur = dur / fiber.rate;
        const observedBegin = this.now;
        const observedEnd = this.now + observedDur;
        this.ramps.set(fiber, { begin, dur, observedBegin, observedDur, observedEnd, f });
        if (observedDur > 0) {
            this.scheduleFiber(fiber, observedEnd);
            return true;
        }
    }

    // Remove the ramp object for the fiber and call its update function with
    // p=1 (or p=0 when the fiber rate is negative).
    endRampForFiber(fiber) {
        const { f, begin, dur } = this.ramps.get(fiber);
        fiber.now = begin + (fiber.rate < 0 ? 0 : dur);
        f(fiber.rate < 0 ? 0 : 1, fiber, this);
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
                if (!this.fibers.has(fiber)) {
                    this.fibers.set(fiber, fiber.run(this));
                }
                if (this.fibers.get(fiber).next().done) {
                    this.fiberEnded(fiber);
                }
            }
        }
        this.now = end;
        for (const [fiber, ramp] of this.ramps.entries()) {
            if (Object.hasOwn(ramp, "remaining")) {
                // Skip paused ramps.
                continue;
            }
            const p = (this.now - ramp.observedBegin) / ramp.observedDur;
            console.assert(p >= 0 && p <= 1);
            if (0 < p && p < 1) {
                // f is called with p=0 when the ramp begins, and p=1 when
                // the ramp ends.
                fiber.now = ramp.begin + p * ramp.dur;
                ramp.f(p, fiber, this);
            }
        }
        if (this.instants.length > 0) {
            this.clock.advance();
        }
        message(this, "update", { idle: this.fibers.size === 0 });
    }
}
