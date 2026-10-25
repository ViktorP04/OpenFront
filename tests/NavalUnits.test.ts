import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameMapImpl } from "@openfront/engine-lib/game/GameMapImpl";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { MoveWarshipExecution } from "@openfront/engine/execution/MoveWarshipExecution";
import {
  CoastalBatteryExecution,
  SubmarineExecution,
} from "@openfront/engine/execution/NavalUnitsExecution";
import { SetSubmarineModeExecution } from "@openfront/engine/execution/SetSubmarineModeExecution";
import { UpgradeStructureExecution } from "@openfront/engine/execution/UpgradeStructureExecution";
import { WarshipExecution } from "@openfront/engine/execution/WarshipExecution";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { createGame } from "@openfront/engine/game/GameImpl";
import {
  snapshotGame,
  restoreGame,
} from "@openfront/engine/snapshot/GameSnapshot";
import {
  decodeSnapshotValue,
  encodeSnapshotValue,
} from "@openfront/engine/snapshot/SnapshotCodec";
import { setup } from "./util/Setup";
import { diffSnapshots } from "./util/Snapshot";
import { TestConfig } from "./util/TestConfig";
import { executeTicks } from "./util/utils";

function navalMap(mini = false) {
  const width = mini ? 40 : 160,
    height = mini ? 25 : 100,
    coast = mini ? 2 : 8;
  const terrain = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      terrain[y * width + x] =
        (x < coast ? 128 : 32) | (x === coast - 1 || x === coast ? 64 : 0);
  return new GameMapImpl(width, height, terrain, coast * height);
}
async function navalRoundTrip(game: Game, ticks: number) {
  const bytes = snapshotGame(game);
  const restored = restoreGame(bytes, {
    gameMap: navalMap(),
    miniGameMap: navalMap(true),
    config: (gc) => new TestConfig(gc, false),
  });
  expect(diffSnapshots(bytes, snapshotGame(restored))).toEqual([]);
  for (let i = 0; i < ticks; i++) {
    game.executeNextTick();
    restored.executeNextTick();
    expect(diffSnapshots(snapshotGame(game), snapshotGame(restored))).toEqual(
      [],
    );
  }
}

let game: Game;
let a: Player;
let b: Player;
let tradeDestination: Unit;
beforeEach(async () => {
  const humans = [
    new PlayerInfo("CaptainA", PlayerType.Human, "naval001", "a"),
    new PlayerInfo("CaptainB", PlayerType.Human, "naval002", "b"),
  ];
  const template = await setup(
    "ocean_and_land",
    { infiniteGold: true },
    humans,
  );
  game = createGame(
    humans,
    [],
    navalMap(),
    navalMap(true),
    new TestConfig(template.config().gameConfig(), false),
  );
  game.endSpawnPhase();
  a = game.player("a");
  b = game.player("b");
  for (let x = 0; x <= 7; x++)
    for (let y = 8; y < 40; y++)
      if (game.isLand(game.ref(x, y))) a.conquer(game.ref(x, y));
  for (let x = 0; x <= 7; x++)
    for (let y = 70; y < 95; y++)
      if (game.isLand(game.ref(x, y))) b.conquer(game.ref(x, y));
  tradeDestination = b.buildUnit(UnitType.Port, game.ref(7, 80), {});
});
const at = (x: number, y: number) => game.ref(x, y);
const subAt = (owner: Player, x = 60, y = 20) => {
  const sub = owner.buildUnit(UnitType.Submarine, at(x, y), {
    patrolTile: at(x, y),
  });
  sub.updateWarshipState({ scoutMode: false });
  game.addExecution(new SubmarineExecution(sub));
  return sub;
};

