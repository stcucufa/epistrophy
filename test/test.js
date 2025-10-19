import { K, show, typeOf, isAsync } from "../lib/util.js";
import { run, FirstValue } from "../lib/shell.js";

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
    "object/string": (x, y) => x.valueOf() === y.valueOf(),
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

    static DefaultMessageOK = "expectation was met";
    static DefaultMessageKO = "expectation was not met";
    static FailDefaultMessage = "unconditional failure";
    static SkipDefaultMessage = "skipped";

    report(message, expected) {
        if (expected) {
            this.passes = false;
            this.li.innerHTML += ` <span class="ko">ko</span> ${message ?? Test.DefaultMessageKO} (expected ${expected})`;
        } else {
            this.li.innerHTML += ` <span class="ok">ok</span> ${message ?? Test.DefaultMessageOK}`;
        }
        this.expectations += 1;
    }

    fail(message) {
        this.passes = false;
        this.li.innerHTML += ` <span class="ko">ko</span> ${message ?? Test.FailDefaultMessage}`;
        this.expectations += 1;
    }

    skip(message) {
        this.skipped = true;
        this.li.innerHTML += ` <span class="skip">...</span> ${message ?? Test.SkipDefaultMessage}`;
        this.expectations += 1;
        throw Error("skipped");
    }

    prepare(ol) {
        this.li = ol.appendChild(document.createElement("li"));
        this.li.innerHTML = `<a class="test" href="#${isNaN(targetIndex) ? this.index : ""}">${this.title}</a>`;
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
        this.console = { assert, error, warn };
    }

    cleanup(tests) {
        for (const [key, value] of Object.entries(this.console)) {
            console[key] = value;
        }
        delete this.console;
        tests.count += 1;
        if (this.skipped) {
            tests.skip += 1;
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
        if (!this.passes) {
            tests.fail += 1;
        }
        return summary(tests);
    }

    reportTestError(error) {
        if (!this.skipped) {
            this.report("error running test", `no exception but got: <em>${error.message ?? error}</em>`);
            this.passes = false;
        }
    }

    async runAsync(tests) {
        this.prepare(tests.ol);
        try {
            await this.f(this);
        } catch (error) {
            this.reportTestError(error);
        } finally {
            return this.cleanup(tests);
        }
    }

    run(tests) {
        this.prepare(tests.ol);
        try {
            this.f(this);
        } catch (error) {
            this.reportTestError(error);
        } finally {
            return this.cleanup(tests);
        }
    }

    // Assertions

    above(x, y, message) {
        this.report(message, !(x > y) && `${x} > ${y}`);
    }

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
        this.report(message, !(x === y) && `${show(x)} === ${show(y)}`);
    }

    throws(f, message) {
        let passes = false;
        try {
            f();
            this.report(message, "an exception to be thrown");
        } catch (error) {
            passes = true;
            this.report(typeof message === "function" ? message(error) : message);
        }
    }

    true(x, message) {
        this.report(message, x !== true, `${x} to be true`);
    }

    typeof(x, type, message) {
        this.report(message, typeOf(x) !== type, `${show(x)} to be of type ${type}`);
    }

    undefined(x, message) {
        this.report(message, !(x === void 0) && `${x} to be undefined`);
    }
}

// Setup the scheduler and main fiber, spawning a child fiber for running the
// tests in sequence (added by the test() function), then joining to show that
// the test suite has completed.

const mainFiber = run();
const testsFiber = mainFiber.spawn().
    call((fiber, scheduler) => {
        const parentElement = document.querySelector("div.tests") ?? document.body;
        const ol = parentElement.appendChild(document.createElement("ol"));
        if (!isNaN(targetIndex)) {
            ol.setAttribute("start", targetIndex);
        }
        const p = parentElement.appendChild(document.createElement("p"));
        return { count: 0, fail: 0, skip: 0, ol, p };
    });
mainFiber.
    join(FirstValue).
    call(({ value }) => summary(value, true));


// Update the p element with the test summary.
function summary(tests, done = false) {
    const total = tests.count - tests.skip;
    const skipped = tests.skip > 0 ? `, <span class="skip">...</span> ${tests.skip} skipped` : "";
    tests.p.classList.add("report");
    tests.p.innerHTML = tests.fail === 0 ?
        `${done ? `<span class="ok">ok</span>` : `<span class="pending">...</span>`} Tests: ${total}${skipped}` :
        `<span class="ko">ko</span> Test failures: ${tests.fail}/${total} (${
            (100 * tests.fail / total).toFixed(2).replace(/\.00$/, "")
        }%)${skipped}`;
    tests.p.scrollIntoView({ block: "end" });
    return tests;
}

// Export the test function, creating a new fiber for every test to run in
// parallel.

const targetIndex = parseInt(window.location.hash.substr(1));
let index = 0;

export default function test(title, f) {
    index += 1;
    if (isNaN(targetIndex) || index === targetIndex) {
        if (typeof f === "function") {
            const t = new Test(title, index, f);
            if (isAsync(f)) {
                testsFiber.await(async ({ value }) => await t.runAsync(value));
            } else {
                testsFiber.call(({ value }) => t.run(value));
            }
        } else {
            // TODO
            const url = title;
        }
    }
}
