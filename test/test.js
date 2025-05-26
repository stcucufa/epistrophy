const tests = [];
let request;

// Finer-grained typeof for testing purposes; distinguishes between different types of objects.
const typeOf = x => typeof x !== "object" ? typeof x :
    x === null ? "null" :
    Array.isArray(x) ? "array" :
    x instanceof Function ? "object/function" :
    x instanceof String ? "string" :
    x instanceof RegExp ? "regex" :
    x instanceof Map ? "map" :
    x instanceof Set ? "set" : "object";

// Deep equality test, using special comparisons by type.
const equal = (x, y) => (x === y) || (typeOf(x) === typeOf(y) && !!Equal[typeOf(x)]?.(x, y));

// Compare x and y depending on their type (despite x !== y).
const Equal = {
    array: (x, y) => x.length === y.length && x.every((xi, i) => equal(xi, y[i])),
    number: (x, y) => isNaN(x) && isNaN(y),
    object: (x, y) => {
        const keys = Object.keys(x);
        return keys.length === Object.keys(y).length && keys.every(key => key in y && equal(x[key], y[key]));
    },
};

class Test {
    constructor(title, f) {
        this.title = title;
        this.f = f;
        this.expectations = 0;
    }

    static DefaultMessage = "expectation was met";
    static FailDefaultMessage = "unconditional failure";

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

    run(li) {
        this.li = li;
        li.innerHTML = `<span>${this.title}</span>`;
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
            this.report("error running test", `no exception but got: <em>${error.message}</em>`);
            this.passes = false;
        } finally {
            if (this.expectations === 0) {
                this.fail("no expectations in test");
            }
            if (this.expectsWarning && this.warnings === 0) {
                this.fail("no warnings during test");
            }
            if (this.expectsError && this.errors === 0) {
                this.fail("no errors during test");
            }
            console.assert = assert;
            console.warn = warn;
            console.error = error;
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
        this.report(message, !pattern.test(x) && `${x} to match /${pattern}/`);
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

    todo() {
        this.report("TODO");
        this.li.classList.add("todo");
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

export default function test(title, f) {
    tests.push(new Test(title, f));
    if (!request) {
        request = setTimeout(run, 0);
    }
}

function run() {
    const parent = document.querySelector("div.tests") ?? document.body;
    const ol = parent.appendChild(document.createElement("ol"));
    let fail = 0;
    for (const test of tests) {
        test.run(ol.appendChild(document.createElement("li")));
        if (!test.passes) {
            fail += 1;
        }
    }
    const p = parent.appendChild(document.createElement("p"));
    p.classList.add("report");
    p.innerHTML = fail === 0 ? `<span class="ok">ok</span> All tests pass (${tests.length})` :
        `<span class="ko">ko</span> Test failures: ${fail}/${tests.length} (${(100 * fail / tests.length).toFixed(2)}%)`;
    p.scrollIntoView({ block: "end" });
}
