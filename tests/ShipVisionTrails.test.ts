import { SHIP_VISION_LINGER_TICKS } from "@openfront/engine-lib/game/FogOfWarRules";
import { ShipVisionTrails } from "@openfront/engine-lib/game/ShipVisionTrails";
import { expect, it } from "vitest";

it("matches brute force through dense mixed-owner trails, expiry, refresh, and restore", () => {
  const width = 257,
    height = 149;
  let trails = new ShipVisionTrails(width);
  const reference = new Map<string, [number, number, number, number]>();
  let seed = 31415;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let tick = 0; tick < 220; tick += 5) {
    const sources = Array.from({ length: 75 }, () => ({
      owner: 1 + (random() % 5),
      pos: random() % (width * height),
      radius: [10, 20, 35, 70][random() % 4],
    }));
    sources.push({ owner: 1, pos: 0, radius: 10 });
    for (const [key, entry] of reference) {
      if (tick - entry[3] >= SHIP_VISION_LINGER_TICKS) reference.delete(key);
    }
    for (const { owner, pos, radius } of sources) {
      reference.set(`${owner}:${pos}:${radius}`, [owner, pos, radius, tick]);
    }
    trails.record(tick, sources);
    expect(trails.snapshot()).toEqual([...reference.values()]);
    const friendlyOwners = new Set(tick % 10 === 0 ? [1, 2] : [2]);
    const expectedSources = [...reference.values()]
      .filter(([owner]) => friendlyOwners.has(owner))
      .map(([, pos, radius]) => `${pos}:${radius}`)
      .sort();
    expect(
      [...trails.sources(tick, friendlyOwners)]
        .map(({ pos, radius }) => `${pos}:${radius}`)
        .sort(),
    ).toEqual(expectedSources);
    const snapshot = trails.snapshot();
    if (tick % 25 === 0) {
      trails = new ShipVisionTrails(width);
      trails.restore(snapshot);
      expect(trails.snapshot()).toEqual(snapshot);
    }
    for (let i = 0; i < 40; i++) {
      const pos = random() % (width * height);
      const friendly = (owner: number) =>
        owner === 1 || (tick % 10 === 0 && owner === 2);
      const queryTick = tick + (i % 3 === 0 ? SHIP_VISION_LINGER_TICKS : 0);
      const x = pos % width,
        y = Math.floor(pos / width);
      const expected = snapshot.some(
        ([owner, tile, radius, seen]) =>
          queryTick - seen < SHIP_VISION_LINGER_TICKS &&
          friendly(owner) &&
          ((tile % width) - x) ** 2 + (Math.floor(tile / width) - y) ** 2 <=
            radius * radius,
      );
      expect(trails.hasVision(queryTick, pos, friendly)).toBe(expected);
    }
  }
});

it("checks diplomacy once for a dense owner's spatial cell", () => {
  const trails = new ShipVisionTrails(256);
  trails.record(
    0,
    Array.from({ length: 1024 }, (_, i) => ({
      owner: 1,
      pos: Math.floor(i / 32) * 256 + (i % 32),
      radius: 10,
    })),
  );
  let calls = 0;
  expect(
    trails.hasVision(1, 63 * 256 + 63, () => {
      calls++;
      return true;
    }),
  ).toBe(false);
  expect(calls).toBe(1);
});

it("refreshes a stationary sample without retaining expired owner groups", () => {
  const trails = new ShipVisionTrails(256);
  trails.record(0, [
    { owner: 1, pos: 10, radius: 10 },
    { owner: 2, pos: 20, radius: 10 },
  ]);
  trails.record(99, [{ owner: 1, pos: 10, radius: 10 }]);
  trails.record(100, []);
  expect(trails.snapshot()).toEqual([[1, 10, 10, 99]]);
  expect(trails.hasVision(100, 0, (id) => id === 1)).toBe(true);
  expect(trails.hasVision(199, 0, (id) => id === 1)).toBe(false);
  trails.record(199, []);
  expect(trails.snapshot()).toEqual([]);
  expect(trails.hasVision(199, 0, () => true)).toBe(false);
});

it("does not resolve diplomacy for expired samples before the next cleanup", () => {
  const trails = new ShipVisionTrails(256);
  trails.record(0, [{ owner: 1, pos: 0, radius: 10 }]);
  expect(
    trails.hasVision(SHIP_VISION_LINGER_TICKS, 0, () => {
      throw new Error("expired owner must not be queried");
    }),
  ).toBe(false);
});
