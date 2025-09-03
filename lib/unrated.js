export class Scheduler extends EventTarget {
    constructor() {
        super();
        this.instants = new PriorityQueue();
        this.instantsByFiber = new Map();
        this.fibersByInstant = new Map();
        this.fibers = new Set();
        this.ramps = new Map();
        this.clock = new Clock(this);
        window.addEventListener("error", ({ error }) => {
            if (this.currentEventHandler) {
                const { fiber, now } = this.currentEventHandler;
                fiber.asyncDidEnd(this, now, error);
            }
        });
    }

    attachFiber(fiber, child) {
        const now = this.now ?? this.clock.now;
        const scheduledChild = new ScheduledFiber(child, now, fiber);
        if (!fiber.children) {
            fiber.children = [scheduledChild];
        } else {
            fiber.children.push(scheduledChild);
        }
        if (this.spawns) {
            this.fibers.add(scheduledChild);
            this.spawns.push(scheduledChild);
        } else {
            this.scheduleFiber(scheduledChild, now);
        }
        return scheduledChild;
    }

    cancelFiber(fiber) {
        if (this.fibers.has(fiber) && fiber.cancel(this) && fiber !== this.currentFiber) {
            this.scheduleFiber(fiber, this.now ?? this.clock.now);
        }
    }

    scheduleFiber(fiber, t) {
        this.instantsByFiber.set(fiber, t);
        if (isFinite(t)) {
            const scheduledFiber = fiber.ip >= 0 ? fiber : new ScheduledFiber(fiber, t);
            if (!this.fibers.has(fiber)) {
                this.fibers.add(scheduledFiber);
            }
            if (!this.fibersByInstant.has(t)) {
                this.instants.insert(t);
                this.fibersByInstant.set(t, [scheduledFiber]);
            } else {
                this.fibersByInstant.get(t).push(scheduledFiber);
            }
            this.clock.advance();
        }
        return fiber;
    }

    setRampDurationForFiber(fiber, dur) {
        if (!(dur >= 0)) {
            throw Error("Ramp duration is not a positive number");
        }
        if (!this.ramps.has(fiber)) {
            return;
        }
        const ramp = this.ramps.get(fiber);
        if (dur === ramp.dur) {
            return;
        }
        ramp.dur = dur;
        remove(this.fibersByInstant.get(this.instantsByFiber.get(fiber)), fiber);
        this.scheduleFiber(fiber, Math.max(this.now ?? this.clock.now, ramp.begin + dur));
    }

    asyncCallEnded(fiber, enteringEventHandler = false) {
        const now = this.clock.now;
        fiber.now = now - fiber.begin;
        if (enteringEventHandler) {
            this.currentEventHandler = { fiber, now };
        }
        return now;
    }

    scheduleRamp(fiber, dur, f) {
        f?.(0, fiber, this);
        this.ramps.set(fiber, { begin: this.now, dur, f });
        if (dur > 0) {
            this.scheduleFiber(fiber, this.now + dur);
            return true;
        }
    }

    update(begin, end) {
        while (this.instants.length > 0 && this.instants[0] >= begin && this.instants[0] < end) {
            this.now = this.instants.remove();
            const queue = this.fibersByInstant.get(this.now);
            this.fibersByInstant.delete(this.now);
            while (queue.length > 0) {
                this.currentFiber = queue.shift();
                this.spawns = [];
                this.joins = [];
                this.currentFiber.now = this.now - this.currentFiber.begin;
                if (this.ramps.has(this.currentFiber)) {
                    const ramp = this.ramps.get(this.currentFiber);
                    this.ramps.delete(this.currentFiber);
                    ramp.f?.(1, this.currentFiber, this);
                }
                if (this.currentFiber.runToCompletion(this)) {
                    this.fibers.delete(this.currentFiber);
                    if (this.currentFiber.parent?.childFiberDidEnd(this.currentFiber, this)) {
                        this.joins.push(this.currentFiber.parent);
                    }
                }
                queue.unshift(...this.spawns, ...this.joins);
            }
        }
        delete this.spawns;
        delete this.joins;
        this.now = end;
        for (const [fiber, ramp] of this.ramps.entries()) {
            if (ramp.f) {
                const p = isFinite(ramp.dur) ? (this.now - ramp.begin) / ramp.dur : 0;
                if (p < 1) {
                    this.currentFiber = fiber;
                    fiber.now = this.now - fiber.begin;
                    ramp.f(p, fiber, this);
                }
            }
        }
        delete this.currentFiber;
        delete this.now;
        if (this.instants.length > 0 || this.ramps.size > 0) {
            this.clock.advance();
        }
        this.dispatchEvent(new CustomEvent("update", {
            detail: { begin, end, idle: this.fibers.size === 0 && this.clock.idle }
        }));
    }
}

