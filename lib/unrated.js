// This is a minimal implementation of Epistrophy that does not include time
// manipulation (fibers always have a rate of 1).

// The scheduler has a clock and schedule fibers. Create a scheduler with
// `new Scheduler()`, schedule a fiber with `scheduler.schedulFiber(fiber, 0)`,
// and start the clock `scheduler.clock.start()`.
export class Scheduler extends EventTarget {
    constructor() {
        super();

        // Instants stored in increasing order, and maps from instant to fibers
        // and vice-versa.
        this.instants = new PriorityQueue();
        this.fibersByInstant = new Map();
        this.instantsByFiber = new Map();

        // Keep track of active fibers and ramps (indexed by their fiber).
        this.fibers = new Set();
        this.ramps = new Map();

        // The clock is stopped by default.
        this.clock = new Clock(this);

        // Catch exceptions during event handling.
        window.addEventListener("error", ({ error }) => {
            if (this.currentEventHandler) {
                const { fiber, now } = this.currentEventHandler;
                fiber.asyncDidEnd(this, now, error);
            }
        });
    }

    // Attach a child fiber at runtime to a running fiber, and schedule it
    // immediately (using the spawns queue when running, or regular scheduling
    // outside of an update loop).
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

    // Cancel a fiber by setting its error.
    // FIXME 4U05 Error propagation
    cancelFiber(fiber) {
        if (this.fibers.has(fiber) && fiber.cancel(this)) {
            if (fiber.joinDelegate) {
                for (const child of fiber.joinDelegate.pending) {
                    this.cancelFiber(child);
                }
            } else if (fiber !== this.currentFiber) {
                this.scheduleFiber(fiber, this.now ?? this.clock.now);
            }
        }
    }

    // Schedule a fiber at time t. An instant is added to the priority queue
    // if needed, then the maps between fibers and instants are updated. The
    // fiber must not be already scheduled. Return the fiber for convenience.
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

    // Set the duration of the current ramp for a fiber, possibly cutting it
    // short. This has no effect when no ramp is in progress.
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

    // Internal method called when an unresolved delay (such as async call or
    // event) is about to be resolved, updating the fiber local time before
    // delegate calls are made to decide whether to actually end. Keep track
    // of the current event handler if any in order to catch possible
    // exceptions during event handling.
    asyncCallEnded(fiber, enteringEventHandler = false) {
        const now = this.clock.now;
        fiber.now = now - fiber.begin;
        if (enteringEventHandler) {
            this.currentEventHandler = { fiber, now };
        }
        return now;
    }

    // Begin a ramp by immediately calling its callback with p=0, then adding
    // a ramp object with begin, dur and f.
    scheduleRamp(fiber, dur, f) {
        f?.(0, fiber, this);
        this.ramps.set(fiber, { begin: this.now, dur, f });
        if (dur > 0) {
            this.scheduleFiber(fiber, this.now + dur);
            return true;
        }
    }

    // Begin all fibers scheduled in the interval [begin, end[ in order, then
    // run all active ramps at t=end. Maintain a spawns and joins queue in
    // order to begin spawned fiber in depth-first order, and resuming parents
    // after their children have ended.
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

// Create a fiber with `new Fiber()` then add instructions with `async`,
// `event`, `ever`, `join`, `ramp`, `repeat`, `spawn` and `sync`. These are
// all chainable for convenience.
export class Fiber {
    constructor() {
        this.ops = [];
        this.everDepth = 0;
    }

    // Wrap an async function (or a function returning a promise) `f` in an
    // instruction. The optional delegate methods `asyncWillEndWithValue` and
    // `asyncWillEndWithError` are called when the async all ends (or the
    // promise is resolved or reject) with either a value or an error before
    // execution resumes.
    async(f, delegate) {
        this.ops.push(["async", this.everDepth > 0, f, delegate]);
        return this;
    }

    // Add an event listener to a target. Both `target` and `type` can be
    // object/string values or functions evaluated at runtime. The optional
    // delegate methods `eventShouldBeIgnored` should return true if an event
    // should be ignored (i.e, keeping the instruction running; for instance,
    // waiting for a specific mouse button or key to be pressed), and
    // `eventWasHandled` is called with the actual event object before
    // execution resumes (e.g., to call `preventDefault` or `stopPropagation`
    // on the event, or inspect its parameters).
    event(target, type, delegate) {
        this.ops.push(["event", this.everDepth > 0, target, type, delegate]);
        return this;
    }

    // Wraps a sequence of instructions in an `ever` block so that execition
    // continues even in the presence of an error.
    ever(f) {
        this.everDepth += 1;
        f(this);
        this.everDepth -= 1;
        return this;
    }

