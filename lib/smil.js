import { parseClockValue } from "./util.js";

function parseDur(dur) {
    const clockValue = parseClockValue(dur);
    if (clockValue >= 0) {
        return clockValue;
    }
    if (/^\s*indefinite\s*$/i.test(dur)) {
        return Infinity;
    }
    // TODO "media"
    return 0;
}

// https://www.w3.org/TR/REC-smil/smil-layout.html#edef-layout

class SMILLayoutElement extends HTMLElement {
    constructor() {
        super();
    }

    static DefaultType = "text/smil-basic-layout";

    connectedCallback() {
        this.type = this.attributes.getNamedItem("type")?.value ?? SMILLayoutElement.DefaultType;
    }
}

window.customElements.define("smil-layout", SMILLayoutElement);

// https://www.w3.org/TR/REC-smil/smil-structure.html#edef-head

class SMILHeadElement extends HTMLElement {
    constructor() {
        super();
    }

    connectedCallback() {
        for (const node of this.childNodes) {
            if (!this.layout && node instanceof SMILLayoutElement) {
                this.layout = node;
            }
        }
    }
}

window.customElements.define("smil-head", SMILHeadElement);

// https://www.w3.org/TR/REC-smil/smil-structure.html#edef-body

class SMILBodyElement extends HTMLElement {
    constructor() {
        super();
    }
}

window.customElements.define("smil-body", SMILBodyElement);

// https://www.w3.org/TR/REC-smil/smil-structure.html#edef-smil

class SMILSmilElement extends HTMLElement {
    constructor() {
        super();
    }

    connectedCallback() {
        for (const node of this.childNodes) {
            if (!this.head && node instanceof SMILHeadElement) {
                this.head = node;
            }
            if (!this.body && node instanceof SMILBodyElement) {
                this.body = node;
            }
        }
    }
}

window.customElements.define("smil-smil", SMILSmilElement);
