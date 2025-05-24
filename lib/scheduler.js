import { remove, Queue, on } from "./util.js";

import Clock from "./clock.js";
import Fiber from "./fiber.js";

export default class Scheduler {
    constructor() {
        this.clock = new Clock();
        on(this.clock, "tick", ({ begin, end }) => { this.update(begin, end); });
        this.instants = new Queue();
        this.fibersByInstant = new Map();
        this.schedule = new Map();
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
        if (this.instants.length > 0) {
            this.clock.advance();
        }
    }
}
