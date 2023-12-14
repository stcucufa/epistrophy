import {
    assign, create, escapeMarkup, extend, I, isEmpty, isObject, nop, shuffle, typeOf
} from "../lib/util.js";
import { notify } from "../lib/events.js";
import { show } from "../lib/show.js";

const DefaultTimeoutMs = 300;

// Lazy-evaluated message with optional context
const message = (msg, context) => () => (context ? `${context}: ` : "") + msg();

// Deep equality test, using special comparisons by type.
const equal = (x, y) => (x === y) || (typeOf(x) === typeOf(y) && !!Equal[typeOf(x)]?.(x, y));

function equal_map(x, y) {
    const keys = [...x.keys()];
    return keys.length === [...y.keys()].length &&
        keys.every(key => y.has(key) && equal(x.get(key), y.get(key)));
}

function equal_object(x, y) {
    const keys = Object.keys(x);
    return keys.length === Object.keys(y).length &&
        keys.every(key => key in y && equal(x[key], y[key]));
}

const equal_set = (x, y) => x.size === y.size && [...x].every(v => y.has(v));

// Compare x and y depending on their type (despite x !== y).
const Equal = {
    "array": (x, y) => x.length === y.length && x.every((xi, i) => equal(xi, y[i])),
    "map": equal_map,
    "number": (x, y) => isNaN(x) && isNaN(y),
    "object": equal_object,
    "set": equal_set
}

const TestCase = assign(properties => create(properties).call(TestCase), {
    create: create(),

    init() {
        this.failures = [];
        this.expectations = [];
        this.assert = console.assert;
        console.assert = (p, ...rest) => {
            this.assert.call(console, p, ...rest);
            this.expect(p, [() => "assertion failed"], true);
        };
        this.warn = console.warn;
        console.warn = (...args) => {
            this.warn.apply(console, args);
            this.expect(false, [() => `warning (${args[0]})`], true);
        };
        this.error = console.error;
        console.error = (...args) => {
            this.error.apply(console, args);
            this.expect(false, [() => `error (${args[0]})`], true);
        };
        this.not = new Proxy(this, {
            get(that, property) {
                if (property === "not") {
                    return that;
                }
                return (...args) => {
                    that.expected = "did not expect";
                    that.matchExpectation = p => !p;
                    that[property](...args);
                    delete that.expected;
                    delete that.matchExpectation;
                }
            }
        });
    },

    done(...args) {
        console.assert = this.assert;
        console.warn = this.warn;
        console.error = this.error;
        postMessage(...args);
    },

    expected: "expected",
    matchExpectation: I,

    expect(p, [message, context], failureOnly = false) {
        const match = this.matchExpectation(p);
        if (!(match && failureOnly)) {
            this.expectations.push(
                [match ? (context ?? "") : ((context ? `${context}: ` : "") + message()), match]
            );
        }
        if (!match) {
            this.failures.push((context ? `${context}: ` : "") + message());
        }
    },

    approximately(value, expected, epsilon, context) {
        this.expect(
            Math.abs(value - expected) < epsilon, [
                () => `${this.expected} ${show(value)} to be approximately ${show(expected)} (±${epsilon})`,
                context
            ]
        )
    },

    above(value, expected, context) {
        this.expect(
            value > expected,
            [() => `${this.expected} ${show(value)} to be above (>) ${show(expected)}`, context]
        );
    },

    atLeast(value, expected, context) {
        this.expect(
            value >= expected,
            [() => `${this.expected} ${show(value)} to be at least (>=) ${show(expected)}`, context]
        );
    },

    atMost(value, expected, context) {
        this.expect(
            value <= expected,
            [() => `${this.expected} ${show(value)} to be at most (<=) ${show(expected)}`, context]
        );
    },

    below(value, expected, context) {
        this.expect(
            value < expected,
            [() => `${this.expected} ${show(value)} to be below (<) ${show(expected)}`, context]
        );
    },

    empty(value, context) {
        this.expect(
            isEmpty(value),
            [() => `${this.expected} ${show(value)} to be empty`, context]
        );
    },

    equal(value, expected, context) {
        this.expect(
            equal(value, expected),
            [() => `${this.expected} ${show(value)} to be equal to ${show(expected)}`, context]
        );
    },

    errors(f, context) {
        wrapConsoleMethod.call(this, "error", "an error", f, context);
    },

    fail(message = "failed") {
        this.expectations.push([message, false]);
        this.failures.push(message);
    },

    infos(f, context) {
        wrapConsoleMethod.call(this, "info", "an informational message", f, context);
    },

    instanceof(value, expected, context) {
        this.expect(
            value instanceof expected,
            [() => `${this.expected} ${show(value)} to be an instance of ${show(expected)}`, context]
        );
    },

    logs(f, context) {
        wrapConsoleMethod.call(this, "log", "a message", f, context);
    },

    match(value, regex, context) {
        this.expect(
            regex.test(value),
            [() => `${this.expected} ${show(value)} to match ${show(regex)}`, context]
        );
    },

    ok(value, context) {
        this.expect(
            !!value,
            [() => `${this.expected} ${show(value)} to be ok (!!)`, context]
        );
    },

    same(value, expected, context) {
        this.expect(
            value === expected,
            [() => `${this.expected} ${show(value)} to be the same (===) as ${show(expected)}`, context]
        );
    },

    skip(message) {
        const error = Error("Skip");
        error.name = "SkipError";
        error.message = message ?? "skipped";
        throw error;
    },

    throws(f, context) {
        try {
            f();
            const message = (context ? `${context}: ` : "") + "expected an exception to be thrown";
            this.expectations.push([message, false]);
            this.failures.push(message);
        } catch (_) {
            this.expectations.push([context ?? "", true]);
        }
    },

    typeof(value, expected, context) {
        this.expect(
            typeof value === expected,
            [() => `${this.expected} ${show(value)} to be of type (typeof) ${show(expected)}`, context]
        );
    },

    undefined(value, context) {
        this.expect(
            value === void 0,
            [() => `${this.expected} ${show(value)} to be undefined`, context]
        );
    },

    warns(f, context) {
        wrapConsoleMethod.call(this, "warn", "a warning", f, context);
    },
});

