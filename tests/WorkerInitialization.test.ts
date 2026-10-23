// @vitest-environment jsdom
import { GameMapType, GameMapSize } from "@openfront/engine-api/game/GameTypes";
import type { GameStartInfo } from "@openfront/engine-api/Schemas";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkerClient } from "../src/client/WorkerClient";

const state = vi.hoisted(() => ({ worker: null as any }));
vi.mock("@openfront/engine/worker/Worker.worker?worker&inline", () => ({
  default: class extends EventTarget {
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
      super();
      state.worker = this;
    }
  },
}));

vi.mock("../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: {
    getMapData: () => ({
      manifest: async () => ({ name: "viktor" }),
      mapBin: async () => new Uint8Array(4),
      map4xBin: async () => new Uint8Array(4),
      map16xBin: async () => new Uint8Array(4),
    }),
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
  const client = new WorkerClient(
    {
      config: { gameMap: GameMapType.Onion, gameMapSize: GameMapSize.Normal },
    } as GameStartInfo,
    undefined,
  );
  const ready = client.initialize();
  // Observe rejection before advancing timers or dispatching worker events.
  void ready.catch(() => {});
  await vi.advanceTimersByTimeAsync(0);
  const worker = state.worker;
  const init = worker.postMessage.mock.calls[0][0];
  return { ready, worker, init };
}

it.each(["", "https://cdn.example.com"])(
  "passes loaded map data into Blob workers (CDN=%s)",
  async (cdnBase) => {
    window.BOOTSTRAP_CONFIG = { cdnBase };
    const { ready, worker, init } = await start();
    expect(init).not.toHaveProperty("cdnBase");
    expect(init.map.mapBin).toBeInstanceOf(Uint8Array);
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
        type: "init_error",
        id: init.id,
        error: "Failed to load map: 404",
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
