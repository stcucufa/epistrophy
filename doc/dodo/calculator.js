const Ops = {
    "+": (x, y) => x + y,
    "-": (x, y) => x - y,
    "×": (x, y) => x * y,
    "÷": (x, y) => x / y,
};

const stringify = x => x.toString().replace(/(\.[1-9]*)000000000+\d$/, "$1");

const Replace = true;

function C() {
    return this.clear();
}

const recall = state => function() {
    if (Object.hasOwn(this, "memory")) {
        this.input = "";
        this.append(stringify(this.memory));
        return States[state];
    }
    return this.state;
};

const input = (state, replace = false) => function(text) {
    if (replace) {
        this.input = "";
    }
    this.append(text);
    return States[state];
};

const newInput = (state, prefix = "") => function(text) {
    this.x = parseFloat(this.input);
    return input(state, Replace).call(this, prefix + text);
};

const apply = state => function(text) {
    this.apply(text);
    return States[state];
};

function op(text, button) {
    this.highlight(button);
    this.op = text;
    return States.Operator;
}

const defaults = { C, op };

const States = {
    Init: {
        "0": input("LeftZero", Replace),
        digit: input("Left", Replace),
        ".": input("LeftDecimal"),
        M() {
            delete this.memory;
            return this.state;
        },
        "MR": recall("Left"),
        ...defaults
    },

    Left: {
        "0": input("Left"),
        digit: input("Left"),
        ".": input("LeftDecimal"),
        "MR": recall("Left"),
        ...defaults
    },

    LeftZero: {
        digit: input("Left", Replace),
        ".": input("LeftDecimal"),
        "MR": recall("Left"),
        ...defaults
    },

    LeftDecimal: {
        "0": input("LeftDecimal"),
        digit: input("LeftDecimal"),
        "MR": recall("Left"),
        ...defaults
    },

    Operator: {
        "0": newInput("RightZero"),
        digit: newInput("Right"),
        ".": newInput("RightDecimal", "0"),
        "=": function() {
            this.x = this.input;
            this.apply(this.op);
            return States.Equal;
        },
        "MR": recall("Right"),
        ...defaults
    },

    Equal: {
        "0": newInput("LeftZero"),
        digit: newInput("Left"),
        ".": newInput("LeftDecimal", "0"),
        "MR": recall("Left"),
        M() {
            this.memory = parseFloat(this.input);
            return this.state;
        },
        ...defaults
    },

    Right: {
        C,
        "0": input("Right"),
        digit: input("Right"),
        ".": input("RightDecimal"),
        op: apply("Operator"),
        "=": apply("Equal"),
        "MR": recall("Right"),
    },

    RightZero: {
        C,
        digit: input("Right", Replace),
        ".": input("RightDecimal"),
        op: apply("Operator"),
        "=": apply("Equal"),
        "MR": recall("Right"),
    },

    RightDecimal: {
        C,
        "0": input("RightDecimal"),
        digit: input("RightDecimal"),
        op: apply("Operator"),
        "=": apply("Equal"),
        "MR": recall("Right"),
    },
};

const Calculator = {
    button(text, button) {
        switch (text) {
            case "1": case "2": case "3": case "4":
            case "5": case "6": case "7": case "8": case "9":
                this.state = this.state.digit.call(this, text);
                break;
            case "+": case "-": case "×": case "÷":
                this.state = this.state.op.call(this, text, button);
                break;
            default:
                this.state = this.state[text]?.call(this, text) ?? this.state;
        }

        const q = Object.keys(States).find(q => States[q] === this.state);
        console.log(`>>> [${q}], input="${this.input}", x=${this.x}, op=${this.op}, M=${this.memory}`);
    },

    clear() {
        this.input = "0";
        this.updateDisplay();
        document.querySelector("button.highlighted")?.classList.remove("highlighted");
        return States.Init;
    },

    append(text) {
        this.input += text;
        this.updateDisplay();
    },

    highlight(button) {
        document.querySelector("button.highlighted")?.classList.remove("highlighted");
        button?.classList.add("highlighted");
    },

    apply(text) {
        const y = parseFloat(this.input);
        this.x = Ops[this.op](this.x, y);
        this.op = text;
        this.input = stringify(this.x);
        this.highlight();
        this.updateDisplay();
    },

    updateDisplay() {
        this.display.textContent = this.input;
    }
};

const calculator = Object.assign(Object.create(Calculator), {
    display: document.querySelector("#display span"),
});

for (const button of document.querySelectorAll("button")) {
    const text = button.textContent;
    button.addEventListener("click", () => { calculator.button(text, button); });
}

calculator.state = calculator.clear();
