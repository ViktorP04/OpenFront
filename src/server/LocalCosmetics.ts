import { base64url } from "jose";
import { CosmeticsSchema } from "../core/CosmeticSchemas";
import { localCosmeticStyles } from "./LocalCosmeticStyles";
import { PrivilegeCheckerImpl } from "./Privilege";

export const freeFlagNames = ["sunrise", "mountain", "comet"] as const;
export const freeCosmeticFlares = freeFlagNames.map((name) => `flag:${name}`);
export const paidFlags = [
  { name: "crescent", priceSoft: 100 },
  { name: "aurora", priceSoft: 200 },
  { name: "violet_crown", priceSoft: 300 },
  { name: "tide", priceSoft: 75 },
  { name: "ember", priceSoft: 100 },
  { name: "storm", priceSoft: 150 },
  { name: "lotus", priceSoft: 175 },
  { name: "fox", priceSoft: 200 },
  { name: "orbit", priceSoft: 250 },
  { name: "crystal", priceSoft: 300 },
  { name: "eclipse", priceSoft: 400 },
] as const;

/** Fork-owned cosmetics using the upstream catalog and pricing contract. */
export function localCosmetics(origin: string) {
  return CosmeticsSchema.parse({
    ...localCosmeticStyles(origin),
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

export type LocalCosmeticType =
  | "flag"
  | "pattern"
  | "skin"
  | "crown"
  | "effect";

/** Resolve the price and exact entitlement together, never from request prices. */
export function localPurchaseItem(
  type: LocalCosmeticType,
  name: string,
  palette?: string,
) {
  const catalog = localCosmetics("https://local.invalid");
  const cosmetic =
    type === "effect"
      ? Object.values(catalog.effects ?? {})
          .flatMap((group) => Object.values(group ?? {}))
          .find((e) => e.name === name)
      : type === "pattern"
        ? catalog.patterns[name]
        : type === "flag"
          ? catalog.flags[name]
          : type === "skin"
            ? catalog.skins?.[name]
            : catalog.crowns?.[name];
  if (
    !cosmetic ||
    cosmetic.priceSoft === undefined ||
    !Number.isSafeInteger(cosmetic.priceSoft) ||
    cosmetic.priceSoft <= 0
  )
    return null;
  if (
    palette !== undefined &&
    (type !== "pattern" ||
      !catalog.patterns[name]?.colorPalettes?.some(
        (p) => p.name === palette && !p.isArchived,
      ))
  )
    return null;
  return {
    price: cosmetic.priceSoft,
    flare: `${type}:${name}${palette === undefined ? "" : `:${palette}`}`,
  };
}

// Use a ready checker for local games, including before the first API poll.
export function localCosmeticChecker(origin: string) {
  return new PrivilegeCheckerImpl(localCosmetics(origin), base64url.decode);
}
