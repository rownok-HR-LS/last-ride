// How far the park has loaded (0..1), for the title's bar and the bus stop's "loading the park 80%". The menu works
// from the first moment, over a photo of the park; the live park fades in when it is ready (main.js), so this only
// has to say roughly how far along it is.
//
// three.js counts every model and texture it is asked for (DefaultLoadingManager); the count of things wanted grows as
// loading goes on, so the fraction can dip: the bar only ever moves forward, and stops short of full until the park
// says it is ready.
import * as THREE from 'three';

const listeners = new Set();
export const loading = {
  pct: 0,
  done: false,
  /** fn(pct) on every change; returns a function that stops listening. */
  on(fn) {
    listeners.add(fn);
    fn(this.pct);
    return () => listeners.delete(fn);
  },
  set(p) {
    const v = this.done ? 1 : Math.min(0.97, Math.max(this.pct, p));
    if (v === this.pct) return;
    this.pct = v;
    for (const fn of listeners) fn(v);
  },
  finish() {
    this.done = true;
    this.pct = 1;
    for (const fn of listeners) fn(1);
  },
};

const M = THREE.DefaultLoadingManager;
const prev = M.onProgress;
M.onProgress = (url, loaded, total) => {
  prev?.(url, loaded, total);
  // the first few files say little about how many follow: ease in
  if (total > 0) loading.set((loaded / total) * Math.min(1, total / 60));
};
