import { Scheduler, Fiber, cancelSiblings } from "./shell.js";

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
        this.scheduler.scheduleFiber(node.layout(
            new Fiber().call(({ id } , { now }) => { console.log(`<<< ${id}: ${now}`); })
        ).call(({ id, value }, { now }) => { console.log(`>>> ${id}: ${now}`, value); }), node.begin);
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

// A sequence of nodes.
export class Seq extends Node {

    // Create a Seq from a list of child nodes and attributes.
    constructor(children = [], attributes = {}) {
        super(attributes);
        this.children = children;
    }

    layout(fiber) {
        if (this.dur > 0) {
            const Delay = Symbol();
            return fiber.
                spawn(fiber => fiber.K(Delay).ramp(this.dur)).
                spawn(fiber => fiber.append(fiber => this.layoutChildren(fiber))).
                join({
                    childFiberDidJoin(child, scheduler) {
                        if (child.value === Delay) {
                            if (!child.error) {
                                cancelSiblings(child, scheduler);
                            }
                        } else {
                            child.parent.value = child.value;
                        }
                    }
                });
        }
        return this.layoutChildren(fiber);
    }

    layoutChildren(fiber) {
        for (const child of this.children) {
            this.graph.nodes.add(child);
            child.graph = this.graph;
            if (child.begin > 0) {
                fiber.ramp(child.begin);
            }
            child.layout(fiber);
        }
        return fiber;
    }
}

// A Task is represents a sync function call.
export class Task extends Node {

    // Create a new task from a sync function and optional attributes.
    constructor(f, attributes = {}) {
        super(attributes);
        this.f = f;
    }

    layout(fiber) {
        fiber.call(this.f);
        return this.dur > 0 ? fiber.ramp(this.dur) : fiber;
    }
}
