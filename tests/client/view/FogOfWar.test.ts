import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { ShipVisionTrails } from "@openfront/engine-lib/game/ShipVisionTrails";
import { describe, expect, it } from "vitest";
import {
  FogOfWar,
  FOG_BIT,
  unitVisionRadius,
} from "../../../src/client/view/FogOfWar";
import {
  makeEmptyGu,
  makeGameView,
  makePlayerUpdate,
  makeUnitUpdate,
  stubConfig,
} from "../../util/viewStubs";

describe("fog vision", () => {
  it("expands territory without wrapping rows or borrowing enemy vision", () => {
    const fog = new FogOfWar(80, 50),
      owners = new Uint16Array(4000);
    owners[20 * 80] = 1;
    owners[20 * 80 + 40] = 2;
    const v = fog.update(owners, new Set([1]), []);
    expect(v[20 * 80 + 20]).toBeGreaterThan(0);
    expect(v[20 * 80 + 21]).toBe(0);
    expect(v[19 * 80 + 79]).toBe(0);
    expect(v[20 * 80 + 40]).toBe(0);
  });
  it("shares allied territory and clears lost vision", () => {
    const fog = new FogOfWar(80, 50),
      owners = new Uint16Array(4000);
    owners[20 * 80 + 40] = 2;
    expect(
      fog.update(owners, new Set([1, 2]), [])[20 * 80 + 45],
    ).toBeGreaterThan(0);
    expect(fog.update(owners, new Set([1]), [])[20 * 80 + 45]).toBe(0);
  });
  it("uses circular radar coverage, clipped safely at map edges", () => {
    const fog = new FogOfWar(400, 200),
      owners = new Uint16Array(80000);
    const v = fog.update(owners, new Set([1]), [{ pos: 0, radius: 150 }]);
    expect(v[150]).toBe(1);
    expect(v[151]).toBe(0);
    expect(v[100 * 400 + 100]).toBe(1);
    expect(v[120 * 400 + 120]).toBe(0);
    expect(v[399]).toBe(0);
  });
  it("gives ships vision but excludes projectiles from scouting", () => {
    expect(unitVisionRadius(UnitType.Warship)).toBe(35);
    expect(unitVisionRadius(UnitType.Submarine)).toBe(70);
    expect(unitVisionRadius(UnitType.RadarStation)).toBe(150);
    expect(unitVisionRadius(UnitType.Shell)).toBe(0);
    expect(unitVisionRadius(UnitType.HydrogenBomb)).toBe(0);
  });
});

function fogGame(enabled = true) {
  const game = makeGameView({
    width: 400,
    height: 50,
    myClientID: "client-a",
    config: stubConfig({ fogOfWar: () => enabled, isReplay: () => false }),
  });
  const gu = makeEmptyGu(1);
  gu.updates[GameUpdateType.Player] = [
    makePlayerUpdate({ tilesOwned: 10 }),
    makePlayerUpdate({
      id: "enemy",
      smallID: 2,
      clientID: "client-b",
      tilesOwned: 10,
    }),
  ];
  gu.updates[GameUpdateType.SpawnPhaseEnd] = [
    { type: GameUpdateType.SpawnPhaseEnd, startTick: 1 },
  ];
  gu.updates[GameUpdateType.Unit] = [
    makeUnitUpdate({
      id: 10,
      ownerID: 1,
      unitType: UnitType.RadarStation,
      pos: 20 * 400 + 20,
    }),
    makeUnitUpdate({
      id: 11,
      ownerID: 2,
      unitType: UnitType.City,
      pos: 20 * 400 + 100,
    }),
    makeUnitUpdate({
      id: 12,
      ownerID: 2,
      unitType: UnitType.City,
      pos: 20 * 400 + 300,
    }),
    makeUnitUpdate({
      id: 13,
      ownerID: 2,
      unitType: UnitType.Submarine,
      pos: 20 * 400 + 100,
      targetable: false,
    }),
  ];
  gu.packedTileUpdates = new Uint32Array([
    20 * 400 + 20,
    1,
    20 * 400 + 100,
    2,
    20 * 400 + 300,
    2,
  ]);
  game.update(gu);
  return game;
}

it("masks frames without modifying simulation data, and radar does not defeat submarine stealth", () => {
  const game = fogGame();
  expect(game.isTileVisible(20 * 400 + 100)).toBe(true);
  expect(game.isTileVisible(20 * 400 + 300)).toBe(false);
  const frame = game.frameData();
  expect(frame.units.has(11)).toBe(true);
  expect(frame.units.has(12)).toBe(false);
  expect(frame.units.has(13)).toBe(false);
  expect(frame.tileState[20 * 400 + 300]).toBe(FOG_BIT);
  expect(game.tileState(20 * 400 + 300)).toBe(2);
  expect(game.unit(12)?.isActive()).toBe(true);
  expect(game.frameData()).toBe(frame);
});

