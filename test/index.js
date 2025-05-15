import test from "./test.js";
import { nop, K, Queue, message, on, off } from "../lib/util.js";
import Fiber, { All, Last, Gate, First } from "../lib/fiber.js";
import Scheduler from "../lib/scheduler.js";

// Utility function to run a fiber synchronously.
function run(fiber, scheduler, until = Infinity) {
    scheduler ??= new Scheduler();
    scheduler.resume(fiber);
    scheduler.clock.now = until;
    return scheduler;
}

// 4E0A	Priority queue

test("new Queue(cmp?)", t => {
    const queue = new Queue();
    t.same(queue.length, 0, "empty queue");
    t.same(queue.cmp(17, 23), -6, "default comparison between items");
});

test("Queue.insert(x), min heap", t => {
    const queue = new Queue();
    t.same(queue.insert(17), 17, "return the pushed value");
    t.equal(queue, [17], "item in the queue");
    queue.insert(23);
    queue.insert(19);
    queue.insert(7);
    queue.insert(31);
    queue.insert(13);
    t.equal(queue, [7, 17, 13, 23, 31, 19], "items in the queue");
});

test("Queue.insert(x), max heap", t => {
    const queue = new Queue((a, b) => b - a);
    queue.insert(17);
    queue.insert(23);
    queue.insert(19);
    queue.insert(7);
    queue.insert(31);
    queue.insert(13);
    t.equal(queue, [31, 23, 19, 7, 17, 13], "items in the queue");
});

test("Queue.remove(), min heap", t => {
    const queue = new Queue();
    queue.insert(17);
    queue.insert(23);
    queue.insert(19);
    queue.insert(7);
    queue.insert(31);
    queue.insert(13);
    t.equal(queue, [7, 17, 13, 23, 31, 19], "before");
    t.same(queue.remove(), 7, "return top item");
    t.equal(queue, [13, 17, 19, 23, 31], "after first removal");
    t.same(queue.remove(), 13, "next");
    t.equal(queue, [17, 23, 19, 31], "after second removal");
    t.same(queue.remove(), 17, "next");
    t.same(queue.remove(), 19, "next");
    t.same(queue.remove(), 23, "next");
    t.same(queue.remove(), 31, "last");
    t.undefined(queue.remove(), "empty queue");
});

test("Queue.remove(), max heap", t => {
    const queue = new Queue((a, b) => b - a);
    const N = 7;
    const xs = [4, 0, 2, 5, 6, 4, 6];
    for (let i = 0; i < N; ++i) {
        const x = xs[i];
        queue.insert(x);
    }
    xs.sort((a, b) => b - a);
    const dequeued = [];
    for (let i = 0; i < N; ++i) {
        dequeued.push(queue.remove());
    }
    t.equal(xs, dequeued, "items removed in order");
});

test("Queue.remove(), randomized", t => {
    let ops = 0;
    const queue = new Queue((a, b) => (++ops, a - b));
    const N = 77777;
    const xs = [];
    for (let i = 0; i < N; ++i) {
        const x = Math.floor(Math.random() * N);
        xs.push(x);
        queue.insert(x);
    }
    xs.sort((a, b) => a - b);
    const dequeued = [];
    for (let i = 0; i < N; ++i) {
        dequeued.push(queue.remove());
    }
    t.equal(xs, dequeued, "items removed in order");
    t.atmost(ops, 3 * N * Math.log2(N), "O(log n) ops");
});

test("Queue.remove(at), min heap", t => {
    const queue = new Queue();
    queue.insert(17);
    queue.insert(23);
    queue.insert(19);
    queue.insert(7);
    queue.insert(31);
    queue.insert(13);
    t.equal(queue, [7, 17, 13, 23, 31, 19], "before");
    t.same(queue.remove(1), 17, "return the removed item");
    t.equal(queue, [7, 19, 13, 23, 31], "after first removal");
    t.same(queue.remove(), 7, "next");
    t.same(queue.remove(), 13, "next");
    t.same(queue.remove(), 19, "next");
    t.same(queue.remove(), 23, "next");
    t.same(queue.remove(), 31, "last");
    t.undefined(queue.remove(), "empty queue");
});

