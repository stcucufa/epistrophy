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
const Danger = [-100, 250];
const GameDuration = 5000;
const N = [7, 12];
const Srcs = ["red1.png", "red2.png", "gray1.png", "gray2.png", "crash1.png", "crash2.png", "flag1.png", "flag2.png"];

// Setup the game object.
function setup() {
    return {
        canvas: document.querySelector("canvas"),
        progress: document.querySelector("progress"),
        lanes: [50, 200, 350],
        cars: [{ images: ["red1.png", "red2.png"], frame: 0, x: 20, lane: 1, v: 0 }],
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
    event(window, "keydown", PreventDefault);

// Draw loop: on every update, draw the game objects.
const drawLoop = fiber => fiber.
    ramp(Infinity, (_, { scope: { canvas, cars, images, lanes } }) => {
        canvas.width = Width;
        canvas.height = Height;
        const context = canvas.getContext("2d");
        for (const car of cars) {
            context.drawImage(images[car.images[car.frame]], car.x, lanes[car.lane]);
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

// Update the progress bar for the duration of the game.
const progress = fiber => fiber.
    ramp(GameDuration, (p, { scope: { progress } }) => { progress.value = p * GameDuration; });

// Controls run for the duration of the game and ends with the
// checkered flag since the player survived to the end.
const playerLoop = fiber => fiber.
    spawn(fiber => fiber.
        repeat(fiber => fiber.
            event(window, "keydown", {
                eventWasHandled(event, { scope: { cars: [car], lanes } }) {
                    if (event.key === "ArrowUp") {
                        car.lane = Math.max(0, car.lane - 1);
                        event.preventDefault();
                    } else if (event.key === "ArrowDown") {
                        car.lane = Math.min(lanes.length - 1, car.lane + 1);
                        event.preventDefault();
                    }
                }
            })
        )
    ).
    spawn(fiber => fiber.
        ramp(GameDuration).
        sync(({ scope }) => {
            scope.cars.length = 1;
            scope.cars[0].images = ["flag1.png", "flag2.png"];
            scope.cars[0].x = 200;
            scope.cars[0].lane = 1;
        })
    ).
    join(First);

// Run the game.
run().
    sync(({ scope }) => { Object.assign(scope, setup()); }).
    macro(loadImages).
    macro(splash).

    spawn(drawLoop).
    spawn(animationLoop).
    spawn(fiber => fiber.
        spawn(progress).
        spawn(fiber => fiber.macro(playerLoop))
    );

    /*
    spawn(fiber => fiber.

        // Setup other cars: introduce a car after its delay, and setup its
        // update loop to update position and check for collision with the
        // player car every 50ms. End when a collision occurs.
        spawn(fiber => {
            const n = Math.floor(Math.random() * (N[1] - N[0])) + N[0]
            for (let i = 0; i < n; ++i) {
                fiber.spawn(fiber => fiber.
                    ramp(Math.random() * GameDuration).
                    sync(({ scope }) => {
                        scope.car = {
                            images: ["gray1.png", "gray2.png"],
                            lane: Math.floor(Math.random() * scope.lanes.length),
                            frame: 0,
                            x: Width,
                            v: -50
                        };
                    }).
                    repeat(fiber => fiber.
                        ramp(50).
                        sync(({ scope: { car } }) => { car.x += car.v; }),
                        {
                            repeatShouldEnd: (_, { scope: { car, cars } }) => car.x > Danger[0] && car.x < Danger[1] &&
                                car.lane === cars[0].lane
                        }
                    )
                );
            }
            fiber.
                join({
                    childFiberDidJoin(child) {
                        child.parent.scope.cars.push(child.scope.car);
                    }
                }).
                sync(({ scope }) => {
                    // If a car fiber ended, then there was a crash.
                    scope.cars.length = 1;
                    scope.cars[0].images = ["crash1.png", "crash2.png"];
                    scope.cars[0].x = 200;
                })
        }).


        join()
    ).

    */
