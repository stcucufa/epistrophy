import { clockValue, html } from "./util.js";
import { Scheduler, Fiber } from "./kernel.js";

// Transport bar with rec/pause button and time display.
// FIXME 4Z03 Transport bar custom element
export class TransportBar {
    constructor() {
        const display = html("span", { class: "ep-transport-display" }, clockValue(0));
        const pause = html("button", { class: "ep-transport-button pause", type: "button" }, "Pause");
        const rec = html("button", { class: "ep-transport-button rec", type: "button" }, "Rec");
        const style = html("style", `
            .pause .ep-transport-button.pause,
            .rec .ep-transport-button.rec {
                display: none;
            }
        `);
        this.element = html("div", { class: "ep-transport pause" }, style, pause, rec, display);
        this.scheduler = new Scheduler();

        // Update the display as long as it is recording.
        this.scheduler.scheduleFiber(new Fiber().
            ramp(Infinity, fiber => { display.textContent = clockValue(fiber.now); }),
            0
        );

        // Use raw events so that the record button works event when paused.
        // FIXME 4X02 Kernel: fiber rate (positive)
        rec.addEventListener("click", () => { this.record(); });
        pause.addEventListener("click", () => { this.pause(); });
    }

    pause() {
        this.pausedTime = this.scheduler.clock.now;
        this.scheduler.clock.stop();
        this.element.classList.add("pause");
        this.element.classList.remove("rec");
        return this;
    }

    record() {
        const clock = this.scheduler.clock;
        clock.start();
        if (this.pausedTime) {
            clock.startTime -= this.pausedTime;
            clock.lastUpdateTime = this.pausedTime;
        }
        delete this.pausedTime;
        this.element.classList.remove("pause");
        this.element.classList.add("rec");
        return this;
    }

    schedule(f) {
        const fiber = new Fiber();
        f(fiber);
        this.scheduler.scheduleFiber(fiber, this.scheduler.now ?? this.scheduler.clock.now);
    }
}
