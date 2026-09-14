import { ServerEnv } from "../../src/server/ServerEnv";
import { verifyClientToken } from "../../src/server/jwt";
// @vitest-environment node
import express from "express";
import { decodeJwt, jwtVerify } from "jose";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserMeResponseSchema } from "../../src/core/ApiSchemas";
import {
  createLocalAccounts,
  localAccountOrigin,
} from "../../src/server/LocalAccounts";

const origin = "https://friends.example.test";
const password = "a long test password 123";
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
async function setup(directory?: string, issuer?: string) {
  const dir =
    directory ?? mkdtempSync(path.join(tmpdir(), "openfront-accounts-"));
  if (!directory)
    cleanups.push(() => {
      if (
        !path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep) ||
        !path.basename(dir).startsWith("openfront-accounts-")
      )
        throw new Error("Unsafe test cleanup path");
      rmSync(dir, { recursive: true, force: true });
    });
  const accounts = await createLocalAccounts({
    directory: dir,
    origin,
    audience: "localhost",
    issuer,
    registrationCode: "friends-only",
  });
  const app = express();
  app.use("/api/accounts", accounts.router);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    accounts.close();
  };
  cleanups.push(close);
  const base = `http://127.0.0.1:${address.port}/api/accounts`;
  const post = (
    route: string,
    body = {},
    cookie = "",
    requestOrigin = origin,
  ) =>
    fetch(base + route, {
      method: "POST",
      headers: {
        origin: requestOrigin,
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify(body),
    });
  const register = (username = "FriendOne") =>
    post("/auth/register", {
      username,
      password,
      registrationCode: "friends-only",
    });
  const me = (jwt: string) =>
    fetch(base + "/users/@me", { headers: { authorization: `Bearer ${jwt}` } });
  const cookie = (response: Response) =>
    response.headers.get("set-cookie")!.split(";")[0];
  return { dir, base, post, register, me, cookie, close };
}

