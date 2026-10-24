export const COASTAL_BATTERY_HEALTH = 800;

/** Shared simulation/rendering range curve: 40 at level 1, approaching 140. */
export function coastalBatteryRange(level = 1): number {
  return 140 - 200 / (Math.max(1, level) + 1);
}

/** Radar coverage grows from 150 tiles toward 300, with diminishing gains. */
export function radarRange(level = 1): number {
  return Math.floor(300 - 300 / (Math.max(1, level) + 1));
}
