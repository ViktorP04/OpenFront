import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { maps } from "../src/core/game/Maps.gen";

const root = path.resolve(import.meta.dirname, "..");
const names = new Set(maps.map((map) => map.id.toLowerCase()));
const english = JSON.parse(
  fs.readFileSync(path.join(root, "resources/lang/en.json"), "utf8"),
);
const problems: string[] = [];
for (const required of ["viktor", "tpg"]) {
  if (!names.has(required))
    problems.push(`${required}: missing from Maps.gen.ts`);
}
for (const map of maps) {
  const name = map.id.toLowerCase();
  const directory = path.join(root, "resources/maps", name);
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "manifest.json"), "utf8"),
    );
    const sourceInfo = path.join(
      root,
      "map-generator/assets/maps",
      name,
      "info.json",
    );
    if (fs.existsSync(sourceInfo)) {
      const source = JSON.parse(fs.readFileSync(sourceInfo, "utf8"));
      if (!isDeepStrictEqual(source.nations ?? [], manifest.nations ?? [])) {
        throw new Error(
          "nation data differs from source info.json; regenerate this map",
        );
      }
    }
    if (
      manifest.id !== map.id ||
      manifest.name !== map.type ||
      manifest.translation_key !== map.translationKey ||
      !english.map[name]
    ) {
      throw new Error(
        "generated metadata or translation does not match registration",
      );
    }
    if ((manifest.nations ?? []).length !== map.defaultNationCount)
      throw new Error("nation count differs from registration");
    for (const scale of ["map", "map4x", "map16x"]) {
      const { width, height } = manifest[scale];
      if (
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width <= 0 ||
        height <= 0 ||
        fs.statSync(path.join(directory, `${scale}.bin`)).size !==
          width * height
      ) {
        throw new Error(
          `${scale}.bin is missing, truncated, or has invalid dimensions`,
        );
      }
    }
    const thumbnail = fs.readFileSync(path.join(directory, "thumbnail.webp"));
    if (
      thumbnail.toString("ascii", 0, 4) !== "RIFF" ||
      thumbnail.toString("ascii", 8, 12) !== "WEBP"
    )
      throw new Error("thumbnail is not WebP");
  } catch (error) {
    problems.push(`${name}: ${error instanceof Error ? error.message : error}`);
  }
}
if (problems.length) {
  throw new Error(
    `Map build validation failed. Regenerate maps and commit the outputs:\n${problems.join("\n")}`,
  );
}
console.log(
  `Verified ${maps.length} generated maps, including Viktor and TPG.`,
);
