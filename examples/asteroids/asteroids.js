import { run, First, FirstValue } from "../../lib/shell.js";
import Game, { Text } from "./game.js";

const UpdateDuration = 1000 / Game.UpdateFPS;

run().

    // Create a game object and add it to the scope of the main fiber; this is
    // also the initial value of the fiber.
    call(({ scope }) => {
        scope.game = new Game(document.querySelector("canvas"));
        return scope.game;
    }).

    // Draw loop: draw the game.
    spawn(fiber => fiber.ramp(Infinity, ({ value: game }) => { game.draw(); })).

    // Keyboard handling (see actual handlers below). Because we use regular
    // event listeners, this only needs to be setup once.
    call(({ value: game }) => {
        window.addEventListener("keydown", event => keydown(event, game));
        window.addEventListener("keyup", event => keyup(event, game));
    }).

    // Update loop: update all game objects and gather the list of new objects
    // resulting from the updates, setting a timeout to remove all those that
    // have a duration (particles).
    spawn(fiber => fiber.
        repeat(fiber => fiber.
            ramp(UpdateDuration).
            call(({ value: game }) => {
                const [enter] = game.update();
                return [...enter].filter(object => object.durationMs >= 0);
            }).
            mapspawn(fiber => fiber.
                ramp(({ value: { durationMs } }) => durationMs).
                call(({ value: object }) => { object.game.removeObject(object); })
            )
        )
    ).

    // Game loop.
    repeat(fiber => fiber.

        call(fiber => { console.log(`>>> Game loop: ${fiber.id}`); }).

        // Title screen.
        call(({ value: game }) => { game.reset(); }).
        append(text("ASTEROIDS")).

        // Enemies (asteroids, TODO: UFO)
        spawn(fiber => fiber.
            call(({ value: game }) => Array(4).fill().map(() => game.asteroid())).
            // TODO inner loop
            ramp(Infinity)
        ).

        // Player loop: spawn a new ship and wait for it to be destroyed, then for
        // the debris to clear up before spawning a new one, as long as the player
        // has lives left.
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
                ramp(({ value }) => value),

                // End when no mores ships remain.
                { repeatShouldEnd: (_, { value: { shipsRemaining } }) => shipsRemaining < 0 }
            ).

            // Game over
            append(text("GAME OVER"))
        ).

        join(First).

        call(fiber => { console.log(`<<< Game loop: ${fiber.id}`); })
);

// Keydown and keyup event handlers; translate raw inputs to input states of
// the game. T is for thrust (up arrow), L/R for left/right rotation (left and
// right arrow; allow both arrows to be pressed at the same time by using the
// direction of the last pressed arrow).

function keydown(event, { inputs }) {
    if (event.altKey || event.ctrlKey || event.isComposing || event.metaKey || event.shiftKey) {
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
    return fiber => fiber.
        call(({ value: game, scope }) => { scope.text = game.addObject(new Text(t)); }).
        event(({ value: game }) => game, "anykey").
        call(({ value: game, scope }) => {
            game.removeObject(scope.text);
            delete scope.text;
        });
}
