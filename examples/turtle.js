const π = Math.PI;

export class Canvas {
    constructor(element) {
        this.element = element;
        element.width = window.devicePixelRatio * element.clientWidth;
        element.height = window.devicePixelRatio * element.clientHeight;
        const context = element.getContext("2d");
        this.imageData = context.getImageData(0, 0, element.width, element.height);
    }
}

export class Turtle {
    constructor(color = "#1d2b53") {
        this.x = 0;
        this.y = 0;
        this.heading = -π / 2;
        this.isPenDown = true;
        this.isVisible = true;
        this.color = color;
    }

    r = 24;

    draw(context) {
        if (!this.isVisible) {
            return;
        }
        context.save();
        context.strokeStyle = this.color;
        context.lineWidth = 3;
        context.lineJoin = "round";
        context.translate(context.canvas.width / 2 + this.x, context.canvas.height / 2 + this.y);
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
}
