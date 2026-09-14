// @vitest-environment node
// Opt-in integration test: run the dev server with an isolated account data
// directory, then set LOCAL_ACCOUNT_SMOKE_TEST=true when running this file.
import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { WebSocket } from "ws";
import { simpleHash } from "../../src/core/Util";
import {
  decodeServerMessage,
  encodeClientMessage,
} from "../../src/core/ZbinWire";

it.skipIf(process.env.LOCAL_ACCOUNT_SMOKE_TEST !== "true")(
  "accounts and guests join an invite, guests and revoked sessions cannot host",
  async () => {
    const origin = "http://localhost:9000";
    async function account() {
      const username = `Test_${randomBytes(5).toString("hex")}`;
      const registration = await fetch(origin + "/api/accounts/auth/register", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          username,
          password: randomBytes(24).toString("hex"),
        }),
      });
      expect(registration.status).toBe(201);
      const cookie = registration.headers.get("set-cookie")!.split(";")[0];
      const response = await fetch(origin + "/api/accounts/auth/refresh", {
        method: "POST",
        headers: { origin, cookie },
      });
      expect(response.status).toBe(200);
      return { username, cookie, jwt: (await response.json()).jwt as string };
    }
    const gitCommit = process.env.LOCAL_ACCOUNT_SMOKE_COMMIT ?? "DEV";
    const host = await account();
    const friend = await account();
    const create = (token: string) =>
      fetch(origin + "/api/create_game", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: "{}",
      });
    expect((await create(randomUUID())).status).toBe(401);
    const created = await create(host.jwt);
    expect(created.status).toBe(200);
    const { gameID } = await created.json();
    expect(typeof gameID).toBe("string");
    const worker = simpleHash(gameID) % 2;
    const invite = `${origin}/w${worker}/game/${gameID}`;
    expect((await fetch(invite)).status).toBe(200);
    const sockets: WebSocket[] = [];
    function join(user: typeof host) {
      return new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(`ws://localhost:9000/w${worker}`);
        sockets.push(socket);
        const timer = setTimeout(
          () => reject(new Error("Timed out joining private lobby")),
          10_000,
        );
        socket.on("error", reject);
        socket.on("open", () =>
          socket.send(
            encodeClientMessage(
              {
                type: "join",
                gameID,
                token: user.jwt,
                username: user.username,
                clanTag: null,
                turnstileToken: null,
                gitCommit,
              },
              undefined,
            ),
          ),
        );
        socket.on("message", (data) => {
          const message = decodeServerMessage(
            new Uint8Array(data as Buffer),
            undefined,
          );
          if (message.type === "error") {
            clearTimeout(timer);
            reject(new Error(message.error));
          }
          if (message.type === "lobby_info") {
            clearTimeout(timer);
            resolve();
          }
        });
      });
    }
    try {
      await join(host);
      await join(friend);
      const guest = { username: "Guest", cookie: "", jwt: randomUUID() };
      await join(guest);
      const guestSocket = sockets[sockets.length - 1];
      await new Promise<void>((resolve) => {
        guestSocket.once("close", () => resolve());
        guestSocket.close();
      });
      await join(guest); // Refresh/reconnect must retain a single guest player.
      const info = await (
        await fetch(`${origin}/w${worker}/api/game/${gameID}`)
      ).json();
      expect(info.clients).toHaveLength(3);
      await fetch(origin + "/api/accounts/auth/logout", {
        method: "POST",
        headers: { origin, cookie: host.cookie },
      });
      expect((await create(host.jwt)).status).toBe(401);
    } finally {
      for (const socket of sockets) socket.close();
    }
  },
  30_000,
);
