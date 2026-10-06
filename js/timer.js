/*
 * timer.js — drift-corrected one-second ticker based on performance.now().
 * setInterval drifts on slow devices; here every tick is scheduled against
 * the ideal timeline, so second N always fires at start + N*1000ms.
 */
(function (TA) {
  'use strict';

  class Timer {
    /**
     * @param {object} opts
     * @param {(second:number, elapsedMs:number) => void} opts.onTick
     */
    constructor({ onTick } = {}) {
      this.onTick = onTick || (() => {});
      this.startTime = 0;
      this.endTime = 0;
      this.second = 0;
      this.handle = null;
      this.running = false;
    }

    start() {
      this.stop();
      this.running = true;
      this.startTime = performance.now();
      this.endTime = 0;
      this.second = 0;
      this.schedule();
    }

    schedule() {
      const next = this.startTime + (this.second + 1) * 1000;
      const delay = Math.max(0, next - performance.now());
      this.handle = setTimeout(() => {
        if (!this.running) return;
        this.second++;
        this.onTick(this.second, performance.now() - this.startTime);
        if (this.running) this.schedule();
      }, delay);
    }

    stop() {
      if (this.running) this.endTime = performance.now();
      this.running = false;
      clearTimeout(this.handle);
      this.handle = null;
    }

    /** Elapsed milliseconds (frozen after stop). */
    elapsed() {
      if (!this.startTime) return 0;
      return (this.running ? performance.now() : this.endTime) - this.startTime;
    }

    reset() {
      this.stop();
      this.startTime = 0;
      this.endTime = 0;
      this.second = 0;
    }
  }

  TA.Timer = Timer;
})(window.TA = window.TA || {});
