import { on, off } from "./util.js";

let k = 0;

const AsyncFunction = (async function() {}).constructor;
const isAsync = f => f.constructor === AsyncFunction;

export default class Fiber {
    constructor(parent) {
        this.parent = parent;
        this.id = k++;
        this.ops = [];
    }

    reset(t) {
        this.result = { value: this.parent?.value };
        this.ip = 0;
        this.beginTime = t;
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

    exec(f) {
        this.ops.push(isAsync(f) ? scheduler => {
            if (this.result.error) {
                return;
            }
            f(this, scheduler).
                then(value => { this.value = value; }).
                catch(error => { this.result.error = error; }).
                finally(() => { scheduler.resume(this); });
            scheduler.yield();
        } : scheduler => {
            if (this.result.error) {
                return;
            }
            try {
                this.value = f(this, scheduler);
            } catch (error) {
                this.result.error = error;
            }
        });
        return this;
    }

    effect(f) {
        this.ops.push(isAsync(f) ? scheduler => {
            if (this.result.error) {
                return;
            }
            f(this, scheduler).
                catch(error => { this.result.error = error; }).
                finally(() => { scheduler.resume(this); });
            scheduler.yield();
        } : scheduler => {
            if (this.result.error) {
                return;
            }
            try {
                f(this, scheduler);
            } catch (error) {
                this.result.error = error;
            }
        });
        return this;
    }

    either(f) {
        this.ops.push(isAsync(f) ? scheduler => {
            f(this, scheduler).
                then(value => { this.value = value; }).
                catch(error => { this.result.error = error; }).
                finally(() => { scheduler.resume(this); });
            scheduler.yield();
        } : scheduler => {
            try {
                this.value = f(this, scheduler);
            } catch (error) {
                this.result.error = error;
            }
        });
        return this;
    }

    event(target, type, delegate = {}) {
        this.ops.push(scheduler => {
            console.assert(!this.eventDelegate);
            if (this.result.error) {
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
                    scheduler.resume(this);
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
                    scheduler.resume(this);
                };
            }
            scheduler.yield();
        });
        return this;
    }

    repeat(f, delegate = {}) {
        this.ops.push(() => {
            if (this.error) {
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
            if (this.error ||
                this.repeatDelegate.repeatShouldEnd?.call(delegate, this.repeatDelegate.count, this, scheduler)) {
                this.ip = end;
            }
            this.repeatDelegate.iterationTime = scheduler.now;
        });
        f(this);
        this.ops.push(scheduler => {
            if (!this.repeatDelegate.repeatShouldEnd && scheduler.now === this.repeatDelegate.iterationTime) {
                this.result.error = new Error("Zero duration repeat");
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

    // Wait for `dur`ms, unless the fiber is failing. If dur is a function,
    // call it with `fiber` and `scheduler` as arguments and use the return
    // value as the delay duration. There is no effect if dur is not a number
    // greater than zero. The value of the fiber is not affected by the delay.
    delay(dur) {
        this.ops.push(scheduler => {
            if (this.error) {
                return;
            }
            if (typeof dur === "function") {
                try {
                    dur = dur(this, scheduler);
                } catch (error) {
                    this.result.error = error;
                    return;
                }
            }
            if (!(dur > 0)) {
                return;
            }
            scheduler.yield();
            scheduler.resume(this, scheduler.now + dur);
        });
        return this;
    }

    // Spawn a new fiber. The new fiber is created immediately as a child of
    // this fiber and returned, unless a function is passed as the first
    // argument, in which case that function is called with the child fiber
    // as its only argument and the current fiber is returned. The child fiber
    // will then begin after the parent fiber yields, in the same instant.
    spawn(f) {
        const child = new Fiber(this);
        this.ops.push(scheduler => {
            if (!this.error) {
                if (!this.children) {
                    this.children = [];
                }
                this.children.push(child);
                scheduler.resume(child);
            }
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
            if (this.error) {
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
                scheduler.yield();
            }
        });
        return this;
    }

    // A fiber ended. Its end time is set and its parent (if any) is notified.
    ended(scheduler) {
        console.assert(this.ip === this.ops.length);
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
        this.joinDelegate?.childFiberDidEnd?.call(this.joinDelegate, fiber, scheduler);
        if (this.joinDelegate.pending.size === 0) {
            delete this.children;
            delete this.joinDelegate;
            scheduler.resume(this);
        }
    }
}

// Delegate to collect all child fiber values in order.
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
