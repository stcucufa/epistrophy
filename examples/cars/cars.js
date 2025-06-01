import Scheduler from "../../lib/scheduler.js";
import Fiber from "../../lib/fiber.js";

const WIDTH = 800;
const HEIGHT = 600;

Scheduler.run().
    exec(() => document.querySelector("canvas")).
    ramp(Infinity, {
        rampDidProgress(_, { value: canvas }) {
            canvas.width = WIDTH;
            canvas.height = HEIGHT;
        }
    });

