import { isAsync, on, off, parseOffsetValue, typeOf } from "./util.js";

export default class Fiber {
    #name;
    static #count = 0;
    static Cancelled = Symbol.for("cancelled");

    constructor() {
        this.id = Fiber.#count++;
        this.ops = [];
    }

    // Get the name of this fiber, if any.
    get name() {
        return this.#name;
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

    // True when the fiber is cancelled.
    get isCancelled() {
        return this.error === Fiber.Cancelled;
    }

    // Set the error field of the result and report it to the console.
    #errorWithMessage(error) {
        this.result.error = error;
        console.error(error.message ?? error);
    }

    // Convenience method to add new ops to the fiber, returning it for
    // chaining.
    #op(op) {
        this.ops.push(op);
        return this;
    }

    // Get the effective duration of a delay or a ramp, which could be a
    // number, a string, or a function returning a number or a string.
    // Return nothing in case of error.
    #getEffectiveDuration(dur, scheduler) {
        if (typeof dur === "function") {
            try {
                dur = dur(this, scheduler);
            } catch (error) {
                this.#errorWithMessage(error);
                return;
            }
        }
        return typeof dur === "string" ? parseOffsetValue(dur) : dur;
    }

    // Evaluate a function given as argument with the fiber and scheduler,
    // or return the value as is.
    #getEffectiveParameter(param, scheduler) {
        if (typeof param !== "function") {
            return param;
        }
        try {
            return param(this, scheduler);
        } catch (error) {
            this.#errorWithMessage(error);
        }
    }

    // Call the function f with this fiber as a first parameter, passing all
    // other additional parameters if needed.
    macro(f, ...args) {
        f(this, ...args);
        return this;
    }

    // Set the name of the fiber so that it can be retrieved from the scheduler
    // map of active fibers. It is an error to name the fiber with the same
    // name as another running fiber.
    named(name) {
        return this.#op(function(scheduler) {
            if (!this.handleResult || name === this.#name) {
                return;
            }
            try {
                scheduler.setNameForFiber(this, name);
                this.#name = name;
                this.id += ":" + name.toString();
            } catch (error) {
                this.#errorWithMessage(error);
            }
        });
    }

    // Store the current value of the fiber under the given name in its scope.
    store(name) {
        return this.#op(function(scheduler) {
            this.scope[this.#getEffectiveParameter(name, scheduler)] = this.value;
        });
    }

    // Call a function with this and the scheduler as parameters, and set the
    // value of the fiber to the return value of that function. If the function
    // is explicitly marked as being asynchronous, yield and resume once the
    // function returns.
    // FIXME 4I04 Cancelling async exec/effect
    exec(f) {
        return this.#op(isAsync(f) ? function(scheduler) {
            if (!this.handleResult) {
                return;
            }
            f(this, scheduler).
                then(value => {
                    if (this.handleResult) {
                        this.value = value;
                        scheduler.resumeFiber(this, scheduler.clock.now);
                    }
                }).
                catch(error => {
                    if (this.handleResult) {
                        this.#errorWithMessage(error);
                        scheduler.resumeFiber(this, scheduler.clock.now);
                    }
                });
            this.yielded = true;
        } : function(scheduler) {
            if (!this.handleResult) {
                return;
            }
            try {
                this.value = f(this, scheduler);
            } catch (error) {
                this.#errorWithMessage(error);
            }
        });
    }

    // FIXME 4I04 Cancelling async exec/effect
    effect(f) {
        return this.#op(isAsync(f) ? function(scheduler) {
            if (!this.handleResult) {
                return;
            }
            f(this, scheduler).
                catch(error => { this.#errorWithMessage(error); }).
                finally(() => {
                    if (this.handleResult) {
                        scheduler.resumeFiber(this, scheduler.clock.now);
                    }
                });
            scheduler.yield();
        } : function(scheduler) {
            if (!this.handleResult) {
                return;
            }
            try {
                f(this, scheduler);
            } catch (error) {
                this.#errorWithMessage(error);
            }
        });
    }

    // Add an event listener and yield until the event occurs. Target and type
    // may be functions that get evaluated with fiber and scheduler as
    // parameters, and describe the target and the type of the event. By
    // default, the fiber value is not affected. Target may be a DOM element,
    // where `addEventListener` is used; otherwise, event expects a synchronous
    // message and uses `on` for the event listener itself.
    // When the event is received, the following delegate methods are called:
    // * `eventShouldBeIgnored` allows ignoring an event (i.e., the fiber stays
    //   suspended until an event is received and not ignore).
    // * `eventWasHandled` allows calling functions like `preventDefault`
    //   before the fiber resumes.
    event(target, type, delegate = {}) {
        return this.#op(function(scheduler) {
            console.assert(!this.eventDelegate);
            if (!this.handleResult) {
                return;
            }
            const effectiveTarget = this.#getEffectiveParameter(target, scheduler);
            const effectiveType = this.#getEffectiveParameter(type, scheduler);
            if (!effectiveTarget || !effectiveType) {
                return;
            }
            this.eventDelegate = Object.assign(Object.create(delegate), { target: effectiveTarget, type: effectiveType });
            if (effectiveTarget.addEventListener) {
                effectiveTarget.addEventListener(effectiveType, this.eventDelegate);
                this.eventDelegate.handleEvent = event => {
                    if (this.rate === 0 ||
                        this.eventDelegate.eventShouldBeIgnored?.call(delegate, event, this, scheduler)) {
                        return;
                    }
                    effectiveTarget.removeEventListener(effectiveType, this.eventDelegate);
                    this.eventDelegate.eventWasHandled?.call(delegate, event, this, scheduler);
                    delete this.eventDelegate;
                    scheduler.resumeFiber(this, scheduler.clock.now);
                };
            } else {
                on(effectiveTarget, effectiveType, this.eventDelegate);
                this.eventDelegate.handleMessage = message => {
                    if (this.rate === 0 ||
                        this.eventDelegate.eventShouldBeIgnored?.call(delegate, message, this, scheduler)) {
                        return;
                    }
                    off(effectiveTarget, effectiveType, this.eventDelegate);
                    this.eventDelegate.eventWasHandled?.call(delegate, message, this, scheduler);
                    delete this.eventDelegate;
                    scheduler.resumeFiber(this, scheduler.clock.now);
                };
            }
            this.yielded = true;
        });
    }

    // Normally fiber execution skips over errors, but either allows handling
    // them by providing a path for values (f) and a path for errors (g). When
    // the second path is omitted, both errors and values are handled; the
    // fiber has an error if it is failing, and no error otherwise.
    either(f, g) {
        if (g) {
            this.ops.push(function(scheduler) {
                this.handleValue.push(true);
                this.handleError.push(false);
            });
            f(this);
            this.ops.push(function(scheduler) {
                const m = this.handleValue.length - 1;
                console.assert(this.handleValue[m]);
                this.handleValue[m] = false;
                const n = this.handleError.length - 1;
                console.assert(!this.handleError[n]);
                this.handleError[n] = true;
            });
            g(this);
            this.ops.push(function(scheduler) {
                console.assert(!this.handleValue.at(-1));
                console.assert(this.handleError.at(-1));
                this.handleValue.pop();
                this.handleError.pop();
            });
        } else {
            this.ops.push(function() { this.handleError.push(true); });
            f(this);
            this.ops.push(function() { this.handleError.pop(); });
        }
        return this;
    }

    // Spawn a single fiber executing f repeatedly. The delegate object allows
    // controlling when the loop ends by being called before a new iteration
    // is about to begin with the current iteration count (starting at 0 so
    // that the whole repetition can be skipped altogether). Zero-duration
    // repeats without a delegate cause an error to avoid infinite loops.
    // The body of the loop runs as its own fiber.
    repeat(f, delegate = {}) {
        const body = new Fiber().
            #op(function() {
                // FIXME 4F01 Delegates should be instantiated
                this.repeatDelegate = Object.create(delegate);
                this.repeatDelegate.count = 0;
            }).
            #op(function(scheduler) {
                if (!this.handleResult ||
                    this.repeatDelegate.repeatShouldEnd?.call(delegate, this.repeatDelegate.count, this, scheduler)) {
                    this.ip = this.ops.length - 1;
                }
                this.repeatDelegate.iterationTime = scheduler.now;
            }).
            macro(f).
            #op(function(scheduler) {
                if (!this.repeatDelegate.repeatShouldEnd && scheduler.now === this.repeatDelegate.iterationTime) {
                    this.#errorWithMessage(Error("Zero duration repeat"));
                } else {
                    this.repeatDelegate.count += 1;
                    this.ip = 1;
                }
            }).
            #op(function(scheduler) {
                if (this.result) {
                    if (this.error) {
                        this.parent.result.error = this.error;
                    } else {
                        this.parent.value = this.value;
                    }
                }
                delete this.repeatDelegate;
                delete this.parent.child;
                scheduler.resumeFiber(this.parent);
            });
        return this.#op(function(scheduler) {
            if (!this.handleResult) {
                return;
            }
            this.child = new Fiber();
            this.child.ops = body.ops;
            this.child.parent = this;
            scheduler.resetFiber(this.child);
            scheduler.resumeFiber(this.child);
            this.yielded = true;
        });
    }

    // Repeat f over the values of the fiber.
    each(f) {
        const values = fiber => {
            if (fiber.error) {
                return [fiber.error];
            }
            const type = typeOf(fiber.value);
            return type === "array" ? fiber.value :
                type === "set" ? [...fiber.value.values()] :
                type === "map" ? [...fiber.value.entries()] :
                type === "object" ? [...Object.entries(fiber.value)] : [fiber.value];
        };
        return this.repeat(f, {
            repeatShouldEnd(i, fiber) {
                if (i === 0) {
                    this.values = values(fiber);
                }
                if (i < this.values.length) {
                    if (fiber.parent.error) {
                        fiber.result.error = this.values[i];
                    } else {
                        fiber.value = this.values[i];
                    }
                } else {
                    delete fiber.result;
                    return true;
                }
            }
        }, {});
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
            this.ops.push(function(scheduler) {
                if (!this.handleResult) {
                    return;
                }
                const effectiveDur = this.#getEffectiveDuration(dur, scheduler);
                if (typeof effectiveDur === "number" && effectiveDur > 0) {
                    scheduler.beginRamp(this, effectiveDur, delegate);
                }
            });
            this.ops.push(function(scheduler) { scheduler.endRamp(this); });
        } else {
            const effectiveDur = typeof dur === "string" ? parseOffsetValue(dur) : dur;
            if (typeof dur === "number" && dur > 0) {
                this.ops.push(function(scheduler) {
                    scheduler.beginRamp(this, effectiveDur, delegate);
                });
                this.ops.push(function(scheduler) {
                    scheduler.endRamp(this);
                });
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
        return this.#op(function(scheduler) {
            if (!this.handleResult) {
                return;
            }
            const effectiveDur = this.#getEffectiveDuration(dur, scheduler);
            if (typeof effectiveDur === "number" && effectiveDur > 0) {
                scheduler.setDelayForFiber(this, effectiveDur);
            }
        });
    }

    // Spawn a new fiber. The new fiber is created immediately as a child of
    // this fiber and returned, unless a function is passed as the first
    // argument, in which case that function is called with the child fiber
    // as its only argument and the current fiber is returned. The child fiber
    // will then begin after the parent fiber yields, in the same instant.
    spawn(f) {
        const child = new Fiber();
        this.ops.push(function(scheduler) {
            if (this.handleResult) {
                scheduler.attachFiber(this, child);
            }
        });
        if (typeof f === "function") {
            f(child);
            return this;
        }
        return child;
    }

    // Map spawns a new fiber for each item in the fiber value.
    map(f) {
        const template = new Fiber();
        f(template);
        return this.#op(function(scheduler) {
            if (!this.handleResult) {
                return;
            }
            const type = this.error ? "error" : typeOf(this.value);
            const values =
                type === "set" ? this.value.values() :
                type === "map" ? this.value.entries() :
                type === "object" ? Object.entries(this.value) : this.value;
            if (type === "array" || type === "set" || type === "map" || type === "object") {
                for (const value of values) {
                    const child = scheduler.attachFiber(this);
                    child.ops = template.ops;
                    child.result = { value };
                }
            } else {
                scheduler.attachFiber(this, template);
            }
        });
    }

    // Yield and wait for child fibers to end. If there are no child fibers,
    // or the fiber is failing, do nothing.
    join(delegate = {}) {
        return this.#op(function(scheduler) {
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
                // FIXME 4J0E Force join
                if (this.children.length === 0) {
                    delete this.joinDelegate;
                } else {
                    this.yielded = true;
                }
            }
        });
    }
}

