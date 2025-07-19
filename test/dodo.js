import test from "./test.js";
import parse from "../dodo/parser.js";

test("parse()", t => {
    const document = parse("{ hello }");
    t.same(document.text, "{ hello }", "returns a document object with the original text");
    t.same(document.root.document, document, "document of root is document");
    t.same(document.root.name, "hello", "document root element has expected name");
    t.equal(document.root.attributes, {}, "no attribute");
    t.equal(document.root.content, [], "no content");
});

test("parse(): empty document", t => {
    t.throws(() => parse(""), `"no content" error`);
});
