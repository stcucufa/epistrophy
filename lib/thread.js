import { del, extend, nop } from "./util.js";
import * as time from "./time.js";

const proto = {
    // Convenience function to push an op that has no undo or redo.
    do(op, dur = 0) {
        this.ops.push([op, nop, nop, dur]);
        return this;
    },

    // Convenience function to push an op that simply yields on undo/redo.
    asyncdo(op, dur = 0) {
        this.ops.push([op, yields, yields, dur]);
        return this;
    },

    // Convenience function to push an op that has the same do and redo, but a
    // different undo.
    doUndo(forward, backward, dur = 0) {
        this.ops.push([forward, backward, forward, dur]);
        return this;
    },


    // Synchronous, pure computation.
    instant(f) {
        return this.do((_, vm) => {
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
        }, 0]);
        return this;
    },

    // Delay for a given number of milliseconds (or the current value of the
    // thread).
    delay(dur) {
        return this.asyncdo((thread, vm) => {
            vm.delay(thread, vm.t + time.read(dur ?? vm.value), dur == null);
        }, dur == null ? null : time.read(dur));
    },

    // Set an object property.
    set(object, property) {
        return this.doUndo((_, vm) => {
            vm.saveProperty(object, property);
            object[property] = vm.value;
        }, (_, vm) => {
            vm.restoreProperty(object, property);
        });
    },

    // Unset an object property (revert the previously saved value, if any).
    unset(object, property) {
        return this.doUndo((_, vm) => {
            vm.restoreProperty(object, property);
        }, (_, vm) => {
            vm.saveProperty(object, property);
            object[property] = vm.value;
        });
    },

    // Set an element attribute.
    setAttribute(element, attribute) {
        return this.doUndo((_, vm) => {
            vm.saveAttribute(element, attribute);
            element.setAttribute(attribute, vm.value);
        }, (_, vm) => {
            vm.restoreAttribute(element, attribute);
        });
    },

    // Unset an element attribute, reverting to the previously saved value.
    unsetAttribute(element, attribute) {
        return this.doUndo((_, vm) => {
            vm.restoreAttribute(element, attribute);
        }, (_, vm) => {
            vm.saveAttribute(element, attribute);
            element.setAttribute(attribute, vm.value);
        });
    },

    // (DOM) Event; options are boolean flags to call for preventDefault,
    // stopImmediatePropagation and/or stopPropagation when the event is
    // handled.
    event(target, type, options = {}) {
        this.ops.push([(thread, vm) => {
            vm.listen(thread, target, type, options);
        }, (thread, vm) => {
            if (thread.currentEventListener) {
                target.removeEventListener(type, del(thread, "currentEventListener"));
            }
            vm.yield(thread);
        }, yields, time.unresolved]);
        return this;
    },

    // Set a label for a jump.
    label(name) {
        if (!this.labels[name]) {
            this.labels[name] = [];
        }
        this.labels[name][0] = this.ops.length;
        this.ops.push([nop, (thread, vm) => {
            vm.pc = thread.labels[name][1];
        }, nop, 0, { label: name }]);
        return this;
    },

    // Jump to a label op given its name.
    jump(name) {
        if (!this.labels[name]) {
            this.labels[name] = [];
        }
        this.labels[name][1] = this.ops.length;
        const jump = (thread, vm) => {
            vm.pc = thread.labels[name][0];
        };
        this.ops.push([jump, nop, jump, 0, { jump: name }]);
        return this;
    }
};

// Helper for asynchronous ops.
const yields = (thread, vm) => { vm.yield(thread); };

// Simple global counter for assigning IDs to threads.
let ID = 0;

// Create a new thread with an empty list of ops.
export const Thread = () => extend(proto, { id: ID++, ops: [], labels: {} });
