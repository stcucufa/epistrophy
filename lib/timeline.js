import { on } from "./events.js";
import { Do, Dur } from "./scheduler.js";
import { create, html, svg } from "./util.js";
import { SVG_NS as xmlns } from "./util.js";

const TRACK_HEIGHT = 100;
const WIDTH = 2400;
const DELAY_WIDTH = 70;
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
        this.tracks = [];
    },

    remove() {
        this.element.remove();
    },

    createElement() {
        this.svg = svg("svg", { xmlns, viewBox: `0 0 ${WIDTH} ${TRACK_HEIGHT}` });
        return html("div", { class: "timeline" }, this.svg);
    },

    // A new op is executed.
    op(thread, op) {
        const i = thread.id;
        if (!this.tracks[i]) {
            // Render the thread to a track if necessary.
            const y = TRACK_HEIGHT / 2 + i * TRACK_HEIGHT;
            const element = this.svg.appendChild(svg("g", { class: "track" },
                svg("line", { x2: WIDTH, y1: y, y2: y })
            ));
            this.tracks[i] = { element, thread, x: M, y, intervals: [] };
        }

        const track = this.tracks[i];
        const t = this.vm.t;
        const dur = op[Dur];
        if (dur === 0) {
            track.intervals.push([t, t]);
            track.element.appendChild(svg("circle", { cx: track.x, cy: track.y, r: R }));
            track.x += M;
        } else {
            track.intervals.push([t, t + (dur ?? Infinity)]);
            const rect = track.element.appendChild(svg("rect", {
                x: track.x, y: track.y - R, width: DELAY_WIDTH, height: 2 * R
            }));
            if (dur === null) {
                rect.classList.add("unresolved");
            }
            track.x += M + DELAY_WIDTH;
        }
    },

    // An end time was resolved (thread woke or delay become resolved).
    resolved(thread, t) {
        const track = this.tracks[thread.id];
        const interval = track.intervals.at(-1);
        console.assert(interval[1] === Infinity);
        interval[1] = t;
        const rect = track.element.querySelector(".unresolved");
        rect.classList.remove("unresolved");
    },

    // Highlight the current ops, leaving the synchronous/very short ones
    // highlighted for just a little bit.
    updated(from, to) {
        if (from < to) {
            for (const track of this.tracks) {
                for (let child = track.element.firstChild.nextSibling, i = 0;
                    child; child = child.nextSibling, ++i) {
                    const [begin, end] = track.intervals[i];
                    const deltaEnd = end + (begin === end ? SYNC_DELAY_MS : 0) - from;
                    child.classList.toggle("current", deltaEnd > 0 && begin < to);
                }
            }
        } else {
            for (const track of this.tracks) {
                for (let child = track.element.firstChild.nextSibling, i = 0;
                    child; child = child.nextSibling, ++i) {
                    const [begin, end] = track.intervals[i];
                    const deltaBegin = begin - (begin === end ? SYNC_DELAY_MS : 0) - to;
                    child.classList.toggle("current", deltaBegin < 0 && end > from);
                }
            }
        }
    },

    // Unhighlight everything when the clock stops.
    stopped() {
        for (const track of this.tracks) {
            for (let child = track.element.firstChild.nextSibling; child; child = child.nextSibling) {
                child.classList.remove("current");
            }
        }
    }
};

export const Timeline = vm => create().call(proto, { vm });
