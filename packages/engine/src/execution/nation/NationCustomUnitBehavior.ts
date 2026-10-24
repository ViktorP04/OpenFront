import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { hasTileVision } from "../../game/FogOfWar";
import { Game, Player } from "../../game/Game";
import { ConstructionExecution } from "../ConstructionExecution";
import { MoveWarshipExecution } from "../MoveWarshipExecution";
import { UpgradeStructureExecution } from "../UpgradeStructureExecution";
import { randTerritoryTileArray } from "./NationUtils";

/** Occasional purchases; all persistent state lives in ordinary units and executions. */
export class NationCustomUnitBehavior {
  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
  ) {}

  act(): boolean {
    if (!this.random.chance(8)) return false;
    const established = this.player
      .units(UnitType.City, UnitType.Port)
      .some((unit) => !unit.isUnderConstruction());
    if (!established) return false;
    const type = this.random.randElement([
      UnitType.CoastalBattery,
      UnitType.RadarStation,
      UnitType.Submarine,
    ]);
    if (this.game.config().isUnitDisabled(type)) return false;
    if (type === UnitType.RadarStation && !this.game.config().fogOfWar())
      return false;
    const units = this.player.units(type);
    const affordable =
      this.player.gold() >=
      this.game.unitInfo(type).cost(this.game, this.player) * 2n;
    if (type === UnitType.Submarine) {
      const ports = this.player
        .units(UnitType.Port)
        .filter((port) => !port.isUnderConstruction());
      if (ports.length === 0) return false;
      const idle = units.find((sub) => {
        const destination = sub.warshipState().patrolTile;
        return (
          !sub.targetUnit() &&
          (destination === undefined ||
            this.game.manhattanDist(sub.tile(), destination) < 10)
        );
      });
      if (!idle && (units.length >= 2 || !affordable)) return false;
      const anchor = idle?.tile() ?? this.random.randElement(ports).tile();
      const threats = this.game
        .nearbyUnits(anchor, 200, [
          UnitType.TransportShip,
          UnitType.Warship,
          UnitType.Submarine,
        ])
        .filter(
          ({ unit }) =>
            unit.isActive() &&
            unit.isTargetable() &&
            unit.owner() !== this.player &&
            this.player.canAttackPlayer(unit.owner(), true) &&
            hasTileVision(this.game, this.player, unit.tile()),
        );
      for (let i = 0; i < 40; i++) {
        const threat = threats[i];
        const x = this.game.x(anchor) + this.random.nextInt(-150, 151);
        const y = this.game.y(anchor) + this.random.nextInt(-150, 151);
        if (!threat && !this.game.isValidCoord(x, y)) continue;
        const tile = threat?.unit.tile() ?? this.game.ref(x, y);
        if (!this.game.isWater(tile) || this.game.isImpassable(tile)) continue;
        const component = this.game.getWaterComponent(tile);
        if (
          component === null ||
          !this.game.hasWaterComponent(anchor, component)
        )
          continue;
        if (idle) {
          this.game.addExecution(
            new MoveWarshipExecution(this.player, [idle.id()], tile),
          );
        } else {
          if (this.player.canBuild(type, tile) === false) continue;
          this.game.addExecution(
            new ConstructionExecution(this.player, type, tile),
          );
        }
        return true;
      }
      return false;
    }
    if (!affordable || units.some((unit) => unit.isUnderConstruction()))
      return false;
    // Grow coverage slowly, then buy a few range upgrades rather than spamming buildings.
    const samples =
      type === UnitType.CoastalBattery
        ? [...this.player.borderTiles()].filter((tile) =>
            this.game.isShore(tile),
          )
        : randTerritoryTileArray(this.random, this.game, this.player, 30);
    if (units.length < 2 && samples.length > 0) {
      for (let i = 0; i < 30; i++) {
        const candidate = this.random.randElement(samples);
        const tile = this.player.canBuild(type, candidate);
        if (tile === false) continue;
        const spacing = type === UnitType.RadarStation ? 150 : 60;
        if (
          units.some(
            (unit) => this.game.manhattanDist(unit.tile(), tile) < spacing,
          )
        )
          continue;
        this.game.addExecution(
          new ConstructionExecution(this.player, type, candidate),
        );
        return true;
      }
    }
    const upgrade = units.find(
      (unit) => unit.level() < 3 && this.player.canUpgradeUnit(unit),
    );
    if (!upgrade) return false;
    this.game.addExecution(
      new UpgradeStructureExecution(this.player, upgrade.id()),
    );
    return true;
  }
}
