import { describe, expect, test } from "bun:test";
import { createIdleTracker } from "../src/idle.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("createIdleTracker", () => {
  test("fires onIdle once after inactivity", async () => {
    let idles = 0;
    const tracker = createIdleTracker({ idleMs: 30, onIdle: () => idles++ });
    tracker.touch();
    tracker.touch();
    expect(tracker.isDirty()).toBe(true);
    await sleep(60);
    expect(idles).toBe(1);
    expect(tracker.isDirty()).toBe(false);
    await sleep(60);
    expect(idles).toBe(1);
    tracker.destroy();
  });

  test("continued typing postpones onIdle", async () => {
    let idles = 0;
    const tracker = createIdleTracker({ idleMs: 50, onIdle: () => idles++ });
    tracker.touch();
    await sleep(30);
    tracker.touch();
    await sleep(30);
    expect(idles).toBe(0);
    await sleep(40);
    expect(idles).toBe(1);
    tracker.destroy();
  });

  test("debounces onChange", async () => {
    let changes = 0;
    const tracker = createIdleTracker({
      idleMs: 1000,
      changeDebounceMs: 20,
      onChange: () => changes++,
    });
    tracker.touch();
    tracker.touch();
    tracker.touch();
    await sleep(50);
    expect(changes).toBe(1);
    tracker.destroy();
  });

  test("reset cancels pending idle firing", async () => {
    let idles = 0;
    const tracker = createIdleTracker({ idleMs: 30, onIdle: () => idles++ });
    tracker.touch();
    tracker.reset();
    await sleep(60);
    expect(idles).toBe(0);
    expect(tracker.isDirty()).toBe(false);
    tracker.destroy();
  });
});
