import { customEvent, html, isAsync, K, show, typeOf } from "../lib/util.js";
import { run, First } from "../lib/shell.js";

// Very short delay for iframe loading.
const IFRAME_DELAY = 10;

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
    constructor(suite, title, f) {
        this.suite = suite;
        this.title = title;
        this.f = f;
        this.expectations = 0;
    }

    get element() {
        return this.suite.elementByTest.get(this);
    }

    static DefaultMessageOK = "expectation was met";
    static DefaultMessageKO = "expectation was not met";
    static FailDefaultMessage = "unconditional failure";
    static SkipDefaultMessage = "skipped";

    report(message, expected) {
        if (expected) {
            this.passes = false;
            this.element.innerHTML += ` <span class="ko">ko</span> ${message ?? Test.DefaultMessageKO} (expected ${expected})`;
        } else {
            this.element.innerHTML += ` <span class="ok">ok</span> ${message ?? Test.DefaultMessageOK}`;
        }
        this.expectations += 1;
    }

    fail(message) {
        this.passes = false;
        this.element.innerHTML += ` <span class="ko">ko</span> ${message ?? Test.FailDefaultMessage}`;
        this.expectations += 1;
    }

    skip(message) {
        this.skipped = true;
        this.element.innerHTML += ` <span class="skip">...</span> ${message ?? Test.SkipDefaultMessage}`;
        this.expectations += 1;
        throw Error("skipped");
    }

    prepare() {
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

    cleanup() {
        for (const [key, value] of Object.entries(this.console)) {
            console[key] = value;
        }
        delete this.console;
        this.suite.count += 1;
        if (this.skipped) {
            this.suite.skip += 1;
            return this.suite;
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
            this.suite.fail += 1;
        }
        this.suite.send("end", { status: this.passes ? "ok" : "ko" });
        return this.suite.summary();
    }

    reportTestError(error) {
        if (!this.skipped) {
            this.report("error running test", `no exception but got: <em>${error.message ?? error}</em>`);
            this.passes = false;
        }
    }

    async runAsync(suite) {
        this.prepare();
        try {
            await this.f(this);
        } catch (error) {
            this.reportTestError(error);
        } finally {
            return this.cleanup(suite);
        }
    }

    run() {
        this.prepare();
        try {
            this.f(this);
        } catch (error) {
            this.reportTestError(error);
        } finally {
            return this.cleanup();
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

class Suite extends EventTarget {
    constructor(parentElement) {
        super();
        this.ol = parentElement.querySelector("ol") ?? parentElement.appendChild(html("ol"));
        if (!isNaN(targetIndex)) {
            ol.setAttribute("start", targetIndex);
        }
        this.p = parentElement.appendChild(html("p"));
        this.elementByTest = new Map();
        this.count = 0;
        this.fail = 0;
        this.skip = 0;
        const fiber = run().K(this).spawn(fiber => fiber.ramp(IFRAME_DELAY));
        this.testsFiber = fiber.spawn();
        fiber.join().call(() => { suite.summary(true); });
        for (const li of parentElement.querySelectorAll("li:not(.notest)")) {
            this.testsFiber.
                call(fiber => document.body.appendChild(html("iframe", { src: li.textContent }))).
                event(this, "ready", {
                    eventWasHandled: (event, fiber) => {
                        const view = new TestView(this, event.detail.title, fiber.value.src);
                        li.parentElement.replaceChild(view.element, li);
                        fiber.scope.view = view;
                    }
                }).
                event(this, "done", {
                    eventWasHandled: (event, fiber) => {
                        fiber.scope.view.done(this, event.detail.status);
                        delete fiber.scope.view;
                    }
                }).
                call(({ value: iframe }) => { iframe.remove(); });
        }
        this.send("ready", { title: document.title });
    }

    // Use postMessage to send messages to the parent window when running
    // inside an iframe.
    // FIXME 5401 Batching
    send(type, data = {}) {
        if (window.parent !== window) {
            window.parent.postMessage(JSON.stringify({ type, ...data }));
        }
    }

    // Run a test then send a message with the results.
    test(title, index, f) {
        const test = new Test(this, title, f);
        const li = this.ol.appendChild(html("li",
            html("a", { class: "test", href: `#${isNaN(targetIndex) ? index : ""}` }, title)
        ));
        this.elementByTest.set(test, li);
        this.testsFiber.call(() => { this.send("begin", { title }); });
        if (isAsync(f)) {
            this.testsFiber.await(async () => await test.runAsync());
        } else {
            this.testsFiber.call(() => test.run());
        }
    }

    // Update the p element with the test summary.
    summary(done = false) {
        const total = this.count - this.skip;
        const skipped = this.skip > 0 ? `, <span class="skip">...</span> ${this.skip} skipped` : "";
        this.p.classList.add("report");
        this.p.innerHTML = this.fail === 0 ?
            `${done ? `<span class="ok">ok</span>` : `<span class="pending">...</span>`} this: ${total}${skipped}` :
            `<span class="ko">ko</span> Test failures: ${this.fail}/${total} (${
                (100 * this.fail / total).toFixed(2).replace(/\.00$/, "")
            }%)${skipped}`;
        this.p.scrollIntoView({ block: "end" });
        if (done) {
            this.send("done", { status: this.fail === 0 ? "ok" : "ko" });
        }
        return this;
    }
}

// Show test results.
class TestView {
    constructor(suite, title, href) {
        this.statusElement = html("span", { class: "pending" }, "...");
        this.element = html("li", html("a", { href }, title), " ", this.statusElement);
        console.log(this.statusElement.parentElement);
        suite.addEventListener("begin", this);
        suite.addEventListener("end", this);
    }

    handleEvent(event) {
        switch (event.type) {
            case "begin":
                this.element.appendChild(document.createTextNode(" " + event.detail.title + " "));
                this.currentTestStatus = this.element.appendChild(html("span", { class: "pending" }, "..."));
                break;
            case "end":
                const { status } = event.detail;
                this.currentTestStatus.setAttribute("class", status);
                this.currentTestStatus.textContent = status;
                break;
        }
    }

    done(suite, status) {
        suite.removeEventListener("begin", this);
        suite.removeEventListener("end", this);
        this.statusElement.setAttribute("class", status);
        this.statusElement.textContent = status;
    }
}

// Setup the scheduler and main fiber, spawning a child fiber for running the
// tests in sequence (added by the test() function), then joining to show that
// the test suite has completed.

const targetIndex = parseInt(window.location.hash.substr(1));
const suite = new Suite(document.querySelector("div.tests") ?? document.body);
window.addEventListener("message", event => {
    const { type, ...detail } = JSON.parse(event.data);
    window.setTimeout(() => customEvent.call(suite, type, detail), 0);
});

// Export the test function, creating a new fiber for every test to run in
// parallel.

export default function test(title, f) {
    const index = suite.elementByTest.size;
    if (isNaN(targetIndex) || index === targetIndex) {
        suite.test(title, index, f);
    }
}
