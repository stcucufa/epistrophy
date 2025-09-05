import { run, First, PreventDefault } from "../../lib/shell.js";

// Create the promise of an image at `src` to be fulfilled when the image is
// loaded (or rejected in case of error).
const loadImage = src => async () => new Promise((resolve, reject) => {
    const image = new Image();
    image.src = src;
    if (image.complete) {
        resolve(image);
    } else {
        image.addEventListener("load", () => { resolve(image); });
        image.addEventListener("error", () => { reject(Error(`Cannot load image with src="${src}"`)); });
    }
});

const Width = 800;
const Height = 600;
const Lanes =  [50, 200, 350];
const Danger = [-100, 250];
const GameDuration = 5000;
const N = [7, 12];
const Srcs = ["red1.png", "red2.png", "gray1.png", "gray2.png", "crash1.png", "crash2.png", "flag1.png", "flag2.png"];

// Setup the game object.
function setup() {
    return {
        canvas: document.querySelector("canvas"),
        progress: document.querySelector("progress"),
        images: {}
    };
}

// Load all images concurrently.
function loadImages(fiber) {
    for (const src of Srcs) {
        fiber.spawn(fiber => fiber.async(loadImage(src), {
            asyncWillEndWithValue(image, { scope }) {
                scope.value = [src, image];
            }
        }));
    }
    fiber.join({
        childFiberDidJoin(child) {
            const [src, image] = child.scope.value;
            child.parent.scope.images[src] = image;
        }
    });
}

// Show the splash screen and way for a key press to begin.
const splash = fiber => fiber.
    sync(({ scope: { progress } }) => {
        progress.value = 0;
        progress.max = GameDuration;
    }).
    sync(({ scope: { canvas } }) => {
        canvas.width = Width;
        canvas.height = Height;
        const context = canvas.getContext("2d");
        context.save();
        context.fillStyle = "#1d2b53";
        context.font = "italic 96px system-ui, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText("RACE!", Width / 2, Height / 2);
        context.restore();
    }).
    event(window, "keydown", PreventDefault).
    sync(({ scope }) => { scope.cars = [{ images: ["red1.png", "red2.png"], frame: 0, x: 20, lane: 1, v: 0 }]; });

// Draw loop: on every update, draw the game objects.
const drawLoop = fiber => fiber.
    ramp(Infinity, (_, { scope: { canvas, cars, images } }) => {
        canvas.width = Width;
        canvas.height = Height;
        const context = canvas.getContext("2d");
        for (const car of cars) {
            context.drawImage(images[car.images[car.frame]], car.x, Lanes[car.lane]);
        }
    });

// Animation loop: toggle car images at 10 FPS (i.e., every 100ms) and update
// the progress bar for the duration of the game.
const animationLoop = fiber => fiber.
    repeat(fiber => fiber.
        ramp(100).
        sync(({ scope: { cars } }) => {
            for (const car of cars) {
                car.frame = 1 - car.frame;
            }
        })
    );

// The player loop (updating the lane of the player car based on keyboard
// input) runs for the duration of the game and ends with the checkered flag,
// since the player survived to the end. Crashing will cancel this loop. Update
// the progress bar as well to show the time remaining.
const playerLoop = fiber => fiber.
    spawn(fiber => fiber.
        repeat(fiber => fiber.
            event(window, "keydown", {
                eventWasHandled(event, { scope: { cars: [car] } }) {
                    if (event.key === "ArrowUp") {
                        car.lane = Math.max(0, car.lane - 1);
                        event.preventDefault();
                    } else if (event.key === "ArrowDown") {
                        car.lane = Math.min(Lanes.length - 1, car.lane + 1);
                        event.preventDefault();
                    }
                }
            })
        )
    ).
    spawn(fiber => fiber.
        ramp(GameDuration, (p, { scope: { progress } }) => { progress.value = p * GameDuration; }).
        sync(({ scope: { cars } }) => {
            cars.length = 1;
            cars[0].images = ["flag1.png", "flag2.png"];
            cars[0].x = 200;
            cars[0].lane = 1;
        })
    ).
    join(First);

// Random integer in the [min, max] range
const random = (min, max) => min + Math.floor(Math.random() * (1 + max - min));

// Spawn a new fiber for a random number of other cars. Each car begins with a
// random delay and lane, and moves backward; if it collides with the player,
// then fiber ends with a crash.
const otherCars = fiber => {
    for (let n = random(...N), i = 0; i < n; ++i) {
        const car = {
            images: ["gray1.png", "gray2.png"],
            lane: random(0, Lanes.length - 1),
            frame: 0,
            x: Width,
            v: -50
        };
        fiber.spawn(fiber => fiber.
            ramp(random(0.1 * GameDuration, 0.9 * GameDuration)).
            sync(({ parent: { scope: { cars } } }) => { cars.push(car); }).
            repeat(fiber => fiber.
                ramp(50).
                sync(() => { car.x += car.v; }),
                {
                    repeatShouldEnd: (_, { parent: { scope: { cars: [player] } } }) => car.lane === player.lane &&
                        car.x > Danger[0] && car.x < Danger[1]
                }
            )
        )
    }
    fiber.join(First).sync(({ scope: { cars } }) => {
        cars.length = 1;
        cars[0].images = ["crash1.png", "crash2.png"];
        cars[0].x = 200;
    });
}

// Run the game once.
// FIXME 4H0H Restart cars game
run().
    sync(({ scope }) => { Object.assign(scope, setup()); }).
    macro(loadImages).
    macro(splash).
    spawn(drawLoop).
    spawn(animationLoop).
    spawn(fiber => fiber.
        spawn(fiber => fiber.macro(playerLoop)).
        spawn(otherCars).
        join(First)
    );
