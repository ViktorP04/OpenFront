import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GameStartInfo } from "../src/core/Schemas";
import { WorkerClient } from "../src/core/worker/WorkerClient";

const state = vi.hoisted(() => ({ worker: null as any }));
vi.mock("../src/core/worker/Worker.worker.ts?worker&inline", () => ({
  default: class extends EventTarget {
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
      super();
      state.worker = this;
    }
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  state.worker = null;
});
afterEach(() => {
  vi.useRealTimers();
  delete window.BOOTSTRAP_CONFIG;
});

async function start() {
  const client = new WorkerClient({} as GameStartInfo, undefined);
  const ready = client.initialize();
  // Observe rejection before advancing timers or dispatching worker events.
  void ready.catch(() => {});
  await vi.advanceTimersByTimeAsync(0);
  const worker = state.worker;
  const init = worker.postMessage.mock.calls[0][0];
  return { ready, worker, init };
}

it.each(["", "https://cdn.example.com"])(
  "passes an absolute asset base into Blob workers (CDN=%s)",
  async (cdnBase) => {
    window.BOOTSTRAP_CONFIG = { cdnBase };
    const { ready, worker, init } = await start();
    expect(init.cdnBase).toBe(cdnBase || window.location.origin);
    expect(
      new URL("/_assets/maps/viktor/map.bin", init.cdnBase).protocol,
    ).toMatch(/^https?:$/);
    worker.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "initialized", id: init.id },
      }),
    );
    await expect(ready).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("reports map initialization failures immediately and terminates the worker", async () => {
  const { ready, worker, init } = await start();
  worker.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "initialization_error",
        id: init.id,
        message: "Failed to load map: 404",
      },
    }),
  );
  await expect(ready).rejects.toThrow("Failed to load map: 404");
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("reports worker script failures without waiting for the timeout", async () => {
  const { ready, worker } = await start();
  worker.dispatchEvent(new ErrorEvent("error", { message: "Script blocked" }));
  await expect(ready).rejects.toThrow("Script blocked");
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it("terminates an unresponsive worker when initialization times out", async () => {
  const { ready, worker } = await start();
  await vi.advanceTimersByTimeAsync(60_000);
  await expect(ready).rejects.toThrow("Worker initialization timeout");
  expect(worker.terminate).toHaveBeenCalledOnce();
});
