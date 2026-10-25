import { TERRITORY_VISION } from "@openfront/engine-lib/game/FogOfWarRules";
export {
  TERRITORY_VISION,
  RADAR_VISION,
  unitVisionRadius,
} from "@openfront/engine-lib/game/FogOfWarRules";
export { FOG_BIT } from "../render/gl/utils/TileCodec";

/** Reusable local vision buffers; ship trails are layered over current coverage. */
export class FogOfWar {
  readonly visible: Uint8Array;
  readonly dirtyChunks = new Set<number>();
  readonly chunkSize = 64;
  readonly chunkColumns: number;
  private readonly territory: Uint8Array;
  private readonly friendlyTiles: Uint8Array;
  private readonly friendlyLookup = new Uint8Array(4096);
  private friendlyKey: string | undefined;
  private readonly sourceChunks = new Set<number>();
  private readonly distances = new Uint8Array((64 + TERRITORY_VISION * 2) ** 2);
  private readonly queue: Int32Array;
  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    this.visible = new Uint8Array(width * height);
    this.territory = new Uint8Array(width * height);
    this.friendlyTiles = new Uint8Array(width * height);
    this.chunkColumns = Math.ceil(width / this.chunkSize);
    this.queue = new Int32Array(width * height);
  }

  update(
    owners: Uint16Array,
    friendly: ReadonlySet<number>,
    sources: Iterable<{ pos: number; radius: number; wrap?: boolean }>,
    changedTiles?: Iterable<number>,
  ): Uint8Array {
    const key = [...friendly].sort((a, b) => a - b).join(",");
    this.dirtyChunks.clear();
    for (const chunk of this.sourceChunks) this.dirtyChunks.add(chunk);
    this.sourceChunks.clear();
    if (key !== this.friendlyKey || changedTiles === undefined) {
      this.friendlyKey = key;
      this.rebuildTerritory(owners, friendly);
      this.markChunks(this.dirtyChunks, 0, 0, this.width - 1, this.height - 1);
    } else {
      const chunks = new Set<number>();
      for (const tile of changedTiles) {
        const own = this.friendlyLookup[owners[tile] & 0xfff];
        if (own === this.friendlyTiles[tile]) continue;
        this.friendlyTiles[tile] = own;
        const x = tile % this.width,
          y = Math.floor(tile / this.width);
        this.markChunks(
          chunks,
          x - TERRITORY_VISION,
          y - TERRITORY_VISION,
          x + TERRITORY_VISION,
          y + TERRITORY_VISION,
        );
      }
      for (const chunk of chunks) {
        this.rebuildChunk(owners, chunk);
        this.dirtyChunks.add(chunk);
      }
    }
    this.visible.set(this.territory);
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
      radius = TERRITORY_VISION;
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
    friendlyLookup.fill(0);
    for (const owner of friendly) friendlyLookup[owner] = 1;
    // Seed all friendly territory, but only enqueue its frontier. Each exterior
    // tile is visited once, regardless of empire size or overlapping borders.
    for (let tile = 0; tile < visible.length; tile++) {
      this.friendlyTiles[tile] = friendlyLookup[owners[tile] & 0xfff];
      if (friendlyLookup[owners[tile] & 0xfff])
        visible[tile] = TERRITORY_VISION + 1;
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

  addSources(
    sources: Iterable<{ pos: number; radius: number; wrap?: boolean }>,
  ): void {
    const { visible, width, height } = this;
    // Circular mobile/structure vision. Rasterize horizontal spans, avoiding
    // square roots per tile and keeping radar overlap inexpensive.
    for (const { pos, radius, wrap } of sources) {
      if (radius <= 0) continue;
      const offsetsX = wrap ? [-width, 0, width] : [0];
      const offsetsY = wrap ? [-height, 0, height] : [0];
      for (const ox of offsetsX)
        for (const oy of offsetsY) {
          const cx = (pos % width) + ox,
            cy = Math.floor(pos / width) + oy;
          this.markChunks(
            this.sourceChunks,
            cx - radius,
            cy - radius,
            cx + radius,
            cy + radius,
          );
          this.markChunks(
            this.dirtyChunks,
            cx - radius,
            cy - radius,
            cx + radius,
            cy + radius,
          );
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