test("Queue.remove(at), last element", t => {
    const queue = new Queue();
    queue.insert(17);
    queue.insert(23);
    t.equal(queue, [17, 23], "before");
    t.same(queue.remove(1), 23, "return the removed item");
    t.equal(queue, [17], "after first removal");
});

// 4C01 Synchronous messages

test("message(from, type) sends a message; on(from, type, handler) listens to messages", t => {
    const A = {};
    on(A, "hello", ({ from, type }) => {
        t.same(from, A, "from field");
        t.same(type, "hello", "type field");
        A.handled = true;
    });
    t.undefined(message(A, "hello"), "return nothing");
    t.same(A.handled, true, "message was handled");
});

test("message(from, type, message) adds additional arguments", t => {
    const A = {};
    on(A, "bye", ({ from, type, until }) => {
        t.same(from, A, "from field (with message argument)");
        t.same(type, "bye", "type field (with message argument)");
        t.same(until, "later", "custom field");
    });
    message(A, "bye", { until: "later" });
});

test("on(from, type, handler) accepts an object with a `handleMessage` method as handler", t => {
    const A = {};
    const B = {
        received: 0,
        handleMessage({ from, type }) {
            if (this.received === 0) {
                t.same(from, A, "from field");
                t.same(type, "hello", "type field");
            }
            B.received += 1;
        }
    };
    on(A, "hello", B);
    message(A, "hello");
    t.same(B.received, 1, "message was handled");
    message(A, "hello");
    t.same(B.received, 2, "message was handled again");
    message(A, "hello");
    t.same(B.received, 3, "and again");
});

test("off(from, type, handler) removes the handler", t => {
    const A = {};
    const B = {};
    const C = {
        received: 0,
        handleMessage({ from, type }) { this.received += 1; }
    };
    on(A, "hello", C);
    on(B, "hello", C);
    message(A, "hello");
    t.same(C.received, 1, "message was handled");
    message(A, "hello");
    t.same(C.received, 2, "message was handled again");
    off(A, "hello", C);
    t.same(C.received, 2, "the last message was not handled");
});

// 4D0A Scheduler

test("new Scheduler()", t => {
    const scheduler = new Scheduler();
    t.same(scheduler.clock.now, 0, "creates a scheduler with a clock");
});

test("Scheduler.now", t => {
    const scheduler = new Scheduler();
    scheduler.clock.now = 444;
    t.same(scheduler.now, scheduler.clock.now, "is the same as Scheduler.clock.now");
    const fiber = new Fiber().
        delay(111).
        effect((_, scheduler) => {
            t.same(scheduler.now, 555, "except when updating");
            t.same(scheduler.clock.now, 1111, "the clock is ahead");
        });
    run(fiber, scheduler, 1111);
    t.same(scheduler.now, scheduler.clock.now, "is the same as Scheduler.clock.now after update");
});

// 4D07 Fiber class

test("new Fiber()", t => {
    const fiber = new Fiber();
    t.undefined(fiber.parent, "has no parent by default");
    t.atleast(fiber.id, 0, "has a numeric id");
    t.throws(() => fiber.value, "fiber has no value before it starts running");
    run(fiber);
});

test("Fiber with no op", t => {
    const fiber = new Fiber();
    run(fiber);
    t.same(fiber.beginTime, 0, "began at t=0");
    t.same(fiber.endTime, 0, "ended at t=0");
});

test("Fiber.exec(f)", t => {
    const scheduler = new Scheduler();
    const fiber = new Fiber().exec(function(...args) {
        t.same(args.length, 2, "f is called with two arguments");
        t.same(args[0], fiber, "f is called with `fiber` as the first argument");
        t.same(args[1], scheduler, "f is called with `scheduler` as the second argument");
        return 17;
    });
    run(fiber, scheduler);
    t.same(fiber.value, 17, "updates the fiber value on success");
    t.undefined(fiber.error, "the fiber has no error");
});

