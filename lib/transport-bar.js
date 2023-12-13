import { on } from "./events.js";
import { assoc, clockTime, create, html, nop, svg } from "./util.js";
import { SVG_NS as xmlns } from "./util.js";

const Pressed = Symbol();
const PlaybackRates = [1, 2, 4, 8, 0.25, 0.5];

const proto = {
    init() {
        this.state = this.vm.clock.running ? "recording" : "stopped";
        Object.defineProperty(this, "element", {
            enumerable: true,
            value: this.createElement()
        });
        for (const event of ["update", "rate"]) {
            on(this.vm.clock, event, e => { this.updateDisplay(); });
        }
        for (const event of ["start", "stop", "pause", "resume"]) {
            on(this.vm.clock, event, e => { this.syncState(e); });
        }
    },

    remove() {
        this.stop();
        this.element.remove();
    },

    createElement() {
        this.buttons = assoc(["Record", "Rewind", "Play", "Pause", "Ffwd", "Stop"], name => {
            const d = Buttons[name];
            const button = html("button", { type: "button", tabindex: 1, name },
                svg("svg", { xmlns, viewBox: "-4 -4 108 108" },
                    typeof d === "string" ? svg("path", {
                        d, "stroke-width": 8, "stroke-linejoin": "round"
                    }) : d
                )
            );
            button.addEventListener("click", () => { this.changeState(name); });
            return [name, button];
        });

        this.timeDisplay = html("span", { class: "time" }, "xx:xx");
        this.rateDisplay = html("span", { class: "rate" }, "x");
        this.update();
        return html("div", { class: "transport-bar" }, ...this.buttons.values(),
            html("div", { class: "display" }, this.timeDisplay, this.rateDisplay)
        );
    },

    record() {
        this.changeState("Record");
    },

    pause() {
        this.changeState("Pause");
    },

    stop() {
        this.changeState("Stop");
    },

    rewind() {
        const clock = this.vm.clock;
        const index = PlaybackRates.indexOf(-clock.rate);
        clock.rate = -PlaybackRates[index < 0 ? 0 : (index + 1) % PlaybackRates.length];
    },

    ffwd() {
        const clock = this.vm.clock;
        const index = PlaybackRates.indexOf(clock.rate);
        clock.rate = PlaybackRates[index < 0 ? 0 : (index + 1) % PlaybackRates.length];
    },

    changeState(q, withEffect = true) {
        if (Array.isArray(States[this.state][q])) {
            const [state, effect] = States[this.state][q];
            this.state = state;
            if (withEffect) {
                effect.call(this, this.vm);
            }
            this.update();
        }
    },

    syncState(e) {
        switch (e.type) {
            case "start":
            case "resume":
                this.changeState("Record", false);
                break;
            case "stop":
                this.changeState(e.broken ? "Broken" : "Stop", false);
                break;
            case "pause":
                this.changeState("Pause", false);
                break;
        }
    },

    update() {
        this.updateDisplay();
        for (const key of Object.keys(Buttons)) {
            const button = this.buttons.get(key);
            button.disabled = !Array.isArray(States[this.state][key]);
            button.classList.toggle("pressed", States[this.state][key] === Pressed);
        }
    },

    updateDisplay() {
        this.timeDisplay.textContent = clockTime(1000 * Math.floor(this.vm.clock.now / 1000));
        const rate = this.vm.clock.rate;
        this.rateDisplay.textContent = rate.toString();
        this.rateDisplay.classList.toggle("hidden", rate === 1);
    },
};

export const TransportBar = vm => create().call(proto, { vm });

const States = {
    stopped: {
        Record: ["recording", vm => { vm.start(); }]
    },

    paused: {
        Record: ["recording", vm => { vm.clock.resume(); }],
        Pause: Pressed,
        Stop: ["stopped", vm => { vm.clock.stop(); }]
    },

    recording: {
        Record: Pressed,
        Rewind: ["recording", function() { this.rewind(); }],
        Pause: ["paused", vm => { vm.clock.pause(); }],
        Ffwd: ["recording", function() { this.ffwd(); }],
        Stop: ["stopped", vm => { vm.clock.stop(); }],
        Broken: ["broken", nop]
    },

    broken: {}
}

const Buttons = {
    Record: svg("circle", { cx: 50, cy: 50, r: 40 }),
    Rewind: "M100,20v60L50,50z M50,20v60L0,50z",
    Stop: "M20,20v60h60v-60z",
    Play: "M15.359,10v80L69.282,50z",
    Pause: "M20,20v60h20v-60z M60,20v60h20v-60z",
    Ffwd: "M0,20v60L50,50z M50,20v60L100,50z",
};
