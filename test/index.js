import test from "./test.js";
import { nop, clamp, extend, remove, K, PriorityQueue, message, on, off } from "../lib/util.js";
import Fiber, { All, Last, First, Gate } from "../lib/fiber.js";
import Scheduler from "../lib/scheduler.js";

// Utility function to run a fiber synchronously.
function run(fiber, scheduler, until = Infinity) {
    scheduler ??= new Scheduler();
    scheduler.resetFiber(fiber);
    scheduler.resumeFiber(fiber);
    scheduler.clock.now = until;
    return scheduler;
}

// Utility function to run a fiber asynchronously until the scheduler becomes
// idle.
const runAsync = fiber => new Promise(resolve => {
    const scheduler = Scheduler.initWithFiber(fiber);
    on(scheduler, "update", ({ idle }) => {
        if (idle) {
            resolve();
        }
    });
    scheduler.clock.start();
});

test("remove(xs, x)", t => {
    const xs = [1, 2, 3, 4, 5, 2, 2, 2];
    t.same(remove(xs, 2), 2, "the removed element is removed");
    t.equal(xs, [1, 3, 4, 5, 2, 2, 2], "only the first occurrence is removed");
});

// 4J0I Util: clamp

test("clamp(x, min, max) clamps `x` between `min` and `max`", t => {
    t.equal(clamp(19, 17, 23), 19, "x ∈ [min, max]");
    t.equal(clamp(9, 17, 23), 17, "x < min");
    t.equal(clamp(91, 17, 23), 23, "x > max");
    t.equal(clamp(17, 17, 23), 17, "x = min");
    t.equal(clamp(23, 17, 23), 23, "x = max");
});

// 4K0G Instantiate fibers with Object.create()

test("extend(x, ...props) creates a new object from x with additional properties", t => {
    const x = { foo: 1, bar: 2 };
    const y = extend(x, { baz: 3 }, { foo: "ok", quux: 4 });
    t.same(x, Object.getPrototypeOf(y), "the original object is the prototype of the new object");
    t.equal(y, { foo: "ok", bar: 2, baz: 3, quux: 4 }, "the new object has additional/updated properties");
});

// 4E0A Priority queue

test("new PriorityQueue(cmp?)", t => {
    const queue = new PriorityQueue();
    t.same(queue.length, 0, "empty queue");
    t.same(queue.cmp(17, 23), -6, "default comparison between items");
});

test("PriorityQueue.insert(x), min heap", t => {
    const queue = new PriorityQueue();
    t.same(queue.insert(17), 17, "return the pushed value");
    t.equal(queue, [17], "item in the queue");
    queue.insert(23);
    queue.insert(19);
    queue.insert(7);
    queue.insert(31);
    queue.insert(13);
    t.equal(queue, [7, 17, 13, 23, 31, 19], "items in the queue");
});

test("PriorityQueue.insert(x), max heap", t => {
    const queue = new PriorityQueue((a, b) => b - a);
    queue.insert(17);
    queue.insert(23);
    queue.insert(19);
    queue.insert(7);
    queue.insert(31);
    queue.insert(13);
    t.equal(queue, [31, 23, 19, 7, 17, 13], "items in the queue");
});

test("PriorityQueue.remove(), min heap", t => {
    const queue = new PriorityQueue();
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

test("PriorityQueue.remove(), max heap", t => {
    const queue = new PriorityQueue((a, b) => b - a);
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

test("PriorityQueue.remove(), randomized", t => {
    let ops = 0;
    const queue = new PriorityQueue((a, b) => (++ops, a - b));
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

test("PriorityQueue.remove(at), min heap", t => {
    const queue = new PriorityQueue();
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

test("PriorityQueue.remove(at), last element", t => {
    const queue = new PriorityQueue();
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
    t.true(A.handled, "message was handled");
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
    t.same(scheduler.now, 0, "begins at 0");
    const fiber = new Fiber().
        spawn(fiber => fiber.
            delay(37).
            effect((_, scheduler) => { t.same(scheduler.now, 37, "is set when a fiber runs (37)"); })
        ).
        spawn(fiber => fiber.
            delay(23).
            effect((_, scheduler) => { t.same(scheduler.now, 23, "is set when a fiber runs (23)"); })
        )
    run(fiber, scheduler, 97);
    t.same(scheduler.now, 97, "is set after all updates complete");
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
    t.expectsError = true;
    const fiber = new Fiber().
        exec(K(17)).
        exec(() => { throw Error("AUGH"); });
    run(fiber);
    t.undefined(fiber.value, "the fiber has no value");
    t.same(fiber.error.message, "AUGH", "the error is caught");
});

test("Fiber.exec(f) does not run after an error", t => {
    t.expectsError = true;
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
    t.true(ran, "effect ran");
    t.same(fiber.value, 19, "but the fiber value is unchanged");
});

test("Fiber.effect(f) catches errors", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        exec(K(17)).
        effect(() => { throw Error("AUGH"); });
    run(fiber);
    t.undefined(fiber.value, "the fiber has no value");
    t.same(fiber.error.message, "AUGH", "the error is caught");
});

test("Fiber.effect(f) does not run after an error", t => {
    t.expectsError = true;
    let ran = false;
    const fiber = new Fiber().
        exec(() => { throw Error("AUGH"); }).
        effect(() => { ran = true; });
    run(fiber);
    t.same(ran, false, "the effect did not run");
    t.same(fiber.error.message, "AUGH", "the error was caught");
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
    scheduler.clock.now = Infinity;
    t.same(fiber.value, -31, "fiber execution resumed after event was dispatched");
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
    scheduler.clock.now = Infinity;
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
                t.true(event.target === window && event.type === "hello", "`event` is the first argument");
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
                t.true(event.from === A && event.type === "hello", "`event` is the first argument");
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
            t.true(event.target === window && event.type === "hello", "`event` is the first argument");
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
            t.true(event.from === A && event.type === "hello", "`event` is the first argument");
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
                t.same(args[1].parent, fiber, "the second argument is a child fiber");
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
    t.expectsError = true;
    const fiber = new Fiber().
        exec(K(19)).
        repeat(fiber => fiber.exec(({ value }) => value + 1));
    run(fiber);
    t.undefined(fiber.value, "the fiber has no value");
    t.ok(fiber.error, "the fiber has an error");
});

test("Fiber.repeat does not begin if the fiber is failing", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        effect(() => { throw Error("AUGH"); }).
        repeat(fiber => fiber.effect(() => { t.fail("repeat should not begin"); })).
        either(fiber => fiber.exec(({ error }) => error.message === "AUGH"));
    run(fiber);
    t.same(fiber.value, true, "repeat did not begin");
});

test("Fiber.repeat does not continue when the fiber is failing", t => {
    t.expectsError = true;
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
            t.same(scheduler.now, 0, "time before delay");
        }).
        delay(777).
        exec((_, scheduler) => scheduler.now);
    run(fiber);
    t.same(fiber.value, 777, "fiber resumed after the delay");
});

test("Fiber.delay(dur)", t => {
    const fiber = new Fiber().
        delay(-777).
        delay(0).
        delay(true).
        exec((_, scheduler) => scheduler.now);
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
        exec((_, scheduler) => scheduler.now);
    run(fiber, scheduler);
    t.same(fiber.value, 333, "fiber resumed after the delay returned by the `dur` function");
});

test("Fiber delay fails if `dur` is a function that fails", t => {
    t.expectsError = true;
    const scheduler = new Scheduler();
    const fiber = new Fiber().
        delay(() => { throw Error("AUGH"); }).
        either(fiber => fiber.exec((_, scheduler) => scheduler.now));
    run(fiber);
    t.same(fiber.value, 0, "no delay");
});

test("Fiber.delay is skipped when the fiber is failing", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        exec(() => { throw "AUGH"; }).
        delay(999).
        either(fiber => fiber.exec((_, scheduler) => scheduler.now));
    run(fiber);
    t.same(fiber.value, 0, "no delay");
});

test("Fiber.delay(dur): dur function may be evaluated several times", t => {
    const delays = [111, 222, 333];
    const fiber = new Fiber().
        repeat(fiber => fiber.delay(() => delays.shift()), {
            repeatShouldEnd: () => delays.length === 0
        });
    run(fiber);
    t.same(fiber.endTime, 666, "three different delays");
});

// 4E0C Spawn

test("Fiber.spawn() creates a new fiber immediately", t => {
    const fiber = new Fiber();
    const child = fiber.spawn();
    t.true(child !== fiber && child instanceof Fiber, "the child fiber is returned");
});

test("Fiber.spawn(f) creates a new fiber immediately", t => {
    const fiber = new Fiber();
    t.same(fiber.spawn(child => {
        t.true(child !== fiber && child instanceof Fiber,
            "the function parameter is called with the child fiber as argument")
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
    t.expectsError = true;
    const fiber = new Fiber().
        effect(() => { throw Error("AUGH"); }).
        spawn(fiber => fiber.
            effect(() => { t.fail("child fiber should not begin"); })
        );
    run(fiber);
    t.same(t.expectations, 0, "parent is failing");
});

test("Fiber.spawn resets the child fiber immediately with the value of the parent", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        exec(K(17)).
        spawn(fiber => fiber.effect(({ value }) => { t.same(value, 17, "first fiber got the current parent value"); })).
        effect(() => { throw Error("AUGH"); }).
        either(fiber => fiber.
            spawn(fiber => fiber.
                either(
                    fiber => fiber.effect(() => { t.fail("second fiber should begin with an error"); }),
                    fiber => fiber.exec(({ error }) => {
                        t.same(error.message, "AUGH", "second fiber has an error");
                        return 23;
                    })
                )
            ).
            join(All)
        ).
        effect(({ value }) => { t.equal(value, [17, 23], "children ended with expected values"); });
    run(fiber);
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
            t.same(args.length, 2, "`childFiberDidEnd` is called with two arguments");
            t.same(child, Object.getPrototypeOf(args[0]), "an instance of the child fiber is the first argument");
            t.same(scheduler, args[1], "`scheduler` is the second argument");
            t.same(Object.getPrototypeOf(this), delegate, "and `this` is the delegate object");
        }
    };
    const scheduler = new Scheduler();
    const fiber = new Fiber();
    const child = fiber.spawn();
    fiber.join(delegate);
    run(fiber, scheduler);
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

test("Repeated spawning", t => {
    let v = 0;
    const fiber = new Fiber().
        exec(K(0)).
        repeat(fiber => fiber.
            spawn(fiber => fiber.delay(111)).
            join().
            exec(({ value }) => value + 1).
            effect(({ value }) => v = value)
        );
    const scheduler = new Scheduler();
    run(fiber, scheduler, 200);
    t.same(v, 1, "first iteration");
    scheduler.clock.now = 500;
    t.same(v, 4, "more iterations");
    t.same(fiber.value, 0, "base fiber value does not change during the repeat");
});

// 4E0E Attach

test("Scheduler.attachFiber()", t => {
    run(new Fiber().
        exec(K(3)).
        effect((fiber, scheduler) => {
            const n = fiber.value;
            for (let i = 0; i < n; ++i) {
                scheduler.attachFiber(fiber);
            }
        }).
        join(All).
        effect(({ value }) => { t.equal(value, [3, 3, 3], "fibers were attached"); })
    );
});

// 4E0F Cancel error

test("Cancel the current event listener", t => {
    const fiber = new Fiber().
        event(window, "hello", {
            eventShouldBeIgnored() {
                t.fail("event delegate should not be called");
            }
        });
    const scheduler = new Scheduler();
    run(fiber, scheduler);
    scheduler.cancelFiber(fiber);
    t.true(fiber.isCancelled, "fiber is cancelled");
    window.dispatchEvent(new CustomEvent("hello"));
});

test("Self cancellation", t => {
    const fiber = new Fiber().
        exec(K("ko")).
        effect((fiber, scheduler) => scheduler.cancelFiber(fiber));
    run(fiber);
    t.true(fiber.isCancelled, "fiber cancelled itself");
});

test("Fiber.join(First) cancels sibling fibers and sets the fiber value", t => {
    const fiber = new Fiber().
        spawn(fiber => fiber.
            delay(111).
            either(fiber => fiber.
                effect((fiber, scheduler) => {
                    t.true(fiber.isCancelled, "fiber is cancelled");
                    t.same(scheduler.now, 0, "delay was skipped");
                })
            )
        ).
        spawn(fiber => fiber.exec(K("ok"))).
        join(First);
    run(fiber);
    t.equal(fiber.value, "ok", "first value won");
});

test("Fiber.join(First) cancels sibling fibers and sets the fiber value", t => {
    const fiber = new Fiber().
        spawn(fiber => fiber.exec(K("ok"))).
        spawn(fiber => fiber.
            either(fiber => fiber.
                effect((fiber, scheduler) => { t.true(fiber.isCancelled, "fiber was cancelled"); })
            )
        ).
        join(First);
    run(fiber);
    t.equal(fiber.value, "ok", "first value won (sync)");
});

test("Cancel pending children when joining", t => {
    const fiber = new Fiber().
        spawn(fiber => fiber.
            spawn(fiber => fiber.
                delay(1111).
                effect(() => { t.fail("child of cancelled fiber should be cancelled"); })
            ).
            join()
        ).
        spawn(nop).
        join(First);
    run(fiber);
    t.pass();
});

test("Fiber.join(Gate) cancels sibling fibers and does not set its value", t => {
    const fiber = new Fiber().
        exec(K("ok")).
        spawn(fiber => fiber.
            delay(111).
            either(fiber => fiber.
                effect((fiber, scheduler) => {
                    t.true(fiber.isCancelled, "fiber was cancelled");
                    t.same(scheduler.now, 0, "delay was skipped");
                })
            )
        ).
        spawn(fiber => fiber.exec(K("ko"))).
        join(Gate);
    run(fiber);
    t.equal(fiber.value, "ok", "did not change the fiber value");
});

test("Do not cancel child when not joining", t => {
    const fiber = new Fiber().
        spawn(fiber => fiber.
            spawn(fiber => fiber.
                delay(1111).
                effect(() => { t.pass("child of cancelled fiber was not cancelled"); })
            )
        ).
        spawn(nop).
        join(First);
    run(fiber);
    t.atleast(t.expectations, 1, "child fiber kept running");
});

// 4E0G Retry

test("Fiber.either(f) recovers from errors", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        effect(() => { throw Error("AUGH"); }).
        either(fiber => fiber.exec(({ error }) => error.message === "AUGH"));
    run(fiber);
    t.true(fiber.value, "error was handled");
    t.undefined(fiber.error, "no more error");
});

test("Fiber.either(f, g) handles values (with f) or errors (with g)", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        effect(() => { throw Error("AUGH"); }).
        either(
            fiber => fiber.effect(() => { t.fail("value branch should not run"); }),
            fiber => fiber.exec(({ error }) => error.message === "AUGH")
        );
    run(fiber);
    t.same(t.expectations, 0, "value branch did not run");
    t.true(fiber.value, "error was handled");
    t.undefined(fiber.error, "no more error");
});

test("Fiber.either(f, g) handles values (with f) or errors (with g)", t => {
    const fiber = new Fiber().
        exec(K(17)).
        either(
            fiber => fiber.exec(({ value }) => value * 3),
            fiber => fiber.effect(() => { t.fail("error branch should not run"); })
        );
    run(fiber);
    t.same(t.expectations, 0, "error branch did not run");
    t.same(fiber.value, 51, "value branch did run");
    t.undefined(fiber.error, "no more error");
});

test("Error within value of branch of either", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        either(
            fiber => fiber.
                effect(() => { throw Error("AUGH"); }).
                effect(() => { t.fail("error should not be handled here"); }),
            nop
        ).
        either(fiber => fiber.exec(K("ok")));
    run(fiber);
    t.same(fiber.value, "ok", "error was handled in second either");
});

test("Normal execution resumes after either", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        effect(() => { throw Error("AUGH"); }).
        either(fiber => fiber.effect(({ error }) => { t.same(error.message, "AUGH", "error is being handled"); })).
        exec(K(23));
    run(fiber);
    t.atleast(t.expectations, 1, "was error handled?");
    t.same(fiber.error.message, "AUGH", "error was actually not handled");
    t.undefined(fiber.value, "the fiber has no value");
});

test("Either and delay", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        effect(() => { throw Error("AUGH"); }).
        delay(2222).
        either(fiber => fiber.delay(777).exec(K("ok"))).
        effect((fiber, scheduler) => {
            t.same(fiber.value, "ok", "error was eventually handled");
            t.same(scheduler.now, 777, "first delay did not apply");
        });
    run(fiber);
});

