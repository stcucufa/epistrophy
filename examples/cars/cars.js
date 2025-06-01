import Scheduler from "../../lib/scheduler.js";
import Fiber from "../../lib/fiber.js";
import { K } from "../../lib/util.js";

const WIDTH = 800;
const HEIGHT = 600;

const loadImage = async (src) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => { resolve(image); };
    image.onerror = () => reject(`Could not load image ${src}`);
    image.src = src;
    if (image.complete) {
        resolve(image);
    }
});

const fiber = Scheduler.run();
const images = ["red1.png", "red2.png"];
for (const image of images) {
    fiber.spawn(fiber => fiber.exec(async () => loadImage(image)));
}

fiber.
    join({
        fiberWillJoin(fiber) {
            this.values = new Array(fiber.children.length);
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
                const index = fiber.children.indexOf(child);
                this.values[index] = child.value;
                if (this.pending.size === 0) {
                    fiber.value = this.values;
                }
            }
        }
    }).
    either(
        fiber => fiber.effect(({ value: images }) => { console.info(images); }),
        fiber => fiber.effect(({ error }) => { console.error(error.message); })
    );
