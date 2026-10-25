import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { satellitePosition } from "@openfront/engine-lib/game/SatelliteOrbit";
import {
  zInt,
  zPlayerRef,
  zRef,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

export class SatelliteExecution implements Execution {
  private game: Game;
  private satellite?: Unit;
  private sx = 0;
  private sy = 0;
  private dx = 0;
  private dy = 0;
  private launchTick = 0;
  constructor(
    private owner: Player,
    private target: TileRef,
  ) {}
  init(game: Game): void {
    this.game = game;
    if (!game.isValidRef(this.target)) return;
    const spawn = this.owner.canBuild(UnitType.Satellite, this.target);
    if (spawn === false) return;
    const silo = this.owner
      .units(UnitType.MissileSilo)
      .find((unit) => unit.tile() === spawn);
    if (!silo) return;
    this.sx = game.x(spawn);
    this.sy = game.y(spawn);
    this.dx = game.x(this.target) - this.sx;
    this.dy = game.y(this.target) - this.sy;
    if (this.dx === 0 && this.dy === 0) return;
    this.launchTick = game.ticks();
    this.satellite = this.owner.buildUnit(UnitType.Satellite, spawn, {});
    this.satellite.setTargetable(false);
    silo.launch();
  }
  tick(tick: number): void {
    if (!this.satellite?.isActive()) return;
    if (!this.satellite.owner().isAlive()) {
      this.satellite.delete(false);
      return;
    }
    const position = satellitePosition(
      this.game.width(),
      this.game.height(),
      this.sx,
      this.sy,
      this.dx,
      this.dy,
      tick - this.launchTick,
    );
    this.satellite.move(this.game.ref(position.x, position.y));
  }
  isActive(): boolean {
    return this.satellite?.isActive() ?? false;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
  snapshot(w: SnapshotWriter) {
    return SatelliteExecutionSnapshot.write({
      initialized: this.game !== undefined,
      owner: w.player(this.owner),
      target: this.target,
      satellite: this.satellite ? w.unit(this.satellite) : null,
      sx: this.sx,
      sy: this.sy,
      dx: this.dx,
      dy: this.dy,
      launchTick: this.launchTick,
    });
  }
  restoreSnapshot(s: SatelliteState, r: SnapshotReader): void {
    if (s.initialized) this.game = r.game;
    this.owner = r.player(s.owner);
    this.target = s.target;
    this.satellite = r.unitOrNull(s.satellite) ?? undefined;
    this.sx = s.sx;
    this.sy = s.sy;
    this.dx = s.dx;
    this.dy = s.dy;
    this.launchTick = s.launchTick;
  }
}
const SatelliteStateSchema = z.object({
  initialized: z.boolean(),
  owner: zPlayerRef(),
  target: zTile(),
  satellite: zRef().nullable(),
  sx: zInt(),
  sy: zInt(),
  dx: zInt(),
  dy: zInt(),
  launchTick: zInt(),
});
type SatelliteState = z.infer<typeof SatelliteStateSchema>;
export const SatelliteExecutionSnapshot = execSnapshotType({
  name: "Satellite",
  version: 1,
  schema: SatelliteStateSchema,
  cls: () => SatelliteExecution,
});
