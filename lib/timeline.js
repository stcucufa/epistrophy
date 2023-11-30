import { on } from "./events.js";
import { Do, Attrs } from "./scheduler.js";
import { create, html, svg } from "./util.js";
import { SVG_NS as xmlns } from "./util.js";

const TRACK_HEIGHT = 100;
const WIDTH = 2400;
const DELAY_WIDTH = 70;
const REPEAT_H = 60;
const R = 15;
const M = 40;
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
        this.tracks = [];
        this.trackIndices = [];
        this.timesMap = new Map();
        this.spawns = [];
    },

    remove() {
        this.element.remove();
    },

    createElement() {
        this.timeRects = svg("g", { class: "times" }, svg("rect", { x: 0 }));
        this.svg = svg("svg", { xmlns },
            svg("defs",
                // cf. https://developer.mozilla.org/en-US/docs/Web/SVG/Element/marker
                svg("marker", {
                    id: "arrow", viewBox: "0 0 10 10", refX: 5, refY: 5, markerWidth: R, markerHeight: R,
                    orient: "auto-start-reverse"
                }, svg("path", { d: "M 0 0 L 10 5 L 0 10 z" }))
            ), this.timeRects
        );
        return html("div", { class: "timeline" }, this.svg);
    },

    // A new op is executed.
    op(thread, op, t) {
        const i = thread.id;
        if (!this.tracks[i]) {
            // Render the thread to a track if necessary.
            const y = TRACK_HEIGHT / 2 + this.trackIndices.length * TRACK_HEIGHT;
            const support = svg("g", svg("line", { x2: this.width, y1: y, y2: y }));
            const items = svg("g");
            const element = this.svg.appendChild(svg("g", { class: "track" }, support, items));
            this.tracks[i] = { element, support, items, thread, x: M, y, intervals: [] };
            this.trackIndices.push(i);

            if (this.spawns.length > 0) {
                const spawn = this.spawns.shift();
                const x = spawn.getAttribute("cx");
                support.appendChild(svg("line", {
                    "marker-end": "url(#arrow)",
                    x1: x, x2: x, y1: spawn.getAttribute("cy"), y2: y - R / 2
                }));
            }

            for (const rect of this.timeRects.children) {
                rect.setAttribute("height", this.trackIndices.length * TRACK_HEIGHT);
            }
        }

        const rect = this.timeRects.lastChild;
        const x1 = parseFloat(rect.getAttribute("x"));
        if (!this.timesMap.has(t)) {
            this.timeRects.appendChild(svg("rect", {
                x: this.width, height: this.trackIndices.length * TRACK_HEIGHT
            }));
            this.timesMap.set(t, this.width + M);
        }
        const x = this.timesMap.get(t);

        const track = this.tracks[i];
        track.x = x;
        const dur = op[Attrs].dur;
        if (dur === 0) {
            track.intervals.push([t, t]);
            track.items.appendChild(svg("circle", { cx: track.x, cy: track.y, r: R }));
            switch (op[Attrs].tag) {
                case "jump":
                    const [j, k] = thread.labels[op[Attrs].name];
                    console.assert(j < k);
                    const x = parseFloat([...track.items.children].at(j - k - 1).getAttribute("cx"));
                    track.support.appendChild(svg("rect", {
                        class: "repeat", x, y: track.y - REPEAT_H / 2, width: track.x - x, height: REPEAT_H
                    }));
                    break;
                case "spawn":
                    this.spawns.push(track.items.lastChild);
                    break;
            }
            track.x += M;
            this.timesMap.set(t, track.x);
        } else {
            track.intervals.push([t, t + (dur ?? Infinity)]);
            const rect = track.items.appendChild(svg("rect", {
                x: track.x, y: track.y - R, width: DELAY_WIDTH, height: 2 * R
            }));
            if (dur === null) {
                rect.classList.add("unresolved");
            }
            track.x += M + DELAY_WIDTH;
        }
        this.timeRects.lastChild.setAttribute("width", this.width - x1);

        // Update size
        if (this.width < track.x) {
            this.width = track.x;
            for (const index of this.trackIndices) {
                const track = this.tracks[index];
                track.support.firstChild.setAttribute("x2", this.width);
            }
        }
        this.width = Math.max(this.width, track.x);
        const height = this.trackIndices.length * TRACK_HEIGHT;
        this.svg.setAttribute("viewBox", `0 0 ${this.width} ${height}`);
        this.element.style.width = `${this.width / 2}px`;
        this.element.style.height = `${height / 2}px`;
    },

    // An end time was resolved (thread woke or delay become resolved).
    resolved(thread, t) {
        const track = this.tracks[thread.id];
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
            for (const index of this.trackIndices) {
                const track = this.tracks[index];
                for (let child = track.items.firstChild, i = 0; child; child = child.nextSibling, ++i) {
                    const [begin, end] = track.intervals[i];
                    const deltaEnd = end + (begin === end ? SYNC_DELAY_MS : 0) - from;
                    child.classList.toggle("current", deltaEnd > 0 && begin < to);
                }
            }
        } else {
            for (const index of this.trackIndices) {
                const track = this.tracks[index];
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
        for (const index of this.trackIndices) {
            const track = this.tracks[index];
            for (let child = track.items.firstChild; child; child = child.nextSibling) {
                child.classList.remove("current");
            }
        }
    }
};

export const Timeline = vm => create().call(proto, { vm });
