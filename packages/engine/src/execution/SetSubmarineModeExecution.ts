import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { zNum, zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

export class SetSubmarineModeExecution implements Execution {
  constructor(
    private owner: Player,
    private unitIds: number[],
    private scoutMode: boolean,
  ) {}
  init(game: Game): void {
    const selected = new Set(this.unitIds);
    for (const sub of this.owner.units(UnitType.Submarine)) {
      if (!selected.has(sub.id()) || !sub.isActive()) continue;
      sub.updateWarshipState({ scoutMode: this.scoutMode });
      if (this.scoutMode) sub.setTargetUnit(undefined);
    }
  }
  tick(): void {}
  isActive(): boolean {
    return false;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
  snapshot(w: SnapshotWriter) {
    return SetSubmarineModeExecutionSnapshot.write({
      owner: w.player(this.owner),
      unitIds: [...this.unitIds],
      scoutMode: this.scoutMode,
    });
  }
  restoreSnapshot(s: ModeState, r: SnapshotReader): void {
    this.owner = r.player(s.owner);
    this.unitIds = s.unitIds;
    this.scoutMode = s.scoutMode;
  }
}
const ModeStateSchema = z.object({
  owner: zPlayerRef(),
  unitIds: z.array(zNum()),
  scoutMode: z.boolean(),
});
type ModeState = z.infer<typeof ModeStateSchema>;
export const SetSubmarineModeExecutionSnapshot = execSnapshotType({
  name: "SetSubmarineMode",
  version: 1,
  schema: ModeStateSchema,
  cls: () => SetSubmarineModeExecution,
});
