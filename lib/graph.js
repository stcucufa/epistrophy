import { Scheduler, Fiber, cancelSiblings } from "./shell.js";

export default class Graph {

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
        // FIXME 5204 Graph: variable attributes
        this.scheduler.scheduleFiber(node.layout(new Fiber()), node.begin);
        return node;
    }

    // Create an Await node.
    await(f, attributes) {
        return this.addNode(new Await(f, attributes));
    }

    // Create a Call node.
    call(f, attributes) {
        return this.addNode(new Call(f, attributes));
    }

    // Create an Event node.
    event(type, target, attributes) {
        return this.addNode(new Event(type, target, attributes));
    }
}

// Known node attributes.
const BaseAttributes = ["begin", "dur"];

// The base class for nodes, with their common attributes (begin and dur).
class Node {
    begin = 0;
    dur = 0;

    // Create a new node and set their attributes.
    constructor(attributes = {}, knownAttributes = BaseAttributes) {
        for (const p of knownAttributes.filter(p => p in attributes)) {
            this[p] = attributes[p];
        }
    }
}

// A sequence of nodes.
class Seq extends Node {

    // Create a Seq from a list of child nodes and attributes.
    constructor(children, attributes) {
        super(attributes);
        this.children = children ?? [];
    }

    layout(fiber) {
        return this.dur > 0 ? layoutDur(fiber, this.dur, fiber => fiber.append(fiber => this.layoutChildren(fiber))) :
            this.layoutChildren(fiber);
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

class Call extends Node {
    constructor(f, attributes) {
        super(attributes);
        this.f = f;
    }

    layout(fiber) {
        fiber.call(this.f);
        return this.dur !== 0 ? fiber.ramp(this.dur) : fiber;
    }
}

class Event extends Node {
    dur = null;

    constructor(target, type, attributes) {
        super(attributes, ["delegate", ...BaseAttributes]);
        this.target = target;
        this.type = type;
    }

    layout(fiber) {
        return this.dur === null ? fiber.event(this.target, this.type, this.delegate) :
            layoutDur(fiber, this.dur, fiber => fiber.event(this.target, this.type, this.delegate));
    }
}

class Await extends Node {
    dur = null;

    constructor(f, attributes) {
        super(attributes, ["delegate", ...BaseAttributes]);
        this.f = f;
    }

    layout(fiber) {
        return this.dur === null ? fiber.await(this.f, this.delegate) :
            layoutDur(fiber, this.dur, fiber => fiber.await(this.f, this.delegate));
    }
}

// Layout a node with a dur attribute.
const layoutDur = (fiber, dur, f) => fiber.
    spawn(fiber => fiber.named().ramp(dur)).
    spawn(f).
    join({
        childFiberDidJoin(child) {
            if (child.name) {
                // The delay fiber is named, but not the other one.
                if (!child.error) {
                    cancelSiblings(child);
                }
            } else {
                child.parent.value = child.value;
            }
        }
    });
