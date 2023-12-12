import { notify, on } from "./events.js";
import { create, del, get, geto } from "./util.js";
import { Clock } from "./clock.js";
import { Thread } from "./thread.js";
import { Scheduler, Do, Undo, Redo } from "./scheduler.js";
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
        this.t = scheduleItem.t;
        this.pc = scheduleItem.pc;
        this.value = scheduleItem.value;
        this.executionMode = scheduleItem.executionMode ?? Undo;
    },

    // Run updates forward (do/redo).
    updateForward(from, to) {
        if (!this.scheduler.hasFuture) {
            return;
        }
        console.assert(time.cmp(this.scheduler.nextFutureTime, from) >= 0);
        while (this.scheduler.hasFuture && this.scheduler.nextFutureTime < to) {
            this.runForward(this.scheduler.nextFutureItem);
        }
    },

    // Run a thread forward until the end, or until it yields. `i` is the index
    // (Do or Redo) of the op to actually run.
    runForward(scheduleItem) {
        const thread = scheduleItem.thread;
        const n = thread.ops.length;
        this.unpackScheduleItem(scheduleItem);
        console.assert(this.executionMode !== Undo);
        while (this.pc < n && !this.yielded) {
            const op = thread.ops[this.pc++];
            if (this.executionMode === Do) {
                notify(this, "op", { thread, op, t: this.t });
            }
            try {
                op[this.executionMode](thread, this);
            } catch (error) {
                console.warn(error.message ?? "Error", error);
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
    },

    // Run a thread backward to the beginning, or until it yields.
    runBackward(thread) {
        while (this.pc > 0 && !this.yielded) {
            const op = thread.ops[--this.pc];
            try {
                op[Undo](thread, this);
            } catch (error) {
                console.warn(error.message ?? "Error", error);
            }
        }

        if (this.yielded) {
            delete this.yielded;
        } else {
            console.assert(this.pc === 0);
            this.scheduler.scheduleForward(thread, this.t, this.pc, this.value, Redo);
        }
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

    // Suspend the thread and start listening to the event.
    listen(thread, target, type, options) {
        thread.currentEventListener = event => {
            target.removeEventListener(type, del(thread, "currentEventListener"));
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
        this.delay(thread, time.unresolved);
        target.addEventListener(type, thread.currentEventListener);
    },

    // Asynchronous function call.
    await(thread, f) {
        f(this.value, this.t).then(value => {
            this.scheduler.wake(thread, this.clock.now, value);
            notify(this, "await", { thread, value });
        });
        this.delay(thread, time.unresolved);
    },

    // Spawning and joining child threads
    spawnChild(thread, value) {
        thread.begin = this.t;
        thread.spawnID = this.spawnID++;
        this.scheduler.scheduleForward(thread, this.t, 0, value);
    },

    childThreadsDidJoin(thread, value) {
        this.scheduler.wake(thread, this.t, value);
        notify(this, "resolve", { thread, t: this.t });
    },

    // Yield and let the scheduler pick up the next scheduled time for the
    // thread forward (redo) or backward (undo).
    yield(thread) {
        console.assert(this.executionMode !== Do);
        this.yielded = this.executionMode === Undo ?
            this.scheduler.scheduleForward(thread, this.t, this.pc + 1, this.value, Redo) :
            this.scheduler.scheduleBackward(thread, this.t, this.pc - 1, this.value, Undo);
    },
};

export const VM = () => create().call(proto);
