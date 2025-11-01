import { extend, svg } from "../lib/util.js";

const π = Math.PI;

const ease = p => p * p * (3 - 2 * p);

export default class Turtle {
    constructor(fiber) {
        this.fiber = fiber;
        this.canvas = svg("g");
        this.x = 0;
        this.y = 0;
        this.heading = -π / 2;
        this.isPenDown = true;
        this.isVisible = true;
        this.dot = svg("circle", { stroke: "none", fill: "currentColor", r: this.r / 4 });
        this.turtle = svg("g",
            this.dot,
            svg("path", { d: `M${this.r},0L${-this.r},${0.8 * this.r}L${-this.r},${-0.8 * this.r}z` })
        );
        this.element = svg("g", {
            fill: "none", stroke: "currentColor", "stroke-width": 3, "stroke-linecap": "round"
        }, this.canvas, this.turtle);
        this.update();
    }

    velocity = 1;
    angularVelocity = 0.5;
    r = 24;

    update() {
        this.turtle.setAttribute("transform", `translate(${this.x}, ${this.y}) rotate(${this.heading * 180 / π})`);
        this.turtle.setAttribute("opacity", this.isVisible ? 1 : 0);
        this.dot.setAttribute("opacity", this.isPenDown ? 1 : 0);
    }

    forward(d) {
        this.fiber.
            call(() => ({
                x: this.x,
                y: this.y,
                dx: d * Math.cos(this.heading),
                dy: d * Math.sin(this.heading),
                line: this.isPenDown ? this.canvas.appendChild(svg("line", { x1: this.x, y1: this.y })) : null
            })).
            ramp(() => Math.abs(d) / this.velocity, ({ p, value: { x, y, dx, dy, line } }) => {
                const t = ease(p);
                this.x = x + t * dx;
                this.y = y + t * dy;
                line?.setAttribute("x2", this.x);
                line?.setAttribute("y2", this.y);
                this.update();
            });
        return this;
    }

    back(d) {
        return this.forward(-d);
    }

    right(a) {
        const th = π * a / 180;
        this.fiber.
            call(() => this.heading).
            ramp(() => Math.abs(a) / this.angularVelocity, ({ p, value: heading }) => {
                this.heading = heading + ease(p) * th;
                this.update();
            });
        return this;
    }

    left(a) {
        return this.right(-a);
    }

    penup() {
        this.fiber.call(() => {
            if (this.isPenDown) {
                this.isPenDown = false;
                this.update();
            }
        });
        return this;
    }

    pendown() {
        this.fiber.call(() => {
            if (!this.isPenDown) {
                this.isPenDown = true;
                this.update();
            }
        });
        return this;
    }

    hide() {
        this.fiber.call(() => {
            if (this.isVisible) {
                this.isVisible = false;
                this.update();
            }
        });
        return this;
    }

    show() {
        this.fiber.call(() => {
            if (!this.isVisible) {
                this.isVisible = true;
                this.update();
            }
        });
        return this;
    }

    wait(dur) {
        this.fiber.ramp(dur);
        return this;
    }

    repeat(count, f) {
        this.fiber.repeat(
            fiber => { f(extend(this, { fiber })); },
            { repeatShouldEnd: i => i === count }
        );
        return this;
    }

    to(name, f) {
        this[name] = function(...args) {
            f(this, ...args);
            return this;
        };
        return this;
    }

    speed(s) {
        this.fiber.call(fiber => { fiber.scheduler.setRateForFiber(fiber, s); });
        return this;
    }
}