function wrapConsoleMethod(method, expected, f, context) {
    const original = console[method];
    let k = 0;
    console[method] = () => { ++k; };
    f();
    console[method] = original;
    if (k > 0) {
        this.expectations.push([context ?? "", true]);
    } else {
        const message = (context ? `${context}: ` : "") + `expected ${expected}`;
        this.expectations.push([message, false]);
        this.failures.push(message);
    }
}

const icon = (function() {
    const prefix = Array.prototype.find.call(
        document.querySelectorAll("script"),
        script => /\/test\.js\b/.test(script.src)
    )?.src.replace(/\/test\.\b.*/, "/") ?? Array.prototype.find.call(
        document.querySelectorAll("link[rel=stylesheet]"),
        link => /\/test\.css\b/.test(link.href)
    )?.href.replace(/\/test\.css.*/, "/");
    return id => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="icon">
    <use href="${prefix}icons.svg#${id}"/>
</svg>`;
})();

function postMessage(target, type, data = {}) {
    target.postMessage(JSON.stringify(Object.assign(data, { type })), "*");
}

function initFrame(tests) {
    const iframe = document.createElement("iframe");
    const status = document.querySelector("p.status");

    function nextTest() {
        iframe.remove();
        if (tests.length > 0) {
            run(tests.shift());
        }
    }

    let currentLi;
    let currentURL;
    let startTimeout;
    let missing = 0;

    function updateIcon(name, data) {
        const icon = currentLi.querySelectorAll("use")[data.i];
        icon.setAttribute("href", icon.href.baseVal.replace(/#(.*)$/, `#${name}`));
    }

    function run(li) {
        currentLi = li;
        if (li.classList.contains("skip")) {
            currentLi.innerHTML = `<a href="${currentLi.textContent}">${currentLi.textContent}</a>`;
            handler.done();
            return;
        }

        if (status) {
            status.innerHTML = `${icon("running")} Running ${currentLi.innerHTML}
                <span class="results"> (starting)</span>`;
        }

        startTimeout = setTimeout(() => {
            currentLi.innerHTML = `<a href="${iframe.src}" class="notests">${currentLi.textContent}</a>`;
            missing += 1;
            handler.done();
        }, DefaultTimeoutMs);
        document.body.appendChild(iframe);
        iframe.src = li.textContent;
    }
    nextTest();

    const handler = {
        ready(e, data) {
            clearTimeout(startTimeout);
            currentLi.innerHTML = `<a href="${data.url.href}">${escapeMarkup(data.title)}</a>`;
            currentURL = data.url.href;
            postMessage(e.source, "run");
        },

        pending(e, data) {
            currentLi.innerHTML += ` <a href="${currentURL}#${data.i}">${icon("pending")}</a> ${escapeMarkup(data.title ?? data.i)}`;
        },

        started(e, data) {
            updateIcon("running", data);
        },

        success(e, data) {
            updateIcon("pass", data);
            this.successes += 1;
            this.updateStatus();
            postMessage(e.source, "run");
        },

        failure(e, data) {
            updateIcon("fail", data);
            this.failures += 1;
            this.updateStatus();
            postMessage(e.source, "run");
        },

        timeout(e, data) {
            updateIcon("timeout", data);
            this.timeouts += 1;
            this.updateStatus();
            postMessage(e.source, "run");
        },

        skipped(e, data) {
            updateIcon("skip", data);
            this.skips += 1;
            this.updateStatus();
            postMessage(e.source, "run");
        },

        done() {
            this.updateStatus(true);
            nextTest();
        },

        updateStatus(done = false) {
            if (status) {
                const reports = [
                    ["successes", this.successes],
                    ["failures", this.failures],
                    ["timeouts", this.timeouts],
                    ["skips", this.skips],
                    ["missing", missing]
                ].filter(([_, n]) => n > 0).map(xs => xs.join(": "));
                if (done) {
                    status.innerHTML = `${icon(
                        this.failures > 0 || missing > 0 ? "fail" :
                        this.timeouts > 0 ? "timeout" :
                        this.skips > 0 ? "skip" : "pass"
                    )} Done, ${escapeMarkup(reports.join(", ") || "no test")}.`;
                } else {
                    status.querySelector("span.results").innerHTML = `${icon(
                        this.failures > 0 || missing > 0 ? "fail" :
                        this.timeouts > 0 ? "timeout" :
                        this.skips > 0 ? "skip" : "pass"
                    )} ${escapeMarkup(reports.join(", "))}.`;
                }
            }
        },

        successes: 0,
        failures: 0,
        timeouts: 0,
        skips: 0
    };

    return handler;
}

