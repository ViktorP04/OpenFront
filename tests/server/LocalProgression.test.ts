import { GameType } from "@openfront/engine-api/game/GameTypes";
import {
  GameXpResponseSchema,
  ProgressionConfigSchema,
} from "@openfront/shared/ApiSchemas";
import {
  GameEndInfoSchema,
  type GameEndInfo,
} from "@openfront/shared/WireSchemas";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LOCAL_PROGRESSION_CONFIG,
  LOCAL_XP_RULES,
  LocalProgression,
} from "../../src/server/LocalProgression";
import { completionInfo, completionUser } from "../fixtures/LocalCompletion";

let db: DatabaseSync;
let xp: LocalProgression;
const now = Date.UTC(2026, 9, 24, 12);
const otherUser = "223e4567-e89b-42d3-a456-426614174000";
function info(gameID = "xp000001", type = GameType.Singleplayer): GameEndInfo {
  const value = completionInfo();
  return GameEndInfoSchema.parse({
    ...value,
    gameID,
    start: now,
    end: now + 301000,
    duration: 301,
    num_turns: 3010,
    config: { ...value.config, gameType: type },
    players: [
      {
        ...value.players[0],
        stats: { attacks: ["100"], finalTiles: "100", spawnTile: 1 },
      },
    ],
  });
}
function match(gameID = "xp000001") {
  return {
    info: { ...info(gameID, GameType.Private), statsAgreed: true },
    userIds: [completionUser],
    leftAt: {},
    disqualified: false,
  };
}
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users (id TEXT PRIMARY KEY)");
  db.prepare("INSERT INTO users VALUES (?)").run(completionUser);
  db.prepare("INSERT INTO users VALUES (?)").run(otherUser);
  xp = new LocalProgression(db);
});
afterEach(() => db.close());

