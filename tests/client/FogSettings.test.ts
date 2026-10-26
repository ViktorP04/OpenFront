import { html, render } from "lit";
import { expect, it, vi } from "vitest";
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));
import { renderFogSettings } from "../../src/client/components/FogSettings";

it("shows resolution and independent visibility-trail controls only with fog enabled", () => {
  const container = document.createElement("div");
  const scale = vi.fn(),
    trails = vi.fn();
  render(html`${renderFogSettings(false, 4, false, scale, trails)}`, container);
  expect(container.querySelector("select")).toBeNull();
  render(html`${renderFogSettings(true, 4, true, scale, trails)}`, container);
  const select = container.querySelector("select")!;
  expect(select.value).toBe("4");
  expect([...select.options].map((o) => o.value)).toEqual(["1", "2", "4", "8"]);
  select.value = "8";
  select.dispatchEvent(new Event("change"));
  expect(scale).toHaveBeenCalledWith(8);
  const checkbox = container.querySelector("input")!;
  expect(checkbox.checked).toBe(true);
  checkbox.checked = false;
  checkbox.dispatchEvent(new Event("change"));
  expect(trails).toHaveBeenCalledWith(false);
});
