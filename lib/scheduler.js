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
    }

    handleMessage({ type }) {
        console.assert(type === "tick");
        const begin = this.lastUpdateTime;
        const end = this.clock.now;
        if (end > begin) {
            this.update(begin, end);
        }
    }

    resume(fiber, t) {
        const now = this.currentTime ?? this.clock.now;
        t = t ?? now;
        console.assert(t >= now);
        if (t === this.currentTime) {
            this.queue.push(fiber);
        } else {
            if (!this.fibersByInstant.has(t)) {
                this.instants.insert(t);
                this.fibersByInstant.set(t, []);
            }
            this.fibersByInstant.get(t).push(fiber);
        }
        return fiber;
    }

    yield() {
        this.yielded = true;
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
                for (const n = fiber.ops.length; !this.yielded && fiber.ip < n;) {
                    fiber.ops[fiber.ip++](this);
                }
                delete this.yielded;
            }
            this.lastUpdateTime = end;
            delete this.currentTime;
        }
    }
}
