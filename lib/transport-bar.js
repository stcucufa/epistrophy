import { html, svg } from "./util.js";
import { Scheduler, Fiber } from "./kernel.js";

// Transport bar with play/pause button and time display.
// FIXME 4Z03 Transport bar custom element
export class TransportBar {
    constructor() {

        // Pause button
        const pause = html("button", { class: "ep-transport-button pause", type: "button" },
            svg("svg", { viewBox: "0 0 100 100" },
                svg("g", { fill: "currentColor", stroke: "none" },
                    svg("rect", { x: 20, y: 20, width: 20, height: 60 }),
                    svg("rect", { x: 60, y: 20, width: 20, height: 60 })
                )
            )
        );

        // Play button
        const p = 2 * Math.PI / 3;
        const r = 40;
        const play = html("button", { class: "ep-transport-button play", type: "button" },
            svg("svg", { viewBox: "0 0 100 100" },
                svg("path", { fill: "currentColor", stroke: "none", d: `
                    M${50 + r },50
                    L${50 + r * Math.cos(p)},${50 + r * Math.sin(p)}
                    L${50 + r * Math.cos(2 * p)},${50 + r * Math.sin(2 * p)}
                    z
                ` })
            )
        );

        // Display with individual digits (hh:mm:ss.ms)
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
                border: solid 1px var(--ep-transport-button-foreground);
                border-radius: 1em;
                height: 2em;
                width: 2em;
                color: var(--ep-transport-button-foreground);
                background-color: var(--ep-transport-button-background);
                padding: 0.25em;
            }

            .ep-transport.play .ep-transport-button.play,
            .ep-transport.pause .ep-transport-button.pause {
                background-color: var(--ep-transport-button-foreground);
                border-color: var(--ep-transport-button-foreground);
                color: var(--ep-transport-button-background);
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
        this.element = html("div", { class: "ep-transport pause" }, style, " ", pause, " ", play, " ", display);
        this.scheduler = new Scheduler();

        // Update the individual digits of the display while playing.
        this.scheduler.scheduleFiber(new Fiber().
            ramp(Infinity, fiber => {
                const hours = Math.floor(fiber.now / 3_600_000);
                digits[0].textContent = Math.floor(hours / 10) % 10;
                digits[1].textContent = hours % 10;
                const minutes = Math.floor(fiber.now / 60_000) % 60;
                digits[2].textContent = Math.floor(minutes / 10);
                digits[3].textContent = minutes % 10;
                const seconds = Math.floor(fiber.now / 1000) % 60;
                digits[4].textContent = Math.floor(seconds / 10);
                digits[5].textContent = seconds % 10;
                digits[6].textContent = Math.floor((fiber.now / 100) % 10);
                digits[7].textContent = Math.floor((fiber.now / 10) % 10);
            }),
            0
        );

        // Use raw events so that the play button works event when paused.
        // FIXME 4X02 Kernel: fiber rate (positive)
        play.addEventListener("click", () => { this.play(); });
        pause.addEventListener("click", () => { this.pause(); });
    }

    // Pause the transport bar.
    pause() {
        if (this.element.classList.contains("pause")) {
            return;
        }
        this.element.classList.add("pause");
        this.element.classList.remove("play");
        this.pausedTime = this.scheduler.clock.now;
        this.scheduler.clock.stop();
        return this;
    }

    // Play, resuming from the current paused time (or starting from zero).
    play() {
        if (this.element.classList.contains("play")) {
            return;
        }
        this.element.classList.remove("pause");
        this.element.classList.add("play");
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
