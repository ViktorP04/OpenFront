import { afterEach, expect, it } from "vitest";
import {
  accountEndpoints,
  apiUrl,
  authPolicy,
  requiresAccountForJoin,
} from "../src/auth/AuthConfig";
import { getApiBase } from "../src/client/ApiBase";
import { ClientEnv } from "../src/client/ClientEnv";

afterEach(() => {
  delete window.BOOTSTRAP_CONFIG;
  ClientEnv.reset();
});

it("keeps upstream defaults and separates the API address from its issuer", () => {
  expect(
    accountEndpoints({
      local: false,
      audience: "openfront.io",
      localOrigin: "",
    }),
  ).toEqual({
    apiBase: "https://api.openfront.io",
    issuer: "https://api.openfront.io",
  });
  expect(
    accountEndpoints({ local: false, audience: "localhost", localOrigin: "" })
      .apiBase,
  ).toBe("http://localhost:8787");
  expect(
    accountEndpoints({
      local: false,
      audience: "game.example.com",
      localOrigin: "",
      apiOrigin: "https://accounts.example.com/api/",
      issuer: "https://identity.example.com",
    }),
  ).toEqual({
    apiBase: "https://accounts.example.com/api",
    issuer: "https://identity.example.com",
  });
});

it("defaults standalone accounts to the game origin", () => {
  expect(
    accountEndpoints({
      local: true,
      audience: "game.example.com",
      localOrigin: "https://game.example.com",
    }),
  ).toEqual({
    apiBase: "https://game.example.com/api/accounts",
    issuer: "https://game.example.com/api/accounts",
  });
  expect(authPolicy(true)).toMatchObject({
    allowPrivateGuests: true,
    requireAccountToHost: true,
    verifySessionOnline: true,
  });
  expect(authPolicy(false)).toMatchObject({
    allowPrivateGuests: false,
    useUpstreamServices: true,
  });
});

it.each([
  "http://accounts.example.com",
  "https://user:secret@example.com",
  "https://example.com/?key=secret",
  "https://example.com/#fragment",
  "javascript:alert(1)",
])("rejects unsafe API configuration: %s", (url) => {
  expect(() => apiUrl(url)).toThrow();
});

it("hydrates the same configured API and issuer in the existing browser interfaces", () => {
  window.BOOTSTRAP_CONFIG = {
    gameEnv: "prod",
    turnstileSiteKey: "test",
    jwtAudience: "game.example.com",
    gitCommit: "test",
    accountApiBase: "https://accounts.example.com/api",
    authIssuer: "https://identity.example.com",
  };
  expect(getApiBase()).toBe("https://accounts.example.com/api");
  expect(ClientEnv.jwtIssuer()).toBe("https://identity.example.com");
});

it("keeps private invites open to guests and public joins account-gated", () => {
  expect(requiresAccountForJoin(true, "private", true)).toBe(false);
  expect(requiresAccountForJoin(true, "public", true)).toBe(true);
  expect(requiresAccountForJoin(true, "host", true)).toBe(true);
  expect(requiresAccountForJoin(false, "singleplayer", true)).toBe(false);
  expect(requiresAccountForJoin(true, "public", false)).toBe(false);
});
