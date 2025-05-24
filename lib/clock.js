import { message } from "./util.js";

const Playing = Symbol.for("playing");
const Stopped = Symbol.for("stopped");

export default class Clock {
    constructor() {
        this.currentTime = 0;
        this.state = Stopped;
    }

    advance() {
        if (this.state !== Playing || this.request) {
            return;
        }
        this.request = window.requestAnimationFrame(() => { this.tick(); });
    }

    tick() {
        delete this.request;
        const now = Date.now();
        const begin = this.lastUpdateTime - this.startTime;
        const end = now - this.startTime;
        console.assert(begin <= end);
        if (begin === end) {
            // Avoid updates with an empty interval [t, t[
            console.info("Clock: begin = end, requesting another tick");
            this.request = window.requestAnimationFrame(() => { this.tick(); });
        } else {
            this.lastUpdateTime = now;
            message(this, "tick", { begin, end });
        }
    }

    set now(end) {
        console.assert(this.state === Stopped);
        if (end !== this.currentTime) {
            const begin = this.currentTime;
            this.currentTime = end;
            message(this, "tick", { begin, end });
        }
    }

    get now() {
        return this.state === Stopped ? this.currentTime : Date.now() - this.startTime;
    }

    start() {
        if (this.state === Stopped) {
            this.state = Playing;
            this.startTime = Date.now();
            this.lastUpdateTime = this.startTime;
            this.advance();
            message(this, "state");
        }
    }

    stop() {
        if (this.state === Playing) {
            this.state = Stopped;
            delete this.startTime;
            if (this.request) {
                window.cancelAnimationFrame(this.request);
                delete this.request;
            }
            message(this, "state");
        }
    }
}