// Convenience join delegate function to cancel all remaining siblings of a
// fiber that ended.
export function cancelSiblings(delegate, scheduler) {
    const siblings = [...delegate.pending];
    delegate.pending.clear();
    for (const sibling of siblings) {
        scheduler.cancelFiber(sibling);
    }
}

// Delegate to collect all child fiber values in order. Fails immediately with
// the error of a child fiber that fails.
export const All = {
    fiberWillJoin(fiber) {
        this.values = new Array(fiber.children.length).fill();
    },

    childFiberDidEnd(child, scheduler) {
        const fiber = child.parent;
        if (child.error) {
            cancelSiblings(this, scheduler);
            fiber.result.error = child.error;
            delete this.values;
        } else {
            this.values[fiber.children.indexOf(child)] = child.value;
            if (this.pending.size === 0) {
                fiber.value = this.values;
            }
        }
    }
};

// Delegate to collect all child fiber values in the order in which they
// finished. Fails immediately with the error of a child fiber that fails.
export const Last = {
    fiberWillJoin(fiber) {
        this.values = [];
    },

    childFiberDidEnd(child, scheduler) {
        const fiber = child.parent;
        if (child.error) {
            cancelSiblings(this, scheduler);
            fiber.result.error = child.error;
            delete this.values;
        } else {
            this.values.push(child.value);
            if (this.pending.size === 0) {
                child.parent.value = this.values;
            }
        }
    }
};

// Delegate to cancel all siblings once the first fiber ends. Skip errors,
// unless all fibers do fail in which case the last error is reported.
export const Gate = {
    childFiberDidEnd(child, scheduler) {
        if (child.error) {
            if (this.pending.size === 0) {
                child.parent.result.error = child.error;
            }
        } else {
            cancelSiblings(this, scheduler);
            return true;
        }
    }
};

// Same as Gate, but also sets the value of the fiber to the value of the first
// fiber that ended with a value.
export const First = {
    childFiberDidEnd(child, scheduler) {
        if (Gate.childFiberDidEnd.call(this, child, scheduler)) {
            child.parent.value = child.value;
        }
    }
};

// Join a single fiber and use its eventual error or value.
export const Single = {
    childFiberDidEnd(child, scheduler) {
        console.assert(this.pending.size === 0);
        const fiber = child.parent;
        if (child.error) {
            fiber.result.error = child.error;
        } else {
            fiber.value = child.value;
        }
    }
}
