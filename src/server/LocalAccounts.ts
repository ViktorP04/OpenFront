import express, { type Request } from "express";
import rateLimit from "express-rate-limit";
import { importJWK, jwtVerify, SignJWT, type JWK } from "jose";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { UserMeResponseSchema } from "../core/ApiSchemas";
import { uuidToBase64url } from "../core/Base64";
import { LocalLeaderboardMetricSchema } from "../core/LocalLeaderboard";
import { GameConfigSchema, ID } from "../core/Schemas";
import { eligibleCompletion } from "./LocalAchievements";
import { freeCosmeticFlares, localCosmetics } from "./LocalCosmetics";
import { LocalEconomy, LocalMatchRewardSchema } from "./LocalEconomy";
import { localLeaderboard } from "./LocalLeaderboard";

const credentials = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_]{3,24}$/),
  password: z.string().min(12).max(128),
  registrationCode: z.string().max(256).optional(),
});
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const ACCESS_SECONDS = 600;
type User = {
  id: string;
  username: string;
  salt: string;
  password_hash: string;
};
type Session = { id: string; user_id: string; expires: number };

export function localAccountOrigin(): string {
  const url = new URL(
    process.env.LOCAL_ACCOUNT_ORIGIN ?? "http://localhost:9000",
  );
  if (
    url.href !== `${url.origin}/` ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  ) {
    throw new Error(
      "LOCAL_ACCOUNT_ORIGIN must be an HTTPS origin (HTTP is allowed only on loopback).",
    );
  }
  return url.origin;
}

