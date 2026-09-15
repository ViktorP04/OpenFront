// @vitest-environment node
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalEconomy,
  LocalMatchRewardSchema,
} from "../../src/server/LocalEconomy";

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
  const match = (gameId: string, seconds = 300) => ({
    gameId,
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

  it("requires two distinct existing accounts with five minutes each", () => {
    const { ids, economy, match } = setup();
    economy.award(match("short001", 299));
    const duplicate = match("dupe0001");
    duplicate.players[1] = duplicate.players[0];
    economy.award(duplicate);
    const guest = match("guest001");
    guest.players[1].userId = randomUUID();
    economy.award(guest);
    expect(economy.balance(ids[0])).toBe(0);
    expect(
      LocalMatchRewardSchema.safeParse({
        ...guest,
        players: [{ userId: ids[0], seconds: -1, won: true }],
      }).success,
    ).toBe(false);
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