it("removes coverage immediately when a radar is captured and restores the full spectator frame on death", () => {
  const game = fogGame();
  game.frameData();
  const gu = makeEmptyGu(2);
  gu.updates[GameUpdateType.Unit] = [
    makeUnitUpdate({
      id: 10,
      ownerID: 2,
      unitType: UnitType.RadarStation,
      pos: 20 * 400 + 20,
    }),
  ];
  game.update(gu);
  expect(game.frameData().units.has(11)).toBe(false);
  expect(game.frameData().changedTiles).toContain(20 * 400 + 100);
  const death = makeEmptyGu(3);
  death.updates[GameUpdateType.Player] = [makePlayerUpdate({ isAlive: false })];
  game.update(death);
  expect(game.frameData().units.has(12)).toBe(true);
  expect(game.frameData().tileState[20 * 400 + 300]).toBe(2);
  expect(game.frameData().changedTiles).toBeNull();
  expect(game.frameData().structuresDirty).toBe(true);
});

it("does not grant vision from an unfinished radar, and keeps the existing off-mode frame", () => {
  const game = fogGame();
  const gu = makeEmptyGu(2);
  gu.updates[GameUpdateType.Unit] = [
    makeUnitUpdate({
      id: 10,
      ownerID: 1,
      unitType: UnitType.RadarStation,
      pos: 20 * 400 + 20,
      underConstruction: true,
    }),
  ];
  game.update(gu);
  expect(game.frameData().units.has(11)).toBe(false);
  const off = fogGame(false);
  expect(off.frameData().tileState).toBe(off.tileStateBuffer());
  expect(off.frameData().units.has(12)).toBe(true);
});

it("keeps departed ship coverage for ten seconds, then hides enemies again", () => {
  const game = fogGame();
  const scout = makeUnitUpdate({
    id: 20,
    ownerID: 1,
    unitType: UnitType.Warship,
    pos: 20 * 400 + 300,
  });
  const arrive = makeEmptyGu(2);
  arrive.updates[GameUpdateType.Unit] = [scout];
  game.update(arrive);
  expect(game.frameData().units.has(12)).toBe(true);
  const leave = makeEmptyGu(3);
  leave.updates[GameUpdateType.Unit] = [{ ...scout, pos: 20 * 400 + 200 }];
  game.update(leave);
  expect(game.frameData().units.has(12)).toBe(true);
  game.update(makeEmptyGu(101));
  expect(game.frameData().units.has(12)).toBe(true);
  game.update(makeEmptyGu(102));
  expect(game.frameData().units.has(12)).toBe(false);
});

it("records narrow trade trails on every tick even when the renderer skips frames", () => {
  const game = fogGame();
  for (let tick = 2; tick <= 12; tick++) {
    const gu = makeEmptyGu(tick);
    gu.updates[GameUpdateType.Unit] = [
      makeUnitUpdate({
        id: 20,
        ownerID: 1,
        unitType: UnitType.TradeShip,
        pos: 20 * 400 + 200 + tick * 10,
      }),
    ];
    game.update(gu);
  }
  expect(game.isTileVisible(20 * 400 + 220)).toBe(true);
  expect(game.isTileVisible(20 * 400 + 270)).toBe(true);
  expect(game.isTileVisible(31 * 400 + 270)).toBe(false);
  game.update(makeEmptyGu(102));
  expect(game.isTileVisible(20 * 400 + 220)).toBe(true); // neighboring circle is newer
  game.update(makeEmptyGu(103));
  expect(game.isTileVisible(20 * 400 + 220)).toBe(false);
});

it("restores recent trails into a newly attached view", () => {
  const game = fogGame();
  const gu = makeEmptyGu(50);
  gu.shipVisionTrails = [[1, 20 * 400 + 300, 10, 1]];
  game.update(gu);
  expect(game.frameData().units.has(12)).toBe(true);
  game.update(makeEmptyGu(101));
  expect(game.frameData().units.has(12)).toBe(false);
});

it("uses the larger submarine vision in the rendered land mask", () => {
  const game = fogGame();
  const gu = makeEmptyGu(2);
  gu.updates[GameUpdateType.Unit] = [
    makeUnitUpdate({
      id: 20,
      ownerID: 1,
      unitType: UnitType.Submarine,
      pos: 20 * 400 + 230,
      targetable: false,
    }),
  ];
  game.update(gu);
  expect(game.isTileVisible(20 * 400 + 300)).toBe(true);
  expect(game.isTileVisible(20 * 400 + 301)).toBe(false);
  expect(game.frameData().units.has(12)).toBe(true);
});