test("Fiber.exec(f) catches errors", t => {
    const fiber = new Fiber().
        exec(K(17)).
        exec(() => { throw Error("AUGH"); });
    run(fiber);
    t.undefined(fiber.value, "the fiber has no value");
    t.same(fiber.error.message, "AUGH", "the error is caught");
});

test("Fiber.exec(f) does not run after an error", t => {
    const fiber = new Fiber().
        exec(() => { throw Error("AUGH"); }).
        effect(K(17));
    run(fiber);
    t.undefined(fiber.value, "the fiber still has no value");
    t.same(fiber.error.message, "AUGH", "the error was caught");
});

test("Fiber.effect(f)", t => {
    const scheduler = new Scheduler();
    let ran = false;
    const fiber = new Fiber().
        exec(K(19)).
        effect(function(...args) {
            t.same(args.length, 2, "f is called with two arguments");
            t.same(args[0], fiber, "f is called with `fiber` as the first argument");
            t.same(args[1], scheduler, "f is called with `scheduler` as the second argument");
            ran = true;
            return 17;
        });
    run(fiber, scheduler);
    t.same(ran, true, "effect ran");
    t.same(fiber.value, 19, "but the fiber value is unchanged");
});

test("Fiber.effect(f) catches errors", t => {
    const fiber = new Fiber().
        exec(K(17)).
        effect(() => { throw Error("AUGH"); });
    run(fiber);
    t.undefined(fiber.value, "the fiber has no value");
    t.same(fiber.error.message, "AUGH", "the error is caught");
});

test("Fiber.effect(f) does not run after an error", t => {
    let ran = false;
    const fiber = new Fiber().
        exec(() => { throw Error("AUGH"); }).
        effect(() => { ran = true; });
    run(fiber);
    t.same(ran, false, "the effect did not run");
    t.same(fiber.error.message, "AUGH", "the error was caught");
});

test("Fiber.either(f)", t => {
    const scheduler = new Scheduler();
    const fiber = new Fiber().
        either(function(...args) {
            t.same(args.length, 2, "f is called with two arguments");
            t.same(args[0], fiber, "f is called with `fiber` as the first argument");
            t.same(args[1], scheduler, "f is called with `scheduler` as the second argument");
            return 23;
        });
    run(fiber, scheduler);
    t.same(fiber.value, 23, "the fiber has a value");
    t.undefined(fiber.error, "the fiber has no error");
});

test("Fiber.either(f) catches error", t => {
    const fiber = new Fiber().
        exec(K(17)).
        either(() => { throw Error("AUGH"); });
    run(fiber);
    t.undefined(fiber.value, "the fiber has no value");
    t.same(fiber.error.message, "AUGH", "the error was caught");
});

test("Fiber.either(f) recovers from errors", t => {
    const fiber = new Fiber().
        effect(() => { throw Error("AUGH"); }).
        either(fiber => {
            if (fiber.error) {
                return 29;
            }
        });
    run(fiber);
    t.same(fiber.value, 29, "the fiber has a value");
    t.undefined(fiber.error, "the error was cleared");
});

// 4D0D Event

test("Fiber.event(target, type, delegate?)", t => {
    const fiber = new Fiber().
        exec(K(31)).
        event(window, "hello").
        exec(({ value }) => {
            t.pass("handles an event of `type` from `target`");
            t.same(value, 31, "value was not affected");
            return -value;
        });
    const scheduler = run(fiber, new Scheduler(), 1);
    window.dispatchEvent(new CustomEvent("hello"));
    run(fiber, scheduler);
    t.same(fiber.value, -31, "fiber execution resumed after message was sent");
});

test("Fiber.event(target, type, delegate?)", t => {
    const A = {};
    const fiber = new Fiber().
        exec(K(31)).
        event(A, "hello").
        exec(({ value }) => {
            t.pass("handles a synchronous message of `type` from `target`");
            t.same(value, 31, "value was not affected");
            return -value;
        });
    const scheduler = run(fiber, new Scheduler(), 1);
    message(A, "hello");
    run(fiber, scheduler);
    t.same(fiber.value, -31, "fiber execution resumed after message was sent");
});

