import { on } from "./events.js";
import { create, html, svg, zip } from "./util.js";
import { SVG_NS as xmlns } from "./util.js";

const proto = {
    init() {
        Object.defineProperty(this, "element", {
            enumerable: true,
            value: this.createElement()
        });
        on(this.vm, "unpack", ({ scheduleItem }) => { this.unpacked(scheduleItem); });
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
            this.tracks[i] = this.svg.appendChild(svg("g", { class: "track" },
                svg("line", { x2: 1000, y1: y, y2: y })
            ));
            let x = 50;
            for (const [op, dur] of zip(thread.ops, thread.timeline)) {
                if (dur === 0) {
                    this.tracks[i].appendChild(svg("circle", { cx: x, cy: y, r: 10 }));
                } else {
                    this.tracks[i].appendChild(svg("rect", { x, y: y - 10, width: 100, height: 20 }));
                    x += 100;
                }
                x += 50;
            }
            thread.ops.forEach((op, j) => {
                const x = 50 + j * 50;
            });
        }

        // Highlight the current op(s).
        for (let child = this.tracks[i].firstChild.nextSibling, j = 0; child; child = child.nextSibling, ++j) {
            child.classList.toggle("current", j === scheduleItem.pc);
        }
    }
};

export const Timeline = vm => create().call(proto, { vm });
