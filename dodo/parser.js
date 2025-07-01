import { nop } from "../lib/util.js";

const Token = {
    Space: Symbol.for("Space"),
    Open: Symbol.for("{"),
    CloseBrace: Symbol.for("}"),
    Attribute: Symbol.for("Attribute"),
    Value: Symbol.for("Value"),
    String: Symbol.for("String"),
    Tick: Symbol.for("Tick"),
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
    ContentCDATA: Symbol.for("Content/CDATA"),
    ContentCDATAWithSpace: Symbol.for("Content/CDATA/space"),
    Unquote: Symbol.for("Unquote"),
    List: Symbol.for("List"),
    ClosedList: Symbol.for("List/closed"),
};

// TODO
const addChild = nop;
const addText = nop;
const addTextWithSpace = nop;
const attributeName = nop;
const newElement = nop;
const setAttribute = nop;

const Transitions = new Map([
    [State.Begin, new Map([
        [Token.Space, [State.Begin, nop]],
        [Token.Open, [State.Empty, newElement]]
    ])],
    [State.Empty, new Map([
        [Token.Space, [State.Empty, nop]],
        [Token.Open, [State.Empty, newElement]],
        [Token.Close, [State.Content, stack => { stack.pop(); }]],
        [Token.Value, [State.Name, (stack, name) => { stack.at(-1).name = name }]],
        [Token.Attribute, [State.Attribute, attributeName]],
    ])],
    [State.Attribute, new Map([
        [Token.Space, [State.Attribute, nop]],
        [Token.String, [State.Name, setAttribute]],
        [Token.Value, [State.Name, setAttribute]],
        [Token.OpenCDATA, [State.AttributeCDATA, nop]]
    ])],
    [State.AttributeCDATA, new Map([
        [Token.CDATASection, [State.Name, setAttribute]]
    ])],
    [State.Name, new Map([
        [Token.Space, [State.Name, nop]],
        [Token.Open, [State.Empty, newElement]],
        [Token.Close, [State.Content, addChild]],
        [Token.Attribute, [State.Attribute, attributeName]],
        [Token.Tick, [State.Unquote, nop]],
        [Token.Text, [State.Content, addText]],
        [Token.OpenCDATA, [State.ContentCDATA, nop]],
    ])],
    [State.Content, new Map([
        [Token.Space, [State.ContentWithSpace, nop]],
        [Token.Open, [State.Empty, newElement]],
        [Token.Close, [State.Content, addChild]],
        [Token.Tick, [State.Unquote, nop]],
        [Token.Text, [State.Content, addText]],
        [Token.OpenCDATA, [State.ContentCDATA, nop]],
    ])],
    [State.ContentWithSpace, new Map([
        [Token.Space, [State.ContentWithSpace, nop]],
        [Token.Open, [State.Empty, function(stack) {
            stack.at(-1).content.push(" ");
            newElement.call(this, stack);
        }]],
        [Token.Close, [State.Content, addChild]],
        [Token.Tick, [State.Unquote, nop]],
        [Token.Text, [State.Content, addTextWithSpace]],
        [Token.OpenCDATA, [State.ContentCDATAWithSpace, nop]],
    ])],
    [State.ContentCDATA, new Map([
        [Token.CDATASection, [State.Content, addText]]
    ])],
    [State.ContentCDATAWithSpace, new Map([
        [Token.CDATASection, [State.ContentWithSpace, addTextWithSpace]]
    ])],
    [State.Unquote, new Map([
        [Token.Open, [State.List, stack => { stack.push([]); }]],
        [Token.Value, [State.Content, function(stack, value) {
            stack.at(-1).content.push(parseNumber(value) ?? get.call(this, value));
        }]],
    ])],
    [State.List, new Map([
        [Token.Space, [State.List, nop]],
        [Token.Open, [State.List, stack => { stack.push([]); }]],
        [Token.Close, [State.Content, stack => {
            const list = stack.pop();
            const top = stack.at(-1);
            if (top.content) {
                top.content.push(list);
            } else {
                top.push(list);
                return State.List;
            }
        }]],
        [Token.Value, [State.List, (stack, value) => {
            stack.at(-1).push(parseNumber(value) ?? value);
        }]],
    ])],
]);

class Parser {
    parse(input) {
        this.input = input;
        this.state = State.Begin;
        this.line = 1;

        const stack = [{ content: [] }];
        for (const [token, value] of this.tokens()) {
            const transitions = Transitions.get(this.state);
            if (!transitions.has(token)) {
                throw Error(`Parse error, line ${this.line}: unexpected token ${
                    Symbol.keyFor(token)
                }; expected one of ${
                    [...transitions.keys()].map(Symbol.keyFor).join(", ").replace(/, ([^,]+)$/, " or $1")
                }.`);
            }
            const [q, f] = transitions.get(token);
            this.state = f.call(this, stack, value) ?? q;
        }
        if (stack.length > 1) {
            throw new Error(`Parse error, line ${this.line}: unterminated element "${stack[1].name}".`);
        }
        if (stack[0].content.length === 0) {
            throw new Error(`Parse error, line ${this.line}: no content.`);
        }
        if (stack[0].content.length > 1) {
            throw new Error(`Parse error, line ${this.line}: extra content in document.`);
        }

        delete this.input;
        delete this.line;
        delete this.state;
        return stack[0].content[0];
    }

    *tokens() {
        while (this.input.length > 0) {
            const transitions = Transitions.get(this.state);

            if (transitions.has(Token.CDATASection)) {
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
                        yield [Token.Open];
                    }
                    break;
                case "}":
                    this.input = this.input.substring(1);
                    yield [Token.Close];
                    break;
                default:
                    if (transitions.has(Token.Tick)) {
                        const match = this.input.match(/^\u0060\S/);  // backtick
                        if (match) {
                            this.input = this.input.substring(1);
                            yield [Token.Tick];
                            break;
                        }
                    }
                    if (transitions.has(Token.String)) {
                        const match = this.input.match(/^"((?:[^"\\]|\\.)*)"/);
                        if (match) {
                            this.input = this.input.substring(match[0].length);
                            this.line += match[0].match(/\n/g)?.length ?? 0;
                            yield [Token.String, unescape(match[1])];
                            break;
                        }
                    }
                    if (transitions.has(Token.Attribute)) {
                        const match = this.input.match(/^((?:[^\s\{\}#\u0060:\\]|\\.)+):/s);
                        if (match) {
                            this.input = this.input.substring(match[0].length);
                            this.line += match[0].match(/\n/g)?.length ?? 0;
                            yield [Token.Attribute, unescape(match[1])];
                            break;
                        }
                    }
                    if (transitions.has(Token.Value)) {
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
    return new Parser().parse(text);
}

// Unescape string content.
const unescape = x => x.replace(/\\(.)/gs, "$1");