it("refreshes stationary trails and revokes former allies' historical vision", () => {
  const trails = new ShipVisionTrails(400);
  trails.record(1, [{ owner: 2, pos: 100, radius: 10 }]);
  trails.record(90, [{ owner: 2, pos: 100, radius: 10 }]);
  expect(trails.snapshot()).toHaveLength(1);
  expect(trails.hasVision(101, 110, (id) => id === 2)).toBe(true);
  expect(trails.hasVision(101, 110, (id) => id === 1)).toBe(false);
  expect(trails.hasVision(190, 110, () => true)).toBe(false);
  trails.record(190, []);
  expect(trails.snapshot()).toHaveLength(0);
});

it("shares actual allied coverage and revokes it when the alliance ends", () => {
  const game = fogGame();
  const ally = makeEmptyGu(2);
  ally.updates[GameUpdateType.Player] = [
    makePlayerUpdate({ tilesOwned: 10, allies: [2] }),
    makePlayerUpdate({
      id: "enemy",
      smallID: 2,
      clientID: "client-b",
      tilesOwned: 10,
      allies: [1],
    }),
  ];
  game.update(ally);
  expect(game.frameData().units.has(12)).toBe(true);
  expect(game.frameData().units.has(13)).toBe(true);
  const broken = makeEmptyGu(3);
  broken.updates[GameUpdateType.Player] = [
    makePlayerUpdate({ tilesOwned: 10 }),
    makePlayerUpdate({
      id: "enemy",
      smallID: 2,
      clientID: "client-b",
      tilesOwned: 10,
    }),
  ];
  game.update(broken);
  expect(game.frameData().units.has(12)).toBe(false);
  expect(game.frameData().units.has(13)).toBe(false);
});

it("filters hidden names and local map effects", () => {
  const game = fogGame();
  const gu = makeEmptyGu(2);
  gu.playerNameViewData = {
    "player-a": { x: 20, y: 20, size: 12 },
    enemy: { x: 300, y: 20, size: 12 },
  };
  gu.updates[GameUpdateType.BonusEvent] = [
    {
      type: GameUpdateType.BonusEvent,
      player: "enemy",
      tile: 20 * 400 + 100,
      gold: 10,
      troops: 10,
    },
    {
      type: GameUpdateType.BonusEvent,
      player: "enemy",
      tile: 20 * 400 + 300,
      gold: 10,
      troops: 10,
    },
  ];
  game.update(gu);
  expect(
    [...game.frameData().names.values()].map((n) => n.playerID),
  ).not.toContain("enemy");
  expect(game.frameData().events.bonusEvents.map((e) => e.tile)).toEqual([
    20 * 400 + 100,
  ]);
});

it("trade ships reveal nearby water without replacing dedicated scouts", () => {
  const fog = new FogOfWar(100, 60);
  const owners = new Uint16Array(6000);
  const pos = 30 * 100 + 30;
  let vision = fog.update(owners, new Set([1]), [
    { pos, radius: unitVisionRadius(UnitType.TradeShip) },
  ]);
  expect(vision[pos + 10]).toBeGreaterThan(0);
  expect(vision[pos + 11]).toBe(0);
  expect(vision[pos + 30]).toBe(0);
  vision = fog.update(owners, new Set([1]), [
    { pos, radius: unitVisionRadius(UnitType.Warship) },
  ]);
  expect(vision[pos + 30]).toBeGreaterThan(0);
});

it("extends live shared vision when a radar is upgraded", () => {
  const game = fogGame();
  const enemy = makeEmptyGu(2);
  enemy.updates[GameUpdateType.Unit] = [
    makeUnitUpdate({
      id: 12,
      ownerID: 2,
      unitType: UnitType.City,
      pos: 20 * 400 + 220,
    }),
  ];
  game.update(enemy);
  expect(game.frameData().units.has(12)).toBe(false);
  const upgrade = makeEmptyGu(3);
  upgrade.updates[GameUpdateType.Unit] = [
    makeUnitUpdate({
      id: 10,
      ownerID: 1,
      unitType: UnitType.RadarStation,
      pos: 20 * 400 + 20,
      level: 2,
    }),
  ];
  game.update(upgrade);
  expect(game.frameData().units.has(12)).toBe(true);
  expect(unitVisionRadius(UnitType.RadarStation, 3)).toBe(225);
});

