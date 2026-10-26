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
import { Game, Player, Unit } from "./Game";
import { territoryVisionIndex } from "./TerritoryVisionIndex";

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

/**
 * Reuse setup only within one synchronous, read-only planning operation.
 * Discard before any simulation action: diplomacy, units and trails can change
 * within a tick. Single queries use a fresh context through hasTileVision().
 */
export function createTileVisionQuery(
  game: Game,
  viewer: Player,
): (tile: TileRef) => boolean {
  if (!game.config().fogOfWar() || game.inSpawnPhase()) {
    return (tile) => game.isValidRef(tile);
  }
  const viewerID = viewer.smallID();
  const relationships = new Map<number, boolean>();
  const friendlyOwner = (id: number) => {
    if (id === viewerID) return true;
    let value = relationships.get(id);
    if (value === undefined) {
      const owner = game.playerBySmallID(id);
      value = owner.isPlayer() && owner.isFriendly(viewer);
      relationships.set(id, value);
    }
    return value;
  };
  const tick = game.ticks(),
    width = game.width(),
    height = game.height();
  const trails = game.shipVisionTrails();
  let satellites: Unit[] | undefined;
  let radars: Unit[] | undefined;
  return (tile) => {
    if (!game.isValidRef(tile)) return false;
    satellites ??= game.units(UnitType.Satellite);
    if (
      satellites.some(
        (satellite) =>
          satellite.isActive() &&
          friendlyOwner(satellite.owner().smallID()) &&
          satelliteDistanceSquared(
            width,
            height,
            game.x(tile),
            game.y(tile),
            game.x(satellite.tile()),
            game.y(satellite.tile()),
          ) <=
            SATELLITE_VISION ** 2,
      )
    )
      return true;
    if (trails.hasVision(tick, tile, friendlyOwner)) return true;
    if (
      territoryVisionIndex(game).hasVision(
        tile,
        TERRITORY_VISION,
        friendlyOwner,
      )
    )
      return true;
    if (
      game.anyUnitNearby(tile, LOCAL_RANGE, LOCAL_SOURCES, (unit) => {
        const radius = unitVisionRadius(unit.type(), unit.level());
        return (
          friendlyOwner(unit.owner().smallID()) &&
          game.euclideanDistSquared(tile, unit.tile()) <= radius * radius
        );
      })
    )
      return true;
    radars ??= game.units(UnitType.RadarStation);
    return radars.some(
      (unit) =>
        !unit.isUnderConstruction() &&
        friendlyOwner(unit.owner().smallID()) &&
        game.euclideanDistSquared(tile, unit.tile()) <=
          unitVisionRadius(unit.type(), unit.level()) ** 2,
    );
  };
}

/** Point query matching shared vision with no state cached across actions. */
export function hasTileVision(
  game: Game,
  viewer: Player,
  tile: TileRef,
): boolean {
  if (!game.isValidRef(tile)) return false;
  return createTileVisionQuery(game, viewer)(tile);
}
