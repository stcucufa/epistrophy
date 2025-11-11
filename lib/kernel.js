import { customEvent, extend, PriorityQueue, remove } from "./util.js";

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

        // Keep track of active fibers and ramps (fibers extended with a
        // ramp property).
        this.fibers = new Set();
        this.ramps = new Set();

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
        const scheduledChild = new ScheduledFiber(this, child, now, fiber);
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
    cancelFiber(fiber) {
        if (this.fibers.has(fiber) && fiber.cancel(this)) {
            if (fiber.child) {
                this.cancelFiber(fiber.child);
            } else if (fiber.joinDelegate) {
                for (const child of fiber.children) {
                    this.cancelFiber(child);
                }
            } else if (fiber !== this.currentFiber) {
                this.rescheduleFiber(fiber, this.now ?? this.clock.now);
            }
        }
    }

    // Schedule a fiber at time t. An instant is added to the priority queue
    // if needed, then the maps between fibers and instants are updated. The
    // fiber must not be already scheduled. Return the fiber for convenience.
    scheduleFiber(fiber, t) {
        if (isFinite(t)) {
            const scheduledFiber = fiber.ip >= 0 ? fiber : new ScheduledFiber(this, fiber, t);
            if (!this.fibers.has(fiber)) {
                this.fibers.add(scheduledFiber);
            }
            this.instantsByFiber.set(scheduledFiber, t);
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

    // Reschedule a fiber: if it was previously scheduled for a different time,
    // remove it then schedule again; otherwise schedule it normally.
    rescheduleFiber(fiber, t) {
        if (this.instantsByFiber.has(fiber)) {
            const instant = this.instantsByFiber.get(fiber);
            if (instant === t) {
                // No need to reschedule at the same instant.
                return;
            }
            remove(this.fibersByInstant.get(instant), fiber);
            this.instantsByFiber.delete(fiber);
        }
        this.scheduleFiber(fiber, t);
    }

    // Set the fiber rate, as well as its effective rate and that of its
    // descendants (their own rate remains unchanged).
    setRateForFiber(fiber, rate) {
        fiber.rate = rate;
        this.setEffectiveRateForFiber(fiber, rate * (fiber.parent?.effectiveRate ?? 1), this.now ?? this.clock.now);
    }

    setEffectiveRateForFiber(fiber, effectiveRate, now) {
        if (fiber.effectiveRate === effectiveRate) {
            return;
        }
        if (effectiveRate === 0) {
            fiber.pausedTime = now;
            fiber.now = fiber.effectiveRate * (now - fiber.observedBegin);
        } else if (fiber.effectiveRate === 0) {
            fiber.observedBegin += (now - fiber.pausedTime);
            if (fiber.ramp) {
                fiber.ramp.observedBegin += (now - fiber.pausedTime);
            }
            delete fiber.pausedTime;
        } else {
            const infiniteRate = !isFinite(effectiveRate);
            const r = fiber.effectiveRate / effectiveRate;
            fiber.observedBegin = now - r * (now - fiber.observedBegin);
            if (fiber.ramp) {
                const ramp = fiber.ramp;
                if (isFinite(ramp.dur)) {
                    ramp.observedDur = ramp.dur / effectiveRate;
                } else if (infiniteRate) {
                    // An infinite ramp at infinite rate still does not finish but
                    // will be immediately interrupted.
                    ramp.elapsed = (now - ramp.observedBegin) * fiber.effectiveRate;
                    ramp.observedDur = 0;
                }
                ramp.observedBegin = now - r * (now - ramp.observedBegin);
                this.rescheduleFiber(fiber, ramp.observedBegin + ramp.observedDur);
            } else if (fiber.asyncDelegate && infiniteRate) {
                // Cancel any async delegate (await or event) at infinite rate.
                fiber.now = Infinity;
                fiber.asyncDelegate.asyncWasCancelled?.(fiber);
                delete fiber.asyncDelegate;
            }
        }
        fiber.effectiveRate = effectiveRate;
        if (fiber.child) {
            this.setEffectiveRateForFiber(fiber.child, effectiveRate * fiber.child.rate, now);
        }
        if (fiber.children) {
            for (const child of fiber.children) {
                this.setEffectiveRateForFiber(child, effectiveRate * child.rate, now);
            }
        }
    }

    // Set the duration of the current ramp for a fiber, possibly cutting it
    // short. This has no effect when there is no ramp in progress.
    setRampDurationForFiber(fiber, dur) {
        if (!(dur >= 0)) {
            throw Error("Ramp duration is not a positive number");
        }
        if (!fiber.ramp) {
            return;
        }
        if (dur === fiber.ramp.dur) {
            return;
        }
        fiber.ramp.dur = dur;
        fiber.ramp.observedDur = isFinite(dur) ? dur / fiber.effectiveRate : dur;
        const end = fiber.ramp.observedBegin + fiber.ramp.observedDur;
        this.rescheduleFiber(fiber, Math.max(this.now ?? this.clock.now, end));
    }

    // Internal method called when an unresolved delay (such as async call or
    // event) is about to be resolved, updating the fiber local time before
    // delegate calls are made to decide whether to actually end. Keep track
    // of the current event handler if any in order to catch possible
    // exceptions during event handling.
    asyncCallEnded(fiber, enteringEventHandler = false) {
        const now = this.clock.now;
        // FIXME 5307 Kernel: async behaviour at rate
        fiber.now = fiber.effectiveRate * (now - fiber.observedBegin);
        if (enteringEventHandler) {
            this.currentEventHandler = { fiber, now };
        }
        return now;
    }

    // Begin a ramp by setting the fiber’s progress value p to 0, then adding a
    // ramp object with the callback function both local begin/dur and observed
    // begin/dur, and the currently elapsed time (in local time). The callback
    // is called and the fiber yields if the duration is greater than zero.
    scheduleRamp(fiber, dur, f) {
        if (!(dur > 0)) {
            return;
        }
        const observedBegin = this.now;
        const observedDur = isFinite(fiber.effectiveRate) ? dur / fiber.effectiveRate : 0;
        fiber.p = 0;
        fiber.ramp = { observedBegin, observedDur, begin: fiber.now, dur, elapsed: 0, f };
        f?.(fiber);
        if (observedDur === 0) {
            const definite = isFinite(dur);
            if (definite) {
                // A ramp with definite duration finishes synchronously at
                // infinite rate.
                fiber.p = 1;
                fiber.now += dur;
                f?.(fiber);
            }
            delete fiber.p;
            delete fiber.ramp;
            // Still yield for infinite ramps (although no ramp is added and
            // the fiber is not scheduled again).
            return !definite;
        }
        this.ramps.add(fiber);
        this.scheduleFiber(fiber, observedBegin + observedDur);
        return true;
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
                this.instantsByFiber.delete(this.currentFiber);
                if (this.currentFiber.rate === 0) {
                    continue;
                }
                this.spawns = [];
                this.joins = [];
                if (this.currentFiber.ramp) {
                    // The ramp ended so call the callback one last time with
                    // p = 1 before resuming normal execution. A special case
                    // is an infinite ramp at infinite rate which gets called
                    // one last time.
                    const ramp = this.currentFiber.ramp;
                    if (isFinite(ramp.dur)) {
                        this.currentFiber.p = 1;
                        this.currentFiber.now = ramp.begin + ramp.dur;
                        ramp.elapsed = ramp.dur;
                    } else {
                        this.currentFiber.now = ramp.begin + ramp.elapsed;
                    }
                    // FIXME 5304 Failing ramp should not call f
                    ramp.f?.(this.currentFiber);
                    delete this.currentFiber.ramp;
                    delete this.currentFiber.p;
                    this.ramps.delete(this.currentFiber);
                    if (!isFinite(this.currentFiber.effectiveRate) && !isFinite(ramp.dur)) {
                        this.currentFiber.now = Infinity;
                    }
                }
                // Run the current fiber until it ends or yields.
                if (this.currentFiber.runToCompletion()) {
                    this.fibers.delete(this.currentFiber);
                    if (this.currentFiber.parent?.childFiberDidEnd(this.currentFiber)) {
                        this.joins.push(this.currentFiber.parent);
                    }
                }
                queue.unshift(...this.spawns, ...this.joins);
            }
        }
        delete this.spawns;
        delete this.joins;
        // Update ongoing ramps.
        this.now = end;
        for (const fiber of this.ramps) {
            const ramp = fiber.ramp;
            if (ramp.f && fiber.effectiveRate !== 0) {
                ramp.elapsed = fiber.effectiveRate * (this.now - ramp.observedBegin);
                const p = isFinite(ramp.dur) ? ramp.elapsed / ramp.dur : 0;
                if (p < 1) {
                    this.currentFiber = fiber;
                    fiber.now = ramp.begin + ramp.elapsed;
                    fiber.p = p;
                    ramp.f(fiber);
                }
            }
        }
        delete this.currentFiber;
        delete this.now;
        if (this.instants.length > 0 || this.ramps.size > 0) {
            this.clock.advance();
        }
        customEvent.call(this, "update", { begin, end, idle: this.fibers.size === 0 && this.clock.idle });
    }
}

