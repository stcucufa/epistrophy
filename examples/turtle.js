const π = Math.PI;

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
    }

    r = 24;

    drawSelf(clear = false) {
        if (!this.isVisible) {
            return;
        }
        const context = this.canvas.context;
        if (clear) {
            context.putImageData(this.canvas.imageData, 0, 0);
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

    drawLineFrom(x, y) {
        const context = this.canvas.context;
        context.putImageData(this.canvas.imageData, 0, 0);
        if (!this.isPenDown) {
            return;
        }
        context.save();
        context.strokeStyle = this.color;
        context.lineWidth = 3;
        context.translate(this.canvas.width / 2, this.canvas.height / 2);
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(this.x, this.y);
        context.stroke();
        context.restore();
    }

    forward(d) {
        if (d === 0) {
            return;
        }
        const { x, y } = this;
        const dx = d * Math.cos(this.heading);
        const dy = d * Math.sin(this.heading);
        this.fiber.ramp(() => Math.abs(d) / this.velocity, {
            rampDidProgress: p => {
                this.x = x + p * dx;
                this.y = y + p * dy;
                this.drawLineFrom(x, y);
                this.drawSelf();
                if (p === 1) {
                    this.canvas.save();
                }
            }
        });
        return this;
    }

    back(d) {
        return this.forward(-d);
    }

    right(a) {
        if (a === 0) {
            return this;
        }
        const { heading } = this;
        const Δ = π * a / 180;
        this.fiber.ramp(() => Math.abs(a) / this.velocity, {
            rampDidProgress: p => {
                this.heading = heading + p * Δ;
                this.drawSelf(true);
            }
        })
        return this;
    }

    left(a) {
        return this.right(-a);
    }

    penup() {
        this.fiber.effect(() => { this.isPenDown = false; });
        return this;
    }

    pendown() {
        this.fiber.effect(() => { this.isPenDown = true; });
        return this;
    }

    hide() {
        this.fiber.effect(() => { this.isVisible = false; });
        return this;
    }

    show() {
        this.fiber.effect(() => { this.isVisible = true; });
        return this;
    }
}
