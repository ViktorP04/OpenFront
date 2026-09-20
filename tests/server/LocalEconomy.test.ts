// @vitest-environment node
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { Difficulty, GameType } from "../../src/core/game/Game";
import { GameConfigSchema } from "../../src/core/Schemas";
import {
  LocalEconomy,
  LocalMatchRewardSchema,
} from "../../src/server/LocalEconomy";
import { completionInfo } from "../fixtures/LocalCompletion";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function setup() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users (id TEXT PRIMARY KEY)");
  const ids = [randomUUID(), randomUUID()];
  for (const id of ids) db.prepare("INSERT INTO users VALUES (?)").run(id);
  const economy = new LocalEconomy(db);
  const match = (
    gameId: string,
    seconds = 300,
  ): import("../../src/server/LocalEconomy").LocalMatchReward => ({
    gameId,
    gameType: GameType.Public,
    difficulty: Difficulty.Hard,
    players: ids.map((userId) => ({ userId, seconds, won: true })),
  });
  return { db, ids, economy, match };
}

describe("local Caps ledger", () => {
  it("resets the earning allowance at UTC midnight and never replays old matches", () => {
    const { ids, economy, match } = setup();
    const today = new Date("2026-09-15T23:59:59Z");
    const tomorrow = new Date("2026-09-16T00:00:00Z");
    for (let i = 0; i < 6; i++) economy.award(match(`match00${i}`), today);
    expect(economy.balance(ids[0])).toBe(100);
    economy.award(match("match005"), tomorrow);
    expect(economy.balance(ids[0])).toBe(100);
    economy.award(match("match006"), tomorrow);
    expect(economy.balance(ids[0])).toBe(125);
    expect(economy.purchase(ids[0], "crescent")).toBe("ok");
    expect(economy.balance(ids[0])).toBe(25);
    // Spending does not increase the day's earning allowance.
    for (let i = 7; i < 12; i++)
      economy.award(match(`match0${i.toString().padStart(2, "0")}`), tomorrow);
    expect(economy.balance(ids[0])).toBe(100);
  });

  it("requires five minutes, ignores unknown accounts, and deduplicates players", () => {
    const { ids, economy, match } = setup();
    economy.award(match("short001", 299));
    const duplicate = match("dupe0001");
    duplicate.players[1] = duplicate.players[0];
    economy.award(duplicate);
    const guest = match("guest001");
    guest.players[1].userId = randomUUID();
    economy.award(guest);
    expect(economy.balance(ids[0])).toBe(50);
    expect(
      LocalMatchRewardSchema.safeParse({
        ...guest,
        players: [{ userId: ids[0], seconds: -1, won: true }],
      }).success,
    ).toBe(false);
  });

  it("returns the amount actually credited for player notifications", () => {
    const { ids, economy, match } = setup();
    expect(economy.award(match("notice01"))).toEqual({
      [ids[0]]: 25,
      [ids[1]]: 25,
    });
    expect(economy.award(match("notice01"))).toEqual({});
  });

  it.each([
    [Difficulty.Easy, 5],
    [Difficulty.Medium, 15],
    [Difficulty.Hard, 25],
    [Difficulty.Impossible, 40],
  ] as const)(
    "scales %s wins and pays private lobbies only for winning",
    (difficulty, amount) => {
      const { ids, economy, match } = setup();
      const result = match("private1");
      result.gameType = GameType.Private;
      result.difficulty = difficulty;
      result.players[1].won = false;
      economy.award(result);
      expect(economy.balance(ids[0])).toBe(amount);
      expect(economy.balance(ids[1])).toBe(0);
      const publicResult = {
        ...result,
        gameId: "public01",
        gameType: GameType.Public as const,
      };
      economy.award(publicResult);
      expect(economy.balance(ids[1])).toBe(Math.floor(amount * 0.4));
    },
  );

  it("allows one-account lobby wins", () => {
    const { ids, economy, match } = setup();
    const result = match("one00001");
    result.gameType = GameType.Private;
    result.players = result.players.slice(0, 1);
    economy.award(result);
    expect(economy.balance(ids[0])).toBe(25);
  });

  function solo(userId: string, gameID = "solo0001") {
    const info = completionInfo();
    info.gameID = gameID;
    info.players[0].persistentID = userId;
    info.end = info.start + 301000;
    info.duration = 301;
    info.num_turns = 3010;
    return info;
  }

  it("records solo starts, pays a win once, and shares the daily cap with public games", () => {
    const { ids, economy, match } = setup();
    const now = Date.parse("2026-09-16T12:00:00Z");
    const info = solo(ids[0]);
    expect(economy.finishSolo(ids[0], info, now + 301000)).toBe(0);
    expect(
      economy.startSolo(
        ids[0],
        info.gameID,
        GameConfigSchema.parse(info.config),
        now,
      ),
    ).toBe(true);
    expect(
      economy.startSolo(
        ids[0],
        info.gameID,
        GameConfigSchema.parse(info.config),
        now + 200000,
      ),
    ).toBe(true);
    expect(economy.finishSolo(ids[0], info, now + 301000)).toBe(15);
    expect(economy.finishSolo(ids[0], info, now + 601000)).toBe(0);
    expect(
      economy.startSolo(
        ids[0],
        info.gameID,
        GameConfigSchema.parse(info.config),
        now + 601000,
      ),
    ).toBe(false);
    for (let i = 0; i < 4; i++)
      economy.award(match(`mixed00${i}`), new Date(now));
    expect(economy.balance(ids[0])).toBe(100);
  });

  it.each([
    "early",
    "loss",
    "cheats",
    "difficulty",
    "identity",
    "turns",
    "expired",
    "empty",
  ])("does not pay a solo result with %s", (reason) => {
    const { ids, economy } = setup();
    const now = Date.now();
    const info = solo(ids[0]);
    if (reason === "empty") {
      info.config.bots = 0;
      info.config.nations = "disabled";
    }
    economy.startSolo(
      ids[0],
      info.gameID,
      GameConfigSchema.parse(info.config),
      now,
    );
    if (reason === "loss") info.winner = ["player", "other001"];
    if (reason === "cheats") info.config.infiniteGold = true;
    if (reason === "difficulty") info.config.difficulty = "Impossible";
    if (reason === "identity") info.players[0].persistentID = ids[1];
    if (reason === "turns") info.num_turns = 1;
    expect(
      economy.finishSolo(
        ids[0],
        info,
        now +
          (reason === "early"
            ? 1000
            : reason === "expired"
              ? 86400000
              : 301000),
      ),
    ).toBe(0);
    expect(economy.balance(ids[0])).toBe(0);
  });

  it("keeps only one active solo start per account", () => {
    const { ids, economy } = setup();
    const now = Date.now();
    const old = solo(ids[0]);
    const current = solo(ids[0], "solo0002");
    economy.startSolo(
      ids[0],
      old.gameID,
      GameConfigSchema.parse(old.config),
      now,
    );
    economy.startSolo(
      ids[0],
      current.gameID,
      GameConfigSchema.parse(current.config),
      now + 100000,
    );
    expect(economy.finishSolo(ids[0], old, now + 400000)).toBe(0);
    expect(economy.finishSolo(ids[0], current, now + 401000)).toBe(15);
  });

  it("rolls back debit, ownership, and history together if a purchase fails", () => {
    const { db, ids, economy, match } = setup();
    for (let i = 0; i < 4; i++) economy.award(match(`fund000${i}`));
    db.exec(
      "CREATE TRIGGER fail_purchase BEFORE INSERT ON owned_cosmetics BEGIN SELECT RAISE(ABORT, 'failure'); END",
    );
    expect(() => economy.purchase(ids[0], "crescent")).toThrow();
    expect(economy.balance(ids[0])).toBe(100);
    expect(economy.flares(ids[0])).toEqual([]);
    db.exec("DROP TRIGGER fail_purchase");
    expect(economy.purchase(ids[0], "crescent")).toBe("ok");
    expect(economy.purchase(ids[0], "crescent")).toBe("owned");
    expect(economy.balance(ids[0])).toBe(0);
  });
});
