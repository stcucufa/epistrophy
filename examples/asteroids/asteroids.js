import { run, FirstValue } from "../../lib/shell.js";
import Game from "./game.js";

const UpdateDuration = 1000 / Game.UpdateFPS;

run().

    // Create a game object and add it to the scope of the main fiber; this is
    // also the initial value of the fiber.
    call(({ scope }) => {
        scope.game = new Game(document.querySelector("canvas"));
        return scope.game;
    }).

    // Draw loop
    spawn(fiber => fiber.ramp(Infinity, ({ value: game }) => { game.draw(); })).

    // Update loop
    spawn(fiber => fiber.
        repeat(fiber => fiber.
            ramp(UpdateDuration).
            call(({ value: game }) => {
                const [enter] = game.update();
                return [...enter].filter(object => object.durationMs >= 0);
            }).
            each(fiber => fiber.
                ramp(({ value: { durationMs } }) => durationMs).
                call(({ value: object }) => { object.game.removeObject(object); })
            )
        )
    ).

    // Keyboard handler
    spawn(fiber => fiber.
        repeat(fiber => fiber.
            event(window, "keydown", {
                eventShouldBeIgnored: event => event.altKey || event.ctrlKey || event.isComposing ||
                    event.metaKey || event.shiftKey,
                eventWasHandled(event, { value: { inputs } }) {
                    switch (event.key) {
                        case "ArrowLeft":
                            if (!event.repeat) {
                                if (inputs.R) {
                                    delete inputs.R;
                                    inputs.RL = true;
                                } else if (!inputs.RL) {
                                    inputs.L = true;
                                }
                            }
                            break;
                        case "ArrowRight":
                            if (!event.repeat) {
                                if (inputs.L) {
                                    delete inputs.L;
                                    inputs.LR  = true;
                                } else if (!inputs.LR) {
                                    inputs.R = true;
                                }
                            }
                            break;
                        case "ArrowUp":
                            if (!event.repeat) {
                                inputs.T = true;
                            }
                        case "ArrowDown":
                        case " ":
                            // Do nothing but avoid scrolling the page
                            break;
                        default:
                            return;
                    }
                    event.preventDefault();
                }
            })
        )
    ).
    spawn(fiber => fiber.
        repeat(fiber => fiber.
            event(window, "keyup", {
                eventWasHandled(event, { value: { inputs } }) {
                    switch (event.key) {
                        case "ArrowLeft":
                            if (inputs.RL || inputs.LR) {
                                delete inputs.RL;
                                delete inputs.LR;
                                inputs.R = true;
                            } else {
                                delete inputs.L;
                            }
                            break;
                        case "ArrowRight":
                            if (inputs.RL || inputs.LR) {
                                delete inputs.RL;
                                delete inputs.LR;
                                inputs.L = true;
                            } else {
                                delete inputs.R;
                            }
                            break;
                        case "ArrowUp":
                            delete inputs.T;
                    }
                }
            })
        )
    ).

    // Enemies (asteroids, TODO: UFO)
    spawn(fiber => fiber.
        call(({ value: game }) => Array(4).fill().map(() => game.asteroid()))
    ).

    // Player loop

    spawn(fiber => fiber.
        repeat(fiber => fiber.

            // Create a ship and use it as value for the fiber; also save to scope.
            call(({ scope, value: game }) => {
                scope.ship = game.ship();
                return scope.ship;
            }).

            // Listen to the ship being removed to end the loop with the spawn
            // delay duration (the longest that a debris particle can last).
            event(({ value: ship }) => ship.game, "collided", {
                eventShouldBeIgnored: (event, { value: ship }) => event.detail.object !== ship
            }).
            call(({ value: ship }) => ship.debrisDur[1]).

            // Wait until spawning again.
            ramp(({ value }) => value)
        )
    );