// Counter for fiber and scheduled fiber IDs (useful for debugging).
let FiberID = 0;

// Create a fiber with `new Fiber()` then add instructions with `await`,
// `call`, `event`, `ever`, `join`, `ramp`, and `spawn`. These can all be
// chained for convenience.
export class Fiber extends Array {
    constructor() {
        super();
        this.id = FiberID++;
    }

    // Wrap an async function (or a function returning a promise) `f` in an
    // instruction. The optional delegate methods `asyncWillEndWithValue` and
    // `asyncWillEndWithError` are called when the async all ends (or the
    // promise is resolved or reject) with either a value or an error before
    // execution resumes.
    await(f, delegate) {
        return this.op("await", f, delegate);
    }

    // Wrap a synchronous function in a fiber instruction.
    call(f) {
        return this.op("call", f);
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
        return this.op("event", target, type, delegate);
    }

    // Wraps a sequence of instructions in an `ever` block so that execition
    // continues even in the presence of an error.
    ever(f) {
        this.everDepth = (this.everDepth ?? 0) + 1;
        f(this);
        if (this.everDepth === 1) {
            delete this.everDepth;
        } else {
            this.everDepth -= 1;
        }
        return this;
    }

    // Wait for child fibers to end. This has no effect when there are no
    // child fibers. The optional delegate methods `fiberWillJoin` and
    // `childFiberDidJoin` are called when the join is about to begin and
    // every time a child fiber ends.
    join(delegate) {
        return this.op("join", delegate);
    }