test("Either and event", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        effect(() => { throw Error("AUGH"); }).
        either(fiber => fiber.event(window, "hello", {
            eventWasHandled(_, fiber) {
                fiber.value = "ok";
            }
        }));
    const scheduler = run(fiber, new Scheduler(), 1);
    window.dispatchEvent(new CustomEvent("hello"));
    scheduler.clock.now = Infinity;
    t.same(fiber.value, "ok", "event was handled despite error");
});

test("Either and repeat", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        effect(() => { throw Error("AUGH"); }).
        either(fiber => fiber.
            repeat(fiber => fiber.nop, {
                repeatShouldEnd: (n, fiber) => {
                    t.same(fiber.error.message, "AUGH", `fiber is ${n > 0 ? "still" : ""} failing`);
                    return n > 1;
                }
            })
        ).
        effect(() => { t.fail("error was not handled"); });
    run(fiber);
    t.atleast(t.expectations, 3, "repeat went through several iterations");
});

test("Either and spawn", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        exec(K(17)).
        effect(() => { throw Error("AUGH"); }).
        either(fiber => fiber.
            spawn(fiber => fiber.
                effect(fiber => {
                    t.same(fiber.error.message, "AUGH", "spawned child with error from the parent");
                    t.undefined(fiber.value, "and no value");
                })
            )
        );
    run(fiber);
    t.atleast(t.expectations, 2, "fiber was spawned");
});

test("Nesting either(f)", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        effect(() => { throw Error("AUGH"); }).
        either(fiber => fiber.
            effect(({ error }) => { t.same(error.message, "AUGH", "first time to see the error"); }).
            either(fiber => fiber.
                effect(({ error }) => { t.same(error.message, "AUGH", "second time to see the error"); })
            ).
            effect(({ error }) => { t.same(error.message, "AUGH", "third time to see the error"); })
        ).
        effect(() => { t.fail("the error cannot be seen anymore"); });
    run(fiber);
    t.same(t.expectations, 3, "error was seen at every step");
    t.same(fiber.error.message, "AUGH", "error was not handled");
    t.undefined(fiber.value, "the fiber has no value");
});

test("Nesting either(f, g)", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        exec(K("...")).
        either(fiber => fiber.
            repeat(fiber => fiber.
                either(nop, fiber => fiber.delay(555)).
                exec((fiber, scheduler) => {
                    const now = scheduler.now;
                    if (now === 0) {
                        t.same(fiber.value, "...", "first try");
                    } else {
                        t.same(fiber.error.message, "AUGH", "last try failed, keep trying");
                    }
                    if (now < 1111) {
                        throw Error("AUGH");
                    }
                    return `ok@${now}`;
                }), { repeatShouldEnd: n => n > 3 }
            )
        );
    run(fiber);
    t.same(fiber.value, "ok@1665", "retried twice");
});

test("Either(f, g) should restore state correctly", t => {
    const fiber = new Fiber().
        spawn(fiber => fiber.
            exec(K("ok")).
            either(
                fiber => fiber.effect(() => t.pass("fiber has a value")),
                fiber => fiber.effect(() => t.fail("fiber should have a value"))
            ).
            delay(777).
            effect(() => { t.fail("fiber should be cancelled"); })
        ).
        spawn(fiber => fiber.delay(111)).
        join(First);
    run(fiber);
});

// 4G05 SMIL timing specifiers

import { parseOffsetValue } from "../lib/util.js";

