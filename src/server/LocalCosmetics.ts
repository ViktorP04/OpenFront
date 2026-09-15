import { base64url } from "jose";
import { CosmeticsSchema } from "../core/CosmeticSchemas";
import { PrivilegeCheckerImpl } from "./Privilege";

export const freeFlagNames = ["sunrise", "mountain", "comet"] as const;
export const freeCosmeticFlares = freeFlagNames.map((name) => `flag:${name}`);
export const paidFlags = [
  { name: "crescent", priceSoft: 100 },
  { name: "aurora", priceSoft: 200 },
  { name: "violet_crown", priceSoft: 300 },
] as const;

/** Fork-owned cosmetics using the upstream catalog and pricing contract. */
export function localCosmetics(origin: string) {
  return CosmeticsSchema.parse({
    patterns: {},
    flags: Object.fromEntries(
      [...freeFlagNames, ...paidFlags.map((flag) => flag.name)].map((name) => [
        name,
        {
          name,
          rarity: "common",
          product: null,
          priceSoft: paidFlags.find((flag) => flag.name === name)?.priceSoft,
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
