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
  private readonly queue: Int32Array;
  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    this.visible = new Uint8Array(width * height);
    this.queue = new Int32Array(width * height);
  }

  update(
    owners: Uint16Array,
    friendly: ReadonlySet<number>,
    sources: Iterable<{ pos: number; radius: number; wrap?: boolean }>,
  ): Uint8Array {
    const { visible, width, queue } = this;
    visible.fill(0);
    const friendlyLookup = new Uint8Array(4096);
    for (const owner of friendly) friendlyLookup[owner] = 1;
    // Seed all friendly territory, but only enqueue its frontier. Each exterior
    // tile is visited once, regardless of empire size or overlapping borders.
    for (let tile = 0; tile < visible.length; tile++) {
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
    this.addSources(sources);
    return visible;
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