test("parseOffsetValue(value) parses an offset value", t => {
    t.same(parseOffsetValue("02:30:03"), 2 * 3600000 + 30 * 60000 + 3000, `"02:30:03" (full clock value)`);
    t.same(parseOffsetValue("50:00:10.25"), 50 * 3600000 + 10250, `"50:00:10.25" (full clock value with fraction)`);
    t.same(parseOffsetValue("02:33"), 2 * 60000 + 33000, `"02:33" (partial clock value)`);
    t.same(parseOffsetValue("00:10.5"), 10500, `"00:10.5" (partial clock value with fraction)`);
    t.same(parseOffsetValue("3.2h"), 3 * 3600000 + 12 * 60000, `"3.2h" (timecount value with fraction, hours)`);
    t.same(parseOffsetValue("45min"), 45 * 60000, `"45min" (timecount value, minutes)`);
    t.same(parseOffsetValue("30s"), 30000, `"30s" (timecount value, seconds)`);
    t.same(parseOffsetValue("5ms"), 5, `"5ms" (timecount value, milliseconds)`);
    t.same(parseOffsetValue("12.467"), 12467, `"12.467" (timecount value, seconds as default unit)`);
    t.same(parseOffsetValue(`  -   2.   

        4   


    `), -2400, "ignore whitespace");
    t.same(parseOffsetValue(" +2 Min "), 120000, "case independent matching");
});

test("Fiber.delay(dur) accepts a string as input", t => {
    const fiber = new Fiber().
        delay("23s").
        effect((_, scheduler) => {
            t.same(scheduler.now, 23000, "duration was parsed correctly");
        });
    run(fiber);
});

test("Fiber.delay(dur) accepts a function returning a string as input", t => {
    const fiber = new Fiber().
        exec(K(17)).
        delay(({ value }) => `01:${value}`).
        effect((_, scheduler) => {
            t.same(scheduler.now, 77000, "duration was parsed correctly");
        });
    run(fiber);
});

test("Fiber.delay(dur) has no effect with a negative offset ", t => {
    const fiber = new Fiber().
        delay("-1h").
        effect((_, scheduler) => {
            t.same(scheduler.now, 0, "no delay");
        });
    run(fiber);
});

test("Fiber.delay(dur) has no effect when the duration cannot be parsed", t => {
    t.expectsWarning = true;
    const fiber = new Fiber().
        delay("for a while").
        effect((_, scheduler) => {
            t.same(scheduler.now, 0, "no delay");
        });
    run(fiber);
});

// 4G0G Dynamic delay duration

test("Scheduler.updateDelayForFiber(fiber) can set a new (longer) duration for an ongoing delay", t => {
    const fiber = new Fiber().
        delay(777).
        effect((_, scheduler) => {
            t.same(scheduler.now, 999, "delay was lenghtened");
        });
    const scheduler = run(fiber, new Scheduler(), 666);
    scheduler.updateDelayForFiber(fiber, 999);
    scheduler.clock.now = Infinity;
});

test("Scheduler.updateDelayForFiber(fiber) can set a new (shorter) duration for an ongoing delay", t => {
    const fiber = new Fiber().
        delay(777).
        effect((_, scheduler) => {
            t.same(scheduler.now, 444, "delay was shortened");
        });
    const scheduler = run(fiber, new Scheduler(), 200);
    scheduler.updateDelayForFiber(fiber, 444);
    scheduler.clock.now = Infinity;
});

test("Scheduler.updateDelayForFiber(fiber) can set a new (shorter) duration for an ongoing delay", t => {
    const fiber = new Fiber().
        delay(777).
        effect((_, scheduler) => {
            t.same(scheduler.now, 200, "delay ended now");
        });
    const scheduler = run(fiber, new Scheduler(), 200);
    scheduler.updateDelayForFiber(fiber, 111);
    scheduler.clock.now = Infinity;
});

// 4G0D Ramp

test("Fiber.ramp(dur, delegate) creates a ramp", t => {
    const dur = 1111;
    const delegate = {
        rampDidProgress(...args) {
            const [p] = args;
            if (fiber.beginTime === scheduler.now) {
                t.same(args.length, 3, "the delegate `rampDidProgress` method is called with three arguments");
                t.typeof(p, "number", "`p` is the first argument");
                t.same(args[1], fiber, "`fiber` is the second argument");
                t.same(args[2], scheduler, "`scheduler` is the third argument");
                t.same(Object.getPrototypeOf(this), delegate, "and `this` is an instance of the delegate object");
                t.same(p, 0, "begin the ramp with p=0");
            } else {
                t.same(p, 1, "end the ramp with p=1");
                t.same(scheduler.now - fiber.beginTime, dur, "after the duration of the ramp");
            }
        }
    };
    const scheduler = new Scheduler();
    const fiber = new Fiber().ramp(dur, delegate);
    run(fiber, scheduler);
});

test("Fiber.ramp(dur, delegate) creates a ramp", t => {
    const expected = [0, 0.2, 0.9, 1];
    const fiber = new Fiber().
        delay(222).
        ramp(100, {
            rampDidProgress(p) {
                t.same(p, expected[0], `p === ${expected[0]}`);
                expected.shift();
            }
        });
    const scheduler = run(fiber, new Scheduler(), 242);
    scheduler.clock.now = 312;
    scheduler.clock.now = 777;
    t.equal(expected, [], "ramp went through all expected values of p");
});

test("Fiber.ramp(Infinity, delegate) creates an infinite ramp", t => {
    const fiber = new Fiber().
        delay(222).
        ramp(Infinity, {
            rampDidProgress(p) { t.same(p, 0, "p is always 0 when duration is infinite"); }
        });
    const scheduler = run(fiber, new Scheduler(), 242);
    scheduler.clock.now = 312;
    scheduler.clock.now = 777;
});

test("Scheduler.updateDelayForFiber(fiber) can set a new (longer) duration for an ongoing ramp", t => {
    const fiber = new Fiber().
        ramp(777).
        effect((_, scheduler) => {
            t.same(scheduler.now, 999, "ramp duration was lenghtened");
        });
    const scheduler = run(fiber, new Scheduler(), 666);
    scheduler.updateDelayForFiber(fiber, 999);
    scheduler.clock.now = Infinity;
});

test("Scheduler.updateDelayForFiber(fiber) can set a new (shorter) duration for an ongoing ramp", t => {
    const fiber = new Fiber().
        ramp(777).
        effect((_, scheduler) => {
            t.same(scheduler.now, 444, "ramp duration was shortened");
        });
    const scheduler = run(fiber, new Scheduler(), 200);
    scheduler.updateDelayForFiber(fiber, 444);
    scheduler.clock.now = Infinity;
});

test("Scheduler.updateDelayForFiber(fiber) can set a new (shorter) duration for an ongoing ramp", t => {
    const fiber = new Fiber().
        delay(777).
        effect((_, scheduler) => {
            t.same(scheduler.now, 200, "ramp ended now");
        });
    const scheduler = run(fiber, new Scheduler(), 200);
    scheduler.updateDelayForFiber(fiber, 111);
    scheduler.clock.now = Infinity;
});

test("Scheduler.updateDelayForFiber(fiber) has no effect when the fiber is not being delayed", t => {
    const fiber = new Fiber().
        event(window, "hello").
        effect((_, scheduler) => {
            t.same(scheduler.now, 1111, "fiber ended at the expected time");
        });
    const scheduler = run(fiber, new Scheduler(), 200);
    scheduler.updateDelayForFiber(fiber, 111);
    scheduler.clock.now = 1111;
    window.dispatchEvent(new CustomEvent("hello"));
    scheduler.clock.now = Infinity;
});

// 4C08 Fiber rate > 0

test("Scheduler.setRateForFiber() sets the rate of the fiber", t => {
    const fiber = new Fiber().
        effect((fiber, scheduler) => scheduler.setRateForFiber(fiber, 2)).
        delay(888).
        effect((_, scheduler) => {
            t.same(scheduler.now, 444, "delay was halved as rate was set to 2");
        })
    run(fiber);
});

test("Scheduler.setRateForFiber() sets the rate of the fiber when running", t => {
    const fiber = new Fiber().
        spawn(fiber => fiber.named("delay").
            delay(888).
            effect((_, scheduler) => {
                t.same(scheduler.now, 555, "delay was shortened as rate was set to 2");
            })
        ).
        spawn(fiber => fiber.
            delay(222).
            effect((_, scheduler) => { scheduler.setRateForFiber(scheduler.fiberNamed("delay"), 2); })
        );
    run(fiber);
});

test("Scheduler.setRateForFiber() affects ramps as well as delays", t => {
    const ps = [0, 0.1, 0.5, 1];
    const fiber = new Fiber().
        effect((fiber, scheduler) => { scheduler.setRateForFiber(fiber, 0.5); }).
        ramp(400, {
            rampDidProgress(p) {
                t.same(p, ps.shift(), `ramp did progress (${p})`);
            }
        }).
        effect((_, scheduler) => {
            t.same(scheduler.now, 800, "ramp duration was doubled as rate was set to 0.5");
        });
    const scheduler = run(fiber, new Scheduler(), 80);
    scheduler.clock.now = 400;
    scheduler.clock.now = Infinity;
    t.equal(ps, [], "ramp went through all steps");
});

test("Scheduler.setRateForFiber() sets the rate of the fiber for ramps as well when running", t => {
    const ps = [0, 0.2, 0.625, 1];
    const fiber = new Fiber().
        spawn(fiber => fiber.named("ramp").
            ramp(400, {
                rampDidProgress(p) {
                    t.same(p, ps.shift(), `ramp did progress (${p})`)
                }
            }).
            effect((_, scheduler) => {
                t.same(scheduler.now, 200, "ramp duration was halved as rate was set to 3 at p=0.25");
            })
        ).
        spawn(fiber => fiber.
            delay(100).
            effect((_, scheduler) => {
                scheduler.setRateForFiber(scheduler.fiberNamed("ramp"), 3);
            })
        );
    const scheduler = run(fiber, new Scheduler(), 80);
    scheduler.clock.now = 150;
    scheduler.clock.now = Infinity;
    t.equal(ps, [], "ramp went through all steps");
});

// 4H02 Fiber rate = 0

