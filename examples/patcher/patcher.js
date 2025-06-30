import Scheduler from "../../lib/scheduler.js";

// FIXME 4J0P Draw lines
Scheduler.run().
    effect(() => { console.info("Hello, world!"); });
