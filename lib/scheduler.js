import { remove, PriorityQueue, on, message } from "./util.js";

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
        this.fibers = new Set();
        this.fibersByName = new Map();
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
        scheduler.resumeFiber(fiber);
        return fiber;
    }

    // FIXME 4H0B Scheduler.init() and Scheduler.run()
    static initWithFiber(fiber) {
        const scheduler = new Scheduler();
        scheduler.resetFiber(fiber);
        scheduler.resumeFiber(fiber);
        return scheduler;
    }

    // Retrieve a fiber by its name.
    fiberNamed(name) {
        return this.fibersByName.get(name);
    }

    // Get the local time of an active fiber.
    fiberLocalTime(fiber) {
        return fiber.now + (
            isFinite(fiber.rate) ? (this.now - (fiber.lastUpdateTime ?? fiber.beginTime)) * fiber.rate : 0
        );
    }

    // Resume a fiber, as soon as possible, or at time t in the future. When
    // resuming now, add to the resume queue of the current update loop; add
    // at the end when the deferred flag is set (used for joining).
    resumeFiber(fiber, t, deferred = false) {
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
    rescheduleFiber(fiber, t) {
        if (this.instantsByFiber.has(fiber)) {
            t = t ?? this.now;
            if (t === this.instantsByFiber.get(fiber)) {
                return;
            }
            remove(this.fibersByInstant.get(this.instantsByFiber.get(fiber)), fiber);
            this.instantsByFiber.delete(fiber);
        }
        this.resumeFiber(fiber, t);
    }

    // Delay a fiber by `dur` which is expected to be greater than zero. The
    // fiber yields and is scheduled to resume after taking into account the
    // duration of the delay and the rate of the fiber.
    setDelayForFiber(fiber, dur) {
        console.assert(!this.delays.has(fiber) && !this.ramps.has(fiber));
        const begin = this.now;
        const rate = fiber.rate;
        const effectiveDur = dur / rate;
        if (effectiveDur > 0) {
            this.delays.set(fiber, { begin, dur, rate, fiberBegin: fiber.now, fiberEnd: fiber.now + dur });
            fiber.yielded = true;
            this.resumeFiber(fiber, begin + effectiveDur);
        }
    }

    // Begin a ramp for `dur` and call the `rampDidProgress` delegate with
    // p = 0. The fiber yields and is scheduled to resume after the duration
    // of the ramp. When undoing, begin at p = 1 and ramp back down to 0.
    beginRampForFiber(fiber, dur, delegate) {
        if (!fiber.handleResult) {
            return;
        }
        console.assert(!this.delays.has(fiber) && !this.ramps.has(fiber));
        const begin = this.now;
        delegate = Object.create(delegate ?? {});
        const rate = fiber.rate;
        delegate.rampDidProgress?.call(delegate, rate < 0 ? 1 : 0, fiber, this);
        this.ramps.set(fiber, { delegate, begin, dur, rate, fiberBegin: fiber.now, fiberEnd: fiber.now + dur });
        fiber.yielded = true;
        this.resumeFiber(fiber, begin + dur / rate);
    }

    // End the ramp when the fiber resumes and call the `rampDidProgress`
    // delegate with p = 1. When undoing, end at 0.
    endRampForFiber(fiber) {
        if (!fiber.handleResult) {
            return;
        }
        const { delegate, fiberBegin, fiberEnd, dur } = this.ramps.get(fiber);
        this.ramps.delete(fiber);
        fiber.now = fiberEnd;
        delegate.rampDidProgress?.call(delegate, fiber.rate < 0 ? 0 : 1, fiber, this);
        return dur;
    }

    // Reset the fiber by setting its begin time to the current time of the
    // sechduler, its ip to 0, and initializing various state from the parent
    // fiber.
    resetFiber(fiber) {
        console.assert(!this.fibers.has(fiber));
        this.fibers.add(fiber);
        fiber.beginTime = this.now;
        fiber.now = 0;
        delete fiber.endTime;
        fiber.rate = fiber.parent?.rate ?? 1;
        fiber.ownRate = 1;
        fiber.ip = 0;
        fiber.unops = [];
        fiber.handleValue = [fiber.parent?.handleValue.at(-1) ?? true];
        fiber.handleError = [fiber.parent?.handleError.at(-1) ?? false];
        fiber.scope = fiber.parent ? Object.create(fiber.parent.scope) : {};
        if (!Object.hasOwn(fiber, "result")) {
            fiber.result = fiber.handleError.at(-1) && fiber.parent?.error ?
                { error: fiber.parent.error } :
                { value: fiber.parent?.value };
        }
    }

    // Register a name for the fiber.
    setNameForFiber(fiber, name) {
        console.assert(name !== undefined);
        if (this.fibersByName.has(name)) {
            throw Error("A fiber with the same name is already running");
        }
        this.removeNameForFiber(fiber);
        this.fibersByName.set(name, fiber);
        Fiber.Names.set(fiber, name);
    }

    // Remove the name of the fiber, if any;
    removeNameForFiber(fiber) {
        const name = fiber.name;
        if (this.fibersByName.has(name)) {
            console.assert(this.fibersByName.get(name) === fiber);
            this.fibersByName.delete(name);
            Fiber.Names.delete(fiber);
        }
    }

    // Cancel a fiber and its pending children, if joining. This sets its error
    // value to Cancelled and resumes immediately, leaving the fiber a chance
    // to handle cancellation gracefully. The current value is not overwritten.
    // FIXME 4J0C Cancel a fiber with handleError=true
    cancelFiber(fiber) {
        console.assert(!fiber.endTime);
        fiber.result.error = Fiber.Cancelled;
        fiber.parent?.children?.splice(fiber.parent?.children?.indexOf(fiber), 1);
        if (fiber.handleError.at(-1)) {
            if (fiber.joinDelegate) {
                for (const child of fiber.joinDelegate.pending) {
                    this.cancelFiber(child);
                }
            }
            return;
        }
        if (fiber.eventDelegate) {
            // The fiber was waiting for an event.
            const { target, type } = fiber.eventDelegate;
            if (target.addEventListener) {
                target.removeEventListener(type, fiber.eventDelegate);
            } else {
                off(target, type, fiber.eventDelegate);
            }
            delete fiber.eventDelegate;
        }
        if (fiber.joinDelegate) {
            // The fiber is joining; cancel the pending children.
            // Do not cancel children when not joining.
            const pending = fiber.joinDelegate.pending;
            delete fiber.joinDelegate;
            for (const child of pending) {
                this.cancelFiber(child);
            }
        }
        if (fiber.child) {
            // The fiber is joining a single fiber (as used by repeat).
            this.cancelFiber(fiber.child);
            delete fiber.child;
        } else if (fiber.yielded) {
            this.rescheduleFiber(fiber);
        }
    }

    // Attach a child fiber like spawn does, creating it if necessary. This can
    // be used to add new child fibers while the parent is still joining.
    attachFiber(fiber, child) {
        if (!child) {
            child = new Fiber();
        }
        child.parent = fiber;
        if (!fiber.children) {
            fiber.children = [];
        }
        fiber.children.push(child);
        this.resetFiber(child);
        this.resumeFiber(child);
        return child;
    }

    // A fiber ended. Its end time is set and its parent (if any) is notified.
    // When a child fiber ends, remove it from the set of pending children
    // and resume when the set becomes empty. Do nothing if the child is not
    // pending (e.g., the fiber is not actually joining).
    fiberEnded(fiber) {
        console.assert(this.fibers.has(fiber));
        this.fibers.delete(fiber);
        this.removeNameForFiber(fiber);
        console.assert((fiber.rate > 0 && fiber.ip === fiber.ops.length) || (fiber.rate < 0 && fiber.unip === 0));
        delete fiber.ip;
        delete fiber.unip;
        delete fiber.unops;
        delete fiber.now;
        if (fiber.rate < 0) {
            // FIXME unspawn
            return;
        }
        fiber.endTime = this.now;
        const parent = fiber.parent;
        if (!parent?.joinDelegate?.pending.has(fiber)) {
            return;
        }
        parent.joinDelegate.pending.delete(fiber);
        parent.joinDelegate.childFiberDidEnd?.call(parent.joinDelegate, fiber, this);
        if (parent.joinDelegate.pending.size === 0) {
            delete parent.children;
            delete parent.joinDelegate;
            parent.now = this.fiberLocalTime(parent);
            this.resumeFiber(parent, this.now, true);
        }
    }

    // Update the current delay or ramp duration for the fiber, if any. If the
    // new end time of the delay or ramp is before the current time, reschedule
    // the fiber now.
    updateDelayForFiber(fiber, dur) {
        const update = delay => {
            delay.dur = dur;
            delay.fiberEnd = Math.max(fiber.now + dur, this.fiberLocalTime(fiber));
            console.assert(fiber.rate === delay.rate);
            this.rescheduleFiber(fiber, Math.max(delay.begin + dur / fiber.rate, this.now));
        };
        if (this.delays.has(fiber)) {
            update(this.delays.get(fiber));
        } else if (this.ramps.has(fiber)) {
            const delay = this.ramps.get(fiber);
            fiber.now = delay.fiberBegin;
            update(delay);
        }
    }

    // Set a new rate for the fiber. If it has a current delay or ramp, update
    // its duration as well to reflect the change. Also adjust the begin time
    // of the ramp to reflect the change of rate from this point on. Set the
    // rate for the child fiber as well by multiplying the child’s own rate
    // with the new rate; do not set the own rate of the children though (so
    // that they can resume at the right rate after pausing, for instance).
    setRateForFiber(fiber, rate, setOwnRate = true) {
        if (rate === fiber.rate) {
            return;
        }
        // FIXME 4L0D Reverse a reversed fiber
        const reverse = fiber.rate >= 0 && rate < 0;
        if (reverse) {
            fiber.unip = fiber.unops.length;
        }
        if (setOwnRate) {
            fiber.ownRate = rate;
        }
        fiber.rate = rate;

        const update = delay => {
            if (rate === 0) {
                delay.p = (this.now - delay.begin) / (delay.dur / delay.rate);
                remove(this.fibersByInstant.get(this.instantsByFiber.get(fiber)), fiber);
                this.instantsByFiber.delete(fiber);
            } else {
                const elapsed = this.now - delay.begin;
                if (reverse) {
                    this.rescheduleFiber(fiber, this.now - elapsed / rate);
                    const fiberBegin = delay.fiberBegin;
                    delay.fiberBegin = delay.fiberEnd;
                    delay.fiberEnd = fiberBegin;
                } else {
                    const p = delay.p ?? elapsed / (delay.dur / delay.rate);
                    const dur = delay.dur / rate;
                    delete delay.p;
                    delay.begin = this.now - p * dur;
                    this.rescheduleFiber(fiber, this.now + (1 - p) * dur);
                }
            }
            delay.rate = rate;
        };

        if (this.delays.has(fiber)) {
            update(this.delays.get(fiber));
            if (reverse) {
                fiber.unip -= 1;
            }
        } else if (this.ramps.has(fiber)) {
            update(this.ramps.get(fiber));
        } else if (rate === 0) {
            console.assert(!this.instantsByFiber.has(fiber));
            if (this.currentFiber === fiber) {
                // The fiber is setting the rate to zero itself, so create
                // a dummy zero-duration delay for resuming it when the rate
                // becomes non-zero again.
                this.delays.set(fiber, { begin: this.now, dur: 0, rate: 0, p: 0, fiberEnd: fiber.now });
            }
            fiber.yielded = true;
        }
        if (fiber.children) {
            for (const child of fiber.children) {
                this.setRateForFiber(child, rate * child.ownRate, false);
            }
        }
    }

    // Run all the ops for the fiber at this instant; that is, until the fiber
    // yields (or ends).
    runFiber(fiber) {
        while (!fiber.yielded) {
            if (fiber.rate > 0 && fiber.ip < fiber.ops.length) {
                fiber.ops[fiber.ip++].call(fiber, this);
            } else if (fiber.rate < 0 && fiber.unip > 0) {
                fiber.unops[--fiber.unip].call(fiber, this);
            } else {
                break;
            }
        }
        if (!fiber.yielded) {
            this.fiberEnded(fiber);
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
                if (this.delays.has(fiber)) {
                    const delay = this.delays.get(fiber);
                    fiber.now = delay.fiberEnd;
                    this.delays.delete(fiber);
                }
                delete fiber.yielded;
                fiber.lastUpdateTime = this.now;
                this.resumeQueues = [[], []];
                this.runFiber(fiber);
                Array.prototype.unshift.apply(queue, this.resumeQueues[1]);
                Array.prototype.unshift.apply(queue, this.resumeQueues[0]);
            }
        }
        delete this.resumeQueues;
        delete this.currentFiber;
        this.now = end;
        for (const [fiber, { delegate, begin, dur, rate, fiberBegin }] of this.ramps.entries()) {
            if (!fiber.handleResult || fiber.rate === 0) {
                continue;
            }
            const p = (this.now - begin) / (dur / rate);
            console.assert(p >= 0 && p <= 1);
            if (p < 1) {
                // The delegate is called with p = 1 when the ramp ends.
                fiber.now = fiberBegin + p * dur;
                delegate.rampDidProgress?.call(delegate, p, fiber, this);
            }
        }
        if (this.instants.length > 0) {
            this.clock.advance();
        }
        message(this, "update", { idle: this.fibers.size === 0 });
    }
}
