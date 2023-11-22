import { notify, off, on } from "./events.js";
import { add, create, everyof, foldit, nop } from "./util.js";
import { Clock } from "./clock.js";
import { Thread, spawn } from "./thread.js";
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
        this.listeners = new Set();
    },

    // Start the clock and return self.
    start() {
        this.clock.start();
        return this;
    },

    // Stop completely, clearing remaining event listeners.
    shutdown() {
        off(this.clock, "update", this);
        this.clock.stop();
        delete this.clock;
        delete this.scheduler;
        for (const [item, handler] of this.listeners) {
            item.target.removeEventListener(item.type, handler);
        }
        delete this.listeners;
        delete this.inputs;
    },

    // Spawn a new thread and schedule it now or at some later time.
    spawn() {
        return this.spawnAt(this.clock.now);
    },

    spawnAt(t) {
        if (!time.isDefinite(t) || t < this.clock.now) {
            throw Error("Schedule time must be a definite, future time");
        }
        return this.scheduler.scheduleForward(Thread(), t, 0);
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
        console.assert(this.scheduler.nextFutureTime >= from);
        this.forward = true;
        while (this.scheduler.hasFuture && this.scheduler.nextFutureTime < to) {
            const scheduleItem = this.scheduler.nextFutureThread;
            if (scheduleItem.rescheduled) {
                continue;
            }
            this.t = scheduleItem.t;
            this.pc = scheduleItem.pc;
            this.value = scheduleItem.value;
            this.executionMode = scheduleItem.executionMode;
            this.runForward(scheduleItem.thread);
        }
        delete this.forward;
    },

    // Run a thread forward until the end, or until it yields. `i` is the index
    // (Do or Redo) of the op to actually run.
    runForward(thread) {
        if (thread.cancelled) {
            return;
        }

        const n = thread.ops.length;
        const childThreads = [];
        while (this.pc < n && !this.yielded) {
            const op = thread.ops[this.pc++];
            if (Array.isArray(op)) {
                try {
                    op[this.executionMode](thread, this);
                } catch (error) {
                    console.warn(error.message ?? "Error", error);
                }
            } else if (this.executionMode === Do) {
                const childThread = spawn(thread, op, this.t);
                thread.childThreads.add(childThread);
                childThreads.push(childThread);
                thread.parState.children.add(childThread);
            }
        }

        if (this.yielded) {
            // The thread was suspended.
            delete this.yielded;
        } else {
            // The thread reached its end.
            console.assert(this.pc === thread.ops.length);
            thread.effectiveEnd = this.t;
            thread.ended = true;
            if (!(n === 1 && thread.ops[0].length === 1)) {
                // Timeout threads have only one execution mode per op (i.e.,
                // no Undo or Redo) and should not be scheduled backward.
                this.scheduler.scheduleBackward(thread, this.t, this.pc, this.value);
            }
        }

        // Spawn child threads.
        const input = this.value;
        for (const childThread of childThreads) {
            this.pc = 0;
            this.value = input;
            this.runForward(childThread, Do);
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
        this.yielded = true;
        // Keep track of the position at which the thread was suspended.
        thread.suspended = this.pc;
        if (time.isDefinite(t)) {
            this.scheduler.scheduleForward(thread, t, this.pc, this.value);
        }
        this.scheduler.scheduleBackward(thread, this.t, this.pc - 1, this.value);
    },

    // Cutoff a thread after a duration, cancelling all subthreads in the
    // [from, to] range of ops.
    cutoff(thread, dur, from, to) {
        this.scheduler.scheduleForward(Object.assign(Thread(), {
            ops: [[(_, vm) => {
                if (this.scheduler.didReschedule(thread, vm.t, to, vm.valueOf(thread))) {
                    for (let i = from; i < to; ++i) {
                        thread.ops[i].cancel?.();
                    }
                }
            }]]
        }), this.t + dur, 0);
    },

    // Wake a suspended thread.
    wake(thread, t, value) {
        this.scheduler.wake(thread, t, value);
    },

    // Schedule a thread to wait for an event to occur. A notification is sent.
    listen(thread, item, dur) {
        this.schedule(thread, time.unresolved);
        const begin = this.t;
        const end = time.add(begin, dur);
        const pc = this.pc;
        const handler = event => {
            const now = this.clock.now;
            if (time.cmp(now, end) <= 0) {
                item.target.removeEventListener(item.type, handler);
                this.listeners.delete(listener);
                thread.listeners.delete(listener);
                if (item.modifiers?.preventDefault) {
                    event.preventDefault();
                }
                if (item.modifiers?.stopImmediatePropagation) {
                    event.stopImmediatePropagation();
                }
                if (item.modifiers?.stopPropagation) {
                    event.stopPropagation();
                }
                this.wake(thread, time.isResolved(end) ? end : now, event);
            }
            notify(this, "event", { thread, event });
        };
        const listener = add(this.listeners, [item, handler]);
        thread.listeners.add(listener);
        if (time.isDefinite(end)) {
            // Set a timeout thread
            const timeout = Object.assign(Thread(), {
                order: thread.item.order + 0.5,
                begin,
                end,
                ops: [[() => {
                    if (this.executionMode === Do) {
                        item.target.removeEventListener(item.type, handler);
                        this.listeners.delete(listener);
                        thread.listeners.delete(listener);
                        this.value = Timeout;
                        this.scheduler.scheduleForward(thread, end, pc, this.value);
                    }
                }]]
            });
            this.scheduler.scheduleForward(timeout, end, 0, this.value);
        }
        item.target.addEventListener(item.type, handler);
    },

    // Cancel a thread and its event listeners.
    cancelThread(thread) {
        if (!thread.ended) {
            thread.cancelled = true;
            for (const listener of thread.listeners) {
                const [item, handler] = listener;
                item.target.removeEventListener(item.type, handler);
                this.listeners.delete(listener);
            }
            for (const childThread of thread.childThreads) {
                this.cancelThread(childThread);
            }
        }
    },

    // Schedule a thread to wait for a promise to be resolved. A notification
    // is sent on resolution.
    then(thread, promise) {
        this.schedule(thread, time.unresolved);
        const t = this.t;
        const pc = this.pc;
        if (typeof promise?.then !== "function") {
            throw Error("invalid value for await (not a thenable)", { promise });
        }
        let done = false;
        if (time.isDefinite(thread.end)) {
            // Set a timeout thread
            const timeout = Object.assign(Thread(), {
                order: thread.item.order + 0.5,
                begin: t,
                end: thread.end,
                ops: [[() => {
                    if (!done) {
                        done = true;
                        this.value = Timeout;
                        this.scheduler.scheduleForward(thread, thread.end, pc, this.value);
                    }
                }]]
            });
            this.scheduler.scheduleForward(timeout, thread.end, 0, this.value);
        }
        promise.then(value => {
            const now = this.clock.now;
            if (!done && time.cmp(now, thread.end) <= 0) {
                done = true;
                this.wake(thread, time.isResolved(thread.end) ? thread.end : now, value);
            }
            notify(this, "promise", { thread, value });
        });
    },

    // Yield a thread forward or backward (for redo/undo).
    yield(thread) {
        this.yielded = true;
        if (this.forward) {
            this.scheduler.scheduleBackward(thread, this.t, this.pc - 1, this.value);
        } else {
            this.scheduler.scheduleForward(thread, this.t, this.pc + 1, this.value, Redo);
        }
    },
};

export const VM = () => create().call(proto);
