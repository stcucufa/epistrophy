import { html, svg } from "./util.js";
import { Scheduler, Fiber } from "./kernel.js";

// Transport bar with rec/pause button and time display.
// FIXME 4Z03 Transport bar custom element
export class TransportBar {
    constructor() {
        const pause = html("button", { class: "ep-transport-button pause", type: "button" },
            svg("svg", { viewBox: "0 0 100 100" },
                svg("g", { fill: "currentColor", stroke: "none" },
                    svg("rect", { x: 20, y: 20, width: 20, height: 60 }),
                    svg("rect", { x: 60, y: 20, width: 20, height: 60 })
                )
            )
        );
        const rec = html("button", { class: "ep-transport-button rec", type: "button" },
            svg("svg", { viewBox: "0 0 100 100" },
                svg("circle", { fill: "currentColor", stroke: "none", cx: 50, cy: 50, r: 33 })
            )
        );
        const digits = Array(8).fill().map(() => html("span", "0"));
        const display = html("span", { class: "ep-transport-display" },
            digits[0], digits[1], html("span", ":"), digits[2], digits[3], html("span", ":"),
            digits[4], digits[5], html("span", "."), digits[6], digits[7]
        );
        const style = html("style", `
            .ep-transport {
                width: 100%;
                padding: 0.5rem 0;
                text-align: center;
            }

            .ep-transport-button {
                font-size: 1em;
                border: solid 1px;
                border-radius: 1em;
                height: 2em;
                width: 2em;
                background-color: var(--picotron-white);
                padding: 0.25em;
            }

            .ep-transport.rec .ep-transport-button.rec,
            .ep-transport.pause .ep-transport-button.pause {
                background-color: var(--picotron-dark-blue);
                color: var(--picotron-white);
            }

            .ep-transport-display {
                display: inline-block;
                border: solid 1px;
                vertical-align: bottom;
                border-radius: 1em;
                padding: calc(0.5em - 1px) 0.75em;
                line-height: 1em;
            }

            .ep-transport-display > span {
                display: inline-block;
                width: 1ch;
                text-align: center;
            }

            .ep-transport-button svg {
                display: block;
            }
        `);
        this.element = html("div", { class: "ep-transport pause" }, style, " ", pause, " ", rec, " ", display);
        this.scheduler = new Scheduler();

        // Update the individual digits of the display as long as it is
        // recording.
        this.scheduler.scheduleFiber(new Fiber().
            ramp(Infinity, fiber => {
                // Hours
                const hours = Math.floor(fiber.now / 3_600_000);
                digits[0].textContent = Math.floor(hours / 10) % 10;
                digits[1].textContent = hours % 10;
                // Minutes
                const minutes = Math.floor(fiber.now / 60_000) % 60;
                digits[2].textContent = Math.floor(minutes / 10);
                digits[3].textContent = minutes % 10;
                // Seconds
                const seconds = Math.floor(fiber.now / 1000) % 60;
                digits[4].textContent = Math.floor(seconds / 10);
                digits[5].textContent = seconds % 10;
                // Hundredths of seconds
                digits[6].textContent = Math.floor((fiber.now / 100) % 10);
                digits[7].textContent = Math.floor((fiber.now / 10) % 10);
            }),
            0
        );

        // Use raw events so that the record button works event when paused.
        // FIXME 4X02 Kernel: fiber rate (positive)
        rec.addEventListener("click", () => { this.record(); });
        pause.addEventListener("click", () => { this.pause(); });
    }

    // Pause the transport bar.
    pause() {
        if (this.element.classList.contains("pause")) {
            return;
        }
        this.element.classList.add("pause");
        this.element.classList.remove("rec");
        this.pausedTime = this.scheduler.clock.now;
        this.scheduler.clock.stop();
        return this;
    }

    // Record new events, resuming from the current paused time (or starting
    // from zero).
    record() {
        if (this.element.classList.contains("rec")) {
            return;
        }
        this.element.classList.remove("pause");
        this.element.classList.add("rec");
        const clock = this.scheduler.clock;
        clock.start();
        if (this.pausedTime) {
            clock.startTime -= this.pausedTime;
            clock.lastUpdateTime = this.pausedTime;
        }
        delete this.pausedTime;
        return this;
    }

    // Schedule a new fiber through the transport bar’s scheduler. `f` is
    // called on the fiber, is provided, and the fiber is returned.
    schedule(f) {
        const fiber = new Fiber();
        f?.(fiber);
        this.scheduler.scheduleFiber(fiber, this.scheduler.now ?? this.scheduler.clock.now);
        return fiber;
    }
}
