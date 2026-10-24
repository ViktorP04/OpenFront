import { TileRef } from "@openfront/engine-api/game/GameMap";
import { Structures, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  TERRITORY_VISION,
  unitVisionRadius,
} from "@openfront/engine-lib/game/FogOfWarRules";
import { Game, Player } from "./Game";

const LOCAL_SOURCES = [
  ...Structures.types.filter((type) => type !== UnitType.RadarStation),
  UnitType.Warship,
  UnitType.Submarine,
  UnitType.TransportShip,
  UnitType.TradeShip,
  UnitType.Train,
];

const LOCAL_RANGE = Math.max(
  ...LOCAL_SOURCES.map((type) => unitVisionRadius(type)),
);

/** Point query matching the client's shared vision, without allocating a map per AI.
 * No cached knowledge or PRNG state: snapshots and execution ordering stay deterministic.
 */
export function hasTileVision(
  game: Game,
  viewer: Player,
  tile: TileRef,
): boolean {
  if (!game.isValidRef(tile)) return false;
  if (!game.config().fogOfWar() || game.inSpawnPhase()) return true;
  const friendly = (owner: Player) =>
    owner === viewer || owner.isFriendly(viewer);
  const friendlyTerritory = (ref: TileRef) => {
    if (!game.hasOwner(ref)) return false;
    const owner = game.owner(ref);
    return owner.isPlayer() && friendly(owner);
  };
  if (friendlyTerritory(tile)) return true;
  const cx = game.x(tile),
    cy = game.y(tile);
  for (let dy = -TERRITORY_VISION; dy <= TERRITORY_VISION; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= game.height()) continue;
    const dx = TERRITORY_VISION - Math.abs(dy);
    for (
      let x = Math.max(0, cx - dx);
      x <= Math.min(game.width() - 1, cx + dx);
      x++
    ) {
      if (friendlyTerritory(game.ref(x, y))) return true;
    }
  }
  if (
    game.anyUnitNearby(tile, LOCAL_RANGE, LOCAL_SOURCES, (unit) => {
      const radius = unitVisionRadius(unit.type(), unit.level());
      return (
        friendly(unit.owner()) &&
        game.euclideanDistSquared(tile, unit.tile()) <= radius * radius
      );
    })
  )
    return true;
  // Radar stations are sparse; iterate that type rather than probing hundreds
  // of empty spatial cells for every candidate landing tile.
  return game
    .units(UnitType.RadarStation)
    .some(
      (unit) =>
        !unit.isUnderConstruction() &&
        friendly(unit.owner()) &&
        game.euclideanDistSquared(tile, unit.tile()) <=
          unitVisionRadius(unit.type(), unit.level()) ** 2,
    );
}