it("scales naval costs and records separate build statistics", () => {
  const config = new EngineConfig(
    { ...game.config().gameConfig(), infiniteGold: false },
    false,
  );
  expect(config.unitInfo(UnitType.Submarine).cost(game, a)).toBe(350000n);
  expect(config.unitInfo(UnitType.CoastalBattery).cost(game, a)).toBe(200000n);
  a.buildUnit(UnitType.Submarine, at(60, 20), { patrolTile: at(60, 20) });
  a.buildUnit(UnitType.CoastalBattery, at(7, 20), {});
  expect(config.unitInfo(UnitType.Submarine).cost(game, a)).toBe(700000n);
  expect(config.unitInfo(UnitType.CoastalBattery).cost(game, a)).toBe(400000n);
  expect(game.stats().stats()[a.clientID()!]?.units?.sub?.[0]).toBe(1n);
  expect(game.stats().stats()[a.clientID()!]?.units?.coast?.[0]).toBe(1n);
});

describe("Coastal Battery", () => {
  it("ignores nearby trade ships while firing on military transports", () => {
    const battery = a.buildUnit(UnitType.CoastalBattery, at(7, 20), {});
    game.addExecution(new CoastalBatteryExecution(battery));
    const trade = b.buildUnit(UnitType.TradeShip, at(20, 20), {
      targetUnit: tradeDestination,
    });
    executeTicks(game, 70);
    expect(trade.isActive()).toBe(true);
    expect(battery.targetUnit()).toBeUndefined();
    const transport = b.buildUnit(UnitType.TransportShip, at(25, 20), {
      troops: 1000,
    });
    executeTicks(game, 30);
    expect(transport.isActive()).toBe(false);
    expect(trade.isActive()).toBe(true);
    expect(trade.owner()).toBe(b);
  });

  it("regenerates slowly after a damage-free delay, resets on new damage, and preserves timers through snapshots", async () => {
    const battery = a.buildUnit(UnitType.CoastalBattery, at(7, 20), {});
    game.addExecution(new CoastalBatteryExecution(battery));
    executeTicks(game, 2);
    battery.modifyHealth(-100);
    executeTicks(game, 300);
    expect(battery.health()).toBe(700);
    executeTicks(game, 1);
    expect(battery.health()).toBe(705);
    executeTicks(game, 10);
    expect(battery.health()).toBe(710);
    battery.modifyHealth(-10);
    executeTicks(game, 250);
    expect(battery.health()).toBe(700);
    await navalRoundTrip(game, 51);
    expect(battery.health()).toBe(705);
    battery.modifyHealth(94);
    executeTicks(game, 10);
    expect(battery.health()).toBe(800);
  });

  it("does not regenerate during construction or after destruction", () => {
    const battery = a.buildUnit(UnitType.CoastalBattery, at(7, 20), {});
    battery.modifyHealth(-100);
    battery.setUnderConstruction(true);
    game.addExecution(new CoastalBatteryExecution(battery));
    executeTicks(game, 400);
    expect(battery.health()).toBe(700);
    battery.setUnderConstruction(false);
    executeTicks(game, 300);
    expect(battery.health()).toBe(700);
    executeTicks(game, 1);
    expect(battery.health()).toBe(705);
    battery.modifyHealth(-800, b);
    executeTicks(game, 400);
    expect(battery.isActive()).toBe(false);
    expect(battery.health()).toBe(0);
  });
  it("can exchange fire with a warship and be destroyed", () => {
    const battery = a.buildUnit(UnitType.CoastalBattery, at(7, 20), {});
    expect(battery.health()).toBe(800);
    const warship = b.buildUnit(UnitType.Warship, at(35, 20), {
      patrolTile: at(35, 20),
    });
    tradeDestination.delete(); // Keep this engagement at sea rather than retreating to repair.
    game.addExecution(new CoastalBatteryExecution(battery));
    const execution = new WarshipExecution(warship);
    vi.spyOn(execution as any, "patrol").mockImplementation(() => {});
    game.addExecution(execution);
    executeTicks(game, 50);
    expect(warship.health()).toBeLessThan(warship.maxHealth());
    expect(battery.health()).toBeLessThan(800);
    executeTicks(game, 150);
    expect(battery.isActive()).toBe(false);
  });

  it("lets submarines destroy batteries within torpedo range without attacking other structures", async () => {
    const battery = a.buildUnit(UnitType.CoastalBattery, at(7, 20), {});
    const city = a.buildUnit(UnitType.City, at(4, 20), {});
    const sub = subAt(b, 60, 20);
    game.addExecution(new CoastalBatteryExecution(battery));
    executeTicks(game, 30);
    expect(battery.health()).toBeLessThan(800);
    expect(battery.isActive()).toBe(true);
    await navalRoundTrip(game, 150);
    expect(battery.isActive()).toBe(false);
    expect(city.isActive()).toBe(true);
    expect(sub.isActive()).toBe(true);
  });

  it("hides unseen batteries from warships until they open fire through fog", () => {
    game.config().gameConfig().fogOfWar = true;
    const battery = a.buildUnit(UnitType.CoastalBattery, at(7, 20), {});
    const warship = b.buildUnit(UnitType.Warship, at(90, 20), {
      patrolTile: at(90, 20),
    });
    const execution = new WarshipExecution(warship);
    execution.init(game, game.ticks());
    expect((execution as any).findTargetUnit()).toBeUndefined();
    battery.increaseLevel();
    battery.increaseLevel();
    const gun = new CoastalBatteryExecution(battery);
    gun.init(game);
    gun.tick(game.ticks());
    expect(battery.targetUnit()).toBe(warship);
    expect((execution as any).findTargetUnit()).toBe(battery);
  });

  it("does not fire on friendly batteries", () => {
    const battery = a.buildUnit(UnitType.CoastalBattery, at(7, 20), {});
    subAt(a, 40, 20);
    const warship = a.buildUnit(UnitType.Warship, at(45, 20), {
      patrolTile: at(45, 20),
    });
    game.addExecution(new WarshipExecution(warship));
    executeTicks(game, 150);
    expect(battery.health()).toBe(800);
  });

  it("restores legacy batteries with full health and preserves damage in new saves", () => {
    const battery = a.buildUnit(UnitType.CoastalBattery, at(7, 20), {});
    const root = decodeSnapshotValue(snapshotGame(game)) as {
      units: { v: number; d: { type: UnitType; health: bigint } }[];
    };
    const saved = root.units.find(
      (unit) => unit.d.type === UnitType.CoastalBattery,
    )!;
    saved.v = 1;
    saved.d.health = 1n;
    const restore = (bytes: Uint8Array) =>
      restoreGame(bytes, {
        gameMap: navalMap(),
        miniGameMap: navalMap(true),
        config: (gc) => new TestConfig(gc, false),
      });
    expect(
      restore(encodeSnapshotValue(root)).unit(battery.id())!.health(),
    ).toBe(800);
    battery.modifyHealth(-799);
    expect(restore(snapshotGame(game)).unit(battery.id())!.health()).toBe(1);
  });
  it("requires owned shoreline land, spacing, and the unit to be enabled", () => {
    expect(game.isLand(at(7, 20))).toBe(true);
    expect(game.isWater(at(8, 20))).toBe(true);
    const shore = a.canBuild(UnitType.CoastalBattery, at(7, 20));
    expect(shore).not.toBe(false);
    if (shore === false) throw new Error("No battery spawn");
    expect(game.neighbors(shore).some((tile) => game.isWater(tile))).toBe(true);
    expect(a.canBuild(UnitType.CoastalBattery, at(60, 20))).toBe(false);
    expect(a.canBuild(UnitType.CoastalBattery, at(7, 80))).toBe(false);
    a.buildUnit(UnitType.CoastalBattery, shore, {});
    expect(a.canBuild(UnitType.CoastalBattery, shore)).toBe(false);
    game.config().gameConfig().disabledUnits = [UnitType.CoastalBattery];
    expect(a.canBuild(UnitType.CoastalBattery, at(7, 38))).toBe(false);
  });
  it("finishes construction before firing and destroys hostile shipping", () => {
    game.addExecution(
      new ConstructionExecution(a, UnitType.CoastalBattery, at(7, 20)),
    );
    executeTicks(game, 2);
    const battery = a.units(UnitType.CoastalBattery)[0];
    expect(battery.isUnderConstruction()).toBe(true);
    const ship = b.buildUnit(UnitType.TransportShip, at(20, 20), {
      troops: 1000,
    });
    executeTicks(game, 50);
    expect(ship.isActive()).toBe(true);
    executeTicks(game, 55);
    expect(battery.isUnderConstruction()).toBe(false);
    expect(ship.isActive()).toBe(false);
  });
  it("ignores friendly ships and targets for its new owner after capture", () => {
    const battery = a.buildUnit(UnitType.CoastalBattery, at(7, 20), {});
    game.addExecution(new CoastalBatteryExecution(battery));
    const friendly = a.buildUnit(UnitType.TransportShip, at(20, 20), {
      troops: 1000,
    });
    executeTicks(game, 20);
    expect(friendly.isActive()).toBe(true);
    b.captureUnit(battery);
    executeTicks(game, 20);
    expect(friendly.isActive()).toBe(false);
    expect(battery.owner()).toBe(b);
  });
  it("does not shoot land structures or targets outside its range", () => {
    const battery = a.buildUnit(UnitType.CoastalBattery, at(7, 20), {});
    game.addExecution(new CoastalBatteryExecution(battery));
    const city = b.buildUnit(UnitType.City, at(3, 80), {});
    const ship = b.buildUnit(UnitType.TransportShip, at(130, 20), {
      troops: 1000,
    });
    executeTicks(game, 60);
    expect(city.isActive()).toBe(true);
    expect(ship.isActive()).toBe(true);
  });
});

