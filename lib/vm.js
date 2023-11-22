import { notify, off, on } from "./events.js";
import { add, create, everyof, foldit, nop } from "./util.js";
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
        if (!time.isDefinite(t) || t < this.clock.now) {
            throw Error("Schedule time must be a definite, future time");
        }
        const thread = Thread();
        this.scheduler.scheduleForward(thread, t, 0);
        return thread;
    },

    // Get the value of a thread at the current time.
    valueOf(thread) {
        return this.scheduler.valueOf(thread);
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

        this.t = scheduleItem.t;
        this.pc = scheduleItem.pc;
        this.value = scheduleItem.value;
        this.executionMode = scheduleItem.executionMode;
        this.spawns = [];

        while (this.pc < n && !this.yielded) {
            const op = thread.ops[this.pc++];
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
            
        }

        if (this.spawns.length > 0) {
            const value = this.value;
            for (const spawn of this.spawns) {
                this.runForward(spawn);
            }
        }
    },

    join() {
        thread.spawns = this.spawns;
        thread.values = [];
        for (const spawn of this.spawns) {
            spawn.parent = thread;
        }
        this.scheduleForward(thread, null);
    },

    // Run updates backward (undo).
    updateBackward(from, to) {
        if (!this.scheduler.hasPast) {
            return;
        }
        console.assert(this.scheduler.nextPastTime < from);
        while (this.scheduler.hasPast && this.scheduler.nextPastTime >= to) {
            const scheduleItem = this.scheduler.pastQueue.remove();
            this.t = scheduleItem.t;
            this.pc = scheduleItem.pc;
            this.value = scheduleItem.value;
            this.runBackward(scheduleItem.thread);
        }
    },

    // Run a thread backward to the beginning, or until it yields.
    runBackward(thread) {
        while (this.pc > 0 && !this.yielded) {
            const op = thread.ops[--this.pc];
            if (Array.isArray(op)) {
                try {
                    op[Undo](thread, this);
                } catch (error) {
                    console.warn(error.message ?? "Error", error);
                }
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
    scheduleForward(thread, t) {
        const scheduleItem = this.scheduler.scheduleForward(thread, t, this.pc, this.value);
        if (scheduleItem) {
            this.yielded = scheduleItem;
            scheduleItem.pc = this.pc;
            this.scheduler.scheduleBackward(thread, this.t, this.pc - 1, this.value);
            return scheduleItem;
        }
    },
};

export const VM = () => create().call(proto);