test("Event delegate: eventShouldBeIgnored(event, fiber, scheduler)", t => {
    const delegate = {
        count: 0,
        eventShouldBeIgnored(...args) {
            const event = args[0];
            if (this.count === 0) {
                t.same(args.length, 3, "called with three arguments");
                t.same(this, delegate, "`this` is the delegate object");
                t.same(event.target === window && event.type === "hello", true, "`event` is the first argument");
                t.same(args[1], fiber, "`fiber` is the second argument");
                t.same(args[2], scheduler, "`scheduler` is the third argument");
            }
            this.count += 1;
            return event.detail?.whom !== "world";
        }
    };
    const fiber = new Fiber().
        exec(K(37)).
        event(window, "hello", delegate).
        exec(({ value }) => -value);
    const scheduler = new Scheduler();
    run(fiber, scheduler, 1);
    window.dispatchEvent(new CustomEvent("hello"));
    scheduler.clock.now = 2;
    t.same(fiber.value, 37, "event was not handled yet");
    window.dispatchEvent(new CustomEvent("hello", { detail: { whom: "world" } }));
    scheduler.clock.now = 3;
    t.same(fiber.value, -37, "fiber execution resumed on second try");
    window.dispatchEvent(new CustomEvent("hello", { detail: { whom: "world" } }));
    scheduler.clock.now = 4;
    t.same(delegate.count, 2, "delegate method was called twice");
});

test("Event delegate: eventShouldBeIgnored(event, fiber, scheduler)", t => {
    const delegate = {
        count: 0,
        eventShouldBeIgnored(...args) {
            const event = args[0];
            if (this.count === 0) {
                t.same(args.length, 3, "called with three arguments");
                t.same(this, delegate, "`this` is the delegate object");
                t.same(event.from === A && event.type === "hello", true, "`event` is the first argument");
                t.same(args[1], fiber, "`fiber` is the second argument");
                t.same(args[2], scheduler, "`scheduler` is the third argument");
            }
            this.count += 1;
            return event.whom !== "world";
        }
    };
    const A = {};
    const fiber = new Fiber().
        exec(K(37)).
        event(A, "hello", delegate).
        exec(({ value }) => -value);
    const scheduler = new Scheduler();
    run(fiber, scheduler, 1);
    message(A, "hello");
    scheduler.clock.now = 2;
    t.same(fiber.value, 37, "event was not handled yet");
    message(A, "hello", { whom: "world" });
    scheduler.clock.now = 3;
    t.same(fiber.value, -37, "fiber execution resumed on second try");
    message(A, "hello", { whom: "world" });
    scheduler.clock.now = 4;
    t.same(delegate.count, 2, "delegate method was called twice");
});

test("Event delegate: eventWasHandled(event, fiber, scheduler)", t => {
    const delegate = {
        eventWasHandled(...args) {
            const event = args[0];
            t.same(args.length, 3, "called with three arguments");
            t.same(this, delegate, "`this` is the delegate object");
            t.same(event.target === window && event.type === "hello", true, "`event` is the first argument");
            t.same(args[1], fiber, "`fiber` is the second argument");
            t.same(args[2], scheduler, "`scheduler` is the third argument");
            fiber.value = event.detail.whom;
        }
    };
    const fiber = new Fiber().event(window, "hello", delegate);
    const scheduler = new Scheduler();
    run(fiber, scheduler);
    window.dispatchEvent(new CustomEvent("hello", { detail: { whom: "world" } }));
    t.same(fiber.value, "world", "fiber value was set");
});

test("Event delegate: eventWasHandled(event, fiber, scheduler)", t => {
    const A = {};
    const delegate = {
        eventWasHandled(...args) {
            const event = args[0];
            t.same(args.length, 3, "called with three arguments");
            t.same(this, delegate, "`this` is the delegate object");
            t.same(event.from === A && event.type === "hello", true, "`event` is the first argument");
            t.same(args[1], fiber, "`fiber` is the second argument");
            t.same(args[2], scheduler, "`scheduler` is the third argument");
            fiber.value = event.whom;
        }
    };
    const fiber = new Fiber().event(A, "hello", delegate);
    const scheduler = new Scheduler();
    run(fiber, scheduler);
    message(A, "hello", { whom: "world" });
    t.same(fiber.value, "world", "fiber value was set");
});

