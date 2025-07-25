import { I, K, show, typeOf } from "../lib/util.js";
import parse from "./parser.js";

const Builtins = {
    I: [1, 1, I],
    "+": [0, Infinity, (args, n) => n === 0 ? [["push", 0]] : n === 1 ? args : [...args, ["add", n]]],
    "*": [0, Infinity, (args, n) => n === 0 ? [["push", 1]] : n === 1 ? args : [...args, ["mul", n]]],
};

function generate(expression) {
    if (typeof expression === "number" || typeof expression === "string" || Array.isArray(expression)) {
        return [["push", expression]];
    }
    if (expression && typeof expression === "object") {
        const { name, content } = expression;
        if (typeof name === "string") {
            if (name in Builtins) {
                const [min, max, op] = Builtins[name];
                const n = content.length;
                if (n < min || n > max) {
                    throw Error(`Wrong number of arguments for ${name}: got ${n}, expected ${min}${
                        min === max ? "" : ` to ${max}`
                    }`);
                }
                return op(content.flatMap(generate), n);
            }
        }
        throw Error(`Unexpected expression ${show(expression)}`);
    }
    throw Error(`Unexpected expression of type ${typeOf(expression)}`);
}

export default function compile(text) {
    return generate(parse(text).root);
}
