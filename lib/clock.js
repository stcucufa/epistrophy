export default class Clock {
    // Create a new clock that drives the updates of a scheduler.
    constructor(scheduler) {
        this.scheduler = scheduler;
        this.currentTime = 0;
    }

    // True when there is no outstanding request.
    get idle() {
        return !this.request;
    }

    // True if and only if the clock is playing, otherwise it is stopped.
    get playing() {
        return Object.hasOwn(this, "startTime");
    }

    // Request a tick from the clock (only when playing).
    advance() {
        if (this.playing && !this.request) {
            this.request = window.requestAnimationFrame(() => { this.tick(); });
        }
    }

    // Send a tick message with begin being the last time a tick was updated,
    // and end being the current time.
    tick() {
        delete this.request;
        const now = performance.now();
        const begin = this.lastUpdateTime - this.startTime;
        const end = now - this.startTime;
        if (begin === end) {
            this.request = window.requestAnimationFrame(() => { this.tick(); });
        } else {
            this.lastUpdateTime = now;
            this.scheduler.update(begin, end);
        }
    }

    // Get the current time.
    get now() {
        return this.playing ? performance.now() - this.startTime : this.currentTime;
    }

    // Advance the clock manually, generating a tick. This can be used to
    // run a fiber synchronously as if time had advanced.
    set now(end) {
        if (end > this.currentTime) {
            const begin = this.currentTime;
            this.currentTime = end;
            this.scheduler.update(begin, end);
        }
    }

    // Start the clock and request a tick.
    start() {
        if (!this.playing) {
            this.startTime = performance.now();
            this.lastUpdateTime = this.startTime;
            this.advance();
        }
    }

    // Stop the clock (without a tick).
    stop() {
        if (this.playing) {
            window.cancelAnimationFrame(this.request);
            delete this.request;
            delete this.startTime;
        }
    }
}
