import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { Difficulty, GameType } from "../core/game/Game";
import { maps } from "../core/game/Maps.gen";
import { DAILY_CAPS, MIN_REWARD_SECONDS, matchCaps } from "../core/LocalCaps";
import {
  GameConfig,
  GameConfigSchema,
  GameEndInfoSchema,
  ID,
} from "../core/Schemas";
import { hostCheatsEnabled } from "./ConfigPatch";
import { LocalCosmeticType, localPurchaseItem } from "./LocalCosmetics";

export const LocalMatchRewardSchema = z.object({
  gameId: ID,
  gameType: z.enum([GameType.Private, GameType.Public]),
  difficulty: z.enum(Difficulty),
  players: z
    .array(
      z.object({
        userId: z.uuid(),
        seconds: z.number().int().min(0).max(86400),
        won: z.boolean(),
      }),
    )
    .min(1)
    .max(1000),
});
export type LocalMatchReward = z.infer<typeof LocalMatchRewardSchema>;

export function capsEligibleConfig(c: GameConfig): boolean {
  return (
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
      CREATE TABLE IF NOT EXISTS caps_solo_starts (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        game_id TEXT NOT NULL, config TEXT NOT NULL, started_at INTEGER NOT NULL);
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
      const day = now.toISOString().slice(0, 10);
      for (const player of eligible) {
        this.credit(
          player.userId,
          `match:${match.gameId}`,
          matchCaps(match.gameType, match.difficulty, player.won),
          day,
        );
      }
    });
  }

  private credit(
    userId: string,
    reference: string,
    requested: number,
    day: string,
  ): number {
    const earned = (
      this.db
        .prepare(
          "SELECT COALESCE(SUM(amount),0) AS total FROM caps_ledger WHERE user_id=? AND day=? AND amount>0",
        )
        .get(userId, day) as { total: number }
    ).total;
    const amount = Math.max(0, Math.min(DAILY_CAPS - earned, requested));
    this.db
      .prepare("INSERT INTO caps_ledger VALUES (?, ?, ?, ?)")
      .run(userId, reference, amount, day);
    this.db
      .prepare(
        `INSERT INTO caps_wallets VALUES (?, ?) ON CONFLICT(user_id)
      DO UPDATE SET balance=balance+excluded.balance`,
      )
      .run(userId, amount);
    return amount;
  }

  startSolo(
    userId: string,
    gameId: string,
    config: GameConfig,
    now = Date.now(),
  ): boolean {
    if (
      config.gameType !== GameType.Singleplayer ||
      !capsEligibleConfig(config)
    )
      return false;
    const key = `solo:${userId}:${gameId}`;
    if (this.db.prepare("SELECT 1 FROM caps_matches WHERE game_id=?").get(key))
      return false;
    const existing = this.db
      .prepare("SELECT game_id, config FROM caps_solo_starts WHERE user_id=?")
      .get(userId) as { game_id: string; config: string } | undefined;
    const encoded = JSON.stringify(GameConfigSchema.parse(config));
    // Repeated start requests cannot reset the clock or switch difficulty.
    if (existing?.game_id === gameId) return existing.config === encoded;
    this.db
      .prepare(
        `INSERT INTO caps_solo_starts VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET game_id=excluded.game_id, config=excluded.config, started_at=excluded.started_at`,
      )
      .run(userId, gameId, encoded, now);
    return true;
  }

  finishSolo(userId: string, value: unknown, now = Date.now()): number {
    const parsed = GameEndInfoSchema.safeParse(value);
    if (!parsed.success) return 0;
    const info = parsed.data;
    return this.transaction(() => {
      const start = this.db
        .prepare("SELECT * FROM caps_solo_starts WHERE user_id=? AND game_id=?")
        .get(userId, info.gameID) as
        | { started_at: number; config: string }
        | undefined;
      if (!start) return 0;
      const key = `solo:${userId}:${info.gameID}`;
      this.db
        .prepare("DELETE FROM caps_solo_starts WHERE user_id=?")
        .run(userId);
      if (
        !this.db
          .prepare("INSERT OR IGNORE INTO caps_matches VALUES (?)")
          .run(key).changes
      )
        return 0;
      const c = info.config;
      const map = maps.find((m) => m.type === c.gameMap);
      const hasAI =
        c.bots > 0 ||
        (c.nations === "default"
          ? (map?.defaultNationCount ?? 0) > 0
          : Number(c.nations) > 0);
      const player = info.players[0];
      const won =
        info.winner?.[0] === "player"
          ? info.winner[1] === player?.clientID
          : info.winner?.[0] === "team" &&
            info.winner.slice(2).includes(player?.clientID);
      if (
        !map ||
        !hasAI ||
        !won ||
        info.players.length !== 1 ||
        player.persistentID !== userId ||
        c.gameType !== GameType.Singleplayer ||
        !capsEligibleConfig(c) ||
        JSON.stringify(c) !== start.config ||
        now - start.started_at < MIN_REWARD_SECONDS * 1000 ||
        now - start.started_at > 6 * 60 * 60 * 1000 ||
        !Number.isFinite(info.end - info.start) ||
        info.end - info.start < MIN_REWARD_SECONDS * 1000 ||
        info.num_turns < MIN_REWARD_SECONDS * 10
      )
        return 0;
      return this.credit(
        userId,
        key,
        matchCaps(GameType.Singleplayer, c.difficulty, true),
        new Date(now).toISOString().slice(0, 10),
      );
    });
  }

  purchase(
    userId: string,
    name: string,
    type: LocalCosmeticType = "flag",
    palette?: string,
  ): "ok" | "owned" | "insufficient" | "unknown" {
    const item = localPurchaseItem(type, name, palette);
    if (!item) return "unknown";
    return this.transaction(() => {
      const { flare, price } = item;
      if (
        this.db
          .prepare("SELECT 1 FROM owned_cosmetics WHERE user_id=? AND flare=?")
          .get(userId, flare)
      )
        return "owned";
      if (this.balance(userId) < price) return "insufficient";
      this.db
        .prepare("UPDATE caps_wallets SET balance=balance-? WHERE user_id=?")
        .run(price, userId);
      this.db
        .prepare("INSERT INTO owned_cosmetics VALUES (?, ?)")
        .run(userId, flare);
      this.db
        .prepare("INSERT INTO caps_ledger VALUES (?, ?, ?, ?)")
        .run(
          userId,
          `purchase:${flare}`,
          -price,
          new Date().toISOString().slice(0, 10),
        );
      return "ok";
    });
  }
}
