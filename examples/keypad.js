import { html } from "../lib/util.js";
import { FirstValue } from "../lib/shell.js";

export default class Keypad {

    // Create a new keypad element with the given button layout.
    constructor() {
        this.output = html("output");
        this.buttons = "789456123A0B".split("").map(
            b => html("button", { type: "button", tabindex: 0, "aria-keyboardshortcuts": b }, b)
        );
        this.div = html("div", { tabindex: 0 }, this.output, this.buttons);
        this.element = html("div",
            html("style", `@scope {
div {
    --button-size: 4em;
    --gap: 0.5em;

    display: grid;
    width: calc(3 * var(--button-size) + 2 * var(--gap));
    margin: auto;
    grid-template-columns: repeat(3, var(--button-size));
    grid-template-rows: 3em repeat(4, var(--button-size));
    gap: var(--gap);
}

output {
    grid-column-start: 1;
    grid-column-end: 4;
    font-size: 2em;
    text-align: center;
    line-height: 1.4em;
    border: solid thin;
    border-radius: 0.5rem;
}

button {
    font-size: 2em;
}
            }`), this.div
        );
    }

    get text() {
        return this.output.value;
    }

    set text(value) {
        this.output.value = value;
    }

    // Wait for any of the buttons to be pressed and continue with the text of
    // the pressed button.
    button(fiber) {
        const keys = Object.fromEntries(this.buttons.map(button =>
            ([button.textContent.toLowerCase(), button.textContent])
        ));
        fiber.
            spawn(φ => φ.
                event(this.div, "keydown", {
                    eventShouldBeIgnored: event => !Object.hasOwn(keys, event.key.toLowerCase()),
                    eventWasHandled(event, fiber) {
                        fiber.value = keys[event.key.toLowerCase()];
                    }
                })
            ).
            spawn(φ => φ.
                K(this.buttons).
                mapfirst(φ => φ.
                    event(({ value: button }) => button, "click").
                    call(({ value: button }) => button.textContent)
                )
            ).
            join(FirstValue);
    }
}
