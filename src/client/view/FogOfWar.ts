import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { radarRange } from "@openfront/engine-lib/game/NavalBalance";

export const TERRITORY_VISION = 12;
export const RADAR_VISION = radarRange();
export { FOG_BIT } from "../render/gl/utils/TileCodec";

export function unitVisionRadius(type: string, level = 1): number {
  if (type === UnitType.TradeShip) return 10;
  if (type === UnitType.RadarStation) return radarRange(level);
  if (
    [UnitType.Warship, UnitType.Submarine, UnitType.TransportShip].includes(
      type as UnitType,
    )
  )
    return 35;
  // Projectiles do not act as disposable scouts.
  if (
    [
      UnitType.Shell,
      UnitType.SAMMissile,
      UnitType.AtomBomb,
      UnitType.HydrogenBomb,
      UnitType.MIRV,
      UnitType.MIRVWarhead,
    ].includes(type as UnitType)
  )
    return 0;
  return 20;
}

/** Reusable local vision buffers. Terrain never changes; there is no explored-map memory. */
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
    sources: Iterable<{ pos: number; radius: number }>,
  ): Uint8Array {
    const { visible, width, height, queue } = this;
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
    // Circular mobile/structure vision. Rasterize horizontal spans, avoiding
    // square roots per tile and keeping radar overlap inexpensive.
    for (const { pos, radius } of sources) {
      if (radius <= 0) continue;
      const cx = pos % width,
        cy = Math.floor(pos / width);
      for (
        let y = Math.max(0, cy - radius);
        y <= Math.min(height - 1, cy + radius);
        y++
      ) {
        const dx = Math.floor(Math.sqrt(radius * radius - (y - cy) ** 2));
        visible.fill(
          1,
          y * width + Math.max(0, cx - dx),
          y * width + Math.min(width - 1, cx + dx) + 1,
        );
      }
    }
    return visible;
  }
}
