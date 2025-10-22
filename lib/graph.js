import { Scheduler, Fiber } from "./shell.js";

export class Graph {
    constructor() {
        this.scheduler = new Scheduler();
        this.nodes = new Set();
    }

    run() {
        this.scheduler.addEventListener("error", ({ detail: { error } }) => { console.error(error.message ?? error); })
        this.scheduler.clock.start();
        return this;
    }

    addNode(node) {
        this.nodes.add(node);
        this.scheduler.scheduleFiber(...node.layout());
        return node;
    }
}

class Node {
    begin = 0;
    dur = 0;

    constructor(attributes) {
        if ("begin" in attributes) {
            this.begin = attributes.begin;
        }
        if ("dur" in attributes) {
            this.dur = attributes.dur;
        }
    }
}

export class Task extends Node {
    constructor(f, attributes = {}) {
        super(attributes);
        this.f = f;
    }

    layout() {
        const fiber = new Fiber();
        const begin = this.begin ?? 0;
        fiber.call(({ id }, { now }) => { console.log(`<<< ${now}: Task ${id}`); });
        fiber.call(this.f);
        if (this.dur > 0) {
            fiber.ramp(this.dur);
        }
        fiber.call(({ id }, { now }) => { console.log(`>>> ${now}: Task ${id}`); });
        return [fiber, begin];
    }
}