export class Fiber {
    constructor() {
        this.ops = [];
        this.everDepth = 0;
    }

    async(f, delegate) {
        this.ops.push(["async", this.everDepth > 0, f, delegate]);
        return this;
    }

    event(target, name, delegate) {
        this.ops.push(["event", this.everDepth > 0, target, name, delegate]);
        return this;
    }

    ever(f) {
        this.everDepth += 1;
        f(this);
        this.everDepth -= 1;
        return this;
    }

    join(delegate) {
        this.ops.push(["join", this.everDepth > 0, delegate]);
        return this;
    }

    ramp(dur, f) {
        this.ops.push(["ramp", this.everDepth > 0, dur, f]);
        return this;
    }

    repeat(f, delegate) {
        const body = new Fiber();
        this.ops.push(
            ["repeat", this.everDepth > 0, body, delegate],
            ["loop", this.everDepth > 0]
        );
        if (typeof f === "function") {
            f(body);
            return this;
        }
        return body;
    }

    spawn(f) {
        const child = new Fiber();
        this.ops.push(["spawn", this.everDepth > 0, child]);
        if (typeof f === "function") {
            f(child);
            return this;
        }
        return child;
    }

    sync(f) {
        this.ops.push(["sync", this.everDepth > 0, f]);
        return this;
    }

    static Ops = {
        async(scheduler, f, delegate) {
            const instance = this.asyncDelegate = extend(delegate);
            f(this, scheduler).then(value => {
                if (this.asyncDelegate === instance) {
                    const now = scheduler.asyncCallEnded(this);
                    delegate?.asyncWillEndWithValue?.call(delegate, value, this, scheduler);
                    this.asyncDidEnd(scheduler, now);
                }
            }).catch(error => {
                if (this.asyncDelegate === instance) {
                    const now = scheduler.asyncCallEnded(this);
                    delegate?.asyncWillEndWithError?.call(delegate, error, this, scheduler);
                    this.asyncDidEnd(scheduler, now, error);
                }
            });
            return true;
        },

        event(scheduler, target, name, delegate) {
            const fiber = this;
            const effectiveTarget = this.getEffectiveParameter(target, scheduler);
            const effectiveName = this.getEffectiveParameter(name, scheduler);
            this.asyncDelegate = extend(delegate, {
                asyncWasCancelled() {
                    effectiveTarget.removeEventListener(effectiveName, this);
                },
                handleEvent(event) {
                    const now = scheduler.asyncCallEnded(fiber, true);
                    if (delegate?.eventShouldBeIgnored?.call(delegate, event, fiber, scheduler)) {
                        return;
                    }
                    delegate?.eventWasHandled?.call(delegate, event, fiber, scheduler);
                    effectiveTarget.removeEventListener(effectiveName, this);
                    fiber.asyncDidEnd(scheduler, now);
                }
            });
            effectiveTarget.addEventListener(effectiveName, this.asyncDelegate);
            return true;
        },

        join(scheduler, delegate) {
            if (!this.children) {
                return;
            }
            this.joinDelegate = extend(delegate, { pending: new Set(this.children) });
            delegate?.fiberWillJoin?.call(delegate, this, scheduler);
            return true;
        },

        loop() {
            this.ip -= 2;
        },

        ramp(scheduler, dur, f) {
            const effectiveDuration = Math.max(0, this.getEffectiveParameter(dur, scheduler));
            if (effectiveDuration >= 0) {
                return scheduler.scheduleRamp(this, effectiveDuration, f);
            }
            throw Error("Ramp duration is not a positive number");
        },

        repeat(scheduler, body, delegate) {
            if (this.joinDelegate) {
                this.joinDelegate.iteration += 1;
            } else {
                this.joinDelegate = extend(delegate, { iteration: 0 });
            }
            if (delegate?.repeatShouldEnd?.call(delegate, this.joinDelegate.iteration, this, scheduler)) {
                delete this.joinDelegate;
                this.ip += 1;
            } else {
                this.joinDelegate.pending = new Set([scheduler.attachFiber(this, body)]);
                return true;
            }
        },

        spawn(scheduler, child) {
            scheduler.attachFiber(this, child);
        },

        sync(scheduler, f) {
            f(this, scheduler);
        }
    };
}

const Cancelled = Error("cancelled");

class ScheduledFiber {
    constructor(fiber, begin, parent) {
        this.ops = fiber.ops;
        this.begin = begin;
        this.ip = 0;
        this.now = 0;
        if (parent) {
            this.scope = Object.create(parent.scope);
            this.parent = parent;
        } else {
            this.scope = {};
        }
    }

