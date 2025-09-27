import { extend } from "../lib/util.js";

const π = Math.PI;

const ease = p => p * p * (3 - 2 * p);

export class Canvas {
    constructor(element) {
        this.element = element;
        element.width = window.devicePixelRatio * element.clientWidth;
        element.height = window.devicePixelRatio * element.clientHeight;
        this.imageData = this.context.getImageData(0, 0, this.width, this.height);
    }

    get context() {
        return this.element.getContext("2d");
    }

    get width() {
        return this.element.width;
    }

    get height() {
        return this.element.height;
    }

    save() {
        this.imageData = this.context.getImageData(0, 0, this.width, this.height);
    }
}

export class Turtle {
    constructor(fiber, canvas, color = "#1d2b53") {
        this.fiber = fiber;
        this.canvas = canvas;
        this.x = 0;
        this.y = 0;
        this.heading = -π / 2;
        this.isPenDown = true;
        this.isVisible = true;
        this.color = color;
        this.velocity = 1;
        this.angularVelocity = 0.5;
        fiber.call(() => { this.drawSelf(); });
    }

    r = 24;

    drawSelf(clear = false) {
        const context = this.canvas.context;
        if (clear) {
            context.putImageData(this.canvas.imageData, 0, 0);
        }
        if (!this.isVisible) {
            return;
        }
        context.save();
        context.strokeStyle = this.color;
        context.lineWidth = 3;
        context.lineJoin = "round";
        context.translate(this.canvas.width / 2 + this.x, this.canvas.height / 2 + this.y);
        context.rotate(this.heading);
        context.beginPath();
        context.moveTo(this.r, 0);
        context.lineTo(-this.r, 0.8 * this.r);
        context.lineTo(-this.r, -0.8 * this.r);
        context.closePath();
        context.stroke();
        if (this.isPenDown) {
            context.beginPath();
            context.moveTo(0, 0);
            context.arc(0, 0, 0.25 * this.r, 0, 2 * π);
            context.fill();
        }
        context.restore();
        return this;
    }

    forward(d) {
        this.fiber.
            call(() => ({
                x: this.x,
                y: this.y,
                dx: d * Math.cos(this.heading),
                dy: d * Math.sin(this.heading)
            })).
            ramp(() => Math.abs(d) / this.velocity, ({ p, value: { x, y, dx, dy } }) => {
                const t = ease(p);
                this.x = x + t * dx;
                this.y = y + t * dy;
                const context = this.canvas.context;
                context.putImageData(this.canvas.imageData, 0, 0);
                if (this.isPenDown) {
                    context.save();
                    context.strokeStyle = this.color;
                    context.lineJoin = "round";
                    context.lineCap = "round";
                    context.lineWidth = 3;
                    context.translate(this.canvas.width / 2, this.canvas.height / 2);
                    context.beginPath();
                    context.moveTo(x, y);
                    context.lineTo(this.x, this.y);
                    context.stroke();
                    context.restore();
                    if (p === 1) {
                        this.canvas.save();
                    }
                }
                this.drawSelf();
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
                this.drawSelf(true);
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
                this.drawSelf(true);
            }
        });
        return this;
    }

    pendown() {
        this.fiber.call(() => {
            if (!this.isPenDown) {
                this.isPenDown = true;
                this.drawSelf(true);
            }
        });
        return this;
    }

    hide() {
        this.fiber.call(() => {
            if (this.isVisible) {
                this.isVisible = false;
                this.drawSelf(true);
            }
        });
        return this;
    }

    show() {
        this.fiber.call(() => {
            if (!this.isVisible) {
                this.isVisible = true;
                this.drawSelf(true);
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
}
