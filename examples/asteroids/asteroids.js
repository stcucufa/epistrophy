import { run, Fiber, First, FirstValue } from "../../lib/shell.js";
import Game, { Text } from "./game.js";

const UpdateRate = Game.UpdateFPS / 1000;

run().

    // Create a game object and add it to the scope of the main fiber; this is
    // also the initial value of the fiber.
    call(({ scope }) => {
        scope.game = new Game(document.querySelector("canvas"));
        return scope.game;
    }).

    // Keyboard handling (see actual handlers below). Because we use regular
    // event listeners, this only needs to be setup once.
    call(({ value: game }) => {
        window.addEventListener("keydown", event => keydown(event, game));
        window.addEventListener("keyup", event => keyup(event, game));
    }).

    // Pause and resume the game fiber when pressing P.
    loop(φ => φ.
        event(window, "keydown", { eventShouldBeIgnored: ({ key }) => key !== "p" }).
        call(({ scheduler, scope: { gameFiber } }) => { scheduler.setRateForFiber(gameFiber, 1 - gameFiber.rate); })
    ).

    spawn(φ => φ.

        // Register self in the parent scope as the game fiber to be paused by
        // its sibling.
        call(fiber => { fiber.parent.scope.gameFiber = fiber; }).

        // Draw loop: draw the game.
        spawn(φ => φ.ramp(Infinity, ({ value: game }) => { game.draw(); })).

        // Update loop: update all game objects and gather the list of new
        // objects resulting from the updates, setting a timeout to remove all
        // those that have a duration (particles).
        loop(φ => φ.
            ramp(Infinity, fiber => {
                const particleFiber = new Fiber().
                    ramp(({ value: { durationMs } }) => durationMs).
                    call(({ value: object }) => { object.game.removeObject(object); });
                const { value: game, ramp: { dt }, scheduler } = fiber;
                const [enter] = game.update(dt * UpdateRate);
                for (const object of enter) {
                    if (object.durationMs >= 0) {
                        scheduler.attachFiberWithValue(fiber, particleFiber, object);
                    }
                }
            })
        ).

        // Game loop.
        loop(φ => φ.

            // Title screen.
            call(({ value: game }) => { game.reset(); }).
            append(text("ASTEROIDS")).

            // Enemies
            // FIXME 500E Asteroids: UFO
            loop(φ => φ.
                call(fiber => {
                    const asteroidFiber = new Fiber().
                        event(({ value: asteroid }) => asteroid, "collided", {
                            eventWasHandled({ detail: { results } }) {
                                for (const asteroid of results) {
                                    fiber.scheduler.attachFiberWithValue(fiber, asteroidFiber, asteroid);
                                }
                            }
                        });
                    const game = fiber.value;
                    for (let i = game.level; i > 0; --i) {
                        fiber.scheduler.attachFiberWithValue(fiber, asteroidFiber, game.asteroid());
                    }
                }).
                join().

                // Next level
                call(({ value: game }) => { game.level += 1; }).
                call(({ value: game, scope }) => {
                    game.inputs.clear();
                    scope.text = game.addObject(new Text(`LEVEL ${game.level}`));
                }).
                spawn(φ => φ.event(({ value: game }) => game, "anykey")).
                spawn(φ => φ.ramp(1000)).
                join().
                call(({ value: game, scope }) => {
                    game.removeObject(scope.text);
                    delete scope.text;
                })
            ).

            // Player loop: spawn a new ship and wait for it to be destroyed, then for
            // the debris to clear up before spawning a new one, as long as the player
            // has lives left.
            spawn(φ => φ.
                loop(φ => φ.

                    // Create a ship and use it as value for the fiber; also save to scope.
                    call(({ scope, value: game }) => {
                        scope.ship = game.ship();
                        return scope.ship;
                    }).

                    // Listen to the ship being removed to end the loop with the spawn
                    // delay duration (the longest that a debris particle can last).
                    event(({ value: ship }) => ship, "collided").
                    ramp(({ value: ship }) => ship.debrisDur[1]).

                    // Remove a life and reset the value to the game
                    call(({ scope: { game } }) => {
                        game.removeObject(game.lives.pop());
                        return game;
                    }),

                    // End when no mores ships remain.
                    { loopShouldEnd: ({ value: { lives } }) => lives.length === 0 }
                ).

                // Game over
                append(text("GAME OVER"))
            ).

            join(First)
        )
    );

// Keydown and keyup event handlers; translate raw inputs to input states of
// the game. Allow both arrows to be pressed at the same time by using the
// direction of the last pressed arrow). Skip modifiers as well as the P key
// which is reserved for pause.

function keydown(event, { inputs }) {
    if (event.altKey || event.ctrlKey || event.isComposing || event.metaKey || event.shiftKey || event.key === "p") {
        return;
    }
    inputs.add(event.key);
    switch (event.key) {
        case "ArrowLeft":
            if (!event.repeat) {
                if (inputs.has("Right")) {
                    inputs.delete("Right");
                    inputs.add("RL");
                }
                inputs.add("Left");
            }
            break;
        case "ArrowRight":
            if (!event.repeat) {
                if (inputs.has("Left")) {
                    inputs.delete("Left");
                    inputs.add("LR");
                }
                inputs.add("Right");
            }
            break;
        case "ArrowUp":
            if (!event.repeat) {
                inputs.add("Thrust");
            }
            break;
        case "z":
            if (!event.repeat) {
                inputs.add("Shoot");
            }
            break;
        case "ArrowDown":
        case " ":
            // Do nothing but avoid scrolling the page
            break;
        default:
            return;
    }
    event.preventDefault();
}

function keyup(event, game) {
    const { inputs } = game;
    const anykey = inputs.has(event.key);
    switch (event.key) {
        case "ArrowLeft":
            inputs.delete("Left");
            if (inputs.has("RL") || inputs.has("LR")) {
                inputs.delete("RL");
                inputs.delete("LR");
                inputs.add("Right");
            }
            break;
        case "ArrowRight":
            inputs.delete("Right");
            if (inputs.has("RL") || inputs.has("LR")) {
                inputs.delete("RL");
                inputs.delete("LR");
                inputs.add("Left");
            }
            break;
        case "ArrowUp":
            inputs.delete("Thrust");
            break;
    }
    inputs.delete(event.key);
    if (anykey && !inputs.has(event.key)) {
        game.customEvent("anykey");
    }
}

// Show text and wait for any key before removing it.
function text(t) {
    return φ => φ.
        call(({ value: game, scope }) => {
            game.inputs.clear();
            scope.text = game.addObject(new Text(t));
        }).
        event(({ value: game }) => game, "anykey").
        call(({ value: game, scope }) => {
            game.removeObject(scope.text);
            delete scope.text;
        });
}