test("Setting rate to 0", t => {
    const fiber = new Fiber().
        effect((fiber, scheduler) => scheduler.setRateForFiber(fiber, 0)).
        effect((_, scheduler) => { t.fail("fiber should be paused immediately"); }).
        delay(888).
        effect((_, scheduler) => { t.fail("fiber should not run to this point"); })
    run(fiber);
    t.same(t.expectations, 0, "nothing happens when the fiber is paused");
});

test("Setting rate to 0 then resuming", t => {
    const fiber = new Fiber().
        spawn(fiber => fiber.named("paused").
            effect((fiber, scheduler) => { scheduler.setRateForFiber(fiber, 0); }).
            delay(888).
            effect((fiber, scheduler) => {
                t.same(fiber.now, 888, "local time");
                t.same(scheduler.now, 999, "fiber eventually resumed");
            })
        ).
        spawn(fiber => fiber.
            delay(111).
            effect((_, scheduler) => { scheduler.setRateForFiber(scheduler.fiberNamed("paused"), 1); })
        );
    run(fiber);
});

test("Setting rate to 0 during a delay", t => {
    const fiber = new Fiber().
        spawn(fiber => fiber.named("paused").
            delay(333).
            effect((fiber, scheduler) => {
                t.same(fiber.now, 333, "fiber local time");
                t.same(scheduler.now, 999, "fiber eventually resumed");
            })
        ).
        spawn(fiber => fiber.
            delay(111).
            effect((_, scheduler) => { scheduler.setRateForFiber(scheduler.fiberNamed("paused"), 0); }).
            delay(666).
            effect((_, scheduler) => { scheduler.setRateForFiber(scheduler.fiberNamed("paused"), 1); })
        );
    run(fiber);
});
 
test("Setting rate to 0 during a ramp", t => {
    const ps = [0, 0.25, 0.5, 1];
    const fiber = new Fiber().
        spawn(fiber => fiber.named("paused").
            ramp(400, {
                rampDidProgress(p) {
                    t.same(p, ps.shift(), `ramp is progressing (p=${p})`);
                }
            }).
            effect((fiber, scheduler) => {
                t.same(fiber.now, 400, "fiber local time");
                t.same(scheduler.now, 1400, "ramp ended as expected");
            })
        ).
        spawn(fiber => fiber.
            delay(100).
            effect((_, scheduler) => { scheduler.setRateForFiber(scheduler.fiberNamed("paused"), 0); }).
            delay(1000).
            effect((_, scheduler) => { scheduler.setRateForFiber(scheduler.fiberNamed("paused"), 1); })
        );
    const scheduler = run(fiber, new Scheduler(), 100);
    scheduler.clock.now = 500;
    scheduler.clock.now = 1200;
    scheduler.clock.now = Infinity;
    t.equal(ps, [], "ramp went through all steps");
});

// 4H04 Fiber rate = ∞

test("Setting rate to ∞ (zero-duration delay)", t => {
    const fiber = new Fiber().
        effect((fiber, scheduler) => scheduler.setRateForFiber(fiber, Infinity)).
        delay(888).
        effect((fiber, scheduler) => {
            t.same(fiber.now, 888, "fiber local time");
            t.same(scheduler.now, 0, "delay passed infinitely fast");
        });
    run(fiber);
});

test("Setting rate to ∞ (zero-duration ramp)", t => {
    const ps = [0, 1];
    const fiber = new Fiber().
        effect((fiber, scheduler) => scheduler.setRateForFiber(fiber, Infinity)).
        ramp(888, {
            rampDidProgress(p, _, scheduler) {
                t.same(p, ps.shift(), "ramp goes through expected steps");
                t.same(fiber.now, p === 0 ? 0 : 888, "fiber local time");
                t.same(scheduler.now, 0, "ramp has effectively zero duration");
            }
        });
    run(fiber);
    t.equal(ps, [], "ramp went through all steps");
});

test("Events still take time at infinite rate", t => {
    const fiber = new Fiber().
        spawn(fiber => fiber.
            effect((fiber, scheduler) => { scheduler.setRateForFiber(fiber, Infinity); }).
            delay(888).
            event(window, "hello").
            delay(777).
            // FIXME 4A05 Fiber local time
            effect((_, scheduler) => { t.same(scheduler.now, 222, "event time"); })
        );
    const scheduler = run(fiber, new Scheduler(), 111);
    scheduler.clock.now = 222;
    window.dispatchEvent(new CustomEvent("hello"));
    scheduler.clock.now = Infinity;
});

// 4H06 Rate from parent

test("Setting rate of parent fiber sets child rates as well", t => {
    const fiber = new Fiber().
        spawn(fiber => fiber.
            effect((fiber, scheduler) => { scheduler.setRateForFiber(fiber, 0.5); }).
            delay(2400).
            effect((_, scheduler) => { t.same(scheduler.now, 1700, "first child ended later as expected"); })
        ).
        spawn(fiber => fiber.
            effect((fiber, scheduler) => { scheduler.setRateForFiber(fiber, 2); }).
            delay(2400).
            effect((_, scheduler) => { t.same(scheduler.now, 500, "second child ended earlier as expected"); })
        ).
        delay(150).
        effect((fiber, scheduler) => { scheduler.setRateForFiber(fiber, 3); });
    run(fiber);
});

test("Pausing and resuming children", t => {
    const fiber = new Fiber().
        spawn(fiber => fiber.
            event(window, "hello").
            effect((_, scheduler) => { t.same(scheduler.now, 777, "event happened after the fiber resumed"); })
        );
    const scheduler = run(fiber, new Scheduler(), 111);
    scheduler.setRateForFiber(fiber, 0);
    scheduler.clock.now = 222;
    window.dispatchEvent(new CustomEvent("hello"));
    scheduler.clock.now = 333;
    scheduler.setRateForFiber(fiber, 1);
    scheduler.clock.now = 777;
    window.dispatchEvent(new CustomEvent("hello"));
    scheduler.clock.now = Infinity;
});

// 4H0F Ramps for cancelled fibers

test("Ramp does not begin if a fiber is cancelled", t => {
    const fiber = new Fiber().
        spawn(fiber => fiber.
            delay(1111).
            ramp(Infinity, {
                rampDidProgress() { t.fail("Ramp should not begin"); }
            })
        ).
        spawn(fiber => fiber.delay(1110)).
        join(First);
    run(fiber);
    t.undefined(fiber.error, "ramp did not begin");
});

test("Ramp inside either does begin if a fiber is cancelled", t => {
    const fiber = new Fiber().
        spawn(fiber => fiber.
            delay(1111).
            either(fiber => fiber.
                ramp(555, {
                    rampDidProgress(p, { beginTime }, scheduler) {
                        const localTime = scheduler.now - beginTime;
                        if (p === 0) {
                            t.same(localTime, 999, "ramp began early");
                        } else if (p === 1) {
                            t.same(localTime, 1554, "ramp ended normally")
                        } else {
                            t.fail(`Unexpected p=${p}`);
                        }
                    }
                })
            )
        ).
        spawn(fiber => fiber.delay(999)).
        join(First);
    run(fiber);
});

test("Ramp ends when the fiber is cancelled", t => {
    const ps = [0, 0.25];
    const fiber = new Fiber().
        spawn(fiber => fiber.
            ramp(888, {
                rampDidProgress(p) {
                    t.same(p, ps.shift(), `ramp is progressing (p=${p})`);
                }
            })
        ).
        spawn(fiber => fiber.delay(777)).
        join(First);
    const scheduler = run(fiber, new Scheduler(), 222);
    scheduler.clock.now = Infinity;
    t.equal(ps, [], "the ramp was cancelled");
});

test("Ramp in either continues when the fiber is cancelled", t => {
    const ps = [0, 0.25, 1];
    const fiber = new Fiber().
        spawn(fiber => fiber.
            either(fiber => fiber.
                ramp(888, {
                    rampDidProgress(p) {
                        t.same(p, ps.shift(), `ramp is progressing (p=${p})`);
                    }
                })
            )
        ).
        spawn(fiber => fiber.delay(777)).
        join(First);
    const scheduler = run(fiber, new Scheduler(), 222);
    scheduler.clock.now = Infinity;
    t.equal(ps, [], "the ramp ended");
});

// 4F04 Handle errors when joining

test("`childFiberDidEnd()` is called when an error occurs", t => {
    t.expectsError = true;
    const delegate = {
        childFiberDidEnd(child) {
            t.same(child.error.message, "AUGH", "the child ended in error");
        }
    };
    const scheduler = new Scheduler();
    const fiber = new Fiber();
    const child = fiber.spawn().effect(() => { throw Error("AUGH"); });
    fiber.join(delegate);
    run(fiber, scheduler);
});

test("All fails with the first error from a child", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        spawn(fiber => fiber.exec(K(1))).
        spawn(fiber => fiber.exec(K(2))).
        spawn(fiber => fiber.effect(() => { throw Error("AUGH"); })).
        spawn(fiber => fiber.exec(K(4))).
        spawn(fiber => fiber.effect(() => { throw Error("AUGH!!!"); })).
        join(All).
        either(fiber => fiber.
            effect(({ error }) => { t.same(error.message, "AUGH", "failed with first error"); })
        );
    run(fiber);
});

test("Last fails with the first error from a child", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        spawn(fiber => fiber.exec(K(1))).
        spawn(fiber => fiber.exec(K(2))).
        spawn(fiber => fiber.effect(() => { throw Error("AUGH"); })).
        spawn(fiber => fiber.exec(K(4))).
        spawn(fiber => fiber.effect(() => { throw Error("AUGH!!!"); })).
        join(Last).
        either(fiber => fiber.
            effect(({ error }) => { t.same(error.message, "AUGH", "failed with first error"); })
        );
    run(fiber);
});

test("First ignores errors...", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        spawn(fiber => fiber.effect(() => { throw Error("AUGH"); })).
        spawn(fiber => fiber.effect(() => { throw Error("AUGH"); })).
        spawn(fiber => fiber.exec(K("ok"))).
        spawn(fiber => fiber.effect(() => { throw Error("AUGH"); })).
        spawn(fiber => fiber.exec(K("ko"))).
        join(First).
        either(fiber => fiber.
            effect(({ value }) => { t.same(value, "ok", "errors were ignored"); })
        );
    run(fiber);
});