function initTest() {
    postMessage(parent, "ready", {
        title: document.title,
        url: window.location
    });

    function updateIcon(name, data) {
        const li = document.querySelector(`.tests li:nth-child(${data.i + 1})`);
        if (/#running/.test(li.innerHTML)) {
            li.innerHTML = li.innerHTML.replace(/#running/, `#${name}`);
        } else {
            li.innerHTML += ` ${icon(name)}`;
        }
        const message = data.message ?? data.error;
        if (message) {
            li.innerHTML += ` ${escapeMarkup(message)}`;
        }
    }

    function showExpectations(data) {
        const li = document.querySelector(`.tests li:nth-child(${data.i + 1})`);
        li.innerHTML += Object.hasOwn(data, "error") ?
            ` ${icon("fail")} ${escapeMarkup(data.error || "unspecified error")}` :
            data.expectations.map(
                ([message, pass]) => ` ${icon(pass ? "pass" : "fail")} ${escapeMarkup(message)}`
            ).join("");
    }

    function updateStatus(name, message) {
        const status = document.querySelector("p.status");
        if (status) {
            status.innerHTML = `${icon(name)} ${escapeMarkup(message)}`;
        }
    }

    const runner = {
        async run(e, data) {
            const n = this.tests.length;
            if (n > 0) {
                if (isNaN(this.testCount)) {
                    this.tests = shuffle(this.tests.map((test, i) => {
                        test.push(i);
                        postMessage(e.source, "pending", { title: test[0], i });
                        return test;
                    }));
                    this.testCount = n;
                }

                const [title, test, timeoutMs, i] = this.tests.shift();
                const data = { title, i };

                updateStatus("running", title ?? i);
                const testCase = TestCase({ for: title, timeoutMs: timeoutMs ?? DefaultTimeoutMs });
                try {
                    const promise = test(testCase);
                    if (typeof promise?.then === "function") {
                        postMessage(e.source, "started", data);
                        await Promise.race([
                            promise,
                            new Promise((_, reject) => {
                                window.setTimeout(() => {
                                    reject({
                                        message: `timeout after ${testCase.timeoutMs}ms`,
                                        timeout: true
                                    });
                                }, testCase.timeoutMs);
                            })
                        ]);
                    }
                    if (testCase.failures.length > 0) {
                        testCase.done(
                            e.source,
                            "failure",
                            Object.assign(data, { expectations: testCase.expectations })
                        );
                    } else {
                        testCase.done(
                            e.source,
                            "success",
                            Object.assign(data, { expectations: testCase.expectations })
                        );
                    }
                } catch (error) {
                    if (error.name === "SkipError") {
                        testCase.done(
                            e.source,
                            "skipped",
                            Object.assign(data, { message: error.message })
                        );
                    } else {
                        testCase.done(
                            e.source,
                            error.timeout ? "timeout" : "failure",
                            Object.assign(data, { error: error.message ?? error })
                        );
                    }
                }
            } else {
                postMessage(e.source, "done");
            }
        },

        tests: [],
    };

    return parent !== window ? runner : Object.assign(runner, {
        ready(e, data) {
            const h1 = document.body.appendChild(document.createElement("h1"));
            h1.textContent = data.title;
            const status = document.body.appendChild(document.createElement("p"));
            status.classList = "status";

            const i = parseInt(location.hash.substr(1));
            const singleTest = i >= 0 && i < this.tests.length;

            const list = document.body.appendChild(document.createElement(singleTest ? "ul" : "ol"));
            list.classList = "tests";

            if (singleTest) {
                const li = list.appendChild(document.createElement("li"));
                li.innerHTML = `<a href="#">${escapeMarkup(this.tests[i][0])}</a>`;
                this.tests = [this.tests[i]];
            } else {
                this.tests.forEach(function([title], i) {
                    const li = list.appendChild(document.createElement("li"));
                    li.innerHTML = `<a href="#${i}">${escapeMarkup(title)}</a>`;
                });
            }
            window.onhashchange = () => { location.reload(); };
            postMessage(e.source, "run");
        },

        started: nop,
        pending: nop,

        success(e, data) {
            showExpectations(data);
            this.successes += 1;
            postMessage(e.source, "run");
        },

        failure(e, data) {
            showExpectations(data);
            this.failures += 1;
            postMessage(e.source, "run");
        },

        timeout(e, data) {
            updateIcon("timeout", data);
            this.timeouts += 1;
            postMessage(e.source, "run");
        },

        skipped(e, data) {
            updateIcon("skip", data);
            this.skips += 1;
            postMessage(e.source, "run");
        },

        done(e) {
            const reports = [
                ["successes", this.successes],
                ["failures", this.failures],
                ["timeouts", this.timeouts],
                ["skips", this.skips],
            ].filter(([_, n]) => n > 0).map(xs => xs.join(": "));
            updateStatus(
                this.failures > 0 ? "fail" :
                this.timeouts > 0 ? "timeout" :
                this.skips > 0 ? "skip" : "pass",
                `Done, ${reports.join(", ") || "no test"}.`
            );
            notify(window, "tests:done", { handler: this });
        },

        successes: 0,
        failures: 0,
        timeouts: 0,
        skips: 0
    });
}

const handler = (function () {
    const tests = [...document.querySelectorAll(".tests li:not(.notest)")].map(
        li => li.querySelector("span") ?? li
    );
    const handler = tests.length > 0 ? initFrame(tests) : initTest();
    window.addEventListener("message", e => {
        const data = JSON.parse(e.data);
        try {
            handler[data.type](e, data);
        } catch (_) {
            handler.failure(e, extend(data, { error: "ill-formed expectation" }));
        }
    });
    return handler;
})();

export function test(title, f, timeoutMs) {
    if (!f) {
        f = title;
        title = "";
    }
    handler.tests.push([title, f, timeoutMs]);
}
