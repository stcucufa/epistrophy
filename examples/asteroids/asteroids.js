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

    // Draw loop: draw the game.
    spawn(fiber => fiber.ramp(Infinity, ({ value: game }) => { game.draw(); })).

    // Keyboard handling (see actual handlers below).
    spawn(fiber => fiber.
        call(({ value: { inputs } }) => {
            window.addEventListener("keydown", event => keydown(event, inputs));
            window.addEventListener("keyup", event => keyup(event, inputs));
        })
    ).

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

    // Enemies (asteroids, TODO: UFO)
    spawn(fiber => fiber.
        call(({ value: game }) => Array(4).fill().map(() => game.asteroid()))
    ).

    // Player loop: spawn a new ship and wait for it to be destroyed, then for
    // the debris to clear up before spawning a new one.
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

// Keydown and keyup event handlers; translate raw inputs to input states of
// the game. T is for thrust (up arrow), L/R for left/right rotation (left and
// right arrow; allow both arrows to be pressed at the same time by using the
// direction of the last pressed arrow).

function keydown(event, inputs) {
    if (event.altKey || event.ctrlKey || event.isComposing || event.metaKey || event.shiftKey) {
        return;
    }
    switch (event.key) {
        case "ArrowLeft":
            if (!event.repeat) {
                if (inputs.Right) {
                    delete inputs.Right;
                    inputs.RL = true;
                }
                inputs.Left = true;
            }
            break;
        case "ArrowRight":
            if (!event.repeat) {
                if (inputs.Left) {
                    delete inputs.Left;
                    inputs.LR = true;
                }
                inputs.Right = true;
            }
            break;
        case "ArrowUp":
            if (!event.repeat) {
                inputs.Thrust = true;
            }
            break;
        case "z":
            if (!event.repeat) {
                inputs.Shoot = true;
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

function keyup(event, inputs) {
    switch (event.key) {
        case "ArrowLeft":
            delete inputs.Left;
            if (inputs.RL || inputs.LR) {
                delete inputs.RL;
                delete inputs.LR;
                inputs.Right = true;
            }
            break;
        case "ArrowRight":
            delete inputs.Right;
            if (inputs.RL || inputs.LR) {
                delete inputs.RL;
                delete inputs.LR;
                inputs.Left = true;
            }
            break;
        case "ArrowUp":
            delete inputs.Thrust;
    }
}