describe("Submarine", () => {
  it("holds fire by default and can switch between scouting and attacking", async () => {
    const sub = a.buildUnit(UnitType.Submarine, at(60, 20), {
      patrolTile: at(60, 20),
    });
    const target = b.buildUnit(UnitType.TransportShip, at(67, 20), {
      troops: 1000,
    });
    game.addExecution(new SubmarineExecution(sub));
    executeTicks(game, 70);
    expect(sub.warshipState().scoutMode).toBe(true);
    expect(target.isActive()).toBe(true);
    expect(sub.isTargetable()).toBe(false);
    expect(sub.targetUnit()).toBeUndefined();
    game.addExecution(new SetSubmarineModeExecution(a, [sub.id()], false));
    executeTicks(game, 2);
    expect(sub.warshipState().scoutMode).toBe(false);
    expect(sub.isTargetable()).toBe(true);
    game.addExecution(new SetSubmarineModeExecution(a, [sub.id()], true));
    executeTicks(game, 2);
    expect(sub.targetUnit()).toBeUndefined();
    expect(sub.isTargetable()).toBe(true); // Switching modes does not erase firing reveal.
    await navalRoundTrip(game, 60);
    expect(target.isActive()).toBe(false); // Shells already fired still land.
    expect(sub.warshipState().scoutMode).toBe(true);
    expect(sub.isTargetable()).toBe(false);
  });

  it("only changes the selected owner's submarines and preserves pending mode commands in snapshots", async () => {
    const own = subAt(a);
    const other = subAt(b, 140, 20);
    const warship = a.buildUnit(UnitType.Warship, at(100, 20), {
      patrolTile: at(100, 20),
    });
    game.addExecution(
      new SetSubmarineModeExecution(
        a,
        [own.id(), other.id(), warship.id(), 99999],
        true,
      ),
    );
    await navalRoundTrip(game, 2);
    expect(own.warshipState().scoutMode).toBe(true);
    expect(other.warshipState().scoutMode).toBe(false);
    expect(warship.warshipState().scoutMode).toBeUndefined();
  });

  it("requires warships to approach within fifteen tiles to detect a scouting submarine", () => {
    const sub = a.buildUnit(UnitType.Submarine, at(60, 20), {
      patrolTile: at(60, 20),
    });
    game.addExecution(new SubmarineExecution(sub));
    const detector = b.buildUnit(UnitType.Warship, at(76, 20), {
      patrolTile: at(76, 20),
    });
    executeTicks(game, 2);
    expect(sub.isTargetable()).toBe(false);
    detector.move(at(75, 20));
    executeTicks(game, 2);
    expect(sub.isTargetable()).toBe(true);
    detector.move(at(76, 20));
    executeTicks(game, 2);
    expect(sub.isTargetable()).toBe(false);
    expect(detector.health()).toBe(detector.maxHealth());
  });

  it("keeps coastal battery detection at thirty-five tiles and excludes unfinished detectors", () => {
    const sub = a.buildUnit(UnitType.Submarine, at(42, 20), {
      patrolTile: at(42, 20),
    });
    const battery = b.buildUnit(UnitType.CoastalBattery, at(7, 20), {});
    game.addExecution(new SubmarineExecution(sub));
    executeTicks(game, 2);
    expect(sub.isTargetable()).toBe(true);
    battery.setUnderConstruction(true);
    executeTicks(game, 2);
    expect(sub.isTargetable()).toBe(false);
    expect(sub.targetUnit()).toBeUndefined();
  });
  it("builds only from a completed port and supports fleet move commands", () => {
    expect(a.canBuild(UnitType.Submarine, at(55, 20))).toBe(false);
    const port = a.buildUnit(UnitType.Port, at(7, 20), {});
    port.setUnderConstruction(true);
    expect(a.canBuild(UnitType.Submarine, at(55, 20))).toBe(false);
    port.setUnderConstruction(false);
    expect(a.canBuild(UnitType.Submarine, at(55, 20))).toBe(port.tile());
    game.addExecution(
      new ConstructionExecution(a, UnitType.Submarine, at(55, 20)),
    );
    executeTicks(game, 3);
    const sub = a.units(UnitType.Submarine)[0];
    expect(sub).toBeDefined();
    game.addExecution(new MoveWarshipExecution(a, [sub.id()], at(70, 20)));
    executeTicks(game, 3);
    expect(sub.warshipState().patrolTile).toBe(at(70, 20));
    const oldTile = sub.tile();
    executeTicks(game, 15);
    expect(sub.tile()).not.toBe(oldTile);
    expect(game.isWater(sub.tile())).toBe(true);
  });
  it("ignores enemy trade ships, attacks transports, and hides again after firing", () => {
    const sub = subAt(a);
    executeTicks(game, 2);
    expect(sub.isTargetable()).toBe(false);
    const trade = b.buildUnit(UnitType.TradeShip, at(62, 20), {
      targetUnit: tradeDestination,
    });
    executeTicks(game, 70);
    expect(sub.isTargetable()).toBe(false);
    expect(trade.isActive()).toBe(true);
    const transport = b.buildUnit(UnitType.TransportShip, at(67, 20), {
      troops: 1000,
    });
    executeTicks(game, 2);
    expect(sub.isTargetable()).toBe(true);
    executeTicks(game, 12);
    expect(transport.isActive()).toBe(false);
    expect(trade.isActive()).toBe(true);
    expect(trade.owner()).toBe(b);
    executeTicks(game, 55);
    expect(sub.isTargetable()).toBe(false);
    expect(sub.health()).toBe(600);
  });
  it("is detected at close range by enemy warships and coastal batteries", () => {
    const sub = subAt(a, 25, 20);
    executeTicks(game, 2);
    expect(sub.isTargetable()).toBe(false);
    const detector = b.buildUnit(UnitType.Warship, at(30, 20), {
      patrolTile: at(30, 20),
    });
    executeTicks(game, 2);
    expect(sub.isTargetable()).toBe(true);
    detector.delete();
    executeTicks(game, 70);
    expect(sub.isTargetable()).toBe(false);
    const battery = b.buildUnit(UnitType.CoastalBattery, at(7, 20), {});
    executeTicks(game, 2);
    expect(sub.isTargetable()).toBe(true);
    battery.setUnderConstruction(true);
    executeTicks(game, 2);
    expect(sub.isTargetable()).toBe(true); // Its return fire also reveals it.
    battery.delete();
    executeTicks(game, 55);
    expect(sub.isTargetable()).toBe(false);
  });
  it("can be countered by warships and does not fire on friendly shipping", () => {
    const sub = subAt(a);
    const friendly = a.buildUnit(UnitType.TradeShip, at(62, 20), {
      targetUnit: tradeDestination,
    });
    const warship = b.buildUnit(UnitType.Warship, at(65, 20), {
      patrolTile: at(65, 20),
    });
    game.addExecution(new WarshipExecution(warship));
    executeTicks(game, 140);
    expect(sub.isActive()).toBe(false);
    expect(friendly.owner()).toBe(a);
  });
  it("preserves movement, stealth, reload timers and projectiles through snapshots", async () => {
    const sub = subAt(a);
    b.buildUnit(UnitType.TransportShip, at(75, 20), {
      troops: 1000,
    });
    game.addExecution(
      new CoastalBatteryExecution(
        a.buildUnit(UnitType.CoastalBattery, at(7, 20), {}),
      ),
    );
    await navalRoundTrip(game, 8);
    executeTicks(game, 3);
    game.addExecution(new MoveWarshipExecution(a, [sub.id()], at(90, 20)));
    executeTicks(game, 2);
    await navalRoundTrip(game, 85);
  });
});

