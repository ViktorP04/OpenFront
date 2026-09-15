import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { GameType } from "../core/game/Game";
import { GameConfig, ID } from "../core/Schemas";
import { hostCheatsEnabled } from "./ConfigPatch";
import { paidFlags } from "./LocalCosmetics";

export const MIN_REWARD_SECONDS = 300;
export const DAILY_CAPS = 100;
export const LocalMatchRewardSchema = z.object({
  gameId: ID,
  players: z
    .array(
      z.object({
        userId: z.uuid(),
        seconds: z.number().int().min(0).max(86400),
        won: z.boolean(),
      }),
    )
    .min(2)
    .max(1000),
});
export type LocalMatchReward = z.infer<typeof LocalMatchRewardSchema>;

export function capsEligibleConfig(c: GameConfig): boolean {
  return (
    c.gameType !== GameType.Singleplayer &&
    !c.infiniteGold &&
    !c.infiniteTroops &&
    !c.instantBuild &&
    !hostCheatsEnabled(c.hostCheats) &&
    (c.goldMultiplier === null || c.goldMultiplier === undefined) &&
    (c.startingGold === null || c.startingGold === undefined)
  );
}

/** All mutations are synchronous transactions owned by the account master. */
export class LocalEconomy {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS caps_wallets (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0));
      CREATE TABLE IF NOT EXISTS caps_ledger (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reference TEXT NOT NULL, amount INTEGER NOT NULL, day TEXT NOT NULL,
        PRIMARY KEY(user_id, reference));
      CREATE INDEX IF NOT EXISTS caps_daily ON caps_ledger(user_id, day);
      CREATE TABLE IF NOT EXISTS owned_cosmetics (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        flare TEXT NOT NULL, PRIMARY KEY(user_id, flare));
      CREATE TABLE IF NOT EXISTS caps_matches (game_id TEXT PRIMARY KEY);
    `);
  }

  balance(userId: string): number {
    return (
      (
        this.db
          .prepare("SELECT balance FROM caps_wallets WHERE user_id=?")
          .get(userId) as { balance: number } | undefined
      )?.balance ?? 0
    );
  }

  flares(userId: string): string[] {
    return (
      this.db
        .prepare(
          "SELECT flare FROM owned_cosmetics WHERE user_id=? ORDER BY flare",
        )
        .all(userId) as { flare: string }[]
    ).map((r) => r.flare);
  }

  private transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  award(match: LocalMatchReward, now = new Date()): void {
    this.transaction(() => {
      // Deduplicate the entire result, including capped/zero-credit players.
      if (
        !this.db
          .prepare("INSERT OR IGNORE INTO caps_matches VALUES (?)")
          .run(match.gameId).changes
      )
        return;
      const unique = new Map(match.players.map((p) => [p.userId, p]));
      const eligible = [...unique.values()].filter(
        (p) =>
          p.seconds >= MIN_REWARD_SECONDS &&
          this.db.prepare("SELECT id FROM users WHERE id=?").get(p.userId),
      );
      if (eligible.length < 2) return;
      const day = now.toISOString().slice(0, 10);
      for (const player of eligible) {
        const earned = (
          this.db
            .prepare(
              "SELECT COALESCE(SUM(amount),0) AS total FROM caps_ledger WHERE user_id=? AND day=? AND amount>0",
            )
            .get(player.userId, day) as { total: number }
        ).total;
        const amount = Math.max(
          0,
          Math.min(DAILY_CAPS - earned, player.won ? 25 : 10),
        );
        this.db
          .prepare("INSERT INTO caps_ledger VALUES (?, ?, ?, ?)")
          .run(player.userId, `match:${match.gameId}`, amount, day);
        this.db
          .prepare(
            `INSERT INTO caps_wallets VALUES (?, ?) ON CONFLICT(user_id)
          DO UPDATE SET balance=balance+excluded.balance`,
          )
          .run(player.userId, amount);
      }
    });
  }

  purchase(
    userId: string,
    name: string,
  ): "ok" | "owned" | "insufficient" | "unknown" {
    const flag = paidFlags.find((f) => f.name === name);
    if (!flag) return "unknown";
    return this.transaction(() => {
      const flare = `flag:${name}`;
      if (
        this.db
          .prepare("SELECT 1 FROM owned_cosmetics WHERE user_id=? AND flare=?")
          .get(userId, flare)
      )
        return "owned";
      if (this.balance(userId) < flag.priceSoft) return "insufficient";
      this.db
        .prepare("UPDATE caps_wallets SET balance=balance-? WHERE user_id=?")
        .run(flag.priceSoft, userId);
      this.db
        .prepare("INSERT INTO owned_cosmetics VALUES (?, ?)")
        .run(userId, flare);
      this.db
        .prepare("INSERT INTO caps_ledger VALUES (?, ?, ?, ?)")
        .run(
          userId,
          `purchase:${flare}`,
          -flag.priceSoft,
          new Date().toISOString().slice(0, 10),
        );
      return "ok";
    });
  }
}
