import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { Config } from "@openfront/engine-lib/configuration/Config";
import { coastalBatteryRange } from "@openfront/engine-lib/game/NavalBalance";
import { EventBus } from "@openfront/shared/EventBus";
import { describe, expect, it, vi } from "vitest";
import { BuildPreviewController } from "../../src/client/controllers/BuildPreviewController";
import { SAMRadiusPass } from "../../src/client/render/gl/passes/SamRadiusPass";
import { GPURenderer } from "../../src/client/render/gl/Renderer";
import type { UnitState } from "../../src/client/render/types";

function rendererHarness() {
  const r = Object.create(GPURenderer.prototype) as any;
  Object.assign(r, {
    selectedUnitIds: [],
    batteryGhostVisible: false,
    batteryHighlightVisible: false,
    samGhostVisible: false,
    samHighlightVisible: false,
    batteryRadiusPass: { setVisible: vi.fn() },
    samRadiusPass: { setVisible: vi.fn() },
    structurePass: { updateGhostPreview: vi.fn(), setHighlightTypes: vi.fn() },
    structureLevelPass: { setHighlightTypes: vi.fn() },
    railroadPass: { updateGhostPreview: vi.fn() },
    rangeCirclePass: { updateGhostPreview: vi.fn() },
    crosshairPass: { updateGhostPreview: vi.fn() },
    worldTextPass: { setGhostCostLabel: vi.fn() },
    selectionBoxPass: { hide: vi.fn() },
  });
  return r;
}

describe("battery coverage overlay", () => {
  it.each([
    UnitType.TransportShip,
    UnitType.Warship,
    UnitType.Submarine,
    UnitType.CoastalBattery,
    UnitType.Port,
  ])("shows for %s placement and clears when placement ends", (type) => {
    const r = rendererHarness();
    r.updateGhostPreview({ ghostType: type });
    expect(r.batteryRadiusPass.setVisible).toHaveBeenLastCalledWith(true);
    r.updateGhostPreview(null);
    expect(r.batteryRadiusPass.setVisible).toHaveBeenLastCalledWith(false);
  });
  it("keeps coverage visible while a fleet is selected, even after hover or build mode clears", () => {
    const r = rendererHarness();
    r.setSelectedUnits([42]);
    r.setHighlightStructureTypes(null);
    r.updateGhostPreview(null);
    expect(r.batteryRadiusPass.setVisible).toHaveBeenLastCalledWith(true);
    r.setSelectedUnits([]);
    expect(r.batteryRadiusPass.setVisible).toHaveBeenLastCalledWith(false);
    r.setHighlightStructureTypes([UnitType.CoastalBattery]);
    expect(r.batteryRadiusPass.setVisible).toHaveBeenLastCalledWith(true);
    r.setHighlightStructureTypes([UnitType.City]);
    expect(r.batteryRadiusPass.setVisible).toHaveBeenLastCalledWith(false);
  });
  it("collects completed batteries at their upgraded radius with ownership colors", () => {
    const pass = Object.create(SAMRadiusPass.prototype) as any;
    Object.assign(pass, {
      unitType: UnitType.CoastalBattery,
      rangeForLevel: coastalBatteryRange,
      mapW: 1000,
      dirtyGroups: new Set(),
      localPlayerID: 1,
      allies: new Set([2]),
      colorMode: "perspective",
    });
    const state = (id: number, ownerID: number, extra = {}) =>
      ({
        id,
        ownerID,
        unitType: UnitType.CoastalBattery,
        pos: id * 100,
        level: 1,
        isActive: true,
        underConstruction: false,
        samUpgradeStartTick: null,
        samUpgradeDuration: null,
        ...extra,
      }) as UnitState;
    const units = [
      state(1, 1),
      state(2, 2, { level: 3 }),
      state(3, 3),
      state(4, 3, { underConstruction: true }),
      state(5, 3, { isActive: false }),
      state(6, 3, { unitType: UnitType.SAMLauncher }),
    ];
    const circles = pass.collectSAMCircles(
      new Map(units.map((u) => [u.id, u])),
      0,
    );
    expect(circles).toHaveLength(3);
    expect(circles.map((c: any) => [c.radius, c.r, c.g, c.b])).toEqual([
      [60, 0, 1, 0],
      [100, 1, 1, 0],
      [60, 1, 0, 0],
    ]);
  });
});

it("previews the range of the upgraded battery, including bulk upgrades", () => {
  const config = new Config({} as never, false);
  const controller = new BuildPreviewController(
    { config: () => config, unit: () => ({ level: () => 2 }) } as never,
    new EventBus(),
    { upgradeMultiplier: 5 } as never,
    {} as never,
    {} as never,
    {} as never,
  ) as any;
  const level = controller.resolveGhostRangeLevel({
    type: UnitType.CoastalBattery,
    canUpgrade: 7,
  });
  expect(level).toBe(7);
  expect(config.coastalBatteryRange(level)).toBe(120);
  expect(
    controller.resolveGhostRangeLevel({
      type: UnitType.CoastalBattery,
      canUpgrade: false,
    }),
  ).toBe(1);
});

it("previews the upgraded radar coverage for single and bulk upgrades", () => {
  const config = new Config({} as never, false);
  const state = { upgradeMultiplier: 1 };
  const controller = new BuildPreviewController(
    { config: () => config, unit: () => ({ level: () => 1 }) } as never,
    new EventBus(),
    state as never,
    {} as never,
    {} as never,
    {} as never,
  ) as any;
  const buildable = { type: UnitType.RadarStation, canUpgrade: 7 };
  expect(config.radarRange(controller.resolveGhostRangeLevel(buildable))).toBe(
    200,
  );
  state.upgradeMultiplier = 2;
  expect(config.radarRange(controller.resolveGhostRangeLevel(buildable))).toBe(
    225,
  );
  expect(
    config.radarRange(
      controller.resolveGhostRangeLevel({ ...buildable, canUpgrade: false }),
    ),
  ).toBe(150);
});
