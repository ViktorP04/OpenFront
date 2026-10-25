import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { Config } from "@openfront/engine-lib/configuration/Config";
import { EventBus } from "@openfront/shared/EventBus";
import { describe, it, expect, vi } from "vitest";
import { BuildPreviewController } from "../../src/client/controllers/BuildPreviewController";
import { OrbitPreviewPass } from "../../src/client/render/gl/passes/OrbitPreviewPass";

describe("satellite launch preview", () => {
  it("anchors the orbit to the actual silo and puts the vision circle at the selected target", () => {
    const game = {
      config: () => new Config({} as never, false),
      width: () => 800,
      height: () => 400,
      x: (tile: number) => tile % 800,
      y: (tile: number) => Math.floor(tile / 800),
      myPlayer: () => ({ gold: () => 10_000_000n, smallID: () => 1 }),
    };
    const controller = new BuildPreviewController(
      game as never,
      new EventBus(),
      {} as never,
      {} as never,
      {} as never,
      { snapBuildPreview: () => false, cursorCostLabel: () => true } as never,
    ) as any;
    controller.ghostUnit = {
      buildableUnit: {
        type: UnitType.Satellite,
        canBuild: 800 * 200 + 20,
        canUpgrade: false,
        cost: 1_000_000n,
        ghostRailPaths: [],
        overlappingRailroads: [],
      },
    };
    const preview = controller.buildGhostPreviewData(800 * 200 + 400, false);
    expect(preview.orbit).toEqual({
      sourceX: 20,
      sourceY: 200,
      width: 800,
      height: 400,
    });
    expect(preview.rangeRadius).toBe(160);
    expect(preview.radiusTileX).toBe(400);
    expect(preview.radiusTileY).toBe(200);
    expect(preview.snapToPlacement).toBe(true);
    const pass = Object.create(OrbitPreviewPass.prototype) as any;
    const upload = vi.fn();
    pass.gl = { bindBuffer: vi.fn(), bufferData: upload };
    pass.updateGhostPreview(preview);
    expect(pass.count).toBeGreaterThan(0);
    expect(upload).toHaveBeenCalled();
    pass.updateGhostPreview(null);
    expect(pass.count).toBe(0);
  });
});
