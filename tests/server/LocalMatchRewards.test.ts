// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localAccountsEnabled } from "../../src/auth/AuthConfig";
import { GameType } from "../../src/core/game/Game";
import type { ClientMessage, GameConfig } from "../../src/core/Schemas";
import { capsEligibleConfig } from "../../src/server/LocalEconomy";
import { sendLocalMatchReward } from "../../src/server/LocalMatchRewards";
import {
  makeClient,
  makeGame,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

vi.mock("../../src/auth/AuthConfig", async (original) => ({
  ...(await original<typeof import("../../src/auth/AuthConfig")>()),
  localAccountsEnabled: vi.fn(() => true),
}));
vi.mock("../../src/server/LocalMatchRewards", () => ({
  sendLocalMatchReward: vi.fn(async () => {}),
}));

describe("game server Caps awards", () => {
  beforeEach(() => {
    vi.mocked(localAccountsEnabled).mockReturnValue(true);
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  async function play(
    config: Partial<GameConfig> = {},
    seconds = 305,
    quiet = false,
  ) {
    const game = makeGame({ config });
    const players = [
      makeClient({ persistentID: randomUUID() }),
      makeClient({ persistentID: randomUUID() }),
    ];
    for (const player of players) {
      Object.defineProperty(player, "claims", { value: { provider: "local" } });
      game.joinClient(player);
    }
    const guest = makeClient();
    game.joinClient(guest);
    startGame(game);
    for (let i = 0; i < seconds; i++) {
      players[0].lastPing = Date.now();
      if (!quiet) players[1].lastPing = Date.now();
      vi.advanceTimersByTime(1000);
    }
    const msg: ClientMessage = {
      type: "winner",
      winner: ["player", players[0].clientID],
      allPlayersStats: {},
    };
    await mockWsOf(players[0]).emit(msg);
    await mockWsOf(players[1]).emit(msg);
    return { game, players, guest };
  }

  it("credits only authenticated original players and identifies the winner", async () => {
    const { game, players } = await play();
    expect(sendLocalMatchReward).toHaveBeenCalledOnce();
    const match = vi.mocked(sendLocalMatchReward).mock.calls[0][0];
    expect(match.players).toHaveLength(2);
    expect(match.players[0]).toMatchObject({
      userId: players[0].persistentID,
      won: true,
    });
    expect(match.players[0].seconds).toBeGreaterThanOrEqual(300);
    expect(match.players[1].won).toBe(false);
    await game.end();
    expect(sendLocalMatchReward).toHaveBeenCalledOnce();
  });

  it("does not turn match duration into participation for a quiet player", async () => {
    await play({}, 305, true);
    const match = vi.mocked(sendLocalMatchReward).mock.calls[0][0];
    expect(match.players[0].seconds).toBeGreaterThanOrEqual(300);
    expect(match.players[1].seconds).toBeLessThan(30);
  });

  it("does not submit rewards for games with cheats or upstream mode", async () => {
    await play({ infiniteGold: true }, 5);
    expect(sendLocalMatchReward).not.toHaveBeenCalled();
    vi.mocked(localAccountsEnabled).mockReturnValue(false);
    await play({}, 5);
    expect(sendLocalMatchReward).not.toHaveBeenCalled();
    expect(
      capsEligibleConfig({ gameType: GameType.Singleplayer } as GameConfig),
    ).toBe(false);
  });
});
