import { extend, K, message, nop, on, parseOffsetValue, PriorityQueue, remove } from "./util.js";
import Clock from "./clock.js";

const Ops = {

    // Call f and handle its return value or error, then resume the fiber.
    // Yield until the call ends.
    async(scheduler, f, delegate) {
        const instance = this.asyncDelegate = extend(delegate, { observedBegin: scheduler.now });
        f(this, scheduler).then(value => {
            if (this.asyncDelegate === instance) {
                delegate.asyncWillEndWithValue?.call(delegate, value, this, scheduler);
                this.asyncDidEnd(scheduler);
            }
        }).catch(error => {
            if (this.asyncDelegate === instance) {
                delegate.asyncWillEndWithError?.call(delegate, value, this, scheduler);
                this.asyncDidEnd(scheduler, error);
            }
        });
        // The first sync unop will be removed or replaced when the call ends,
        // and the ramp duration will be set based on the amount of time that
        // it took for the call to complete.
        this.unops.unshift(["sync", unasync], ["beginRamp", 0, nop], ["endRamp"]);
        this.asyncDelegate = instance;
        return true;
    },

    // Begin a ramp immediately for a given duration with a callback. Negative
    // or invalid durations are ignored. A zero-duration ramp does begin at 0
    // and immediately ends at 1 with no step in between.
    beginRamp(scheduler, dur, f) {
        if (this.rate >= 0) {
            const effectiveDuration = this.getEffectiveDuration(dur, scheduler);
            if (effectiveDuration >= 0) {
                this.unops.unshift(["beginRamp", -effectiveDuration, f], ["endRamp"]);
                return scheduler.beginRampForFiber(this, effectiveDuration, f);
            } else {
                // Skip the following endRamp op.
                this.ip += 1;
                return;
            }
        } else {
            console.assert(dur <= 0);
            return scheduler.beginRampForFiber(this, dur, f);
        }
    },

    // End a ramp.
    endRamp(scheduler) {
        scheduler.endRampForFiber(this);
    },

    // Call f synchronously with the fiber and scheduler as arguments.
    sync(scheduler, f, undo) {
        if (undo) {
            this.unops.push(["sync", undo]);
        }
        f(this, scheduler);
    },

    // Clear the error.
    // FIXME 4M02 Core: either
    unerr() {
        console.assert(!!this.error);
        delete this.error;
    },
};

// Decide whether an op can be executed based on the fiber state.

const ifNoError = fiber => !fiber.error;
const always = K(true);

const CanRun = {
    async: ifNoError,
    beginRamp: ifNoError,
    endRamp: ifNoError,
    sync: ifNoError,
    unerr: always,
};

// Ops that accept a custom undo based on the current arity (i.e., if a custom
// undo was not already added).

const UndoArity = {
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

    // Resume after an async call ended, updating the undo stack and the fiber
    // local time accordingly.
    asyncDidEnd(scheduler, error) {
        console.assert(this.rate >= 0);
        const now = scheduler.clock.now;
        const dur = (now - this.asyncDelegate.observedBegin) * this.rate;
        delete this.asyncDelegate;
        // Update the unops: pop the unasync (since the call ended) and set
        // the time of the reverse ramp. In case of error, an unerr will be
        // added.
        console.assert(this.unops[0][0] === "sync" && this.unops[0][1] === unasync);
        this.unops.shift();
        console.assert(this.unops[0][0] === "beginRamp");
        this.unops[0][1] = -dur;
        this.now += dur;
        if (this.rate > 0 && isFinite(this.rate)) {
            scheduler.scheduleFiber(this, now);
        }
        if (error) {
            this.errorWithMessage(error);
        }
    }

    // Add begin/end ramp ops to the fiber with the given duration and callback.
    // Dur may a string to be parsed as a duration, or a number of millisecond,
    // or a function that returns a string or a number. Return the fiber.
    ramp(dur, f = nop) {
        this.ops.push(
            ["beginRamp", dur, f],
            ["endRamp", f]
        );
        return this;
    }

    // Add a sync op to the fiber and return it.
    sync(f) {
        this.ops.push(["sync", f]);
        return this;
    }

    // Add custom undo to the last op.
    undo(f) {
        if (this.ops.length === 0) {
            throw Error("Nothing to undo");
        }
        const op = this.ops.at(-1);
        const arity = UndoArity[op[0]];
        if (isNaN(arity)) {
            throw Error(`Cannot customize undo for ${op[0]}`);
        }
        if (op.length > arity) {
            throw Error(`Cannot customize undo further for ${op[0]}`);
        }
        op.push(f);
        return this;
    }

    // Run all ops. An op returns true when it needs to yield. The generator
    // returns when reaching the end of the sequence, or when an error occurs.
    // FIXME 4M02 Core: either
    *run(scheduler) {
        this.lastUpdate = scheduler.now;
        this.now = 0;
        this.ip = 0;
        if (this.rate >= 0) {
            this.unops = [];
        }
        while (true) {
            const ops = this.rate < 0 ? this.unops : this.ops;
            if (this.ip >= ops.length) {
                break;
            }
            const [op, ...args] = ops[this.ip++];
            if (CanRun[op](this)) {
                try {
                    if (Ops[op].call(this, scheduler, ...args) || this.rate === 0) {
                        yield;
                    }
                } catch (error) {
                    this.errorWithMessage(error);
                }
            }
        }
        // Do not clear unops!
        delete this.ip;
        delete this.now;
        delete this.lastUpdate;
    }

    // Set the error field of the result and report it to the console.
    errorWithMessage(error) {
        this.error = error;
        if (this.rate > 0) {
            this.unops.push(["unerr"]);
        }
        console.error(error.message ?? error);
    }

    // Get the effective duration of a ramp, which could be a number, a string,
    // or a function returning a number or a string. Throws in case of error.
    // FIXME 4M0F Core: numeric durations only
    getEffectiveDuration(dur, scheduler) {
        if (typeof dur === "function") {
            dur = dur(this, scheduler);
        }
        return typeof dur === "string" ? parseOffsetValue(dur) : dur;
    }
}

