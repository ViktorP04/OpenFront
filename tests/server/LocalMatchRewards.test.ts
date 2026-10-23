import { sendLocalMatchXp } from "../../src/server/LocalProgressionRewards";
// @vitest-environment node
import { Difficulty, GameType } from "@openfront/engine-api/game/GameTypes";
import type { GameConfig } from "@openfront/engine-api/Schemas";
import type { ClientMessage } from "@openfront/shared/WireSchemas";
import { createGameWireContext } from "@openfront/shared/ZbinWire";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localAccountsEnabled } from "../../src/auth/AuthConfig";
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
  sendLocalMatchReward: vi.fn(async () => null),
}));

vi.mock("../../src/server/LocalProgressionRewards", () => ({
  sendLocalMatchXp: vi.fn(async () => {}),
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
    toggleCheats = false,
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
    if (toggleCheats) {
      game.updateGameConfig({ infiniteGold: true });
      game.updateGameConfig({ infiniteGold: false });
    }
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

  it("remembers cheats enabled during a match even after they are disabled", async () => {
    await play({}, 305, false, true);
    expect(sendLocalMatchXp).toHaveBeenCalledWith(
      expect.objectContaining({ disqualified: true }),
    );
    expect(sendLocalMatchReward).not.toHaveBeenCalled();
  });

  it("submits confirmed XP stats only for authenticated local participants", async () => {
    const { game, players, guest } = await play();
    expect(sendLocalMatchXp).toHaveBeenCalledOnce();
    const match = vi.mocked(sendLocalMatchXp).mock.calls[0][0];
    expect(match.info.statsAgreed).toBe(true);
    expect(match.info.num_turns).toBeGreaterThan(3000);
    expect(match.userIds).toEqual(players.map((player) => player.persistentID));
    expect(match.userIds).not.toContain(guest.persistentID);
    expect(match.disqualified).toBe(false);
    await game.end();
    expect(sendLocalMatchXp).toHaveBeenCalledOnce();
  });

  it("credits only authenticated original players and identifies the winner", async () => {
    const { game, players } = await play();
    expect(sendLocalMatchReward).toHaveBeenCalledOnce();
    const match = vi.mocked(sendLocalMatchReward).mock.calls[0][0];
    expect(match.players).toHaveLength(2);
    expect(match.gameType).toBe(GameType.Private);
    expect(match.players[0]).toMatchObject({
      userId: players[0].persistentID,
      won: true,
    });
    expect(match.players[0].seconds).toBeGreaterThanOrEqual(300);
    expect(match.players[1].won).toBe(false);
    await game.end();
    expect(sendLocalMatchReward).toHaveBeenCalledOnce();
  });

  it("sends each account only its confirmed Caps award", async () => {
    vi.mocked(sendLocalMatchReward).mockImplementationOnce(async (match) => ({
      [match.players[0].userId]: 25,
    }));
    const { players, guest } = await play();
    const wireContext = createGameWireContext(
      [...players, guest].map((player) => ({ clientID: player.clientID })),
    );
    await vi.waitFor(() =>
      expect(
        mockWsOf(players[0])
          .sent(wireContext)
          .some(
            (message) =>
              message.type === "caps_reward" && message.amount === 25,
          ),
      ).toBe(true),
    );
    expect(
      mockWsOf(players[1])
        .sent(wireContext)
        .some((message) => message.type === "caps_reward"),
    ).toBe(false);
  });

  it("submits one-account AI lobby wins with the selected difficulty", async () => {
    const game = makeGame({
      config: { bots: 400, difficulty: Difficulty.Impossible },
    });
    const player = makeClient({ persistentID: randomUUID() });
    Object.defineProperty(player, "claims", { value: { provider: "local" } });
    game.joinClient(player);
    startGame(game);
    setInterval(() => {
      player.lastPing = Date.now();
    }, 1000);
    vi.advanceTimersByTime(305000);
    await mockWsOf(player).emit({
      type: "winner",
      winner: ["player", player.clientID],
      allPlayersStats: {},
    });
    expect(sendLocalMatchReward).toHaveBeenCalledWith(
      expect.objectContaining({
        gameType: GameType.Private,
        difficulty: Difficulty.Impossible,
        players: [
          expect.objectContaining({ userId: player.persistentID, won: true }),
        ],
      }),
    );
  });

  it("does not submit an empty lobby win", async () => {
    const game = makeGame({ config: { bots: 0, nations: "disabled" } });
    const player = makeClient({ persistentID: randomUUID() });
    Object.defineProperty(player, "claims", { value: { provider: "local" } });
    game.joinClient(player);
    startGame(game);
    await mockWsOf(player).emit({
      type: "winner",
      winner: ["player", player.clientID],
      allPlayersStats: {},
    });
    expect(sendLocalMatchReward).not.toHaveBeenCalled();
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
    ).toBe(true);
  });
});
