import test from "./test.js";
import { nop, on } from "../lib/util.js";
import { Fiber, Scheduler } from "../lib/core.js";

// Utility function to run a fiber synchronously.
function run(fiber, until = Infinity) {
    const scheduler = new Scheduler();
    scheduler.scheduleFiber(fiber);
    scheduler.clock.now = until;
    return scheduler;
}

// Utility function to run a fiber asynchronously until the scheduler becomes
// idle.
const runAsync = fiber => new Promise(resolve => {
    const scheduler = new Scheduler();
    scheduler.scheduleFiber(fiber);
    on(scheduler, "update", ({ idle }) => {
        if (idle) {
            resolve();
        }
    });
    scheduler.clock.start();
});

test("Scheduler.update()", t => {
    run(new Fiber().
        sync(fiber => { fiber.value = 17; }).
        sync(({ value }) => { t.same(value, 17, "fiber has the expected value"); })
    );
});

test("Fiber.run()", t => {
    const fiber = new Fiber().
        sync(fiber => { fiber.value = 23; }).
        sync(fiber => { fiber.value += 17; });
    fiber.run({ now: 0 }).next();
    t.same(fiber.value, 40, "all ops ran");
});

test("Fiber.run() catches errors", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        sync(fiber => { fiber.value = 23; }).
        sync(() => { throw Error("AUGH"); }).
        sync(fiber => { fiber.value += 17; });
    fiber.run({ now: 0 }).next();
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
        sync((fiber, scheduler) => {
            t.same(scheduler.now, 777, "time passed");
            t.same(fiber.now, 777, "local time");
        })
    );
});

test("Fiber.ramp(dur), variable dur", t => {
    const scheduler = new Scheduler();
    const fiber = new Fiber().
        ramp((...args) => {
            t.equal(args, [fiber, scheduler], "dur gets called with the fiber and the scheduler");
            return 555;
        }).
        sync((fiber, scheduler) => {
            t.same(scheduler.now, 555, "time passed");
            t.same(fiber.now, 555, "local time");
        });
    scheduler.scheduleFiber(fiber);
    scheduler.update(0, Infinity);
});

test("Fiber.ramp(dur), variable dur error", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        ramp(() => { throw Error("AUGH"); }).
        sync(() => { t.fail("unreachable op"); });
    run(fiber);
    t.same(fiber.error.message, "AUGH", "fiber error was set");
});

test("Fiber.ramp(dur), dur < 0", t => {
    run(new Fiber().
        ramp(-999).
        sync((fiber, scheduler) => {
            t.same(scheduler.now, 0, "time did not pass");
            t.same(fiber.now, 0, "local time");
        })
    );
});

test("Fiber.ramp(dur), dur = 0", t => {
    const ps = [[0, 0, 0], [1, 0, 0]];
    run(new Fiber().
        ramp(0, (p, fiber, scheduler) => {
            t.equal([p, fiber.now, scheduler.now], ps.shift(), `ramp did progress (${p})`);
        }).
        sync((fiber, scheduler) => {
            t.same(scheduler.now, 0, "time did not pass");
            t.same(fiber.now, 0, "local time");
            t.equal(ps, [], "ramp went through all updates");
        })
    );
});

test("Fiber.ramp(dur, f)", t => {
    const ps = [[0, 0, 0], [0.25, 250, 250], [1, 1000, 1000]];
    const scheduler = new Scheduler();
    const fiber = new Fiber().
        ramp(1000, (...args) => {
            const [pp, fn, sn] = ps.shift();
            if (sn === 0) {
                t.equal(args, [pp, fiber, scheduler], "f gets called with p, the fiber, and the scheduler");
            }
            t.equal(pp, args[0], `0 ≤ p ≤ 1 (${pp})`);
            t.equal(sn, scheduler.now, `current time (${scheduler.now})`);
            t.equal(fn, fiber.now, `local time (${fiber.now})`);
        });
    scheduler.scheduleFiber(fiber);
    scheduler.update(0, 250);
    scheduler.clock.now = Infinity;
    t.equal(ps, [], "went through all updates");
});

test("Fiber.ramp(dur, f), f throws", t => {
    t.expectsError = true;
    const fiber = new Fiber().
        ramp(777, () => { throw Error("AUGH"); }).
        sync(() => { t.fail("unreachable op"); });
    run(fiber);
    t.same(fiber.error.message, "AUGH", "the error was caught");
});

