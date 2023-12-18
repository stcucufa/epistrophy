import { on } from "./events.js";
import { Do, Attrs } from "./scheduler.js";
import { add, create, del, get, html, svg, timecount } from "./util.js";
import { SVG_NS as xmlns } from "./util.js";

const R = 15;
const M = 40;
const DELAY_W = 2 * M;
const TRACK_H = 100;
const REPEAT_H = 60;
const SYNC_DELAY_MS = 200;

const Error = Symbol();

const proto = {
    init() {
        Object.defineProperty(this, "element", {
            enumerable: true,
            value: this.createElement()
        });
        on(this.vm, "op", ({ thread, op, t }) => { this.op(thread, op, t); });
        on(this.vm, "error", event => { this.error(event); });
        on(this.vm, "resolve", ({ thread, t }) => { this.resolved(thread, t); });
        on(this.vm, "cancel", ({ thread, t }) => { this.cancelled(thread, t); });
        on(this.vm, "event", ({ thread }) => { this.resolved(thread, this.vm.clock.now); });
        on(this.vm, "await", ({ thread }) => { this.resolved(thread, this.vm.clock.now); });
        on(this.vm, "spawns", ({ parentThread, childThreads }) => {
            this.spawnedThreads(parentThread, childThreads);
        });
        on(this.vm.clock, "update", ({ from, to }) => { this.updated(from, to); });
        on(this.vm.clock, "stop", () => { this.stopped(); });
        this.width = M;
        this.height = TRACK_H / 2;
        this.tracksById = [];
        this.trackIndices = [];
        this.currentTimeInterval = [0, M];
        this.timeIntervals = new Map();
        this.timeIntervals.set(0, this.currentTimeInterval);
        this.spawnsById = {};
    },

    remove() {
        this.element.remove();
    },

    // Setup the timeline element and its initial contents.
    createElement() {
        this.timeRects = svg("g", { class: "times" }, svg("rect", { x: 0 }));
        this.timeLabels = svg("g");
        return svg("svg", { xmlns, class: "timeline" },
            svg("defs",
                // Cf. https://developer.mozilla.org/en-US/docs/Web/SVG/Element/marker
                svg("marker", {
                    id: "arrow", viewBox: "0 0 10 10", refX: 5, refY: 5, markerWidth: R, markerHeight: R,
                    orient: "auto-start-reverse"
                }, svg("path", { d: "M 0 0 L 10 5 L 0 10 z" }))
            ), this.timeRects, this.timeLabels
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
            const y = (this.trackIndices.length + 1) * TRACK_H;
            const support = svg("g", svg("line", { x2: this.width, y1: y, y2: y }));
            const items = svg("g");
            const element = this.element.appendChild(svg("g", { class: "track" }, support, items));
            this.tracksById[i] = {
                element, support, items, thread, x: this.currentTimeInterval[1], y, intervals: [],
                ops: new Map()
            };
            this.trackIndices.push(i);

            if (i in this.spawnsById) {
                const [x1, y1] = del(this.spawnsById, i);
                support.appendChild(svg("line", {
                    "marker-end": "url(#arrow)", x1, x2: x1, y1: y1 + R, y2: y - R / 2
                }));
            }

            // Update total height of the timeline and time rects.
            this.height += TRACK_H;
            for (const rect of this.timeRects.children) {
                rect.setAttribute("height", this.height);
            }
        }
        const track = this.tracksById[i];

        // Update the current time rect width or create a new one.
        const rect = this.timeRects.lastChild;
        if (!this.timeIntervals.has(t)) {
            // Add a new time rect, adding a gap from the last one.
            this.currentTimeInterval[1] = this.width + M;
            this.timeRects.lastChild.setAttribute(
                "width", this.currentTimeInterval[1] - this.currentTimeInterval[0]
            );
            this.currentTimeInterval = add(
                this.timeIntervals, t,
                [this.currentTimeInterval[1], this.currentTimeInterval[1] + M]
            );
            this.timeRects.appendChild(svg("rect", {
                x: this.currentTimeInterval[0], height: this.height, width: M
            }));
            this.timeLabels.appendChild(svg("text", {
                x: this.currentTimeInterval[0] + M / 2, y: TRACK_H / 2
            }, timecount(t)));
        }
        if (track.t !== t) {
            track.x = this.currentTimeInterval[1];
            track.t = t;
        }

        // Add a new item for the op.
        if (!op) {
            track.support.appendChild(svg("circle", { class: "end", cx: track.x, cy: track.y, r: R }));
            track.support.appendChild(svg("circle", { class: "end", cx: track.x, cy: track.y, r: R / 2}));
            if (thread.parent) {
                const y2 = this.tracksById[thread.parent.id].y + R / 2;
                if (thread.parent.join.values) {
                    track.support.appendChild(svg("line", {
                        "marker-end": "url(#arrow)", x1: track.x, x2: track.x, y1: track.y - R, y2
                    }));
                }
            }
            track.x += M;
        } else if (op === Error) {
            this.cancelMark(track, "error");
        } else {
            const dur = op[Attrs].dur;
            let item;
            if (dur === 0) {
                track.intervals.push([t, t]);
                item = track.items.appendChild(svg("circle", { cx: track.x, cy: track.y, r: R }));
                switch (op[Attrs].tag) {
                    case "jump":
                        const [j, k] = thread.labels[op[Attrs].name];
                        console.assert(j < k);
                        const x = parseFloat([...track.items.children].at(j - k - 1).getAttribute("cx"));
                        track.support.appendChild(svg("rect", {
                            class: "repeat", x, y: track.y - REPEAT_H / 2,
                            width: track.x - x, height: REPEAT_H
                        }));
                        break;
                    case "spawn":
                        this.addSpawnArrow(track, op);
                        break;
                    case "map":
                        track.spawnX = track.x;
                        break;
                }
                track.x += M;
            } else {
                track.intervals.push([t, t + (dur ?? Infinity)]);
                item = track.items.appendChild(svg("rect", {
                    x: track.x, y: track.y - R, width: DELAY_W, height: 2 * R
                }));
                if (dur === null) {
                    item.classList.add("unresolved");
                }
                if (op[Attrs].tag === "join/thread") {
                    this.addSpawnArrow(track, op, M / 2);
                }
                track.x += M + DELAY_W;
            }
            get(track.ops, op, () => new Map()).set(t, item);
        }
        this.currentTimeInterval[1] += M;

        // Update size
        if (this.width < track.x) {
            this.width = track.x;
            for (const track of this.tracks()) {
                track.support.firstChild.setAttribute("x2", this.width + 2 * M);
            }
            this.timeRects.lastChild.setAttribute(
                "width", this.currentTimeInterval[1] - this.currentTimeInterval[0] + 2 * M
            );
        }
        this.element.setAttribute("viewBox", `0 0 ${this.width + 2 * M} ${this.height}`);
        this.element.style.width = `${this.width / 2 + M}px`;
        this.element.style.height = `${this.height / 2}px`;
    },

    // An error occurred while executing an op. If the error is asynchronous,
    // add an error marker.
    error(event) {
        const { thread, op, t, error, asynchronous } = event;
        const track = this.tracksById[thread.id];
        const item = track.ops.get(op).get(t);
        item.classList.add("error");
        item.classList.remove("unresolved");
        if (asynchronous > 0) {
            this.op(thread, Error, asynchronous);
        }
    },

    // Threads were spawned with a map.
    spawnedThreads(parentThread, childThreads) {
        const track = this.tracksById[parentThread.id];
        for (const child of childThreads) {
            this.spawnsById[child.id] = [track.spawnX, track.y];
        }
        delete track.spawnX;
    },

    // Add a spawn arrow from an op on a track to the track of the child thread.
    addSpawnArrow(track, op, offset = 0) {
        const j = op[Attrs].childThread.id;
        const childTrack = this.tracksById[j];
        if (childTrack) {
            track.support.appendChild(svg("line", {
                "marker-end": "url(#arrow)",
                x1: track.x + offset, x2: track.x + offset,
                y1: track.y + R, y2: childTrack.y - R / 2
            }));
            childTrack.x = track.x + 2 * M + offset;
        } else {
            this.spawnsById[j] = [track.x + offset, track.y];
        }
    },

    // An end time was resolved (thread woke or delay become resolved).
    resolved(thread, t) {
        const track = this.tracksById[thread.id];
        const interval = track.intervals.at(-1);
        console.assert(interval[1] === Infinity);
        interval[1] = t;
        const rect = track.items.querySelector(".unresolved");
        if (interval[0] === interval[1]) {
            track.x -= 2 * M;
            track.items.replaceChild(svg("circle", { cx: track.x - M, cy: track.y, r: R }), rect);
        } else {
            rect.classList.remove("unresolved");
        }
    },

    // A thread was cancelled at time t; this also resolves the last interval.
    cancelled(thread, t) {
        const track = this.tracksById[thread.id];
        const interval = track.intervals.at(-1);
        if (interval?.[1] === Infinity) {
            interval[1] = t;
            const rect = track.items.querySelector(".unresolved");
            rect.classList.remove("unresolved");
        }
        if (track.t !== t) {
            track.x = this.currentTimeInterval[1];
            track.t = t;
        }
        this.cancelMark(track);
    },

    // Add a cancel mark at the end of a track.
    cancelMark(track, className = "cancel") {
        const x = track.x;
        const y = track.y;
        const m = M / 3;
        track.support.appendChild(svg("path", {
            class: className,
            d: `M${x - m},${y - m}L${x + m},${y + m}M${x - m},${y + m}L${x + m},${y - m}`
        }));
    },

    // Highlight the current ops, leaving the synchronous/very short ones
    // highlighted for just a little bit.
    updated(from, to) {
        if (this.vm.clock.broken) {
            return;
        }

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
