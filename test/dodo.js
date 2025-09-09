import test from "./test.js";
import parse, { Backtick, Space, consolidateText } from "../dodo/parser.js";
import run from "../dodo/interpreter.js";

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
    t.skip("2L0M Dodo: more attributes");
    const { root } = parse("{ constant e: `2.718281828459045 }");
    t.equal(root.attributes, { e: 2.718281828459045 }, "number value");
});

test("Parser: list attributes", t => {
    t.skip("2L0M Dodo: more attributes");
    const { root } = parse("{ constants `{ 1 2 3 }");
    t.equal(root.attributes, { constants: [1, 2, 3] }, "list value");
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

// 4P08 Dodo: whitespace review

test("Parser: verbatim attribute", t => {
    const { root } = parse(`{ p foo: """{ bar: "baz" }""" }`);
    t.equal(root.attributes, { foo: `{ bar: "baz" }` });
});

test("Parser: string in content", t => {
    const { root } = parse(`{ p " Hello, world! " (a string) }`);
    t.equal(root.content, [new String(" Hello, world! "), Space, "(a", Space, "string)"],
        "is a content element of its own");
    t.equal(consolidateText(root.content), [" Hello, world!  (a string)"], "consolidated");
});

test("Parser: verbatim string in content", t => {
    const { root } = parse(`{ p """"Hello, world!"""" (a string within a string) }`);
    t.equal(consolidateText(root.content), [`"Hello, world!" (a string within a string)`], "consolidated");
});

// 2K05 Dodo: eval

test("Interpreter: self-evaluating expression", t => {
    t.same(run("{ seq `17 }"), 17, "number");
});

test("Interpreter: self-evaluating expression", t => {
    t.skip("4V05 Dodo: update whitespace handling in interpreter");
    t.same(run("{ seq Hello, world! }"), "Hello, world!", "text");
});

test("Interpreter: variable", t => {
    t.typeof(run("{ seq `unquote }"), "symbol", "defined variable");
    t.true(run("{ seq `true }"), "true variable");
    t.same(run("{ seq `false }"), false, "false variable");
});

test("Interpreter: undefined variable error", t => {
    t.throws(() => run("{ seq `foo }"), "throws");
});

test("Interpreter: unquote special form", t => {
    t.same(run("{ seq `unquote }"), run("{ unquote unquote }"), "{ unquote x } ≡ `x");
    t.throws(() => run("{ unquote }"), "accepts only a single argument (zero arguments)");
    t.throws(() => run("{ unquote foo bar baz }"), "accepts only a single argument (too many)");
});

test("Interpreter: set! special form", t => {
    t.skip("4V05 Dodo: update whitespace handling in interpreter");
    t.same(run("{ set! set! `23 }"), 23, "returns the new value");
    t.same(run("{ seq { set! set! `23 } `set! }"), 23, "after setting it");
    t.throws(() => run("{ set! x `23 }"), "can only set the value of a defined variable");
    t.throws(() => run("{ set! `set! `23 }"), "variable name must be a string");
});

test("Interpreter: define special form", t => {
    t.skip("4V05 Dodo: update whitespace handling in interpreter");
    t.same(run("{ define x `23 }"), 23, "returns the new value");
    t.same(run("{ seq { define x `23 } `x }"), 23, "after setting it");
    t.throws(() => run("{ seq { define x `23 } { define x `17 } }"), "cannot redefine a value in the same scope");
    t.throws(() => run("{ define `x `23 }"), "variable name must be a string");
});

test("Interpeter: if special form", t => {
    t.skip("4V05 Dodo: update whitespace handling in interpreter");
    t.same(run("{ if `true `23 ko }"), 23, "predicate is true");
    t.same(run("{ if false `23 ko }"), 23, "predicate is truthy (false as string)");
    t.same(run("{ if `0 `23 ko }"), 23, "predicate is truthy (0)");
    t.same(run("{ if `{} `23 ko }"), 23, "predicate is truthy (empty list)");
    t.same(run("{ if `false ko `23 }"), 23, "predicate is false");
});

test("Interpreter: application", t => {
    t.skip("4V05 Dodo: update whitespace handling in interpreter");
    t.same(run("{ + `17 `23 `19 }"), 59, "+ (with arguments)");
    t.same(run("{ * }"), 1, "* (no argument)");
    t.throws(() => { run("{ ??? foo bar }"); }, "undefined value");
    t.throws(() => { run("{ seq { define f `23 } { f `17 } }"); }, "not a function");
});

test("Interpreter: lambda special form", t => {
    t.skip("4V05 Dodo: update whitespace handling in interpreter");
    t.typeof(run("{ lambda `{ x } { + `x `1 } }"), "function", "creates a function");
    t.typeof(run("{ λ x { + `x `1 } }"), "function", "short form (λ, single parameter)");
    t.same(run("{ { λ x { + `x `1 } } `17 }"), 18, "may be applied");
    t.same(run("{ seq { define !- { lambda `{ x y } { - `y `x } } } { !- `17 `23 } }"), 6, "define and call with arguments");
});

test("Interpreter: define for functions", t => {
    t.skip("4V05 Dodo: update whitespace handling in interpreter");
    t.same(run("{ seq { define incr `{ x } { + `1 `x } } { incr `23 } }"), 24, "single parameter");
    t.same(run("{ seq { define !- `{ x y } { - `y `x } } { !- `17 `23 } }"), 6, "multiple parameters");
});
