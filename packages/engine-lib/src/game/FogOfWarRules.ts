import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { radarRange } from "./NavalBalance";

export const TERRITORY_VISION = 12;
export const SHIP_VISION_LINGER_TICKS = 100;
export const RADAR_VISION = radarRange();

export function unitVisionRadius(type: string, level = 1): number {
  if (type === UnitType.TradeShip) return 10;
  if (type === UnitType.Submarine) return 70;
  if (type === UnitType.RadarStation) return radarRange(level);
  if ([UnitType.Warship, UnitType.TransportShip].includes(type as UnitType))
    return 35;
  // Projectiles do not act as disposable scouts.
  if (
    [
      UnitType.Shell,
      UnitType.SAMMissile,
      UnitType.AtomBomb,
      UnitType.HydrogenBomb,
      UnitType.MIRV,
      UnitType.MIRVWarhead,
    ].includes(type as UnitType)
  )
    return 0;
  return 20;
}
