import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Read-only: never registers accounts, sends email, or creates lobbies. */
export async function checkDeployment(
  origin,
  { expectedCommit, maps = ["viktor", "tpg"], fetcher = fetch } = {},
) {
  const base = new URL(origin);
  assert(
    ["http:", "https:"].includes(base.protocol) &&
      !base.username &&
      !base.password,
    "Expected an HTTP(S) origin without credentials",
  );
  assert(
    base.href === `${base.origin}/`,
    "Use an origin without a path, query, or fragment",
  );
  async function read(route) {
    const url = new URL(route, base);
    assert(
      url.origin === base.origin,
      "Asset must be served from the same origin",
    );
    if (!url.pathname.startsWith("/_assets/"))
      url.searchParams.set("smoke", Date.now().toString());
    const response = await fetcher(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(
      response.status,
      200,
      `${url.pathname}: HTTP ${response.status}`,
    );
    return Buffer.from(await response.arrayBuffer());
  }
  const json = async (route) =>
    JSON.parse((await read(route)).toString("utf8"));
  assert.equal(
    (await json("/api/health")).status,
    "ok",
    "Game workers are not ready",
  );
  const commit = (await read("/commit.txt")).toString("utf8").trim();
  assert(
    /^[a-f0-9]{40}([a-f0-9]{24})?$/.test(commit),
    "Image is missing its full source revision",
  );
  if (expectedCommit)
    assert.equal(commit, expectedCommit, "Wrong revision is deployed");
  assert.equal(
    (await read("/account-mode.txt")).toString("utf8").trim(),
    "true",
    "Image was built without standalone accounts",
  );
  const config = await json("/api/accounts/auth/config");
  assert.equal(
    typeof config.registrationCodeRequired,
    "boolean",
    "Account API is unavailable",
  );
  const jwks = await json("/api/accounts/.well-known/jwks.json");
  assert(
    Array.isArray(jwks.keys) && jwks.keys.length > 0,
    "Signing keys missing",
  );
  for (const key of jwks.keys) {
    assert(
      key.kty === "OKP" &&
        key.crv === "Ed25519" &&
        key.alg === "EdDSA" &&
        typeof key.x === "string" &&
        !key.d,
      "Invalid public signing key",
    );
  }
  const manifest = await json("/asset-manifest.json");
  const hashes = await json("/asset-hashes.json");
  async function asset(logical) {
    const route = manifest[logical];
    assert(
      typeof route === "string" && route.startsWith("/_assets/"),
      `Missing asset: ${logical}`,
    );
    const expected = hashes[route.slice(1)];
    assert(
      expected && /^[a-f0-9]{64}$/.test(expected.sha256),
      `Missing checksum: ${logical}`,
    );
    const content = await read(route);
    assert.equal(content.length, expected.bytes, `Truncated asset: ${logical}`);
    assert.equal(
      createHash("sha256").update(content).digest("hex"),
      expected.sha256,
      `Checksum mismatch: ${logical}`,
    );
    return content;
  }
  for (const map of maps) {
    assert(/^[a-z0-9]+$/.test(map), "Invalid map folder name");
    const folder = `maps/${map}`;
    const info = JSON.parse(
      (await asset(`${folder}/manifest.json`)).toString("utf8"),
    );
    assert.equal(info.id.toLowerCase(), map, `Wrong map manifest: ${map}`);
    for (const scale of ["map", "map4x", "map16x"]) {
      const content = await asset(`${folder}/${scale}.bin`);
      assert.equal(
        content.length,
        info[scale].width * info[scale].height,
        `Wrong map dimensions: ${map}/${scale}`,
      );
    }
    const thumbnail = await asset(`${folder}/thumbnail.webp`);
    assert.equal(
      thumbnail.toString("ascii", 0, 4),
      "RIFF",
      `Invalid thumbnail: ${map}`,
    );
    assert.equal(
      thumbnail.toString("ascii", 8, 12),
      "WEBP",
      `Invalid thumbnail: ${map}`,
    );
  }
  return {
    commit,
    maps,
    registrationCodeRequired: config.registrationCodeRequired,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const origin = args.shift();
  assert(
    origin,
    "Usage: npm run smoke:deploy -- https://openfront.viktorp04.com [--expect-commit SHA] [--attempts 12]",
  );
  let expectedCommit;
  let attempts = 1;
  while (args.length) {
    const option = args.shift();
    if (option === "--expect-commit") {
      expectedCommit = args.shift();
      assert(
        expectedCommit && /^[a-f0-9]{40}([a-f0-9]{24})?$/.test(expectedCommit),
        "Expected a full source revision",
      );
    } else if (option === "--attempts") {
      attempts = Number(args.shift());
      assert(
        Number.isInteger(attempts) && attempts >= 1 && attempts <= 30,
        "Attempts must be 1–30",
      );
    } else throw new Error(`Unknown option: ${option}`);
  }
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await checkDeployment(origin, { expectedCommit });
      console.log(
        `Deployment OK: ${result.commit}; accounts available; maps ${result.maps.join(", ")} verified.`,
      );
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      console.error(
        `Waiting for deployment (${attempt}/${attempts}): ${error.message}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`Deployment check failed: ${error.message}`);
    process.exitCode = 1;
  });
}
