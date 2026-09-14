// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkDeployment } from "../scripts/deploySmoke.mjs";

function fixture() {
  const sha = "a".repeat(40);
  const routes = new Map<string, Buffer>();
  const json = (route: string, value: unknown) =>
    routes.set(route, Buffer.from(JSON.stringify(value)));
  json("/api/health", { status: "ok" });
  routes.set("/commit.txt", Buffer.from(sha));
  routes.set("/account-mode.txt", Buffer.from("true\n"));
  json("/api/accounts/auth/config", { registrationCodeRequired: true });
  json("/api/accounts/.well-known/jwks.json", {
    keys: [{ alg: "EdDSA", kty: "OKP", crv: "Ed25519", x: "public" }],
  });
  const manifest: Record<string, string> = {};
  const hashes: Record<string, { sha256: string; bytes: number }> = {};
  function asset(logical: string, data: Buffer) {
    const route = `/_assets/${logical}`;
    manifest[logical] = route;
    hashes[route.slice(1)] = {
      bytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
    };
    routes.set(route, data);
  }
  for (const map of ["viktor", "tpg"]) {
    const info = {
      id: map,
      map: { width: 2, height: 2 },
      map4x: { width: 1, height: 1 },
      map16x: { width: 1, height: 1 },
    };
    asset(`maps/${map}/manifest.json`, Buffer.from(JSON.stringify(info)));
    asset(`maps/${map}/map.bin`, Buffer.from([1, 2, 3, 4]));
    asset(`maps/${map}/map4x.bin`, Buffer.from([1]));
    asset(`maps/${map}/map16x.bin`, Buffer.from([1]));
    asset(`maps/${map}/thumbnail.webp`, Buffer.from("RIFF0000WEBPtest"));
  }
  json("/asset-manifest.json", manifest);
  json("/asset-hashes.json", hashes);
  const requested: string[] = [];
  const fetcher = async (url: URL, options: RequestInit) => {
    expect(options.method ?? "GET").toBe("GET");
    requested.push(url.pathname);
    const body = routes.get(url.pathname);
    return new Response(body ? new Uint8Array(body) : null, {
      status: body ? 200 : 404,
    });
  };
  return { sha, routes, json, manifest, hashes, fetcher, requested };
}

describe("deployment smoke check", () => {
  it("checks the release, account API and both maps without mutating anything", async () => {
    const f = fixture();
    const result = await checkDeployment("https://game.example", {
      expectedCommit: f.sha,
      fetcher: f.fetcher,
    });
    expect(result).toEqual({
      commit: f.sha,
      maps: ["viktor", "tpg"],
      registrationCodeRequired: true,
    });
    expect(f.requested).toContain("/_assets/maps/tpg/map16x.bin");
  });
  it("rejects a healthy but stale release", async () => {
    const f = fixture();
    await expect(
      checkDeployment("https://game.example", {
        expectedCommit: "b".repeat(40),
        fetcher: f.fetcher,
      }),
    ).rejects.toThrow("Wrong revision");
  });
  it.each(["/api/accounts/auth/config", "/_assets/maps/tpg/map.bin"])(
    "rejects a missing required endpoint or asset: %s",
    async (route) => {
      const f = fixture();
      f.routes.delete(route);
      await expect(
        checkDeployment("https://game.example", { fetcher: f.fetcher }),
      ).rejects.toThrow("HTTP 404");
    },
  );
  it("detects corrupted binary content even if its byte length is correct", async () => {
    const f = fixture();
    f.routes.set("/_assets/maps/viktor/map.bin", Buffer.from([9, 9, 9, 9]));
    await expect(
      checkDeployment("https://game.example", { fetcher: f.fetcher }),
    ).rejects.toThrow("Checksum mismatch");
  });
  it("rejects an image built without account support", async () => {
    const f = fixture();
    f.routes.set("/account-mode.txt", Buffer.from("false"));
    await expect(
      checkDeployment("https://game.example", { fetcher: f.fetcher }),
    ).rejects.toThrow("built without");
  });
  it("rejects private signing key material", async () => {
    const f = fixture();
    f.json("/api/accounts/.well-known/jwks.json", {
      keys: [
        { alg: "EdDSA", kty: "OKP", crv: "Ed25519", x: "public", d: "private" },
      ],
    });
    await expect(
      checkDeployment("https://game.example", { fetcher: f.fetcher }),
    ).rejects.toThrow("Invalid public signing key");
  });
  it("rejects cross-origin asset redirects in the manifest", async () => {
    const f = fixture();
    f.manifest["maps/viktor/map.bin"] = "https://other.example/map.bin";
    f.json("/asset-manifest.json", f.manifest);
    await expect(
      checkDeployment("https://game.example", { fetcher: f.fetcher }),
    ).rejects.toThrow("Missing asset");
  });
});
