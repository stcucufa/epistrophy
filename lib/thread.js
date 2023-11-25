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
        this.do((_, vm) => {
            vm.value = f(vm.value, vm.t);
        });
    },

    // Synchronous effect, does not affect the value.
    effect(f, g = nop, h = nop) {
        this.ops.push([(_, vm) => {
            f(vm.value, vm.t);
        }, (_, vm) => {
            g(vm.value, vm.t);
        }, (_, vm) => {
            h(vm.value, vm.t);
        }]);
    },

    // Delay for a given number of milliseconds (or the current value of the
    // thread).
    delay(dur) {
        this.asyncdo((thread, vm) => {
            vm.delay(thread, vm.t + time.read(dur ?? vm.value));
        });
    },
};

let ID = 0;

export const Thread = () => extend(proto, { id: ID++, ops: [] });
