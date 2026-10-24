import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { unitVisionRadius } from "@openfront/engine-lib/game/FogOfWarRules";
import { GameMapImpl } from "@openfront/engine-lib/game/GameMapImpl";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { MoveWarshipExecution } from "@openfront/engine/execution/MoveWarshipExecution";
import { NationAllianceBehavior } from "@openfront/engine/execution/nation/NationAllianceBehavior";
import { NationAttackBehavior } from "@openfront/engine/execution/nation/NationAttackBehavior";
import { NationCustomUnitBehavior } from "@openfront/engine/execution/nation/NationCustomUnitBehavior";
import { NationEmojiBehavior } from "@openfront/engine/execution/nation/NationEmojiBehavior";
import { NationWarshipBehavior } from "@openfront/engine/execution/nation/NationWarshipBehavior";
import { TransportShipExecution } from "@openfront/engine/execution/TransportShipExecution";
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

function islands(mini = false) {
  const width = mini ? 120 : 240,
    height = mini ? 60 : 120,
    scale = mini ? 2 : 1;
  const land = (x: number) =>
    (x * scale >= 4 && x * scale <= 24) ||
    (x * scale >= 140 && x * scale <= 160);
  const terrain = new Uint8Array(width * height);
  let count = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const shore =
        (x > 0 && land(x - 1) !== land(x)) ||
        (x + 1 < width && land(x + 1) !== land(x));
      terrain[y * width + x] = (land(x) ? 128 : 32) | (shore ? 64 : 0);
      if (land(x)) count++;
    }
  return new GameMapImpl(width, height, terrain, count);
}
let game: Game, ai: Player, enemy: Player, ally: Player;
const at = (x: number, y = 60) => game.ref(x, y);
const landing = () => at(140);
function behavior(seed = 42) {
  const random = new PseudoRandom(seed);
  const emoji = new NationEmojiBehavior(random, game, ai);
  const warships = new NationWarshipBehavior(random, game, ai, emoji);
  const alliances = new NationAllianceBehavior(random, game, ai, emoji);
  const attacks = new NationAttackBehavior(
    random,
    game,
    ai,
    0,
    0,
    0,
    alliances,
    emoji,
    warships,
  );
  return { warships, attacks };
}
beforeEach(async () => {
  const infos = [
    new PlayerInfo("AI", PlayerType.Nation, null, "ai"),
    new PlayerInfo("Enemy", PlayerType.Human, "enemy001", "enemy"),
    new PlayerInfo("Ally", PlayerType.Nation, null, "ally"),
  ];
  const template = await setup(
    "ocean_and_land",
    { fogOfWar: true, instantBuild: true, difficulty: Difficulty.Hard },
    infos,
  );
  game = createGame(
    infos,
    [],
    islands(),
    islands(true),
    new TestConfig(template.config().gameConfig(), false),
  );
  game.endSpawnPhase();
  ai = game.player("ai");
  enemy = game.player("enemy");
  ally = game.player("ally");
  for (let x = 4; x <= 24; x++)
    for (let y = 0; y < game.height(); y++) ai.conquer(at(x, y));
  for (let x = 140; x <= 160; x++)
    for (let y = 0; y < game.height(); y++) enemy.conquer(at(x, y));
  ally.conquer(at(150, 110));
  ai.addGold(10_000_000n);
  ai.setTroops(100_000);
  enemy.setTroops(10_000);
});

it("occasionally builds all custom units, upgrades defenses, and caps their numbers", () => {
  ai.addGold(100_000_000n);
  ai.buildUnit(UnitType.Port, at(24), {});
  const custom = new NationCustomUnitBehavior(new PseudoRandom(42), game, ai);
  for (let i = 0; i < 2000; i++) {
    custom.act();
    executeTicks(game, 2);
  }
  for (const type of [
    UnitType.CoastalBattery,
    UnitType.RadarStation,
    UnitType.Submarine,
  ]) {
    expect(ai.units(type).length).toBeGreaterThan(0);
    expect(ai.units(type).length).toBeLessThanOrEqual(2);
  }
  for (const type of [UnitType.CoastalBattery, UnitType.RadarStation]) {
    expect(ai.units(type).some((unit) => unit.level() === 3)).toBe(true);
  }
});

