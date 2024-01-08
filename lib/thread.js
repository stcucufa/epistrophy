import { notify, off } from "./events.js";
import { del, extend, nop, push } from "./util.js";
import * as time from "./time.js";

// Ignore values from child threads.
const Ignore = Symbol();

// Types of joins.
const Static = Symbol();
const Dynamic = Symbol();
const First = Symbol();

// Special timeout value.
export const Timeout = Symbol.for("timeout");

// Effect flag for attributes.
const effect = true;

// Send an event from the outside.
export const send = notify;

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
        return this.do((thread, vm) => {
            vm.value = f(vm.value, vm.t - thread.begin);
        }, { tag: "instant", dur: 0 });
    },

    // Constant value.
    constant(c) {
        return this.do((_, vm) => {
            vm.value = c;
        }, { tag: "constant", dur: 0 });
    },

    // Synchronous effect, does not affect the value.
    effect(do_, undo = nop, redo = nop) {
        this.ops.push([(thread, vm) => {
            do_(vm.value, vm.t - thread.begin);
        }, (thread, vm) => {
            undo(vm.value, vm.t - thread.begin);
        }, (thread, vm) => {
            redo(vm.value, vm.t - thread.begin);
        }, { tag: "effect", dur: 0, effect }]);
        return this;
    },

    // Halt the thread.
    halt() {
        return this.doUndo((thread, vm) => {
            vm.pc = thread.ops.length;
        }, nop, { tag: "halt", dur: 0, effect });
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
        }, { tag: "delay", dur: dur == null ? null : time.read(dur), effect });
    },

    // Set an object property.
    set(object, property) {
        return this.doUndo((_, vm) => {
            vm.saveProperty(object, property);
            object[property] = vm.value;
        }, (_, vm) => {
            vm.restoreProperty(object, property);
        }, { tag: "set", dur: 0, effect });
    },

    // Unset an object property (revert the previously saved value, if any).
    unset(object, property) {
        return this.doUndo((_, vm) => {
            vm.restoreProperty(object, property);
        }, (_, vm) => {
            vm.saveProperty(object, property);
            object[property] = vm.value;
        }, { tag: "unset", dur: 0, effect });
    },

    // Set an element attribute.
    setAttribute(element, attribute) {
        return this.doUndo((_, vm) => {
            vm.saveAttribute(element, attribute);
            element.setAttribute(attribute, vm.value);
        }, (_, vm) => {
            vm.restoreAttribute(element, attribute);
        }, { tag: "set/attribute", dur: 0, effect });
    },

    // Unset an element attribute, reverting to the previously saved value.
    unsetAttribute(element, attribute) {
        return this.doUndo((_, vm) => {
            vm.restoreAttribute(element, attribute);
        }, (_, vm) => {
            vm.saveAttribute(element, attribute);
            element.setAttribute(attribute, vm.value);
        }, { tag: "unset/attribute", dur: 0, effect });
    },

    // Receive an internal or a DOM event. Options are boolean flags to call
    // for preventDefault, stopImmediatePropagation and/or stopPropagation when
    // the DOM event is handled. Set the `dom` option to false when the target
    // of an internal event can also be a DOM event target.
    receive(target, type, options = {}) {
        if (typeof target.addEventListener === "function" && options.dom !== false) {
            this.ops.push([(thread, vm) => {
                vm.addEventListener(thread, target, type, options);
            }, (thread, vm) => {
                if (thread.currentEventListener?.target === target &&
                    thread.currentEventListener?.type === type) {
                    target.removeEventListener(type, del(thread, "currentEventListener").handler);
                }
                vm.yield(thread);
            }, yields, { tag: "event", dur: time.unresolved }]);
            return this;
        } else {
            this.ops.push([(thread, vm) => {
                vm.receive(thread, target, type);
            }, (thread, vm) => {
                if (thread.currentEventListener?.target === target &&
                    thread.currentEventListener?.type === type) {
                    off(target, type, del(thread, "currentEventListener").handler);
                }
                vm.yield(thread);
            }, yields, { tag: "receive", dur: time.unresolved }]);
        }
        return this;
    },

    // Set a return point for a jump by pushing it to the stack.
    repeat() {
        this.repeats.push([this.ops.length]);
        return this.doUndo(
            nop,
            (thread, vm) => {
                if (vm.t > thread.begin) {
                    vm.pc = thread.repeats.at(-1)[1];
                }
            },
            { tag: "repeat", dur: 0, effect }
        );
    },

    // Close the loop and jump back to the last begin.
    loop() {
        this.repeats.at(-1).push(this.ops.length);
        return this.doUndo(
            (thread, vm) => { vm.pc = thread.repeats.at(-1)[0]; },
            nop,
            { tag: "loop", dur: 0, effect }
        );
    },

    // Spawn a new thread.
    spawn(childThread) {
        return this.do((parentThread, vm) => {
            parentThread.children.push(childThread);
            childThread.parent = parentThread;
            vm.spawnChild(childThread, vm.value);
        }, { tag: "spawn", dur: 0, childThread, effect });
    },

    // Spawn a copy of the child thread for every input.
    map(childThread) {
        return this.do((parentThread, vm) => {
            console.assert(Array.isArray(vm.value));
            const i = parentThread.children.length;
            for (const value of vm.value) {
                const instance = push(parentThread.children, Thread());
                instance.ops = childThread.ops;
                instance.parent = parentThread;
                vm.spawnChild(instance, value);
            }
            notify(vm, "spawns", { parentThread, childThreads: parentThread.children.slice(i) });
        }, { tag: "map", dur: 0, effect });
    },

    // Static join: wait for all threads to finish and keep track of their
    // value in the order in which the threads were spawned (not in the order
    // in which they ended); or discard the values altogether.
    join(storeValues = true) {
        return this.asyncdo((thread, vm) => {
            if (this.children.length === 0) {
                notify(vm, "resolve", { thread, t: vm.t });
            } else {
                this.join = {
                    type: Static,
                    values: storeValues ? [] : Ignore,
                    pending: this.children.length,
                };
                vm.delay(thread, time.unresolved);
            }
        }, { tag: "join", dur: time.unresolved, effect: !storeValues });
    },

    // Spawn and thread and join it, cancelling all the other children
    joinThread(childThread, cancelChildren = true, storeValues = true) {
        return this.asyncdo((parentThread, vm) => {
            parentThread.children.push(childThread);
            childThread.parent = parentThread;
            vm.spawnChild(childThread, vm.value);
            parentThread.join = {
                type: Static,
                values: storeValues ? [] : Ignore,
                interrupt: !cancelChildren,
                pending: childThread,
                cancellable: new Set(parentThread.children)
            };
            vm.delay(parentThread, time.unresolved);
        }, { tag: "join/thread", dur: time.unresolved, childThread, effect: !storeValues });
    },

    // Dynamic join: end with values in the order in which the threads ended.
    joinDynamic(storeValues = true) {
        return this.asyncdo((thread, vm) => {
            if (this.children.length === 0) {
                notify(vm, "resolve", { thread, t: vm.t });
            } else {
                this.join = {
                    type: Dynamic,
                    values: storeValues ? [] : Ignore,
                    pending: this.children.length,
                };
                vm.delay(thread, time.unresolved);
            }
        }, { tag: "join/dynamic", dur: time.unresolved, effect: !storeValues });
    },

    // First: end as soon as a thread ends and cancel all the others.
    first(storeValue = true) {
        return this.asyncdo((thread, vm) => {
            if (this.children.length === 0) {
                notify(vm, "resolve", { thread, t: vm.t });
            } else {
                this.join = {
                    type: First,
                    values: storeValue ? [] : Ignore,
                    pending: 1,
                    cancellable: new Set(this.children)
                };
                vm.delay(thread, time.unresolved);
            }
        }, { tag: "join/first", dur: time.unresolved, effect: !storeValue });
    },

    // When a child thread has ended, check the current join status of the
    // parent thread.
    childThreadDidEnd(childThread, vm) {
        const index = this.children.indexOf(childThread);
        console.assert(index >= 0);
        if (this.join) {
            if (Array.isArray(this.join.values)) {
                if (this.join.type === Static) {
                    this.join.values[index] = vm.value;
                } else {
                    this.join.values.push(vm.value);
                }
            }
            this.join.cancellable?.delete(childThread);
            if ((this.join.pending > 0 && --this.join.pending === 0) ||
                (this.join.pending === childThread)) {
                if (this.join.cancellable) {
                    for (const child of this.join.cancellable.values()) {
                        vm.cancel(child);
                        if (this.join.type === Static) {
                            this.join.values[this.children.indexOf(child)] = this.join.interrupt ?
                                vm.valueOf(child) : Timeout;
                        }
                    }
                }
                const value = Array.isArray(this.join.values) ?
                    (this.join.type === First ? this.join.values[0] : this.join.values) :
                    vm.valueOf(this);
                if (this.join.pending === childThread) {
                    value.pop();
                }
                delete this.join;
                this.children = [];
                vm.childThreadsDidJoin(this, value);
            }
        }
    }
};

// Helper for asynchronous ops.
const yields = (thread, vm) => { vm.yield(thread); };

// Simple global counter for assigning IDs to threads.
let ID = 0;

// Create a new thread with an empty list of ops.
export const Thread = () => extend(proto, { id: ID++, ops: [], children: [], repeats: [] });
