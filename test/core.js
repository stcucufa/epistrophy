import test from "./test.js";
import { nop } from "../lib/util.js";
import { Fiber, Scheduler } from "../lib/core.js";

function run(fiber) {
    const scheduler = new Scheduler();
    scheduler.resumeFiber(fiber);
    scheduler.update(0, Infinity);
}

test("Fiber.run()", t => {
    const fiber = new Fiber().
        sync(fiber => { fiber.value = 23; }).
        sync(fiber => { fiber.value += 17; });
    fiber.run().next();
    t.same(fiber.value, 40, "all ops ran");
});

test("Fiber.run() catches errors", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        sync(fiber => { fiber.value = 23; }).
        sync(() => { throw Error("AUGH"); }).
        sync(fiber => { fiber.value += 17; });
    fiber.run().next();
    t.same(fiber.error.message, "AUGH", "error property is set");
    t.same(fiber.value, 23, "ops after the error did not run");
});

test("Fiber.sync(f)", t => {
    const scheduler = new Scheduler();
    const fiber = new Fiber();
    t.equal(fiber, fiber.sync((...args) => {
        t.equal(args, [fiber, scheduler], "f gets called with the fiber and the scheduler");
    }), "returns the fiber to add more ops");
    fiber.run(scheduler).next();
});

test("Fiber.ramp(dur)", t => {
    run(new Fiber().
        ramp(777).
        sync((_, scheduler) => { t.same(scheduler.now, 777, "time passed"); })
    );
});

test("Fiber.ramp(dur), string", t => {
    run(new Fiber().
        ramp("1.111s").
        sync((_, scheduler) => { t.same(scheduler.now, 1111, "time passed"); })
    );
});

test("Fiber.ramp(dur), variable dur", t => {
    const scheduler = new Scheduler();
    const fiber = new Fiber().
        ramp((...args) => {
            t.equal(args, [fiber, scheduler], "dur gets called with the fiber and the scheduler");
            return 555;
        }).
        sync((_, scheduler) => { t.same(scheduler.now, 555, "time passed"); });
    scheduler.resumeFiber(fiber);
    scheduler.update(0, Infinity);
});

test("Fiber.ramp(dur), variable dur error", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        ramp(() => { throw Error("AUGH"); }).
        sync((_, scheduler) => { t.fail("unreachable op"); });
    run(fiber);
    t.same(fiber.error.message, "AUGH", "fiber error was set");
});

test("Fiber.ramp(dur), dur ≤ 0", t => {
    run(new Fiber().
        ramp(-999).
        sync((_, scheduler) => { t.same(scheduler.now, 0, "time did not pass"); })
    );
});

test("Fiber.ramp(dur, f)", t => {
    const ps = [[0, 0], [250, 0.25], [1000, 1]];
    const scheduler = new Scheduler();
    const fiber = new Fiber().
        ramp(1000, (...args) => {
            const [now, pp] = ps.shift();
            if (now === 0) {
                t.equal(args, [pp, fiber, scheduler], "f gets called with p, the fiber, and the scheduler");
            }
            t.equal(pp, args[0], `0 ≤ p ≤ 1 (${pp})`);
            t.equal(now, scheduler.now, `current time (${scheduler.now})`);
        });
    scheduler.resumeFiber(fiber);
    scheduler.update(0, 250);
    scheduler.clock.now = Infinity;
    t.equal(ps, [], "went through all updates");
});

test("Scheduler.update()", t => {
    run(new Fiber().
        sync(fiber => { fiber.value = 17; }).
        sync(({ value }) => { t.same(value, 17, "fiber has the expected value"); })
    );
});
