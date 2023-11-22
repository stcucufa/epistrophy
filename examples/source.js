import { html } from "../lib/util.js";

const script = Array.prototype.find.call(
    document.querySelectorAll("script"),
    script => /----8<----/.test(script.textContent)
);

if (script) {
    const match = script.textContent.match(/-+8<-+[^-8](.*)\/\/\s*-+8<-+/s);
    if (match) {
        document.body.appendChild(html("pre", { class: "source" }, match[1].trim()));
    }
}
