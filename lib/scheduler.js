import { message, on, PriorityQueue, remove } from "./util.js";

import Clock from "./clock.js";
import Fiber from "./fiber.js";

export default class Scheduler {
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

    // Attach a child fiber (creating it if necessary). This can be used to add
    // new child fibers while the parent is still joining, or based on dynamic
    // input. The fiber is added to the spawn queue (if spawned during an update
    // loop) or scheduled at the current time.
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

    // Cancel a fiber by setting its error to the special Cancelled value.
    // Async calls are cancelled then the fiber resumes—unless within an
    // ever() block. The fiber is either waiting on an async call, joining,
    // or ramping. Finally, children are cancelled whether the fiber is joining
    // or not. Fibers that have already ended are not affected.
    cancelFiber(fiber) {
        if (Object.hasOwn(fiber, "observedEnd")) {
            return;
        }
        console.assert(fiber.rate > 0);
        fiber.error = Fiber.Cancelled;
        if (fiber.ever === 0) {
            if (fiber.asyncDelegate) {
                fiber.now = (this.now - fiber.asyncDelegate.observedBegin) * fiber.rate;
                delete fiber.asyncDelegate;
                this.scheduleFiber(fiber);
            } else if (!fiber.joinDelegate) {
                const { begin, dur, observedBegin, observedDur } = this.ramps.get(fiber);
                this.ramps.delete(fiber);
                if (isFinite(observedDur)) {
                    const p = (this.now - observedBegin) / observedDur;
                    fiber.now = begin + p * dur;
                    fiber.trace.at(-1).push(dur, p);
                } else {
                    const dur = (this.now - observedBegin) * fiber.rate;
                    fiber.now = begin + dur;
                    fiber.trace.at(-1).push(dur, 0);
                }
                this.rescheduleFiber(fiber, this.now);
            }
        }
        // Cancel potential children whether the fiber is joining or not.
        if (fiber.children) {
            for (const child of fiber.children) {
                this.cancelFiber(child);
            }
        }
    }

    // The fiber is not active anymore. Record the observed end time for
    // reversing spawns. Notify the parent since it may be joining, and as a
    // result need to be scheduled when the last child has ended.
    fiberEnded(fiber) {
        fiber.observedEnd = this.now;
        this.fibers.delete(fiber);
        if (fiber.parent?.childFiberDidEnd(fiber, this)) {
            this.joinQueue.push(fiber.parent);
        }
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
        this.setChildFibersRate(fiber);
    }

    // Once the fiber rate has been set, propagate the change to child fibers.
    // This is also used when reversing a join.
    setChildFibersRate(fiber) {
        if (!fiber.children) {
            return;
        }
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
        if (fiber.rate < 0) {
            for (const fiber of fibers) {
                // The unend time is the elapsed time between the observed
                // end and the current scheduler time, but should be
                // adjusted by rate.
                const unend = this.now - fiber.observedEnd;
                this.scheduleFiber(fiber, this.now - unend / fiber.rate);
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
            } else if (isFinite(ramp.dur) && isFinite(rate)) {
                ramp.observedBegin = this.now - elapsed / rate;
                ramp.observedDur = ramp.dur / rate;
                ramp.observedEnd = ramp.observedBegin + ramp.observedDur;
                const end = rate > 0 ? ramp.observedEnd : ramp.observedBegin;
                // If the ramp duration changed when the fiber was paused, it
                // may have already ended by now.
                this.rescheduleFiber(fiber, Math.max(end, this.now));
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
    // starting progress value p (0 when going forward, 0 < p ≤ 1 when going
    // backward). Return Yield if the fiber needs to yield. A ramp stores its
    // local begin time and duration; also its observed begin time, end
    // time and duration, and the progress callback f. The observed duration is
    // negative when the ramp goes backward (and observedBegin > observedEnd).
    beginRampForFiber(fiber, dur, f, p) {
        console.assert(!this.ramps.has(fiber));
        console.assert(dur >= 0);
        // A backward ramp may not have an infinite duration (since it now has
        // both a definite begin and end time).
        console.assert(isFinite(dur) || p === 0);
        f(p, fiber, this);
        const begin = fiber.now - (isFinite(dur) ? p * dur : 0);
        const observedDur = dur / fiber.rate;
        const observedBegin = this.now - (isFinite(observedDur) ? p * observedDur : 0);
        const observedEnd = observedBegin + observedDur;
        this.ramps.set(fiber, { begin, dur, observedBegin, observedDur, observedEnd, f });
        if (observedDur !== 0) {
            this.scheduleFiber(fiber, Math.max(observedBegin, observedEnd));
            return Fiber.Yield;
        }
    }

    // Remove the ramp object for the fiber and call its update function with
    // the given p value (1 when going forward, 0 when backward). The ramp
    // duration may have been cutoff, in which case the fiber local time should
    // not be set to the past but match the current global time.
    endRampForFiber(fiber, p) {
        const { f, begin, dur, observedBegin, observedEnd } = this.ramps.get(fiber);
        this.ramps.delete(fiber);
        console.assert(isFinite(dur) || p === 0);
        fiber.now = fiber.rate > 0 && observedEnd < this.now ?
            (this.now - observedBegin) * fiber.rate : begin + (isFinite(dur) ? p * dur : 0);
        f(p, fiber, this);
    }

    // Change the duration of the current ramp (if any) for a fiber. If the
    // new duration is less than the elapsed time, the fiber ends immediately.
    // If the fiber is already at p = 1 (i.e., it is bound to be removed), this
    // has no effect either. Setting the ramp duration for negative rates is
    // not supported.
    setRampDurationForFiber(fiber, dur) {
        if (!this.ramps.has(fiber)) {
            return;
        }
        const ramp = this.ramps.get(fiber);
        if (dur === ramp.dur) {
            return;
        }
        ramp.dur = dur;
        if (fiber.rate === 0) {
            // Let the observed values be handled when the rate changes again.
            return;
        }
        ramp.observedDur = dur / fiber.rate;
        console.assert(ramp.observedDur >= 0);
        ramp.observedEnd = ramp.observedBegin + ramp.observedDur;
        this.rescheduleFiber(fiber, Math.max(this.now, ramp.observedEnd));
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
                this.joinQueue = [];
                if (!this.fibers.has(fiber)) {
                    this.fibers.set(fiber, fiber.run(this));
                }
                if (this.fibers.get(fiber).next().done) {
                    this.fiberEnded(fiber);
                }
                Array.prototype.unshift.apply(queue, this.joinQueue);
                Array.prototype.unshift.apply(queue, this.spawnQueue);
            }
        }
        delete this.spawnQueue;
        delete this.joinQueue;
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
