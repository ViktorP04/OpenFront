// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { PersistentIdSchema } from "../../src/core/Schemas";
import { GameEnv } from "../../src/core/configuration/Config";
import { ServerEnv } from "../../src/server/ServerEnv";
import { verifyClientToken } from "../../src/server/jwt";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("requires explicit private-join authorization for guests, including in dev", async () => {
  vi.stubEnv("LOCAL_ACCOUNTS", "true");
  vi.spyOn(ServerEnv, "env").mockReturnValue(GameEnv.Dev);
  const token = randomUUID();
  expect((await verifyClientToken(token)).type).toBe("error");
  expect((await verifyClientToken(token, false)).type).toBe("error");
  const guest = await verifyClientToken(token, true);
  expect(guest.type).toBe("success");
  if (guest.type !== "success") throw new Error("Expected guest");
  expect(guest.claims).toBeNull();
  expect(guest.persistentId).not.toBe(token);
  expect(PersistentIdSchema.safeParse(guest.persistentId).success).toBe(true);
  expect(await verifyClientToken(token, true)).toEqual(guest);
  expect(await verifyClientToken(token.toUpperCase(), true)).toEqual(guest);
  expect(await verifyClientToken(randomUUID(), true)).not.toEqual(guest);
  // A disclosed persistent ID cannot be reused as its bearer credential.
  expect(await verifyClientToken(guest.persistentId, true)).not.toEqual(guest);
});

it("does not enable production guests in upstream mode", async () => {
  vi.stubEnv("LOCAL_ACCOUNTS", "false");
  vi.spyOn(ServerEnv, "env").mockReturnValue(GameEnv.Prod);
  expect((await verifyClientToken(randomUUID(), true)).type).toBe("error");
});

it("separates upstream API routing from issuer and preserves local loopback routing", () => {
  vi.stubEnv("DOMAIN", "game.example.test");
  vi.stubEnv("LOCAL_ACCOUNTS", "false");
  vi.stubEnv("API_ORIGIN", "https://accounts.example.test/api");
  vi.stubEnv("AUTH_ISSUER", "https://identity.example.test");
  expect(ServerEnv.accountApiBase()).toBe("https://accounts.example.test/api");
  expect(ServerEnv.jwtIssuer()).toBe("https://identity.example.test");
  vi.stubEnv("LOCAL_ACCOUNTS", "true");
  vi.stubEnv("LOCAL_ACCOUNT_ORIGIN", "https://game.example.test");
  expect(() => ServerEnv.accountEndpoints()).toThrow("Local accounts require");
  vi.stubEnv("API_ORIGIN", "");
  expect(ServerEnv.accountEndpoints().apiBase).toBe(
    "https://game.example.test/api/accounts",
  );
  expect(ServerEnv.accountApiBase()).toBe("http://127.0.0.1:3000/api/accounts");
  expect(ServerEnv.jwtIssuer()).toBe("https://identity.example.test");
});
