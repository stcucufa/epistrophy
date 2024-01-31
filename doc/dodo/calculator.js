const Ops = {
    "+": (x, y) => x + y,
    "-": (x, y) => x - y,
    "×": (x, y) => x * y,
    "÷": (x, y) => x / y,
};

const Replace = true;

function C() {
    return this.clear();
}

const input = (state, replace = false) => function(text) {
    if (replace) {
        this.input = "";
    }
    this.append(text);
    return States[state];
}

const newInput = (state, prefix = "") => function(text) {
    this.x = parseFloat(this.input);
    return input(state, Replace).call(this, prefix + text);
}

const apply = state => function(text) {
    this.apply(text);
    return States[state];
};

function op(text) {
    this.op = text;
    return States.Operator;
}

const defaults = { C, op };

const States = {
    Init: {
        "0": input("LeftZero", Replace),
        digit: input("Left", Replace),
        ".": input("LeftDecimal"),
        ...defaults
    },

    Left: {
        "0": input("Left"),
        digit: input("Left"),
        ".": input("LeftDecimal"),
        ...defaults
    },

    LeftZero: {
        digit: input("Left", Replace),
        ".": input("LeftDecimal"),
        ...defaults
    },

    LeftDecimal: {
        "0": input("LeftDecimal"),
        digit: input("LeftDecimal"),
        ...defaults
    },

    Operator: {
        "0": newInput("RightZero"),
        digit: newInput("Right"),
        ".": newInput("RightDecimal", "0"),
        "=": function() {
            this.x = this.input;
            this.apply(this.op);
            return States.Operator;
        },
        ...defaults
    },

    Right: {
        C,
        "0": input("Right"),
        digit: input("Right"),
        ".": input("RightDecimal"),
        op: apply("Operator"),
        "=": apply("Left"),
    },

    RightZero: {
        C,
        digit: input("Right"),
        ".": input("RightDecimal"),
        op: apply("Operator"),
        "=": apply("Left"),
    },

    RightDecimal: {
        C,
        "0": input("RightDecimal"),
        digit: input("RightDecimal"),
        op: apply("Operator"),
        "=": apply("Left"),
    },
};

const Calculator = {
    button(text) {
        switch (text) {
            case "1": case "2": case "3": case "4":
            case "5": case "6": case "7": case "8": case "9":
                this.state = this.state.digit.call(this, text);
                break;
            case "+": case "-": case "×": case "÷":
                this.state = this.state.op.call(this, text);
                break;
            default:
                this.state = this.state[text]?.call(this, text) ?? this.state;
        }
    },

    clear() {
        this.input = "0";
        this.updateDisplay();
        return States.Init;
    },

    append(text) {
        this.input += text;
        this.updateDisplay();
    },

    apply(text) {
        const y = parseFloat(this.input);
        this.x = Ops[this.op](this.x, y);
        this.op = text;
        this.input = this.x.toString().
            replace(/(\.[1-9]*)000000000+\d$/, "$1").
            replace(/^infinity/i, "∞");
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
    button.addEventListener("click", () => { calculator.button(text); });
}

calculator.state = calculator.clear();
