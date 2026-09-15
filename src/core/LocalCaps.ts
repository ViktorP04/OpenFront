import { Difficulty, GameType } from "./game/Game";

export const MIN_REWARD_SECONDS = 300;
export const DAILY_CAPS = 100;
export const WIN_CAPS: Record<Difficulty, number> = {
  [Difficulty.Easy]: 5,
  [Difficulty.Medium]: 15,
  [Difficulty.Hard]: 25,
  [Difficulty.Impossible]: 40,
};

export function matchCaps(
  type: GameType,
  difficulty: Difficulty,
  won: boolean,
): number {
  if (won) return WIN_CAPS[difficulty];
  return type === GameType.Public ? Math.floor(WIN_CAPS[difficulty] * 0.4) : 0;
}
