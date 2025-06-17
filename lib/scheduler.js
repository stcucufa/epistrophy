import { remove, PriorityQueue, on } from "./util.js";

import Clock from "./clock.js";
import Fiber from "./fiber.js";

export default class Scheduler {
    #fibersByName;

    // Create a new scheduler with a default clock. It is generally more
    // convenient to use init() or run() rather than creating a scheduler on
    // its own.
    // FIXME 4H0B Scheduler.init() and Scheduler.run()
    constructor() {
        this.clock = new Clock();
        on(this.clock, "tick", ({ begin, end }) => { this.update(begin, end); });
        this.instants = new PriorityQueue();
        this.#fibersByName = new Map();
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
        scheduler.resetFiber(fiber);
        scheduler.resume(fiber);
        return fiber;
    }

    // ... and unregistering them when they end.
    fiberDidEnd(fiber) {
        if (fiber.name !== undefined) {
            this.#fibersByName.delete(fiber.name);
        }
    }

    // Retrieve a fiber by its name.
    fiberNamed(name) {
        return this.#fibersByName.get(name);
    }

    // Resume a fiber, as soon as possible, or at time t in the future. When
    // resuming now, add to the resume queue of the current update loop; add
    // at the end when the deferred flag is set (used for joining).
    resume(fiber, t, deferred = false) {
        if (fiber.rate === 0) {
            return;
        }
        t = t ?? this.now;
        console.assert(t >= this.now);
        console.assert(!this.instantsByFiber.has(fiber));
        this.instantsByFiber.set(fiber, t);
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
        const effectiveDur = dur / rate;
        if (effectiveDur > 0) {
            this.resume(fiber, begin + effectiveDur);
            this.delays.set(fiber, { begin, dur, rate });
            fiber.yielded = true;
        }
    }

    // Begin a ramp for `dur` and call the `rampDidProgress` delegate with
    // p = 0. The fiber yields and is scheduled to resume after the duration
    // of the ramp.
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

    // Reset the fiber by setting its begin time to the current time of the
    // sechduler, its ip to 0, and initializing various state from the parent
    // fiber.
    resetFiber(fiber) {
        if (fiber.name !== undefined) {
            if (this.#fibersByName.has(fiber.name)) {
                throw Error("A fiber with the same name is already running");
            }
            this.#fibersByName.set(fiber.name, fiber);
        }
        fiber.beginTime = this.now;
        delete fiber.endTime;
        fiber.rate = fiber.parent?.rate ?? 1;
        fiber.ownRate = 1;
        fiber.ip = 0;
        fiber.handleValue = [fiber.parent?.handleValue.at(-1) ?? true];
        fiber.handleError = [fiber.parent?.handleError.at(-1) ?? false];
        fiber.result = fiber.handleError.at(-1) && fiber.parent?.error ?
            { error: fiber.parent.error } :
            { value: fiber.parent?.value };
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
    // of the ramp to reflect the change of rate from this point on. Set the
    // rate for the child fiber as well by multiplying the child’s own rate
    // with the new rate; do not set the own rate of the children though (so
    // that they can resume at the right rate after pausing, for instance).
    // FIXME 4H03 Fiber rate < 0
    // FIXME 4H04 Fiber rate = ∞
    setRateForFiber(fiber, rate, setOwnRate = true) {
        console.assert(rate >= 0);
        if (rate === fiber.rate) {
            return;
        }
        const update = delay => {
            if (rate === 0) {
                delay.p = (this.now - delay.begin) / (delay.dur / delay.rate);
                remove(this.fibersByInstant.get(this.instantsByFiber.get(fiber)), fiber);
                this.instantsByFiber.delete(fiber);
            } else {
                const p = delay.p ?? (this.now - delay.begin) / (delay.dur / delay.rate);
                delete delay.p;
                const dur = delay.dur / rate;
                delay.begin = this.now - p * dur;
                this.reschedule(fiber, this.now + (1 - p) * dur);
            }
            delay.rate = rate;
        };
        if (setOwnRate) {
            fiber.ownRate = rate;
        }
        fiber.rate = rate;
        if (this.delays.has(fiber)) {
            update(this.delays.get(fiber));
        } else if (this.ramps.has(fiber)) {
            update(this.ramps.get(fiber));
        } else if (rate === 0) {
            console.assert(!this.instantsByFiber.has(fiber));
            if (this.currentFiber === fiber) {
                // The fiber is settings the rate to zero itself, so create
                // a dummy zero-duration delay for resuming it when the rate
                // becomes non-zero again.
                this.delays.set(fiber, { begin: this.now, dur: 0, rate: 0, p: 0 });
            }
            fiber.yielded = true;
        }
        if (fiber.children) {
            for (const child of fiber.children) {
                this.setRateForFiber(child, rate * child.ownRate, false);
            }
        }
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
                const fiber = this.currentFiber = queue.shift();
                console.assert(this.instantsByFiber.get(fiber) === this.now);
                this.instantsByFiber.delete(fiber);
                this.delays.delete(fiber);
                delete fiber.yielded;
                this.resumeQueues = [[], []];
                for (const n = fiber.ops.length; !fiber.yielded && fiber.ip < n;) {
                    fiber.ops[fiber.ip++].call(fiber, this);
                }
                if (!fiber.yielded) {
                    fiber.ended(this);
                }
                Array.prototype.unshift.apply(queue, this.resumeQueues[1]);
                Array.prototype.unshift.apply(queue, this.resumeQueues[0]);
            }
        }
        delete this.resumeQueues;
        delete this.currentFiber;
        this.now = end;
        for (const [fiber, { delegate, begin, dur, rate }] of this.ramps.entries()) {
            if (!fiber.handleResult || fiber.rate === 0) {
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
