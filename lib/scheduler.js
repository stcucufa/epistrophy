import { remove, PriorityQueue, on } from "./util.js";

import Clock from "./clock.js";
import Fiber from "./fiber.js";

export default class Scheduler {

    // Create a new scheduler with a default clock. It is generally more
    // convenient to use init() or run() rather than creating a scheduler on
    // its own.
    // FIXME 4H0B Scheduler.init() and Scheduler.run()
    constructor() {
        this.clock = new Clock();
        on(this.clock, "tick", ({ begin, end }) => { this.update(begin, end); });
        this.instants = new PriorityQueue();
        this.fibersByInstant = new Map();
        this.instantsByFiber = new Map();
        this.delays = new Map();
        this.ramps = new Map();
        this.now = 0;
    }

    // Create a new scheduler and a main fiber, then start the clock. The fiber
    // is returned so that new instructions can be added immediately.
    static run() {
        const scheduler = new Scheduler();
        const fiber = new Fiber();
        scheduler.clock.start();
        scheduler.resume(fiber);
        return fiber;
    }

    // Resume a fiber, as soon as possible, or at time t in the future. When
    // resuming now, add to the resume queue of the current update loop; add
    // at the end when the deferred flag is set (used for joining).
    resume(fiber, t, deferred = false) {
        if (fiber.rate === 0) {
            console.info("Do not resume paused fiber", fiber);
            return;
        }
        t = t ?? this.now;
        console.assert(t >= this.now);
        console.assert(!this.instantsByFiber.has(fiber));
        this.instantsByFiber.set(fiber, t);
        // FIXME 4H0A Reset fiber when spawned
        if (!(fiber.ip >= 0)) {
            fiber.reset(t);
        }
        if (t === this.now && this.resumeQueues) {
            this.resumeQueues[deferred ? 1 : 0].push(fiber);
            return;
        }
        if (!this.fibersByInstant.has(t)) {
            this.instants.insert(t);
            this.fibersByInstant.set(t, []);
        }
        this.fibersByInstant.get(t).push(fiber);
        this.clock.advance();
    }

    // Reschedule a fiber that is currently yielding to a new time t.
    reschedule(fiber, t) {
        if (this.instantsByFiber.has(fiber)) {
            t = t ?? this.now;
            if (t === this.instantsByFiber.get(fiber)) {
                return;
            }
            remove(this.fibersByInstant.get(this.instantsByFiber.get(fiber)), fiber);
            this.instantsByFiber.delete(fiber);
        }
        this.resume(fiber, t);
    }

    // Delay a fiber by `dur` which is expected to be greater than zero. The
    // fiber yields and is scheduled to resume after taking into account the
    // duration of the delay and the rate of the fiber.
    delay(fiber, dur) {
        console.assert(!this.delays.has(fiber) && !this.ramps.has(fiber));
        const begin = this.now;
        const rate = fiber.rate;
        this.delays.set(fiber, { begin, dur, rate });
        fiber.yielded = true;
        this.resume(fiber, begin + dur / rate);
    }

    // Begin a ramp for `dur` and call the `rampDidProgress` delegate with
    // p = 0. The fiber yields and is scheduled to resume after the duration
    // of the ramp.
    // FIXME 4H04 Fiber rate = ∞
    beginRamp(fiber, dur, delegate) {
        if (!fiber.handleResult) {
            return;
        }
        console.assert(!this.delays.has(fiber) && !this.ramps.has(fiber));
        const begin = this.now;
        delegate = Object.create(delegate ?? {});
        delegate.rampDidProgress?.call(delegate, 0, fiber, this);
        const rate = fiber.rate;
        this.ramps.set(fiber, { delegate, begin, dur, rate });
        fiber.yielded = true;
        this.resume(fiber, begin + dur / rate);
    }