it("respects disabled custom units and only buys radar in fog games", () => {
  ai.buildUnit(UnitType.Port, at(24), {});
  game.config().gameConfig().fogOfWar = false;
  game.config().gameConfig().disabledUnits = [
    UnitType.Submarine,
    UnitType.CoastalBattery,
  ];
  const custom = new NationCustomUnitBehavior(new PseudoRandom(42), game, ai);
  for (let i = 0; i < 500; i++) {
    expect(custom.act()).toBe(false);
    executeTicks(game, 2);
  }
  expect(
    ai.units(
      UnitType.Submarine,
      UnitType.CoastalBattery,
      UnitType.RadarStation,
    ),
  ).toHaveLength(0);
});

it("does not spend on custom units before establishing an economy", () => {
  const custom = new NationCustomUnitBehavior(new PseudoRandom(42), game, ai);
  for (let i = 0; i < 200; i++) expect(custom.act()).toBe(false);
  executeTicks(game, 2);
  expect(
    ai.units(
      UnitType.Submarine,
      UnitType.CoastalBattery,
      UnitType.RadarStation,
    ),
  ).toHaveLength(0);
});

it("keeps a gold reserve instead of spending the last savings on custom units", () => {
  ai.buildUnit(UnitType.Port, at(24), {});
  ai.removeGold(ai.gold());
  ai.addGold(200_000n);
  const custom = new NationCustomUnitBehavior(new PseudoRandom(42), game, ai);
  for (let i = 0; i < 200; i++) expect(custom.act()).toBe(false);
  executeTicks(game, 2);
  expect(
    ai.units(
      UnitType.Submarine,
      UnitType.CoastalBattery,
      UnitType.RadarStation,
    ),
  ).toHaveLength(0);
  expect(ai.gold()).toBe(200_000n);
});

it("sends an idle submarine toward a visible military target and preserves its voyage", () => {
  ai.buildUnit(UnitType.Port, at(24), {});
  const sub = ai.buildUnit(UnitType.Submarine, at(45), { patrolTile: at(45) });
  enemy.buildUnit(UnitType.TransportShip, at(65), { troops: 1000 });
  const custom = new NationCustomUnitBehavior(new PseudoRandom(42), game, ai);
  for (let i = 0; i < 500 && sub.warshipState().patrolTile !== at(65); i++) {
    custom.act();
    executeTicks(game, 2);
  }
  expect(sub.warshipState().patrolTile).toBe(at(65));
  for (let i = 0; i < 200; i++) custom.act();
  executeTicks(game, 2);
  expect(sub.warshipState().patrolTile).toBe(at(65));
});

it("rejects a blind AI invasion without spending troops, then allows it once a scout sees the coast", () => {
  const troops = ai.troops();
  game.addExecution(new TransportShipExecution(ai, landing(), 1000));
  executeTicks(game, 2);
  expect(ai.units(UnitType.TransportShip)).toHaveLength(0);
  expect(ai.troops()).toBe(troops);
  const scout = ai.buildUnit(UnitType.Warship, at(115), {
    patrolTile: at(115),
  });
  expect(hasTileVision(game, ai, landing())).toBe(true);
  game.addExecution(new TransportShipExecution(ai, landing(), 1000));
  executeTicks(game, 2);
  expect(ai.units(UnitType.TransportShip)).toHaveLength(1);
  scout.delete();
  expect(hasTileVision(game, ai, landing())).toBe(true); // recent scout trail
  executeTicks(game, 3);
  expect(ai.units(UnitType.TransportShip)).toHaveLength(1); // an existing voyage may continue
});

it("preserves ship trails through snapshots and expires them for AI transport rules", () => {
  const scout = ai.buildUnit(UnitType.Warship, at(115), {
    patrolTile: at(115),
  });
  executeTicks(game, 2);
  scout.delete();
  executeTicks(game, 1);
  const bytes = snapshotGame(game);
  const restored = restoreGame(bytes, {
    gameMap: islands(),
    miniGameMap: islands(true),
    config: (config) => new TestConfig(config, false),
  });
  expect(hasTileVision(restored, restored.player("ai"), landing())).toBe(true);
  expect(diffSnapshots(bytes, snapshotGame(restored))).toEqual([]);
  executeTicks(game, 98);
  executeTicks(restored, 98);
  expect(hasTileVision(game, ai, landing())).toBe(true);
  executeTicks(game, 1);
  executeTicks(restored, 1);
  expect(hasTileVision(game, ai, landing())).toBe(false);
  expect(hasTileVision(restored, restored.player("ai"), landing())).toBe(false);
  expect(diffSnapshots(snapshotGame(game), snapshotGame(restored))).toEqual([]);
});

