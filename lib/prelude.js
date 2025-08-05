import { Fiber, Scheduler } from "./core.js";

// Event is an async command that waits for a specific event before continuing.
Fiber.prototype.event = function(target, name) {
    return this.async((fiber, scheduler) => new Promise(resolve => {
        const effectiveTarget = fiber.getEffectiveParameter(target);
        fiber.eventHandler = { effectiveTarget, resolve };
        effectiveTarget.addEventListener(name, resolve);
    }), {
        asyncWillEnd(_, fiber) {
            fiber.eventHandler.effectiveTarget.removeEventListener(name, fiber.eventHandler.resolve);
            delete fiber.eventHandler;
        }
    });
};

// Delegate to join on first child ending, cancelling all siblings.
export const First = {
    childFiberDidJoin(child, scheduler) {
        for (const sibling of child.parent.children) {
            if (!(Object.hasOwn(sibling, "observedEnd"))) {
                scheduler.cancelFiber(sibling);
            }
        }
    }
};

// Create a new scheduler and a main fiber, then start the clock. The fiber is
// returned so that new instructions can be added immediately.
export function fiber() {
    const scheduler = new Scheduler();
    scheduler.clock.start();
    const fiber = new Fiber();
    scheduler.scheduleFiber(fiber);
    return fiber;
}
