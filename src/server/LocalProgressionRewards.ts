import { replacer } from "@openfront/shared/SharedUtil";
import { localAccountsEnabled } from "../auth/AuthConfig";
import type { LocalProgressionMatch } from "./LocalProgression";
import { logger } from "./Logger";
import { ServerEnv } from "./ServerEnv";

/** The trusted game server submits confirmed stats; browsers cannot award multiplayer XP. */
export async function sendLocalMatchXp(
  match: LocalProgressionMatch,
): Promise<void> {
  const key = process.env.LOCAL_REWARD_KEY;
  if (!localAccountsEnabled() || !key || match.userIds.length === 0) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(
        `${ServerEnv.accountApiBase()}/internal/match-xp`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Local-Reward-Key": key,
          },
          body: JSON.stringify(match, replacer),
          signal: AbortSignal.timeout(5000),
        },
      );
      if (response.ok) return;
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      )
        break;
    } catch {
      /* A lost response is safe to retry: scoring is idempotent per account/game. */
    }
  }
  logger.warn("Could not submit local match XP", { gameID: match.info.gameID });
}
