import { run, First } from "../../lib/shell.js";

const Width = 800;
const Height = 600;
const Danger = [-100, 250];
const GameDuration = 5000;
const N = [7, 12];
const Srcs = ["red1.png", "red2.png", "gray1.png", "gray2.png", "crash1.png", "crash2.png", "flag1.png", "flag2.png"];

run().

    // Set up
    sync(({ scope }) => {
        Object.assign(scope, {
            canvas: document.querySelector("canvas"),
            progress: document.querySelector("progress"),
            lanes: [50, 200, 350],
            cars: [{ images: ["red1.png", "red2.png"], frame: 0, x: 20, lane: 1, v: 0 }],
            images: {}
        });
        scope.progress.value = 0;
        scope.progress.max = GameDuration;
        scope.canvas.width = Width;
        scope.canvas.height = Height;
    }).

    // Load all images and collect them in an object using their relative src
    // as key.
    macro(fiber => {
        for (const src of Srcs) {
            fiber.spawn(fiber => fiber.async(async () => new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => { resolve(image); };
                image.onerror = () => reject(`Could not load image ${src}`);
                image.src = src;
                if (image.complete) {
                    resolve(image);
                }
            }), {
                asyncWillEndWithValue(image, { scope }) {
                    scope.value = [src, image];
                }
            }
            ));
        }
        fiber.join({
            childFiberDidJoin(child) {
                const [src, image] = child.scope.value;
                child.parent.scope.images[src] = image;
            }
        });
    }).
    join().

    // Show the splash screen and way for a key press to begin.
    sync(({ scope }) => {
        const context = scope.canvas.getContext("2d");
        context.save();
        context.fillStyle = "#1d2b53";
        context.font = "italic 96px system-ui, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText("RACE!", Width / 2, Height / 2);
        context.restore();
    }).
    event(window, "keydown", {
        eventWasHandled(event) {
            event.preventDefault();
        }
    }).

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

        // Controls run for the duration of the game and ends with the
        // checkered flag since the player survived to the end.
        spawn(fiber => fiber.
            spawn(fiber => fiber.
                repeat(fiber => fiber.
                    event(window, "keydown", {
                        eventWasHandled(event, { scope }) {
                            if (event.key === "ArrowUp") {
                                scope.cars[0].lane = Math.max(0, scope.cars[0].lane - 1);
                                event.preventDefault();
                            } else if (event.key === "ArrowDown") {
                                scope.cars[0].lane = Math.min(scope.lanes.length - 1, scope.cars[0].lane + 1);
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
            join(First)
        ).

        join()
    ).

    // Draw loop
    spawn(fiber => fiber.
        ramp(Infinity, (_, { scope }) => {
            scope.canvas.width = Width;
            scope.canvas.height = Height;
            const context = scope.canvas.getContext("2d");
            for (const car of scope.cars) {
                context.drawImage(scope.images[car.images[car.frame]], car.x, scope.lanes[car.lane]);
            }
        })
    ).

    // Animation loop: switch frame every at 10 FPS (every 100ms) and update
    // the progress bar for the duration of the game.
    spawn(fiber => fiber.
        repeat(fiber => fiber.
            sync(({ scope: { cars } }) => {
                for (const car of cars) {
                    car.frame = 1 - car.frame;
                }
            }).
            ramp(100)
        )
    ).
    spawn(fiber => fiber.
        ramp(GameDuration, (p, { scope: { progress } }) => { progress.value = p * GameDuration; })
    );
