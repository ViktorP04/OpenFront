import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
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
    expect(v[20 * 80 + 12]).toBeGreaterThan(0);
    expect(v[20 * 80 + 13]).toBe(0);
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

it("updates mobile scouting coverage and hides enemies again after the scout leaves", () => {
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
  expect(game.frameData().units.has(12)).toBe(false);
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
