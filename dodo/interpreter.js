import { show, typeOf } from "../lib/util.js";
import parse, { unparse, Backtick } from "./parser.js";

const SpecialForm = Symbol.for("special form");

class Interpreter {
    constructor(document) {
        this.document = document;
    }

    run(text) {
        const { root } = this.document;
        const environment = {
            define: SpecialForm,
            "set!": SpecialForm,
            unquote: SpecialForm,
            seq: SpecialForm,
            true: true,
            false: false,
            "+": (_, ...args) => args.reduce((z, x) => z + x, 0),
            "-": (_, z, ...args) => args.length === 0 ? -z : args.reduce((z, x) => z - x, z),
            "*": (_, ...args) => args.reduce((z, x) => z * x, 1),
            "/": (_, z, ...args) => args.length === 0 ? 1 / z : args.reduce((z, x) => z / x, z),
        };
        return this.eval(root, environment);
    }

    eval(expression, environment) {
        if (typeof expression === "number" || typeof expression === "string" || Array.isArray(expression)) {
            return expression;
        } else if (expression && typeof expression === "object") {
            const { name, content: raw } = expression;
            const content = raw.filter(x => typeof x !== "string" || /\S/.test(x));
            switch (name) {

                case Backtick:
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
                    } else if (name === "define" && content.length === 3) {
                        const [varname, ...lambda] = content;
                        return this.eval({ name, content: [varname, { name: "lambda", content: lambda }] }, environment);
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

                case "seq":
                    // FIXME 4O08 Dodo: seq
                    let value;
                    for (const x of content) {
                        value = this.eval(x, environment);
                    }
                    return value;

                case "lambda":
                case "λ": {
                    if (content.length !== 2) {
                        throw Error(`Unexpected number of arguments for ${name} (expected 2 but got ${content.length})`);
                    }
                    const [args, body] = content;
                    const params = typeof args === "string" ? [args] : args;
                    if (!Array.isArray(params) || params.some(x => typeof x !== "string")) {
                        throw Error(`Expected a name or list of names as first parameter of ${name}`);
                    }
                    return function(environment, ...args) {
                        const n = args.length;
                        if (n !== params.length) {
                            throw Error("Unexpected number of arguments");
                        }
                        const env = Object.create(environment);
                        for (let i = 0; i < n; ++i) {
                            env[params[i]] = args[i];
                        }
                        return this.eval(body, env);
                    };
                    break;
                }

                default:
                    // Application
                    if (typeof name === "string") {
                        if (!(name in environment)) {
                            throw Error(`Undefined variable ${name}`);
                        }
                        const f = environment[name];
                        return this.apply(f, content, environment);
                    }
                    const [f, ...args] = content;
                    return this.apply(this.eval(f, environment), args, environment);

            }
        } else {
            throw Error(`Unexpected expression of type ${show(expression)}`);
        }
    }

    apply(f, content, environment) {
        if (typeof f !== "function") {
            throw Error(`Cannot apply a non-function value (expected a function, got ${typeOf(f)})`);
        }
        const args = content.map(x => this.eval(x, environment));
        return f.call(this, environment, ...args);
    }
}

export default function run(text) {
    return new Interpreter(parse(text)).run();
}
