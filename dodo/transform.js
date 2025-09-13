import { extend } from "../lib/util.js";
import { consolidateText } from "./parser.js";
import { Interpreter, unspace } from "./interpreter.js";

// Symbol for the current item in the environment.
const Item = Symbol.for("item");

const Patterns = {
    // Match an element by name.
    element: (item, [name]) => item?.name === name,

    // Match text.
    text: item => typeof item === "string",
};

// Return true iff the pattern matches against the item.
function patternMatches(pattern, item) {
    return Patterns[pattern.name]?.(item, unspace(pattern.content)) ?? false;
}

// Extend the basic environment with output functions.
const Environment = { ...Interpreter.Environment,

    // Apply transform to some content.
    "apply-transform": function(environment, xs) {
        return xs.reduce((z, x) => z + this.applyTransform(x, Object.create(environment)), "");
    },

    // Return the value of the attribute named `name` of the element (or
    // current item by default), or the empty string if absent.
    attribute(environment, name, element) {
        return (element ?? environment[Item]).attributes[name] ?? "";
    },

    // Return the child elements of `element` (or current item by default).
    "child-elements": function(environment, element) {
        return (element ?? environment[Item]).content.filter(x => typeof x.name === "string");
    },

    // Return the consolidated text content of `element` (or current item by
    // default).
    "content-of": function(environment, element) {
        return consolidateText((element ?? environment[Item]).content);
    },

    // Return the value of an item (or current item by default).
    "value-of": function(environment, item) {
        return item ?? environment[Item];
    }
};

// Apply the transform to the the input document.
// FIXME 4W01 Dodo: imports in transform
export default function transform(transformDocument, inputDocument) {
    if (transformDocument.root.name !== "transform") {
        throw Error(`Expected a "transform" document but got "${transformDocument.root.name}" instead.`);
    }
    const rules = unspace(transformDocument.root.content);
    const matches = rules.filter(x => x.name === "match").map(element => {
        const [pattern, ...content] = unspace(element.content);
        return [pattern, content];
    });
    const interpreter = new Interpreter();
    interpreter.applyTransform = function(item, environment) {
        const match = matches.find(([pattern]) => patternMatches(pattern, item));
        if (!match) {
            return "";
        }
        environment[Item] = item;
        const [pattern, content] = match;
        return content.reduce((z, x) => {
            return z + this.eval(x, environment);
        }, "");
    };
    return interpreter.applyTransform(inputDocument.root, { ...Environment });
}
