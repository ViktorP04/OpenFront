import { z } from "zod";

export const LocalLeaderboardMetricSchema = z.enum(["caps", "medals"]);
export type LocalLeaderboardMetric = z.infer<
  typeof LocalLeaderboardMetricSchema
>;
export const LocalLeaderboardResponseSchema = z.object({
  players: z.array(
    z.object({
      rank: z.number().int().positive(),
      publicId: z.string(),
      username: z.string(),
      score: z.number().int().nonnegative(),
    }),
  ),
  hasMore: z.boolean(),
});
export type LocalLeaderboardResponse = z.infer<
  typeof LocalLeaderboardResponseSchema
>;
