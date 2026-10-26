import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { unitVisionRadius } from "@openfront/engine-lib/game/FogOfWarRules";
import { GameMapImpl } from "@openfront/engine-lib/game/GameMapImpl";
import {
  createTileVisionQuery,
  hasTileVision,
} from "@openfront/engine/game/FogOfWar";
import { createGame } from "@openfront/engine/game/GameImpl";
import {
  snapshotGame,
  restoreGame,
} from "@openfront/engine/snapshot/GameSnapshot";
import { expect, it } from "vitest";
import { CoarseFogOfWar } from "../src/client/view/CoarseFogOfWar";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";

it.each([2, 4, 8] as const)(
  "matches AI queries across all coarse cells at scale %s",
  async (scale) => {
    const width = 517,
      height = 293;
    const infos = [
      new PlayerInfo("Viewer", PlayerType.Nation, null, "a"),
      new PlayerInfo("Enemy", PlayerType.Nation, null, "b"),
      new PlayerInfo("Ally", PlayerType.Nation, null, "c"),
    ];
    const template = await setup(
      "ocean_and_land",
      { fogOfWar: true, instantBuild: true },
      infos,
    );
    const map = () => {
      const terrain = new Uint8Array(width * height);
      for (let i = 0; i < terrain.length; i++)
        terrain[i] = Math.floor(i / width) < 60 ? 128 : 32;
      return new GameMapImpl(width, height, terrain, width * 60);
    };
    const game = createGame(
      infos,
      [],
      map(),
      map(),
      new TestConfig(
        { ...template.config().gameConfig(), fogOfWarScale: scale },
        false,
      ),
    );
    game.endSpawnPhase();
    const a = game.player("a"),
      b = game.player("b"),
      c = game.player("c");
    const ref = (x: number, y: number) => game.ref(x, y);
    for (let x = 15; x < 35; x++) a.conquer(ref(x, 20));
    for (let x = 200; x < 215; x++) c.conquer(ref(x, 50));
    b.conquer(ref(400, 50));
    a.buildUnit(UnitType.RadarStation, ref(20, 20), {});
    a.buildUnit(UnitType.Submarine, ref(255, 150), {
      patrolTile: ref(255, 150),
    });
    a.buildUnit(UnitType.Warship, ref(400, 220), { patrolTile: ref(400, 220) });
    a.buildUnit(UnitType.Satellite, ref(0, 0), {});
    c.buildUnit(UnitType.RadarStation, ref(205, 50), {});
    a.createAllianceRequest(c)!.accept();
    const trail = { owner: a.smallID(), pos: ref(100, 180), radius: 10 };
    game.shipVisionTrails().record(game.ticks(), [trail]);
    const mask = new CoarseFogOfWar(width, height, scale);
    const update = (changes?: Iterable<number>) => {
      const friendly = new Set(
        game
          .players()
          .filter((p) => p === a || p.isFriendly(a))
          .map((p) => p.smallID()),
      );
      const sources = game
        .units()
        .filter(
          (u) => friendly.has(u.owner().smallID()) && !u.isUnderConstruction(),
        )
        .map((u) => ({
          pos: u.tile(),
          radius: unitVisionRadius(u.type(), u.level()),
          wrap: u.type() === UnitType.Satellite,
        }));
      mask.update(game.tileStateBuffer(), friendly, sources, changes);
      if (game.config().fogOfWarTrails())
        mask.addSources(
          game.shipVisionTrails().sources(game.ticks(), friendly),
        );
      const query = createTileVisionQuery(game, a);
      let mismatches = 0;
      for (let y = 0; y < height; y += scale)
        for (let x = 0; x < width; x += scale) {
          const tile = ref(x, y);
          if (mask.isVisible(tile) !== query(tile)) mismatches++;
          const edge = ref(
            Math.min(width - 1, x + scale - 1),
            Math.min(height - 1, y + scale - 1),
          );
          if (query(edge) !== mask.isVisible(edge)) mismatches++;
        }
      expect(mismatches).toBe(0);
    };
    update();
    expect(mask.visible.length).toBe(
      Math.ceil(width / scale) * Math.ceil(height / scale),
    );
    a.breakAlliance(a.allianceWith(c)!);
    const captured = ref(212, 50);
    a.conquer(captured);
    update([captured]);
    game.config().gameConfig().fogOfWarTrails = false;
    update([]);
    expect(mask.isVisible(trail.pos)).toBe(hasTileVision(game, a, trail.pos));
    const restored = restoreGame(snapshotGame(game), {
      gameMap: map(),
      miniGameMap: map(),
      config: (config) => new TestConfig(config, false),
    });
    expect(restored.config().fogOfWarScale()).toBe(scale);
    expect(restored.config().fogOfWarTrails()).toBe(false);
    for (let y = 0; y < height; y += 17)
      for (let x = 0; x < width; x += 19)
        expect(hasTileVision(restored, restored.player("a"), ref(x, y))).toBe(
          hasTileVision(game, a, ref(x, y)),
        );
  },
);

it("keeps friendly land visible even in a mixed-owner edge cell", () => {
  const mask = new CoarseFogOfWar(67, 35, 8),
    owners = new Uint16Array(67 * 35);
  const tile = 34 * 67 + 66;
  owners[tile] = 1;
  mask.update(owners, new Set([1]), [], []);
  expect(mask.isVisible(tile)).toBe(true);
  owners[tile] = 2;
  mask.update(owners, new Set([1]), [], [tile]);
  expect(mask.isVisible(tile)).toBe(false);
});
