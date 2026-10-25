import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameMapImpl } from "@openfront/engine-lib/game/GameMapImpl";
import {
  SATELLITE_VISION,
  satellitePosition,
  satelliteOrbitSegments,
} from "@openfront/engine-lib/game/SatelliteOrbit";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { SatelliteExecution } from "@openfront/engine/execution/SatelliteExecution";
import { hasTileVision } from "@openfront/engine/game/FogOfWar";
import { Game, Player } from "@openfront/engine/game/Game";
import { createGame } from "@openfront/engine/game/GameImpl";
import {
  snapshotGame,
  restoreGame,
} from "@openfront/engine/snapshot/GameSnapshot";
import { FogOfWar } from "../src/client/view/FogOfWar";
import { setup } from "./util/Setup";
import { diffSnapshots } from "./util/Snapshot";
import { TestConfig } from "./util/TestConfig";
import { executeTicks } from "./util/utils";

function map(mini = false) {
  const width = mini ? 400 : 800,
    height = mini ? 200 : 400;
  return new GameMapImpl(
    width,
    height,
    new Uint8Array(width * height).fill(128),
    width * height,
  );
}
let game: Game, a: Player, b: Player;
const at = (x: number, y = 200) => game.ref(x, y);
beforeEach(async () => {
  const infos = [
    new PlayerInfo("A", PlayerType.Human, "sat00001", "a"),
    new PlayerInfo("B", PlayerType.Human, "sat00002", "b"),
  ];
  const template = await setup(
    "ocean_and_land",
    { fogOfWar: true, instantBuild: true },
    infos,
  );
  game = createGame(
    infos,
    [],
    map(),
    map(true),
    new TestConfig(template.config().gameConfig(), false),
  );
  game.endSpawnPhase();
  a = game.player("a");
  b = game.player("b");
  a.conquer(at(20));
  b.conquer(at(500));
  a.addGold(20_000_000n);
  b.addGold(20_000_000n);
});

it("requires an owned completed ready silo, spends gold once, and uses its launch slot", () => {
  expect(a.canBuild(UnitType.Satellite, at(400))).toBe(false);
  b.buildUnit(UnitType.MissileSilo, at(500), {});
  expect(a.canBuild(UnitType.Satellite, at(400))).toBe(false);
  const silo = a.buildUnit(UnitType.MissileSilo, at(20), {});
  silo.setUnderConstruction(true);
  expect(a.canBuild(UnitType.Satellite, at(400))).toBe(false);
  silo.setUnderConstruction(false);
  expect(a.canBuild(UnitType.Satellite, silo.tile())).toBe(false);
  expect(a.canBuild(UnitType.Satellite, at(400))).toBe(silo.tile());
  const gold = a.gold();
  game.addExecution(new ConstructionExecution(a, UnitType.Satellite, at(400)));
  executeTicks(game, 4);
  const satellite = a.units(UnitType.Satellite)[0];
  expect(satellite).toBeDefined();
  expect(satellite.isTargetable()).toBe(false);
  expect(a.gold()).toBe(gold - 1_000_000n);
  expect(silo.missileTimerQueue()).toHaveLength(1);
  expect(a.canBuild(UnitType.Satellite, at(400))).toBe(false);
  expect(game.unitInfo(UnitType.Satellite).cost(game, a)).toBe(2_000_000n);
});

it("respects disabled satellites, fog mode, and affordability", () => {
  a.buildUnit(UnitType.MissileSilo, at(20), {});
  game.config().gameConfig().disabledUnits = [UnitType.Satellite];
  expect(a.canBuild(UnitType.Satellite, at(400))).toBe(false);
  game.config().gameConfig().disabledUnits = [];
  game.config().gameConfig().fogOfWar = false;
  expect(a.canBuild(UnitType.Satellite, at(400))).toBe(false);
  game.config().gameConfig().fogOfWar = true;
  a.removeGold(a.gold());
  expect(a.canBuild(UnitType.Satellite, at(400))).toBe(false);
  game.addExecution(new SatelliteExecution(a, at(400)));
  executeTicks(game, 2);
  expect(a.units(UnitType.Satellite)).toHaveLength(0);
});