describe("local progression", () => {
  it("exposes a valid 100-level curve and starts existing accounts at level 1", () => {
    expect(
      ProgressionConfigSchema.safeParse(LOCAL_PROGRESSION_CONFIG).success,
    ).toBe(true);
    expect(LOCAL_PROGRESSION_CONFIG.levels[99].cumulativeXp).toBe(267300);
    expect(xp.progress(completionUser, now)).toMatchObject({
      level: 1,
      prestige: 0,
      lifetimeXp: 0,
      xpInLevel: 0,
      xpForNext: 250,
      canPrestige: false,
      subscriberPermille: 1000,
    });
  });
  it("scores registered solo games once, preserves their result and bounds them by wall time", () => {
    const game = info();
    expect(xp.finishSolo(completionUser, game, now + 301000)).toBeNull();
    expect(xp.startSolo(completionUser, game.gameID, game.config, now)).toBe(
      true,
    );
    expect(xp.finishSolo(completionUser, game, now + 1000)).toBeNull();
    const result = xp.finishSolo(completionUser, game, now + 301000)!;
    expect(GameXpResponseSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      eligible: true,
      breakdown: {
        played: 50,
        time: 85,
        gamePermille: 250,
        subscriberPermille: 1000,
        total: 38,
      },
    });
    expect(xp.finishSolo(completionUser, game, now + 302000)).toEqual(result);
    expect(
      new LocalProgression(db).progress(completionUser, now).lifetimeXp,
    ).toBe(38);
    expect(xp.game(otherUser, game.gameID)).toBeNull();
  });
  it("rejects changed configs, another account, expired starts and multiplayer spoofing", () => {
    const game = info();
    xp.startSolo(completionUser, game.gameID, game.config, now);
    expect(
      xp.startSolo(
        completionUser,
        game.gameID,
        { ...game.config, difficulty: "Easy" } as never,
        now + 1000,
      ),
    ).toBe(false);
    expect(
      xp.finishSolo(
        completionUser,
        { ...game, config: { ...game.config, infiniteGold: true } },
        now + 301000,
      ),
    ).toBeNull();
    expect(xp.finishSolo(otherUser, game, now + 301000)).toBeNull();
    expect(xp.finishSolo(completionUser, game, now + 7 * 3600000)).toBeNull();
    expect(
      xp.finishSolo(completionUser, match().info, now + 301000),
    ).toBeNull();
    expect(xp.progress(completionUser, now).lifetimeXp).toBe(0);
  });
  it("awards solo losses for active play, but no idle, cheat or opponent-free XP", () => {
    for (const [i, change, reason] of [
      [0, { players: [{ ...info().players[0], stats: {} }] }, "no_action"],
      [
        1,
        { config: { ...info().config, infiniteGold: true } },
        "custom_settings",
      ],
      [
        2,
        { config: { ...info().config, bots: 0, nations: "disabled" } },
        "too_few_humans",
      ],
    ] as const) {
      const game = GameEndInfoSchema.parse({
        ...info(`xp00000${i}`),
        ...change,
      });
      xp.startSolo(completionUser, game.gameID, game.config, now);
      expect(xp.finishSolo(completionUser, game, now + 301000)).toMatchObject({
        eligible: false,
        reason,
      });
    }
    const loss = { ...info("xp000009"), winner: undefined };
    xp.startSolo(completionUser, loss.gameID, loss.config, now);
    expect(xp.finishSolo(completionUser, loss, now + 301000)).toMatchObject({
      eligible: true,
      breakdown: { win: 0, total: 34 },
    });
  });
  it("caps solo XP games per UTC day and resets the allowance next day", () => {
    for (let i = 0; i <= LOCAL_XP_RULES.singleplayerGamesPerDay; i++) {
      const game = info(`solo000${i}`);
      xp.startSolo(completionUser, game.gameID, game.config, now);
      const result = xp.finishSolo(completionUser, game, now + 301000)!;
      expect(result.eligible).toBe(i < LOCAL_XP_RULES.singleplayerGamesPerDay);
      if (!result.eligible) expect(result.reason).toBe("daily_cap");
    }
    expect(xp.progress(completionUser, now).daily?.singleplayerGames).toBe(5);
    expect(
      xp.progress(completionUser, now + 86400000).daily?.singleplayerGames,
    ).toBe(0);
  });
  it("requires confirmed multiplayer stats and refuses a game that enabled cheats mid-match", () => {
    const unverified = match();
    unverified.info.statsAgreed = false;
    xp.awardMatch(unverified, now);
    expect(xp.game(completionUser, unverified.info.gameID)).toMatchObject({
      eligible: false,
      reason: "unverified",
    });
    xp.awardMatch({ ...match("xp000002"), disqualified: true }, now);
    expect(xp.game(completionUser, "xp000002")).toMatchObject({
      eligible: false,
      reason: "custom_settings",
    });
    expect(xp.progress(completionUser, now).lifetimeXp).toBe(0);
  });
  it("awards only listed local participants, once, and gives public first-game XP once", () => {
    const publicMatch = match();
    publicMatch.info.config.gameType = GameType.Public;
    xp.awardMatch(
      { ...publicMatch, userIds: [completionUser, completionUser, otherUser] },
      now,
    );
    const result = xp.game(completionUser, publicMatch.info.gameID);
    expect(result).toMatchObject({
      eligible: true,
      breakdown: { firstGame: 100, total: 250 },
    });
    expect(xp.progress(completionUser, now)).toMatchObject({
      level: 2,
      lifetimeXp: 250,
      xpInLevel: 0,
      xpForNext: 300,
    });
    expect(xp.progress(otherUser, now).lifetimeXp).toBe(0);
    xp.awardMatch(publicMatch, now);
    expect(xp.progress(completionUser, now).lifetimeXp).toBe(250);
    const next = {
      ...publicMatch,
      info: { ...publicMatch.info, gameID: "xp000002" },
    };
    xp.awardMatch(next, now);
    expect(xp.game(completionUser, "xp000002")).toMatchObject({
      eligible: true,
      breakdown: { firstGame: 0, total: 150 },
    });
  });
  it("removes played, placement and win XP from early leavers", () => {
    const game = match();
    game.info.config.gameType = GameType.Public;
    xp.awardMatch(
      { ...game, leftAt: { [game.info.players[0].clientID]: 1500 } },
      now,
    );
    expect(xp.game(completionUser, game.info.gameID)).toMatchObject({
      eligible: true,
      breakdown: {
        leftEarly: true,
        played: 0,
        win: 0,
        firstGame: 0,
        total: 42,
      },
    });
  });
  it("records crossed milestones and caps the visible level at 100", () => {
    const atTen = LOCAL_PROGRESSION_CONFIG.levels[9].cumulativeXp;
    db.prepare("INSERT INTO player_xp VALUES (?, ?)").run(
      completionUser,
      atTen - 1,
    );
    xp.awardMatch(match(), now);
    expect(xp.publicProgress(completionUser, now).milestones).toEqual([
      { level: 10, prestige: 0, at: new Date(now).toISOString() },
    ]);
    db.prepare("UPDATE player_xp SET lifetime_xp=? WHERE user_id=?").run(
      300000,
      completionUser,
    );
    expect(xp.progress(completionUser, now)).toMatchObject({
      level: 100,
      legend: true,
      canPrestige: false,
      xpForNext: 0,
      xpInLevel: 0,
    });
  });
});
