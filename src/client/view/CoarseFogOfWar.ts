import { TERRITORY_VISION } from "@openfront/engine-lib/game/FogOfWarRules";
import { FogOfWar, type VisionSource } from "./FogOfWar";

/** Game-wide coarse visibility; full-resolution ownership stays authoritative. */
export class CoarseFogOfWar {
  readonly chunkSize = 64;
  readonly chunkColumns: number;
  private readonly columns: number;
  private readonly rows: number;
  private readonly owners: Uint16Array;
  private readonly inner: FogOfWar;
  private readonly ownerChunks = new Map<number, Set<number>>();
  private friendly = new Set<number>();
  private initialized = false;
  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly scale: number,
  ) {
    this.columns = Math.ceil(width / scale);
    this.rows = Math.ceil(height / scale);
    this.chunkColumns = Math.ceil(width / 64);
    this.owners = new Uint16Array(this.columns * this.rows);
    this.inner = new FogOfWar(
      this.columns,
      this.rows,
      Math.floor(TERRITORY_VISION / scale),
      64 / scale,
    );
  }
  get visible(): Uint8Array {
    return this.inner.visible;
  }
  get dirtyChunks(): ReadonlySet<number> {
    return this.inner.dirtyChunks;
  }
  private cell(tile: number): number {
    return (
      Math.floor(Math.floor(tile / this.width) / this.scale) * this.columns +
      Math.floor((tile % this.width) / this.scale)
    );
  }
  isVisible(tile: number): boolean {
    return (
      tile >= 0 &&
      tile < this.width * this.height &&
      this.inner.isVisible(this.cell(tile))
    );
  }
  private index(tile: number, owner: number): void {
    if (!owner) return;
    let chunks = this.ownerChunks.get(owner);
    if (!chunks) this.ownerChunks.set(owner, (chunks = new Set()));
    chunks.add(
      Math.floor(Math.floor(tile / this.width) / 64) * this.chunkColumns +
        Math.floor((tile % this.width) / 64),
    );
  }
  private *scaled(sources: Iterable<VisionSource>): Generator<VisionSource> {
    for (const source of sources) {
      if (source.radius <= 0) continue;
      yield {
        pos: this.cell(source.pos),
        radius: Math.floor(source.radius / this.scale),
        wrap: source.wrap,
      };
    }
  }
  update(
    owners: Uint16Array,
    friendly: ReadonlySet<number>,
    sources: Iterable<VisionSource>,
    changedTiles?: Iterable<number>,
  ): Uint8Array {
    const full = !this.initialized || changedTiles === undefined;
    const changed = new Set<number>();
    if (full) {
      this.owners.fill(0);
      this.ownerChunks.clear();
      for (let tile = 0; tile < owners.length; tile++) {
        const owner = owners[tile] & 0xfff;
        this.index(tile, owner);
        if (friendly.has(owner)) this.owners[this.cell(tile)] = 1;
      }
    } else {
      for (const tile of changedTiles) {
        this.index(tile, owners[tile] & 0xfff);
        changed.add(this.cell(tile));
      }
      for (const owner of new Set([...this.friendly, ...friendly])) {
        if (this.friendly.has(owner) === friendly.has(owner)) continue;
        for (const chunk of this.ownerChunks.get(owner) ?? []) {
          const x0 = (chunk % this.chunkColumns) * 64,
            y0 = Math.floor(chunk / this.chunkColumns) * 64;
          for (let y = y0; y < Math.min(this.height, y0 + 64); y += this.scale)
            for (let x = x0; x < Math.min(this.width, x0 + 64); x += this.scale)
              changed.add(this.cell(y * this.width + x));
        }
      }
      for (const cell of changed) {
        const x0 = (cell % this.columns) * this.scale,
          y0 = Math.floor(cell / this.columns) * this.scale;
        let own = false;
        for (
          let y = y0;
          y < Math.min(this.height, y0 + this.scale) && !own;
          y++
        )
          for (let x = x0; x < Math.min(this.width, x0 + this.scale); x++) {
            if (friendly.has(owners[y * this.width + x] & 0xfff)) {
              own = true;
              break;
            }
          }
        this.owners[cell] = own ? 1 : 0;
      }
    }
    this.friendly = new Set(friendly);
    this.initialized = true;
    this.inner.update(
      this.owners,
      new Set([1]),
      this.scaled(sources),
      full ? undefined : changed,
    );
    return this.visible;
  }
  addSources(sources: Iterable<VisionSource>): void {
    this.inner.addSources(this.scaled(sources));
  }
}