// Cancel an ongoing async call.
function unasync(fiber, scheduler) {
    fiber.asyncDelegate.asyncWasCancelled?.call(fiber.asyncDelegate, fiber, scheduler);
    delete fiber.asyncDelegate;
}

export class Scheduler {

    constructor() {
        // Create a default clock to drive the updates.
        this.clock = new Clock();
        on(this.clock, "tick", ({ begin, end }) => { this.update(begin, end); });

        // All instants (times) at which fibers are scheduled.
        this.instants = new PriorityQueue();

        // Lists of fibers scheduled at a given instant. On update the fibers
        // are accessed by instant (fibersByInstant: instant => [fibers]); on
        // reschedule, we want to quickly get the instant at which a fiber is
        // scheduled (instantsByFiber: fiber => instant).
        this.fibersByInstant = new Map();
        this.instantsByFiber = new Map();

        // Keep track of active fibers, mapping the run generator to the fiber.
        this.fibers = new Map();

        // List of active ramp objects by fiber.
        this.ramps = new Map();

        // Scheduler (global) time.
        this.now = 0;
    }

    // Schedule a fiber to begin or resume execution at time t (or `now` by
    // default).
    scheduleFiber(fiber, t) {
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
            // The clock is paused when no fibers are scheduled, so ensure that
            // we get a tick now that a fiber is scheduled at a definite time.
            this.clock.advance();
        }
    }

    // Reschedule a fiber that is already scheduled by removing it from the
    // schedule and scheduling it again.
    rescheduleFiber(fiber, t) {
        const instant = this.instantsByFiber.get(fiber);
        if (instant === t) {
            return;
        }
        remove(this.fibersByInstant.get(instant), fiber);
        this.instantsByFiber.delete(fiber);
        this.scheduleFiber(fiber, t);
    }

    // The fiber is not active anymore and can be removed from the list of
    // active fibers.
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
        // FIXME 4M08 Core: redo
        const reverse = fiber.rate >= 0 && rate < 0;
        if (this.ramps.has(fiber)) {
            // Update the observed times of the current ramp with the new rate.
            const ramp = this.ramps.get(fiber);
            let remaining = ramp.remaining ?? ramp.observedEnd - this.now;
            if (rate === 0) {
                // Pause the ramp, recording the remaining time for resuming
                // later.
                ramp.remaining = remaining;
                this.rescheduleFiber(fiber, Infinity);
            } else {
                ramp.observedEnd = this.now + remaining / rate;
                ramp.observedDur = ramp.dur / rate;
                ramp.observedBegin = ramp.observedEnd - ramp.observedDur;
                if (fiber.rate === 0) {
                    delete ramp.remaining;
                    this.scheduleFiber(fiber, ramp.observedEnd);
                } else if (reverse) {
                    // Remove the `beginRamp` unop since the ramp is already
                    // in progress; start from the following `endRamp`.
                    console.assert(fiber.unops.shift()[0] === "beginRamp");
                    this.rescheduleFiber(fiber, ramp.observedBegin);
                } else {
                    this.rescheduleFiber(fiber, ramp.observedEnd);
                }
            }
        } else if (fiber.rate === 0) {
            // Resume the fiber since it was paused.
            this.scheduleFiber(fiber);
        } else if (fiber.asyncDelegate && reverse) {
            // Resume the fiber to cancel the async call after updating the
            // local time and the reverse ramp duration.
            const now = this.clock.now;
            const dur = (now - fiber.asyncDelegate.observedBegin) * fiber.rate;
            fiber.now += dur;
            fiber.unops[1][1] = -dur;
            this.scheduleFiber(fiber, now);
        }
        fiber.rate = rate;
        if (reverse) {
            fiber.ip = 0;
        }
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
        // When rate is negative, the ramp ends back at the beginning.
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
