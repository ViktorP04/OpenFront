// @vitest-environment node
import { expect, it } from "vitest";
import { eligibleCompletion } from "../../src/server/LocalAchievements";

import { completionInfo, completionUser } from "../fixtures/LocalCompletion";
it("accepts a standard single-player map win for its account", () => {
  expect(eligibleCompletion(completionInfo(), completionUser)).toEqual({
    mapName: "Viktor",
    difficulty: "Medium",
  });
  expect(eligibleCompletion(completionInfo(), "another-account")).toBeNull();
});
it.each([
  { infiniteGold: true },
  { infiniteTroops: true },
  { instantBuild: true },
  { bots: 0 },
  { nations: "disabled" },
  { gameMode: "Team" },
  { gameMapSize: "Compact" },
  { gameType: "Public" },
  { randomSpawn: true },
  { startingGold: 100 },
  { goldMultiplier: 2 },
  { maxTimerValue: 10 },
  { waterNukes: true },
  { customAllianceDuration: 0 },
  { hostCheats: { infiniteGold: true } },
  { gameMap: "Unknown" },
])("rejects modified or unsupported settings: %j", (overrides) => {
  const info = completionInfo();
  Object.assign(info.config, overrides);
  expect(eligibleCompletion(info, completionUser)).toBeNull();
});
it("rejects losses, quits, malformed records and additional human players", () => {
  const info = completionInfo();
  expect(eligibleCompletion({}, completionUser)).toBeNull();
  expect(
    eligibleCompletion({ ...info, winner: undefined }, completionUser),
  ).toBeNull();
  expect(
    eligibleCompletion(
      { ...info, winner: ["player", "other123"] },
      completionUser,
    ),
  ).toBeNull();
  expect(
    eligibleCompletion(
      { ...info, players: [...info.players, ...info.players] },
      completionUser,
    ),
  ).toBeNull();
});