    // Wait for child fibers to end. This has no effect when there are no
    // child fibers. The optional delegate methods `fiberWillJoin` and
    // `childFiberDidJoin` are called when the join is about to begin and
    // every time a child fiber ends.
    join(delegate) {
        this.ops.push(["join", this.everDepth > 0, delegate]);
        return this;
    }

    // Create a delay of a given duration (a number in milliseconds or a
    // function executing at runtime to provide a dynamic duration) with
    // an optional callback f that gets called with a progress parameter
    // p (in the [0, 1] range) on every scheduler update. The duration must
    // be 0 or more, and may be infinite (in which case p is always 0).
    ramp(dur, f) {
        this.ops.push(["ramp", this.everDepth > 0, dur, f]);
        return this;
    }

    // Repeat a child fiber. The optional delegate method `repeatShouldEnd`
    // should return true when the repetition should end and is called before
    // every iteration with the current iteration count (starting at 0 before
    // the first iteration begins).
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

    // Spawn a child fiber, calling `f` on the new fiber, or returning it
    // (instead of seld) if `f` is not provided.
    spawn(f) {
        const child = new Fiber();
        this.ops.push(["spawn", this.everDepth > 0, child]);
        if (typeof f === "function") {
            f(child);
            return this;
        }
        return child;
    }

    // Wrap a synchronous function in a fiber instruction.
    sync(f) {
        this.ops.push(["sync", this.everDepth > 0, f]);
        return this;
    }

    // Runtime execution of the above instructions.
    static Ops = {

        // Call f and wait for a value or an error. The async delegate is set
        // on the fiber and checked again on completion, since the fiber may
        // have errored in the meantime.
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
            // Yield.
            return true;
        },

        // Setup an event listener and wait for it. Remove the event listener
        // on completion (if the event is not ignored), or if the fiber is
        // cancelled.
        event(scheduler, target, type, delegate) {
            const fiber = this;
            const effectiveTarget = this.getEffectiveParameter(target, scheduler);
            const effectiveType = this.getEffectiveParameter(type, scheduler);
            this.asyncDelegate = extend(delegate, {
                asyncWasCancelled: () => {
                    effectiveTarget.removeEventListener(effectiveType, this.asyncDelegate);
                },
                handleEvent(event) {
                    const now = scheduler.asyncCallEnded(fiber, true);
                    if (delegate?.eventShouldBeIgnored?.call(delegate, event, fiber, scheduler)) {
                        return;
                    }
                    delegate?.eventWasHandled?.call(delegate, event, fiber, scheduler);
                    effectiveTarget.removeEventListener(effectiveType, this);
                    fiber.asyncDidEnd(scheduler, now);
                }
            });
            effectiveTarget.addEventListener(effectiveType, this.asyncDelegate);
            // Yield.
            return true;
        },

        // Setup a join delegate with the current children marked as pending.
        // Child fibers that end call their parent’s `childFiberDidEnd` method
        // which eventually request the scheduler to resume the fiber when no
        // pending fibers are left.
        join(scheduler, delegate) {
            if (!this.children) {
                return;
            }
            this.joinDelegate = extend(delegate, { pending: new Set(this.children) });
            delegate?.fiberWillJoin?.call(delegate, this, scheduler);
            return true;
        },

        // Jump back to the previous repeat instruction.
        loop() {
            this.ip -= 2;
        },

        // Get the ramp duration and register the ramp with the scheduler.
        ramp(scheduler, dur, f) {
            const effectiveDuration = Math.max(0, this.getEffectiveParameter(dur, scheduler));
            if (effectiveDuration >= 0) {
                return scheduler.scheduleRamp(this, effectiveDuration, f);
            }
            throw Error("Ramp duration is not a positive number");
        },

        // Spawn the body fiber and setups a specific join delegate that counts
        // iterations. The delegate `repeatShouldEnd` method is called before
        // every iteration; if it returns true, do not spawn the fiber and skip
        // over the following `loop` instruction.
        repeat(scheduler, body, delegate) {
            if (this.joinDelegate) {
                this.joinDelegate.iteration += 1;
            } else {
                this.joinDelegate = extend(delegate, { iteration: 0 });
            }
            if (delegate?.repeatShouldEnd?.call(delegate, this.joinDelegate.iteration, this, scheduler)) {
                delete this.joinDelegate;
                // Skip the next instruction (loop) and do not yield.
                this.ip += 1;
            } else {
                this.joinDelegate.pending = new Set([scheduler.attachFiber(this, body)]);
                // Yield.
                return true;
            }
        },

