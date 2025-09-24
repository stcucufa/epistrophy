export const Backtick = Symbol.for("Backtick");
export const Space = Symbol.for("Space");

// Token types.
const Token = {
    Backtick,
    Space,
    OpenBrace: Symbol.for("Opening brace"),
    CloseBrace: Symbol.for("Closing brace"),
    Attribute: Symbol.for("Attribute"),
    String: Symbol.for("String"),
    Word: Symbol.for("Word"),
};

// Parser states.
const State = {
    Begin: Symbol.for("Begin"),
    OpenElement: Symbol.for("Empty element"),
    ElementHead: Symbol.for("Element head"),
    ElementContent: Symbol.for("Element content"),
    ElementContentWithTrailingSpace: Symbol.for("Element content with trailing space"),
    ElementAttribute: Symbol.for("Element attribute"),
    UnquoteAttribute: Symbol.for("Unquote attribute"),
    Unquote: Symbol.for("Unquote"),
    List: Symbol.for("List"),
};

// Parser state machine transitions: given a state and a token, move to a new
// state, and execute some related action, if any. Missing transitions are
// parse errors.
const Transitions = {

    // Beginning of the document: expect an element, skipping whitespace until
    // an opening brace is reached.
    [State.Begin]: {
        [Token.Space]: [State.Begin],
        [Token.OpenBrace]: [State.OpenElement, pushNewElement]
    },

    // Open element: expect a name or attribute after the opening brace, or
    // another opening brace (anonymous element, without name or attributes).
    [State.OpenElement]: {
        [Token.Space]: [State.OpenElement],
        [Token.OpenBrace]: [State.OpenElement, pushNewElement],
        [Token.Word]: [State.ElementHead, (stack, name) => { stack.at(-1).name = name }],
        [Token.Attribute]: [State.ElementAttribute, setAttributeName],
    },

    // Reading the attributes of a named element, waiting for content (word,
    // string, or element).
    [State.ElementHead]: {
        [Token.Space]: [State.ElementHead],
        [Token.OpenBrace]: [State.OpenElement, pushNewElement],
        [Token.CloseBrace]: [State.ElementContent, addChild],
        [Token.Attribute]: [State.ElementAttribute, setAttributeName],
        [Token.Backtick]: [State.Unquote],
        [Token.String]: [State.ElementContent, addString],
        [Token.Word]: [State.ElementContent, addWord],
    },

    // Attribute: an attribute name (with a : suffix) was read, to be followed
    // by a value for the attribute.
    [State.ElementAttribute]: {
        [Token.Space]: [State.ElementAttribute],
        [Token.String]: [State.ElementHead, setAttribute],
        [Token.Word]: [State.ElementHead, setAttribute],
        [Token.Backtick]: [State.UnquoteAttribute],
    },

    // Unquote attribute: either a list or a number (any other unquoted token
    // is an error).
    [State.UnquoteAttribute]: {
        [Token.OpenBrace]: [State.List, pushNewList],
        [Token.Word]: [State.ElementHead, function(stack, value) {
            const number = parseNumber(value);
            if (!number) {
                throw SyntaxError(`Parse error, line ${this.line}: expected an unquoted number for attribute ${
                    stack.pendingAttributeName
                }`);
            }
            setAttribute(stack, parseNumber(value) ?? value);
        }],
    },

    // Element content: the head is complete, so add content (words, strings,
    // and other elements).
    [State.ElementContent]: {
        [Token.Space]: [State.ElementContentWithTrailingSpace],
        [Token.OpenBrace]: [State.OpenElement, pushNewElement],
        [Token.CloseBrace]: [State.ElementContent, addChild],
        [Token.Backtick]: [State.Unquote],
        [Token.String]: [State.ElementContent, addString],
        [Token.Word]: [State.ElementContent, addWord],
    },

    // Element content with a trailing space. Do not add a trailing space at
    // the end of an element, but add space between non-space content.
    [State.ElementContentWithTrailingSpace]: {
        [Token.Space]: [State.ElementContentWithTrailingSpace],
        [Token.OpenBrace]: [State.OpenElement, addSpace, pushNewElement],
        [Token.CloseBrace]: [State.ElementContent, addChild],
        [Token.Backtick]: [State.Unquote, addSpace],
        [Token.String]: [State.ElementContent, addSpace, addString],
        [Token.Word]: [State.ElementContent, addSpace, addWord],
    },

    // Unquote content. Lists or numbers are treated specially, otherwise an
    // unquote element is added.
    [State.Unquote]: {
        [Token.OpenBrace]: [State.List, pushNewList],
        [Token.Word]: [State.ElementContent, function(stack, value) {
            stack.at(-1).content.push(parseNumber(value) ?? unquote.call(this, value));
        }],
    },

    // Read a list, which may contain numbers, single values, strings, and
    // other lists.
    [State.List]: {
        [Token.Space]: [State.List],
        [Token.OpenBrace]: [State.List, pushNewList],
        [Token.CloseBrace]: [State.ElementContent, stack => {
            const list = stack.pop();
            if (stack.pendingAttributeName) {
                return setAttribute(stack, list);
            }
            const top = stack.at(-1);
            if (top.content) {
                top.content.push(list);
            } else {
                top.push(list);
                return State.List;
            }
        }],
        [Token.String]: [State.List, (stack, value) => { stack.at(-1).push(value); }],
        [Token.Word]: [State.List, (stack, value) => { stack.at(-1).push(parseNumber(value) ?? value); }],
    },
};

