import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalLeaderboardTable } from "../../src/client/components/leaderboard/LocalLeaderboardTable";
vi.mock("../../src/client/Api", () => ({
  getApiBase: () => "https://game.test/api/accounts",
}));
let table: LocalLeaderboardTable;
afterEach(() => {
  table?.remove();
  vi.unstubAllGlobals();
});
function mount() {
  expect(customElements.get("local-leaderboard-table")).toBe(
    LocalLeaderboardTable,
  );
  table = document.createElement(
    "local-leaderboard-table",
  ) as LocalLeaderboardTable;
  document.body.append(table);
}
const response = (username: string) =>
  new Response(
    JSON.stringify({
      players: [{ rank: 1, publicId: "public", username, score: 40 }],
      hasMore: false,
    }),
    { status: 200 },
  );
describe("local leaderboard table", () => {
  it("discards a stale response after changing boards", async () => {
    let resolve!: (value: Response) => void;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValueOnce(response("New medal leader"));
    vi.stubGlobal("fetch", fetchMock);
    mount();
    const old = table.load();
    table.metric = "medals";
    await table.load();
    resolve(response("Old Caps leader"));
    await old;
    await table.updateComplete;
    expect(table.textContent).toContain("New medal leader");
    expect(table.textContent).not.toContain("Old Caps leader");
    expect(String(fetchMock.mock.calls[1][0])).toContain("metric=medals");
    expect(fetchMock.mock.calls[1][1]).toEqual({ credentials: "omit" });
  });
  it("allows retry after a failed public request and renders usernames as text", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce(response("<img src=x onerror=alert(1)>")),
    );
    mount();
    await table.load();
    await table.updateComplete;
    expect(table.textContent).toContain("Try again");
    await table.load();
    await table.updateComplete;
    expect(table.querySelector("img")).toBeNull();
    expect(table.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(table.textContent).not.toContain("Could not load");
  });
});
