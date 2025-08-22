import { extend, message, nop, remove } from "./util.js";

export default class Fiber {
    constructor() {
        this.ops = [];
        this.id = Fiber.ID++;
    }

    static ID = 0;
    static Yield = Symbol.for("yield");
    static Cancelled = Symbol.for("cancelled");

    static Ops = {
        // Start an async call as well as an infinite ramp, which will get
        // interrupted once the call finishes.
        async(scheduler, f, delegate, g) {
            if (this.rate < 0) {
                g?.(this, scheduler);
                return reverseRamp.call(this, scheduler, nop);
            }
            console.assert(!this.asyncDelegate);
            const instance = this.asyncDelegate = Object.create(delegate);
            f(this, scheduler).then(value => {
                if (this.asyncDelegate === instance) {
                    const now = scheduler.fiberAsyncUpdate(this);
                    delegate.asyncWillEndWithValue?.call(delegate, value, this, scheduler);
                    this.asyncDidEnd(scheduler, now);
                }
            }).catch(error => {
                if (this.asyncDelegate === instance) {
                    const now = scheduler.fiberAsyncUpdate(this);
                    delegate.asyncWillEndWithError?.call(delegate, error, this, scheduler);
                    this.asyncDidEnd(scheduler, now, error);
                }
            });
            return scheduler.beginRampForFiber(this, Infinity);
        },

        // Resolve both target and name and set an event listener for these.
        // Set up an async delegate and infinite ramp as async does.
        event(scheduler, target, name, delegate) {
            if (this.rate < 0) {
                return reverseRamp.call(this, scheduler, nop);
            }
            console.assert(!this.asyncDelegate);
            const fiber = this;
            const effectiveTarget = this.getEffectiveParameter(target, scheduler);
            const effectiveName = this.getEffectiveParameter(name, scheduler);
            const instance = this.asyncDelegate = extend(delegate, {
                asyncWasCancelled(fiber) {
                    effectiveTarget.removeEventListener(effectiveName, this);
                },
                handleEvent(event) {
                    const now = scheduler.fiberAsyncUpdate(fiber, true);
                    if (delegate?.eventShouldBeIgnored?.call(delegate, event, fiber, scheduler)) {
                        return;
                    }
                    delegate?.eventWasHandled?.call(delegate, event, fiber, scheduler);
                    effectiveTarget.removeEventListener(effectiveName, this);
                    fiber.asyncDidEnd(scheduler, now);
                }
            });
            effectiveTarget.addEventListener(effectiveName, instance);
            return scheduler.beginRampForFiber(this, Infinity);
        },

        // Increment (or decrement) the ever count of the fiber, reversing it
        // when going backward.
        ever(_, incr) {
            this.ever += incr * Math.sign(this.rate);
            console.assert(this.ever >= 0);
        },

        // Begin a ramp, evaluating its effective duration if necessary. When
        // going backward, start from the end.
        ramp(scheduler, dur, f) {
            if (this.rate < 0) {
                return reverseRamp.call(this, scheduler, f);
            }
            const effectiveDuration = Math.max(0, this.getEffectiveParameter(dur, scheduler));
            return scheduler.beginRampForFiber(this, isNaN(effectiveDuration) ? 0 : effectiveDuration, f);
        },

        // Call f synchronously with the fiber and scheduler as arguments.
        sync(scheduler, f, g) {
            if (this.rate > 0) {
                f(this, scheduler);
            } else {
                console.assert(this.rate < 0);
                g?.(this, scheduler);
            }
        }
    };

    // Add an async op to the fiber and return the fiber. A delegate can handle
    // the result of the call with its optional `asyncWillEndWithValue` and
    // `asyncWillEndWithError` methods that get called when the async call
    // finishes and before moving to the next op.
    async(f, delegate = {}) {
        this.ops.push(["async", f, delegate]);
        return this;
    }

    // Listen to an event on a target and a name before resuming. Events can be
    // filtered out if the optional `eventShouldBeIgnored` delegate method
    // returns true for that event; otherwise, the optional `eventWasHandled`
    // delegate method is called before resuming.
    event(target, name, delegate) {
        this.ops.push(["event", target, name, delegate]);
        return this;
    }

    // Wrap a block f (called with the fiber) into a pair of ever instructions,
    // allowing the block to be executed even when an error occurs.
    ever(f) {
        this.ops.push(["ever", 1]);
        f(this);
        this.ops.push(["ever", -1]);
        return this;
    }

    // Wait for child fibers to end, calling delegate methods before suspending
    // and anytime a child fiber ends.
    join(delegate = {}) {
        this.ops.push(["join", delegate]);
        return this;
    }

    // Add begin/end ramp ops to the fiber with the given duration and callback.
    // Return the fiber.
    ramp(dur, f = nop) {
        this.ops.push(["ramp", dur, f]);
        return this;
    }

    // Repeat a block f an infinite number of times, or until the delegate
    // method `repeatShouldEnd()` returns true.
    repeat(f, delegate = {}) {
        const body = new Fiber();
        this.ops.push(["repeat", delegate, body]);
        if (typeof f === "function") {
            f(body);
            return this;
        }
        return body;
    }