test("... unless all children fail", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        spawn(fiber => fiber.effect(() => { throw Error("AUGH!!!"); })).
        spawn(fiber => fiber.effect(() => { throw Error("AUGH!!!!!!"); })).
        spawn(fiber => fiber.effect(() => { throw Error("AUGH"); })).
        join(First).
        either(fiber => fiber.
            effect(({ error }) => { t.same(error.message, "AUGH", "failed with final error"); })
        );
    run(fiber);
});

// 4D0B lift

test("Fiber.macro(f) calls `f` with the fiber as a parameter and returns it for chaining", t => {
    const delays = [17, 71, 23];
    const fiber = new Fiber().
        macro(fiber => {
            for (const delay of delays) {
                fiber.spawn(fiber => fiber.delay(delay).exec(K(delay)));
            }
        }).
        join(All).
        effect(({ value }, scheduler) => {
            t.same(scheduler.now, Math.max(...delays), "delays were applied");
            t.equal(value, delays, "expected values were produced");
        });
    run(fiber);
});

// 250A Map

test("Fiber.map(f) spawns a fiber with f for every item in the fiber value (array)", t => {
    run(new Fiber().
        exec(K([17, 31, 23])).
        map(fiber => fiber.exec(({ value: x }) => 2 * x + 1)).
        join(All).
        effect(({ value: xs }) => { t.equal(xs, [35, 63, 47], "each value was computed"); })
    );
});

test("Fiber.map(f) spawns a fiber with f for every item in the fiber value (set)", t => {
    run(new Fiber().
        exec(K(new Set([17, 31, 23]))).
        map(fiber => fiber.exec(({ value: x }) => x > 0)).
        join(All).
        effect(({ value: xs }) => { t.equal(xs, [true, true, true], "each value was computed"); })
    );
});

test("Fiber.map(f) spawns a fiber with f for every item in the fiber value (object)", t => {
    run(new Fiber().
        exec(K({ foo: 1, bar: 2, baz: 3 })).
        map(fiber => fiber.exec(
            ({ value: [k, v] }) => (k === "foo" && v === 1) || (k === "bar" && v === 2) || (k === "baz" && v === 3)
        )).
        join(All).
        effect(({ value: xs }) => { t.equal(xs, [true, true, true], "each value was computed"); })
    );
});

test("Fiber.map(f) spawns a named fiber with f for every item in the fiber value (map)", t => {
    run(new Fiber().
        exec(K(new Map([["foo", 1], ["bar", 2], ["baz", 3]]))).
        map(fiber => fiber.exec(
            ({ value: [k, v] }) => (k === "foo" && v === 1) || (k === "bar" && v === 2) || (k === "baz" && v === 3)
        )).
        join(All).
        effect(({ value: xs }) => { t.equal(xs, [true, true, true], "each value was computed"); })
    );
});

test("Fiber.map(f) spawns a fiber with f for every item in the fiber value (empty array)", t => {
    run(new Fiber().
        exec(K([])).
        map(fiber => fiber.exec(({ value: x }) => 2 * x + 1)).
        join(All).
        effect(({ value: xs }) => { t.equal(xs, [], "the result is still an empty array"); })
    );
});

test("Fiber.map(f) spawns a single fiber when the value is not a collection", t => {
    run(new Fiber().
        exec(K(23)).
        map(fiber => fiber.exec(({ value: x }) => 2 * x + 1)).
        join(All).
        effect(({ value: xs }) => { t.equal(xs, [47], "the single value was handled"); })
    );
});

test("Fiber.map(f) does nothing if the fiber is failing", t => {
    t.expectsError = true;
    run(new Fiber().
        effect(() => { throw Error("AUGH"); }).
        map(fiber => fiber.exec(({ value: x }) => 2 * x + 1)).
        join(All).
        either(fiber => fiber.effect(({ error }) => { t.equal(error.message, "AUGH", "fiber is still failing"); }))
    );
});

test("Fiber.map(f) treats the error as a single value inside either", t => {
    t.expectsError = true;
    run(new Fiber().
        effect(() => { throw Error("AUGH"); }).
        either(fiber => fiber.
            map(fiber => fiber.exec(({ error }) => error.message.toLowerCase())).
            join(All)
        ).
        effect(({ value }) => { t.equal(value, ["augh"], "fiber recovered"); })
    );
});

// 4A02 Each

test("Fiber.each(f) loops over the items in the fiber value (array)", t => {
    const iterations = [];
    run(new Fiber().
        exec(K([17, 31, 23])).
        each(fiber => fiber.effect(({ value: x }) => { iterations.push(2 * x + 1); })).
        effect(({ value }) => {
            t.equal(value, [17, 31, 23], "original value is unchanged");
            t.equal(iterations, [35, 63, 47], "all values were handled in order");
        })
    );
});

test("Fiber.each(f) loops over the items in the fiber value (set)", t => {
    const iterations = [];
    run(new Fiber().
        exec(K(new Set([17, 31, 23]))).
        each(fiber => fiber.effect(({ value: x }) => { iterations.push(2 * x + 1); })).
        effect(({ value }) => {
            t.equal(value, new Set([17, 31, 23]), "original value is unchanged");
            t.equal(iterations.sort(), [35, 47, 63], "all values were handled in order");
        })
    );
});

test("Fiber.each(f) loops over the items in the fiber value (object)", t => {
    const iterations = [];
    run(new Fiber().
        exec(K({ foo: 1, bar: 2, baz: 3 })).
        each(fiber => fiber.effect(({ value: [k, v] }) => {
            for (let i = 0; i < v; ++i) {
                iterations.push(k);
            }
        })).
        effect(({ value }) => {
            t.equal(value, { foo: 1, bar: 2, baz: 3 }, "original value is unchanged");
            t.equal(iterations.sort(), ["bar", "bar", "baz", "baz", "baz", "foo"], "all values were handled in order");
        })
    );
});

test("Fiber.each(f) loops over the items in the fiber value (map)", t => {
    const map = new Map([["foo", 1], ["bar", 2], ["baz", 3]]);
    const iterations = [];
    run(new Fiber().
        exec(K(map)).
        each(fiber => fiber.effect(({ value: [k, v] }) => {
            for (let i = 0; i < v; ++i) {
                iterations.push(k);
            }
        })).
        effect(({ value }) => {
            t.same(value, map, "original value is unchanged");
            t.equal(iterations.sort(), ["bar", "bar", "baz", "baz", "baz", "foo"], "all values were handled in order");
        })
    );
});

test("Fiber.each(f) loops over the items in the fiber value (empty array)", t => {
    const iterations = [];
    run(new Fiber().
        exec(K([])).
        each(fiber => fiber.effect(({ value: x }) => { iterations.push(2 * x + 1); })).
        effect(({ value }) => {
            t.equal(value, [], "original value is unchanged");
        })
    );
});

test("Fiber.each(f) applies to a non-collection value", t => {
    const iterations = [];
    run(new Fiber().
        exec(K(23)).
        each(fiber => fiber.effect(({ value: x }) => { iterations.push(2 * x + 1); })).
        effect(({ value }) => {
            t.equal(value, 23, "original value is unchanged");
            t.equal(iterations, [47], "ran through a single iteration");
        })
    );
});

test("Fiber.each(f) treats the error as a single value inside either", t => {
    t.expectsError = true;
    const iterations = [];
    run(new Fiber().
        effect(() => { throw Error("AUGH"); }).
        either(fiber => fiber.
            each(fiber => fiber.effect(({ error }) => { iterations.push(error.message.toLowerCase()); })).
            exec(K("ok"))
        ).
        effect(({ value }) => {
            t.equal(iterations, ["augh"], "error was handled");
            t.equal(value, "ok", "fiber recovered");
        })
    );
});

// 4I01 Fiber names are global

test("Fiber.named() with a non-string name", t => {
    run(new Fiber().
        spawn(fiber => fiber.named(Symbol.for("foo")).exec(K(23)).delay(Infinity)).
        spawn(fiber => fiber.
            effect((_, scheduler) => {
                t.same(scheduler.fiberNamed(Symbol.for("foo")).value, 23, "found the fiber by its name");
            })
        )
    );
});

test("Fiber.named() can rename a fiber", t => {
    run(new Fiber().
        spawn(fiber => fiber.
            exec(K(17)).
            named("foo").
            effect(({ name }) => t.same(name, "foo", "initial name")).
            delay(777).
            named("bar").
            effect(({ name }) => t.same(name, "bar", "new name")).
            delay(888)
        ).
        spawn(fiber => fiber.
            effect((_, scheduler) => { t.same(scheduler.fiberNamed("foo").value, 17, "found the fiber by its name"); }).
            delay(999).
            effect((_, scheduler) => {
                t.undefined(scheduler.fiberNamed("foo"), "cannot find the fiber by its old name");
                t.same(scheduler.fiberNamed("bar").value, 17, "found the fiber by its new name");
            }).
            delay(1111).
            effect((_, scheduler) => { t.undefined(scheduler.fiberNamed("bar"), "cannot find the fiber after it ended"); })
        )
    );
});

test("A scheduler only accepts a single running fiber with a given name", t => {
    t.expectsError = true;
    run(new Fiber().
        spawn(fiber => fiber.
            named("foo").
            delay(1111)
        ).
        spawn(fiber => fiber.
            named("foo").
            either(fiber => fiber.
                effect(({ error }) => { t.ok(error, "an error occurred when setting the second fiber name"); })
            )
        ).
        join()
    );
});

test("Names can be reused a different times", t => {
    run(new Fiber().
        exec(K([0, 1])).
        repeat(fiber => fiber.
            spawn(fiber => fiber.named("fib").exec(({ value: [x, y] }) => [y, x + y])).
            join(First),
            { repeatShouldEnd: n => n > 7 }
        ).
        effect(({ value: [, n] }) => { t.same(n, 34, "repeated fib to compute value"); })
    );
});

