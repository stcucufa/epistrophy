import { message, nop, on, PriorityQueue, parseOffsetValue } from "./util.js";
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
            scheduler.resumeFiber(this, scheduler.clock.now);
        });
        return true;
    },

    // Begin a ramp immediately for a given duration with a callback.
    beginRamp(scheduler, dur, f) {
        const effectiveDuration = this.getEffectiveDuration(dur, scheduler);
        if (effectiveDuration > 0) {
            scheduler.beginRampForFiber(this, effectiveDuration, f);
            return true;
        }
        if (!this.error) {
            // Skip the endRamp instruction that follows.
            this.ip += 1;
        }
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

    // Add an async op to the fiber and return it. A delegate can handle
    // the result of the call.
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
        this.beginTime = scheduler.now;
        this.now = 0;
        this.ip = 0;
        while (!this.error && this.ip < this.ops.length) {
            const [op, ...args] = this.ops[this.ip++];
            try {
                if (Ops[op].call(this, scheduler, ...args)) {
                    yield;
                }
            } catch (error) {
                this.errorWithMessage(error);
            }
        }
    }

    // Set the error field of the result and report it to the console.
    errorWithMessage(error) {
        this.error = error;
        console.error(error.message ?? error);
    }

    // Get the effective duration of a ramp, which could be a number, a string,
    // or a function returning a number or a string. Return nothing in case of
    // error.
    getEffectiveDuration(dur, scheduler) {
        if (typeof dur === "function") {
            try {
                dur = dur(this, scheduler);
            } catch (error) {
                this.errorWithMessage(error);
                return;
            }
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
        if (fiber.rate === 0) {
            return;
        }
        t = t ?? this.now;
        // Don’t resume in the past or an already scheduled fiber.
        console.assert(t >= this.now);
        if (t === this.now && this.resumeQueues) {
            (deferred ? this.deferredQueue : this.resumeQueues).push(fiber);
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

    // The fiber is not active anymore.
    fiberEnded(fiber) {
        this.fibers.delete(fiber);
        delete fiber.beginTime;
        delete fiber.ip;
        delete fiber.now;
    }

    // Get the local time for the fiber given a global time (the scheduler
    // global time by default).
    setFiberLocalTime(fiber) {
        fiber.now = this.now - fiber.beginTime;
    }

    // Add a ramp object for this fiber and call its update function with p=0.
    beginRampForFiber(fiber, dur, f) {
        console.assert(!this.ramps.has(fiber));
        const begin = this.now;
        const end = this.now + dur;
        f(0, fiber, this);
        this.ramps.set(fiber, { begin, dur, end, f });
        this.resumeFiber(fiber, end);
    }

    // Remove the ramp object for the fiber and call its update function with
    // p=1.
    endRampForFiber(fiber) {
        const ramp = this.ramps.get(fiber);
        this.ramps.delete(fiber);
        ramp.f(1, fiber, this);
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
                this.resumeQueue = [];
                this.deferredQueue = [];
                if (!this.fibers.has(fiber)) {
                    this.fibers.set(fiber, fiber.run(this));
                }
                this.setFiberLocalTime(fiber);
                if (this.fibers.get(fiber).next().done) {
                    this.fiberEnded(fiber);
                }
                Array.prototype.unshift.apply(queue, this.deferredQueue);
                Array.prototype.unshift.apply(queue, this.resumeQueue);
            }
        }
        delete this.resumeQueue;
        delete this.deferredQueue;
        this.now = end;
        for (const [fiber, ramp] of this.ramps.entries()) {
            this.setFiberLocalTime(fiber);
            const p = (this.now - ramp.begin) / ramp.dur;
            console.assert(p >= 0 && p <= 1);
            if (p < 1) {
                // f is called with p = 1 when the ramp ends.
                ramp.f(p, fiber, this);
            }
        }
        if (this.instants.length > 0) {
            this.clock.advance();
        }
        message(this, "update", { idle: this.fibers.size === 0 });
    }
}
