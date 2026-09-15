import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  LocalLeaderboardMetric,
  LocalLeaderboardResponse,
} from "../core/LocalLeaderboard";

/** Read existing durable progress; purchases never lower lifetime earnings. */
export function localLeaderboard(
  db: DatabaseSync,
  metric: LocalLeaderboardMetric,
  page: number,
): LocalLeaderboardResponse {
  const scores =
    metric === "caps"
      ? "SELECT user_id, SUM(amount) AS score FROM caps_ledger WHERE amount>0 GROUP BY user_id"
      : "SELECT user_id, COUNT(*) AS score FROM map_completions GROUP BY user_id";
  const rows = db
    .prepare(
      `
    WITH scores AS (${scores}), ranked AS (
      SELECT users.id, users.username, scores.score,
        RANK() OVER (ORDER BY scores.score DESC) AS rank
      FROM scores JOIN users ON users.id=scores.user_id
    ) SELECT * FROM ranked ORDER BY score DESC, username COLLATE NOCASE, id LIMIT 51 OFFSET ?
  `,
    )
    .all((page - 1) * 50) as {
    id: string;
    username: string;
    score: number;
    rank: number;
  }[];
  return {
    players: rows.slice(0, 50).map(({ id, ...row }) => ({
      ...row,
      publicId: createHash("sha256").update(id).digest("hex"),
    })),
    hasMore: rows.length > 50,
  };
}
