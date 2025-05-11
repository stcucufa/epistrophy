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
        this.result = { value: this.parent?.pendingValue };
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

    event(target, type, delegate) {
        this.ops.push(scheduler => {
            console.assert(!this.currentEvent);
            if (this.result.error) {
                return;
            }
            this.currentEvent = {
                target,
                type,
                handler: event => {
                    if (delegate?.eventShouldBeIgnored?.call(delegate, event, this, scheduler)) {
                        return;
                    }
                    target.removeEventListener(type, this.currentEvent.handler);
                    delete this.currentEvent;
                    delegate?.eventWasHandled?.call(delegate, event, this, scheduler);
                    scheduler.resume(this);
                }
            };
            target.addEventListener(type, this.currentEvent.handler);
            scheduler.yield();
        });
        return this;
    }

    repeat(f, delegate = {}) {
        this.ops.push(() => {
            const repeatDelegate = Object.create(delegate);
            if (this.repeatDelegate) {
                repeatDelegate.parent = this.repeatDelegate;
            }
            this.repeatDelegate = repeatDelegate;
            this.repeatDelegate.count = 0;
        });
        const begin = this.ops.length;
        this.ops.push(scheduler => {
            if (this.repeatDelegate.repeatShouldEnd?.call(delegate, this.repeatDelegate.count, this, scheduler)) {
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
}
