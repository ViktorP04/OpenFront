import { TileRef } from "@openfront/engine-api/game/GameMap";
import { Structures, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  TERRITORY_VISION,
  unitVisionRadius,
} from "@openfront/engine-lib/game/FogOfWarRules";
import {
  satelliteDistanceSquared,
  SATELLITE_VISION,
} from "@openfront/engine-lib/game/SatelliteOrbit";
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

/** Point query matching the client's shared vision, without allocating a map per AI. */
export function hasTileVision(
  game: Game,
  viewer: Player,
  tile: TileRef,
): boolean {
  if (!game.isValidRef(tile)) return false;
  if (!game.config().fogOfWar() || game.inSpawnPhase()) return true;
  const friendly = (owner: Player) =>
    owner === viewer || owner.isFriendly(viewer);
  if (
    game
      .units(UnitType.Satellite)
      .some(
        (satellite) =>
          satellite.isActive() &&
          friendly(satellite.owner()) &&
          satelliteDistanceSquared(
            game.width(),
            game.height(),
            game.x(tile),
            game.y(tile),
            game.x(satellite.tile()),
            game.y(satellite.tile()),
          ) <=
            SATELLITE_VISION ** 2,
      )
  )
    return true;
  if (
    game.shipVisionTrails().hasVision(game.ticks(), tile, (id) => {
      const owner = game.playerBySmallID(id);
      return owner.isPlayer() && friendly(owner);
    })
  )
    return true;
  // A negative query can inspect 841 tiles. Read packed ownership directly,
  // and resolve diplomacy once per encountered owner rather than per tile.
  // Keep this cache local: alliances and ownership may change within a tick.
  const owners = game.tileStateBuffer();
  const viewerID = viewer.smallID();
  const relationships = new Map<number, boolean>();
  const friendlyTerritory = (ref: TileRef) => {
    const id = owners[ref] & 0xfff;
    if (id === 0) return false;
    if (id === viewerID) return true;
    let value = relationships.get(id);
    if (value === undefined) {
      const owner = game.playerBySmallID(id);
      value = owner.isPlayer() && friendly(owner);
      relationships.set(id, value);
    }
    return value;
  };
  if (friendlyTerritory(tile)) return true;
  const width = game.width(),
    height = game.height();
  const cx = game.x(tile),
    cy = game.y(tile);
  for (let dy = -TERRITORY_VISION; dy <= TERRITORY_VISION; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= height) continue;
    const dx = TERRITORY_VISION - Math.abs(dy);
    for (let x = Math.max(0, cx - dx); x <= Math.min(width - 1, cx + dx); x++) {
      if (friendlyTerritory(y * width + x)) return true;
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
