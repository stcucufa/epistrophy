import { extend, nop } from "./util.js";
import * as time from "./time.js";

const proto = {
    // Convenience function to push an op that has no undo or redo.
    do(op) {
        this.ops.push([op, nop, nop]);
    },

    // Convenience function to push an op that simply yields on undo/redo.
    asyncdo(op) {
        this.ops.push([op, yields, yields]);
    },

    // Convenience function to push an op that has the same do and redo, but a
    // different undo.
    doUndo(forward, backward) {
        this.ops.push([forward, backward, forward]);
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

    // Set an object property.
    set(object, property) {
        this.doUndo((_, vm) => {
            vm.saveProperty(object, property);
            object[property] = vm.value;
        }, (_, vm) => {
            vm.restoreProperty(object, property);
        });
    },

    // Unset an object property (revert the previously saved value, if any).
    unset(object, property) {
        this.doUndo((_, vm) => {
            vm.restoreProperty(object, property);
        }, (_, vm) => {
            vm.saveProperty(object, property);
            object[property] = vm.value;
        });
    },

    // Set an element attribute.
    setAttribute(element, attribute) {
        this.doUndo((_, vm) => {
            vm.saveAttribute(element, attribute);
            element.setAttribute(attribute, vm.value);
        }, (_, vm) => {
            vm.restoreAttribute(element, attribute);
        });
    },

    // Unset an element attribute, reverting to the previously saved value.
    unsetAttribute(element, attribute) {
        this.doUndo((_, vm) => {
            vm.restoreAttribute(element, attribute);
        }, (_, vm) => {
            vm.saveAttribute(element, attribute);
            element.setAttribute(attribute, vm.value);
        });
    }
};

// Helper for asynchronous ops.
const yields = (thread, vm) => { vm.yield(thread); };

// Simple global counter for assigning IDs to threads.
let ID = 0;

// Create a new thread with an empty list of ops.
export const Thread = () => extend(proto, { id: ID++, ops: [] });
