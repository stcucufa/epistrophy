class SMILHeadElement extends HTMLElement {
    constructor() {
        super();
    }

    connectedCallback() {
    }
}

window.customElements.define("smil-head", SMILHeadElement);

class SMILBodyElement extends HTMLElement {
    constructor() {
        super();
    }

    connectedCallback() {
    }
}

window.customElements.define("smil-body", SMILBodyElement);

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
