import { notify, on, off, once } from "./events.js";
import { create, del, get, geto } from "./util.js";
import { Broken, Clock } from "./clock.js";
import { Thread } from "./thread.js";
import { Scheduler, Do, Undo, Redo, Error } from "./scheduler.js";
import * as time from "./time.js";

// Unique value for timeouts.
export const Timeout = Symbol.for("timeout");

const proto = {

    // Init a new VM with a clock and scheduler.
    init() {
        this.scheduler = Scheduler();
        this.clock = Clock();
        on(this.clock, "update", this);
        this.values = new Map();
        this.spawnID = 0;
    },

    // Start the clock and return self.
    start() {
        this.clock.start();
        return this;
    },

    // Spawn a new thread and schedule it now or at some later time. Return the
    // new thread.
    spawn() {
        return this.spawnAt(this.clock.now);
    },

    spawnAt(t) {
        console.assert(!this.executionMode);
        if (!time.isDefinite(t) || t < this.clock.now) {
            throw Error("Schedule time must be a definite, future time");
        }
        const thread = Thread();
        this.scheduler.scheduleForward(thread, t, 0);
        thread.begin = t;
        thread.spawnID = this.spawnID++;
        return thread;
    },

    // Get the value of a thread at the current time.
    valueOf(thread) {
        return this.scheduler.valueOf(thread);
    },

    // Set keepAlive to true so that the VM does not stop even when idle.
    keepAlive() {
        this._keepAlive = true;
        return this;
    },

    saveProperty(object, property) {
        const properties = get(this.values, object, () => ({}));
        const values = geto(properties, property, () => ([]));
        values.push(object[property]);
    },

    saveAttribute(element, attribute) {
        const attributes = get(this.values, element, () => ({}));
        const values = geto(attributes, attribute, () => ([]));
        values.push(element.getAttribute(attribute));
    },

    restoreProperty(object, property) {
        const values = this.values.get(object)?.[property];
        console.assert(values.length > 0);
        object[property] = values.pop();
    },

    restoreAttribute(element, attribute) {
        const values = this.values.get(element)?.[attribute];
        console.assert(values.length > 0);
        element.setAttribute(attribute, values.pop());
    },

    // Update forward or backward.
    handleEvent({ from, to }) {
        if (from < to) {
            this.updateForward(from, to);
        } else {
            console.assert(from > to);
            this.updateBackward(from, to);
        }
    },

    // Set the state variables for the current schedule item.
    unpackScheduleItem(scheduleItem) {
        this.currentThread = scheduleItem.thread;
        this.t = scheduleItem.t;
        this.pc = scheduleItem.pc;
        this.value = scheduleItem.value;
        this.executionMode = scheduleItem.executionMode ?? Undo;
        return this.currentThread;
    },

    didUpdate() {
        delete this.currentThread;
        delete this.t;
        delete this.pc;
        delete this.value;
        delete this.executionMode;
    },

    // Run updates forward (do/redo).
    updateForward(from, to) {
        if (!this.scheduler.hasFuture) {
            if (!this._keepAlive && this.scheduler.isIdle) {
                this.clock.pause();
            }
            return;
        }
        console.assert(time.cmp(this.scheduler.nextFutureTime, from) >= 0);
        while (this.scheduler.hasFuture && this.scheduler.nextFutureTime < to) {
            if (!this.runForward(this.scheduler.nextFutureItem)) {
                break;
            }
        }
        this.didUpdate();
    },

    // Run a thread forward until the end, or until it yields. `i` is the index
    // (Do or Redo) of the op to actually run.
    runForward(scheduleItem) {
        if (scheduleItem.cancelled) {
            return;
        }

        const thread = this.unpackScheduleItem(scheduleItem);
        const n = thread.ops.length;
        console.assert(this.executionMode !== Undo);

        // Pending asynchronous error.
        if (this.executionMode === Error) {
            const op = thread.ops[(this.pc + n - 1) % n];
            this.error(thread, op, this.value.t, this.value.error, true);
            this.scheduler.scheduleBackward(thread, this.t, this.pc, this.value.error);
            return;
        }

        while (this.pc < n && !this.yielded) {
            let op = thread.ops[this.pc++];
            if (this.executionMode === Do) {
                notify(this, "op", { thread, op, t: this.t });
            }
            try {
                op[this.executionMode](thread, this);
            } catch (error) {
                this.error(thread, op, this.t, error);
                this.scheduler.scheduleBackward(thread, this.t, this.pc, error);
                return;
            }
        }

        if (this.yielded) {
            // The thread was suspended.
            delete this.yielded;
        } else {
            // The thread reached its end.
            this.scheduler.scheduleBackward(thread, this.t, this.pc, this.value);
            if (this.executionMode === Do) {
                notify(this, "op", { thread, t: this.t });
                thread.parent?.childThreadDidEnd(thread, this);
            }
        }

        // End normally.
        return true;
    },

    // Run updates backward (undo).
    updateBackward(from, to) {
        if (!this.scheduler.hasPast) {
            return;
        }
        console.assert(this.scheduler.nextPastTime < from);
        while (this.scheduler.hasPast && this.scheduler.nextPastTime >= to) {
            const scheduleItem = this.scheduler.pastQueue.remove();
            this.unpackScheduleItem(scheduleItem);
            console.assert(this.executionMode === Undo);
            this.runBackward(scheduleItem.thread);
        }
        this.didUpdate();
    },

    // Run a thread backward to the beginning, or until it yields.
    runBackward(thread) {
        while (this.pc > 0 && !this.yielded) {
            const op = thread.ops[--this.pc];
            try {
                op[Undo](thread, this);
            } catch (error) {
                this.error(thread, op, this.t, error);
                this.scheduler.scheduleForward(thread, this.t, this.pc, this.value, Redo);
                return;
            }
        }

        if (this.yielded) {
            delete this.yielded;
        } else {
            console.assert(this.pc === 0);
            this.scheduler.scheduleForward(thread, this.t, this.pc, this.value, Redo);
        }
    },

    // An error occurred when executing `op`.
    error(thread, op, t, error, asynchronous = false) {
        notify(this, "error", { thread, op, t, error, asynchronous: asynchronous && this.t });
        if (error.message) {
            console.error(`Error: ${error.message}`);
        } else {
            console.error("Error", error);
        }
        this.clock.pause(Broken);
        delete this.yielded;
    },

    // Schedule a thread forward in time. If the time is not definite, the
    // thread is simply suspended; in case of unresolved time, it may be
    // rescheduled later.
    delay(thread, t, resolved = false) {
        const scheduleItem = this.scheduler.scheduleForward(thread, t, this.pc, this.value);
        if (scheduleItem) {
            this.yielded = scheduleItem;
            this.scheduler.scheduleBackward(thread, this.t, this.pc - 1, this.value);
            if (resolved) {
                notify(this, "resolve", { thread, t });
            }
            return scheduleItem;
        }
    },

    // Suspend the thread and start listening to a DOM event.
    addEventListener(thread, target, type, options) {
        this.delay(thread, time.unresolved);
        const handler = event => {
            console.assert(thread.currentEventListener);
            target.removeEventListener(type, del(thread, "currentEventListener").handler);
            if (options.preventDefault) {
                event.preventDefault();
            }
            if (options.stopImmediatePropagation) {
                event.stopImmediatePropagation();
            }
            if (options.stopPropagation) {
                event.stopPropagation();
            }
            this.scheduler.wake(thread, this.clock.now, event);
            notify(this, "event", { thread, event });
        };
        target.addEventListener(type, handler);
        thread.currentEventListener = { target, type, handler, dom: true };
    },

    // Suspend the thread and start listening to an internal event.
    receive(thread, target, type) {
        this.delay(thread, time.unresolved);
        thread.currentEventListener = {
            target,
            type,
            handler: once(target, type, event => {
                console.assert(thread.currentEventListener);
                delete thread.currentEventListener;
                this.scheduler.wake(thread, this.clock.now, event);
                notify(this, "receive", { thread, event });
            })
        };
    },

    // Asynchronous function call.
    await(thread, f) {
        const t = this.t;
        f(this.value, this.t - thread.begin).then(value => {
            this.scheduler.wake(thread, this.clock.now, value);
            notify(this, "await", { thread, value });
        }).catch(error => {
            this.scheduler.wake(thread, this.clock.now, { error, t }, Error);
            notify(this, "await", { thread, error });
        });
        this.delay(thread, time.unresolved);
    },

    // Schedule a child thread and give it a spawn ID (used to maintain the
    // execution order of children).
    spawnChild(thread, value) {
        thread.begin = this.t;
        thread.spawnID = this.spawnID++;
        this.scheduler.scheduleForward(thread, this.t, 0, value);
    },

    // When all children have join the end time of the join is resolved.
    childThreadsDidJoin(thread, value) {
        this.scheduler.wake(thread, this.t, value);
        notify(this, "resolve", { thread, t: this.t });
    },

    // Cancel a thread and its children (if any).
    cancel(thread) {
        this.scheduler.cancel(thread);
        notify(this, "cancel", { thread, t: this.t });
        if (thread.currentEventListener) {
            const { target, type, handler, dom } = del(thread, "currentEventListener");
            if (dom) {
                target.removeEventListener(type, handler);
            } else {
                off(target, type, handler);
            }
        }
        if (thread.cancellable) {
            for (const child of thread.cancellable.values()) {
                this.cancel(child);
            }
        }
    },

    // Yield and let the scheduler pick up the next scheduled time for the
    // thread forward (redo) or backward (undo).
    yield(thread) {
        console.assert(this.executionMode !== Do);
        this.yielded = this.executionMode === Undo ?
            this.scheduler.scheduleForward(thread, this.t, this.pc + 1, this.value, Redo) :
            this.scheduler.scheduleBackward(thread, this.t, this.pc - 1, this.value, Undo);
    },

    // Halt the current thread by skipping to the end of its ops list.
    haltCurrentThread() {
        this.pc = this.currentThread.ops.length;
    },
};

export const VM = () => create().call(proto);
