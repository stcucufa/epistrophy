import Fiber from "./fiber.js";

class Clock {
    constructor(scheduler) {
        this.scheduler = scheduler;
        this.startTime = performance.now();
    }

    get now() {
        return performance.now() - this.startTime;
    }
}

export default class Scheduler {
    constructor() {
        this.clock = new Clock(this);
    }

    resume(fiber) {
        delete this.yielded;
        const now = this.clock.now;
        if (!Object.hasOwn(fiber, "ip")) {
            fiber.reset(now);
        }
        this.update(fiber);
    }

    yield() {
        this.yielded = true;
    }

    update(fiber) {
        for (const n = fiber.ops.length; !this.yielded && fiber.ip < n;) {
            fiber.ops[fiber.ip++](this);
        }
    }
}
