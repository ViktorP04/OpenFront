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
  const scale = game.config().fogOfWarScale();
  const cellX = (tile: TileRef) => Math.floor(game.x(tile) / scale);
  const cellY = (tile: TileRef) => Math.floor(game.y(tile) / scale);
  const distanceSquared = (a: TileRef, b: TileRef) =>
    scale === 1
      ? game.euclideanDistSquared(a, b)
      : (cellX(a) - cellX(b)) ** 2 + (cellY(a) - cellY(b)) ** 2;
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
  const trails = game.config().fogOfWarTrails()
    ? game.shipVisionTrails()
    : undefined;
  let satellites: Unit[] | undefined;
  let radars: Unit[] | undefined;
  let localChecks = 0;
  let localSources:
    | { x: number; y: number; radiusSquared: number }[]
    | null
    | undefined;
  const query = (tile: TileRef) => {
    if (!game.isValidRef(tile)) return false;
    satellites ??= game.units(UnitType.Satellite);
    if (
      satellites.some(
        (satellite) =>
          satellite.isActive() &&
          friendlyOwner(satellite.owner().smallID()) &&
          satelliteDistanceSquared(
            Math.ceil(width / scale),
            Math.ceil(height / scale),
            cellX(tile),
            cellY(tile),
            cellX(satellite.tile()),
            cellY(satellite.tile()),
          ) <=
            Math.floor(SATELLITE_VISION / scale) ** 2,
      )
    )
      return true;
    if (trails?.hasVision(tick, tile, friendlyOwner, scale)) return true;
    if (
      territoryVisionIndex(game).hasVision(
        tile,
        TERRITORY_VISION,
        friendlyOwner,
        scale,
      )
    )
      return true;
    // Large shore filters ask thousands of negative point queries. After a
    // few probes, a short list of friendly circles beats probing the global
    // grid for every unit type. Independent point queries retain the grid.
    if (++localChecks === 8) {
      localSources = game
        .units(LOCAL_SOURCES)
        .filter(
          (unit) =>
            unit.isActive() &&
            !unit.isUnderConstruction() &&
            friendlyOwner(unit.owner().smallID()),
        )
        .map((unit) => ({
          x: cellX(unit.tile()),
          y: cellY(unit.tile()),
          radiusSquared:
            Math.floor(
              Math.min(
                LOCAL_RANGE,
                unitVisionRadius(unit.type(), unit.level()),
              ) / scale,
            ) ** 2,
        }));
      // With many allies or a large fleet, retain the spatial grid instead.
      if (localSources.length > 64) localSources = null;
    }
    if (localSources) {
      const x = cellX(tile),
        y = cellY(tile);
      for (const source of localSources) {
        if ((source.x - x) ** 2 + (source.y - y) ** 2 <= source.radiusSquared)
          return true;
      }
    } else if (
      game.anyUnitNearby(
        tile,
        LOCAL_RANGE + 2 * (scale - 1),
        LOCAL_SOURCES,
        (unit) => {
          const radius = Math.floor(
            unitVisionRadius(unit.type(), unit.level()) / scale,
          );
          return (
            friendlyOwner(unit.owner().smallID()) &&
            distanceSquared(tile, unit.tile()) <= radius * radius
          );
        },
      )
    )
      return true;
    radars ??= game.units(UnitType.RadarStation);
    return radars.some(
      (unit) =>
        !unit.isUnderConstruction() &&
        friendlyOwner(unit.owner().smallID()) &&
        distanceSquared(tile, unit.tile()) <=
          Math.floor(unitVisionRadius(unit.type(), unit.level()) / scale) ** 2,
    );
  };
  if (scale === 1) return query;
  // A shoreline often has multiple map pixels in one visibility cell.
  // Cache only within this read-only batch, never across simulation actions.
  const cache = new Map<number, boolean>();
  const columns = Math.ceil(width / scale);
  return (tile) => {
    if (!game.isValidRef(tile)) return false;
    const cell = cellY(tile) * columns + cellX(tile);
    let value = cache.get(cell);
    if (value === undefined) {
      value = query(tile);
      cache.set(cell, value);
    }
    return value;
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