// 4J0A Delay setting fiber parent
test("Fiber is attached to its parent dynamically", t => {
    let sum = 0;
    run(new Fiber().
        exec(K([[1, 2, 3]])).
        map(fiber => fiber.each(fiber => fiber.effect(({ value }) => { sum += value; }))).
        join().
        effect(() => { t.same(sum, 6, "nesting each within par attaches fibers correctly"); })
    );
});

// 2308 Variable Event

test("Target of event may be a function", t => {
    const scheduler = new Scheduler();
    const fiber = new Fiber().
        event((...args) => {
            t.equal(args, [fiber, scheduler], "which gets called with fiber and scheduler as parameters");
            return window;
        }, "hello", {
            eventWasHandled: event => { t.same(event.target, window, "event target was set correctly"); }
        });
    run(fiber, scheduler, 777);
    window.dispatchEvent(new CustomEvent("hello"));
    scheduler.clock.now = Infinity;
});

test("Type of event may be a function", t => {
    const scheduler = new Scheduler();
    const fiber = new Fiber().
        exec(K("hello")).
        event(window, (...args) => {
            t.equal(args, [fiber, scheduler], "which gets called with fiber and scheduler as parameters");
            return args[0].value;
        }, {
            eventWasHandled: event => { t.same(event.target, window, "event target was set correctly"); }
        });
    run(fiber, scheduler, 777);
    window.dispatchEvent(new CustomEvent("hello"));
    scheduler.clock.now = Infinity;
});

test("Fiber fails if the function fails", t => {
    t.expectsError = true;
    run(new Fiber().
        event(() => { throw Error("AUGH"); }, "foo").
        either(fiber => fiber.
            effect(({ error }) => { t.same(error.message, "AUGH", "error in target function was caught"); })
        )
    );
});

// 4K06 Multiple repeats reuse the same fiber

test("Nested repeats", t => {
    run(new Fiber().
        exec(K([1, 2, 3, 4])).
        map(fiber => fiber.
            exec(({ value }) => ([value, ""])).
            repeat(fiber => fiber.
                delay(111).
                effect(({ value }) => { value[1] += "*"; }),
                { repeatShouldEnd: (i, { value }) => i >= value[0] }
            ).
            exec(({ value }) => value[1])
        ).
        join(All).
        effect(({ value }) => { t.equal(value, ["*", "**", "***", "****"], "all loops ran"); })
    );
});

test("Cancelling repeat", t => {
    const out = [];
    const fiber = new Fiber().
        spawn(fiber => fiber.
            repeat(fiber => fiber.
                delay(111).
                effect(() => { out.push("*"); })
            )
        ).
        spawn(fiber => fiber.delay(500)).
        join(First);
    run(fiber, new Scheduler(), 1111);
    t.equal(out, ["*", "*", "*", "*"], "repeat was cut off after four iterations");
});

// 4J0D Name a running fiber

test("Fiber.named(name)", t => {
    run(new Fiber().
        named("foo").
        effect(({ name }) => { t.same(name, "foo", "names the fiber at runtime"); })
    );
});

// 4K07 Rename lift to macro

test("Fiber.macro(f, ...args) can pass additional parameters to the macro", t => {
    function delayedValue(fiber, value, begin) {
        fiber.delay(begin).exec(K(value));
    }

    run(new Fiber().
        macro(delayedValue, "foo", 333).
        effect(({ value }, scheduler) => {
            t.same(value, "foo", "first value is set");
            t.same(scheduler.now, 333, "after the given delay");
        }).
        macro(delayedValue, "bar", 444).
        effect(({ value }, scheduler) => {
            t.same(value, "bar", "second value is set");
            t.same(scheduler.now, 777, "after the given delay");
        })
    );
});

// 4J0Q Push/pop values

test("Fiber.store(name) stores the current value in the fiber scope", t => {
    run(new Fiber().
        exec(K(19)).
        store("x").
        exec(({ value }) => 2 * value + 1).
        effect(({ scope, value }) => {
            t.same(value, 39, "current value");
            t.same(scope.x, 19, "initial value is accessible through scope");
        })
    );
});

test("Fiber.store() name may be a function", t => {
    const scheduler = new Scheduler();
    const fiber = new Fiber().
        exec(K(19)).
        store((...args) => {
            t.equal(args, [fiber, scheduler], "which gets called with fiber and scheduler as parameters");
            return "x";
        }).
        exec(({ value }) => 2 * value + 1).
        effect(({ scope, value }) => {
            t.same(value, 39, "current value");
            t.same(scope.x, 19, "initial value is accessible through scope");
        });
    run(fiber, scheduler);
});

test("Fiber fails if the name function fails", t => {
    t.expectsError = true;
    run(new Fiber().
        store(() => { throw Error("AUGH"); }).
        either(fiber => fiber.
            effect(({ error }) => { t.same(error.message, "AUGH", "error in name function was caught"); })
        )
    );
});

test("Fiber.scope is inherited when spawning", t => {
    run(new Fiber().
        exec(K(19)).
        store("x").
        exec(({ value }) => 2 * value + 1).
        spawn(fiber => fiber.
            exec(({ scope: { x } }) => 3 * x).
            effect(({ value }) => { t.same(value, 57, "value computed from parent scope"); }).
            store("x").
            effect(({ scope: { x } }) => { t.same(x, 57, "and saved to child scope"); })
        ).
        join(First).
        effect(({ scope: { x }, value }) => {
            t.same(value, 57, "got value from child");
            t.same(x, 19, "parent scope is unchanged");
        })
    );
});

// 4K0F Spawn reuses the same fiber within map or repeat

test("Spawn instantiates its fiber so that it can be reused inside a map", t => {
    run(new Fiber().
        exec(K({ foo: 17, bar: 31, baz: 29 })).
        map(fiber => fiber.
            spawn(fiber => fiber.delay(({ value: [, dur] }) => dur)).
            spawn(fiber => fiber.delay(Infinity)).
            join(First).
            exec(({ value: [v] }) => v)
        ).
        join(Last).
        effect(({ value }) => { t.equal(value, ["foo", "baz", "bar"], "all fibers ran"); })
    );
});

// 4A05 Fiber local time

test("Fiber.now/Scheduler.fiberLocalTime(fiber) return the local time for an active fiber", t => {
    run(new Fiber().
        delay(555).
        spawn(fiber => fiber.named("local").
            delay(333).
            effect((fiber, scheduler) => {
                t.same(scheduler.now, 888, "global time (2)");
                t.same(fiber.now, 333, "local time (now) (2)");
                t.same(scheduler.fiberLocalTime(fiber), 333, "local time (fiberLocalTime) (2)");
                scheduler.setRateForFiber(fiber, 0.5);
            }).
            delay(222).
            effect((fiber, scheduler) => {
                t.same(scheduler.now, 1332, "global time (4)");
                t.same(fiber.now, 555, "local time affected by rate (4)");
                scheduler.setRateForFiber(fiber, 2);
            }).
            delay(222).
            effect((fiber, scheduler) => {
                t.same(scheduler.now, 1443, "global time (5)");
                t.same(fiber.now, 777, "local time affected by rate (5)");
            })
        ).
        spawn(fiber => fiber.
            exec((_, scheduler) => scheduler.fiberNamed("local")).
            delay(222).
            effect(({ value: other }, scheduler) => {
                t.same(scheduler.now, 777, "global time (1)");
                t.same(scheduler.fiberLocalTime(other), 222, "local time for other fiber (1)");
            }).
            delay(222).
            effect(({ value: other }, scheduler) => {
                t.same(scheduler.now, 999, "global time (3)");
                t.same(scheduler.fiberLocalTime(other), 388.5, "local time for other fiber (3)");
            })
        )
    );
});

test("Fiber.now is updated after a delay (including if the delay changed)", t => {
    run(new Fiber().
        delay(555).
        spawn(fiber => fiber.named("local").
            delay(333).
            effect(fiber => { t.same(fiber.now, 222, "delay was rescheduled"); })
        ).
        spawn(fiber => fiber.
            delay(111).
            effect((_, scheduler) => { scheduler.updateDelayForFiber(scheduler.fiberNamed("local"), 222); })
        )
    );
});

test("Fiber.now is updated after a delay (delay is cut short)", t => {
    run(new Fiber().
        delay(555).
        spawn(fiber => fiber.named("local").
            delay(1111).
            effect(fiber => { t.same(fiber.now, 333, "delay was rescheduled"); })
        ).
        spawn(fiber => fiber.
            delay(333).
            effect((_, scheduler) => { scheduler.updateDelayForFiber(scheduler.fiberNamed("local"), 222); })
        )
    );
});

test("Fiber.now is updated during and after a ramp", t => {
    const ps = [[0, 0], [0.5, 222], [1, 444]];
    const fiber = new Fiber().
        delay(555).
        spawn(fiber => fiber.named("local").
            ramp(444, {
                rampDidProgress(p, fiber) {
                    const [pp, tt] = ps.shift();
                    t.same(pp, p, `fiber progress (${pp})`);
                    t.same(tt, fiber.now, `with local time (${tt})`);
                }
            })
        );
    const scheduler = run(fiber, new Scheduler(), 777);
    scheduler.clock.now = Infinity;
});

test("Fiber.now is updated during and after a ramp (including if the duration changed)", t => {
    const ps = [[0, 0, 555], [0.5, 222, 777], [0.7, 700, 1255], [1, 1000, 1555]];
    const fiber = new Fiber().
        delay(555).
        spawn(fiber => fiber.named("local").
            ramp(444, {
                rampDidProgress(p, fiber, scheduler) {
                    const [pp, tt, ttt] = ps.shift();
                    t.same(pp, p, `fiber progress (${pp})`);
                    t.same(tt, fiber.now, `with local time (${tt})`);
                    t.same(ttt, scheduler.now, `and global time (${ttt})`);
                }
            })
        ).
        spawn(fiber => fiber.
            delay(333).
            effect((_, scheduler) => {
                scheduler.updateDelayForFiber(scheduler.fiberNamed("local"), 1000);
            })
        );
    const scheduler = run(fiber, new Scheduler(), 777);
    scheduler.clock.now = 1255;
    scheduler.clock.now = Infinity;
});

