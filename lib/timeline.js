import { on } from "./events.js";
import { create, html, svg } from "./util.js";
import { SVG_NS as xmlns } from "./util.js";

const proto = {
    init() {
        Object.defineProperty(this, "element", {
            enumerable: true,
            value: this.createElement()
        });
        this.threads = new Map();
    },

    remove() {
        this.element.remove();
    },

    createElement() {
        this.svg = svg("svg");
        return html("div", { class: "timeline" }, this.svg);
    },
};

export const Timeline = vm => create().call(proto, { vm });
