import { UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  zInt,
  zPlayerRef,
  zRef,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { hasTileVision } from "../game/FogOfWar";
import {
  Execution,
  Game,
  isUnit,
  OwnerComp,
  Unit,
  UnitParams,
} from "../game/Game";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import {
  restoreWaterPathFinder,
  WaterPathFinderSchema,
  waterPathFinderState,
} from "../snapshot/PathfinderSnapshots";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { ShellExecution } from "./ShellExecution";

const SUBMARINE_TARGETS = [
  UnitType.CoastalBattery,
  UnitType.TransportShip,
  UnitType.Submarine,
  UnitType.Warship,
];

const SHIP_TARGETS = [
  UnitType.TransportShip,
  UnitType.Submarine,
  UnitType.Warship,
];

/** Stable target ordering and diplomacy rules shared by both custom naval units. */
function targetFor(
  game: Game,
  source: Unit,
  range: number,
  targetTypes: UnitType[] = SHIP_TARGETS,
): Unit | undefined {
  const owner = source.owner();
  return game
    .nearbyUnits(source.tile(), range, targetTypes)
    .filter(
      ({ unit }) =>
        unit.isActive() &&
        unit.isTargetable() &&
        unit.owner() !== owner &&
        (unit.type() !== UnitType.CoastalBattery ||
          hasTileVision(game, owner, unit.tile()) ||
          unit.targetUnit()?.owner() === owner) &&
        owner.canAttackPlayer(unit.owner(), true),
    )
    .sort(
      (a, b) => a.distSquared - b.distSquared || a.unit.id() - b.unit.id(),
    )[0]?.unit;
}

/** A capturable shoreline structure; unlike a defense post it never buffs land combat. */
export class CoastalBatteryExecution implements Execution {
  private game: Game;
  private lastAttackTick = -1000000;
  private lastHealth: number | null = null;
  private lastDamageTick = -1000000;
  private sentTo = new Set<Unit>();
  constructor(private battery: Unit) {}
  init(game: Game): void {
    this.game = game;
  }
  tick(tick: number): void {
    if (!this.battery.isActive() || this.battery.isUnderConstruction()) return;
    const config = this.game.config();
    const health = this.battery.health();
    if (this.lastHealth === null || health < this.lastHealth)
      this.lastDamageTick = tick;
    const healingTicks =
      tick - this.lastDamageTick - config.coastalBatteryRegenDelayTicks();
    if (
      health < this.battery.maxHealth() &&
      healingTicks >= 0 &&
      healingTicks % config.coastalBatteryRegenIntervalTicks() === 0
    )
      this.battery.modifyHealth(config.coastalBatteryRegenAmount());
    this.lastHealth = this.battery.health();
    for (const unit of this.sentTo)
      if (!unit.isActive()) this.sentTo.delete(unit);
    const target = targetFor(
      this.game,
      this.battery,
      this.game.config().coastalBatteryRange(this.battery.level()),
    );
    this.battery.setTargetUnit(target);
    if (
      !target ||
      this.sentTo.has(target) ||
      tick - this.lastAttackTick <
        this.game.config().coastalBatteryReloadTicks()
    )
      return;
    this.lastAttackTick = tick;
    this.game.addExecution(
      new ShellExecution(
        this.battery.tile(),
        this.battery.owner(),
        this.battery,
        target,
      ),
    );
    if (!target.hasHealth()) this.sentTo.add(target);
  }
  isActive(): boolean {
    return this.battery.isActive();
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
  snapshot(w: SnapshotWriter): ExecRecord {
    return CoastalBatteryExecutionSnapshot.write({
      initialized: this.game !== undefined,
      battery: w.unit(this.battery),
      lastAttackTick: this.lastAttackTick,
      lastHealth: this.lastHealth,
      lastDamageTick: this.lastDamageTick,
      sentTo: [...this.sentTo].map((u) => w.unit(u)),
    });
  }
  restoreSnapshot(s: BatteryState, r: SnapshotReader): void {
    if (s.initialized) this.game = r.game;
    this.battery = r.unit(s.battery);
    this.lastAttackTick = s.lastAttackTick;
    this.lastHealth = s.lastHealth;
    this.lastDamageTick = s.lastDamageTick;
    this.sentTo = new Set(s.sentTo.map((i) => r.unit(i)));
  }
}
const BatteryStateSchema = z.object({
  initialized: z.boolean(),
  battery: zRef(),
  lastAttackTick: zInt(),
  lastHealth: zInt().nullable(),
  lastDamageTick: zInt(),
  sentTo: z.array(zRef()),
});
type BatteryState = z.infer<typeof BatteryStateSchema>;
export const CoastalBatteryExecutionSnapshot = execSnapshotType({
  name: "CoastalBattery",
  version: 2,
  migrations: {
    1: (raw) => ({
      ...(raw as object),
      lastHealth: null,
      lastDamageTick: -1000000,
    }),
  },
  schema: BatteryStateSchema,
  cls: () => CoastalBatteryExecution,
});

/** A stealth raider that attacks military ships and transports, ignoring trade ships. */
export class SubmarineExecution implements Execution {
  private game: Game;
  private sub: Unit | undefined;
  private pathfinder: WaterPathFinder;
  private lastAttackTick = -1000000;
  private sentTo = new Set<Unit>();
  constructor(
    private input: (UnitParams<UnitType.Submarine> & OwnerComp) | Unit,
  ) {}
  init(game: Game): void {
    this.game = game;
    this.pathfinder = new WaterPathFinder(game);
    if (isUnit(this.input)) this.sub = this.input;
    else {
      const tile = this.input.owner.canBuild(
        UnitType.Submarine,
        this.input.patrolTile,
      );
      if (tile === false) return;
      this.sub = this.input.owner.buildUnit(UnitType.Submarine, tile, {
        patrolTile: this.input.patrolTile,
      });
    }
    this.updateVisibility(game.ticks());
  }
  private updateVisibility(tick: number): void {
    if (!this.sub) return;
    const owner = this.sub.owner();
    const detected = this.game
      .nearbyUnits(
        this.sub.tile(),
        Math.max(
          this.game.config().submarineDetectionRange(),
          this.game.config().coastalBatterySubmarineDetectionRange(),
        ),
        [UnitType.Warship, UnitType.CoastalBattery],
      )
      .some(
        ({ unit }) =>
          unit.isActive() &&
          !unit.isUnderConstruction() &&
          this.game.euclideanDistSquared(this.sub!.tile(), unit.tile()) <=
            (unit.type() === UnitType.CoastalBattery
              ? this.game.config().coastalBatterySubmarineDetectionRange()
              : this.game.config().submarineDetectionRange()) **
              2 &&
          unit.owner() !== owner &&
          owner.canAttackPlayer(unit.owner(), true),
      );
    this.sub.setTargetable(
      detected ||
        tick - this.lastAttackTick <= this.game.config().submarineRevealTicks(),
    );
  }
  tick(tick: number): void {
    if (!this.sub?.isActive()) return;
    this.updateVisibility(tick);
    for (const unit of this.sentTo)
      if (!unit.isActive()) this.sentTo.delete(unit);
    const target =
      this.sub.warshipState().scoutMode !== false
        ? undefined
        : targetFor(
            this.game,
            this.sub,
            this.game.config().submarineRange(),
            SUBMARINE_TARGETS,
          );
    this.sub.setTargetUnit(target);
    if (
      target &&
      !this.sentTo.has(target) &&
      tick - this.lastAttackTick >= this.game.config().submarineReloadTicks()
    ) {
      this.lastAttackTick = tick;
      this.sub.setTargetable(true);
      this.sub.updateWarshipState({ isInCombat: true });
      this.game.addExecution(
        new ShellExecution(this.sub.tile(), this.sub.owner(), this.sub, target),
      );
      if (!target.hasHealth()) this.sentTo.add(target);
    }
    const destination = this.sub.warshipState().patrolTile;
    if (destination === undefined || destination === this.sub.tile()) return;
    this.sub.setTargetTile(destination);
    const step = this.pathfinder.next(this.sub.tile(), destination);
    if (
      step.status === PathStatus.NEXT ||
      step.status === PathStatus.COMPLETE
    ) {
      this.sub.move(step.node);
      if (step.status === PathStatus.COMPLETE)
        this.sub.setTargetTile(undefined);
    } else if (step.status === PathStatus.NOT_FOUND)
      this.sub.setTargetTile(undefined);
  }
  isActive(): boolean {
    return this.sub?.isActive() ?? false;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
  snapshot(w: SnapshotWriter): ExecRecord {
    return SubmarineExecutionSnapshot.write({
      init:
        this.game === undefined ? null : waterPathFinderState(this.pathfinder),
      sub: this.sub ? w.unit(this.sub) : null,
      lastAttackTick: this.lastAttackTick,
      sentTo: [...this.sentTo].map((u) => w.unit(u)),
      input: isUnit(this.input)
        ? { kind: "unit", unit: w.unit(this.input) }
        : {
            kind: "build",
            owner: w.player(this.input.owner),
            patrolTile: this.input.patrolTile,
          },
    });
  }
  restoreSnapshot(s: SubmarineState, r: SnapshotReader): void {
    if (s.init !== null) {
      this.game = r.game;
      this.pathfinder = restoreWaterPathFinder(r.game, s.init);
    }
    this.sub = s.sub === null ? undefined : r.unit(s.sub);
    this.lastAttackTick = s.lastAttackTick;
    this.sentTo = new Set(s.sentTo.map((i) => r.unit(i)));
    this.input =
      s.input.kind === "unit"
        ? r.unit(s.input.unit)
        : { owner: r.player(s.input.owner), patrolTile: s.input.patrolTile };
  }
}
const SubmarineStateSchema = z.object({
  init: WaterPathFinderSchema.nullable(),
  sub: zRef().nullable(),
  lastAttackTick: zInt(),
  sentTo: z.array(zRef()),
  input: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("unit"), unit: zRef() }),
    z.object({
      kind: z.literal("build"),
      owner: zPlayerRef(),
      patrolTile: zTile(),
    }),
  ]),
});
type SubmarineState = z.infer<typeof SubmarineStateSchema>;
export const SubmarineExecutionSnapshot = execSnapshotType({
  name: "Submarine",
  version: 1,
  schema: SubmarineStateSchema,
  cls: () => SubmarineExecution,
});
