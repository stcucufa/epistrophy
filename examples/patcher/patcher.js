import Scheduler from "../../lib/scheduler.js";

Scheduler.run().
    effect(() => { console.info("Hello, world!"); });
