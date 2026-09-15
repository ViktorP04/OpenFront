import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  LocalLeaderboardMetric,
  LocalLeaderboardResponse,
  LocalLeaderboardResponseSchema,
} from "../../../core/LocalLeaderboard";
import { getApiBase } from "../../Api";

@customElement("local-leaderboard-table")
export class LocalLeaderboardTable extends LitElement {
  @property() metric: LocalLeaderboardMetric = "caps";
  @state() private players: LocalLeaderboardResponse["players"] = [];
  @state() private loading = false;
  @state() private error = false;
  @state() private hasMore = false;
  private page = 1;
  private request = 0;

  createRenderRoot() {
    return this;
  }

  public async load(reset = true) {
    const token = ++this.request;
    if (reset) {
      this.page = 1;
      this.players = [];
      this.hasMore = false;
    }
    this.loading = true;
    this.error = false;
    try {
      const url = new URL(`${getApiBase()}/leaderboard/local`);
      url.searchParams.set("metric", this.metric);
      url.searchParams.set("page", String(this.page));
      const response = await fetch(url, { credentials: "omit" });
      if (!response.ok) throw new Error("Leaderboard request failed");
      const data = LocalLeaderboardResponseSchema.parse(await response.json());
      if (token !== this.request) return;
      const ids = new Set(this.players.map((p) => p.publicId));
      this.players = [
        ...this.players,
        ...data.players.filter((p) => !ids.has(p.publicId)),
      ];
      this.hasMore = data.hasMore;
      this.page++;
    } catch {
      if (token === this.request) this.error = true;
    } finally {
      if (token === this.request) this.loading = false;
    }
  }

  render() {
    return html`<div class="h-full overflow-auto p-4 text-white">
      <div class="flex items-center justify-between gap-4 mb-4">
        <p class="text-sm text-white/60">
          ${this.metric === "caps"
            ? "Lifetime Caps earned from eligible games. Spending Caps does not affect your rank."
            : "Solo map medals earned across maps and difficulty levels."}
        </p>
        <button
          class="px-4 py-2 rounded-lg bg-purple-700 hover:bg-purple-600 disabled:opacity-50"
          ?disabled=${this.loading}
          @click=${() => this.load()}
        >
          Refresh
        </button>
      </div>
      <table class="w-full text-sm">
        <thead>
          <tr class="text-white/60 border-b border-white/10">
            <th class="p-3 text-left">Rank</th>
            <th class="p-3 text-left">Player</th>
            <th class="p-3 text-right">
              ${this.metric === "caps" ? "Caps earned" : "Medals"}
            </th>
          </tr>
        </thead>
        <tbody>
          ${this.players.map(
            (p) =>
              html`<tr class="border-b border-white/10">
                <td class="p-3">${p.rank}</td>
                <td class="p-3">${p.username}</td>
                <td class="p-3 text-right font-mono">${p.score}</td>
              </tr>`,
          )}
        </tbody>
      </table>
      ${this.loading
        ? html`<p class="p-4 text-center">Loading�</p>`
        : this.error
          ? html`<p class="p-4 text-center">
              Could not load the leaderboard.
              <button
                class="underline"
                @click=${() => this.load(this.players.length === 0)}
              >
                Try again
              </button>
            </p>`
          : this.players.length === 0
            ? html`<p class="p-4 text-center text-white/60">
                No scores yet. Sign in and play to appear here.
              </p>`
            : ""}
      ${this.hasMore && !this.loading && !this.error
        ? html`<button
            class="block mx-auto my-4 px-4 py-2 rounded-lg bg-purple-700"
            @click=${() => this.load(false)}
          >
            Load more
          </button>`
        : ""}
    </div>`;
  }
}
