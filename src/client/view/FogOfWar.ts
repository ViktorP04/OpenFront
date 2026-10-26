import { TERRITORY_VISION } from "@openfront/engine-lib/game/FogOfWarRules";
export {
  TERRITORY_VISION,
  RADAR_VISION,
  unitVisionRadius,
} from "@openfront/engine-lib/game/FogOfWarRules";
export { FOG_BIT } from "../render/gl/utils/TileCodec";

export interface VisionSource {
  pos: number;
  radius: number;
  wrap?: boolean;
}

/** Reusable local vision buffers; ship trails are layered over current coverage. */
export class FogOfWar {
  readonly visible: Uint8Array;
  private readonly changedChunks = new Set<number>();
  private sources = new Map<string, VisionSource>();
  private sourceChunks = new Set<number>();
  private previousSources = new Map<string, VisionSource>();

  get dirtyChunks(): ReadonlySet<number> {
    // Sources are added in two passes (current units, then historical trails).
    // Only after both passes can an unmatched old source be called removed.
    for (const source of this.previousSources.values()) {
      this.markSourceChunks(this.changedChunks, source);
    }
    return this.changedChunks;
  }
  readonly chunkColumns: number;
  private readonly territory: Uint8Array;
  private readonly friendlyTiles: Uint8Array;
  private readonly friendlyLookup = new Uint8Array(4096);
  // Conservative owner-to-chunk index: historical owners may stay listed,
  // but new ownership is indexed immediately, so coverage is never missed.
  private readonly ownerChunks = new Map<number, Set<number>>();

  private indexOwner(tile: number, owner: number): void {
    if (owner === 0) return;
    let chunks = this.ownerChunks.get(owner);
    if (!chunks) this.ownerChunks.set(owner, (chunks = new Set()));
    chunks.add(
      Math.floor(Math.floor(tile / this.width) / this.chunkSize) *
        this.chunkColumns +
        Math.floor((tile % this.width) / this.chunkSize),
    );
  }

