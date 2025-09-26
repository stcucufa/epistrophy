import { run, First } from "../../lib/shell.js";
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

            // Listen to the ship being removed to end the loop.
            spawn(fiber => fiber.
                event(({ value: ship }) => ship.game, "removed", {
                    eventShouldBeIgnored: (event, { value: ship }) => event.detail.object !== ship
                })
            ).

            // Keys
            spawn(fiber => fiber.
                repeat(fiber => fiber.
                    event(window, "keydown", {
                        eventWasHandled(event, { value: ship }) {
                            switch (event.key) {
                                case "ArrowLeft":
                                    ship.angularVelocity = -ship.maxAngularVelocity;
                                    break;
                                case "ArrowRight":
                                    ship.angularVelocity = ship.maxAngularVelocity;
                                    break;
                                case "ArrowUp":
                                    ship.acceleration = ship.maxAcceleration;
                                    break;
                                case "ArrowDown":
                                case " ":
                                    // Do nothing but avoid scrolling the page.
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
                        eventWasHandled(event, { value: ship }) {
                            switch (event.key) {
                                case "ArrowLeft":
                                    ship.angularVelocity = Math.max(0, ship.angularVelocity);
                                    break;
                                case "ArrowRight":
                                    ship.angularVelocity = Math.min(0, ship.angularVelocity);
                                    break;
                                case "ArrowUp":
                                    ship.acceleration = ship.friction;
                                    break;
                                default:
                                    return;
                            }
                            event.preventDefault();
                        }
                    })
                )
            ).
            join(First)
        )
    );