test("Fiber.ramp(∞, f), f throws", t => {
    const fiber = new Fiber().
        ramp(Infinity, p => { t.same(p, 0, "p stays at zero"); }).
        sync(() => { t.fail("unreachable op"); });
    run(fiber, 777);
});

test("Fiber.async(f)", async t => new Promise(resolve => {
    const scheduler = new Scheduler();
    const fiber = new Fiber().
        async((...args) => {
            t.equal(args, [fiber, scheduler], "f gets called with the fiber and the scheduler");
            return new Promise(resolve => { window.setTimeout(resolve); });
        }).
        sync((fiber, scheduler) => {
            t.above(scheduler.now, 0, "time has passed");
        });
    scheduler.scheduleFiber(fiber);
    on(scheduler, "update", ({ idle }) => {
        if (idle) {
            resolve();
        }
    });
    scheduler.clock.start();
}));

test("Fiber.async(f, delegate)", async t => new Promise(resolve => {
    const scheduler = new Scheduler();
    const fiber = new Fiber().
        async(() => new Promise(resolve => { window.setTimeout(resolve(17)); }), {
            asyncWillEnd(...args) {
                t.equal(
                    args, [17, fiber, scheduler],
                    "delegate.asyncWillEnd gets called when the call ends with the value, fiber and scheduler"
                );
            }
        }).
        sync((fiber, scheduler) => {
            t.above(scheduler.now, 0, "time has passed");
        });
    scheduler.scheduleFiber(fiber);
    on(scheduler, "update", ({ idle }) => {
        if (idle) {
            resolve();
        }
    });
    scheduler.clock.start();
}));

// FIXME 4L0N Test: assertion failures are contagious
// FIXME 4M03 Test: skip in async test

/*
test("Fiber.async handles synchronous errors", async t => {
    t.expectsError = true;
    const fiber = new Fiber().
        async(() => { throw Error("AUGH"); }).
        sync(() => { t.fail("error should have been handled"); });
    await runAsync(fiber);
    t.same(fiber.error.message, "AUGH", "fiber error is set");
});

test("Fiber.async handles asynchronous errors", async t => {
    t.expectsError = true;
    const fiber = new Fiber().
        async(() => new Promise((_, reject) => { window.setTimeout(() => { reject(Error("AUGH")); }); })).
        sync(() => { t.fail("error should have been handled"); });
    await runAsync(fiber);
    t.same(fiber.error.message, "AUGH", "fiber error is set");
});
*/

// 4M04 Core: fiber rate

test("Scheduler.setFiberRate(rate)", t => {
    run(new Fiber().
        sync((fiber, scheduler) => {
            t.same(fiber.rate, 1, "rate is 1 by default");
            scheduler.setFiberRate(fiber, 2);
            t.same(fiber.rate, 2, "rate was updated");
            t.same(new Fiber().rate, 1, "other fiber rate is unaffected");
        })
    );
});

test("Fiber rate affects the observed duration of a ramp", t => {
    run(new Fiber().
        sync((fiber, scheduler) => { scheduler.setFiberRate(fiber, 2); }).
        ramp(888).
        sync((fiber, scheduler) => {
            t.same(scheduler.now, 444, "observed time");
            t.same(fiber.now, 888, "fiber local time");
        })
    );
});

test("Fiber rate affects the observed duration of a ramp (rate = ∞)", t => {
    run(new Fiber().
        sync((fiber, scheduler) => { scheduler.setFiberRate(fiber, Infinity); }).
        ramp(888).
        sync((fiber, scheduler) => {
            t.same(scheduler.now, 0, "observed time");
            t.same(fiber.now, 888, "fiber local time");
        })
    );
});

test("Setting fiber rate while a ramp is in progress (faster)", t => {
    const ps = [[0, 0, 0], [0.5, 444, 444], [1, 888, 555]];
    const fiber = new Fiber().
        ramp(888, (p, fiber, scheduler) => {
            t.equal([p, fiber.now, scheduler.now], ps.shift(), `ramp did progress (${p})`);
        }).
        sync(() => { t.equal(ps, [], "ramp went through all updates"); });
    const scheduler = run(fiber, 444);
    scheduler.setFiberRate(fiber, 4);
    scheduler.clock.now = Infinity;
});