    // Create a delay of a given duration (a number in milliseconds or a
    // function executing at runtime to provide a dynamic duration) with
    // an optional callback f that gets called with a progress parameter
    // p (in the [0, 1] range) on every scheduler update. The duration must
    // be 0 or more, and may be infinite (in which case p is always 0).
    ramp(dur, f) {
        return this.op("ramp", dur, f);
    }

    // Embed a child fiber, calling `f` on the new fiber, or returning it
    // (instead of self) if `f` is not provided.
    // FIXME 5005 Review spawn argument handling
    seq(f) {
        const child = f instanceof Fiber ? f : new Fiber();
        this.op("seq", child);
        if (typeof f === "function") {
            f(child);
            return this;
        }
        return f === child ? this : child;
    }

    // Spawn a child fiber, calling `f` on the new fiber, or returning it
    // (instead of self) if `f` is not provided.
    // FIXME 5005 Review spawn argument handling
    spawn(f) {
        const child = new Fiber();
        this.op("spawn", child);
        if (typeof f === "function") {
            f(child);
            return this;
        }
        return child;
    }

    // Push a new op with the current protection status and return the fiber.
    op(name, ...args) {
        this.push([name, this.everDepth > 0, ...args]);
        return this;
    }

    // Runtime execution of the above instructions.
    static Ops = {

        // Call f and wait for a value or an error. The async delegate is set
        // on the fiber and checked again on completion, since the fiber may
        // have errored in the meantime.
        await(f, delegate) {
            const instance = this.asyncDelegate = extend(delegate);
            f(this).then(value => {
                if (this.asyncDelegate === instance) {
                    const now = this.scheduler.asyncCallEnded(this);
                    this.value = instance.asyncWillEndWithValue?.(value, this) ?? value ?? this.value;
                    this.asyncDidEnd(now);
                }
            }).catch(error => {
                if (this.asyncDelegate === instance) {
                    const now = this.scheduler.asyncCallEnded(this);
                    instance.asyncWillEndWithError?.(error, this);
                    this.asyncDidEnd(now, error);
                }
            });
            // Yield.
            return true;
        },

        // Call f and continue.
        call(f) {
            this.value = f(this) ?? this.value;
        },

        // Setup an event listener and wait for it. Remove the event listener
        // on completion (if the event is not ignored), or if the fiber is
        // cancelled.
        event(target, type, delegate) {
            if (!isFinite(this.effectiveRate)) {
                this.now = Infinity;
                return;
            }
            const fiber = this;
            const effectiveTarget = this.getEffectiveParameter(target);
            const effectiveType = this.getEffectiveParameter(type);
            this.asyncDelegate = extend(delegate, {
                asyncWasCancelled: () => {
                    effectiveTarget.removeEventListener(effectiveType, this);
                },
                handleEvent(event) {
                    if (fiber.effectiveRate === 0 || fiber.scheduler.clock.paused) {
                        return;
                    }
                    const now = fiber.scheduler.asyncCallEnded(fiber, true);
                    if (this.eventShouldBeIgnored?.(event, fiber)) {
                        return;
                    }
                    this.eventWasHandled?.(event, fiber);
                    effectiveTarget.removeEventListener(effectiveType, this);
                    fiber.asyncDidEnd(now);
                }
            });
            effectiveTarget.addEventListener(effectiveType, this.asyncDelegate);
            // Yield.
            return true;
        },

        // Setup a join delegate and call its `fiberWillJoin` method then
        // yield. Child fibers that end call their parent’s `childFiberDidEnd`
        // method which eventually request the scheduler to resume the fiber
        // when no child fibers are left. End immediately if no child fibers
        // have been spawned.
        join(delegate) {
            if (this.children) {
                this.joinDelegate = extend(delegate);
                this.joinDelegate.fiberWillJoin?.(this);
                return true;
            }
        },

        // Get the ramp duration and register the ramp with the scheduler.
        ramp(dur, f) {
            const effectiveDuration = Math.max(0, this.getEffectiveParameter(dur));
            if (effectiveDuration >= 0) {
                return this.scheduler.scheduleRamp(this, effectiveDuration, f);
            }
            throw Error("Ramp duration is not a positive number");
        },

        // Spawn a new instance of the child fiber and yield until the child
        // joins. This is a special child fiber that is not added to the list
        // of children (and is thus unaffected by regular joins).
        seq(child) {
            this.child = new ScheduledFiber(this.scheduler, child, this.scheduler.now, this);
            this.scheduler.fibers.add(this.child);
            // This is similar to Scheduler.attachFiber() but the child is
            // always first, as if the fiber was executing normally.
            this.scheduler.spawns.unshift(this.child);
            // If the seq instruction was protected, then so is the whole fiber.
            if (this.everDepth > 0) {
                this.child.everDepth = fiber.everDepth;
            }
            // The join delegate is a single function to distinguish it from a
            // regular join, acting on the single child rather than the list
            // of children.
            this.joinDelegate = function(child) {
                this.value = child.value;
                if (child.error) {
                    this.error = child.error;
                }
                delete this.child;
            };
            return true;
        },

        // Spawn a new instance of the child fiber and continue.
        spawn(child) {
            this.scheduler.attachFiber(this, child);
        },
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
    constructor(scheduler, fiber, begin, parent) {
        this.id = `${fiber.id}/${FiberID++}`;
        this.scheduler = scheduler;
        this.fiber = fiber;
        this.observedBegin = begin;
        this.now = 0;
        this.ip = 0;
        this.rate = 1;
        if (parent) {
            this.scope = Object.create(parent.scope);
            this.parent = parent;
            this.value = parent.value;
            this.effectiveRate = this.rate * parent.effectiveRate;
        } else {
            this.scope = {};
            this.effectiveRate = this.rate;
        }
    }

    // Request the scheduler to resume execution when an asynchronous call
    // (await or event) ends, possibly with an error.
    asyncDidEnd(now, error) {
        delete this.asyncDelegate;
        delete this.scheduler.currentEventHandler;
        this.now = this.effectiveRate * (now - this.observedBegin);
        this.scheduler.scheduleFiber(this, now);
        if (error) {
            this.errorWithMessage(error);
        }
    }

    // True if the fiber handles errors (inside an ever block).
    // Check the first instruction if the fibrer has not begun yet (may be
    // cancelled before it got the change to begin).
    get handlesErrors() {
        return this.fiber[Math.max(0, this.ip - 1)]?.[1];
    }

    // Cancel the fiber and resume, unless the current instruction is in an
    // ever block.
    cancel() {
        this.error = Cancelled;
        if (!this.handlesErrors) {
            this.asyncDelegate?.asyncWasCancelled?.(this);
            return true;
        }
    }

    // When a child fiber ends, call the join delegate’s `childFiberDidJoin`
    // method, then check with the join delegate whether this was the last
    // pending child or not. If so, request the scheduler to resume execution.
    childFiberDidEnd(fiber) {
        if (!this.joinDelegate) {
            return;
        }
        if (typeof this.joinDelegate === "function") {
            // FIXME 5208 Kernel: remove seq
            this.joinDelegate.call(this, fiber);
            delete this.joinDelegate;
            return true;
        }
        remove(this.children, fiber);
        this.joinDelegate.childFiberDidJoin?.(fiber);
        if (this.joinDelegate.finalChildFiberDidJoin?.(fiber) || this.children.length === 0) {
            delete this.joinDelegate;
            delete this.children;
            return true;
        }
    }

    // Set the error and send a message from the scheduler and cancel child
    // fibers.
    errorWithMessage(error) {
        this.error = error;
        if (this.joinDelegate && !this.handlesErrors) {
            if (this.child) {
                this.scheduler.cancelFiber(this.child);
            } else {
                for (const child of this.children) {
                    this.scheduler.cancelFiber(child);
                }
            }
        }
        customEvent.call(this.scheduler, "error", { fiber: this, error });
    }

    // Evaluate dynamic parameters with the fiber and scheduler as arguments,
    // or simply return non-function values.
    getEffectiveParameter(param) {
        return typeof param === "function" ? param(this) : param;
    }

    // Run to the end or until an instruction yields, catching errors. Return
    // nothing when yielding, and true when done. Suspend execution when
    // reaching an infinite now or when paused.
    runToCompletion() {
        while (this.ip < this.fiber.length) {
            if (!isFinite(this.now) || this.effectiveRate === 0) {
                return;
            }
            const [op, ever, ...args] = this.fiber[this.ip++];
            if (this.error && !ever) {
                continue;
            }
            try {
                if (Fiber.Ops[op].call(this, ...args)) {
                    return;
                }
            } catch (error) {
                this.errorWithMessage(error);
            }
        }
        return true;
    }
}

// The clock used by the scheduler, based on requestAnimationFrame and calling
// the scheduler’s update function directly. Also sends events when its state
// (stopped, paused, playing) changes.
export class Clock extends EventTarget {
    constructor(scheduler) {
        super();
        this.scheduler = scheduler;
        this.currentTime = 0;
    }

