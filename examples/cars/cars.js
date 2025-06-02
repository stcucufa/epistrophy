import Scheduler from "../../lib/scheduler.js";
import Fiber, { First } from "../../lib/fiber.js";
import { K } from "../../lib/util.js";

const WIDTH = 800;
const HEIGHT = 600;
const DANGER = [-100, 250];
const DUR = 5000;
const N = [7, 12];

const loadImage = async (src) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => { resolve([src, image]); };
    image.onerror = () => reject(`Could not load image ${src}`);
    image.src = src;
    if (image.complete) {
        resolve([src, image]);
    }
});

// Create the main fiber with the game object.
const fiber = Scheduler.run().
    exec(() => ({
        canvas: document.querySelector("canvas"),
        progress: document.querySelector("progress"),
        lanes: [50, 200, 350],
        cars: [{ images: ["red1.png", "red2.png"], frame: 0, x: 20, lane: 1, v: 0 }],
    }));

// Load all resources before continuing
const images = ["red1.png", "red2.png", "gray1.png", "gray2.png", "crash1.png", "crash2.png", "flag1.png", "flag2.png"];
for (const image of images) {
    fiber.spawn(fiber => fiber.exec(async () => loadImage(image)));
}

fiber.
    join({
        fiberWillJoin(fiber) {
            this.values = {};
        },
        childFiberDidEnd(child, scheduler) {
            // FIXME cancelSiblings to make writing delegates easier
            // FIXME 4F04 Handle errors when joining
            const fiber = child.parent;
            if (child.error) {
                const siblings = [...this.pending];
                this.pending.clear();
                for (const sibling of siblings) {
                    sibling.cancel(scheduler);
                }
                fiber.result.error = Error("Child fiber did fail", { cause: child.error });
            } else {
                const [src, image] = child.value;
                this.values[src] = image;
                if (this.pending.size === 0) {
                    fiber.value.images = this.values;
                }
            }
        }
    }).

    // Press a key to begin

    spawn(fiber => fiber.
        effect(({ value: game }) => {
            game.progress.value = 0;
            game.progress.max = DUR;
            game.canvas.width = WIDTH;
            game.canvas.height = HEIGHT;
            const context = game.canvas.getContext("2d");
            context.save();
            context.fillStyle = "#1d2b53";
            context.font = "96px system-ui, sans-serif";
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillText("RACE!", WIDTH / 2, HEIGHT / 2);
            context.restore();
        }).
        event(window, "keydown")
    ).
    join().

    // Game loop
    
    spawn(fiber => fiber.

        // Setup other cars: introduce a car after its delay, and setup its
        // update loop to update position and check for collision with the
        // player car every 50ms. End when a collision occurs.
        spawn(fiber => {
            const n = Math.floor(Math.random() * (N[1] - N[0])) + N[0]
            for (let i = 0; i < n; ++i) {
                fiber.spawn(fiber => fiber.
                    delay(Math.random() * DUR).
                    exec(({ value: game }) => {
                        const car = {
                            images: ["gray1.png", "gray2.png"],
                            lane: Math.floor(Math.random() * game.lanes.length),
                            frame: 0,
                            x: WIDTH,
                            v: -50
                        };
                        game.cars.push(car);
                        return car;
                    }).
                    repeat(fiber => fiber.
                        delay(50).
                        effect(({ parent, value: car }) => {
                            car.x += car.v;
                        }), {
                            repeatShouldEnd: (_, { parent, value: car }) => car.x > DANGER[0] &&
                                car.x < DANGER[1] && car.lane === parent.value.cars[0].lane
                        }
                    )
                );
            }
            fiber.
                join(First(false)).
                effect(({ value: game }) => {
                    // If a car fiber ended, then there was a crash.
                    game.cars.length = 1;
                    game.cars[0].images = ["crash1.png", "crash2.png"];
                    game.cars[0].x = 200;
                })
        }).

        // Controls run for the duration of the game and ends with the
        // checkered flag since the player survived to the end.
        spawn(fiber => fiber.
            spawn(fiber => fiber.
                repeat(fiber => fiber.
                    event(window, "keydown", {
                        eventWasHandled(event, { value: game }) {
                            if (event.key === "ArrowUp") {
                                game.cars[0].lane = Math.max(0, game.cars[0].lane - 1);
                                event.preventDefault();
                            } else if (event.key === "ArrowDown") {
                                game.cars[0].lane = Math.min(game.lanes.length - 1, game.cars[0].lane + 1);
                                event.preventDefault();
                            }
                        }
                    })
                )
            ).
            spawn(fiber => fiber.
                delay(DUR).
                effect(({ value: game }) => {
                    game.cars.length = 1;
                    game.cars[0].images = ["flag1.png", "flag2.png"];
                    game.cars[0].x = 200;
                    game.cars[0].lane = 1;
                })
            ).
            join(First())
        ).

        join(First(false))
    ).

    // Draw loop
    spawn(fiber => fiber.
        ramp(Infinity, {
            rampDidProgress(_, { value: game }) {
                game.canvas.width = WIDTH;
                game.canvas.height = HEIGHT;
                const context = game.canvas.getContext("2d");
                for (const car of game.cars) {
                    context.drawImage(game.images[car.images[car.frame]], car.x, game.lanes[car.lane]);
                }
            }
        })
    ).

    // Animation loop: switch frame every at 10 FPS (every 100ms) and update
    // the progress bar for the duration of the game.
    spawn(fiber => fiber.
        spawn(fiber => fiber.
            repeat(fiber => fiber.
                effect(({ value: game }) => {
                    for (const car of game.cars) {
                        car.frame = 1 - car.frame;
                    }
                }).
                delay(100)
            )
        ).
        spawn(fiber => fiber.
            ramp(DUR, {
                rampDidProgress(p, { value: game }) {
                    game.progress.value = p * DUR;
                }
            })
        ).
        join()
    );
