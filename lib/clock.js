import { message } from "./util.js";

// FIXME 4F0C Idle clock
const Idle = Symbol.for("idle");
const Stopped = Symbol.for("stopped");

export default class Clock {
    constructor() {
        this.currentTime = 0;
        this.state = Stopped;
    }

    advance() {
        if (this.state === Idle && !this.request) {
            this.request = window.setTimeout(() => {
                delete this.request;
                this.currentTime = this.now;
                message(this, "tick");
            }, 1);
        }
    }

    set now(value) {
        console.assert(this.state === Stopped);
        if (value !== this.currentTime) {
            this.currentTime = value;
            message(this, "tick");
        }
    }

    get now() {
        return this.state === Stopped ? this.currentTime : Math.trunc(performance.now() - this.startTime);
    }

    start() {
        if (this.state === Stopped) {
            this.state = Idle;
            this.startTime = performance.now();
            this.advance();
        }
    }

    stop() {
        if (this.state === Idle) {
            this.state = Stopped;
            delete this.startTime;
        }
    }
}