test("Fiber.now is updated during and after a ramp (including if the ramp is cut off)", t => {
    const ps = [[0, 0, 555], [0.5, 222, 777], [1, 333, 888]];
    const fiber = new Fiber().
        delay(555).
        spawn(fiber => fiber.named("local").
            ramp(444, {
                rampDidProgress(p, fiber, scheduler) {
                    const [pp, tt, ttt] = ps.shift();
                    t.same(pp, p, `fiber progress (${pp})`);
                    t.same(tt, fiber.now, `with local time (${tt})`);
                    t.same(ttt, scheduler.now, `and global time (${ttt})`);
                }
            })
        ).
        spawn(fiber => fiber.
            delay(333).
            effect((_, scheduler) => {
                scheduler.updateDelayForFiber(scheduler.fiberNamed("local"), 111);
            })
        );
    const scheduler = run(fiber, new Scheduler(), 777);
    scheduler.clock.now = Infinity;
});

test("Fiber.now is updated when an event is received (event)", t => {
    const fiber = new Fiber().
        delay(555).
        spawn(fiber => fiber.
            event(window, "hello").
            effect((fiber, scheduler) => {
                t.same(fiber.now, 222, "local time");
                t.same(scheduler.now, 777, "global time");
            })
        );
    const scheduler = run(fiber, new Scheduler(), 777);
    window.dispatchEvent(new CustomEvent("hello"));
    scheduler.clock.now = Infinity;
});

test("Fiber.now is updated when an event is received (synchronous message)", t => {
    const A = {};
    const fiber = new Fiber().
        delay(555).
        spawn(fiber => fiber.
            event(A, "hello").
            effect((fiber, scheduler) => {
                t.same(fiber.now, 222, "local time");
                t.same(scheduler.now, 777, "global time");
            })
        );
    const scheduler = run(fiber, new Scheduler(), 777);
    message(A, "hello");
    scheduler.clock.now = Infinity;
});

test("Fiber.now is updated when an event is received (infinite rate)", t => {
    const fiber = new Fiber().
        delay(555).
        spawn(fiber => fiber.
            effect((fiber, scheduler) => { scheduler.setRateForFiber(fiber, Infinity); }).
            delay(1111).
            event(window, "hello").
            effect((fiber, scheduler) => {
                t.same(fiber.now, 1111, "local time");
                t.same(scheduler.now, 777, "global time");
            })
        );
    const scheduler = run(fiber, new Scheduler(), 777);
    window.dispatchEvent(new CustomEvent("hello"));
    scheduler.clock.now = Infinity;
});

test("Fiber.now is updated after joining", t => {
    run(new Fiber().
        delay(555).
        spawn(fiber => fiber.
            spawn(fiber => fiber.delay(111)).
            spawn(fiber => fiber.delay(222)).
            spawn(fiber => fiber.delay(333)).
            join().
            effect((fiber, scheduler) => {
                t.same(fiber.now, 333, "local time");
                t.same(scheduler.now, 888, "global time");
            })
        )
    );
});

test("Fiber.now is updated after joining (sync join)", t => {
    run(new Fiber().
        delay(555).
        spawn(fiber => fiber.
            spawn().
            spawn().
            spawn().
            join().
            effect((fiber, scheduler) => {
                t.same(fiber.now, 0, "local time");
                t.same(scheduler.now, 555, "global time");
            })
        )
    );
});

// 4K0M Variable/no fiber name

test("Fiber.named(name) where name is a function", t => {
    const scheduler = new Scheduler();
    const fiber = new Fiber().
        named((...args) => {
            t.equal(args, [fiber, scheduler], "which gets called with fiber and scheduler as parameters");
            return "bar";
        }).
        effect(({ name }) => { t.same(name, "bar", "the return value is used for the name"); });
    run(fiber, scheduler);
});

test("Fiber.named(name) may cause an error", t => {
    t.expectsError = true;
    run(new Fiber().
        named("foo").
        named(() => { throw Error("AUGH"); }).
        either(fiber => fiber.
            effect(fiber => {
                t.same(fiber.error.message, "AUGH", "the error is caught");
                t.same(fiber.name, "foo", "the fiber name is unchanged");
            })
        )
    );
});

test("Fiber.named() can unname a fiber", t => {
    run(new Fiber().
        named("foo").
        effect((fiber, scheduler) => { t.same(scheduler.fiberNamed("foo"), fiber, "fiber is initially named"); }).
        named().
        effect((_, scheduler) => { t.undefined(scheduler.fiberNamed("foo"), "then unnamed"); })
    );
});

// 4K0K Undo operators

test("Undo named", t => {
    const fiber = new Fiber().
        named("foo").
        named("bar").
        effect((fiber, scheduler) => {
            t.same(fiber.name, "bar", "fiber is named");
            t.same(scheduler.fiberNamed("bar"), fiber, "and can be retrieved by its name");
            t.undefined(scheduler.fiberNamed("foo"), "but not by its previous name");
            scheduler.setRateForFiber(fiber, -1);
        });
    const scheduler = run(fiber);
    t.undefined(fiber.name, "fiber does not have a name anymore");
    t.undefined(scheduler.fiberNamed("bar"), "and cannot be retrieved");
});

test("Undo named (error with name)", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        named(() => { throw Error("AUGH"); }).
        either(fiber => fiber.
            effect((fiber, scheduler) => {
                t.same(fiber.error.message, "AUGH", "the error is caught");
                scheduler.setRateForFiber(fiber, -1);
            })
        );
    run(fiber);
    t.undefined(fiber.error, "the error was undone");
});

test("Undo named (error: duplicate name)", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        named("foo").
        either(fiber => fiber.
            effect(({ error }, scheduler) => {
                t.ok(error, "naming the fiber failed");
                scheduler.setRateForFiber(fiber, -1);
            })
        );
    run(new Fiber().
        named("foo").
        effect((parent, scheduler) => { scheduler.attachFiber(parent, fiber); }).
        join()
    );
    t.undefined(fiber.error, "the error was undone");
});

test("Undo store", t => {
    const fiber = new Fiber().
        exec(K(23)).
        store("x").
        exec(K(17)).
        effect(({ scope: { x } }, scheduler) => {
            t.same(x, 23, "value was stored");
            scheduler.setRateForFiber(fiber, -1);
        });
    run(fiber);
    t.equal(fiber.scope, {}, "fiber scope is empty after undo");
});

test("Undo exec (sync)", t => {
    const fiber = new Fiber().
        exec(K(23)).
        effect((fiber, value) => {
            t.same(fiber.rate, 1, "default undo for sync effect is to do nothing");
            t.same(fiber.value, 23, "first value was set");
        }).
        exec(K(17)).
        effect((fiber, scheduler) => {
            t.same(fiber.value, 17, "second value was set");
            scheduler.setRateForFiber(fiber, -1);
        });
    run(fiber);
    t.undefined(fiber.value, "value was unset");
});

test("Undo event (DOM event)", t => {
    const fiber = new Fiber().
        effect(nop).undo((fiber, scheduler) => {
            t.same(fiber.now, 0, "event was undone");
            t.same(scheduler.now, 444, "delay was duplicated");
        }).
        event(window, "hello").
        effect((fiber, scheduler) => {
            t.same(scheduler.now, 222, "event was received after some time");
            scheduler.setRateForFiber(fiber, -1);
        });
    const scheduler = run(fiber, new Scheduler(), 222);
    window.dispatchEvent(new CustomEvent("hello"));
    scheduler.clock.now = Infinity;
});

test("Undo event (message)", t => {
    const A = {};
    const fiber = new Fiber().
        effect(nop).undo((fiber, scheduler) => {
            t.same(fiber.now, 0, "event was undone");
            t.same(scheduler.now, 444, "delay was duplicated");
        }).
        event(A, "hello").
        effect((fiber, scheduler) => {
            t.same(scheduler.now, 222, "message was received after some time");
            scheduler.setRateForFiber(fiber, -1);
        });
    const scheduler = run(fiber, new Scheduler(), 222);
    message(A, "hello");
    scheduler.clock.now = Infinity;
});

test("Undo delay", t => {
    const fiber = new Fiber().
        effect(nop).undo((fiber, scheduler) => {
            t.same(fiber.now, 0, "delay was undone");
            t.same(scheduler.now, 333, "twice as fast");
        }).
        delay(222).
        effect((fiber, scheduler) => {
            t.same(scheduler.now, 222, "delay elapsed");
            scheduler.setRateForFiber(fiber, -2);
        });
    const scheduler = run(fiber);
});

// 4K04 Ops metadata

test("Fiber.metadata", t => {
    const fiber = new Fiber().
        named("foo").
        exec(K(17)).
        delay(777).
        effect(nop);
    t.equal(fiber.metadata.map(({ op }) => op), ["named", "exec", "delay", "effect"], "op names");
    t.same(fiber.metadata[0].name, "foo", "named: name parameter");
    t.same(fiber.metadata[2].dur, 777, "delay: dur parameter");
    t.same(fiber.metadata[3].async, false, "effect: async parameter");
});

test("Fiber.metadata: repeat", t => {
    const fiber = new Fiber().
        repeat(fiber => {
            fiber.effect(fiber => {
                const ops = fiber.metadata.map(({ op }) => op).join(", ");
                t.match(ops, /\beffect\b/, "body of repeat has effect op");
                t.match(ops, /\brepeat\/\w+, repeat\/\w+\b/, `template fiber has multiple repeat ops (${ops})`);
            });
        }, { repeatShouldEnd: n => n > 0 });
    t.equal(fiber.metadata.map(({ op }) => op), ["repeat/instantiate"], "instantiate fiber for repeat");
    run(fiber);
});

// 4K0L Custom undo

test("No custom undo for named", t => {
    t.throws(() => {
        new Fiber().named("foo").undo(nop);
    }, "setting it is an error");
});

test("No custom undo for store", t => {
    t.throws(() => {
        new Fiber().store("foo").undo(nop);
    }, "setting it is an error");
});

test("Custom undo for exec", t => {
    run(new Fiber().
        exec(K(17)).
        exec(K(23)).
        undo(({ value }) => { t.same(value, 17, "value was reset"); }).
        effect((fiber, scheduler) => { scheduler.setRateForFiber(fiber, -1); })
    );
});

