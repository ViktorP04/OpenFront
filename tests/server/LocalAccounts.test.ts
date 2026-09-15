import { gzipSync } from "node:zlib";
import { base64urlToUuid } from "../../src/core/Base64";
import { CosmeticsSchema } from "../../src/core/CosmeticSchemas";
import type { PlayerCosmeticRefs } from "../../src/core/Schemas";
import { verifyClientToken } from "../../src/server/jwt";
import {
  freeCosmeticFlares,
  localCosmeticChecker,
} from "../../src/server/LocalCosmetics";
import { ServerEnv } from "../../src/server/ServerEnv";
import { completionInfo } from "../fixtures/LocalCompletion";
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
    rewardKey: "test-only-reward-key",
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

// Real scrypt and restart checks need headroom when the full suite shares CPU.
describe("local accounts", { timeout: 15000 }, () => {
  it("authenticates solo starts and credits a gzip win once after the server clock permits it", async () => {
    const api = await setup();
    const cookie = api.cookie(await api.register());
    const { jwt } = await (await api.post("/auth/refresh", {}, cookie)).json();
    const info = completionInfo();
    info.players[0].persistentID = base64urlToUuid(decodeJwt(jwt).sub!);
    info.config.difficulty = "Easy";
    info.end = info.start + 301000;
    info.duration = 301;
    info.num_turns = 3010;
    const start = (auth = `Bearer ${jwt}`, requestOrigin = origin) =>
      fetch(api.base + "/rewards/solo/start", {
        method: "POST",
        headers: {
          origin: requestOrigin,
          authorization: auth,
          "content-type": "application/json",
        },
        body: JSON.stringify({ gameId: info.gameID, config: info.config }),
      });
    expect((await start("")).status).toBe(401);
    expect((await start(`Bearer ${jwt}`, "https://wrong.test")).status).toBe(
      403,
    );
    expect(await (await start()).json()).toEqual({ eligible: true });
    // Move the timestamp only in this disposable fixture, avoiding a five-minute test.
    const db = new DatabaseSync(path.join(api.dir, "accounts.sqlite"));
    try {
      db.prepare("UPDATE caps_solo_starts SET started_at=?").run(
        Date.now() - 301000,
      );
    } finally {
      db.close();
    }
    const save = () =>
      fetch(api.base + "/archive_singleplayer_game", {
        method: "POST",
        headers: {
          origin,
          authorization: `Bearer ${jwt}`,
          "content-type": "application/json",
          "content-encoding": "gzip",
        },
        body: gzipSync(JSON.stringify({ info })),
      });
    expect(await (await save()).json()).toEqual({
      recorded: true,
      capsAwarded: 5,
    });
    expect(await (await save()).json()).toEqual({
      recorded: true,
      capsAwarded: 0,
    });
    expect(await (await start()).json()).toEqual({ eligible: false });
    await api.close();
    const restarted = await setup(api.dir);
    expect((await (await restarted.me(jwt)).json()).player.currency.soft).toBe(
      5,
    );
  });
  it("purchases and equips patterns, skins, crowns and effects with exact ownership", async () => {
    const api = await setup();
    const cookie = api.cookie(await api.register());
    const { jwt } = await (await api.post("/auth/refresh", {}, cookie)).json();
    const userId = base64urlToUuid(decodeJwt(jwt).sub!);
    // Fund only this disposable fixture; earning has its own integration tests.
    const db = new DatabaseSync(path.join(api.dir, "accounts.sqlite"));
    try {
      db.prepare("INSERT INTO caps_wallets VALUES (?, ?)").run(userId, 5000);
    } finally {
      db.close();
    }
    const purchase = (type: string, name: string, palette?: string) =>
      fetch(api.base + "/shop/purchase", {
        method: "POST",
        headers: {
          origin,
          authorization: `Bearer ${jwt}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          cosmeticType: type,
          cosmeticName: name,
          colorPaletteName: palette,
          currencyType: "soft",
        }),
      });
    const cases: [
      string,
      string,
      string | undefined,
      number,
      PlayerCosmeticRefs,
    ][] = [
      [
        "pattern",
        "prism_grid",
        "amethyst",
        100,
        { patternName: "prism_grid", patternColorPaletteName: "amethyst" },
      ],
      ["pattern", "diagonal", undefined, 125, { patternName: "diagonal" }],
      ["skin", "nebula", undefined, 200, { skinName: "nebula" }],
      ["crown", "frost_crown", undefined, 300, { crownName: "frost_crown" }],
      [
        "effect",
        "violet_wake",
        undefined,
        125,
        { effects: { transportShipTrail: "violet_wake" } },
      ],
      [
        "effect",
        "amethyst_shockwave",
        undefined,
        250,
        { effects: { atom: "amethyst_shockwave" } },
      ],
      [
        "effect",
        "neon_express",
        undefined,
        175,
        { effects: { train: "neon_express" } },
      ],
    ];
    const checker = localCosmeticChecker(origin);
    let remaining = 5000;
    for (const [type, name, palette, price, refs] of cases) {
      expect(checker.isAllowed(freeCosmeticFlares, refs).type).toBe(
        "forbidden",
      );
      expect((await purchase(type, name, palette)).status).toBe(200);
      expect((await purchase(type, name, palette)).status).toBe(200);
      remaining -= price;
      const profile = await (await api.me(jwt)).json();
      expect(profile.player.currency.soft).toBe(remaining);
      expect(checker.isAllowed(profile.player.flares, refs).type).toBe(
        "allowed",
      );
    }
    for (const [type, name, palette] of [
      ["pattern", "prism_grid", "unknown"],
      ["skin", "nebula", "amethyst"],
      ["effect", "frost_crown", undefined],
      ["flag", "violet_wake", undefined],
    ])
      expect((await purchase(type!, name!, palette)).status).toBe(404);
    const profile = await (await api.me(jwt)).json();
    expect(profile.player.currency.soft).toBe(remaining);
    expect(
      checker.isAllowed(profile.player.flares, {
        patternName: "prism_grid",
        patternColorPaletteName: "lagoon",
      }).type,
    ).toBe("forbidden");
    expect(
      checker.isAllowed(profile.player.flares, {
        effects: { nukeTrail: "violet_wake" },
      }).type,
    ).toBe("forbidden");
  });
  it("secures match credits, caps rewards, and persists atomic cosmetic purchases", async () => {
    const api = await setup();
    const cookie = api.cookie(await api.register());
    const { jwt } = await (await api.post("/auth/refresh", {}, cookie)).json();
    const cookie2 = api.cookie(await api.register("FriendTwo"));
    const { jwt: jwt2 } = await (
      await api.post("/auth/refresh", {}, cookie2)
    ).json();
    const userId = base64urlToUuid(decodeJwt(jwt).sub!);
    const otherId = base64urlToUuid(decodeJwt(jwt2).sub!);
    const submit = (gameId: string, key = "test-only-reward-key") =>
      fetch(api.base + "/internal/match-rewards", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-local-reward-key": key,
          origin,
          authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          gameId,
          gameType: "Public",
          difficulty: "Hard",
          players: [
            { userId, seconds: 300, won: true },
            { userId: otherId, seconds: 300, won: false },
          ],
        }),
      });
    const purchase = (
      name: string,
      extra = {},
      token = jwt,
      requestOrigin = origin,
    ) =>
      fetch(api.base + "/shop/purchase", {
        method: "POST",
        headers: {
          origin: requestOrigin,
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          cosmeticType: "flag",
          cosmeticName: name,
          currencyType: "soft",
          ...extra,
        }),
      });
    expect((await submit("match001", "")).status).toBe(403);
    expect((await purchase("crescent", {}, "")).status).toBe(401);
    expect(
      (await purchase("crescent", {}, jwt, "https://evil.test")).status,
    ).toBe(403);
    expect((await purchase("crescent")).status).toBe(400);
    for (let i = 1; i <= 5; i++)
      expect((await submit(`match00${i}`)).status).toBe(200);
    expect((await submit("match001")).status).toBe(200);
    expect((await (await api.me(jwt)).json()).player.currency.soft).toBe(100);
    expect((await (await api.me(jwt2)).json()).player.currency.soft).toBe(50);
    expect((await purchase("crescent", { priceSoft: 0 })).status).toBe(400);
    expect((await purchase("crescent", { currencyType: "hard" })).status).toBe(
      400,
    );
    expect((await purchase("unknown")).status).toBe(404);
    const responses = await Promise.all([
      purchase("crescent"),
      purchase("crescent"),
      purchase("aurora"),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 400]);
    const profile = UserMeResponseSchema.parse(
      await (await api.me(jwt)).json(),
    );
    expect(profile.player.currency).toEqual({ soft: 0, hard: 0 });
    expect(profile.player.flares).toEqual([
      ...freeCosmeticFlares,
      "flag:crescent",
    ]);
    expect(
      localCosmeticChecker(origin).isAllowed(profile.player.flares ?? [], {
        flag: "flag:crescent",
      }).type,
    ).toBe("allowed");
    await api.close();
    const restarted = await setup(api.dir);
    const persisted = await (await restarted.me(jwt)).json();
    expect(persisted.player.currency.soft).toBe(0);
    expect(persisted.player.flares).toContain("flag:crescent");
  });
  it("saves gzip map completions once per difficulty and retains them across restart", async () => {
    const api = await setup();
    const cookie = api.cookie(await api.register());
    const { jwt } = await (await api.post("/auth/refresh", {}, cookie)).json();
    const info = completionInfo();
    info.players[0].persistentID = base64urlToUuid(decodeJwt(jwt).sub!);
    const save = (authorization = `Bearer ${jwt}`, requestOrigin = origin) =>
      fetch(api.base + "/archive_singleplayer_game", {
        method: "POST",
        headers: {
          origin: requestOrigin,
          authorization,
          "content-type": "application/json",
          "content-encoding": "gzip",
        },
        body: gzipSync(JSON.stringify({ info, turns: [], version: "v0.0.2" })),
      });
    expect((await save("")).status).toBe(401);
    expect(
      (await save(`Bearer ${jwt}`, "https://wrong.example.test")).status,
    ).toBe(403);
    expect(await (await save()).json()).toEqual({
      recorded: true,
      capsAwarded: 0,
    });
    await save();
    info.config.difficulty = "Hard";
    await save();
    info.config.infiniteGold = true;
    expect(await (await save()).json()).toEqual({
      recorded: false,
      capsAwarded: 0,
    });
    await api.close();
    const restarted = await setup(api.dir);
    const profile = await (await restarted.me(jwt)).json();
    expect(profile.player.achievements.singleplayerMap).toEqual([
      { mapName: "Viktor", difficulty: "Hard" },
      { mapName: "Viktor", difficulty: "Medium" },
    ]);
    const secondCookie = restarted.cookie(
      await restarted.register("SecondFriend"),
    );
    const secondJwt = (
      await (await restarted.post("/auth/refresh", {}, secondCookie)).json()
    ).jwt;
    expect(
      (await (await restarted.me(secondJwt)).json()).player.achievements
        .singleplayerMap,
    ).toEqual([]);
  });
  it("grants the free inventory to accounts and validates flags with the game checker", async () => {
    const api = await setup();
    const catalogResponse = await fetch(api.base + "/cosmetics.json");
    expect(catalogResponse.status).toBe(200);
    const catalog = CosmeticsSchema.parse(await catalogResponse.json());
    expect(Object.keys(catalog.patterns)).toHaveLength(4);
    expect(
      Object.values(catalog.effects ?? {}).flatMap((group) =>
        Object.values(group ?? {}),
      ),
    ).toHaveLength(11);
    for (const cosmetic of [
      ...Object.values(catalog.crowns ?? {}),
      ...Object.values(catalog.skins ?? {}),
    ]) {
      const asset = await fetch(
        api.base + new URL(cosmetic.url).pathname.replace("/api/accounts", ""),
      );
      expect(asset.status).toBe(200);
      expect(asset.headers.get("content-type")).toContain("image/svg+xml");
    }
    expect(Object.keys(catalog.flags)).toEqual([
      "sunrise",
      "mountain",
      "comet",
      "crescent",
      "aurora",
      "violet_crown",
      "tide",
      "ember",
      "storm",
      "lotus",
      "fox",
      "orbit",
      "crystal",
      "eclipse",
    ]);
    const cookie = api.cookie(await api.register());
    const { jwt } = await (await api.post("/auth/refresh", {}, cookie)).json();
    const profile = await (await api.me(jwt)).json();
    expect(profile.player.flares).toEqual(freeCosmeticFlares);
    const checker = localCosmeticChecker(origin);
    for (const flag of Object.values(catalog.flags)) {
      expect(flag.product).toBeNull();
      const ref = { flag: `flag:${flag.name}` };
      expect(checker.isAllowed(profile.player.flares, ref)).toMatchObject(
        flag.priceSoft
          ? { type: "forbidden" }
          : {
              type: "allowed",
              cosmetics: { flag: flag.url },
            },
      );
      expect(checker.isAllowed([], ref).type).toBe("forbidden");
      const asset = await fetch(api.base + `/cosmetics/flags/${flag.name}.svg`);
      expect(asset.headers.get("content-type")).toContain("image/svg+xml");
      expect(await asset.text()).toContain("<svg");
    }
    expect(
      checker.isAllowed(profile.player.flares, { flag: "flag:unowned" }).type,
    ).toBe("forbidden");
    await api.close();
    const restarted = await setup(api.dir);
    expect((await (await restarted.me(jwt)).json()).player.flares).toEqual(
      freeCosmeticFlares,
    );
  });
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
