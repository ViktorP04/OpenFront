import { GameEndInfoSchema } from "../core/Schemas";
import { GameMapSize, GameMode, GameType } from "../core/game/Game";
import { maps } from "../core/game/Maps.gen";

/** Personal, client-reported completion only; never use this as a reward ledger. */
export function eligibleCompletion(value: unknown, userId: string) {
  const parsed = GameEndInfoSchema.safeParse(value);
  if (!parsed.success) return null;
  const info = parsed.data;
  const c = info.config;
  const map = maps.find((m) => m.type === c.gameMap);
  if (
    !map ||
    map.defaultNationCount === 0 ||
    info.players.length !== 1 ||
    info.players[0].persistentID !== userId ||
    info.winner?.[0] !== "player" ||
    info.winner[1] !== info.players[0].clientID ||
    info.end <= info.start ||
    info.num_turns <= 0 ||
    c.gameType !== GameType.Singleplayer ||
    c.gameMode !== GameMode.FFA ||
    c.gameMapSize !== GameMapSize.Normal ||
    c.nations !== "default" ||
    c.bots !== 400 ||
    c.infiniteGold ||
    c.infiniteTroops ||
    c.instantBuild ||
    c.randomSpawn ||
    c.donateGold ||
    c.donateTroops ||
    c.waterNukes ||
    c.doomsdayClock?.enabled ||
    c.overtime?.enabled ||
    (c.disabledUnits?.length ?? 0) > 0 ||
    (c.maxTimerValue ?? null) !== null ||
    (c.goldMultiplier ?? null) !== null ||
    (c.startingGold ?? null) !== null ||
    (c.customAllianceDuration ?? null) !== null ||
    (c.hostCheats ?? null) !== null ||
    (c.publicGameModifiers ?? null) !== null ||
    (c.rankedType ?? null) !== null ||
    c.disableAlliances ||
    c.disableNavMesh
  )
    return null;
  return { mapName: c.gameMap, difficulty: c.difficulty };
}
