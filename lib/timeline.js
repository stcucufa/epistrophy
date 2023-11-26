import { on } from "./events.js";
import { Do, Dur } from "./scheduler.js";
import { create, html, svg } from "./util.js";
import { SVG_NS as xmlns } from "./util.js";

const proto = {
    init() {
        Object.defineProperty(this, "element", {
            enumerable: true,
            value: this.createElement()
        });
        on(this.vm, "unpack", ({ scheduleItem }) => { this.unpacked(scheduleItem); });
        on(this.vm.clock, "update", ({ from, to }) => { this.updated(from, to); });
        on(this.vm.clock, "stop", () => { this.stopped(); });
        this.tracks = [];
    },

    remove() {
        this.element.remove();
    },

    createElement() {
        this.svg = svg("svg", { xmlns });
        return html("div", { class: "timeline" }, this.svg);
    },

    unpacked(scheduleItem) {
        const thread = scheduleItem.thread;
        const i = thread.id;
        if (!this.tracks[i]) {
            // Render the thread to a track if necessary.
            const y = 50 + i * 100;
            const element = this.svg.appendChild(svg("g", { class: "track" },
                svg("line", { x2: 1000, y1: y, y2: y })
            ));
            this.tracks[i] = { element, thread, x: 50, y, intervals: [] };
        }

        const track = this.tracks[i];
        if (scheduleItem.executionMode === Do) {
            const t = scheduleItem.t;
            for (let i = scheduleItem.pc; i < thread.ops.length; ++i) {
                const op = thread.ops[i];
                if (op[Dur] === 0) {
                    track.intervals.push([t, t]);
                    track.element.appendChild(svg("circle", { cx: track.x, cy: track.y, r: 10 }));
                    track.x += 50;
                } else {
                    // FIXME 2A04 Visualize unresolved durations (op[Dur] === null)
                    console.assert(op[Dur] > 0);
                    track.intervals.push([t, t + op[Dur]]);
                    track.element.appendChild(svg("rect", {
                        x: track.x, y: track.y - 10, width: 100, height: 20
                    }));
                    track.x += 150;
                    break;
                }
            }
        }
    },

    // Highlight the current ops, leaving the synchronous/very short ones
    // highlighted for just a little bit.
    updated(from, to) {
        if (from < to) {
            for (const track of this.tracks) {
                for (let child = track.element.firstChild.nextSibling, i = 0;
                    child; child = child.nextSibling, ++i) {
                    const [begin, end] = track.intervals[i];
                    const deltaEnd = end + 200 - from;
                    child.classList.toggle("current", deltaEnd > 0 && begin < to);
                }
            }
        } else {
            for (const track of this.tracks) {
                for (let child = track.element.firstChild.nextSibling, i = 0;
                    child; child = child.nextSibling, ++i) {
                    const [begin, end] = track.intervals[i];
                    const deltaBegin = begin - 200 - to;
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
