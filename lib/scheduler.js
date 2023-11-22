import { create, extend } from "./util.js";
import { Queue } from "./priority-queue.js";
import * as time from "./time.js";

// Ops have three behaviours depending on whether we are in do, undo or redo
// execution mode.
export const [Do, Undo, Redo] = [0, 1, 2];

const proto = {
    init() {
        this.futureQueue = Queue((a, b) => time.cmp(a.t, b.t));
        this.pastQueue = Queue((a, b) => time.cmp(b.t, a.t));
        this.schedule = new Map();
    },

    valueOf(thread) {
        // FIXME 2907 Find an item in a queue (this could be more efficient).
        const past = this.pastQueue.filter(it => it.thread === thread);
        return past.sort((a, b) => time.cmp(b.t, a.t) || (b.pc - a.pc))[0]?.value;
    },

    get hasFuture() {
        return this.futureQueue.length > 0;
    },

    get nextFutureTime() {
        return this.futureQueue[0].t;
    },

    get nextFutureThread() {
        const scheduleItem = this.futureQueue.remove();
        if (scheduleItem.executionMode === Do) {
            const key = scheduleItem.thread;
            console.assert(this.schedule.get(key) === scheduleItem);
            this.schedule.delete(key);
        }
        return scheduleItem;
    },

    scheduleForward(thread, t, pc, value, executionMode = Do) {
        if (time.isDefinite(t)) {
            if (time.cmp(t, thread.end) <= 0) {
                const item = this.futureQueue.insert({ thread, t, pc, value, executionMode });
                if (executionMode === Do) {
                    this.schedule.set(thread, item);
                }
            }
        }
        return thread;
    },

    // Wake a thread at time t unless it is already scheduled.
    wake(thread, t, value) {
        console.assert(thread.suspended >= 0);
        if (this.schedule.has(thread)) {
            const scheduled = this.schedule.get(thread);
            console.assert(scheduled.t === t);
            console.assert(scheduled.pc === thread.suspended);
        } else {
            this.scheduleForward(thread, t, del(thread, "suspended"), value);
        }
    },

    // Attempt to reschedule a thread if it is scheduled for a later time.
    didReschedule(thread, t, pc, value) {
        if (this.schedule.has(thread)) {
            const scheduled = this.schedule.get(thread);
            if (scheduled.t > t) {
                this.schedule.delete(thread);
                scheduled.rescheduled = true;
            } else {
                return false;
            }
        }
        delete thread.suspended;
        this.scheduleForward(thread, t, pc, value);
        return true;
    },

    get hasPast() {
        return this.pastQueue.length > 0;
    },

    get nextPastTime() {
        return this.pastQueue[0].t;
    },

    scheduleBackward(thread, t, pc, value) {
        console.assert(time.isDefinite(t));
        return this.pastQueue.insert({ thread, t, pc, value });
    }
};

export const Scheduler = () => create().call(proto);
