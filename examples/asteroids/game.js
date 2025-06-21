import { clamp, remove } from "../../lib/util.js";

const π = Math.PI;
const τ = 2 * π;

export default class Game {
    Friction = -0.125;
    StarsCount = 1111;
    static UpdateFPS = 60;

    constructor(canvas) {
        this.canvas = canvas;
        this.width = canvas.clientWidth;
        this.height = canvas.clientHeight;
        this.objects = [new Background(this)];
    }

    get context() {
        this.canvas.width = this.width * window.devicePixelRatio;
        this.canvas.height = this.height * window.devicePixelRatio;
        return this.canvas.getContext("2d");
    }

    draw() {
        const context = this.context;
        context.save();
        context.scale(window.devicePixelRatio, window.devicePixelRatio);
        for (const object of this.objects) {
            object.draw(context, this);
        }
        context.restore();
    }

    addObject(object) {
        this.objects.push(object);
        object.game = this;
        return object;
    }

    removeObject(object) {
        remove(this.objects, object);
    }

    ship() {
        return this.addObject(new Ship(this.width / 2, this.height / 2, -π / 2));
    }

    asteroid() {
        return this.addObject(new Asteroid(this.width * Math.random(), this.height * Math.random()));
    }
}

class Background {
    BgColor = "#222";
    FgColor = "#f8f9f0";

    constructor(game) {
        const context = game.context;
        const width = context.canvas.width;
        const height = context.canvas.height;
        context.fillStyle = this.BgColor;
        context.fillRect(0, 0, width, height);
        context.fillStyle = this.FgColor;
        for (let i = 0; i < game.StarsCount; ++i) {
            const x = Math.floor(Math.random() * width);
            const y = Math.floor(Math.random() * height);
            const r = 2 * window.devicePixelRatio * Math.random();
            const a = 0.5 * (1 + Math.random());
            context.globalAlpha = a;
            context.beginPath();
            context.arc(x, y, r, 0, τ);
            context.fill();
        }
        this.imageData = context.getImageData(0, 0, width, height);
    }

    draw(context) {
        context.putImageData(this.imageData, 0, 0);
    }
}

class Sprite {
    fgColor = "#f8f9f0";
    lineWidth = 2;
    lineJoin = "round";
    angularVelocity = 0;
    velocity = 0;
    acceleration = 0;
    maxVelocity = Infinity;

    constructor(x, y, angle = 0) {
        this.x = x;
        this.y = y;
        this.angle = angle;
    }

    update() {
        this.angle += this.angularVelocity;
        this.velocity = clamp(this.velocity + this.acceleration, 0, this.maxVelocity)
        this.x = (this.game.width + this.x + this.velocity * Math.cos(this.heading ?? this.angle)) % this.game.width;
        this.y = (this.game.height + this.y + this.velocity * Math.sin(this.heading ?? this.angle)) % this.game.height;
    }

    beginPath(context) {
        context.save();
        context.translate(this.x, this.y);
        context.rotate(this.angle);
        context.beginPath();
    }

    stroke(context) {
        context.strokeStyle = this.fgColor;
        context.lineWidth = this.lineWidth;
        context.lineJoin = this.lineJoin;
        context.stroke();
        context.restore();
    }
}

class PointParticle extends Sprite {
    constructor(x, y) {
        super(x, y);
    }

    draw(context) {
        context.save();
        context.fillStyle = this.fgColor;
        context.beginPath();
        context.moveTo(this.x, this.y);
        context.arc(this.x, this.y, this.radius, 0, τ);
        context.fill();
        context.restore();
    }
}

class ExhaustParticle extends PointParticle {
    fgColor = "#ffff40";

    constructor(x, y, angle, velocity) {
        const d = 2 * (1 + Math.random());
        const h = angle + π + (1 - 2 * Math.random());
        super(x + d * Math.cos(h), y + d * Math.sin(h));
        this.heading = h;
        this.velocity = velocity;
        this.radius = 2 * Math.random();
        this.durationMs = 100 * (1 + Math.random());
    }
}

class Ship extends Sprite {
    radius = 8;
    maxVelocity = 8;
    maxAngularVelocity = 0.1;
    maxAcceleration = 1;

    constructor(x, y, angle) {
        super(x, y, angle);
    }

    draw(context) {
        this.beginPath(context);
        context.moveTo(2 * this.radius, 0);
        context.lineTo(-2 * this.radius, this.radius);
        context.lineTo(-this.radius, 0);
        context.lineTo(-2 * this.radius, -this.radius);
        context.closePath();
        this.stroke(context);
    }

    update() {
        super.update();
        const particles = [];
        if (this.acceleration > 0) {
            const n = 10 * Math.random();
            for (let i = 0; i < n; ++i) {
                particles.push(this.game.addObject(new ExhaustParticle(this.x, this.y, this.angle, 0.1 * this.velocity)));
            }
        }
        return particles;
    }
}

class Asteroid extends Sprite {
    minRadius = 12;
    maxRadius = 32;
    startVelocity = 2;
    maxAngularVelocity = 0.01;

    constructor(x, y) {
        super(x, y);
        this.radius = this.maxRadius;
        this.heading = Math.random() * τ;
        this.velocity = this.startVelocity;
        this.angularVelocity = this.maxAngularVelocity * Math.random();
        const n = (this.minRadius + this.maxRadius) / 2;
        this.points = Array(n).fill().map((_, i) => {
            const θ = τ * i / n;
            const d = (0.7 + 0.6 * Math.random()) * this.radius
            return [d * Math.cos(θ), d * Math.sin(θ)];
        });
    }

    draw(context) {
        this.beginPath(context);
        const [[x, y], ...ps] = this.points;
        context.moveTo(x, y);
        for (const [x, y] of ps) {
            context.lineTo(x, y);
        }
        context.closePath();
        this.stroke(context);
    }
}
