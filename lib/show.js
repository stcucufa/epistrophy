import { isEmpty, mapit, typeOf } from "./util.js";

const quoted = {
    "\n": "n",
    "\t": "t",
    "\\": "\\",
    "\"": "\"",
};

function showOnce(x, shown, f) {
    if (shown.has(x)) {
        return "...";
    }
    shown.add(x);
    return f();
}

export function show(x, shown) {
    if (typeof x?.show === "function") {
        return x.show();
    }

    const type = typeOf(x);

    const helpers = {
        array: (xs, shown) => showOnce(xs, shown, () => `[${xs.map(x => show(x, shown)).join(", ")}]`),
        map: (m, shown) => showOnce(m, shown, () => `Map {${isEmpty(m) ? "" : ` ${
            mapit(m.entries(), kv => kv.map(x => show(x, shown)).join(" => ")).join(", ")
        } `}}`),
        object: (h, shown) => h.toString === Object.prototype.toString ?
            showOnce(h, shown, () => `{${isEmpty(h) ? "" : ` ${Object.entries(h).map(
                ([k, v]) => [k, show(v, shown)].join(": ")
            ).join(", ")} `}}`) : h.toString(),
        "object/function": f => show(Object.getPrototypeOf(f)),
        set: (s, shown) => showOnce(s, shown, () => `Set {${isEmpty(s) ? "" : ` ${
            mapit(s.values(), v => show(v, shown)).join(", ")
        } `}}`),
        string: s => `"${s.replace(/["\\\n\t]/g, c => `\\${quoted[c]}`)}"`
    };

    return type in helpers ? helpers[type](x, shown ?? new Set()) :
        type === "null" || type === "undefined" ? type : x.toString();
}
