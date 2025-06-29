import { K, typeOf } from "../lib/util.js";
import Scheduler from "../lib/scheduler.js";
import Fiber from "../lib/fiber.js";

window.addEventListener("hashchange", () => { window.location.reload(); });

// Deep equality test, using special comparisons by type.
const equal = (x, y) => (x === y) || (typeOf(x) === typeOf(y) && !!Equal[typeOf(x)]?.(x, y));

// Compare x and y depending on their type (despite x !== y).
const Equal = {
    array: (x, y) => x.length === y.length && x.every((xi, i) => equal(xi, y[i])),
    set: (x, y) => x.difference(y).size === 0,
    number: (x, y) => isNaN(x) && isNaN(y),
    object: (x, y) => {
        function keys(x) {
            const keys = [];
            for (const key in x) {
                keys.push(key);
            }
            return keys;
        }
        const kx = keys(x);
        const ky = keys(y);
        return kx.length === ky.length && kx.every(key => key in y && equal(x[key], y[key]));
    },
    map: (x, y) => {
        if (x.size !== y.size) {
            return false;
        }
        const keys = x.keys();
        return keys.every(key => y.has(key) && equal(x.get(key), y.get(key)));
    }
};

class Test {
    constructor(title, index, f) {
        this.title = title;
        this.index = index;
        this.f = f;
        this.expectations = 0;
    }

    static DefaultMessage = "expectation was met";
    static FailDefaultMessage = "unconditional failure";
    static SkipDefaultMessage = "skipped";

    report(message, expected) {
        if (expected) {
            this.passes = false;
            this.li.innerHTML += ` <span class="ko">ko</span> ${message ?? Test.DefaultMessage} (expected ${expected})`;
        } else {
            this.li.innerHTML += ` <span class="ok">ok</span> ${message ?? Test.DefaultMessage}`;
        }
        this.li.scrollIntoView({ block: "end" });
        this.expectations += 1;
    }

    fail(message) {
        this.passes = false;
        this.li.innerHTML += ` <span class="ko">ko</span> ${message ?? Test.FailDefaultMessage}`;
        this.li.scrollIntoView({ block: "end" });
        this.expectations += 1;
    }

    skip(message) {
        this.skipped = true;
        this.li.innerHTML += ` <span class="skip">...</span> ${message ?? Test.SkipDefaultMessage}`;
        this.li.scrollIntoView({ block: "end" });
        this.expectations += 1;
        throw Error("skipped");
    }

    run(li) {
        this.li = li;
        li.innerHTML = `<a class="test" href="#${isNaN(targetIndex) ? this.index : ""}">${this.title}</a>`;
        this.passes = true;
        const assert = console.assert;
        console.assert = (...args) => {
            assert.apply(console, args);
            if (!args[0]) {
                this.fail("assertion failed");
            }
        };
        const error = console.error;
        this.errors = 0;
        console.error = (...args) => {
            error.apply(console, args);
            if (!this.expectsError) {
                this.fail("unexpected error");
            } else {
                this.errors += 1;
            }
        };
        const warn = console.warn;
        this.warnings = 0;
        console.warn = (...args) => {
            warn.apply(console, args);
            if (!this.expectsWarning) {
                this.fail("unexpected warning");
            } else {
                this.warnings += 1;
            }
        };
        try {
            this.f(this);
        } catch (error) {
            if (!this.skipped) {
                this.report("error running test", `no exception but got: <em>${error.message}</em>`);
                this.passes = false;
            }
        } finally {
            console.assert = assert;
            console.warn = warn;
            console.error = error;
            if (this.skipped) {
                return;
            }
            if (this.expectations === 0) {
                this.fail("no expectations in test");
            }
            if (this.expectsWarning && this.warnings === 0) {
                this.fail("no warnings during test");
            }
            if (this.expectsError && this.errors === 0) {
                this.fail("no errors during test");
            }
        }
    }

    // Assertions

    atleast(x, y, message) {
        this.report(message, !(x >= y) && `${x} ≥ ${y}`);
    }

    atmost(x, y, message) {
        this.report(message, !(x <= y) && `${x} ≤ ${y}`);
    }

    below(x, y, message) {
        this.report(message, !(x < y) && `${x} < ${y}`);
    }

    equal(x, y, message) {
        this.report(message, !(equal(x, y)) && `${x} and ${y} to be equal`);
    }

    match(x, pattern, message) {
        this.report(message, !pattern.test(x) && `${x} to match ${pattern}`);
    }

    pass(message) {
        this.report(message);
    }

    ok(x, message) {
        this.report(message, !x && `${x} to be truthy`);
    }

    same(x, y, message) {
        this.report(message, !(x === y) && `${x} === ${y}`);
    }

    throws(f, message) {
        let passes = false;
        try {
            f();
            this.report(message, "an exception to be thrown");
        } catch (_) {
            passes = true;
            this.report(message);
        }
    }

    true(x, message) {
        this.report(message, x !== true, `${x} to be true`);
    }

    typeof(x, type, message) {
        this.report(message, typeOf(x) !== type, `${x} to be of type ${type}`);
    }

    undefined(x, message) {
        this.report(message, !(x === void 0) && `${x} to be undefined`);
    }
}

// Setup the scheduler and main fiber.

const scheduler = new Scheduler();
const fiber = new Fiber().
    exec(() => {
        const parentElement = document.querySelector("div.tests") ?? document.body;
        const ol = parentElement.appendChild(document.createElement("ol"));
        if (!isNaN(targetIndex)) {
            ol.setAttribute("start", targetIndex);
        }
        return { count: 0, fail: 0, skip: 0, parentElement, ol };
    }).
    join({
        childFiberDidEnd({ value: test, parent: { value: tests } }) {
            tests.count += 1;
            if (test.skipped) {
                tests.skip += 1;
            } else if (!test.passes) {
                tests.fail += 1;
            }
        }
    }).
    effect(({ value: { parentElement, skip, fail, count } }) => {
        const p = parentElement.appendChild(document.createElement("p"));
        const total = count - skip;
        const skipped = skip > 0 ? `, <span class="skip">...</span> ${skip} skipped` : "";
        p.classList.add("report");
        p.innerHTML = fail === 0 ? `<span class="ok">ok</span> ${total} tests pass${skipped}` :
            `<span class="ko">ko</span> Test failures: ${fail}/${total} (${(100 * fail / total).toFixed(2)}%)${skipped}`;
        p.scrollIntoView({ block: "end" });
    });
scheduler.clock.start();
scheduler.resetFiber(fiber);
scheduler.resumeFiber(fiber);

// Export the test function, creating a new fiber for every test to run in
// parallel.

const targetIndex = parseInt(window.location.hash.substr(1));
let index = 0;

export default function test(title, f) {
    index += 1;
    if (isNaN(targetIndex) || index === targetIndex) {
        scheduler.attachFiber(fiber).
            exec(K(new Test(title, index, f))).
            exec(({ value: test, parent: { value: { ol } } }) => {
                test.run(ol.appendChild(document.createElement("li")));
                return test;
            });
    }
}
