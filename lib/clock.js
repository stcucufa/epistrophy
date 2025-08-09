import { message } from "./util.js";

export default class Clock {
    constructor() {
        this.currentTime = 0;
        this.state = Clock.Stopped;
    }

    static Stopped = Symbol.for("stopped");
    static Playing = Symbol.for("playing");

    advance() {
        if (this.state !== Clock.Playing || this.request) {
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
        console.assert(this.state === Clock.Stopped);
        if (end !== this.currentTime) {
            const begin = this.currentTime;
            this.currentTime = end;
            message(this, "tick", { begin, end });
        }
    }

    get now() {
        return this.state === Clock.Stopped ? this.currentTime : Date.now() - this.startTime;
    }

    start() {
        if (this.state === Clock.Stopped) {
            this.state = Clock.Playing;
            this.startTime = Date.now();
            this.lastUpdateTime = this.startTime;
            this.advance();
            message(this, "state");
        }
    }

    stop() {
        if (this.state === Clock.Playing) {
            this.state = Clock.Stopped;
            delete this.startTime;
            if (this.request) {
                window.cancelAnimationFrame(this.request);
                delete this.request;
            }
            message(this, "state");
        }
    }
}