    // End the ramp when the fiber resumes and call the `rampDidProgress`
    // delegate with p = 1.
    endRamp(fiber) {
        if (!fiber.handleResult) {
            return;
        }
        const { delegate } = this.ramps.get(fiber);
        this.ramps.delete(fiber);
        delegate.rampDidProgress?.call(delegate, 1, fiber, this);
    }

    // Update the current delay or ramp duration for the fiber, if any. If the
    // new end time of the delay or ramp is before the current time, reschedule
    // the fiber now.
    updateDelayForFiber(fiber, dur) {
        const update = delay => {
            delay.dur = dur;
            console.assert(fiber.rate === delay.rate);
            this.reschedule(fiber, Math.max(delay.begin + dur / fiber.rate, this.now));
        };
        if (this.delays.has(fiber)) {
            update(this.delays.get(fiber));
        } else if (this.ramps.has(fiber)) {
            update(this.ramps.get(fiber));
        }
    }

    // Set a new rate for the fiber. If it has a current delay or ramp, update
    // its duration as well to reflect the change. Also adjust the begin time
    // of the ramp to reflect the change of rate from this point on.
    // FIXME 4H03 Fiber rate < 0
    // FIXME 4H04 Fiber rate = ∞
    setRateForFiber(fiber, rate) {
        console.assert(rate >= 0);
        if (rate === fiber.rate) {
            return;
        }
        const update = delay => {
            const p = (this.now - delay.begin) / (delay.dur / delay.rate);
            const dur = delay.dur / rate;
            delay.rate = rate;
            delay.begin = this.now - p * dur;
            this.reschedule(fiber, this.now + (1 - p) * dur);
        };
        if (this.delays.has(fiber)) {
            update(this.delays.get(fiber));
        } else if (this.ramps.has(fiber)) {
            update(this.ramps.get(fiber));
        } else if (rate === 0) {
            if (this.instantsByFiber.has(fiber)) {
                remove(this.fibersByInstant.get(this.instantsByFiber.get(fiber)), fiber);
                this.instantsByFiber.delete(fiber);
            } else {
                fiber.yielded = true;
            }
        } else if (fiber.rate === 0) {
            console.assert(!this.instantsByFiber.has(fiber));
            fiber.rate = rate;
            this.resume(fiber);
            return;
        }
        fiber.rate = rate;
    }

    // Execute all fibers scheduled in the [begin, end[ interval, then update
    // all ramps.
    update(begin, end) {
        console.assert(this.instants.length === 0 || this.instants[0] >= begin);
        while (this.instants.length > 0 && this.instants[0] >= begin && this.instants[0] < end) {
            this.now = this.instants.remove();
            const queue = this.fibersByInstant.get(this.now);
            this.fibersByInstant.delete(this.now);
            while (queue.length > 0) {
                const fiber = queue.shift();
                console.assert(this.instantsByFiber.get(fiber) === this.now);
                this.instantsByFiber.delete(fiber);
                this.delays.delete(fiber);
                delete fiber.yielded;
                this.resumeQueues = [[], []];
                for (const n = fiber.ops.length; !fiber.yielded && fiber.ip < n;) {
                    fiber.ops[fiber.ip++](this);
                }
                if (!fiber.yielded) {
                    fiber.ended(this);
                }
                Array.prototype.unshift.apply(queue, this.resumeQueues[1]);
                Array.prototype.unshift.apply(queue, this.resumeQueues[0]);
            }
        }
        delete this.resumeQueues;
        this.now = end;
        for (const [fiber, { delegate, begin, dur, rate }] of this.ramps.entries()) {
            if (!fiber.handleResult) {
                continue;
            }
            const p = (this.now - begin) / (dur / rate);
            console.assert(p >= 0 && p <= 1);
            if (p < 1) {
                // The delegate is called with p = 1 when the ramp ends.
                delegate.rampDidProgress?.call(delegate, p, fiber, this);
            }
        }
        if (this.instants.length > 0) {
            this.clock.advance();
        }
    }
}