test("Setting fiber rate while a ramp is in progress (slower)", t => {
    const ps = [[0, 0, 0], [0.5, 444, 444], [0.75, 666, 2664], [1, 888, 4884]];
    const fiber = new Fiber().
        ramp(888, (p, fiber, scheduler) => {
            t.equal([p, fiber.now, scheduler.now], ps.shift(), `ramp did progress (${p})`);
        }).
        sync(() => { t.equal(ps, [], "ramp went through all updates"); });
    const scheduler = run(fiber, 444);
    scheduler.setFiberRate(fiber, 0.1);
    scheduler.clock.now = 2664;
    scheduler.clock.now = Infinity;
});

test("Fiber rate = 0 pauses execution of the fiber", t => {
    run(new Fiber().
        sync((fiber, scheduler) => {
            scheduler.setFiberRate(fiber, 0);
            t.same(fiber.rate, 0, "rate was set to zero; fiber is paused");
        }).
        sync(() => { t.fail("unreachable op"); })
    );
});

test("Fiber rate = 0 pauses execution of the fiber then resume it", t => {
    const fiber = new Fiber().
        sync((fiber, scheduler) => { scheduler.setFiberRate(fiber, 0); }).
        sync(fiber => { fiber.value = 17; }).
        sync((fiber, scheduler) => {
            t.same(fiber.value, 17, "fiber eventually resumed");
            t.same(fiber.now, 0, "no change in local time");
            t.same(scheduler.now, 777, "observed resume time");
        });
    const scheduler = run(fiber, 777);
    t.undefined(fiber.value, "fiber paused itself");
    scheduler.setFiberRate(fiber, 1);
    scheduler.clock.now = Infinity;
});

test("Pause and resume a ramp", t => {
    const ps = [[0, 0, 0], [0.5, 444, 444], [0.625, 555, 8555], [1, 888, 8888]];
    const fiber = new Fiber().
        ramp(888, (p, fiber, scheduler) => {
            t.equal([p, fiber.now, scheduler.now], ps.shift(), `ramp did progress (${p})`);
        }).
        sync(() => { t.equal(ps, [], "ramp went through all updates"); });
    const scheduler = run(fiber, 444);
    scheduler.setFiberRate(fiber, 0);
    scheduler.clock.now = 8444;
    scheduler.setFiberRate(fiber, 1);
    scheduler.clock.now = 8555;
    scheduler.clock.now = Infinity;
});

test("Pause and resume async", async t => new Promise(resolve => {
    const scheduler = new Scheduler();
    const fiber = new Fiber().
        async(() => new Promise(resolve => { window.setTimeout(resolve); }), {
            asyncWillEnd(_, fiber, scheduler) {
                t.same(fiber.rate, 0, "async ending with rate=0");
                window.setTimeout(() => { scheduler.setFiberRate(fiber, 1); });
            }
        }).
        sync((fiber, scheduler) => {
            t.same(fiber.now, 0, "fiber resumed at t=0");
            t.above(scheduler.now, 0, `time has passed (${scheduler.now})`);
        });
    scheduler.scheduleFiber(fiber);
    scheduler.scheduleFiber(new Fiber().sync((_, scheduler) => { scheduler.setFiberRate(fiber, 0); }));
    on(scheduler, "update", ({ idle }) => {
        if (idle) {
            resolve();
        }
    });
    scheduler.clock.start();
}));

// 4N03 Core: backward execution, not undo

test("Add a reverse effect", t => {
    const fiber = new Fiber().sync(nop);
    t.same(fiber, fiber.reverse(nop), "reverse a sync instruction");
    t.same(fiber, fiber.async(nop).reverse(nop), "reverse an async instruction");
});

test("Add reverse effect", t => {
    t.throws(() => {
        new Fiber().reverse(nop)
    }, "error: nothing to reverse");
});

test("Add reverse effect", t => {
    t.throws(() => {
        new Fiber().ramp(777).reverse(nop)
    }, "error: cannot provide a reverse effect");
});

test("Add reverse effect", t => {
    t.throws(() => {
        new Fiber().sync(nop).reverse(nop).reverse(nop)
    }, "error: cannot provide a further reverse effect");
});

