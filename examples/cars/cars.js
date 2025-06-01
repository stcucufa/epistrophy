import Scheduler from "../../lib/scheduler.js";
import Fiber from "../../lib/fiber.js";
import { K } from "../../lib/util.js";

const WIDTH = 800;
const HEIGHT = 600;

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
        lanes: [50, 200, 350],
        cars: [{ images: ["red1.png", "red2.png"], frame: 0, x: 20, lane: 1 }],
    }));

// Load all resources before continuing
const images = ["red1.png", "red2.png"];
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
    );
