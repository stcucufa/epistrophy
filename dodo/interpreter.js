import { show, typeOf } from "../lib/util.js";
import parse, { unparse, backtick } from "./parser.js";

const SpecialForm = Symbol.for("special form");

class Interpreter {
    constructor(document) {
        this.document = document;
    }

    run(text) {
        const { root } = this.document;
        if (root.name !== "seq" && root.name !== "conc") {
            throw Error(`Cannot interpret document: expected "seq" or "conc" at root, but got "${root.name}"`);
        }
        // FIXME 4O08 Dodo: seq
        // FIXME 4O09 Dodo: conc
        const environment = {
            define: SpecialForm,
            "set!": SpecialForm,
            unquote: SpecialForm,
            true: true,
            false: false,
            "+": (...args) => args.reduce((z, x) => z + x, 0),
            "-": (...args) => args.reduce((z, x) => z - x, 0),
            "*": (...args) => args.reduce((z, x) => z * x, 1),
            "/": (...args) => args.reduce((z, x) => z / x, 1),
        };
        let value;
        for (const expression of root.content) {
            value = this.eval(expression, environment);
        }
        return value;
    }

    eval(expression, environment) {
        if (typeof expression === "number" || typeof expression === "string" || Array.isArray(expression)) {
            return expression;
        } else if (expression && typeof expression === "object") {
            const { name, content } = expression;
            switch (name) {

                case backtick:
                case "unquote":
                    if (content.length === 1) {
                        const [varname] = content;
                        if (varname in environment) {
                            return environment[varname];
                        }
                        throw Error(`Undefined variable "${varname}"`);
                    }
                    throw Error(`Unexpected number of arguments for unquote (expected 1 but got ${content.length})`);

                case "set!":
                case "define":
                    if (content.length === 2) {
                        const [varname, value] = content;
                        if (typeof varname !== "string") {
                            throw Error(`Unexpected variable name for ${name} (expected string but got ${unparse(varname)})`);
                        }
                        if (name === "set!" && !(varname in environment)) {
                            throw Error(`Undefined variable "${varname}"`);
                        } else if (name === "define" && Object.hasOwn(environment, varname)) {
                            throw Error(`Variable ${varname} is already defined in this scope`);
                        }
                        const evaluatedValue = this.eval(value, environment);
                        environment[varname] = evaluatedValue;
                        return evaluatedValue;
                    }
                    throw Error(`Unexpected number of arguments for ${name} (expected 2 but got ${content.length})`);

                case "if":
                    if (content.length === 3) {
                        const [predicate, consequent, alternate] = content;
                        if (this.eval(predicate, environment) === false) {
                            return this.eval(alternate, environment);
                        }
                        return this.eval(consequent, environment);
                    }
                    throw Error(`Unexpected number of arguments for ${name} (expected 3 but got ${content.length})`);

                default:
                    // Application
                    if (!(name in environment)) {
                        throw Error(`Undefined variable ${name}`);
                    }
                    const f = environment[name];
                    if (typeof f !== "function") {
                        throw Error(`Cannot apply a non-function value (expected a function, got ${typeOf(f)})`);
                    }
                    const args = content.map(x => this.eval(x, environment));
                    return f(...args);

            }
        } else {
            throw Error(`Unexpected expression of type ${show(expression)}`);
        }
    }
}

export default function run(text) {
    return new Interpreter(parse(text)).run();
}
