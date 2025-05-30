import { remove, PriorityQueue, on } from "./util.js";

import Clock from "./clock.js";
import Fiber from "./fiber.js";

export default class Scheduler {
    constructor() {
        this.clock = new Clock();
        on(this.clock, "tick", ({ begin, end }) => { this.update(begin, end); });
        this.instants = new PriorityQueue();
        this.fibersByInstant = new Map();
        this.schedule = new Map();
        this.delays = new Map();
        this.ramps = new Map();
    }

    static run() {
        const scheduler = new Scheduler();
        const fiber = new Fiber();
        scheduler.clock.start();
        scheduler.resume(fiber);
        return fiber;
    }

    get now() {
        return this.currentTime ?? this.clock.now;
    }

    resumeDeferred(fiber) {
        console.assert(!this.schedule.has(fiber));
        this.schedule.set(fiber, this.now);
        this.resumeQueues[1].push(fiber);
    }

    resume(fiber, t) {
        const now = this.now;
        t = t ?? now;
        console.assert(t >= now);
        console.assert(!this.schedule.has(fiber));
        this.schedule.set(fiber, t);
        if (!(fiber.ip >= 0)) {
            fiber.reset(t);
        }
        if (t === now && this.resumeQueues) {
            this.resumeQueues[0].push(fiber);
            return;
        }
        if (!this.fibersByInstant.has(t)) {
            this.instants.insert(t);
            this.fibersByInstant.set(t, []);
        }
        this.fibersByInstant.get(t).push(fiber);
        this.clock.advance();
    }

    reschedule(fiber, t) {
        if (this.schedule.has(fiber)) {
            t = t ?? this.now;
            if (t === this.schedule.get(fiber)) {
                return;
            }
            remove(this.fibersByInstant.get(this.schedule.get(fiber)), fiber);
            this.schedule.delete(fiber);
        }
        this.resume(fiber, t);
    }

    delay(fiber, dur) {
        console.assert(!this.delays.has(fiber) && !this.ramps.has(fiber));
        const begin = this.now;
        const end = begin + dur;
        this.delays.set(fiber, { begin, dur });
        fiber.yielded = true;
        this.resume(fiber, end);
    }

    beginRamp(fiber, dur, delegate) {
        console.assert(!this.delays.has(fiber) && !this.ramps.has(fiber));
        const begin = this.now;
        delegate = Object.create(delegate ?? {});
        delegate.rampDidProgress?.call(delegate, 0, fiber, this);
        const rate = fiber.rate;
        this.ramps.set(fiber, { delegate, begin, dur, rate });
        fiber.yielded = true;
        this.resume(fiber, begin + dur / rate);
    }

    endRamp(fiber) {
        const { delegate } = this.ramps.get(fiber);
        this.ramps.delete(fiber);
        delegate.rampDidProgress?.call(delegate, 1, fiber, this);
    }

    // Update the current delay or ramp duration for the fiber, if any.
    updateDelayForFiber(fiber, dur) {
        if (this.delays.has(fiber)) {
            const { begin } = this.delays.get(fiber);
            this.reschedule(fiber, Math.max(begin + dur, this.now));
        } else if (this.ramps.has(fiber)) {
            const ramp = this.ramps.get(fiber);
            ramp.dur = dur;
            this.reschedule(fiber, Math.max(ramp.begin + dur, this.now));
        }
    }

    // Set a new rate for the fiber. If it has a current delay or ramp, update
    // its duration as well to reflect the change. Also adjust the begin time
    // of the ramp to reflect the change of rate from this point on.
    // FIXME 4H02 Fiber rate = 0
    // FIXME 4H03 Fiber rate < 0
    // FIXME 4H04 Fiber rate = ∞
    setRateForFiber(fiber, rate) {
        console.assert(rate > 0);
        if (rate === fiber.rate) {
            return;
        }
        if (this.delays.has(fiber)) {
            const { begin, dur } = this.delays.get(fiber);
            this.reschedule(fiber, (dur - this.now + begin) / rate);
        } else if (this.ramps.has(fiber)) {
            const ramp = this.ramps.get(fiber);
            const now = this.now;
            const p = (now - ramp.begin) / (ramp.dur / ramp.rate);
            const dur = ramp.dur / rate;
            ramp.rate = rate;
            ramp.begin = now - p * dur;
            this.reschedule(fiber, now + (1 - p) * dur);
        }
        fiber.rate = rate;
    }

    update(begin, end) {
        console.assert(this.instants.length === 0 || this.instants[0] >= begin);
        while (this.instants.length > 0 && this.instants[0] >= begin && this.instants[0] < end) {
            this.currentTime = this.instants.remove();
            const queue = this.fibersByInstant.get(this.currentTime);
            this.fibersByInstant.delete(this.currentTime);
            while (queue.length > 0) {
                const fiber = queue.shift();
                console.assert(this.schedule.get(fiber) === this.currentTime);
                this.schedule.delete(fiber);
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
            delete this.currentTime;
            delete this.resumeQueues;
        }
        for (const [fiber, { delegate, begin, dur, rate }] of this.ramps.entries()) {
            const p = (end - begin) / (dur / rate);
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
