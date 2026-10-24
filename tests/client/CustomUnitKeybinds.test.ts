import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UnitDisplay } from "../../src/client/hud/layers/UnitDisplay";
import { InputHandler } from "../../src/client/InputHandler";
import { KEYBINDS_KEY, UserSettings } from "../../src/client/UserSettings";

let handler: InputHandler | undefined;
beforeEach(() => new UserSettings().removeCached(KEYBINDS_KEY, false));
afterEach(() => {
  handler?.destroy();
  handler = undefined;
  new UserSettings().removeCached(KEYBINDS_KEY, false);
});
function start(fog = true) {
  const state = {
    attackRatio: 0.5,
    ghostStructure: null,
    rocketDirectionUp: true,
    upgradeMultiplier: 1,
  };
  handler = new InputHandler(
    {
      inSpawnPhase: () => false,
      myPlayer: () => ({ isAlive: () => true }),
      config: () => ({ fogOfWar: () => fog }),
    } as never,
    state,
    document.createElement("canvas"),
    new EventBus(),
  );
  handler.initialize();
  return state;
}
function press(code: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
  window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
}

describe("custom unit shortcuts", () => {
  it("selects custom units with defaults and cycles structure bulk upgrades", () => {
    const state = start();
    press("KeyO");
    expect(state.ghostStructure).toBe(UnitType.CoastalBattery);
    press("KeyO");
    expect(state.upgradeMultiplier).toBe(5);
    press("KeyJ");
    expect(state.ghostStructure).toBe(UnitType.Submarine);
    press("KeyH");
    expect(state.ghostStructure).toBe(UnitType.RadarStation);
    press("KeyH");
    expect(state.upgradeMultiplier).toBe(5);
  });
  it("supports remapping and unbinding without keeping the old default active", () => {
    new UserSettings().setKeybinds({
      buildCoastalBattery: { value: "KeyI", key: "I" },
      buildSubmarine: { value: "KeyV", key: "V" },
      buildRadarStation: { value: "Null", key: "" },
    });
    const state = start();
    press("KeyJ");
    press("KeyH");
    press("KeyO");
    expect(state.ghostStructure).toBeNull();
    press("KeyI");
    expect(state.ghostStructure).toBe(UnitType.CoastalBattery);
    press("KeyV");
    expect(state.ghostStructure).toBe(UnitType.Submarine);
  });
  it("preserves an existing player binding that uses a new default key", () => {
    new UserSettings().setKeybinds({
      boatAttack: { value: "KeyJ", key: "J" },
      groundAttack: { value: "KeyO", key: "O" },
    });
    expect(new UserSettings().keybinds(false).buildSubmarine).toBeUndefined();
    expect(new UserSettings().keybinds(false).boatAttack).toBe("KeyJ");
    expect(
      new UserSettings().keybinds(false).buildCoastalBattery,
    ).toBeUndefined();
    expect(new UserSettings().keybinds(false).groundAttack).toBe("KeyO");
  });
  it("keeps radar unavailable when fog is off", () => {
    const state = start(false);
    press("KeyH");
    expect(state.ghostStructure).toBeNull();
  });
});

it("groups custom buttons at the far right with shortcut labels and hides radar outside fog games", () => {
  let fog = true;
  const display = new UnitDisplay();
  display.game = {
    myPlayer: () => ({
      isAlive: () => true,
      gold: () => 1000000n,
      units: () => [],
      totalUnitLevels: () => 0,
    }),
    inSpawnPhase: () => false,
    config: () => ({ fogOfWar: () => fog, isUnitDisabled: () => false }),
  } as never;
  display.uiState = { ghostStructure: null } as never;
  const container = document.createElement("div");
  render(display.render(), container);
  expect(
    [...container.querySelectorAll("img[alt]")]
      .map((el) => el.getAttribute("alt"))
      .slice(-4),
  ).toEqual(["mirv", "coastal_battery", "submarine", "radar_station"]);
  expect(
    container.querySelector('img[alt="coastal_battery"]')?.parentElement
      ?.parentElement?.textContent,
  ).toContain("O");
  expect(
    container.querySelector('img[alt="submarine"]')?.parentElement
      ?.parentElement?.textContent,
  ).toContain("J");
  expect(
    container.querySelector('img[alt="radar_station"]')?.parentElement
      ?.parentElement?.textContent,
  ).toContain("H");
  fog = false;
  render(display.render(), container);
  expect(container.querySelector('img[alt="radar_station"]')).toBeNull();
});