// Pop the last element from the stack and add it as a child of the element now
// at the top.
function addChild(stack) {
    const child = stack.pop();
    if (stack.length === 0) {
        throw SyntaxError(`Parse error, line ${this.line}: root element is already closed.`);
    }
    stack.at(-1).content.push(child);
}

// Add a Word (string value) as is to the current element.
function addWord(stack, value) {
    stack.at(-1).content.push(value);
}

// Add a String object to the current element (creating a new String object to
// differentiate from plain text).
function addString(stack, string) {
    stack.at(-1).content.push(new String(string));
}

// Add space to the current element.
function addSpace(stack) {
    stack.at(-1).content.push(Space);
}

// Create a pending attribute with a name in the stack; it should be followed
// by a value so that the attribute can be set for the top element.
function setAttributeName(stack, value) {
    stack.pendingAttributeName = value;
}

// Push a new element to the stack.
function pushNewElement(stack) {
    stack.push(this.createElement());
}

// Push a new list to the stack.
function pushNewList(stack) {
    stack.push([]);
}

// Parse a number. Return nothing if the number is not formatted correctly.
// FIXME 3I02 Dodo: Binary numbers
// FIXME 3I03 Dodo: Hexadecimal numbers
// FIXME 3I04 Dodo: Scientific notation for numbers
export function parseNumber(value) {
    const match = value.match(/^[+-]?\d+(\.\d+)?$/);
    if (match) {
        return parseFloat(value);
    }
}

// Set an attribute (which now has a value) on the top element. Use it as a
// name (default attribute) if the element still does not have one.
function setAttribute(stack, value) {
    const element = stack.at(-1);
    const name = stack.pendingAttributeName;
    delete stack.pendingAttributeName;
    if (element.name) {
        element.attributes[name] = value;
    } else {
        element.name = name;
        element.attributes[name] = value;
    }
}

// Unescape string content; \n and \t are replaced by newline and tab; other
// escaped characters are replaced by themselves (including actual newlines).
const unescape = x => x.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\(.)/gs, "$1");

// Create a special unquote element from a backtick.
function unquote(value) {
    const n = this.createElement();
    n.name = Token.Backtick;
    n.content.push(value);
    return n;
}

class Parser {

    // Create a parser for a given document (which only has unparsed text so
    // far).
    constructor(document) {
        this.document = document;
    }

    // Create a new element within the current document.
    createElement(name) {
        return { document: this.document, attributes: {}, content: [] };
    }

    // Parse the input text into a tree, keeping a stack of currently open
    // elements. Follow the parser state machine transitions for each
    // subsequent token, updating the stack along the way.
    parse() {
        this.input = this.document.text;
        this.state = State.Begin;
        this.line = 1;

        const stack = [{ content: [] }];
        for (const [token, value] of this.tokens()) {
            const transitions = Transitions[this.state];
            if (!Object.hasOwn(transitions, token)) {
                throw SyntaxError(`Parse error, line ${this.line}: unexpected token ${
                    Symbol.keyFor(token)
                }; expected one of ${
                    [...Object.getOwnPropertySymbols(transitions)].map(Symbol.keyFor).join(", ").
                        replace(/, ([^,]+)$/, " or $1")
                }.`);
            }
            const [q, ...fs] = transitions[token];
            for (const f of fs) {
                f.call(this, stack, value);
            }
            this.state = q;
        }
        if (stack.length > 1) {
            throw SyntaxError(`Parse error, line ${this.line}: unterminated element "${stack[1].name}".`);
        }
        if (stack[0].content.length === 0) {
            throw SyntaxError(`Parse error, line ${this.line}: no content.`);
        }
        if (stack[0].content.length > 1) {
            throw SyntaxError(`Parse error, line ${this.line}: extra content in document.`);
        }

        delete this.input;
        delete this.line;
        delete this.state;
        this.document.root = stack[0].content[0];
        return this.document;
    }

