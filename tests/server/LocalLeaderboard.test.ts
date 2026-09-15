// @vitest-environment node
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { LocalLeaderboardResponseSchema } from "../../src/core/LocalLeaderboard";
import { localLeaderboard } from "../../src/server/LocalLeaderboard";

let db: DatabaseSync;
afterEach(() => db.close());
function setup() {
  db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE users (id TEXT, username TEXT, password_hash TEXT);
    CREATE TABLE caps_ledger (user_id TEXT, amount INTEGER);
    CREATE TABLE map_completions (user_id TEXT, map_name TEXT, difficulty TEXT);`);
}
describe("local leaderboard", () => {
  it("ranks lifetime earnings, ignores spending and zero credits, and exposes only public fields", () => {
    setup();
    db.exec(`INSERT INTO users VALUES ('a','Alice','secret'),('b','Bob','secret'),('c','Carol','secret');
      INSERT INTO caps_ledger VALUES ('a',40),('a',20),('a',-50),('b',60),('c',0);`);
    const result = localLeaderboard(db, "caps", 1);
    expect(LocalLeaderboardResponseSchema.parse(result)).toEqual({
      players: [
        {
          rank: 1,
          username: "Alice",
          score: 60,
          publicId: createHash("sha256").update("a").digest("hex"),
        },
        {
          rank: 1,
          username: "Bob",
          score: 60,
          publicId: createHash("sha256").update("b").digest("hex"),
        },
      ],
      hasMore: false,
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(localLeaderboard(db, "medals", 1).players).toEqual([]);
  });
  it("counts each earned map/difficulty medal and paginates without gaps", () => {
    setup();
    for (let i = 0; i < 51; i++) {
      db.prepare("INSERT INTO users VALUES (?, ?, 'secret')").run(
        String(i),
        `Player${String(i).padStart(2, "0")}`,
      );
      db.prepare("INSERT INTO map_completions VALUES (?, 'World', 'Easy')").run(
        String(i),
      );
    }
    db.exec("INSERT INTO map_completions VALUES ('50', 'World', 'Hard')");
    const first = localLeaderboard(db, "medals", 1);
    const second = localLeaderboard(db, "medals", 2);
    expect(first.hasMore).toBe(true);
    expect(first.players[0]).toMatchObject({
      username: "Player50",
      score: 2,
      rank: 1,
    });
    expect(first.players[1].rank).toBe(2);
    expect(second.hasMore).toBe(false);
    expect(second.players).toHaveLength(1);
    expect(
      new Set([...first.players, ...second.players].map((p) => p.publicId))
        .size,
    ).toBe(51);
    expect(localLeaderboard(db, "medals", 3)).toEqual({
      players: [],
      hasMore: false,
    });
  });
});
