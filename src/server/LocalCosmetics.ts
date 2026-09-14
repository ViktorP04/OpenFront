import { base64url } from "jose";
import { CosmeticsSchema } from "../core/CosmeticSchemas";
import { PrivilegeCheckerImpl } from "./Privilege";

export const freeFlagNames = ["sunrise", "mountain", "comet"] as const;
export const freeCosmeticFlares = freeFlagNames.map((name) => `flag:${name}`);

/** A small, versioned-in-source grant for every local account. No purchase API. */
export function localCosmetics(origin: string) {
  return CosmeticsSchema.parse({
    patterns: {},
    flags: Object.fromEntries(
      freeFlagNames.map((name) => [
        name,
        {
          name,
          rarity: "common",
          product: null,
          url: `${origin}/api/accounts/cosmetics/flags/${name}.svg`,
        },
      ]),
    ),
  });
}

// Use a ready checker for local games, including before the first API poll.
export function localCosmeticChecker(origin: string) {
  return new PrivilegeCheckerImpl(localCosmetics(origin), base64url.decode);
}