// 4D0E Repeat

test("Fiber.repeat(f, delegate)", t => {
    const delegate = {
        repeatShouldEnd(...args) {
            const [count] = args;
            if (!(this.count >= 0)) {
                t.same(args.length, 3, "`repeatShouldEnd` is called with three arguments");
                t.same(this, delegate, "`this` is the delegate object");
                t.same(args[0], 0, "iteration count is the first argument (starting at zero before the first iteration)");
                t.same(args[1], fiber, "`fiber` is the second argument");
                t.same(args[2], scheduler, "`scheduler` is the third argument");
            } else {
                t.same(count, this.count + 1, "count is incremented on subsequent calls");
            }
            this.count = count;
            return count > 3;
        }
    };
    const scheduler = new Scheduler();
    const fiber = new Fiber().
        exec(K(19)).
        repeat(fiber => fiber.exec(({ value }) => value + 1), delegate);
    run(fiber, scheduler);
    t.same(fiber.value, 23, "the fiber has a value");
    t.undefined(fiber.error, "the fiber has no error");
});

test("Fiber.repeat fails if it has zero duration and no delegate", t => {
    const fiber = new Fiber().
        exec(K(19)).
        repeat(fiber => fiber.exec(({ value }) => value + 1));
    run(fiber);
    t.undefined(fiber.value, "the fiber has no value");
    t.ok(fiber.error, "the fiber has an error");
});

test("Fiber.repeat does not begin if the fiber is failing", t => {
    const fiber = new Fiber().
        effect(() => { throw Error("AUGH"); }).
        repeat(fiber => fiber.effect(() => { t.fail("repeat should not begin"); })).
        either(({ error }) => error.message === "AUGH");
    run(fiber);
    t.same(fiber.value, true, "repeat did not begin");
});

test("Fiber.repeat does not continue when the fiber is failing", t => {
    const fiber = new Fiber().
        repeat(fiber => fiber.effect(() => { throw Error("AUGH"); }), {
            repeatShouldEnd: count => {
                t.atmost(count, 1, "only go through the first iteration");
                return count > 3;
            }
        });
    run(fiber);
    t.atleast(t.expectations, 1, "went through a repeat once but no more");
});
 
// 4E03 Delay

test("Fiber.delay(dur)", t => {
    const fiber = new Fiber().
        effect((_, scheduler) => {
            t.same(scheduler.currentTime, 0, "time before delay");
        }).
        delay(777).
        exec((_, scheduler) => scheduler.currentTime);
    run(fiber);
    t.same(fiber.value, 777, "fiber resumed after the delay");
});

test("Fiber.delay(dur)", t => {
    const fiber = new Fiber().
        delay(-777).
        delay(0).
        delay("for a while").
        exec((_, scheduler) => scheduler.currentTime);
    run(fiber);
    t.same(fiber.value, 0, "no delay when dur is not > 0");
});

test("Fiber.delay(dur)", t => {
    const scheduler = new Scheduler();
    const fiber = new Fiber().
        delay((...args) => {
            t.equal(args, [fiber, scheduler], "`dur` may be a function called with `fiber` and `scheduler` as arguments");
            return 333;
        }).
        exec((_, scheduler) => scheduler.currentTime);
    run(fiber, scheduler);
    t.same(fiber.value, 333, "fiber resumed after the delay returned by the `dur` function");
});

test("Fiber delay fails if `dur` is a function that fails", t => {
    const scheduler = new Scheduler();
    const fiber = new Fiber().
        delay(() => { throw Error("AUGH"); }).
        either((_, scheduler) => scheduler.currentTime);
    run(fiber);
    t.same(fiber.value, 0, "no delay");
});

test("Fiber.delay is skipped when the fiber is failing", t => {
    const fiber = new Fiber().
        exec(() => { throw "AUGH"; }).
        delay(999).
        either((_, scheduler) => scheduler.currentTime);
    run(fiber);
    t.same(fiber.value, 0, "no delay");
});