    // True when there is no outstanding request.
    get idle() {
        return !this.request;
    }

    // True if and only if the clock is playing, otherwise it is stopped or
    // paused.
    get playing() {
        return Object.hasOwn(this, "startTime") && !this.paused;
    }

    // True if and only if the clock is paused.
    get paused() {
        return Object.hasOwn(this, "pausedTime");
    }

    // True if and only if the clock is stopped.
    get stopped() {
        return !Object.hasOwn(this, "startTime");
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
        return this.playing ? performance.now() - this.startTime :
            this.paused ? this.pausedTime - this.startTime : this.currentTime;
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
        if (this.stopped) {
            this.startTime = performance.now();
            this.lastUpdateTime = this.startTime;
            this.advance();
            customEvent.call(this, "state", { state: "playing" });
        }
    }

    // Stop the clock (without a tick).
    stop() {
        if (this.playing) {
            window.cancelAnimationFrame(this.request);
            delete this.request;
            delete this.startTime;
            customEvent.call(this, "state", { state: "stopped" });
        } else if (this.paused) {
            delete this.pausedTime;
            customEvent.call(this, "state", { state: "stopped" });
        }
        this.currentTime = 0;
    }

    // Resume the clock when paused; can also start the clock if stopped.
    resume() {
        if (this.stopped) {
            return this.start();
        }
        if (this.paused) {
            const offset = performance.now() - this.pausedTime;
            this.startTime += offset;
            this.lastUpdateTime += offset;
            delete this.pausedTime;
            this.advance();
            customEvent.call(this, "state", { state: "playing" });
        }
    }

    // Pause the clock (without a tick).
    pause() {
        if (this.playing) {
            this.pausedTime = performance.now();
            window.cancelAnimationFrame(this.request);
            delete this.request;
            customEvent.call(this, "state", { state: "paused" });
        }
    }
}
