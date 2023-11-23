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

    get nextFutureItem() {
        return this.futureQueue.remove();
    },

    scheduleForward(thread, t, pc, value, executionMode = Do) {
        if (time.isDefinite(t) || time.isUnresolved(t)) {
            return this.futureQueue.insert({ thread, t, pc, value, executionMode });
        }
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
