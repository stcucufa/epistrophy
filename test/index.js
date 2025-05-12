import test from "./test.js";
import { Queue, message, on, off } from "../lib/util.js";
import Fiber from "../lib/fiber.js";
import Scheduler from "../lib/scheduler.js";

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
    message(A, "hello");
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

test("message() returns the message that was sent, or nothing if there are no listeners.", t => {
    const A = {};
    on(A, "hello", () => { A.handled = true; });
    const { from, type } = message(A, "hello");
    t.same(from, A, "from field");
    t.same(type, "hello", "type field");
    t.same(A.handled, true, "message was handled");
    const m = message(A, "bye");
    t.undefined(m, "no message was actually sent as there was no listener");
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
    off(B, "hello", C);
    t.undefined(message(B, "hello"), "no more listeners");
});

// 4D0A Scheduler

test("new Scheduler()", t => {
    const scheduler = new Scheduler();
    t.atleast(scheduler.clock.now, 0, "has a clock");
});

// 4D07 Fiber class

test("new Fiber()", t => {
    const fiber = new Fiber();
    t.undefined(fiber.parent, "has no parent by default");
    t.atleast(fiber.id, 0, "has a numeric id");
    t.throws(() => fiber.value, "fiber has no value before it starts running");
    new Scheduler().resume(fiber);
    t.undefined(fiber.value, "initial value is undefined");
});

test("Fiber.exec(f)", t => {
    const scheduler = new Scheduler();
    const fiber = new Fiber().exec(function(...args) {
        t.same(args.length, 2, "f is called with two arguments");
        t.same(args[0], fiber, "f is called with `fiber` as the first argument");
        t.same(args[1], scheduler, "f is called with `scheduler` as the second argument");
        return 17;
    });
    scheduler.resume(fiber);
    t.same(fiber.value, 17, "updates the fiber value on success");
    t.undefined(fiber.error, "the fiber has no error");
});

test("Fiber.exec(f) catches errors", t => {
    const fiber = new Fiber().
        exec(() => 17).
        exec(() => { throw Error("AUGH"); });
    new Scheduler().resume(fiber);
    t.undefined(fiber.value, "the fiber has no value");
    t.same(fiber.error.message, "AUGH", "the error is caught");
});

test("Fiber.exec(f) does not run after an error", t => {
    const fiber = new Fiber().
        exec(() => { throw Error("AUGH"); }).
        effect(() => 17);
    new Scheduler().resume(fiber);
    t.undefined(fiber.value, "the fiber still has no value");
    t.same(fiber.error.message, "AUGH", "the error was caught");
});

test("Fiber.effect(f)", t => {
    const scheduler = new Scheduler();
    let ran = false;
    const fiber = new Fiber().
        exec(() => 19).
        effect(function(...args) {
            t.same(args.length, 2, "f is called with two arguments");
            t.same(args[0], fiber, "f is called with `fiber` as the first argument");
            t.same(args[1], scheduler, "f is called with `scheduler` as the second argument");
            ran = true;
            return 17;
        });
    scheduler.resume(fiber);
    t.same(ran, true, "effect ran");
    t.same(fiber.value, 19, "but the fiber value is unchanged");
});

test("Fiber.effect(f) catches errors", t => {
    const fiber = new Fiber().
        exec(() => 17).
        effect(() => { throw Error("AUGH"); });
    new Scheduler().resume(fiber);
    t.undefined(fiber.value, "the fiber has no value");
    t.same(fiber.error.message, "AUGH", "the error is caught");
});

test("Fiber.effect(f) does not run after an error", t => {
    let ran = false;
    const fiber = new Fiber().
        exec(() => { throw Error("AUGH"); }).
        effect(() => { ran = true; });
    new Scheduler().resume(fiber);
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
    scheduler.resume(fiber);
    t.same(fiber.value, 23, "the fiber has a value");
    t.undefined(fiber.error, "the fiber has no error");
});

test("Fiber.either(f) catches error", t => {
    const fiber = new Fiber().
        exec(() => 17).
        either(() => { throw Error("AUGH"); });
    new Scheduler().resume(fiber);
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
    new Scheduler().resume(fiber);
    t.same(fiber.value, 29, "the fiber has a value");
    t.undefined(fiber.error, "the error was cleared");
});

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
        exec(() => 19).
        repeat(fiber => fiber.exec(({ value }) => value + 1), delegate);
    scheduler.resume(fiber);
    t.same(fiber.value, 23, "the fiber has a value");
    t.undefined(fiber.error, "the fiber has no error");
});

test("Fiber.repeat fails if it has zero duration and no delegate", t => {
    const fiber = new Fiber().
        exec(() => 19).
        repeat(fiber => fiber.exec(({ value }) => value + 1));
    new Scheduler().resume(fiber);
    t.undefined(fiber.value, "the fiber has no value");
    t.ok(fiber.error, "the fiber has an error");
});
