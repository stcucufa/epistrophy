const Token = {
    Space: Symbol.for("Space"),
    OpenBrace: Symbol.for("{"),
    CloseBrace: Symbol.for("}"),
    Attribute: Symbol.for("Attribute"),
    Value: Symbol.for("Value"),
    String: Symbol.for("String"),
    Backtick: Symbol.for("`"),
    Text: Symbol.for("Text"),
    OpenCDATA: Symbol.for("{:"),
    CDATASection: Symbol.for(":}"),
};

const State = {
    Begin: Symbol.for("Begin"),
    Empty: Symbol.for("Empty"),
    Attribute: Symbol.for("Attribute"),
    AttributeCDATA: Symbol.for("Attribute/CDATA"),
    Name: Symbol.for("Name"),
    Content: Symbol.for("Content"),
    ContentWithSpace: Symbol.for("Content/space"),
    ContentCDATA: Symbol.for("CDATA"),
    ContentCDATAWithSpace: Symbol.for("CDATA/space"),
    Unquote: Symbol.for("Unquote"),
    List: Symbol.for("List"),
    ClosedList: Symbol.for("List/closed"),
};

function addChild(stack) {
    const child = stack.pop();
    if (stack.length === 0) {
        throw Error(`Parse error, line ${this.line}: root element is already closed.`);
    }
    stack.at(-1).content.push(child);
}

function addText(stack, value) {
    stack.at(-1).content.push(value);
}

function addTextWithSpace(stack, value) {
    addText(stack, stack.at(-1).content.length === 0 ? value : ` ${value}`);
}

function attributeName(stack, value) {
    stack.pendingAttributeName = value;
}

function newElement(stack) {
    stack.push(this.createElement());
}

function newList(stack) {
    stack.push([]);
}

function parseNumber(value) {
    const match = value.match(/^[+-]?\d+(\.\d+)?$/);
    if (match) {
        return parseFloat(value);
    }
}

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

// Unescape string content.
const unescape = x => x.replace(/\\(.)/gs, "$1");

function unquote(value) {
    const n = this.createElement(Token.Backtick);
    n.content.push(value);
    return n;
}

const Transitions = {
    [State.Begin]: {
        [Token.Space]: [State.Begin],
        [Token.OpenBrace]: [State.Empty, newElement]
    },
    [State.Empty]: {
        [Token.Space]: [State.Empty],
        [Token.OpenBrace]: [State.Empty, newElement],
        [Token.CloseBrace]: [State.Content, stack => { stack.pop(); }],
        [Token.Value]: [State.Name, (stack, name) => { stack.at(-1).name = name }],
        [Token.Attribute]: [State.Attribute, attributeName],
    },
    [State.Attribute]: {
        [Token.Space]: [State.Attribute],
        [Token.String]: [State.Name, setAttribute],
        [Token.Value]: [State.Name, setAttribute],
        [Token.OpenCDATA]: [State.AttributeCDATA]
    },
    [State.AttributeCDATA]: {
        [Token.CDATASection]: [State.Name, setAttribute]
    },
    [State.Name]: {
        [Token.Space]: [State.Name],
        [Token.OpenBrace]: [State.Empty, newElement],
        [Token.CloseBrace]: [State.Content, addChild],
        [Token.Attribute]: [State.Attribute, attributeName],
        [Token.Backtick]: [State.Unquote],
        [Token.Text]: [State.Content, addText],
        [Token.OpenCDATA]: [State.ContentCDATA],
    },
    [State.Content]: {
        [Token.Space]: [State.ContentWithSpace],
        [Token.OpenBrace]: [State.Empty, newElement],
        [Token.CloseBrace]: [State.Content, addChild],
        [Token.Backtick]: [State.Unquote],
        [Token.Text]: [State.Content, addText],
        [Token.OpenCDATA]: [State.ContentCDATA],
    },
    [State.ContentWithSpace]: {
        [Token.Space]: [State.ContentWithSpace],
        [Token.OpenBrace]: [State.Empty, function(stack) {
            stack.at(-1).content.push(" ");
            newElement.call(this, stack);
        }],
        [Token.CloseBrace]: [State.Content, addChild],
        [Token.Backtick]: [State.Unquote],
        [Token.Text]: [State.Content, addTextWithSpace],
        [Token.OpenCDATA]: [State.ContentCDATAWithSpace],
    },
    [State.ContentCDATA]: {
        [Token.CDATASection]: [State.Content, addText]
    },
    [State.ContentCDATAWithSpace]: {
        [Token.CDATASection]: [State.ContentWithSpace, addTextWithSpace]
    },
    [State.Unquote]: {
        [Token.OpenBrace]: [State.List, newList],
        [Token.Value]: [State.Content, function(stack, value) {
            stack.at(-1).content.push(parseNumber(value) ?? unquote.call(this, value));
        }],
    },
    [State.List]: {
        [Token.Space]: [State.List],
        [Token.OpenBrace]: [State.List, newList],
        [Token.CloseBrace]: [State.Content, stack => {
            const list = stack.pop();
            const top = stack.at(-1);
            if (top.content) {
                top.content.push(list);
            } else {
                top.push(list);
                return State.List;
            }
        }],
        [Token.Value]: [State.List, (stack, value) => {
            stack.at(-1).push(parseNumber(value) ?? value);
        }],
    },
};

