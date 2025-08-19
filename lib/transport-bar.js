import Fiber from "./fiber.js";
import { clockValue, html } from "./util.js";

export default class TransportBar {
    constructor() {
        const display = html("span", { class: "ep-transport-display" });
        const pause = html("button", { class: "ep-transport-button", type: "button" }, "Pause");
        const rec = html("button", { class: "ep-transport-button", type: "button" }, "Rec");
        this.element = html("div", { class: "ep-transport" }, pause, rec, display);
        const transportFiber = this.fiber = new Fiber().
            sync(({ scope }) => { scope.paused = []; }).
            spawn(fiber => fiber.
                ramp(Infinity, (_, __, scheduler) => {
                    // FIXME 4S06 Get ramp info
                    display.textContent = clockValue(scheduler.now);
                })
            ).
            spawn(fiber => fiber.
                event(pause, "click").
                sync(({ scope }, scheduler) => {
                    for (const fiber of scheduler.fibers.keys()) {
                        if (fiber !== transportFiber && fiber.rate !== 0) {
                            scope.paused.push([fiber, fiber.rate]);
                            scheduler.setFiberRate(fiber, 0);
                        }
                    }
                    console.log(scope);
                })
            ).
            spawn(fiber => fiber.
                event(rec, "click").
                sync(({ scope }, scheduler) => {
                    console.log(scope);
                    for (const [fiber, rate] of scope.paused) {
                        scheduler.setFiberRate(fiber, rate);
                    }
                })
            );
    }
}