it.each([UnitType.RadarStation, UnitType.Satellite] as const)(
  "rejects %s purchase intents without fog and spends no gold or silo slots",
  (type) => {
    const silo = a.buildUnit(UnitType.MissileSilo, at(20), {});
    a.conquer(at(80));
    game.config().gameConfig().fogOfWar = false;
    const target = type === UnitType.RadarStation ? at(80) : at(400);
    const gold = a.gold();
    expect(a.buildableUnits(target, [type])[0].canBuild).toBe(false);
    game.addExecution(new ConstructionExecution(a, type, target));
    executeTicks(game, 4);
    expect(a.units(type)).toHaveLength(0);
    expect(a.gold()).toBe(gold);
    expect(silo.missileTimerQueue()).toHaveLength(0);
  },
);

it("does not offer upgrades for an existing radar when fog is off", () => {
  a.conquer(at(80));
  const radar = a.buildUnit(UnitType.RadarStation, at(80), {});
  expect(a.canUpgradeUnit(radar)).toBe(true);
  game.config().gameConfig().fogOfWar = false;
  expect(a.canUpgradeUnit(radar)).toBe(false);
  const offer = a.buildableUnits(radar.tile(), [UnitType.RadarStation])[0];
  expect(offer.canBuild).toBe(false);
  expect(offer.canUpgrade).toBe(false);
});

it("keeps orbiting after losing the silo and resumes identically through map seams", () => {
  const silo = a.buildUnit(UnitType.MissileSilo, at(20), {});
  game.addExecution(new SatelliteExecution(a, at(120, 150)));
  executeTicks(game, 10);
  silo.delete();
  const bytes = snapshotGame(game);
  const restored = restoreGame(bytes, {
    gameMap: map(),
    miniGameMap: map(true),
    config: (gc) => new TestConfig(gc, false),
  });
  expect(diffSnapshots(bytes, snapshotGame(restored))).toEqual([]);
  executeTicks(game, 900);
  executeTicks(restored, 900);
  expect(diffSnapshots(snapshotGame(game), snapshotGame(restored))).toEqual([]);
  const expected = satellitePosition(
    800,
    400,
    20,
    200,
    100,
    -50,
    game.ticks() - 1,
  );
  expect(a.units(UnitType.Satellite)[0].tile()).toBe(
    at(expected.x, expected.y),
  );
});

it("provides moving allied vision matching the client, including wrapped map edges", () => {
  const satellite = a.buildUnit(UnitType.Satellite, at(20), {});
  const mask = new FogOfWar(800, 400);
  const owners = new Uint16Array(800 * 400);
  owners[at(20)] = a.smallID();
  const vision = mask.update(owners, new Set([a.smallID()]), [
    { pos: satellite.tile(), radius: SATELLITE_VISION, wrap: true },
  ]);
  for (let y = 0; y < 400; y += 23)
    for (let x = 0; x < 800; x += 23)
      expect(hasTileVision(game, a, at(x, y)), `tile ${x},${y}`).toBe(
        vision[at(x, y)] !== 0,
      );
  expect(hasTileVision(game, a, at(799))).toBe(true);
  expect(hasTileVision(game, b, at(799))).toBe(false);
  a.createAllianceRequest(b)!.accept();
  expect(hasTileVision(game, b, at(799))).toBe(true);
  a.breakAlliance(a.allianceWith(b)!);
  satellite.move(at(400));
  expect(hasTileVision(game, a, at(799))).toBe(false);
  expect(hasTileVision(game, a, at(400))).toBe(true);
});

it("previews the same launch direction without drawing lines across wrapping seams", () => {
  expect(satellitePosition(100, 60, 90, 30, 30, 0, 20)).toEqual({
    x: 10,
    y: 30,
  });
  expect(satellitePosition(100, 60, 5, 5, -10, -10, 10)).toEqual({
    x: 95,
    y: 55,
  });
  const segments = satelliteOrbitSegments(100, 60, 90, 30, 95, 30);
  expect(segments).toEqual([
    [90.5, 30.5, 100, 30.5],
    [0, 30.5, 90.5, 30.5],
  ]);
  expect(satelliteOrbitSegments(100, 60, 5, 5, 5, 5)).toEqual([]);
  const wide = satelliteOrbitSegments(1000, 100, 20, 20, 70, 70);
  expect(wide.length).toBeGreaterThan(5);
  expect(
    wide.reduce((distance, [x, , nx]) => distance + nx - x, 0),
  ).toBeCloseTo(1000);
});
