/** Shared simulation/rendering range curve: 60 at level 1, approaching 140. */
export function coastalBatteryRange(level = 1): number {
  return 140 - 160 / (Math.max(1, level) + 1);
}