// 4E0C Spawn

test("Fiber.spawn() creates a new fiber immediately", t => {
    const fiber = new Fiber();
    const child = fiber.spawn();
    t.same(child.parent, fiber, "the new fiber has a parent");
});

test("Fiber.spawn(f) creates a new fiber immediately", t => {
    const fiber = new Fiber();
    t.same(fiber.spawn(child => {
        t.same(child.parent, fiber, "the function parameter is called with the child fiber as argument")
    }), fiber, "but the parent fiber is returned");
});

test("Fiber.spawn: child execution", t => {
    const values = [];
    const fiber = new Fiber().
        exec(K(37)).
        spawn(fiber => fiber.
            effect(fiber => {
                t.same(fiber.value, fiber.parent.value, "child fiber gets its value from the parent");
                values.push("child");
            }).
            delay(111).
            effect(fiber => { values.push("child again"); }).
            delay(222).
            effect(fiber => { values.push("child finally"); })
        ).
        effect(() => { values.push("parent (before)"); }).
        delay(222).
        effect(() => { values.push("parent (after)"); });
    run(fiber);
    t.equal(values, ["parent (before)", "child", "child again", "parent (after)", "child finally"],
        "child begins after parent yields and runs concurrently");
});

test("Fiber.spawn: children and grand-children", t => {
    const values = [];
    const fiber = new Fiber().
        spawn(fiber => fiber.
            spawn(fiber => fiber.effect(() => { values.push("B"); })).
            spawn(fiber => fiber.effect(() => { values.push("C"); }))
        ).
        effect(() => { values.push("A"); }).
        spawn(fiber => fiber.
            spawn(fiber => fiber.effect(() => { values.push("D"); })).
            spawn(fiber => fiber.effect(() => { values.push("E"); }))
        );
    run(fiber);
    t.equal(values, ["A", "B", "C", "D", "E"], "descendants begin depth-first");
});

test("Fiber.spawn: children and grand-children (yielding)", t => {
    const values = [];
    const fiber = new Fiber().
        spawn(fiber => fiber.
            spawn(fiber => fiber.effect(() => { values.push("A"); })).
            spawn(fiber => fiber.effect(() => { values.push("B"); }))
        ).
        delay(1).
        effect(() => { values.push("C"); }).
        spawn(fiber => fiber.
            spawn(fiber => fiber.effect(() => { values.push("D"); })).
            spawn(fiber => fiber.effect(() => { values.push("E"); }))
        );
    run(fiber);
    t.equal(values, ["A", "B", "C", "D", "E"], "descendants begin as soon as the parent yields");
});

test("Fiber.spawn: child does not begin when the parent is failing", t => {
    const fiber = new Fiber().
        effect(() => { throw Error("AUGH"); }).
        spawn(fiber => fiber.
            effect(() => { t.fail("child fiber should not begin"); })
        );
    run(fiber);
    t.same(t.expectations, 0, "parent is failing");
});

// 4E0D Join

test("Fiber.join()", t => {
    const fiber = new Fiber().
        spawn(fiber => fiber.
            delay(333).
            effect((_, scheduler) => { t.same(scheduler.now, 333, "child fiber ends after delay"); })
        ).
        join().
        effect((_, scheduler) => { t.same(scheduler.now, 333, "parent fiber resumed after child ended"); })
    run(fiber);
    t.atleast(t.expectations, 2, "fiber joined");
});

test("Fiber.join() is a noop if there are no child fibers", t => {
    const fiber = new Fiber().
        exec(K(15)).
        join().
        exec(({ value }) => value * 2 + 1);
    run(fiber);
    t.same(fiber.value, 31, "fiber ended with expected value");
});

test("Fiber.join(delegate) calls the `fiberWillJoin` delegate method before yielding", t => {
    const delegate = {
        fiberWillJoin(...args) {
            t.equal(args, [fiber, scheduler], "`fiberWillJoin` is called with `fiber` and `scheduler` as arguments");
            t.same(Object.getPrototypeOf(this), delegate, "and `this` is a copy of the delegate object");
        }
    };
    const scheduler = new Scheduler();
    const fiber = new Fiber().
        spawn(nop).
        join(delegate);
    run(fiber, scheduler);
    t.atleast(t.expectations, 2, "`fiberWillJoin` was called");
});