test("Reverse sync", t => {
    let values = [];
    const fiber = new Fiber().
        sync(() => values.push(17)).reverse(() => values.push(-17)).
        sync(() => values.push(31)).
        sync(() => values.push(23)).reverse(() => values.push(-23)).
        sync((fiber, scheduler) => {
            scheduler.setFiberRate(fiber, -1);
            fiber.ip -= 1;
        });
    const scheduler = run(fiber, 111);
    t.equal(values, [17, 31, 23, -23, -17], "run forward then backward");
});

test("Reverse ramp (when done)", t => {
    run(new Fiber().
        sync(nop).reverse((fiber, scheduler) => {
            t.same(fiber.now, 0, "ramp was reversed");
            t.same(scheduler.now, 888, "with an observed duration");
            t.same(fiber.value, 0, "and reversed value");
        }).
        ramp(444, (p, fiber) => { fiber.value = p; }).
        sync((fiber, scheduler) => {
            t.same(fiber.now, 444, "ramp ended");
            t.same(scheduler.now, 444, "with an observed duration");
            t.same(fiber.value, 1, "and end value");
            scheduler.setFiberRate(fiber, -1);
        })
    );
});

test("Reverse ramp (during ramp)", t => {
    const ps = [[0, 0, 0], [0.25, 222, 222], [0.125, 111, 333], [0, 0, 444]]
    const fiber = new Fiber().
        ramp(888, (p, fiber, scheduler) => {
            t.equal([p, fiber.now, scheduler.now], ps.shift(), `ramp did progress (${p})`);
        });
    const scheduler = run(fiber, 222);
    scheduler.setFiberRate(fiber, -1);
    scheduler.clock.now = 333;
    scheduler.clock.now = Infinity;
    t.equal(ps, [], "ramp went through all updates");
});

test("Reverse async (when done)", async t => new Promise(resolve => {
    const scheduler = new Scheduler();
    const fiber = new Fiber().
        sync(nop).reverse((fiber, scheduler) => {
            t.same(scheduler.now, fiber.observedEnd, `observed time has passed (${scheduler.now})`);
        }).
        async(() => new Promise(resolve => { window.setTimeout(resolve); })).
        sync((fiber, scheduler) => {
            t.above(fiber.now, 0, `local time has passed (${fiber.now})`);
            t.same(scheduler.now, fiber.now, `observed time has passed (${scheduler.now})`);
            fiber.observedEnd = 2 * fiber.now;
            scheduler.setFiberRate(fiber, -1);
        });
    scheduler.scheduleFiber(fiber);
    on(scheduler, "update", ({ idle }) => {
        if (idle) {
            t.same(fiber.now, 0, "fiber went back to the beginning");
            resolve();
        }
    });
    scheduler.clock.start();
}));

test("Reverse async (custom)", async t => new Promise(resolve => {
    const scheduler = new Scheduler();
    const fiber = new Fiber().
        sync(nop).reverse((fiber, scheduler) => {
            t.undefined(fiber.response, "response was removed");
            t.undefined(fiber.data, "data was removed");
        }).
        async(async fiber => { fiber.response = await fetch("data.json"); }).
        reverse(fiber => { delete fiber.response; }).
        async(async fiber => { fiber.data = (await fiber.response.json()).data; }).
        reverse(fiber => { delete fiber.data; }).
        sync((fiber, scheduler) => { scheduler.setFiberRate(fiber, -1); });
    scheduler.scheduleFiber(fiber);
    on(scheduler, "update", ({ idle }) => {
        if (idle) {
            t.same(fiber.now, 0, "fiber went back to the beginning");
            resolve();
        }
    });
    scheduler.clock.start();
}));

test("Reverse async (before being done)", async t => new Promise(resolve => {
    const scheduler = new Scheduler();
    const fiber = new Fiber().
        sync(nop).reverse((fiber, scheduler) => {
            t.above(scheduler.now, 0, `observed time has passed (${scheduler.now})`);
        }).
        async(() => new Promise(resolve => { window.setTimeout(resolve, 84_600_000); }));
    scheduler.scheduleFiber(fiber);
    scheduler.scheduleFiber(new Fiber().
        ramp(23, nop).
        sync((_, scheduler) => { scheduler.setFiberRate(fiber, -1); })
    );
    on(scheduler, "update", ({ idle }) => {
        if (idle) {
            t.same(fiber.now, 0, "fiber went back to the beginning");
            resolve();
        }
    });
    scheduler.clock.start();
}));
