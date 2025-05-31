import { isAsync, remove, on, off, parseOffsetValue } from "./util.js";

const Cancelled = Error("cancelled");

export default class Fiber {
    static #count = 0;
    static #fibers = new Map();
    static byName = name => Fiber.#fibers.get(name);

    constructor(parent) {
        this.parent = parent;
        this.id = Fiber.#count++;
        this.ops = [];
    }

    // Set the name of the fiber so that it can be retrieved from the static
    // `byName` map (e.g. to update the delay or set the rate.
    name(name) {
        console.assert(!Fiber.#fibers.has(this));
        Fiber.#fibers.set(name, this);
        this.id += ":" + name;
        return this;
    }

    get value() {
        if (this.result.error) {
            return;
        }
        return this.result.value;
    }

    set value(value) {
        delete this.result.error;
        this.result.value = value;
    }

    get error() {
        return this.result.error;
    }

    get handleResult() {
        return (this.result.error && this.handleError.at(-1)) || (!this.result.error && this.handleValue.at(-1));
    }

    // Set the error field of the result and report it to the console.
    errorWithMessage(error) {
        this.result.error = error;
        console.error(error.message ?? error);
    }

    reset(t) {
        this.beginTime = t;
        delete this.endTime;
        this.rate = 1;
        this.ip = 0;
        this.handleValue = [this.parent?.handleValue.at(-1) ?? true];
        this.handleError = [this.parent?.handleError.at(-1) ?? false];
        this.result = this.handleError.at(-1) && this.parent?.error ?
            { error: this.parent.error } :
            { value: this.parent?.value };
    }

    // Cancel a fiber and its pending children, if joining. This sets its error
    // value to Cancelled and resumes immediately, leaving the fiber a chance
    // to handle cancellation gracefully. The current value is not overwritten.
    // FIXME delayed cancellation?
    // FIXME cancelling the cancellation with either?
    cancel(scheduler) {
        console.assert(!this.endTime);
        this.result.error = Cancelled;
        this.parent?.children?.splice(this.parent?.children?.indexOf(this), 1);
        if (this.eventDelegate) {
            // The fiber was waiting for an event.
            const { target, type } = this.eventDelegate;
            if (target.addEventListener) {
                target.removeEventListener(type, this.eventDelegate);
            } else {
                off(target, type, this.eventDelegate);
            }
            delete this.eventDelegate;
        }
        if (this.joinDelegate) {
            // The fiber is joining; cancel the pending children.
            // Do not cancel children when not joining.
            const pending = this.joinDelegate.pending;
            delete this.joinDelegate;
            for (const fiber of pending) {
                fiber.cancel(scheduler);
            }
        }
        if (this.yielded) {
            scheduler.reschedule(this);
        }
    }

    exec(f) {
        this.ops.push(isAsync(f) ? scheduler => {
            if (!this.handleResult) {
                return;
            }
            f(this, scheduler).
                then(value => { this.value = value; }).
                catch(error => { this.errorWithMessage(error); }).
                finally(() => { scheduler.resume(this, scheduler.clock.now); });
            this.yielded = true;
        } : scheduler => {
            if (!this.handleResult) {
                return;
            }
            try {
                this.value = f(this, scheduler);
            } catch (error) {
                this.errorWithMessage(error);
            }
        });
        return this;
    }

    effect(f) {
        this.ops.push(isAsync(f) ? scheduler => {
            if (!this.handleResult) {
                return;
            }
            f(this, scheduler).
                catch(error => { this.errorWithMessage(error); }).
                finally(() => { scheduler.resume(this, scheduler.clock.now); });
            scheduler.yield();
        } : scheduler => {
            if (!this.handleResult) {
                return;
            }
            try {
                f(this, scheduler);
            } catch (error) {
                this.errorWithMessage(error);
            }
        });
        return this;
    }

    event(target, type, delegate = {}) {
        this.ops.push(scheduler => {
            console.assert(!this.eventDelegate);
            if (!this.handleResult) {
                return;
            }
            // FIXME 4F01 Delegates should be instantiated
            this.eventDelegate = Object.assign(Object.create(delegate), { target, type });
            if (target.addEventListener) {
                target.addEventListener(type, this.eventDelegate);
                this.eventDelegate.handleEvent = event => {
                    if (this.eventDelegate.eventShouldBeIgnored?.call(delegate, event, this, scheduler)) {
                        return;
                    }
                    target.removeEventListener(type, this.eventDelegate);
                    this.eventDelegate.eventWasHandled?.call(delegate, event, this, scheduler);
                    delete this.eventDelegate;
                    scheduler.resume(this, scheduler.clock.now);
                };
            } else {
                on(target, type, this.eventDelegate);
                this.eventDelegate.handleMessage = message => {
                    if (this.eventDelegate.eventShouldBeIgnored?.call(delegate, message, this, scheduler)) {
                        return;
                    }
                    off(target, type, this.eventDelegate);
                    this.eventDelegate.eventWasHandled?.call(delegate, message, this, scheduler);
                    delete this.eventDelegate;
                    scheduler.resume(this, scheduler.clock.now);
                };
            }
            this.yielded = true;
        });
        return this;
    }

    // Normally fiber execution skips over errors, but either allows handling
    // them by providing a path for values (f) and a path for errors (g). When
    // the second path is omitted, both errors and values are handled; the
    // fiber has an error if it is failing, and no error otherwise.
    either(f, g) {
        this.ops.push(() => { this.handleError.push(true); });
        if (g) {
            this.ops.push(scheduler => {
                if (this.error) {
                    this.ip = error;
                } else {
                    this.handleError.push(false);
                }
            });
            f(this);
            this.ops.push(scheduler => {
                this.ip = end;
                this.handleError.pop();
            });
            const error = this.ops.length;
            this.ops.push(scheduler => { this.handleValue.push(false); });
            g(this);
            this.ops.push(scheduler => {
                this.handleValue.pop();
                this.handleError.pop();
            });
            const end = this.ops.length;
        } else {
            f(this);
            this.ops.push(() => { this.handleError.pop(); });
        }
        return this;
    }

    repeat(f, delegate = {}) {
        this.ops.push(() => {
            if (!this.handleResult) {
                // Do not set a repeat delegate and skip the cleanup part.
                this.ip = end + 1;
                return;
            }
            // FIXME 4F01 Delegates should be instantiated
            const repeatDelegate = Object.create(delegate);
            if (this.repeatDelegate) {
                repeatDelegate.parent = this.repeatDelegate;
            }
            this.repeatDelegate = repeatDelegate;
            this.repeatDelegate.count = 0;
        });
        const begin = this.ops.length;
        this.ops.push(scheduler => {
            if (!this.handleResult ||
                this.repeatDelegate.repeatShouldEnd?.call(delegate, this.repeatDelegate.count, this, scheduler)) {
                this.ip = end;
            }
            this.repeatDelegate.iterationTime = scheduler.now;
        });
        f(this);
        this.ops.push(scheduler => {
            if (!this.repeatDelegate.repeatShouldEnd && scheduler.now === this.repeatDelegate.iterationTime) {
                this.errorWithMessage(Error("Zero duration repeat"));
            } else {
                this.repeatDelegate.count += 1;
                this.ip = begin;
            }
        });
        const end = this.ops.length;
        this.ops.push(() => {
            if (this.repeatDelegate.parent) {
                this.repeatDelegate = this.repeatDelegate.parent;
            } else {
                delete this.repeatDelegate;
            }
        });
        return this;
    }

    // Ramp from 0 to 1 over a given duration (dur may be a function or a fixed
    // duration specified as a number of milliseconds or a SMIL clock value).
    // The delegate method `rampDidProgress` gets called with three
    // parameters `p`, `fiber` and `scheduler` (and `this` being the instance
    // of the delegate object created for this ramp) on every update during the
    // duration of the ramp. `rampDidProgress` is called first with p=0 at the
    // exact time when the ramp starts and p=1 exactly when the ramp ends; in
    // between, it may get called with 0 < p < 1 increasing at various times
    // within the duration. When duration is infinite however, p is always 0.
    // FIXME 4E02 Count iterations for (infinite) ramps
    ramp(dur, delegate) {
        if (typeof dur === "function") {
            this.ops.push(scheduler => {
                if (!this.handleResult) {
                    return;
                }
                const effectiveDur = this.getEffectiveDuration(dur, scheduler);
                if (typeof effectiveDur === "number" && effectiveDur > 0) {
                    scheduler.beginRamp(this, effectiveDur, delegate);
                }
            });
            this.ops.push(scheduler => { scheduler.endRamp(this); });
        } else {
            const effectiveDur = typeof dur === "string" ? parseOffsetValue(dur) : dur;
            if (typeof dur === "number" && dur > 0) {
                this.ops.push(scheduler => { scheduler.beginRamp(this, effectiveDur, delegate); });
                this.ops.push(scheduler => { scheduler.endRamp(this); });
            }
        }
        return this;
    }

    // Wait for `dur`ms, unless the fiber is failing. If dur is a function,
    // call it with `fiber` and `scheduler` as arguments and use the return
    // value as the delay duration. The duration value may also be an offset
    // value which gets parsed into a number of milliseconds. There is no
    // effect if the final duration is not a number greater than zero. The
    // value of the fiber is not affected by the delay.
    delay(dur) {
        this.ops.push(scheduler => {
            if (!this.handleResult) {
                return;
            }
            const effectiveDur = this.getEffectiveDuration(dur, scheduler);
            if (typeof effectiveDur === "number" && effectiveDur > 0) {
                scheduler.delay(this, effectiveDur);
            }
        });
        return this;
    }

    // Get the effective duration of a delay or a ramp, which could be a
    // number, a string, or a function returning a number or a string.
    // Return nothing in case of error.
    getEffectiveDuration(dur, scheduler) {
        if (typeof dur === "function") {
            try {
                dur = dur(this, scheduler);
            } catch (error) {
                this.errorWithMessage(error);
                return;
            }
        }
        return typeof dur === "string" ? parseOffsetValue(dur) : dur;
    }

    // Spawn a new fiber. The new fiber is created immediately as a child of
    // this fiber and returned, unless a function is passed as the first
    // argument, in which case that function is called with the child fiber
    // as its only argument and the current fiber is returned. The child fiber
    // will then begin after the parent fiber yields, in the same instant.
    spawn(f) {
        const child = new Fiber(this);
        this.ops.push(scheduler => {
            if (!this.handleResult) {
                return;
            }
            if (!this.children) {
                this.children = [];
            }
            this.children.push(child);
            scheduler.resume(child);
        });
        if (typeof f === "function") {
            f(child);
            return this;
        }
        return child;
    }

    // Yield and wait for child fibers to end. If there are no child fibers,
    // or the fiber is failing, do nothing.
    join(delegate = {}) {
        this.ops.push(scheduler => {
            if (!this.handleResult) {
                // FIXME what to do about children?
                if (this.children?.length > 0) {
                    console.warn(`Not joinining because of error; pending children: ${this.children.size}`);
                }
                return;
            }
            console.assert(!this.joinDelegate);
            if (this.children) {
                console.assert(this.children.length > 0);
                this.joinDelegate = Object.assign(Object.create(delegate), { pending: new Set(this.children) });
                this.joinDelegate?.fiberWillJoin?.call(this.joinDelegate, this, scheduler);
                this.yielded = true;
            }
        });
        return this;
    }

    // A fiber ended. Its end time is set and its parent (if any) is notified.
    ended(scheduler) {
        console.assert(this.ip === this.ops.length);
        delete this.ip;
        this.endTime = scheduler.now;
        this.parent?.childDidEnd(this, scheduler);
    }

    // When a child fiber ends, remove it from the set of pending children
    // and resume when the set becomes empty. Do nothing if the child is not
    // pending (e.g., the fiber is not actually joining).
    childDidEnd(fiber, scheduler) {
        if (!this.joinDelegate?.pending.has(fiber)) {
            return;
        }
        this.joinDelegate.pending.delete(fiber);
        remove(this.children, fiber);
        this.joinDelegate.childFiberDidEnd?.call(this.joinDelegate, fiber, scheduler);
        if (this.joinDelegate.pending.size === 0) {
            delete this.children;
            delete this.joinDelegate;
            scheduler.resume(this, scheduler.now, true);
        }
    }
}

// Delegate to collect all child fiber values in order.
// FIXME 4F04 Handle errors when joining
export const All = {
    fiberWillJoin(fiber) {
        this.values = new Array(fiber.children.length);
    },

    childFiberDidEnd(child) {
        const fiber = child.parent;
        const index = fiber.children.indexOf(child);
        this.values[index] = child.value;
        if (this.pending.size === 0) {
            child.parent.value = this.values;
            delete this.values;
        }
    }
};

// Delegate to collect all child fiber values in the order in which they
// finished.
// FIXME 4F04 Handle errors when joining
export const Last = {
    fiberWillJoin(fiber) {
        this.values = [];
    },

    childFiberDidEnd(child) {
        const fiber = child.parent;
        this.values.push(child.value);
        if (this.pending.size === 0) {
            child.parent.value = this.values;
            delete this.values;
        }
    }
};

// Delegate to cancel all siblings once the first fiber ends, setting its
// value as the fiber value (unless `useValue` is set to false).
// FIXME 4F04 Handle errors when joining
export const First = (useValue = true) => ({
    childFiberDidEnd(child, scheduler) {
        const siblings = [...this.pending];
        this.pending.clear();
        for (const sibling of siblings) {
            sibling.cancel(scheduler);
        }
        if (useValue) {
            child.parent.value = child.value;
        }
    }
});