test("Fiber.join(delegate) calls the `childFiberDidEnd` delegate when a child fiber ends", t => {
    const delegate = {
        childFiberDidEnd(...args) {
            t.equal(
                args,
                [child, scheduler],
                "`fiberWillJoin` is called with `fiber` (the child fiber) and `scheduler` as arguments"
            );
            t.same(Object.getPrototypeOf(this), delegate, "and `this` is the delegate object");
        }
    };
    const scheduler = new Scheduler();
    const fiber = new Fiber();
    const child = fiber.spawn();
    fiber.join(delegate);
    run(fiber, scheduler);
    t.atleast(t.expectations, 2, "`childFiberDidEnd` was called");
});

test("Fiber.join(All) gathers all child values of a fiber", t => {
    const fiber = new Fiber().
        spawn(fiber => fiber.delay(111).exec(K("A"))).
        spawn(fiber => fiber.exec(K("B"))).
        join(All);
    run(fiber);
    t.equal(fiber.value, ["A", "B"], "values in the right order");
});

test("Fiber.join(All): children and grand-children", t => {
    const fiber = new Fiber().
        spawn(fiber => fiber.
            spawn(fiber => fiber.exec(K("A"))).
            spawn(fiber => fiber.exec(K("B"))).
            join(All)
        ).
        spawn(fiber => fiber.exec(K("C"))).
        spawn(fiber => fiber.
            spawn(fiber => fiber.exec(K("D"))).
            spawn(fiber => fiber.exec(K("E"))).
            join(All)
        ).
        join(All);
    run(fiber);
    t.equal(fiber.value, [["A", "B"], "C", ["D", "E"]], "all values are gathered in depth-first order");
});

test("Fiber.join(Last) gathers all child values of a fiber in the order in which they end", t => {
    const fiber = new Fiber().
        spawn(fiber => fiber.delay(111).exec(K("B"))).
        spawn(fiber => fiber.exec(K("A"))).
        join(Last);
    run(fiber);
    t.equal(fiber.value, ["A", "B"], "values in ending order");
});

test("Fiber.join(Last): children and grand-children", t => {
    const fiber = new Fiber().
        spawn(fiber => fiber.
            delay(1111).
            spawn(fiber => fiber.delay(333).exec(K("E"))).
            spawn(fiber => fiber.exec(K("D"))).
            join(Last)
        ).
        spawn(fiber => fiber.
            spawn(fiber => fiber.exec(K("A"))).
            spawn(fiber => fiber.exec(K("B"))).
            join(Last)
        ).
        spawn(fiber => fiber.exec(K("C"))).
        join(Last);
    run(fiber);
    t.equal(fiber.value, [["A", "B"], "C", ["D", "E"]], "all values are gathered in depth-first order");
});

// 4E0F Cancel error

test("Fiber.join(Gate) cancels sibling fibers", t => {
    const fiber = new Fiber().
        exec(K("ok")).
        spawn(fiber => fiber.
            delay(111).
            either(({ error }, scheduler) => {
                t.same(error.message, "cancelled", "fiber was cancelled");
                t.same(scheduler.now, 0, "delay was skipped");
            })
        ).
        spawn(fiber => fiber.exec(K("ko"))).
        join(Gate);
    run(fiber);
    t.equal(fiber.value, "ok", "did not change the fiber value");
});
test("Fiber.join(First) cancels sibling fibers", t => {
    const fiber = new Fiber().
        spawn(fiber => fiber.
            delay(111).
            either(({ error }, scheduler) => {
                t.same(error.message, "cancelled", "fiber was cancelled");
                t.same(scheduler.now, 0, "delay was skipped");
            })
        ).
        spawn(fiber => fiber.exec(K("ok"))).
        join(First);
    run(fiber);
    t.equal(fiber.value, "ok", "first value won");
});
