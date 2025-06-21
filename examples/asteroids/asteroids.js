import Scheduler from "../../lib/scheduler.js";
import { First } from "../../lib/fiber.js";
import { K } from "../../lib/util.js";
import Game from "./game.js";

const UpdateDuration = 1000 / Game.UpdateFPS;

// Handle a key down/up event for a given fiber, looking for a specific key.
function handleKey(fiber, key, on, off) {
    const eventShouldBeIgnored = event => event.key !== key;
    fiber.repeat(fiber => {
        fiber.event(window, "keydown", {
            eventShouldBeIgnored,
            eventWasHandled(event) { event.preventDefault(); }
        });
        if (on) {
            fiber.effect(on);
        }
        fiber.event(window, "keyup", { eventShouldBeIgnored });
        if (off) {
            fiber.effect(off);
        }
    });
}

Scheduler.run().
    exec(() => new Game(document.querySelector("canvas"))).

    // Draw loop
    spawn(fiber => fiber.named("draw-loop").
        ramp(Infinity, {
            rampDidProgress(_, { value: game }) {
                game.draw();
            }
        })
    ).

    // Enemies (asteroids, TODO: UFO)
    spawn(fiber => fiber.named("enemies").
        exec(({ value: game }) => Array(4).fill().map(() => game.asteroid())).
        map(fiber => fiber.
            effect(({ value: asteroid }) => { console.info(asteroid); }).
            repeat(fiber => fiber.
                delay(UpdateDuration).
                effect(({ value: asteroid }) => { asteroid.update(); })
            )
        )
    ).

    // Player loop
    spawn(fiber => fiber.named("ship").
        exec(({ value: game }) => game.ship()).
        store("ship").
        repeat(fiber => fiber.

            // Keys: left and right to turn, up to accelerate.
            spawn(fiber => fiber.named("key-left").
                macro(handleKey, "ArrowLeft",
                    ({ value: ship }) => { ship.angularVelocity = -ship.maxAngularVelocity; },
                    ({ value: ship }) => { ship.angularVelocity = Math.max(0, ship.angularVelocity); }
                )
            ).
            spawn(fiber => fiber.named("key-right").
                macro(handleKey, "ArrowRight",
                    ({ value: ship }) => { ship.angularVelocity = ship.maxAngularVelocity; },
                    ({ value: ship }) => { ship.angularVelocity = Math.min(0, ship.angularVelocity); }
                )
            ).
            spawn(fiber => fiber.named("key-up").
                macro(handleKey, "ArrowUp",
                    ({ value: ship }) => { ship.acceleration = ship.maxAcceleration; },
                    ({ value: ship }) => { ship.acceleration = ship.game.Friction; }
                )
            ).

            // Ship updates
            spawn(fiber => fiber.
                repeat(fiber => fiber.
                    delay(UpdateDuration).
                    exec(({ scope: { ship } }) => ship.update()).
                    map(fiber => fiber.
                        spawn(fiber => fiber.
                            repeat(fiber => fiber.
                                delay(UpdateDuration).
                                effect(({ value: particle }) => particle.update())
                            )
                        ).
                        spawn(fiber => fiber.delay(({ value: { durationMs } }) => durationMs)).
                        join(First).
                        effect(({ value: particle }) => { particle.game.removeObject(particle); })
                    )
                )
            ).

            // FIXME end when the ship is destroyed
            join(First)
        )
    );