it("gives submarines seventy tiles of coastal scouting without revealing hidden subs", () => {
  const sub = ai.buildUnit(UnitType.Submarine, at(80), { patrolTile: at(80) });
  expect(hasTileVision(game, ai, landing())).toBe(true);
  expect(hasTileVision(game, ai, at(150))).toBe(true);
  expect(hasTileVision(game, ai, at(151))).toBe(false);
  sub.delete();
});

it("matches the rendered trail mask after ships move away", () => {
  const scout = ai.buildUnit(UnitType.Submarine, at(80), {
    patrolTile: at(80),
  });
  executeTicks(game, 2);
  scout.move(at(210));
  executeTicks(game, 2);
  const mask = new FogOfWar(game.width(), game.height());
  const owners = new Uint16Array(game.width() * game.height());
  for (let tile = 0; tile < owners.length; tile++)
    owners[tile] = game.ownerID(tile);
  const friendly = new Set([ai.smallID()]);
  const vision = mask.update(owners, friendly, [
    { pos: scout.tile(), radius: unitVisionRadius(scout.type()) },
  ]);
  mask.addSources(game.shipVisionTrails().sources(game.ticks(), friendly));
  for (let y = 0; y < game.height(); y += 7)
    for (let x = 0; x < game.width(); x += 7)
      expect(hasTileVision(game, ai, at(x, y)), `tile ${x},${y}`).toBe(
        vision[at(x, y)] !== 0,
      );
});

it("applies the same launch rule to human players and leaves non-fog games unchanged", () => {
  expect(hasTileVision(game, enemy, at(24))).toBe(false);
  game.addExecution(new TransportShipExecution(enemy, at(24), 1000));
  executeTicks(game, 2);
  expect(enemy.units(UnitType.TransportShip)).toHaveLength(0);
  game.config().gameConfig().fogOfWar = false;
  game.addExecution(new TransportShipExecution(ai, landing(), 1000));
  executeTicks(game, 2);
  expect(ai.units(UnitType.TransportShip)).toHaveLength(1);
});

it("shares allied radar coverage, respects upgrades and construction, and revokes vision after an alliance ends", () => {
  const radar = ally.buildUnit(UnitType.RadarStation, at(150, 110), {});
  expect(hasTileVision(game, ai, landing())).toBe(false);
  ai.createAllianceRequest(ally)!.accept();
  expect(hasTileVision(game, ai, landing())).toBe(true);
  radar.setUnderConstruction(true);
  expect(hasTileVision(game, ai, landing())).toBe(false);
  radar.setUnderConstruction(false);
  radar.delete();
  const own = ai.buildUnit(UnitType.RadarStation, at(4, 0), {});
  const far = at(160, 100);
  expect(hasTileVision(game, ai, far)).toBe(false);
  own.increaseLevel();
  expect(hasTileVision(game, ai, far)).toBe(true);
  own.delete();
  const remote = ally.buildUnit(UnitType.RadarStation, at(150, 110), {});
  expect(hasTileVision(game, ai, landing())).toBe(true);
  ai.breakAlliance(ai.allianceWith(ally)!);
  expect(remote.isActive()).toBe(true);
  expect(hasTileVision(game, ai, landing())).toBe(false);
});

it("matches the client vision mask across territory, trade ships, scouts, and radar", () => {
  ai.buildUnit(UnitType.TradeShip, at(65, 20), {
    targetUnit: enemy.buildUnit(UnitType.Port, at(140, 20), {}),
  });
  ai.buildUnit(UnitType.Warship, at(110, 80), { patrolTile: at(110, 80) });
  ai.buildUnit(UnitType.RadarStation, at(4, 0), {}).increaseLevel();
  const mask = new FogOfWar(game.width(), game.height());
  const owners = new Uint16Array(game.width() * game.height());
  for (let tile = 0; tile < owners.length; tile++)
    owners[tile] = game.ownerID(tile);
  const sources = ai.units().map((u) => ({
    pos: u.tile(),
    radius: unitVisionRadius(u.type(), u.level()),
  }));
  const vision = mask.update(owners, new Set([ai.smallID()]), sources);
  for (let y = 0; y < game.height(); y += 7)
    for (let x = 0; x < game.width(); x += 7) {
      const tile = at(x, y);
      expect(hasTileVision(game, ai, tile), `tile ${x},${y}`).toBe(
        vision[tile] !== 0,
      );
    }
});

