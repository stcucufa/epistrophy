import { clamp, customEvent, random, remove } from "../../lib/util.js";

const π = Math.PI;
const τ = 2 * π;

// The game object manages the all the objects that are drawn, updated, and
// colliding.
export default class Game extends EventTarget {
    StarsCount = 1111;

    // Create a new game in the given canvas (used for drawing), starting
    // with a background of stars.
    constructor(canvas) {
        super();
        this.canvas = canvas;
        this.width = canvas.clientWidth;
        this.height = canvas.clientHeight;
        this.objects = [new Background(this)];
        this.collidesWithAsteroid = [];
        // T: thrust, L/RL: left, R/LR: right
        this.inputs = {};
    }

    // Get a clear drawing context at the right device pixel ratio.
    get context() {
        this.canvas.width = this.width * window.devicePixelRatio;
        this.canvas.height = this.height * window.devicePixelRatio;
        return this.canvas.getContext("2d");
    }

    // Draw all objects in the game, in that order (so background comes first).
    draw() {
        const context = this.context;
        context.save();
        context.scale(window.devicePixelRatio, window.devicePixelRatio);
        for (const object of this.objects) {
            object.draw(context, this);
        }
        context.restore();
    }

    // All values for acceleration, velocity, &c. are based on this update
    // frequency.
    static UpdateFPS = 60;

    // Update all game objects by calling their update function, collecting
    // the set of objects that are leaving (e.g., the ship or an asteroid
    // exploding) or entering (e.g., particles or smaller asteroids).
    update() {
        const enter = new Set();
        const leave = new Set();
        for (const object of this.objects) {
            object.update?.(enter, leave, this.inputs);
        }
        for (const object of leave) {
            this.removeObject(object);
        }
        for (const object of enter) {
            this.addObject(object);
        }
        // Return the sets of objects entering and leaving.
        return [enter, leave];
    }

    // Add an object to the game, setting its `game` property back to this.
    addObject(object) {
        this.objects.push(object);
        object.game = this;
        if (object.collidesWithAsteroid) {
            this.collidesWithAsteroid.push(object);
        }
        return object;
    }

    // Remove an object from the game, deleting its `game` property.
    removeObject(object) {
        remove(this.objects, object);
        if (object.collidesWithAsteroid) {
            remove(this.collidesWithAsteroid, object);
        }
        if (object === this.ship) {
            delete this.ship;
        }
        delete object.game;
    }

    // Add a new ship to the game at the center of the screen.
    ship() {
        this.inputs = {};
        return this.ship = this.addObject(new Ship(this.width / 2, this.height / 2, -π / 2));
    }

    // Add a new asteroid to the game at a random position.
    asteroid() {
        return this.addObject(new Asteroid(this.width * Math.random(), this.height * Math.random()));
    }
}

// Background: a static star field. It is generated once per game and then
// drawn as the background of every frame.
class Background {
    BgColor = "#222";
    FgColor = "#f8f9f0";

    // Generate the image data to be drawn on every frame.
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

    // Draw the background.
    draw(context) {
        context.putImageData(this.imageData, 0, 0);
    }
}

// Base class for sprites (all moving objects in the game, including
// particles). Sprites have position, radius, velocity, acceleration,
// heading and angular velocity.
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
    dur = [100, 200];

    constructor(x, y, angle, velocity) {
        const d = 2 * (1 + Math.random());
        const h = angle + π + (1 - 2 * Math.random());
        super(x + d * Math.cos(h), y + d * Math.sin(h));
        this.heading = h;
        this.velocity = velocity;
        this.radius = 2 * Math.random();
        this.durationMs = random(...this.dur);
    }
}

class DebrisParticle extends Sprite {
    constructor(x, y, radius, velocity, dur) {
        super(x, y, Math.random() * τ);
        this.radius = radius;
        this.velocity = velocity;
        this.angularVelocity = Math.random() * 0.1;
        this.heading = Math.random() * τ;
        this.durationMs = dur;
    }

    draw(context) {
        this.beginPath(context);
        context.moveTo(-this.radius, 0);
        context.lineTo(this.radius, 0);
        this.stroke(context);
    }
}

class Ship extends Sprite {
    radius = 8;
    maxVelocity = 8;
    maxAngularVelocity = 0.07;
    maxAcceleration = 0.4;
    friction = -0.125;
    collidesWithAsteroid = true;
    debris = [4, 8];
    debrisVelocity = 0.1;
    debrisDur = [1000, 2000];

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

    update(enter, leave, inputs) {
        this.acceleration = inputs.T ? this.maxAcceleration : this.friction;
        this.angularVelocity = (inputs.R || inputs.LR) ? this.maxAngularVelocity :
            (inputs.L || inputs.RL) ? -this.maxAngularVelocity : 0;
        super.update(enter, leave, inputs);
        if (this.acceleration > 0) {
            const n = 10 * Math.random();
            for (let i = 0; i < n; ++i) {
                enter.add(new ExhaustParticle(this.x, this.y, this.angle, 0.1 * this.velocity));
            }
        }
    }

    collidedWithAsteroid(enter) {
        const velocity = this.maxVelocity * this.debrisVelocity;
        for (let i = random(...this.debris); i >= 0; --i) {
            enter.add(new DebrisParticle(
                this.x, this.y, this.radius * (0.5 + Math.random()), velocity, random(...this.debrisDur)
            ));
        }
    }
}

class Asteroid extends Sprite {
    minRadius = 12;
    maxRadius = 40;
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

    update(enter, leave) {
        super.update(enter, leave);
        for (const other of this.game.collidesWithAsteroid) {
            if (collides(this, other)) {
                leave.add(other);
                other.collidedWithAsteroid(enter);
                customEvent.call(this.game, "collided", { object: other, with: this });
            }
        }
    }
}

// Test whether two game objects `a` and `b` collide based on the distance
// between their centers and their respective radius.
function collides(a, b) {
    const distance = Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
    return distance < (a.radius + b.radius);
}
