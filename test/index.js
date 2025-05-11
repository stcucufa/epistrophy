import test from "./test.js";
import Fiber from "../lib/fiber.js";
import Scheduler from "../lib/scheduler.js";

test("new Scheduler()", t => {
    const scheduler = new Scheduler();
    t.atleast(scheduler.clock.now, 0, "has a clock");
});

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