test("Custom undo for effect", t => {
    run(new Fiber().
        exec(K(17)).
        effect(({ value }) => { t.same(value, 17, "value was set (do)"); }).
        undo(({ value }) => { t.same(value, 17, "value was reset (undo)"); }).
        exec(K(23)).
        effect((fiber, scheduler) => {
            t.same(fiber.value, 23, "a new value was set (do)");
            scheduler.setRateForFiber(fiber, -1);
        })
    );
});

test("Custom undo for event (DOM event)", t => {
    const fiber = new Fiber().
        exec(K([17, 31])).
        effect(nop).undo(({ value }, scheduler ) => {
            t.equal(value, [17, 31], "value was restored");
            t.same(scheduler.now, 444, "all event effects were undone")
        }).
        event(window, "hello", { eventWasHandled: (_, { value }) => { value.push(23); } }).
        undo(({ value }, scheduler) => {
            value.pop();
            t.same(scheduler.now, 222, "event undo happens before the negative delay");
        }).
        effect((fiber, scheduler) => {
            t.equal(fiber.value, [17, 31, 23], "value was updated when event was handled");
            scheduler.setRateForFiber(fiber, -1);
        });
    const scheduler = run(fiber, new Scheduler(), 222);
    window.dispatchEvent(new CustomEvent("hello"));
    scheduler.clock.now = Infinity;
});

test("Custom undo for event (message)", t => {
    const A = {};
    const fiber = new Fiber().
        exec(K([17, 31])).
        effect(nop).undo(({ value }, scheduler ) => {
            t.equal(value, [17, 31], "value was restored");
            t.same(scheduler.now, 444, "all event effects were undone")
        }).
        event(A, "hello", { eventWasHandled: (_, { value }) => { value.push(23); } }).
        undo(({ value }, scheduler) => {
            value.pop();
            t.same(scheduler.now, 222, "event undo happens before the negative delay");
        }).
        effect((fiber, scheduler) => {
            t.equal(fiber.value, [17, 31, 23], "value was updated when event was handled");
            scheduler.setRateForFiber(fiber, -1);
        });
    const scheduler = run(fiber, new Scheduler(), 222);
    message(A, "hello");
    scheduler.clock.now = Infinity;
});

test("No custom undo for delay", t => {
    t.throws(() => {
        new Fiber().delay(444).undo(nop);
    }, "setting it is an error");
});

// 4L09 Undo delay with infinite rate

test("Undo delay (infinite positive rate)", t => {
    run(new Fiber().
        effect((fiber, scheduler) => {
            scheduler.setRateForFiber(fiber, Infinity);
        }).undo((fiber, scheduler) => {
            t.same(fiber.now, 0, "delay was undone");
            t.same(scheduler.now, 111, "at a finite rate");
        }).
        delay(222).
        effect((fiber, scheduler) => {
            t.same(fiber.now, 222, "delay elapsed");
            t.same(scheduler.now, 0, "infinitely fast");
            scheduler.setRateForFiber(fiber, -2);
        })
    );
});

test("Undo delay (infinite negative rate)", t => {
    run(new Fiber().
        effect(nop).undo((fiber, scheduler) => {
            t.same(fiber.now, 0, "delay was undone");
            t.same(scheduler.now, 222, "at an infinite rate");
        }).
        delay(222).
        effect((fiber, scheduler) => {
            t.same(fiber.now, 222, "delay elapsed");
            t.same(scheduler.now, 222, "at the regular rate");
            scheduler.setRateForFiber(fiber, -Infinity);
        })
    );
});

test("Undo delay (infinite rate both ways)", t => {
    run(new Fiber().
        effect((fiber, scheduler) => {
            scheduler.setRateForFiber(fiber, Infinity);
        }).undo((fiber, scheduler) => {
            t.same(fiber.now, 0, "delay was undone");
            t.same(scheduler.now, 0, "at an infinite rate");
        }).
        delay(222).
        effect((fiber, scheduler) => {
            t.same(fiber.now, 222, "delay elapsed");
            t.same(scheduler.now, 0, "infinitely fast");
            scheduler.setRateForFiber(fiber, -Infinity);
        })
    );
});

test("Undo delay (halfway through)", t => {
    run(new Fiber().
        spawn(fiber => fiber.named("delay").
            effect(nop).undo((fiber, scheduler) => {
                t.same(fiber.now, 0, "delay was undone");
                t.same(scheduler.now, 200, "at normal rate");
            }).
            delay(222)
        ).
        spawn(fiber => fiber.
            delay(100).
            effect((_, scheduler) => { scheduler.setRateForFiber(scheduler.fiberNamed("delay"), -1); })
        )
    );
});

test("Undo delay (halfway through infinite delay)", t => {
    run(new Fiber().
        spawn(fiber => fiber.named("delay").
            effect(nop).undo((fiber, scheduler) => {
                t.same(fiber.now, 0, "delay was undone");
                t.same(scheduler.now, 200, "at normal rate");
            }).
            delay(Infinity)
        ).
        spawn(fiber => fiber.
            delay(100).
            effect((_, scheduler) => { scheduler.setRateForFiber(scheduler.fiberNamed("delay"), -1); })
        )
    );
});

// 4L02 Undo ramp

test("Undo ramp (fixed duration)", t => {
    const ps = [[0, 0, 0], [0.5, 500, 500], [1, 1000, 1000], [1, 1000, 1000], [0.5, 500, 1500],  [0, 0, 2000]];
    const fiber = new Fiber().
        ramp(1000, {
            rampDidProgress(p, fiber, scheduler) {
                const [pp, fn, sn] = ps.shift();
                t.same(p, pp, `ramp did progress (p = ${p})`);
                t.same(fiber.now, fn, `fiber local time (${fiber.now})`);
                t.same(scheduler.now, sn, `global time (${scheduler.now})`);
            }
        }).
        effect((fiber, scheduler) => {
            t.same(ps.length, 3, "ramp finished but will run backward now");
            scheduler.setRateForFiber(fiber, -1);
        });
    const scheduler = run(fiber, new Scheduler(), 500);
    scheduler.clock.now = 1500;
    scheduler.clock.now = Infinity;
    t.same(ps.length, 0, "ramp went backward and forward");
});

test("Undo ramp (variable duration)", t => {
    const ps = [[0, 0, 0], [0.5, 500, 500], [1, 1000, 1000], [1, 1000, 1000], [0.5, 500, 1500],  [0, 0, 2000]];
    const fiber = new Fiber().
        ramp(K(1000), {
            rampDidProgress(p, fiber, scheduler) {
                const [pp, fn, sn] = ps.shift();
                t.same(p, pp, `ramp did progress (p = ${p})`);
                t.same(fiber.now, fn, `fiber local time (${fiber.now})`);
                t.same(scheduler.now, sn, `global time (${scheduler.now})`);
            }
        }).
        effect((fiber, scheduler) => {
            t.same(ps.length, 3, "ramp finished but will run backward now");
            scheduler.setRateForFiber(fiber, -1);
        });
    const scheduler = run(fiber, new Scheduler(), 500);
    scheduler.clock.now = 1500;
    scheduler.clock.now = Infinity;
    t.same(ps.length, 0, "ramp went backward and forward");
});

test("Undo ramp (rate change during ramp)", t => {
    const ps = [[0, 0, 0], [0.75, 750, 1000], [1, 1000, 1500], [1, 1000, 2500], [0.5, 500, 3000], [0, 0, 3500]];
    const fiber = new Fiber().
        spawn(fiber => fiber.
            named("ramp").
            ramp(1000, {
                rampDidProgress(p, fiber, scheduler) {
                    const [pp, fn, sn] = ps.shift();
                    t.same(p, pp, `ramp did progress (p = ${p})`);
                    t.same(fiber.now, fn, `fiber local time (${fiber.now})`);
                    t.same(scheduler.now, sn, `global time (${scheduler.now})`);
                }
            }).
            delay(Infinity)
        ).
        spawn(fiber => fiber.
            delay(500).
            effect((_, scheduler) => {
                scheduler.setRateForFiber(scheduler.fiberNamed("ramp"), 0.5);
            }).
            delay(1500).
            effect((_, scheduler) => {
                scheduler.setRateForFiber(scheduler.fiberNamed("ramp"), -1);
            })
        );
    const scheduler = run(fiber, new Scheduler(), 1000);
    scheduler.clock.now = 3000;
    scheduler.clock.now = Infinity;
    t.same(ps.length, 0, "ramp went backward and forward");
});

test("Undo ramp (halfway through)", t => {
    const ps = [[0, 0, 0], [0.25, 250, 250], [0, 0, 1000]];
    const fiber = new Fiber().
        spawn(fiber => fiber.
            named("ramp").
            ramp(1000, {
                rampDidProgress(p, fiber, scheduler) {
                    const [pp, fn, sn] = ps.shift();
                    t.same(p, pp, `ramp did progress (p = ${p})`);
                    t.same(fiber.now, fn, `fiber local time (${fiber.now})`);
                    t.same(scheduler.now, sn, `global time (${scheduler.now})`);
                }
            })
        ).
        spawn(fiber => fiber.
            delay(500).
            effect((_, scheduler) => {
                scheduler.setRateForFiber(scheduler.fiberNamed("ramp"), -1);
            })
        );
    const scheduler = run(fiber, new Scheduler(), 250);
    scheduler.clock.now = Infinity;
    t.same(ps.length, 0, "ramp went backward and forward");
});

// 3407 Async tests

test("Async effect", async t => await runAsync(new Fiber().
    effect(async () => new Promise(resolve => { window.setTimeout(resolve); })).
    effect(fiber => { t.above(fiber.now, 0, `setTimeout took some time (${fiber.now})`); })
));

test("Async exec", async t => await runAsync(new Fiber().
    exec(async () => new Promise(resolve => { window.setTimeout(() => resolve(23)); })).
    effect(fiber => {
        t.same(fiber.value, 23, "value was set");
        t.above(fiber.now, 0, `setTimeout took some time (${fiber.now})`);
    })
));