it("matches a full visibility rebuild after incremental border changes and moving sources", () => {
  const width = 193,
    height = 137;
  const owners = new Uint16Array(width * height);
  const incremental = new FogOfWar(width, height);
  const full = new FogOfWar(width, height);
  let seed = 12345;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let i = 0; i < 90; i++)
    owners[random() % owners.length] = 1 + (random() % 3);
  for (let tick = 0; tick < 80; tick++) {
    const before = incremental.visible.slice();
    const changed = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const tile = random() % owners.length;
      owners[tile] = random() % 4;
      changed.add(tile);
    }
    const friendly = new Set(tick < 40 ? [1] : [1, 2]);
    const sources = [
      { pos: random() % owners.length, radius: 17, wrap: tick % 2 === 0 },
    ];
    const trails = [{ pos: random() % owners.length, radius: 9 }];
    incremental.update(owners, friendly, sources, changed);
    full.update(owners, friendly, sources);
    incremental.addSources(trails);
    full.addSources(trails);
    expect(
      incremental.visible.every((value, tile) => value === full.visible[tile]),
    ).toBe(true);
    let uncoveredChanges = 0;
    for (let tile = 0; tile < owners.length; tile++) {
      if (!!before[tile] === !!incremental.visible[tile]) continue;
      const chunk =
        Math.floor(Math.floor(tile / width) / incremental.chunkSize) *
          incremental.chunkColumns +
        Math.floor((tile % width) / incremental.chunkSize);
      if (!incremental.dirtyChunks.has(chunk)) uncoveredChanges++;
    }
    expect(uncoveredChanges).toBe(0);
  }
});

it("avoids unchanged texture uploads and retains tile changes across skipped frames", () => {
  const game = fogGame();
  game.frameData();
  const tile = 20 * 400 + 100;
  const second = makeEmptyGu(2);
  second.packedTileUpdates = new Uint32Array([tile, 1]);
  game.update(second);
  // Input may evaluate vision without rendering this tick.
  game.isTileVisible(tile);
  game.update(makeEmptyGu(3));
  const frame = game.frameData();
  expect(frame.tileState[tile]).toBe(1);
  expect(frame.changedTiles).toContain(tile);
  expect(frame.trailDirtyRowMax).toBe(-1);
  expect(frame.railroadDirty).toBe(false);
  game.update(makeEmptyGu(4));
  expect(game.frameData().changedTiles).toEqual([]);
  expect(game.frameData().trailDirtyRowMax).toBe(-1);
  expect(game.frameData().railroadDirty).toBe(false);
  expect(game.frameData().structuresDirty).toBe(false);
});

it("clears and restores masked trails, rails, and structures when radar coverage changes", () => {
  const game = fogGame();
  const tile = 20 * 400 + 100;
  const ships = makeEmptyGu(2);
  ships.updates[GameUpdateType.Unit] = [
    makeUnitUpdate({
      id: 99,
      ownerID: 2,
      unitType: UnitType.TransportShip,
      pos: tile,
    }),
  ];
  ships.updates[GameUpdateType.RailroadSnapEvent] = [
    {
      type: GameUpdateType.RailroadSnapEvent,
      originalId: 100,
      newId1: 101,
      newId2: 102,
      tiles1: [tile, tile + 1],
      tiles2: [],
    },
  ];
  game.update(ships);
  expect(game.frameData().trailState[tile]).toBe(2);
  expect(game.frameData().railroadState[tile]).toBeGreaterThan(0);
  for (const [tick, ownerID] of [
    [3, 2],
    [4, 1],
  ]) {
    const gu = makeEmptyGu(tick);
    gu.updates[GameUpdateType.Unit] = [
      makeUnitUpdate({
        id: 10,
        ownerID,
        unitType: UnitType.RadarStation,
        pos: 20 * 400 + 20,
      }),
    ];
    game.update(gu);
    const frame = game.frameData();
    expect(frame.trailState[tile]).toBe(ownerID === 1 ? 2 : 0);
    expect(frame.railroadState[tile] !== 0).toBe(ownerID === 1);
    expect(frame.railroadDirty).toBe(true);
    expect(frame.trailDirtyRowMin).toBeLessThanOrEqual(20);
    expect(frame.trailDirtyRowMax).toBeGreaterThanOrEqual(20);
    expect(frame.units.has(11)).toBe(ownerID === 1);
    expect(frame.structuresDirty).toBe(true);
  }
});