    asyncDidEnd(scheduler, now, error) {
        delete this.asyncDelegate;
        delete scheduler.currentEventHandler;
        scheduler.scheduleFiber(this, now);
        if (error) {
            this.errorWithMessage(scheduler, error);
        }
    }

    cancel(scheduler) {
        this.error = Cancelled;
        if (!this.ops[this.ip - 1][1]) {
            this.asyncDelegate?.asyncWasCancelled(this, scheduler);
            return true;
        }
    }

    get cancelled() {
        return this.error === Cancelled;
    }

    childFiberDidEnd(fiber, scheduler) {
        if (!this.joinDelegate) {
            return;
        }
        this.now = scheduler.now - this.begin;
        this.joinDelegate.pending.delete(fiber);
        const delegate = Object.getPrototypeOf(this.joinDelegate);
        delegate.childFiberDidJoin?.call(delegate, fiber, scheduler);
        if (this.joinDelegate.pending.size === 0) {
            if (!Object.hasOwn(this.joinDelegate, "iteration")) {
                delete this.joinDelegate;
            }
            delete this.children;
            return true;
        }
    }

    errorWithMessage(scheduler, error) {
        this.error = error;
        scheduler.dispatchEvent(new CustomEvent("error", { detail: { fiber: this, error } }));
    }

    getEffectiveParameter(param, scheduler) {
        return typeof param === "function" ? param(this, scheduler) : param;
    }

    runToCompletion(scheduler) {
        while (this.ip < this.ops.length) {
            const [op, ever, ...args] = this.ops[this.ip++];
            if (this.error && !ever) {
                continue;
            }
            try {
                if (Fiber.Ops[op].call(this, scheduler, ...args)) {
                    return;
                }
            } catch (error) {
                this.errorWithMessage(scheduler, error);
            }
        }
        return true;
    }
}

export class Clock {
    constructor(scheduler) {
        this.scheduler = scheduler;
        this.currentTime = 0;
    }

    get idle() {
        return !this.request;
    }

    get playing() {
        return Object.hasOwn(this, "startTime");
    }

    advance() {
        if (this.playing && !this.request) {
            this.request = window.requestAnimationFrame(() => { this.tick(); });
        }
    }

    tick() {
        delete this.request;
        const now = performance.now();
        const begin = this.lastUpdateTime - this.startTime;
        const end = now - this.startTime;
        if (begin === end) {
            this.request = window.requestAnimationFrame(() => { this.tick(); });
        } else {
            this.lastUpdateTime = now;
            this.scheduler.update(begin, end);
        }
    }

    set now(end) {
        if (end > this.currentTime) {
            const begin = this.currentTime;
            this.currentTime = end;
            this.scheduler.update(begin, end);
        }
    }

    get now() {
        return this.playing ? performance.now() - this.startTime : this.currentTime;
    }

    start() {
        if (!this.playing) {
            this.startTime = performance.now();
            this.lastUpdateTime = this.startTime;
            this.advance();
        }
    }

    stop() {
        if (this.playing) {
            window.cancelAnimationFrame(this.request);
            delete this.request;
            delete this.startTime;
        }
    }
}

export const extend = (x, ...props) => Object.assign(x ? Object.create(x) : {}, ...props);

export class PriorityQueue extends Array {
    constructor(cmp = (a, b) => a - b) {
        super();
        this.cmp = cmp;
    }

    insert(x) {
        this.push(x);
        for (let i = this.length - 1; i > 0;) {
            const j = Math.floor((i - 1) / 2);
            if (this.cmp(x, this[j]) >= 0) {
                break;
            }
            this[i] = this[j];
            this[j] = x;
            i = j;
        }
        return x;
    }

    remove(at = 0) {
        const n = this.length - 1;
        if (n < 0) {
            return;
        }
        const last = this.pop();
        if (n === at) {
            return last;
        }
        const removed = this[at];
        this[at] = last;
        for (let i = at;;) {
            const j = 2 * i + 1;
            if (j >= n) {
                break;
            }
            const k = j + 1;
            if (this.cmp(this[i], this[j]) <= 0) {
                if (k >= n || this.cmp(this[i], this[k]) <= 0) {
                    break;
                }
                this[i] = this[k];
                this[k] = last;
                i = k;
            } else {
                if (k >= n || this.cmp(this[j], this[k]) <= 0) {
                    this[i] = this[j];
                    this[j] = last;
                    i = j;
                } else if (k < n) {
                    this[i] = this[k];
                    this[k] = last;
                    i = k;
                } else {
                    break;
                }
            }
        }
        return removed;
    }
}

export const remove = (xs, x) => {
    const index = xs.indexOf(x);
    if (index < 0) {
        throw Error("Cannot remove non-element of array");
    }
    xs.splice(index, 1)[0];
}
