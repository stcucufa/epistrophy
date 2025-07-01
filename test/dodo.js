import test from "./test.js";
import parse from "../dodo/parser.js";

test("Parse", t => {
    const root = parse("{ hello }");
    console.info(root);
});
