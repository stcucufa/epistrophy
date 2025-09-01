import { Fiber, Scheduler } from "./unrated.js";

// Delegate to join on first child ending, cancelling all siblings.
export const First = { childFiberDidJoin: cancelSiblings };

export function cancelSiblings(child, scheduler) {
    for (const sibling of child.parent.children) {
        scheduler.cancelFiber(sibling);
    }
}

// Create a new scheduler and a main fiber, then start the clock. The fiber is
// returned so that new instructions can be added immediately. Errors are also
// reported to the console.
export function run() {
    const scheduler = new Scheduler();
    scheduler.addEventListener("error", ({ detail: { error } }) => { console.error(error.message ?? error); })
    scheduler.clock.start();
    const fiber = new Fiber();
    scheduler.scheduleFiber(fiber, 0);
    return fiber;
}

export class TransportBar {
    constructor() {
        const display = html("span", { class: "ep-transport-display" });
        const pause = html("button", { class: "ep-transport-button", type: "button" }, "Pause");
        const rec = html("button", { class: "ep-transport-button", type: "button" }, "Rec");
        this.element = html("div", { class: "ep-transport" }, pause, rec, display);
        this.scheduler = new Scheduler();
        on(this.scheduler, "update", ({ end }) => { display.textContent = clockValue(end); });
        rec.addEventListener("click", () => {
            this.scheduler.clock.now = this.pausedTime ?? 0;
            this.scheduler.clock.start();
            delete this.pausedTime;
        });
        pause.addEventListener("click", () => {
            this.pausedTime = this.scheduler.clock.now;
            this.scheduler.clock.stop();
        });
    }

    schedule(f) {
        const fiber = new Fiber();
        f(fiber);
        this.scheduler.scheduleFiber(fiber, this.scheduler.now ?? this.scheduler.clock.now);
    }
}

const Second = 1000;
const Minute = 60 * Second;
const Hour = 60 * Minute;

export function clockValue(offset) {
    const ms = Math.round(offset);
    const pad = n => Math.floor(n).toString().padStart(2, "0");
    return `${Math.floor(offset / Hour)}:${pad((offset / Minute) % 60)}:${pad((offset / Second) % 60)}.${
        ((ms % 1000) / 1000).toFixed(3).substring(2)
    }`;
}

export function html(name, attributes, ...content) {
    const element = document.createElement(name);
    const hasAttributes = attributes && typeof attributes === "object" && !(attributes instanceof Node);
    if (hasAttributes) {
        for (const [name, value] of Object.entries(attributes)) {
            element.setAttribute(name, value);
        }
    }
    function appendChild(child) {
        if (typeof child === "string") {
            element.appendChild(document.createTextNode(child.toString()));
        } else if (Array.isArray(child)) {
            for (const ch of child) {
                appendChild(ch);
            }
        } else {
            element.appendChild(child);
        }
    }
    const children = hasAttributes ? content : attributes ? [attributes, ...content] : content;
    for (const child of children) {
        appendChild(child);
    }
    return element;
}