    // Spawn a child fiber.
    spawn(f) {
        const child = new Fiber();
        this.ops.push(["spawn", child]);
        if (typeof f === "function") {
            f(child);
            return this;
        }
        return child;
    }

    // Add a sync op to the fiber and return it.
    sync(f) {
        this.ops.push(["sync", f]);
        return this;
    }

    // Provide a custom reverse effect to ops that allow it.
    reverse(f) {
        if (this.ops.length === 0) {
            throw Error("Nothing to reverse");
        }
        const op = this.ops.at(-1);
        const arity = ReversibleArity[op[0]];
        if (isNaN(arity)) {
            throw Error(`Cannot provide a reverse effect for ${op[0]}`);
        }
        if (op.length > arity) {
            throw Error(`Already provided a reverse effect for ${op[0]}`);
        }
        op.push(f);
        return this;
    }

    // Run all ops, building a trace of the execution of instructions. When
    // going forward, the last element in the trace gives the index of the
    // next instruction to execute as well as the current local time. Executing
    // an instruction returns true when the fiber should yield. The generator
    // returns when reaching the end of the sequence, or when an error occurs.
    *run(scheduler) {
        if (!Object.hasOwn(this, "now")) {
            this.now = 0;
            this.trace = [[0, this.now]];
            this.ever = 0;
            this.rate = this.parent?.rate ?? 1;
            this.ownRate = 1;
            this.scope = this.parent ? Object.create(this.parent.scope) : {};
        }
        if (this.rate === 0) {
            yield;
        }
        for (
            let n = this.ops.length, [ip] = this.trace.at(-1);
            ((this.rate > 0 && 0 <= ip && ip < n) || (this.rate < 0 && this.trace.length > 1));
        ) {
            let allowError = this.ever > 0;
            if (this.rate < 0) {
                // FIXME 4M08 Core: redo
                const [nextip, end, error] = this.currentInstruction = this.trace.pop();
                ip = nextip - 1;
                this.error = error;
                if (error) {
                    // In case of an asynchronous error, we still need to ramp
                    // back (without executing the reverse instructions).
                    const [, begin, unerr] = this.trace.at(-1);
                    if (begin < end && error !== unerr) {
                        if (scheduler.beginRampForFiber(this, end - begin, nop, 1) === Fiber.Yield) {
                            yield;
                            continue;
                        }
                    }
                }
            }
            const [op, ...args] = this.ops[ip];
            console.info(`[${scheduler.now}][${this.now}] ID=${this.id} IP=${ip} OP=${op}`);
            if (this.rate > 0) {
                ip += 1;
                this.trace.push([ip, this.now, this.error]);
            }
            // FIXME 4T03 ever is not a regular op
            if (this.error && !allowError && op !== "ever") {
                console.warn(`Error: ${this.error.message ?? this.error}, skipped`);
                continue;
            }
            try {
                const v = Fiber.Ops[op].call(this, scheduler, ...args);
                if (v === Fiber.Yield || this.rate === 0) {
                    yield;
                } else if (typeof v === "number") {
                    ip += v;
                }
            } catch (error) {
                this.errorWithMessage(scheduler, error);
            }
        }
        delete this.instruction;
    }

    // Resume after an async call ended, updating the fiber local time.
    asyncDidEnd(scheduler, now, error) {
        delete this.asyncDelegate;
        delete scheduler.currentEventHandler;
        if (this.rate > 0) {
            scheduler.scheduleFiber(this, now);
        }
        if (error) {
            this.errorWithMessage(scheduler, error);
        }
    }

    // Handle child fibers ending when a join is in progress. Return true when
    // all child fibers have ended.
    childFiberDidEnd(fiber, scheduler) {
        if (!this.joinDelegate) {
            return;
        }
        this.now = this.joinDelegate.begin + (scheduler.now - this.joinDelegate.observedBegin) * this.rate;
        console.assert(this.joinDelegate.pending.has(fiber));
        this.joinDelegate.pending.delete(fiber);
        const delegate = Object.getPrototypeOf(this.joinDelegate);
        delegate.childFiberDidJoin?.call(delegate, fiber, scheduler);
        return this.joinDelegate.pending.size === 0;
    }

    // Set the error field of the result and send a message to report it.
    errorWithMessage(scheduler, error) {
        this.error = error;
        message(scheduler, "error", { fiber: this, error });
    }

    // Evaluate a parameter if necessary, or pass its value through.
    getEffectiveParameter(value, scheduler) {
        if (typeof value === "function") {
            return value(this, scheduler);
        }
        return value;
    }
}

// FIXME 4S02 Replace .reverse() with f, g parameters
const ReversibleArity = {
    async: 3,
    sync: 2
};

// Used by async ops to reverse a ramp (when rate < 0).
function reverseRamp(scheduler, f) {
    const [, begin,, dur, p] = this.currentInstruction;
    return scheduler.beginRampForFiber(this, dur ?? this.now - begin, f, p ?? 1);
}