describe("Radar Station", () => {
  it("requires fog of war and uses ordinary owned-land structure placement", () => {
    expect(a.canBuild(UnitType.RadarStation, at(4, 20))).toBe(false);
    game.config().gameConfig().fogOfWar = true;
    expect(a.canBuild(UnitType.RadarStation, at(4, 20))).not.toBe(false);
    expect(a.canBuild(UnitType.RadarStation, at(100, 20))).toBe(false);
    const config = new EngineConfig(
      { ...game.config().gameConfig(), infiniteGold: false },
      false,
    );
    expect(config.unitInfo(UnitType.RadarStation).cost(game, a)).toBe(300000n);
  });
  it("constructs, survives snapshots, and transfers to its captor", async () => {
    game.config().gameConfig().fogOfWar = true;
    game.addExecution(
      new ConstructionExecution(a, UnitType.RadarStation, at(4, 20)),
    );
    executeTicks(game, 2);
    const radar = a.units(UnitType.RadarStation)[0];
    expect(radar.isUnderConstruction()).toBe(true);
    await navalRoundTrip(game, 130);
    expect(radar.isUnderConstruction()).toBe(false);
    b.captureUnit(radar);
    expect(radar.owner()).toBe(b);
    expect(b.units(UnitType.RadarStation)).toContain(radar);
    await navalRoundTrip(game, 2);
  });
});