/** One master owns this SQLite database; workers use the HTTP API. */
export async function createLocalAccounts(options: {
  directory: string;
  origin: string;
  audience: string;
  issuer?: string;
  registrationCode?: string;
  rewardKey?: string;
}) {
  mkdirSync(options.directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(options.directory, "accounts.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL,
      normalized TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS map_completions (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      map_name TEXT NOT NULL, difficulty TEXT NOT NULL,
      PRIMARY KEY (user_id, map_name, difficulty));`);
  const economy = new LocalEconomy(db);
  let stored = db
    .prepare("SELECT value FROM settings WHERE key='signingKey'")
    .get() as { value: string } | undefined;
  if (!stored) {
    const { privateKey } = generateKeyPairSync("ed25519");
    const value = JSON.stringify(privateKey.export({ format: "jwk" }));
    db.prepare("INSERT INTO settings VALUES ('signingKey', ?) ").run(value);
    stored = { value };
  }
  const jwk = JSON.parse(stored.value) as JWK;
  const signingKey = await importJWK(jwk, "EdDSA");
  const publicKey: JWK = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, alg: "EdDSA" };
  const issuer = options.issuer ?? `${options.origin}/api/accounts`;
  const secure = options.origin.startsWith("https:");
  const cookieName = secure
    ? "__Secure-openfront_session"
    : "openfront_session";
  const cookieOptions = {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/api/accounts",
  };
  let hashing = 0;
  async function passwordHash(password: string, salt: string): Promise<Buffer> {
    if (hashing >= 2) throw new Error("busy");
    hashing++;
    try {
      return await new Promise<Buffer>((resolve, reject) =>
        scrypt(
          password,
          salt,
          64,
          { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
          (error, result) => (error ? reject(error) : resolve(result)),
        ),
      );
    } finally {
      hashing--;
    }
  }
  const dummySalt = randomBytes(16).toString("hex");
  const dummyHash = await passwordHash(
    randomBytes(32).toString("hex"),
    dummySalt,
  );
  const router = express.Router();
  router.get("/cosmetics.json", (_req, res) =>
    res.json(localCosmetics(options.origin)),
  );
  router.get("/reserved_clan_tags", (_req, res) => res.json([]));
  router.use(
    "/cosmetics/flags",
    express.static(
      fileURLToPath(
        new URL("../../resources/local-cosmetics/", import.meta.url),
      ),
    ),
  );
  for (const category of ["crowns", "skins"]) {
    router.use(
      `/cosmetics/${category}`,
      express.static(
        fileURLToPath(
          new URL(
            `../../resources/local-cosmetics/${category}/`,
            import.meta.url,
          ),
        ),
      ),
    );
  }
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  // Machine-only route: authenticate before parsing; never accept account JWTs
  // or an Origin header as authority to mint currency.
  router.post(
    "/internal/match-rewards",
    (req, res, next) => {
      if (
        !options.rewardKey ||
        !timingSafeEqual(
          Buffer.from(hash(req.get("X-Local-Reward-Key") ?? "")),
          Buffer.from(hash(options.rewardKey)),
        )
      ) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      next();
    },
    express.json({ limit: "128kb" }),
    (req, res) => {
      const parsed = LocalMatchRewardSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid match reward" });
        return;
      }
      res.json({ awards: economy.award(parsed.data) });
    },
  );
  router.use((req, res, next) => {
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.get("origin") !== options.origin
    ) {
      res.status(403).json({
        error: "Open the game at its configured address before signing in.",
      });
      return;
    }
    next();
  });
  const parseSmallBody = express.json({ limit: "4kb" });
  router.use((req, res, next) => {
    if (req.path === "/archive_singleplayer_game") next();
    else parseSmallBody(req, res, next);
  });
  // Do not trust client-supplied forwarding headers. Behind a proxy this is a
  // deliberately shared limit; it cannot be bypassed with X-Forwarded-For.
  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: 180,
      keyGenerator: (req) => req.socket.remoteAddress ?? "unknown",
      validate: false,
    }),
  );
  const credentialLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 40,
    keyGenerator: (req) => req.socket.remoteAddress ?? "unknown",
    validate: false,
    message: { error: "Too many attempts. Try again in 15 minutes." },
  });
  router.use(
    ["/auth/register", "/auth/login", "/auth/password"],
    credentialLimit,
  );
  function cookieSession(req: Request): Session | undefined {
    const value = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    if (!value || !/^[a-f0-9]{64}$/.test(value)) return;
    return db
      .prepare("SELECT * FROM sessions WHERE token_hash=? AND expires>?")
      .get(hash(value), Date.now()) as Session | undefined;
  }
  async function bearerSession(req: Request): Promise<Session | undefined> {
    try {
      const header = req.get("authorization");
      if (!header?.startsWith("Bearer ")) return;
      const { payload } = await jwtVerify(header.slice(7), publicKey, {
        algorithms: ["EdDSA"],
        issuer,
        audience: options.audience,
      });
      const session = db
        .prepare("SELECT * FROM sessions WHERE id=? AND expires>?")
        .get(payload.jti ?? "", Date.now()) as Session | undefined;
      if (session && uuidToBase64url(session.user_id) === payload.sub)
        return session;
    } catch {
      return;
    }
  }
  router.get("/.well-known/jwks.json", (_req, res) =>
    res.json({ keys: [publicKey] }),
  );
  router.get("/auth/config", (_req, res) =>
    res.json({ registrationCodeRequired: !!options.registrationCode }),
  );
  for (const action of ["register", "login"] as const) {
    router.post(`/auth/${action}`, async (req, res) => {
      const parsed = credentials.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error:
            "Use a 3–24 character username (letters, numbers, underscore) and a 12–128 character password.",
        });
        return;
      }
      const { username, password, registrationCode } = parsed.data;
      const normalized = username.toLowerCase();
      if (
        action === "register" &&
        options.registrationCode &&
        !timingSafeEqual(
          Buffer.from(hash(registrationCode ?? "")),
          Buffer.from(hash(options.registrationCode)),
        )
      ) {
        res.status(403).json({ error: "Registration code is incorrect." });
        return;
      }
      let user = db
        .prepare("SELECT * FROM users WHERE normalized=?")
        .get(normalized) as User | undefined;
      const salt =
        action === "register"
          ? randomBytes(16).toString("hex")
          : (user?.salt ?? dummySalt);
      const derived = await passwordHash(password, salt);
      if (action === "register") {
        // Recheck after the asynchronous hash: simultaneous registrations must
        // never overwrite an existing account or create two copies of a name.
        if (
          db.prepare("SELECT id FROM users WHERE normalized=?").get(normalized)
        ) {
          res.status(409).json({ error: "That username is unavailable." });
          return;
        }
        user = {
          id: randomUUID(),
          username,
          salt,
          password_hash: derived.toString("hex"),
        };
        db.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?)").run(
          user.id,
          username,
          normalized,
          salt,
          user.password_hash,
        );
      } else if (
        !timingSafeEqual(
          derived,
          user ? Buffer.from(user.password_hash, "hex") : dummyHash,
        ) ||
        !user
      ) {
        res.status(401).json({ error: "Incorrect username or password." });
        return;
      }
      if (!user) return;
      if (
        action === "login" &&
        (
          db
            .prepare("SELECT password_hash FROM users WHERE id=?")
            .get(user.id) as User
        ).password_hash !== user.password_hash
      ) {
        res.status(401).json({ error: "Incorrect username or password." });
        return;
      }
      const previous = cookieSession(req);
      if (previous)
        db.prepare("DELETE FROM sessions WHERE id=?").run(previous.id);
      db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
      // Bound persistent session storage per account.
      db.prepare(
        "DELETE FROM sessions WHERE user_id=? AND id NOT IN (SELECT id FROM sessions WHERE user_id=? ORDER BY expires DESC LIMIT 9)",
      ).run(user.id, user.id);
      const token = randomBytes(32).toString("hex");
      db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)").run(
        randomUUID(),
        hash(token),
        user.id,
        Date.now() + SESSION_MS,
      );
      res.cookie(cookieName, token, { ...cookieOptions, maxAge: SESSION_MS });
      res.status(action === "register" ? 201 : 200).json({ ok: true });
    });
  }
  router.post("/auth/refresh", async (req, res) => {
    const session = cookieSession(req);
    if (!session) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }
    const jwt = await new SignJWT({ provider: "local" })
      .setProtectedHeader({ alg: "EdDSA" })
      .setSubject(uuidToBase64url(session.user_id))
      .setJti(session.id)
      .setIssuer(issuer)
      .setAudience(options.audience)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_SECONDS}s`)
      .sign(signingKey);
    res.json({ jwt, expiresIn: ACCESS_SECONDS });
  });
  for (const action of ["logout", "revoke"])
    router.post(`/auth/${action}`, (req, res) => {
      const session = cookieSession(req);
      if (session)
        db.prepare(
          action === "revoke"
            ? "DELETE FROM sessions WHERE user_id=?"
            : "DELETE FROM sessions WHERE id=?",
        ).run(action === "revoke" ? session.user_id : session.id);
      res.clearCookie(cookieName, cookieOptions).json({ ok: true });
    });
  router.post("/auth/password", async (req, res) => {
    const session = cookieSession(req);
    if (!session) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }
    const parsed = z
      .object({
        currentPassword: z.string().max(128),
        password: z.string().min(12).max(128),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "New password must be 12–128 characters." });
      return;
    }
    const user = db
      .prepare("SELECT * FROM users WHERE id=?")
      .get(session.user_id) as User;
    if (
      !timingSafeEqual(
        await passwordHash(parsed.data.currentPassword, user.salt),
        Buffer.from(user.password_hash, "hex"),
      )
    ) {
      res.status(401).json({ error: "Current password is incorrect." });
      return;
    }
    const salt = randomBytes(16).toString("hex");
    const derived = await passwordHash(parsed.data.password, salt);
    // Another password change or logout during hashing must not resurrect access.
    if (
      !cookieSession(req) ||
      (
        db
          .prepare("SELECT password_hash FROM users WHERE id=?")
          .get(user.id) as User
      ).password_hash !== user.password_hash
    ) {
      res.status(401).json({ error: "Session changed. Sign in again." });
      return;
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE users SET salt=?, password_hash=? WHERE id=?").run(
        salt,
        derived.toString("hex"),
        user.id,
      );
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res.clearCookie(cookieName, cookieOptions).json({ ok: true });
  });
  router.post("/rewards/solo/start", async (req, res) => {
    const session = await bearerSession(req);
    if (!session) {
      res.status(401).json({ error: "Sign in to earn Caps." });
      return;
    }
    const parsed = z
      .object({ gameId: ID, config: GameConfigSchema })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid game start." });
      return;
    }
    res.json({
      eligible: economy.startSolo(
        session.user_id,
        parsed.data.gameId,
        parsed.data.config,
      ),
    });
  });
  router.post("/archive_singleplayer_game", async (req, res, next) => {
    const session = await bearerSession(req);
    if (!session) {
      res.status(401).json({ error: "Sign in to save completion progress." });
      return;
    }
    // Express limits the inflated JSON too, including gzip submissions.
    express.json({ limit: "16mb" })(req, res, (error) => {
      if (error) {
        const status = (error as { status?: number }).status;
        if (status === 413 || status === 400) {
          res
            .status(status)
            .json({ error: "Invalid or oversized game result." });
        } else next(error);
        return;
      }
      const completion = eligibleCompletion(req.body?.info, session.user_id);
      if (completion) {
        db.prepare(
          "INSERT OR IGNORE INTO map_completions VALUES (?, ?, ?)",
        ).run(session.user_id, completion.mapName, completion.difficulty);
      }
      // Accept non-winning/custom games without awarding a medal. Replay bodies
      // are deliberately not retained by this personal-progress endpoint.
      const capsAwarded = economy.finishSolo(session.user_id, req.body?.info);
      res.json({ recorded: completion !== null, capsAwarded });
    });
  });
  router.post("/shop/purchase", async (req, res) => {
    const session = await bearerSession(req);
    if (!session) {
      res.status(401).json({ error: "Sign in to purchase cosmetics." });
      return;
    }
    const parsed = z
      .object({
        cosmeticType: z.enum(["flag", "pattern", "skin", "crown", "effect"]),
        cosmeticName: z.string().max(32),
        currencyType: z.literal("soft"),
        colorPaletteName: z.string().min(1).max(32).optional(),
      })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Only Caps cosmetic purchases are supported." });
      return;
    }
    const result = economy.purchase(
      session.user_id,
      parsed.data.cosmeticName,
      parsed.data.cosmeticType,
      parsed.data.colorPaletteName,
    );
    if (result === "insufficient") {
      res.status(400).json({ reason: "Insufficient balance" });
    } else if (result === "unknown") {
      res.status(404).json({ error: "Cosmetic not found" });
    } else {
      // Retries of an already-owned purchase succeed without another debit.
      res.json({
        currency: { soft: economy.balance(session.user_id), hard: 0 },
      });
    }
  });
  router.get("/leaderboard/local", (req, res) => {
    const query = z
      .object({
        metric: LocalLeaderboardMetricSchema.default("caps"),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "Invalid leaderboard query." });
      return;
    }
    res.set("Cache-Control", "no-store");
    res.json(localLeaderboard(db, query.data.metric, query.data.page));
  });
  router.get("/users/@me", async (req, res) => {
    const session = await bearerSession(req);
    if (!session) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }
    const user = db
      .prepare("SELECT * FROM users WHERE id=?")
      .get(session.user_id) as User;
    res.json(
      UserMeResponseSchema.parse({
        user: { local: { username: user.username } },
        player: {
          publicId: hash(user.id),
          flares: [...freeCosmeticFlares, ...economy.flares(user.id)],
          currency: { soft: economy.balance(user.id), hard: 0 },
          rewards: [],
          username: user.username,
          adfree: true,
          unlimitedRanked: false,
          canCreatePublicLobbies: false,
          achievements: {
            singleplayerMap: db
              .prepare(
                "SELECT map_name AS mapName, difficulty FROM map_completions WHERE user_id=? ORDER BY map_name, difficulty",
              )
              .all(session.user_id),
          },
          friends: [],
          subscription: null,
        },
      }),
    );
  });
  router.use((_req, res) => {
    res
      .status(404)
      .json({ error: "This feature is not available on this server." });
  });
  router.use(
    (
      error: Error,
      _req: Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res
        .status(error.message === "busy" ? 503 : 500)
        .json({ error: "Account service is busy. Please try again." });
    },
  );
  return { router, close: () => db.close() };
}
