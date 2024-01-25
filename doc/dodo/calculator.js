const Ops = {
    "+": (x, y) => x + y,
    "-": (x, y) => x - y,
    "*": (x, y) => x * y,
    "/": (x, y) => x / y,
};

function C() {
    return this.clear();
}

const input = state => function(text) {
    this.append(text);
    return States[state];
}

function op(text) {
    this.op = text;
    return States.Operator;
}

const States = {
    Init: {
        C,
        digit: input("Left"),
        ".": input("LeftDecimal"),
        op
    },

    Left: {
        C,
        digit: input("Left"),
        ".": input("LeftDecimal"),
        op
    },

    LeftDecimal: {
        C,
        digit: input("LeftDecimal"),
        op,
    },

    Operator: {
        C,

        digit(text) {
            this.x = this.input ? parseFloat(this.input) : 0;
            this.input = "";
            this.append(text);
            return States.Right;
        },

        ".": function() {
            this.x = this.input ? parseFloat(this.input) : 0;
            this.input = "0";
            this.append(".");
            return States.RightDecimal;
        },

        op,

        "=": function() {
            this.x = this.input ? parseFloat(this.input) : 0;
            this.apply(this.op);
            return States.Operator;
        }
    },

    Right: {
        C,
        digit: input("Right"),
        ".": input("RightDecimal"),

        op(text) {
            this.apply(text);
            return States.Operator;
        },

        "=": function() {
            this.apply();
            return States.Left;
        }
    },

    RightDecimal: {
        C,
        digit: input("RightDecimal"),

        op(text) {
            this.apply(text);
            return States.Operator;
        },

        "=": function() {
            this.apply();
            return States.Left;
        }
    },
};

const Calculator = {
    button(text) {
        switch (text) {
            case "0": case "1": case "2": case "3": case "4":
            case "5": case "6": case "7": case "8": case "9":
                this.state = this.state.digit.call(this, text);
                break;
            case "+": case "-": case "*": case "/":
                this.state = this.state.op.call(this, text);
                break;
            default:
                this.state = this.state[text]?.call(this, text) ?? this.state;
        }
    },

    clear() {
        this.input = "";
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
        this.input = this.x.toString();
        this.updateDisplay();
    },

    updateDisplay() {
        let input = this.input || "0";
        if (/^\./.test(input)) {
            input = `0${input}`;
        }
        this.display.textContent = input.replace(/^0+(?=[0-9])/, "");
    }
};

const calculator = Object.assign(Object.create(Calculator), {
    display: document.getElementById("display"),
});

for (const button of document.querySelectorAll("button")) {
    const text = button.textContent;
    button.addEventListener("click", () => { calculator.button(text); });
}

calculator.state = calculator.clear();
