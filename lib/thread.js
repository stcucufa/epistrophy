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

    // Synchronous, pure computation.
    instant(f) {
        this.do((_, vm) => { vm.value = f(vm.value, vm.t); });
    },

    // Synchronous effect, does not affect the value.
    effect(f) {
        this.do((_, vm) => { f(vm.value, vm.t); });
    },

    // Delay for a given number of milliseconds (or the current value of the
    // thread).
    delay(dur) {
        this.asyncdo((thread, vm) => {
            vm.scheduleForward(thread, vm.t + time.read(dur ?? vm.value));
        });
    },

    // Begin an existing thread.
    spawn(childThread) {
        this.do((_, vm) => { vm.spawns.push(childThread); });
    },

    // Join all child threads.
    join() {
        this.do((_, vm) => { vm.join(); });
    },

    childJoined(childThread, vm) {
        const index = this.spawns?.indexOf(childThread);
        if (index >= 0) {
            this.values[index] = vm.value;
            this.spawns[index] = null;
            if (this.spawns.every(x => x === null)) {
                vm.scheduleForward(this, vm.t);
            }
        }
    }
};

let ID = 0;

export const Thread = () => extend(proto, { id: ID++, ops: [] });