it("leaves stationary duplicate sources clean and invalidates expired or moved coverage", () => {
  const fog = new FogOfWar(400, 200);
  const owners = new Uint16Array(80000);
  const friendly = new Set([1]);
  const source = { pos: 80 * 400 + 80, radius: 10 };
  const trail = { pos: 80 * 400 + 300, radius: 10 };
  fog.update(owners, friendly, [source], []);
  fog.addSources([trail]);
  expect(fog.visible[trail.pos]).toBe(1);
  fog.update(owners, friendly, [source, source], []);
  fog.addSources([trail, source, trail]);
  expect(fog.dirtyChunks.size).toBe(0);
  expect(fog.visible[source.pos]).toBe(1);
  expect(fog.visible[trail.pos]).toBe(1);
  fog.update(owners, friendly, [source], []);
  fog.addSources([{ ...trail, pos: 80 * 400 + 200 }]);
  expect(fog.visible[trail.pos]).toBe(0);
  expect(fog.visible[80 * 400 + 200]).toBe(1);
  expect(fog.dirtyChunks.has(1 * fog.chunkColumns + 4)).toBe(true);
  expect(fog.dirtyChunks.has(1 * fog.chunkColumns + 3)).toBe(true);
  expect(fog.dirtyChunks.has(1 * fog.chunkColumns + 1)).toBe(false);
});

it("retains sparse trail and rail edits across skipped frames with unchanged visibility", () => {
  const game = fogGame();
  game.frameData();
  const tile = 20 * 400 + 100;
  const build = makeEmptyGu(2);
  build.updates[GameUpdateType.Unit] = [
    makeUnitUpdate({
      id: 99,
      ownerID: 2,
      unitType: UnitType.TransportShip,
      pos: tile,
    }),
  ];
  build.updates[GameUpdateType.RailroadSnapEvent] = [
    {
      type: GameUpdateType.RailroadSnapEvent,
      originalId: 100,
      newId1: 101,
      newId2: 102,
      tiles1: [tile, tile + 1],
      tiles2: [],
    },
  ];
  game.update(build);
  game.isTileVisible(tile);
  game.update(makeEmptyGu(3));
  let frame = game.frameData();
  expect(frame.trailState[tile]).toBe(2);
  expect(frame.railroadState[tile]).toBeGreaterThan(0);
  expect(frame.trailDirtyRowMin).toBe(20);
  expect(frame.trailDirtyRowMax).toBe(20);
  expect(frame.railroadDirty).toBe(true);
  const remove = makeEmptyGu(4);
  remove.updates[GameUpdateType.Unit] = [
    makeUnitUpdate({
      id: 99,
      ownerID: 2,
      unitType: UnitType.TransportShip,
      pos: tile,
      isActive: false,
      markedForDeletion: 1,
    }),
  ];
  remove.updates[GameUpdateType.RailroadDestructionEvent] = [
    { type: GameUpdateType.RailroadDestructionEvent, id: 101 },
  ];
  game.update(remove);
  game.update(makeEmptyGu(5));
  game.update(makeEmptyGu(6));
  frame = game.frameData();
  expect(frame.trailState[tile]).toBe(0);
  expect(frame.railroadState[tile]).toBe(0);
  expect(frame.trailDirtyRowMin).toBe(20);
  expect(frame.trailDirtyRowMax).toBe(20);
  expect(frame.railroadDirty).toBe(true);
  expect(frame.trailChangedTiles).toContain(tile);
  expect(frame.railroadChangedTiles).toContain(tile);
});

it("updates alliance coverage locally, including ownership changes on the same tick", () => {
  const width = 512,
    height = 512;
  const owners = new Uint16Array(width * height);
  const tile = 130 * width + 130;
  owners[tile] = 2;
  const fog = new FogOfWar(width, height),
    full = new FogOfWar(width, height);
  fog.update(owners, new Set([1]), [], []);
  fog.update(owners, new Set([1, 2]), [], []);
  expect(fog.visible[tile + 20]).toBeGreaterThan(0);
  expect(fog.dirtyChunks.size).toBeLessThan(16);
  expect(fog.dirtyChunks.has(63)).toBe(false);
  owners[tile] = 3;
  fog.update(
    owners,
    new Set([1, 3]),
    [],
    (function* () {
      yield tile;
    })(),
  );
  expect(fog.visible[tile + 20]).toBeGreaterThan(0);
  fog.update(owners, new Set([1]), [], []);
  full.update(owners, new Set([1]), []);
  expect(fog.visible.every((value, i) => value === full.visible[i])).toBe(true);
  expect(fog.visible[tile]).toBe(0);
  expect(fog.dirtyChunks.size).toBeLessThan(16);
});