describe("local accounts", () => {
  it("keeps the existing server verifier compatible with a custom issuer and logout", async () => {
    const issuer = "https://identity.example.test/issuer";
    const api = await setup(undefined, issuer);
    vi.stubEnv("LOCAL_ACCOUNTS", "true");
    vi.spyOn(ServerEnv, "jwtIssuer").mockReturnValue(issuer);
    vi.spyOn(ServerEnv, "jwtAudience").mockReturnValue("localhost");
    vi.spyOn(ServerEnv, "accountApiBase").mockReturnValue(api.base);
    const jwks = await (
      await fetch(api.base + "/.well-known/jwks.json")
    ).json();
    vi.spyOn(ServerEnv, "jwkPublicKey").mockResolvedValue(jwks.keys[0]);
    await api.register();
    const login = await api.post("/auth/login", {
      username: "FriendOne",
      password,
    });
    expect(login.status).toBe(200);
    const cookie = api.cookie(login);
    const { jwt } = await (await api.post("/auth/refresh", {}, cookie)).json();
    expect((await verifyClientToken(jwt)).type).toBe("success");
    vi.mocked(ServerEnv.jwtIssuer).mockReturnValue(
      "https://wrong.example.test",
    );
    expect((await verifyClientToken(jwt)).type).toBe("error");
    vi.mocked(ServerEnv.jwtIssuer).mockReturnValue(issuer);
    await api.post("/auth/logout", {}, cookie);
    expect((await verifyClientToken(jwt)).type).toBe("error");
    expect((await api.post("/auth/refresh", {}, cookie)).status).toBe(401);
  });

  it("expires sessions and stores neither passwords nor raw session tokens", async () => {
    const api = await setup();
    const cookie = api.cookie(await api.register());
    const { jwt } = await (await api.post("/auth/refresh", {}, cookie)).json();
    const db = new DatabaseSync(path.join(api.dir, "accounts.sqlite"));
    try {
      expect(
        JSON.stringify(db.prepare("SELECT * FROM users").all()),
      ).not.toContain(password);
      expect(
        JSON.stringify(db.prepare("SELECT * FROM sessions").all()),
      ).not.toContain(cookie.split("=")[1]);
      db.prepare("UPDATE sessions SET expires=?").run(Date.now() - 1);
      expect((await api.me(jwt)).status).toBe(401);
      expect((await api.post("/auth/refresh", {}, cookie)).status).toBe(401);
    } finally {
      db.close();
    }
  });
  it("registers, signs compatible JWTs and persists identity and signing keys across restart", async () => {
    const api = await setup();
    const registration = await api.register();
    expect(registration.status).toBe(201);
    const cookieHeader = registration.headers.get("set-cookie")!;
    expect(cookieHeader).toContain("HttpOnly");
    expect(cookieHeader).toContain("Secure");
    expect(cookieHeader).toContain("SameSite=Lax");
    const cookie = api.cookie(registration);
    const { jwt } = await (await api.post("/auth/refresh", {}, cookie)).json();
    const jwks = await (
      await fetch(api.base + "/.well-known/jwks.json")
    ).json();
    expect(jwks.keys[0].d).toBeUndefined();
    await jwtVerify(jwt, jwks.keys[0], {
      issuer: origin + "/api/accounts",
      audience: "localhost",
    });
    const profile = await (await api.me(jwt)).json();
    expect(UserMeResponseSchema.safeParse(profile).success).toBe(true);
    expect(profile.user.local.username).toBe("FriendOne");
    expect(profile.player.publicId).not.toBe(decodeJwt(jwt).sub);
    await api.close();
    const restarted = await setup(api.dir);
    expect((await restarted.me(jwt)).status).toBe(200);
    expect((await restarted.post("/auth/refresh", {}, cookie)).status).toBe(
      200,
    );
    expect(
      (await restarted.post("/auth/login", { username: "friendone", password }))
        .status,
    ).toBe(200);
  });
  it("rejects bad credentials, duplicate names, missing registration codes and cross-site mutations", async () => {
    const api = await setup();
    expect(
      (await api.post("/auth/register", { username: "FriendOne", password }))
        .status,
    ).toBe(403);
    expect(
      (
        await api.post("/auth/register", {
          username: "FriendOne",
          password: "short",
        })
      ).status,
    ).toBe(400);
    await api.register();
    expect((await api.register("friendone")).status).toBe(409);
    const wrong = await api.post("/auth/login", {
      username: "FriendOne",
      password: "not the right password",
    });
    const unknown = await api.post("/auth/login", {
      username: "Nobody",
      password: "not the right password",
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(
      (
        await api.post(
          "/auth/login",
          { username: "FriendOne", password },
          "",
          "https://evil.example",
        )
      ).status,
    ).toBe(403);
    expect((await api.post("/auth/refresh", {}, "", "")).status).toBe(403);
    expect((await api.me("forged-token")).status).toBe(401);
    expect((await api.post("/auth/refresh")).status).toBe(401);
  });
  it("revokes refresh cookies and existing access tokens on logout and password change", async () => {
    const api = await setup();
    const cookie = api.cookie(await api.register());
    const { jwt } = await (await api.post("/auth/refresh", {}, cookie)).json();
    expect(
      (await api.post("/auth/logout", {}, cookie, "https://evil.example"))
        .status,
    ).toBe(403);
    expect((await api.me(jwt)).status).toBe(200);
    await api.post("/auth/logout", {}, cookie);
    expect((await api.me(jwt)).status).toBe(401);
    expect((await api.post("/auth/refresh", {}, cookie)).status).toBe(401);
    const c1 = api.cookie(
      await api.post("/auth/login", { username: "FriendOne", password }),
    );
    const c2 = api.cookie(
      await api.post("/auth/login", { username: "FriendOne", password }),
    );
    expect(
      (
        await api.post(
          "/auth/password",
          { currentPassword: "wrong", password: "new password 123456" },
          c1,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await api.post(
          "/auth/password",
          { currentPassword: password, password: "new password 123456" },
          c1,
        )
      ).status,
    ).toBe(200);
    expect((await api.post("/auth/refresh", {}, c2)).status).toBe(401);
    expect(
      (await api.post("/auth/login", { username: "FriendOne", password }))
        .status,
    ).toBe(401);
    expect(
      (
        await api.post("/auth/login", {
          username: "FriendOne",
          password: "new password 123456",
        })
      ).status,
    ).toBe(200);
  });
  it("limits attempts even when forwarding headers are forged", async () => {
    const api = await setup();
    for (let i = 0; i < 40; i++) await api.post("/auth/login", {});
    const response = await fetch(api.base + "/auth/login", {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "x-forwarded-for": "192.0.2.1",
      },
      body: "{}",
    });
    expect(response.status).toBe(429);
  });
  it("requires HTTPS for non-loopback account origins", () => {
    const previous = process.env.LOCAL_ACCOUNT_ORIGIN;
    try {
      process.env.LOCAL_ACCOUNT_ORIGIN = "http://192.168.1.20:9000";
      expect(() => localAccountOrigin()).toThrow("HTTPS");
      process.env.LOCAL_ACCOUNT_ORIGIN = "https://friends.example.test";
      expect(localAccountOrigin()).toBe(origin);
    } finally {
      if (previous === undefined) delete process.env.LOCAL_ACCOUNT_ORIGIN;
      else process.env.LOCAL_ACCOUNT_ORIGIN = previous;
    }
  });
});
