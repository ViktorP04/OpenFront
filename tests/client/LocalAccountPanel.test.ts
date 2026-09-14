import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocalAccountPanel } from "../../src/client/components/LocalAccountPanel";

vi.mock("../../src/client/ApiBase", () => ({
  getApiBase: () => "/api/accounts",
}));
let panel: LocalAccountPanel;
beforeEach(async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ registrationCodeRequired: true }),
      }),
  );
  panel = new LocalAccountPanel();
  document.body.append(panel);
  await panel.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await panel.updateComplete;
});
afterEach(() => {
  panel.remove();
  vi.unstubAllGlobals();
});
it("offers password login and registration with a required private code", async () => {
  expect(panel.textContent).toContain("Sign in");
  const toggle = Array.from(panel.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === "Create an account",
  )!;
  toggle.click();
  await panel.updateComplete;
  expect(
    panel.querySelector<HTMLInputElement>('input[name="registrationCode"]')
      ?.required,
  ).toBe(true);
  expect(
    panel.querySelector<HTMLInputElement>('input[name="password"]')?.minLength,
  ).toBe(12);
  expect(panel.textContent).toContain("email recovery is not available");
  expect(panel.textContent).not.toContain("Google");
});
it("shows server failures accessibly and allows retry without losing input", async () => {
  vi.mocked(fetch).mockResolvedValue({
    ok: false,
    json: async () => ({ error: "Incorrect username or password." }),
  } as Response);
  panel.querySelector<HTMLInputElement>('input[name="username"]')!.value =
    "Friend";
  panel.querySelector<HTMLInputElement>('input[name="password"]')!.value =
    "long password 123";
  panel
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await panel.updateComplete;
  expect(fetch).toHaveBeenLastCalledWith(
    "/api/accounts/auth/login",
    expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({
        username: "Friend",
        password: "long password 123",
      }),
    }),
  );
  expect(panel.querySelector('[role="alert"]')?.textContent).toContain(
    "Incorrect username",
  );
  expect(
    panel.querySelector<HTMLInputElement>('input[name="username"]')?.value,
  ).toBe("Friend");
  expect(panel.querySelector<HTMLButtonElement>("form button")?.disabled).toBe(
    false,
  );
});
it("offers password changes and session revocation for a signed-in account", async () => {
  panel.username = "Friend";
  await panel.updateComplete;
  expect(panel.textContent).toContain("Signed in as Friend");
  expect(panel.textContent).toContain("Sign out all devices");
  expect(panel.querySelector('input[name="currentPassword"]')).not.toBeNull();
  expect(panel.querySelector('input[name="registrationCode"]')).toBeNull();
});
