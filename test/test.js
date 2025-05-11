const tests = [];
let request;

class Test {
    constructor(title, f) {
        this.title = title;
        this.f = f;
    }

    report(message, expected) {
        if (expected) {
            this.pass = false;
            this.li.innerHTML += ` <span class="ko">ko</span> ${message} (expected ${expected})`;
        } else {
            this.li.innerHTML += ` <span class="ok">ok</span> ${message}`;
        }
    }

    run(li) {
        this.li = li;
        li.innerHTML = `<span>${this.title}</span>`;
        this.pass = true;
        try {
            this.f(this);
        } catch (error) {
            this.report("error running test", `no exception but got: <em>${error.message}</em>`);
            this.pass = false;
        }
    }

    // Assertions

    atleast(x, y, message) {
        this.report(message, !(x >= y) && `${x} >= ${y}`);
    }

    ok(x, message) {
        this.report(message, !x && `${x} to be truthy`);
    }

    same(x, y, message) {
        this.report(message, !(x === y) && `${x} === ${y}`);
    }

    throws(f, message) {
        let pass = false;
        try {
            f();
            this.report(message, "an exception to be thrown");
        } catch (_) {
            pass = true;
            this.report(message);
        }
    }

    todo() {
        this.report("TODO");
        this.li.classList.add("todo");
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
    const ol = document.body.appendChild(document.createElement("ol"));
    let fail = 0;
    for (const test of tests) {
        test.run(ol.appendChild(document.createElement("li")));
        if (!test.pass) {
            fail += 1;
        }
    }
    const p = document.body.appendChild(document.createElement("p"));
    p.textContent = fail === 0 ? `All tests pass (${tests.length})` :
        `Test failures: ${fail} (${(100 * fail / tests.length).toFixed(2)}%)`;
}
