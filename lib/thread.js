import { del, extend, nop } from "./util.js";
import * as time from "./time.js";

// Ignore values from child threads.
const Ignore = Symbol();

const proto = {
    // Convenience function to push an op that has no undo or redo.
    do(op, attrs) {
        this.ops.push([op, nop, nop, attrs]);
        return this;
    },

    // Convenience function to push an op that simply yields on undo/redo.
    asyncdo(op, attrs) {
        this.ops.push([op, yields, yields, attrs]);
        return this;
    },

    // Convenience function to push an op that has the same do and redo, but a
    // different undo.
    doUndo(forward, backward, attrs) {
        this.ops.push([forward, backward, forward, attrs]);
        return this;
    },


    // Synchronous, pure computation.
    instant(f) {
        return this.do((_, vm) => {
            vm.value = f(vm.value, vm.t);
        }, { tag: "instant", dur: 0 });
    },

    // Constant value.
    constant(c) {
        return this.do((_, vm) => {
            vm.value = c;
        }, { tag: "constant", dur: 0 });
    },

    // Synchronous effect, does not affect the value.
    effect(f, g = nop, h = nop) {
        this.ops.push([(_, vm) => {
            f(vm.value, vm.t);
        }, (_, vm) => {
            g(vm.value, vm.t);
        }, (_, vm) => {
            h(vm.value, vm.t);
        }, { tag: "effect", dur: 0 }]);
        return this;
    },

    // Asynchronous computation.
    await(f) {
        return this.asyncdo((thread, vm) => {
            vm.await(thread, f);
        }, { tag: "await", dur: time.unresolved });
    },

    // Delay for a given number of milliseconds (or the current value of the
    // thread).
    delay(dur) {
        return this.asyncdo((thread, vm) => {
            vm.delay(thread, vm.t + time.read(dur ?? vm.value), dur == null);
        }, { tag: "delay", dur: dur == null ? null : time.read(dur) });
    },

    // Set an object property.
    set(object, property) {
        return this.doUndo((_, vm) => {
            vm.saveProperty(object, property);
            object[property] = vm.value;
        }, (_, vm) => {
            vm.restoreProperty(object, property);
        }, { tag: "set", dur: 0 });
    },

    // Unset an object property (revert the previously saved value, if any).
    unset(object, property) {
        return this.doUndo((_, vm) => {
            vm.restoreProperty(object, property);
        }, (_, vm) => {
            vm.saveProperty(object, property);
            object[property] = vm.value;
        }, { tag: "unset", dur: 0 });
    },

    // Set an element attribute.
    setAttribute(element, attribute) {
        return this.doUndo((_, vm) => {
            vm.saveAttribute(element, attribute);
            element.setAttribute(attribute, vm.value);
        }, (_, vm) => {
            vm.restoreAttribute(element, attribute);
        }, { tag: "set/attribute", dur: 0 });
    },

    // Unset an element attribute, reverting to the previously saved value.
    unsetAttribute(element, attribute) {
        return this.doUndo((_, vm) => {
            vm.restoreAttribute(element, attribute);
        }, (_, vm) => {
            vm.saveAttribute(element, attribute);
            element.setAttribute(attribute, vm.value);
        }, { tag: "unset/attribute", dur: 0 });
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
        }, yields, { tag: "event", dur: time.unresolved }]);
        return this;
    },

    // Set a label for a jump.
    label(name) {
        console.assert(!Object.hasOwn(this.labels, name));
        this.labels[name] = [this.ops.length];
        this.ops.push([nop, (thread, vm) => {
            console.assert(thread.labels[name].length === 2);
            if (vm.t > thread.begin) {
                vm.pc = thread.labels[name][1];
            }
        }, nop, { tag: "label", dur: 0, name }]);
        return this;
    },

    // Jump back to a label op given its name.
    jump(name) {
        console.assert(this.labels[name].length === 1);
        this.labels[name].push(this.ops.length);
        const jump = (thread, vm) => {
            console.assert(thread.labels[name].length === 2);
            vm.pc = thread.labels[name][0];
        };
        this.ops.push([jump, nop, jump, { tag: "jump", dur: 0, name }]);
        return this;
    },

    // Spawn a new thread.
    spawn(childThread) {
        return this.do((parentThread, vm) => {
            childThread.begin = vm.t;
            vm.scheduler.scheduleForward(childThread, vm.t, 0, vm.value);
            parentThread.children.push(childThread);
            childThread.parent = parentThread;
        }, { tag: "spawn", dur: 0, childThread });
    },

    // Static join: wait for all threads to finish and keep track of their
    // value in the order in which the threads were spawned (not in the order
    // in which they ended); or discard the values altogether.
    join(storeValues = true) {
        this.asyncdo((thread, vm) => {
            this.values = storeValues ? [] : Ignore;
            this.ended = 0;
            vm.delay(thread, time.unresolved);
        }, { tag: "join", dur: time.unresolved });
        return this;
    },

    childThreadDidEnd(thread, vm) {
        const index = this.children.indexOf(thread);
        console.assert(index >= 0);
        if (this.values) {
            if (Array.isArray(this.values)) {
                this.values[index] = vm.value;
            }
            if (++this.ended === this.children.length) {
                delete this.ended;
                this.children = [];
                const value = del(this, "values");
                vm.childThreadsDidJoin(this, Array.isArray(value) ? value : vm.valueOf(this));
            }
        }
    }
};

// Helper for asynchronous ops.
const yields = (thread, vm) => { vm.yield(thread); };

// Simple global counter for assigning IDs to threads.
let ID = 0;

// Create a new thread with an empty list of ops.
export const Thread = () => extend(proto, { id: ID++, ops: [], children: [], labels: {} });
