import Fiber from "./fiber.js";
import { clockValue, html } from "./util.js";

export default class TransportBar {
    constructor() {
        const display = html("span", { class: "ep-transport-display" });
        this.element = html("div", { class: "ep-transport" }, display);
        this.fiber = new Fiber().
            ramp(Infinity, (_, __, scheduler) => {
                // FIXME 4S06 Get ramp info
                display.textContent = clockValue(scheduler.now);
            });
    }
}
