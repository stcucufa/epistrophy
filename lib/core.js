export class Fiber {
    constructor() {
        this.ops = [];
    }

    sync(f) {
        this.ops.push(["sync", f]);
        return this;
    }

    // Run all ops.
    *run(scheduler) {
        for (let i = 0, n = this.ops.length; i < n; ++i) {
            const [op, ...args] = this.ops[i];
            try {
                if (this.Ops[op].call(this, scheduler, ...args)) {
                    yield;
                }
            } catch (error) {
                this.error = error;
                return;
            }
        }
    }

    Ops = {

        // Call f synchronously with the fiber and scheduler as arguments.
        sync(scheduler, f) {
            f(this, scheduler);
        }

    };
}

import { PriorityQueue, on } from "./util.js";
import Clock from "./clock.js";

export class Scheduler {

    constructor() {
        // Create a default clock to drive the updates.
        this.clock = new Clock();
        on(this.clock, "tick", ({ begin, end }) => { this.update(begin, end); });

        // All instants (times) at which fibers are scheduled.
        this.instants = new PriorityQueue();

        // Lists of fibers scheduled at a given instant.
        this.fibersByInstant = new Map();

        // Map each fiber to the instant at which it is scheduled.
        this.instantsByFiber = new Map();

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
        console.assert(!this.instantsByFiber.has(fiber));
        this.instantsByFiber.set(fiber, t);
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

    // TODO
    fiberEnded(fiber) {
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
                console.assert(this.instantsByFiber.get(fiber) === this.now);
                this.instantsByFiber.delete(fiber);
                this.resumeQueue = [];
                this.deferredQueue = [];
                if (fiber.run().next().done) {
                    this.fiberEnded(fiber);
                }
                Array.prototype.unshift.apply(queue, this.deferredQueue);
                Array.prototype.unshift.apply(queue, this.resumeQueue);
            }
        }
        delete this.resumeQueue;
        delete this.deferredQueue;
        this.now = end;
        if (this.instants.length > 0) {
            this.clock.advance();
        }
    }
}
