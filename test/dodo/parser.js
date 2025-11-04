import test from "../test.js";
import parse, { Backtick, Space, consolidateText } from "../../dodo/parser.js";

test("Parser", t => {
    const document = parse("{ hello }");
    t.same(document.text, "{ hello }", "returns a document object with the original text");
    t.same(document.root.document, document, "document of root is document");
    t.same(document.root.name, "hello", "document root element has expected name");
    t.equal(document.root.attributes, {}, "no attribute");
    t.equal(document.root.content, [], "no content");
});

test("Parser: empty document", t => {
    t.throws(() => parse(""), `"no content" error`);
});

test("Parser: no content", t => {
    t.throws(() => parse(
`# Just a comment, not content!
And some text,
which does not count.
`), `"no content" error`);
});

test("Parser: element name", t => {
    const { root } = parse("{ Hello,\\ world! }")
    t.same(root.name, "Hello, world!");
});

test("Parser: anonymous element", t => {
    const { root } = parse("{ { λ: x { + `x `1 } } `2 }");
    t.undefined(root.name, "name is undefined");
    t.same(root.content.length, 3, "content (3 values)");
    t.same(root.content[0].name, "λ", "first child element has a name");
    t.same(root.content[1], Space, "space");
    t.same(root.content[2], 2, "number");
});

test("Parser: unescaping", t => {
    const { root } = parse(`{ \\{\\ \\wow\\:\\ \\} }`);
    t.same(root.name, "{ wow: }", "name with {} and :");
});

test("Parser: word and string attributes", t => {
    const { root } = parse(`{ p foo: bar baz: "fum, \\"quux\\", &c." x: y:z a\\:bc: d That’s it! }`);
    t.equal(root.attributes, { foo: "bar", baz: `fum, "quux", &c.`, x: "y:z", "a:bc": "d" }, "attributes");
    t.equal(consolidateText(root.content), ["That’s it!"], "content following attributes");
});

test("Parser: default attribute (implicit)", t => {
    const { root } = parse("{ hello: world! foo: bar }");
    t.equal(root.attributes, { hello: "world!", foo: "bar" }, "and more attributes");
    t.equal(root.content, [], "no content");
});

test("Parser: default attribute (explicit)", t => {
    const { root } = parse("{ hello foo: bar hello: world! }");
    t.equal(root.attributes, { hello: "world!", foo: "bar" }, "spelled out");
    t.equal(root.content, [], "no content");
});

test("Parser: not an attribute", t => {
    const { root } = parse("{ p This\\: is not an attribute. That: not an attribute either. }");
    t.equal(root.attributes, {}, "escaped");
    t.equal(consolidateText(root.content), ["This: is not an attribute. That: not an attribute either."],
        "parsed as content text");
});

test("Parser: number attributes", t => {
    const { root } = parse("{ constant e: `2.718281828459045 zero: `0 }");
    t.equal(root.attributes, { e: 2.718281828459045, zero: 0 }, "number value");
});

test("Parser: list attributes", t => {
    const { root } = parse("{ constants: `{ 1 2 3 } }");
    t.equal(root.name, "constants", "default attribute with");
    t.equal(root.attributes, { constants: [1, 2, 3] }, "list value");
});

test("Parser: unquoted attribute error", t => {
    t.throws(() => { parse("{ constant foo: `bar }"); }, "Unquoted value is not a number or a list.");
});

test("Parser: content unescaping", t => {
    const { root } = parse("{ p Hello, \\{ \\`world\\# \\}\\ }");
    t.equal(consolidateText(root.content), ["Hello, { `world# } "], "{, }, ` and # in content");
});

test("Parser: whitespace handling", t => {
    const { root } = parse(`{ p This is a
        { em paragraph }.
    }`);
    const content = consolidateText(root.content);
    t.same(content.length, 3, "content count");
    t.same(content[0], "This is a ", "text");
    t.equal(content[1].content, ["paragraph"], "trimmed text content in child element");
    t.equal(content[2], ".", "and at the end");
});

test("Parser: comments within content", t => {
    const { root } = parse(`{ p This is some content # not this
and \\# some more, # but not this
this is more content }`);
    t.equal(consolidateText(root.content), ["This is some content and # some more, this is more content"],
        "handled comments");
});

test("Parser: escaping spaces and newlines", t => {
    const { root } = parse(`{ p With trailing space\\ }`);
    t.equal(consolidateText(root.content), ["With trailing space "], "deliberate trailing space");
});

test("Parser: unquoting", t => {
    const { root } = parse("{ define: π `3.141592653589793 (half of τ) }");
    t.equal(consolidateText(root.content), [3.141592653589793, " (half of τ)"], "number and text with leading space");
});

test("Parser: unquoting", t => {
    const { root } = parse("{ f `{ x 2 \"x 2\" y } }");
    t.equal(root.content, [["x", 2, "x 2", "y"]], "list");
});

test("Parser: mixed content (unquoting; filtering out space)", t => {
    const { root } = parse("{ import { as: foo bar } `{ baz fum } }");
    const content = root.content.filter(v => v !== Space);
    t.same(content.length, 2, "two children");
    t.same(content[0].name, "as", "first child name");
    t.same(content[0].attributes[root.content[0].name], "foo", "first child attribute value");
    t.equal(content[0].content, ["bar"], "first child content");
    t.equal(content[1], ["baz", "fum"], "second child (list)");
});

test("Parser: unquoting identifier", t => {
    const { root } = parse("{ f `x }");
    t.same(root.content.length, 1, "one child");
    const x = root.content[0];
    t.same(x.name, Backtick, "unquote special form");
    t.equal(x.content, ["x"], "with one argument");
});
