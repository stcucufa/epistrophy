import { on } from "./events.js";
import { Do, Attrs } from "./scheduler.js";
import { add, create, html, svg } from "./util.js";
import { SVG_NS as xmlns } from "./util.js";

const R = 15;
const M = 40;
const DELAY_W = 2 * M;
const TRACK_H = 100;
const REPEAT_H = 60;
const SYNC_DELAY_MS = 200;

const proto = {
    init() {
        Object.defineProperty(this, "element", {
            enumerable: true,
            value: this.createElement()
        });
        on(this.vm, "op", ({ thread, op, t }) => { this.op(thread, op, t); });
        on(this.vm, "resolve", ({ thread, t }) => { this.resolved(thread, t); });
        on(this.vm, "event", ({ thread }) => { this.resolved(thread, this.vm.clock.now); });
        on(this.vm.clock, "update", ({ from, to }) => { this.updated(from, to); });
        on(this.vm.clock, "stop", () => { this.stopped(); });
        this.width = 0;
        this.height = 0;
        this.tracksById = [];
        this.trackIndices = [];
        this.currentTimeInterval = [0, M];
        this.timeIntervals = new Map();
        this.timeIntervals.set(0, this.currentTimeInterval);
        this.spawns = [];
    },

    remove() {
        this.element.remove();
    },

    // Setup the timeline element and its initial contents.
    createElement() {
        this.timeRects = svg("g", { class: "times" }, svg("rect", { x: 0 }));
        return svg("svg", { xmlns, class: "timeline" },
            svg("defs",
                // Cf. https://developer.mozilla.org/en-US/docs/Web/SVG/Element/marker
                svg("marker", {
                    id: "arrow", viewBox: "0 0 10 10", refX: 5, refY: 5, markerWidth: R, markerHeight: R,
                    orient: "auto-start-reverse"
                }, svg("path", { d: "M 0 0 L 10 5 L 0 10 z" }))
            ), this.timeRects
        );
    },

    // Tracks are indexed by thread ID; since they may not be consecutive, we
    // also store the used IDs. This allows getting all the track in order
    // regardless of the thread IDs.
    *tracks() {
        for (const i of this.trackIndices) {
            yield this.tracksById[i];
        }
    },

    // A new op is going to be executed and should be added to the timeline.
    // We may create a new track as well.
    op(thread, op, t) {
        const i = thread.id;

        // Create a new track for the thread if necessary.
        if (!this.tracksById[i]) {
            const y = (this.trackIndices.length + 0.5) * TRACK_H;
            const support = svg("g", svg("line", { x2: this.width, y1: y, y2: y }));
            const items = svg("g");
            const element = this.element.appendChild(svg("g", { class: "track" }, support, items));
            this.tracksById[i] = {
                element, support, items, thread, x: this.currentTimeInterval[1], y, intervals: []
            };
            this.trackIndices.push(i);

            if (this.spawns.length > 0) {
                const [x1, y1] = this.spawns.shift();
                support.appendChild(svg("line", {
                    "marker-end": "url(#arrow)", x1, x2: x1, y1, y2: y - R / 2
                }));
            }

            // Update height
            this.height += TRACK_H;
            for (const rect of this.timeRects.children) {
                rect.setAttribute("height", this.height);
            }
        }
        const track = this.tracksById[i];

        // Update the current time rect width or create a new one.
        const rect = this.timeRects.lastChild;
        if (!this.timeIntervals.has(t)) {
            // Add a new time rect.
            // TODO show the time for this rect.
            this.timeRects.appendChild(svg("rect", {
                x: this.currentTimeInterval[1], height: this.height, width: M
            }));
            const x = this.currentTimeInterval[1];
            this.currentTimeInterval = add(this.timeIntervals, t, [x, x + M]);
        }

        // Add a new item for the op.
        const dur = op[Attrs].dur;
        if (dur === 0) {
            track.intervals.push([t, t]);
            track.items.appendChild(svg("circle", { cx: track.x, cy: track.y, r: R }));
            switch (op[Attrs].tag) {
                case "jump":
                    const [j, k] = thread.labels[op[Attrs].name];
                    console.assert(j < k);
                    // TODO store this x
                    const x = parseFloat([...track.items.children].at(j - k - 1).getAttribute("cx"));
                    track.support.appendChild(svg("rect", {
                        class: "repeat", x, y: track.y - REPEAT_H / 2, width: track.x - x, height: REPEAT_H
                    }));
                    break;
                case "spawn":
                    this.spawns.push([track.x, track.y]);
                    break;
            }
            track.x += M;
        } else {
            track.intervals.push([t, t + (dur ?? Infinity)]);
            const rect = track.items.appendChild(svg("rect", {
                x: track.x, y: track.y - R, width: DELAY_W, height: 2 * R
            }));
            if (dur === null) {
                rect.classList.add("unresolved");
            }
            track.x += M + DELAY_W;
        }
        this.currentTimeInterval[1] += M;

        // Update size
        if (this.width < track.x) {
            this.width = track.x;
            for (const track of this.tracks()) {
                track.support.firstChild.setAttribute("x2", this.width);
            }
            this.timeRects.lastChild.setAttribute(
                "width", this.currentTimeInterval[1] - this.currentTimeInterval[0]
            );
        }
        this.width = Math.max(this.width, track.x);
        this.element.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
        this.element.style.width = `${this.width / 2}px`;
        this.element.style.height = `${this.height / 2}px`;

        console.log(this.timeIntervals);
    },

    // An end time was resolved (thread woke or delay become resolved).
    resolved(thread, t) {
        const track = this.tracksById[thread.id];
        const interval = track.intervals.at(-1);
        console.assert(interval[1] === Infinity);
        interval[1] = t;
        const rect = track.items.querySelector(".unresolved");
        rect.classList.remove("unresolved");
    },

    // Highlight the current ops, leaving the synchronous/very short ones
    // highlighted for just a little bit.
    updated(from, to) {
        if (from < to) {
            for (const track of this.tracks()) {
                for (let child = track.items.firstChild, i = 0; child; child = child.nextSibling, ++i) {
                    const [begin, end] = track.intervals[i];
                    const deltaEnd = end + (begin === end ? SYNC_DELAY_MS : 0) - from;
                    child.classList.toggle("current", deltaEnd > 0 && begin < to);
                }
            }
        } else {
            for (const track of this.tracks()) {
                for (let child = track.items.firstChild, i = 0; child; child = child.nextSibling, ++i) {
                    const [begin, end] = track.intervals[i];
                    const deltaBegin = begin - (begin === end ? SYNC_DELAY_MS : 0) - to;
                    child.classList.toggle("current", deltaBegin < 0 && end > from);
                }
            }
        }
    },

    // Unhighlight everything when the clock stops.
    stopped() {
        for (const track of this.tracks()) {
            for (let child = track.items.firstChild; child; child = child.nextSibling) {
                child.classList.remove("current");
            }
        }
    }
};

export const Timeline = vm => create().call(proto, { vm });
