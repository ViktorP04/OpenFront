import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { render } from "lit";
import { describe, it, expect } from "vitest";
import { ControlPanel } from "../../src/client/hud/layers/ControlPanel";
import { UnitSelectionEvent } from "../../src/client/InputHandler";
import { SetSubmarineModeIntentEvent } from "../../src/client/Transport";

describe("submarine mode controls", () => {
  it("toggles selected submarines, excludes other ships, and clears on deselection", () => {
    const panel = new ControlPanel();
    const owner = {};
    const makeSub = (id: number, scoutMode: boolean) => ({
      id: () => id,
      type: () => UnitType.Submarine,
      owner: () => owner,
      isActive: () => true,
      warshipState: () => ({ scoutMode }),
    });
    const subs = [makeSub(1, true), makeSub(2, false)];
    const enemy = { ...makeSub(3, true), owner: () => ({}) };
    const ship = { ...makeSub(4, true), type: () => UnitType.Warship };
    const units = [...subs, enemy, ship];
    panel.game = {
      myPlayer: () => owner,
      unit: (id: number) => units.find((unit) => unit.id() === id),
    } as never;
    panel.uiState = {} as never;
    panel.eventBus = new EventBus();
    panel.init();
    const events: SetSubmarineModeIntentEvent[] = [];
    panel.eventBus.on(SetSubmarineModeIntentEvent, (event) =>
      events.push(event),
    );
    const container = document.createElement("div");
    const draw = () => render((panel as any).renderSubmarineMode(), container);
    panel.eventBus.emit(new UnitSelectionEvent(subs[0] as never, true));
    draw();
    container.querySelector("button")!.click();
    expect(events[0].unitIds).toEqual([1]);
    expect(events[0].scoutMode).toBe(false);
    panel.eventBus.emit(new UnitSelectionEvent(null, true, units as never));
    draw();
    container.querySelector("button")!.click();
    expect(events[1].unitIds).toEqual([1, 2]);
    expect(events[1].scoutMode).toBe(true);
    panel.eventBus.emit(new UnitSelectionEvent(null, false));
    draw();
    expect(container.querySelector("button")).toBeNull();
  });
});