        // Spawn a new instance of the child fiber and continue.
        spawn(scheduler, child) {
            scheduler.attachFiber(this, child);
        },

        // Call f and continue.
        sync(scheduler, f) {
            f(this, scheduler);
        }
    };
}

// Special error object for handling cancellation.
const Cancelled = Error("cancelled");

// Runtime instances of fibers, maintaining their execution state (instruction
// pointer, local time, children and/or parent, error, scope, &c.)
export class ScheduledFiber {

    // Create a new instance from a fiber and possible parent, keeping track
    // of the global begin time to maintain local time. The scope of the fiber
    // is empty or is an extension of the parent scope.
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

    // Request the scheduler to resume execution when an asynchronous call
    // (async or event) ends, possibly with an error.
    asyncDidEnd(scheduler, now, error) {
        delete this.asyncDelegate;
        delete scheduler.currentEventHandler;
        scheduler.scheduleFiber(this, now);
        if (error) {
            this.errorWithMessage(scheduler, error);
        }
    }

    // Cancel the fiber and resume, unless the current instruction is in an
    // ever block.
    // FIXME 4U05 Error propagation
    cancel(scheduler) {
        this.error = Cancelled;
        if (!this.ops[this.ip - 1][1]) {
            this.asyncDelegate?.asyncWasCancelled.call(Object.getPrototypeOf(this.asyncDelegate), this, scheduler);
            return true;
        }
    }

    // True if the fiber was cancelled.
    get cancelled() {
        return this.error === Cancelled;
    }

    // When a child fiber ends, check with the join delegate whether this was
    // the last pending child or not. If so, request the scheduler to resume
    // execution.
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

    // Set the error and send a message from the scheduler.
    errorWithMessage(scheduler, error) {
        this.error = error;
        if (this.joinDelegate && !this.ops[this.ip - 1][1]) {
            for (const child of this.joinDelegate.pending) {
                scheduler.cancelFiber(child);
            }
        }
        scheduler.dispatchEvent(new CustomEvent("error", { detail: { fiber: this, error } }));
    }

    // Evaluate dynamic parameters with the fiber and scheduler as arguments,
    // or simply return non-function values.
    getEffectiveParameter(param, scheduler) {
        return typeof param === "function" ? param(this, scheduler) : param;
    }

    // Run to the end or until an instruction yields, catching errors.
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

// The clock used by the scheduler. This clock is based on
// requestAnimationFrame and sends a tick event upon request.
export class Clock {
    constructor(scheduler) {
        this.scheduler = scheduler;
        this.currentTime = 0;
    }

    // True when there is no outstanding request.
    get idle() {
        return !this.request;
    }

    // True if and only if the clock is playing, otherwise it is stopped.
    get playing() {
        return Object.hasOwn(this, "startTime");
    }

    // Request a tick from the clock (only when playing).
    advance() {
        if (this.playing && !this.request) {
            this.request = window.requestAnimationFrame(() => { this.tick(); });
        }
    }

    // Send a tick message with begin being the last time a tick was updated,
    // and end being the current time.
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

    // Get the current time.
    get now() {
        return this.playing ? performance.now() - this.startTime : this.currentTime;
    }

    // Advance the clock manually, generating a tick. This can be used to
    // run a fiber synchronously as if time had advanced.
    set now(end) {
        if (end > this.currentTime) {
            const begin = this.currentTime;
            this.currentTime = end;
            this.scheduler.update(begin, end);
        }
    }

    // Start the clock and request a tick.
    start() {
        if (!this.playing) {
            this.startTime = performance.now();
            this.lastUpdateTime = this.startTime;
            this.advance();
        }
    }

    // Stop the clock (without a tick).
    stop() {
        if (this.playing) {
            window.cancelAnimationFrame(this.request);
            delete this.request;
            delete this.startTime;
        }
    }
}

// Extend a new instance of an object (or the empty object) with additional
// properties.
export const extend = (x, ...props) => Object.assign(x ? Object.create(x) : {}, ...props);

// Priority queue implemented with a binary heap.
export class PriorityQueue extends Array {

    // Create a new priority queue with a comparison function to order elements
    // (minimum queue by default).
    constructor(cmp = (a, b) => a - b) {
        super();
        this.cmp = cmp;
    }

    // Insert a new element x in the queue maintaining the heap property.
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

    // Remove an element and return it, maintaining the heap property. By
    // default, the first element is removed.
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

// Remove an element from an array.
export const remove = (xs, x) => {
    const index = xs.indexOf(x);
    if (index < 0) {
        throw Error("Cannot remove non-element of array");
    }
    xs.splice(index, 1)[0];
}
