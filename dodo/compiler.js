import { I, K, show, typeOf } from "../lib/util.js";
import parse, { backtick } from "./parser.js";

const Builtins = {

    // Sync ops
    I: [1, 1, I],
    "+": [0, Infinity, (args, n) => n === 0 ? [["push", 0]] : n === 1 ? args : [...args, ["add", n]]],
    "-": [1, Infinity, (args, n) => n === 1 ? [...args, ["neg"]] : [...args, ["sub", n]]],
    "*": [0, Infinity, (args, n) => n === 0 ? [["push", 1]] : n === 1 ? args : [...args, ["mul", n]]],
    "/": [1, Infinity, (args, n) => n === 1 ? [...args, ["inv"]] : [...args, ["div", n]]],

    not: [1, 1, args => [...args, ["not"]]],
    "=": [2, Infinity, (args, n) => [...args, ["eq", n]]],
    ">=": [2, Infinity, (args, n) => [...args, ["ge", n]]],
    ">": [2, Infinity, (args, n) => [...args, ["gt", n]]],
    "<=": [2, Infinity, (args, n) => [...args, ["le", n]]],
    "<": [2, Infinity, (args, n) => [...args, ["lt", n]]],
    "!=": [2, Infinity, (args, n) => [...args, ["ne", n]]],

};

function generate(expression, scope) {
    if (typeof expression === "number" || typeof expression === "string" || Array.isArray(expression)) {
        return [["push", expression]];
    }
    if (expression && typeof expression === "object") {
        const { name, content: raw } = expression;
        const content = raw.map(x => x.trim?.() ?? x).filter(x => typeof x !== "string" || /\S/.test(x));
        const n = content.length;
        switch (name) {

            case backtick:
            case "unquote":
                if (n !== 1) {
                    throw Error(`Wrong number of arguments for unquote: got ${n}, expected 1`);
                }
                const [varname] = content;
                if (!(varname in scope)) {
                    throw Error(`Undefined variable "${varname}"`);
                }
                const entry = scope[varname];
                return typeof entry === "number" ? [["load", entry]] :
                    [["push", Array.isArray(entry) ? { builtin: entry } : entry]];

            case "if":
                if (n !== 3) {
                    throw Error(`Wrong number of arguments for if: got ${n}, expected 3`);
                }
                const [predicate, consequent, alternate] = content;
                let ops = generate(predicate, scope);
                const jf = ops.length;
                ops.push(["jf"]);
                ops = ops.concat(generate(consequent, scope));
                const jump = ops.length;
                ops.push(["j"]);
                ops = ops.concat(generate(alternate, scope));
                ops[jf][1] = jump - jf;
                ops[jump][1] = ops.length - jump - 1;
                return ops;

            case "lambda":
            case "λ":
                if (content.length !== 2) {
                    throw Error(`Unexpected number of arguments for ${name} (expected 2 but got ${content.length})`);
                }
                const [args, body] = content;
                // FIXME Allow unary shortcut: { λ: x { + `x `1 } }
                if (!Array.isArray(args) || args.some(x => typeof x !== "string")) {
                    throw Error(`Expected a list of names as first parameter of ${name}`);
                }
                const locals = args.reduce((locals, arg, i) => {
                    if (Object.hasOwn(locals, arg)) {
                        throw Error(`Argument "${arg}" is already declared in lambda`);
                    }
                    locals[arg] = i;
                    return locals;
                }, Object.create(scope));
                return [{ arity: args.length, body: generate(body, locals) }];

            default:
                if (typeof name === "string") {
                    if (name in scope) {
                        const [min, max, op] = scope[name];
                        const n = content.length;
                        if (n < min || n > max) {
                            throw Error(`Wrong number of arguments for ${name}: got ${n}, expected ${min}${
                                min === max ? "" : ` to ${max}`
                            }`);
                        }
                        return op(content.flatMap(arg => generate(arg, scope)), n);
                    }
                }
                throw Error(`Unexpected expression ${show(expression)}`);

        }
    }
    throw Error(`Unexpected expression of type ${typeOf(expression)}`);
}

export default function compile(text) {
    return generate(parse(text).root, Builtins);
}
