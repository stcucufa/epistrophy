import { run, First } from "../../lib/shell.js";
import Game from "./game.js";

const UpdateDuration = 1000 / Game.UpdateFPS;

run().
    sync(() => new Game(document.querySelector("canvas"))).

    // Draw loop
    spawn(fiber => fiber.ramp(Infinity, (_, { value: game }) => { game.draw(); })).

    // Enemies (asteroids, TODO: UFO)
    spawn(fiber => fiber.
        sync(({ value: game }) => Array(4).fill().map(() => game.asteroid())).
        each(fiber => fiber.
            repeat(fiber => fiber.
                ramp(UpdateDuration).
                sync(({ value: asteroid }) => { asteroid.update(); })
            )
        )
    ).

    // Player loop
    spawn(fiber => fiber.

        // Create a ship and use it as value for the fiber; also save to scope.
        sync(({ scope, value: game }) => {
            scope.ship = game.ship();
            return scope.ship;
        }).

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

        // Ship update loop—when the ship updates, it returns a list of
        // particles (exhaust or debris) that will be updated on their own.
        spawn(fiber => fiber.
            repeat(fiber => fiber.
                ramp(UpdateDuration).
                sync(({ scope: { ship } }) => ship.update()).
                each(fiber => fiber.
                    spawn(fiber => fiber.
                        repeat(fiber => fiber.
                            ramp(UpdateDuration).
                            sync(({ value: particle }) => { particle.update(); })
                        )
                    ).
                    spawn(fiber => fiber.ramp(({ value: { durationMs } }) => durationMs)).
                    join(First).
                    sync(({ value: particle }) => { particle.game.removeObject(particle); })
                )
            )
        )
    );
