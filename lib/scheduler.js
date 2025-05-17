import { Queue, on, message } from "./util.js";
import Fiber from "./fiber.js";

class Clock {
    constructor() {
        this.currentTime = 0;
    }

    set now(value) {
        if (value !== this.currentTime) {
            this.currentTime = value;
            message(this, "tick");
        }
    }

    get now() {
        return this.currentTime;
    }
}

export default class Scheduler {
    constructor() {
        this.clock = new Clock();
        on(this.clock, "tick", this);
        this.lastUpdateTime = this.clock.now;
        this.instants = new Queue();
        this.fibersByInstant = new Map();
        this.schedule = new Map();
    }

    get now() {
        return this.currentTime ?? this.clock.now;
    }

    handleMessage({ type }) {
        console.assert(type === "tick");
        const begin = this.lastUpdateTime;
        const end = this.clock.now;
        if (end > begin) {
            this.update(begin, end);
        }
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
        if (t === now && this.resumeQueues) {
            this.resumeQueues[0].push(fiber);
            return;
        }
        if (!this.fibersByInstant.has(t)) {
            this.instants.insert(t);
            this.fibersByInstant.set(t, []);
        }
        this.fibersByInstant.get(t).push(fiber);
        return fiber;
    }

    reschedule(fiber, t) {
        console.assert(this.schedule.has(fiber));
        if (t !== this.schedule.get(fiber)) {
            this.schedule.delete(fiber);
            this.resume(fiber, t);
        }
    }

    update(begin, end) {
        while (this.instants.length > 0 && this.instants[0] >= begin && this.instants[0] < end) {
            this.currentTime = this.instants.remove();
            this.queue = this.fibersByInstant.get(this.currentTime);
            this.fibersByInstant.delete(this.currentTime);
            while (this.queue.length > 0) {
                const fiber = this.queue.shift();
                if (!Object.hasOwn(fiber, "ip")) {
                    fiber.reset(this.currentTime);
                }
                console.assert(this.schedule.has(fiber));
                this.schedule.delete(fiber);
                delete fiber.yielded;
                this.resumeQueues = [[], []];
                for (const n = fiber.ops.length; !fiber.yielded && fiber.ip < n;) {
                    fiber.ops[fiber.ip++](this);
                }
                if (!fiber.yielded) {
                    fiber.ended(this);
                }
                Array.prototype.unshift.apply(this.queue, this.resumeQueues[0]);
                Array.prototype.push.apply(this.queue, this.resumeQueues[1]);
            }
            this.lastUpdateTime = end;
            delete this.currentTime;
            delete this.resumeQueues;
        }
    }
}