it("starts batteries with shorter reach and applies upgrades to live combat and snapshots", async () => {
  const battery = a.buildUnit(UnitType.CoastalBattery, at(7, 20), {});
  game.addExecution(new CoastalBatteryExecution(battery));
  const target = b.buildUnit(UnitType.TransportShip, at(67, 20), {
    troops: 1000,
  });
  expect(game.config().coastalBatteryRange(battery.level())).toBe(40);
  executeTicks(game, 40);
  expect(target.isActive()).toBe(true);
  expect(a.canUpgradeUnit(battery)).toBe(true);
  expect(b.canUpgradeUnit(battery)).toBe(false);
  battery.setUnderConstruction(true);
  expect(a.canUpgradeUnit(battery)).toBe(false);
  battery.setUnderConstruction(false);
  game.addExecution(new UpgradeStructureExecution(a, battery.id()));
  executeTicks(game, 2);
  expect(battery.level()).toBe(2);
  expect(game.config().coastalBatteryRange(battery.level())).toBeGreaterThan(
    60,
  );
  await navalRoundTrip(game, 50);
  expect(target.isActive()).toBe(false);
});

it("upgrades completed radar stations and preserves their level through capture and snapshots", async () => {
  game.config().gameConfig().fogOfWar = true;
  const radar = a.buildUnit(UnitType.RadarStation, at(4, 20), {});
  radar.setUnderConstruction(true);
  expect(a.canUpgradeUnit(radar)).toBe(false);
  radar.setUnderConstruction(false);
  expect(a.canUpgradeUnit(radar)).toBe(true);
  expect(b.canUpgradeUnit(radar)).toBe(false);
  game.addExecution(new UpgradeStructureExecution(a, radar.id(), 2));
  executeTicks(game, 2);
  expect(radar.level()).toBe(3);
  expect(game.config().radarRange(radar.level())).toBe(225);
  b.captureUnit(radar);
  expect(radar.owner()).toBe(b);
  expect(radar.level()).toBe(3);
  await navalRoundTrip(game, 3);
});
