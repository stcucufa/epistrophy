import { clockValue, html } from "./util.js";
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
        const display = html("span", { class: "ep-transport-display" }, clockValue(0));
        const pause = html("button", { class: "ep-transport-button", type: "button" }, "Pause");
        const rec = html("button", { class: "ep-transport-button", type: "button" }, "Rec");
        this.element = html("div", { class: "ep-transport" }, pause, rec, display);
        this.scheduler = new Scheduler();
        this.scheduler.addEventListener("update", ({ detail: { end } }) => { display.textContent = clockValue(end); });
        rec.addEventListener("click", () => {
            const clock = this.scheduler.clock;
            clock.start();
            if (this.pausedTime) {
                clock.startTime -= this.pausedTime;
                clock.lastUpdateTime = this.pausedTime;
            }
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