it("filters hidden landing routes and beachheads at Hard difficulty", () => {
  const { attacks } = behavior();
  expect((attacks as any).boatRoute(enemy)).toBeNull();
  expect((attacks as any).sendBeachhead(enemy, landing())).toBe(false);
  ai.buildUnit(UnitType.Warship, at(115), { patrolTile: at(115) });
  expect((attacks as any).boatRoute(enemy)?.landing).toBeDefined();
  expect((attacks as any).sendBeachhead(enemy, landing())).toBe(true);
  executeTicks(game, 2);
  expect(ai.units(UnitType.TransportShip)).toHaveLength(1);
});

it("builds a scouting warship before an unseen landing and resumes its voyage deterministically", () => {
  ai.buildUnit(UnitType.Port, at(24), {});
  const { warships } = behavior(7);
  const gold = ai.gold();
  const price = game.unitInfo(UnitType.Warship).cost(game, ai);
  expect(warships.maybeSpawnWarship()).toBe(true);
  executeTicks(game, 2);
  const scout = ai.units(UnitType.Warship)[0];
  expect(scout).toBeDefined();
  expect(ai.gold()).toBe(gold - price);
  expect(scout.tile()).toBe(at(24));
  expect(hasTileVision(game, ai, scout.warshipState().patrolTile!)).toBe(false);
  // Order a deterministic voyage to an undiscovered public coastline.
  game.addExecution(new MoveWarshipExecution(ai, [scout.id()], at(125)));
  executeTicks(game, 1);
  const bytes = snapshotGame(game);
  const restored = restoreGame(bytes, {
    gameMap: islands(),
    miniGameMap: islands(true),
    config: (gc) => new TestConfig(gc, false),
  });
  expect(diffSnapshots(bytes, snapshotGame(restored))).toEqual([]);
  for (let i = 0; i < 60; i++) {
    game.executeNextTick();
    restored.executeNextTick();
  }
  expect(diffSnapshots(snapshotGame(game), snapshotGame(restored))).toEqual([]);
});

it("does not buy scouting ships if warships are disabled", () => {
  ai.buildUnit(UnitType.Port, at(24), {});
  game.config().gameConfig().disabledUnits = [UnitType.Warship];
  expect(behavior().warships.maybeSpawnWarship()).toBe(false);
  executeTicks(game, 2);
  expect(ai.units(UnitType.Warship)).toHaveLength(0);
});

it.each([7, 42, 1337])(
  "autonomously scouts across the sea before launching an invasion (seed %s)",
  (seed) => {
    ai.buildUnit(UnitType.Port, at(24), {});
    const { warships, attacks } = behavior(seed);
    expect((attacks as any).sendBoatAttack(enemy)).toBe(false);
    let launched = false;
    let hadScout = false;
    for (let tick = 0; tick < 1000 && !launched; tick++) {
      if (tick % 40 === 0) {
        warships.maybeSpawnWarship();
        attacks.sendAttack(enemy, true);
      }
      game.executeNextTick();
      hadScout ||= ai.units(UnitType.Warship).length > 0;
      launched ||= ai.units(UnitType.TransportShip).length > 0;
    }
    expect(hadScout).toBe(true);
    expect(launched).toBe(true);
  },
);

it("leaves existing voyages and ships in combat or repair retreat alone", () => {
  ai.buildUnit(UnitType.Port, at(24), {});
  const fighting = ai.buildUnit(UnitType.Warship, at(60), {
    patrolTile: at(60),
  });
  const repairing = ai.buildUnit(UnitType.Warship, at(65), {
    patrolTile: at(90),
  });
  fighting.updateWarshipState({ isInCombat: true });
  repairing.updateWarshipState({ state: "retreating", retreatPort: at(24) });
  const warships = behavior().warships;
  expect(warships.maybeSpawnWarship()).toBe(false);
  executeTicks(game, 2);
  expect(fighting.warshipState().patrolTile).toBe(at(60));
  expect(repairing.warshipState().state).toBe("retreating");
  fighting.updateWarshipState({ isInCombat: false, patrolTile: at(120) });
  expect(warships.maybeSpawnWarship()).toBe(false);
  executeTicks(game, 2);
  expect(fighting.warshipState().patrolTile).toBe(at(120));
});
