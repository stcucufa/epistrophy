import { notify } from "./events.js";
import { extend } from "./util.js";

const proto = {
    // Get the current logical time.
    get now() {
        return this.lastUpdate;
    },

    // Get the current physical time.
    get currentTime() {
        return this.lastUpdateTime - this.startTime;
    },

    // True when the clock is running (has started and is not paused).
    get running() {
        return Object.hasOwn(this, "request");
    },

    // True when the clock is paused.
    get paused() {
        return Object.hasOwn(this, "pauseTime");
    },

    // Playback rate (must be definite).
    get rate() {
        return this.playbackRate;
    },

    // Notify of playback rate changes.
    set rate(value) {
        if (!Number.isFinite(value)) {
            throw Error("Playback rate must be a finite number.");
        }
        if (value !== this.playbackRate) {
            this.playbackRate = value;
            notify(this, "rate");
        }
    },

    // Start the clock and generate updates on every animation frame.
    start() {
        console.assert(!this.boundUpdate);
        this.startTime = performance.now();
        this.lastUpdateTime = this.startTime;
        this.lastUpdate = 0;
        this.boundUpdate = this.update.bind(this);
        this.request = window.requestAnimationFrame(this.boundUpdate);
        notify(this, "start");
    },

    // Pause the clock.
    pause() {
        if (this.running && !this.paused) {
            window.cancelAnimationFrame(this.request);
            delete this.request;
            this.pauseTime = performance.now();
            notify(this, "pause");
        }
    },

    // Resume a paused clock.
    resume() {
        if (this.paused) {
            console.assert(this.boundUpdate);
            const delta = performance.now() - this.pauseTime;
            delete this.pauseTime;
            this.startTime += delta;
            this.lastUpdateTime += delta;
            this.request = window.requestAnimationFrame(this.boundUpdate);
            notify(this, "resume");
        }
    },

    // Stop the clock immediately.
    stop() {
        if (this.boundUpdate) {
            window.cancelAnimationFrame(this.request);
            delete this.request;
            delete this.boundUpdate;
            delete this.pauseTime;
            this.playbackRate = 1;
            this.lastUpdate = 0;
            notify(this, "stop");
        }
    },

    // Execute the updates for a running clock.
    update() {
        this.request = window.requestAnimationFrame(this.boundUpdate);
        const lastUpdateTime = this.currentTime;
        this.lastUpdateTime = performance.now();
        const elapsedTime = this.currentTime - lastUpdateTime;
        const from = this.lastUpdate;
        const to = Math.max(0, from + this.playbackRate * elapsedTime);
        this.lastUpdate = to;
        if (to !== from) {
            notify(this, "update", { from, to });
            if (to === 0) {
                this.stop();
            }
        }
    },

    // Seek a stopped clock and execute updates synchronously.
    seek(to) {
        console.assert(!this.running);
        to = Math.max(0, to);
        const from = this.currentTime;
        if (from === to) {
            return;
        }
        this.lastUpdateTime = performance.now();
        this.startTime = this.lastUpdateTime - to;
        this.lastUpdate = to;
        notify(this, "update", { from, to });
    }
};

export const Clock = () => extend(proto, {
    playbackRate: 1,
    startTime: 0,
    lastUpdateTime: 0,
    lastUpdate: 0
});
