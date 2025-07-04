import { message, nop, on, parseOffsetValue, PriorityQueue, remove } from "./util.js";
import Clock from "./clock.js";

const Ops = {
    // Call f and handle its return value or error, then resume the fiber.
    // Yield until the call ends.
    async(scheduler, f, delegate) {
        f(this, scheduler).then(value => {
            delegate.asyncWillEnd?.(value, this, scheduler);
        }).catch(error => {
            this.errorWithMessage(error);
        }).finally(() => {
            if (this.rate !== 0) {
                scheduler.resumeFiber(this, scheduler.clock.now);
            }
        });
        return true;
    },

    // Begin a ramp immediately for a given duration with a callback. Negative
    // or invalid durations are ignored. A zero-duration ramp does begin at 0
    // and immediately ends at 1 with no step in between.
    beginRamp(scheduler, dur, f) {
        const effectiveDuration = this.getEffectiveDuration(dur, scheduler);
        if (effectiveDuration >= 0) {
            return scheduler.beginRampForFiber(this, effectiveDuration, f);
        }
        // Skip the following endRamp op.
        this.ip += 1;
    },

    // End a ramp.
    endRamp(scheduler) {
        scheduler.endRampForFiber(this);
    },

    // Call f synchronously with the fiber and scheduler as arguments.
    sync(scheduler, f) {
        f(this, scheduler);
    }
};

export class Fiber {
    constructor() {
        this.ops = [];
    }

    // Time scale in the ]-∞, +∞[ range.
    rate = 1;

    // Update the local time for the fiber based on the current time, keeping
    // track of the last update time.
    updateLocalTime(now) {
        this.now += isFinite(this.rate) ? (now - this.lastUpdate) * this.rate : 0
        this.lastUpdate = now;
    }

    // Add an async op to the fiber and return it. A delegate can handle
    // the result of the call with its `asyncWillEnd` method.
    async(f, delegate = {}) {
        this.ops.push(["async", f, delegate]);
        return this;
    }

    // Add a ramp to the fiber with the given duration and callback. Return
    // the fiber.
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

    // Run all ops. An op returns true when it needs to yield. The generator
    // returns when reaching the end of the sequence, or when an error occurs.
    // FIXME 4M02 Core: either
    *run(scheduler) {
        this.lastUpdate = scheduler.now;
        this.now = 0;
        this.ip = 0;
        while (!this.error && this.ip < this.ops.length) {
            const [op, ...args] = this.ops[this.ip++];
            try {
                if (Ops[op].call(this, scheduler, ...args) || this.rate === 0) {
                    yield;
                }
            } catch (error) {
                this.errorWithMessage(error);
            }
        }
        delete this.ip;
        delete this.now;
        delete this.lastUpdate;
    }

    // Set the error field of the result and report it to the console.
    errorWithMessage(error) {
        this.error = error;
        console.error(error.message ?? error);
    }

    // Get the effective duration of a ramp, which could be a number, a string,
    // or a function returning a number or a string. Throws in case of error.
    getEffectiveDuration(dur, scheduler) {
        if (typeof dur === "function") {
            dur = dur(this, scheduler);
        }
        return typeof dur === "string" ? parseOffsetValue(dur) : dur;
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

        // Scheduler local time.
        this.now = 0;
    }

    // Schedule a fiber to resume execution at time t (now by default). If the
    // deferred flag is set, resume at the end of the instant (this is used for
    // joining).
    resumeFiber(fiber, t, deferred = false) {
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
        this.clock.advance();
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
        this.resumeFiber(fiber, t);
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
                // Pause the ramp, recording the reaming time for resuming
                // later.
                ramp.remaining = remaining;
                this.rescheduleFiber(fiber, Infinity);
            } else {
                ramp.observedEnd = this.now + remaining / rate;
                ramp.observedDur = ramp.dur / rate;
                ramp.observedBegin = ramp.observedEnd - ramp.observedDur;
                if (fiber.rate === 0) {
                    delete ramp.remaining;
                    fiber.lastUpdate = this.now;
                    this.resumeFiber(fiber, ramp.observedEnd);
                } else {
                    this.rescheduleFiber(fiber, ramp.observedEnd);
                }
            }
        } else if (fiber.rate === 0) {
            // Resume the fiber, for which time has not passed.
            fiber.lastUpdate = this.now;
            this.resumeFiber(fiber);
        }
        fiber.rate = rate;
    }

    // Add a ramp object for this fiber and call its update function with p=0.
    // Return true if the fiber needs to yield. A ramp stores its observed
    // begin time, end time and duration, its actual duration and local end
    // time, and the progress callback f. When the ramp is paused (because the
    // fiber rate is zero), then keep track of the remaining time for resuming.
    beginRampForFiber(fiber, dur, f) {
        console.assert(!this.ramps.has(fiber));
        f(0, fiber, this);
        const observedDur = dur / fiber.rate;
        const observedBegin = this.now;
        const observedEnd = this.now + observedDur;
        this.ramps.set(fiber, { observedBegin, observedDur, observedEnd, dur, end: fiber.now + dur, f });
        if (observedDur > 0) {
            this.resumeFiber(fiber, observedEnd);
            return true;
        }
    }

    // Remove the ramp object for the fiber and call its update function with
    // p=1.
    endRampForFiber(fiber) {
        const { f, end } = this.ramps.get(fiber);
        if (!isFinite(fiber.rate)) {
            fiber.now = end;
        }
        f(1, fiber, this);
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
                fiber.updateLocalTime(this.now);
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
                fiber.updateLocalTime(this.now);
                ramp.f(p, fiber, this);
            }
        }
        if (this.instants.length > 0) {
            this.clock.advance();
        }
        message(this, "update", { idle: this.fibers.size === 0 });
    }
}
