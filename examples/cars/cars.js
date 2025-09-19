import { loadImage, random } from "../../lib/util.js";
import { run, First, FirstValue, PreventDefault } from "../../lib/shell.js";

// Game duration in milliseconds.
const GameDuration = 5000;

// Screen size.
const Width = 800;
const Height = 600;

// Lanes positions.
const Lanes =  [50, 200, 350];

// Danger zone for collisions (in the same lane).
const Danger = [-100, 250];

// Range for the number of other cars.
const Cars = [7, 12];

// Image URLs to be loaded.
const Srcs = ["red1.png", "red2.png", "gray1.png", "gray2.png", "crash1.png", "crash2.png", "flag1.png", "flag2.png"];

// Draw the game (the image of every car) in a canvas element.
function draw({ canvas, cars, images }) {
    canvas.width = Width;
    canvas.height = Height;
    const context = canvas.getContext("2d");
    for (const car of cars) {
        context.drawImage(images[car.images[car.frame]], car.x, Lanes[car.lane]);
    }
}

// Show the splash screen on the canvas
function splash(canvas) {
    canvas.width = Width;
    canvas.height = Height;
    const context = canvas.getContext("2d");
    context.save();
    context.fillStyle = "#1d2b53";
    context.font = "italic 96px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("RACE!!", Width / 2, Height / 2);
    context.restore();
}

// Run the game.
run().

    // Load the images and setup the game elements.
    K(Srcs).
    map(fiber => fiber.async(
        async ({ value }) => loadImage(value), {
            asyncWillEndWithValue: (img, { value: key }) => ([key, img])
        })).
    sync(({ value: images, scope }) => {
        Object.assign(scope, {
            canvas: document.querySelector("canvas"),
            progress: document.querySelector("progress"),
            images: Object.fromEntries(images)
        });
    }).

    // Main game loop: show the splash screen, then start the game on a key
    // press, and wait for another key press before starting a new iteration.
    repeat(fiber => fiber.

        // Reset the progress bar and show the splash screen until a key is
        // pressed.
        sync(({ scope: { progress, canvas } }) => {
            progress.value = 0;
            progress.max = GameDuration;
            splash(canvas);
        }).
        event(window, "keydown", PreventDefault).

        // Draw loop: draw the game on every animation frame, forever.
        spawn(fiber => fiber.ramp(
            Infinity,
            (_, { scope }) => { draw(scope); })
        ).

        // Animation loop: toggle car images at 10 FPS (i.e., every 100ms) and
        // update the progress bar for the duration of the game.
        spawn(fiber => fiber.
            repeat(fiber => fiber.
                ramp(100).
                sync(({ scope: { cars } }) => {
                    for (const car of cars) {
                        car.frame = 1 - car.frame;
                    }
                })
            )
        ).

        // Initialize the game loop with the player car as the first car.
        sync(({ scope }) => {
            scope.cars = [{ images: ["red1.png", "red2.png"], frame: 0, x: 20, lane: 1, v: 0 }];
        }).

        // Game loop: run the timer, handle player input, and run the other cars.
        spawn(fiber => fiber.

            // The player loop updates the lane of the player car based on
            // keyboard input.
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

            // Spawn a new fiber for a random number of other cars. Each car
            // begins with a random delay and lane, and moves backward; if it
            // collides with the player, then fiber ends with a crash.
            spawn(fiber => fiber.
                sync(() => Array(random(...Cars)).fill().map(() => ({
                    images: ["gray1.png", "gray2.png"],
                    lane: random(0, Lanes.length - 1),
                    frame: 0,
                    x: Width,
                    v: -50
                }))).
                mapfirst(fiber => fiber.
                    ramp(() => random(0.1 * GameDuration, 0.9 * GameDuration)).
                    sync(({ value: car, scope: { cars } }) => { cars.push(car); }).
                    repeat(fiber => fiber.
                        ramp(50).
                        sync(({ value: car }) => { car.x += car.v; }),
                        {
                            repeatShouldEnd: (_, { value: car, scope: { cars: [player] } }) =>
                                car.lane === player.lane && car.x > Danger[0] && car.x < Danger[1]
                        }
                    )
                ).
                sync(({ scope: { cars } }) => {
                    cars.length = 1;
                    cars[0].images = ["crash1.png", "crash2.png"];
                    cars[0].x = 200;
                })
            ).

            // Run the timer (updating the progress bar) and show the flag when the
            // timer runs out.
            spawn(fiber => fiber.
                ramp(
                    GameDuration,
                    (p, { scope: { progress } }) => { progress.value = p * GameDuration; }
                ).
                sync(({ scope: { cars } }) => {
                    cars.length = 1;
                    cars[0].images = ["flag1.png", "flag2.png"];
                    cars[0].x = 200;
                    cars[0].lane = 1;
                })
            ).

            // Wait for the first fiber to end (either the timer running out
            // or a crash) and wait half a second before ending the game loop
            // to start a new game (the small delay is to prevent from
            // immediately restarting).
            join(First).
            ramp(500).
            event(window, "keydown", PreventDefault)
        ).
        join(First)
    );