  private expandChunk(chunks: Set<number>, chunk: number): void {
    const x = (chunk % this.chunkColumns) * this.chunkSize;
    const y = Math.floor(chunk / this.chunkColumns) * this.chunkSize;
    this.markChunks(
      chunks,
      x - this.territoryRadius,
      y - this.territoryRadius,
      x + this.chunkSize - 1 + this.territoryRadius,
      y + this.chunkSize - 1 + this.territoryRadius,
    );
  }
  private friendlyKey: string | undefined;
  private readonly distances: Uint8Array;
  private readonly queue: Int32Array;
  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly territoryRadius = TERRITORY_VISION,
    readonly chunkSize = 64,
  ) {
    this.distances = new Uint8Array((chunkSize + territoryRadius * 2) ** 2);
    this.visible = new Uint8Array(width * height);
    this.territory = new Uint8Array(width * height);
    this.friendlyTiles = new Uint8Array(width * height);
    this.chunkColumns = Math.ceil(width / this.chunkSize);
    this.queue = new Int32Array(width * height);
  }

  isVisible(tile: number): boolean {
    return tile >= 0 && tile < this.visible.length && this.visible[tile] !== 0;
  }

  update(
    owners: Uint16Array,
    friendly: ReadonlySet<number>,
    sources: Iterable<VisionSource>,
    changedTiles?: Iterable<number>,
  ): Uint8Array {
    const key = [...friendly].sort((a, b) => a - b).join(",");
    this.changedChunks.clear();
    this.previousSources = this.sources;
    this.sources = new Map();
    const resetChunks = this.sourceChunks;
    this.sourceChunks = new Set();
    if (this.friendlyKey === undefined || changedTiles === undefined) {
      this.friendlyKey = key;
      this.rebuildTerritory(owners, friendly);
      this.visible.set(this.territory);
      this.markChunks(
        this.changedChunks,
        0,
        0,
        this.width - 1,
        this.height - 1,
      );
    } else {
      const chunks = new Set<number>();
      const changes =
        changedTiles instanceof Set || Array.isArray(changedTiles)
          ? changedTiles
          : Array.from(changedTiles);
      for (const tile of changes) this.indexOwner(tile, owners[tile] & 0xfff);
      if (key !== this.friendlyKey) {
        const rosterChunks = new Set<number>();
        for (let owner = 1; owner < this.friendlyLookup.length; owner++) {
          const value = friendly.has(owner) ? 1 : 0;
          if (this.friendlyLookup[owner] === value) continue;
          for (const chunk of this.ownerChunks.get(owner) ?? [])
            rosterChunks.add(chunk);
          this.friendlyLookup[owner] = value;
        }
        for (const chunk of rosterChunks) {
          this.expandChunk(chunks, chunk);
          const x = (chunk % this.chunkColumns) * this.chunkSize;
          const y = Math.floor(chunk / this.chunkColumns) * this.chunkSize;
          for (
            let row = y;
            row < Math.min(this.height, y + this.chunkSize);
            row++
          )
            for (
              let col = x;
              col < Math.min(this.width, x + this.chunkSize);
              col++
            ) {
              const tile = row * this.width + col;
              this.friendlyTiles[tile] =
                this.friendlyLookup[owners[tile] & 0xfff];
            }
        }
        this.friendlyKey = key;
      }
      for (const tile of changes) {
        const own = this.friendlyLookup[owners[tile] & 0xfff];
        if (own === this.friendlyTiles[tile]) continue;
        this.friendlyTiles[tile] = own;
        const x = tile % this.width,
          y = Math.floor(tile / this.width);
        this.markChunks(
          chunks,
          x - this.territoryRadius,
          y - this.territoryRadius,
          x + this.territoryRadius,
          y + this.territoryRadius,
        );
      }
      for (const chunk of chunks) {
        this.rebuildChunk(owners, chunk);
        this.changedChunks.add(chunk);
        resetChunks.add(chunk);
      }
      // Restore only last tick's source coverage and changed territory. On
      // Giant World, copying the entire visibility map here costs 8 MB/tick.
      for (const chunk of resetChunks) {
        const x = (chunk % this.chunkColumns) * this.chunkSize;
        const y = Math.floor(chunk / this.chunkColumns) * this.chunkSize;
        const endX = Math.min(this.width, x + this.chunkSize);
        const endY = Math.min(this.height, y + this.chunkSize);
        for (let row = y; row < endY; row++) {
          const start = row * this.width + x;
          this.visible.set(
            this.territory.subarray(start, row * this.width + endX),
            start,
          );
        }
      }
    }
    this.addSources(sources);
    return this.visible;
  }

  private markChunks(
    chunks: Set<number>,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): void {
    const size = this.chunkSize;
    for (
      let cy = Math.floor(Math.max(0, y0) / size);
      cy <= Math.floor(Math.min(this.height - 1, y1) / size);
      cy++
    )
      for (
        let cx = Math.floor(Math.max(0, x0) / size);
        cx <= Math.floor(Math.min(this.width - 1, x1) / size);
        cx++
      )
        chunks.add(cy * this.chunkColumns + cx);
  }

  /** Exact Manhattan distance on a small chunk plus its visibility halo. */
  private rebuildChunk(owners: Uint16Array, chunk: number): void {
    const size = this.chunkSize,
      radius = this.territoryRadius;
    const x0 = (chunk % this.chunkColumns) * size,
      y0 = Math.floor(chunk / this.chunkColumns) * size;
    const x1 = Math.min(this.width, x0 + size),
      y1 = Math.min(this.height, y0 + size);
    const left = Math.max(0, x0 - radius),
      top = Math.max(0, y0 - radius);
    const right = Math.min(this.width, x1 + radius),
      bottom = Math.min(this.height, y1 + radius);
    const w = right - left,
      h = bottom - top,
      d = this.distances;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        d[i] = this.friendlyLookup[
          owners[(top + y) * this.width + left + x] & 0xfff
        ]
          ? 0
          : radius + 1;
        if (x > 0) d[i] = Math.min(d[i], d[i - 1] + 1);
        if (y > 0) d[i] = Math.min(d[i], d[i - w] + 1);
      }
    for (let y = h - 1; y >= 0; y--)
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (x + 1 < w) d[i] = Math.min(d[i], d[i + 1] + 1);
        if (y + 1 < h) d[i] = Math.min(d[i], d[i + w] + 1);
      }
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++)
        this.territory[y * this.width + x] = Math.max(
          0,
          radius + 1 - d[(y - top) * w + x - left],
        );
  }

  private rebuildTerritory(
    owners: Uint16Array,
    friendly: ReadonlySet<number>,
  ): void {
    const { territory: visible, width, queue, friendlyLookup } = this;
    visible.fill(0);
    this.ownerChunks.clear();
    friendlyLookup.fill(0);
    for (const owner of friendly) friendlyLookup[owner] = 1;
    // Seed all friendly territory, but only enqueue its frontier. Each exterior
    // tile is visited once, regardless of empire size or overlapping borders.
    for (let tile = 0; tile < visible.length; tile++) {
      this.indexOwner(tile, owners[tile] & 0xfff);
      this.friendlyTiles[tile] = friendlyLookup[owners[tile] & 0xfff];
      if (friendlyLookup[owners[tile] & 0xfff])
        visible[tile] = this.territoryRadius + 1;
    }
    let head = 0,
      tail = 0;
    for (let tile = 0; tile < visible.length; tile++) {
      if (!visible[tile]) continue;
      const x = tile % width;
      if (
        (x > 0 && !visible[tile - 1]) ||
        (x + 1 < width && !visible[tile + 1]) ||
        (tile >= width && !visible[tile - width]) ||
        (tile + width < visible.length && !visible[tile + width])
      )
        queue[tail++] = tile;
    }
    while (head < tail) {
      const tile = queue[head++],
        strength = visible[tile] - 1;
      if (strength === 0) continue;
      const x = tile % width;
      const visit = (next: number) => {
        if (visible[next] === 0) {
          visible[next] = strength;
          queue[tail++] = next;
        }
      };
      if (x > 0) visit(tile - 1);
      if (x + 1 < width) visit(tile + 1);
      if (tile >= width) visit(tile - width);
      if (tile + width < visible.length) visit(tile + width);
    }
  }

  private markSourceChunks(
    chunks: Set<number>,
    { pos, radius, wrap }: VisionSource,
  ): void {
    const xs = wrap ? [-this.width, 0, this.width] : [0];
    const ys = wrap ? [-this.height, 0, this.height] : [0];
    for (const ox of xs)
      for (const oy of ys) {
        const x = (pos % this.width) + ox,
          y = Math.floor(pos / this.width) + oy;
        this.markChunks(chunks, x - radius, y - radius, x + radius, y + radius);
      }
  }

  addSources(sources: Iterable<VisionSource>): void {
    const { visible, width, height } = this;
    // Circular mobile/structure vision. Rasterize horizontal spans, avoiding
    // square roots per tile and keeping radar overlap inexpensive.
    for (const source of sources) {
      const { pos, radius, wrap } = source;
      if (radius <= 0) continue;
      const key = `${pos}:${radius}:${wrap ? 1 : 0}`;
      if (this.sources.has(key)) continue;
      this.sources.set(key, { pos, radius, wrap });
      this.markSourceChunks(this.sourceChunks, source);
      if (!this.previousSources.delete(key)) {
        this.markSourceChunks(this.changedChunks, source);
      }
      const offsetsX = wrap ? [-width, 0, width] : [0];
      const offsetsY = wrap ? [-height, 0, height] : [0];
      for (const ox of offsetsX)
        for (const oy of offsetsY) {
          const cx = (pos % width) + ox,
            cy = Math.floor(pos / width) + oy;
          for (
            let y = Math.max(0, cy - radius);
            y <= Math.min(height - 1, cy + radius);
            y++
          ) {
            const dx = Math.floor(Math.sqrt(radius * radius - (y - cy) ** 2));
            if (cx + dx < 0 || cx - dx >= width) continue;
            visible.fill(
              1,
              y * width + Math.max(0, cx - dx),
              y * width + Math.min(width - 1, cx + dx) + 1,
            );
          }
        }
    }
  }
}