class Parser {
    constructor(document) {
        this.document = document;
    }

    createElement(name) {
        return { document: this.document, name, attributes: {}, content: [] };
    }

    parse() {
        this.input = this.document.text;
        this.state = State.Begin;
        this.line = 1;

        const stack = [{ content: [] }];
        for (const [token, value] of this.tokens()) {
            const transitions = Transitions[this.state];
            if (!Object.hasOwn(transitions, token)) {
                throw Error(`Parse error, line ${this.line}: unexpected token ${
                    Symbol.keyFor(token)
                }; expected one of ${
                    [...transitions.keys()].map(Symbol.keyFor).join(", ").replace(/, ([^,]+)$/, " or $1")
                }.`);
            }
            const [q, f] = transitions[token];
            this.state = f?.call(this, stack, value) ?? q;
        }
        if (stack.length > 1) {
            throw Error(`Parse error, line ${this.line}: unterminated element "${stack[1].name}".`);
        }
        if (stack[0].content.length === 0) {
            throw Error(`Parse error, line ${this.line}: no content.`);
        }
        if (stack[0].content.length > 1) {
            throw Error(`Parse error, line ${this.line}: extra content in document.`);
        }

        delete this.input;
        delete this.line;
        delete this.state;
        this.document.root = stack[0].content[0];
        return this.document;
    }

    *tokens() {
        while (this.input.length > 0) {
            const transitions = Transitions[this.state];

            if (Object.hasOwn(transitions, Token.CDATASection)) {
                const match = this.input.match(/^((?:[^:]|:[^}])*):}/);
                if (!match) {
                    throw Error(`Unterminated CDATA section starting at ${this.line}: "${this.input}"`);
                }
                this.line += match[0].match(/\n/g)?.length ?? 0;
                this.input = this.input.substring(match[0].length);
                yield [Token.CDATASection, match[1]];
            }

            const match = this.input.match(/^\s+/);
            if (match) {
                this.line += match[0].match(/\n/g)?.length ?? 0;
                this.input = this.input.substring(match[0].length);
                yield [Token.Space, match[0]];
                continue;
            }

            switch (this.input[0]) {
                case "#":
                    this.input = this.input.replace(/.*\n/, "");
                    this.line += 1;
                    break;
                case "{":
                    if (this.input[1] === ":") {
                        this.input = this.input.substring(2);
                        yield [Token.OpenCDATA];
                    } else {
                        this.input = this.input.substring(1);
                        yield [Token.OpenBrace];
                    }
                    break;
                case "}":
                    this.input = this.input.substring(1);
                    yield [Token.CloseBrace];
                    break;
                default:
                    if (Object.hasOwn(transitions, Token.Backtick)) {
                        const match = this.input.match(/^\u0060\S/);
                        if (match) {
                            this.input = this.input.substring(1);
                            yield [Token.Backtick];
                            break;
                        }
                    }
                    if (Object.hasOwn(transitions, Token.String)) {
                        const match = this.input.match(/^"((?:[^"\\]|\\.)*)"/);
                        if (match) {
                            this.input = this.input.substring(match[0].length);
                            this.line += match[0].match(/\n/g)?.length ?? 0;
                            yield [Token.String, unescape(match[1])];
                            break;
                        }
                    }
                    if (Object.hasOwn(transitions, Token.Attribute)) {
                        const match = this.input.match(/^((?:[^\s\{\}#\u0060:\\]|\\.)+):/s);
                        if (match) {
                            this.input = this.input.substring(match[0].length);
                            this.line += match[0].match(/\n/g)?.length ?? 0;
                            yield [Token.Attribute, unescape(match[1])];
                            break;
                        }
                    }
                    if (Object.hasOwn(transitions, Token.Value)) {
                        const match = this.input.match(/^((?:[^\s\{\}#\u0060\\]|\\.)+)/s);
                        if (match) {
                            this.input = this.input.substring(match[0].length);
                            this.line += match[0].match(/\n/g)?.length ?? 0;
                            yield [Token.Value, unescape(match[1])];
                            break;
                        } else {
                            throw Error(`Parse error, line ${this.line}: ill-formed attribute value`);
                        }
                    } else {
                        const match = this.input.match(
                            /^([^\\\s\{\}#\u0060]|\\.)+(\s+([^\\\s\{\}#\u0060]|\\.)+)*/s
                        );
                        if (match) {
                            this.input = this.input.substring(match[0].length);
                            this.line += match[0].match(/\n/g)?.length ?? 0;
                            yield [Token.Text, unescape(match[0])];
                            break;
                        } else {
                            throw Error(`Parse error, line ${this.line}: ill-formed text`);
                        }
                    }
            }
        }
    }
}

export default function parse(text) {
    return new Parser({ text }).parse();
}
