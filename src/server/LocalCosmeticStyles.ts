import { base64url } from "jose";
import { Effect, EffectSchema } from "../core/CosmeticSchemas";

const item = (name: string, priceSoft: number) => ({
  name,
  priceSoft,
  rarity: "common",
  product: null,
});

// The upstream bitmap format: version, packed dimensions/scale, then bits.
function pattern(bits: (x: number, y: number) => boolean): string {
  const bytes = new Uint8Array(11);
  bytes[1] = (6 << 3) | 1;
  bytes[2] = 6 << 2;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      if (bits(x, y)) bytes[3 + y] |= 1 << x;
    }
  return base64url.encode(bytes);
}

const palettes = [
  { name: "amethyst", primaryColor: "#7c3aed", secondaryColor: "#ddd6fe" },
  { name: "lagoon", primaryColor: "#0e7490", secondaryColor: "#a5f3fc" },
  { name: "copper", primaryColor: "#9a3412", secondaryColor: "#fed7aa" },
];
const patterns = [
  { ...item("prism_grid", 100), pattern: pattern((x, y) => x < 4 !== y < 4) },
  { ...item("diagonal", 125), pattern: pattern((x, y) => (x + y) % 8 < 3) },
  {
    ...item("ripple", 150),
    pattern: pattern((x, y) => (y + [0, 1, 2, 3, 3, 2, 1, 0][x]) % 8 < 3),
  },
  {
    ...item("diamonds", 175),
    pattern: pattern((x, y) => Math.abs(x - 3.5) + Math.abs(y - 3.5) < 3),
  },
];

const violet = ["#7c3aed", "#c4b5fd", "#67e8f9"];
const sunset = ["#f97316", "#fbbf24", "#fb7185"];
const gradient = (colors: string[]) => ({
  type: "gradient" as const,
  colors,
  colorSize: 8,
  movementSpeed: 2,
});
export const localEffects: Effect[] = [
  {
    ...item("violet_wake", 125),
    effectType: "transportShipTrail",
    attributes: gradient(violet),
  },
  {
    ...item("sunset_wake", 125),
    effectType: "transportShipTrail",
    attributes: gradient(sunset),
  },
  {
    ...item("comet_trail", 200),
    effectType: "nukeTrail",
    attributes: gradient(sunset),
  },
  {
    ...item("violet_vortex", 300),
    effectType: "nukeTrail",
    attributes: {
      type: "spiral",
      colors: violet,
      radius: 2,
      strands: 3,
      rotationSpeed: 2,
    },
  },
  {
    ...item("amethyst_shockwave", 250),
    effectType: "nukeExplosion",
    attributes: {
      type: "shockwave",
      nukeType: "atom",
      colors: violet,
      size: 70,
      speed: 35,
      thickness: 2,
      transitionSpeed: 1,
    },
  },
  {
    ...item("solar_embers", 300),
    effectType: "nukeExplosion",
    attributes: {
      type: "embers",
      nukeType: "hydro",
      colors: sunset,
      size: 100,
      speed: 40,
      thickness: 1,
      transitionSpeed: 1,
      density: 40,
    },
  },
  {
    ...item("prism_sparkles", 300),
    effectType: "nukeExplosion",
    attributes: {
      type: "sparkles",
      nukeType: "mirvWarhead",
      colors: violet,
      size: 50,
      speed: 30,
      thickness: 1,
      transitionSpeed: 1,
      density: 25,
    },
  },
  {
    ...item("amethyst_city", 200),
    effectType: "structures",
    attributes: gradient(violet),
  },
  {
    ...item("copper_fleet", 200),
    effectType: "warship",
    attributes: gradient(sunset),
  },
  {
    ...item("neon_express", 175),
    effectType: "train",
    attributes: gradient(violet),
  },
  {
    ...item("golden_rails", 150),
    effectType: "railroad",
    attributes: gradient(["#b45309", "#fde68a"]),
  },
].map((effect) => EffectSchema.parse(effect));

export function localCosmeticStyles(origin: string) {
  const assets = (
    category: string,
    entries: { name: string; priceSoft: number }[],
  ) =>
    Object.fromEntries(
      entries.map((entry) => [
        entry.name,
        {
          ...item(entry.name, entry.priceSoft),
          url: `${origin}/api/accounts/cosmetics/${category}/${entry.name}.svg`,
        },
      ]),
    );
  return {
    colorPalettes: Object.fromEntries(
      palettes.map((palette) => [palette.name, palette]),
    ),
    patterns: Object.fromEntries(
      patterns.map((p) => [
        p.name,
        {
          ...p,
          colorPalettes: palettes.map((palette) => ({
            name: palette.name,
            isArchived: false,
          })),
        },
      ]),
    ),
    crowns: assets("crowns", [
      { name: "amethyst_crown", priceSoft: 200 },
      { name: "sunburst_crown", priceSoft: 250 },
      { name: "frost_crown", priceSoft: 300 },
    ]),
    skins: assets("skins", [
      { name: "nebula", priceSoft: 200 },
      { name: "jade_mosaic", priceSoft: 200 },
    ]),
    effects: Object.fromEntries(
      [...new Set(localEffects.map((e) => e.effectType))].map((type) => [
        type,
        Object.fromEntries(
          localEffects
            .filter((e) => e.effectType === type)
            .map((e) => [e.name, e]),
        ),
      ]),
    ),
  };
}
