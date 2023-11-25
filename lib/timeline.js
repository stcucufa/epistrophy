import { create, html, svg } from "./util.js";
import { SVG_NS as xmlns } from "./util.js";

const proto = {
    init() {
        Object.defineProperty(this, "element", {
            enumerable: true,
            value: this.createElement()
        });
    },

    remove() {
        this.element.remove();
    },

    createElement() {
        this.svg = svg("svg");
        return html("div", { class: "timeline" }, svg);
    },
};

export const Timeline = () => create().call(proto);
