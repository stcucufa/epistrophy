import { extend, nop } from "./util.js";
import * as time from "./time.js";

const yields = (thread, vm) => { vm.yield(thread); };

const proto = {
    // Convenience function to push an op that has no undo or redo.
    do(op) {
        this.ops.push([op, nop, nop]);
    },

    // Convenience function to push an op that simply yields on undo/redo.
    asyncdo(op) {
        this.ops.push([op, yields, yields]);
    },

    instant(f) {
        this.do((_, vm) => { vm.value = f(vm.value, vm.t); });
    },

    delay(dur) {
        this.asyncdo((thread, vm) => {
            vm.scheduleForward(thread, vm.t + time.read(dur ?? vm.value));
        });
    },
};

let ID = 0;

export const Thread = () => extend(proto, {
    id: ID++,
    ops: [],
    listeners: new Set(),
    childThreads: new Set()
});

export function spawn(parentThread, childThread, t) {
    if (childThread.subid >= 0) {
        const begin = t;
        const offset = begin - childThread.begin;
        console.assert(childThread.item);
        return extend(thread, {
            parent: parentThread,
            id: childThread.id,
            subid: childThread.subid + 1,
            item: childThread.item,
            ops: childThread.ops,
            listeners: new Set(),
            childThreads: new Set(),
            begin,
            end: time.add(offset, childThread.end)
        });
    }
    return Object.assign(childThread, {
        parent: parentThread,
        childThreads: new Set(),
        subid: 0
    });
}
