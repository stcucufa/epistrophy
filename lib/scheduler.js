import { add, create, extend, mapdel, mapit } from "./util.js";
import { show } from "./show.js";
import { Queue } from "./priority-queue.js";
import * as time from "./time.js";

// Ops have three behaviours depending on whether we are in do, undo or redo
// execution mode (plus Attrs for the timeline).
export const [Do, Undo, Redo, Attrs] = [0, 1, 2, 3];

// Error is an abnormal behaviour.
export const Error = Symbol();

const proto = {
    init() {
        this.futureQueue = Queue((a, b) => time.cmp(a.t, b.t) || (a.thread.spawnID - b.thread.spawnID));
        this.pastQueue = Queue((a, b) => time.cmp(b.t, a.t) || (b.thread.spawnID - a.thread.spawnID));
        this.unresolved = new Map();
    },

    valueOf(thread) {
        // FIXME 2907 Find an item in a queue (this could be more efficient).
        const past = this.pastQueue.filter(it => it.thread === thread);
        return past.sort((a, b) => time.cmp(b.t, a.t) || (b.pc - a.pc))[0]?.value;
    },

    lastTimeOf(thread) {
        // FIXME 2907 Find an item in a queue (this could be more efficient).
        const past = this.pastQueue.filter(it => it.thread === thread);
        return past.sort((a, b) => time.cmp(b.t, a.t) || (b.pc - a.pc))[1]?.t;
    },

    cancel(thread) {
        if (this.unresolved.has(thread)) {
            this.unresolved.delete(thread);
        } else {
            // FIXME 2907 Find an item in a queue (this could be more efficient).
            const [item, ...future] = this.futureQueue.filter(it => it.thread === thread);
            console.assert(future.length === 0);
            console.assert(item.executionMode === Do);
            item.cancelled = true;
        }
    },

    get isIdle() {
        return this.futureQueue.length === 0 && this.unresolved.size === 0;
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
        if (time.isDefinite(t)) {
            return this.futureQueue.insert({ thread, t, pc, value, executionMode });
        }
        if (time.isUnresolved(t)) {
            console.assert(executionMode === Do);
            add(this.unresolved, thread, pc);
            return { thread, t, pc, value, executionMode };
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
    },

    wake(thread, t, value, executionMode = Do) {
        console.assert(time.isDefinite(t));
        const pc = mapdel(this.unresolved, thread);
        return this.scheduleForward(thread, t, pc, value, executionMode);
    },

    dump() {
        const item = ({ thread, t, pc, value, executionMode }) => `(T${thread.id}, ${t}, ${pc}, ${value}, ${
            executionMode === 0 ? "Do" : executionMode === 2 ? "Redo" : "Undo"
        })`;
        return `past: [${mapit(this.pastQueue.values(), item)}], future: [${mapit(this.futureQueue.values(), item)}]`;
    }
};

export const Scheduler = () => create().call(proto);
