import { exit } from "node:process";
import { resolve } from "node:path";

import parse from "./parser.js";
import transform from "./transform.js";

async function parseFile(path) {
    if (!path) {
        console.error(`Parse error: no input.`);
        exit(1);
    }
    try {
        const file = Bun.file(path);
        const text = await file.text();
        return Object.assign(parse(text), { path, timestamp: file.lastModified });
    } catch (error) {
        console.error(`Could not parse ${path}: ${error.message}`);
        exit(1);
    }
}

const doc = await parseFile(process.argv[2]);
if (process.argv.length > 3) {
    const input = await parseFile(process.argv[3]);
    try {
        Bun.write(Bun.stdout, transform(doc, input));
    } catch (error) {
        console.error(`Could not transform ${input.path} with ${doc.path}: ${error.message}`);
    }
}
