import { Scheduler, Fiber } from "./shell.js";

export class Graph {

    // Create an empty graph with its own scheduler.
    constructor() {
        this.scheduler = new Scheduler();
        this.nodes = new Set();
    }

    // Run the scheduler and return the graph. There is no main fiber; fibers
    // will be scheduled directly for nodes that get added.
    run() {
        this.scheduler.addEventListener("error", ({ detail: { error } }) => { console.error(error.message ?? error); })
        this.scheduler.clock.start();
        return this;
    }

    // Add a node to the graph.
    addNode(node) {
        this.nodes.add(node);
        node.graph = this;
        this.scheduler.scheduleFiber(node.layout(), node.begin);
        return node;
    }
}

// The base class for nodes, with their common attributes (begin and dur).
class Node {
    begin = 0;
    dur = 0;

    // Create a new node and set their attributes.
    constructor(attributes) {
        if ("begin" in attributes) {
            this.begin = attributes.begin;
        }
        if ("dur" in attributes) {
            this.dur = attributes.dur;
        }
    }
}

// A Task is represents a sync function call.
export class Task extends Node {

    // Create a new task from a sync function and optional attributes.
    constructor(f, attributes = {}) {
        super(attributes);
        this.f = f;
    }

    layout() {
        const fiber = new Fiber();
        fiber.call(({ id }, { now }) => { console.log(`<<< ${now}: Task ${id}`); });
        fiber.call(this.f).ramp(this.dur);
        fiber.call(({ id }, { now }) => { console.log(`>>> ${now}: Task ${id}`); });
        return fiber;
    }
}
