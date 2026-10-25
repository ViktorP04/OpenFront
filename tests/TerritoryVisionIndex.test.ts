import { GameMapImpl } from "@openfront/engine-lib/game/GameMapImpl";
import { TerritoryVisionIndex } from "@openfront/engine/game/TerritoryVisionIndex";
import { expect, it } from "vitest";

it("matches brute-force diamond visibility through ownership and diplomacy changes", () => {
  const width = 73,
    height = 51;
  const map = new GameMapImpl(
    width,
    height,
    new Uint8Array(width * height).fill(128),
    width * height,
  );
  let seed = 8123;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let i = 0; i < 300; i++)
    map.setOwnerID(random() % (width * height), 1 + (random() % 4));
  const index = new TerritoryVisionIndex(map);
  for (let round = 0; round < 100; round++) {
    for (let i = 0; i < 20; i++) {
      const tile = random() % (width * height),
        owner = random() % 5;
      const previous = map.ownerID(tile);
      map.setOwnerID(tile, owner);
      index.changeOwner(tile, previous, owner);
    }
    const friendly = (id: number) => id === 1 || (round % 2 === 0 && id === 2);
    for (let query = 0; query < 30; query++) {
      const tile = random() % (width * height),
        radius = random() % 24;
      const cx = map.x(tile),
        cy = map.y(tile);
      let expected = false;
      for (
        let y = Math.max(0, cy - radius);
        y <= Math.min(height - 1, cy + radius);
        y++
      ) {
        const dx = radius - Math.abs(y - cy);
        for (
          let x = Math.max(0, cx - dx);
          x <= Math.min(width - 1, cx + dx);
          x++
        ) {
          if (friendly(map.ownerID(map.ref(x, y)))) expected = true;
        }
      }
      expect(index.hasVision(tile, radius, friendly)).toBe(expected);
    }
  }
});

it("removes the last owner from a cell without losing a different owner's tiles", () => {
  const map = new GameMapImpl(
    35,
    19,
    new Uint8Array(35 * 19).fill(128),
    35 * 19,
  );
  map.setOwnerID(16, 1);
  map.setOwnerID(17, 2);
  const index = new TerritoryVisionIndex(map);
  map.setOwnerID(16, 0);
  index.changeOwner(16, 1, 0);
  expect(index.hasVision(16, 1, (id) => id === 1)).toBe(false);
  expect(index.hasVision(16, 1, (id) => id === 2)).toBe(true);
  map.setOwnerID(17, 0);
  index.changeOwner(17, 2, 0);
  expect(index.hasVision(16, 20, () => true)).toBe(false);
});