    // Generate tokens from the input text, yielding every time a new token
    // was recognized.
    *tokens() {
        while (this.input.length > 0) {
            const transitions = Transitions[this.state];

            const match = this.input.match(/^\s+/);
            if (match) {
                this.line += match[0].match(/\n/g)?.length ?? 0;
                this.input = this.input.substring(match[0].length);
                yield [Token.Space];
                continue;
            }

            switch (this.input[0]) {
                case "#":
                    this.input = this.input.replace(/.*\n/, "");
                    this.line += 1;
                    yield [Token.Space];
                    break;
                case "{":
                    this.input = this.input.substring(1);
                    yield [Token.OpenBrace];
                    break;
                case "}":
                    this.input = this.input.substring(1);
                    yield [Token.CloseBrace];
                    break;
                default:
                    // Unquote (`foo); \u0060 = `
                    let match = this.input.match(/^\u0060\S/);
                    if (match) {
                        this.input = this.input.substring(1);
                        yield [Token.Backtick];
                        break;
                    }
                    // Verbatim ("""Whatever "content""""), no escaping inside)
                    // Matching the end is a bit messy because we want to allow
                    // " at the end of a verbatim string, but not overmatch if
                    // there are more than one verbatim strings.
                    match = this.input.match(/^\u0022{3}(.*?)(\u0022*)\u0022{3}/s);
                    if (match) {
                        this.input = this.input.substring(match[0].length);
                        this.line += match[0].match(/\n/g)?.length ?? 0;
                        yield [Token.String, match[1] + match[2]];
                        break;
                    }
                    // String ("Hello, world!"); \u0022 = "
                    match = this.input.match(/^"((?:[^\u0022\\\n]|\\.)*)"/s);
                    if (match) {
                        this.input = this.input.substring(match[0].length);
                        this.line += match[0].match(/\n/g)?.length ?? 0;
                        yield [Token.String, unescape(match[1])];
                        break;
                    }
                    // Attribute (foo:)
                    if (Object.hasOwn(transitions, Token.Attribute)) {
                        match = this.input.match(/^((?:[^\s\{\}#\u0022\u0060:\\]|\\.)+):/s);
                        if (match) {
                            this.input = this.input.substring(match[0].length);
                            this.line += match[0].match(/\n/g)?.length ?? 0;
                            yield [Token.Attribute, unescape(match[1])];
                            break;
                        }
                    }
                    // Word (does not start with {}`"#, and does not contain
                    // unescaped space.
                    match = this.input.match(/^((?:[^\s\{\}#\u0022\u0060\\]|\\.)+)/s);
                    if (match) {
                        this.input = this.input.substring(match[0].length);
                        this.line += match[0].match(/\n/g)?.length ?? 0;
                        yield [Token.Word, unescape(match[1])];
                        break;
                    }
                    throw SyntaxError(`Parse error, line ${this.line}: ill-formed text`);
            }
        }
    }
}

// Parse a complete document and return a document object with the input `text`
// and the `root` of the tree of elements.
export default function parse(text) {
    return new Parser({ text }).parse();
}

// Unparse the tree into text. This is just a stub at the moment.
// FIXME 4O0A Dodo: unparse
export function unparse(element) {
    return `{ ${element.name} ... }`;
}

// Consolidate text content into single string values, rendering space as a
// single space character (\u0020). Non-text content is kept as is.
export const consolidateText = content => content.reduce((content, value) => {
    const n = content.length - 1;
    if (typeof content[n] === "string") {
        if (value === Space) {
            content[n] += " ";
        } else if (typeof value === "string") {
            content[n] += value;
        } else if (value instanceof String) {
            content[n] += value.valueOf();
        } else {
            content.push(value);
        }
    } else {
        content.push(value === Space ? " " : value instanceof String ? value.valueOf() : value);
    }
    return content;
}, []);
