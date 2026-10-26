import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { ShipVisionTrail } from "@openfront/engine-api/game/GameUpdates";
import { SHIP_VISION_LINGER_TICKS, unitVisionRadius } from "./FogOfWarRules";

export function shipVisionRadius(type: string): number {
  return [
    UnitType.TradeShip,
    UnitType.TransportShip,
    UnitType.Warship,
    UnitType.Submarine,
  ].includes(type as UnitType)
    ? unitVisionRadius(type)
    : 0;
}

interface IndexedTrail {
  entry: ShipVisionTrail;
  x: number;
  y: number;
  radiusSquared: number;
}

type TrailCell = Map<number, Map<string, IndexedTrail>>;

/** Sparse recent circles, shared by simulation queries and the client mask.
 * Stationary ships refresh one entry rather than appending every tick.
 */
export class ShipVisionTrails {
  private entries = new Map<string, ShipVisionTrail>();
  private cells = new Map<number, TrailCell>();
  private byOwner = new Map<number, Map<string, ShipVisionTrail>>();
  private expirations = new Map<number, Set<string>>();

  private schedule(key: string, seen: number): void {
    const due = seen + SHIP_VISION_LINGER_TICKS;
    let bucket = this.expirations.get(due);
    if (!bucket) this.expirations.set(due, (bucket = new Set()));
    bucket.add(key);
  }

  private unschedule(key: string, seen: number): void {
    const due = seen + SHIP_VISION_LINGER_TICKS;
    const bucket = this.expirations.get(due);
    bucket?.delete(key);
    if (bucket?.size === 0) this.expirations.delete(due);
  }
  private readonly columns: number;
  constructor(private width: number) {
    this.columns = Math.ceil(width / 64);
  }

  private cell(pos: number): number {
    return (
      Math.floor((pos % this.width) / 64) +
      Math.floor(Math.floor(pos / this.width) / 64) * this.columns
    );
  }

  record(
    tick: number,
    sources: Iterable<{ owner: number; pos: number; radius: number }>,
  ): void {
    // At most one bucket per recently recorded tick, rather than scanning
    // every historical circle belonging to every ship on the planet.
    for (const [due, keys] of this.expirations) {
      if (due > tick) continue;
      for (const key of keys) {
        const entry = this.entries.get(key);
        if (!entry || tick - entry[3] < SHIP_VISION_LINGER_TICKS) continue;
        this.entries.delete(key);
        const ownerEntries = this.byOwner.get(entry[0]);
        ownerEntries?.delete(key);
        if (ownerEntries?.size === 0) this.byOwner.delete(entry[0]);
        const cellID = this.cell(entry[1]);
        const cell = this.cells.get(cellID);
        const ownerTrails = cell?.get(entry[0]);
        ownerTrails?.delete(key);
        if (ownerTrails?.size === 0) cell?.delete(entry[0]);
        if (cell?.size === 0) this.cells.delete(cellID);
      }
      this.expirations.delete(due);
    }
    for (const { owner, pos, radius } of sources) {
      if (radius <= 0) continue;
      const key = `${owner}:${pos}:${radius}`;
      const existing = this.entries.get(key);
      if (existing) {
        this.unschedule(key, existing[3]);
        existing[3] = tick;
        this.schedule(key, tick);
        continue;
      }
      const entry: ShipVisionTrail = [owner, pos, radius, tick];
      this.entries.set(key, entry);
      this.index(key, entry);
    }
  }

  /** Friendly coverage only; source order does not affect circle rasterization. */
  *sources(tick: number, friendly: ReadonlySet<number>) {
    for (const owner of friendly) {
      const entries = this.byOwner.get(owner);
      if (!entries) continue;
      for (const [, pos, radius, seen] of entries.values()) {
        if (tick - seen < SHIP_VISION_LINGER_TICKS) yield { pos, radius };
      }
    }
  }

  hasVision(
    tick: number,
    pos: number,
    friendly: (owner: number) => boolean,
  ): boolean {
    const x = pos % this.width,
      y = Math.floor(pos / this.width);
    const range = unitVisionRadius(UnitType.Submarine);
    const columns = this.columns;
    for (
      let cy = Math.max(0, Math.floor((y - range) / 64));
      cy <= Math.floor((y + range) / 64);
      cy++
    ) {
      for (
        let cx = Math.max(0, Math.floor((x - range) / 64));
        cx <= Math.min(columns - 1, Math.floor((x + range) / 64));
        cx++
      ) {
        const cell = this.cells.get(cy * columns + cx);
        if (!cell) continue;
        for (const [owner, trails] of cell) {
          let ownerFriendly: boolean | undefined;
          for (const {
            entry,
            x: tx,
            y: ty,
            radiusSquared,
          } of trails.values()) {
            if (tick - entry[3] >= SHIP_VISION_LINGER_TICKS) continue;
            ownerFriendly ??= friendly(owner);
            if (!ownerFriendly) break;
            if ((tx - x) ** 2 + (ty - y) ** 2 <= radiusSquared) return true;
          }
        }
      }
    }
    return false;
  }

  private index(key: string, entry: ShipVisionTrail): void {
    const [owner, pos, radius] = entry;
    let ownerEntries = this.byOwner.get(owner);
    if (!ownerEntries) this.byOwner.set(owner, (ownerEntries = new Map()));
    ownerEntries.set(key, entry);
    this.schedule(key, entry[3]);
    const cellID = this.cell(pos);
    let cell = this.cells.get(cellID);
    if (!cell) this.cells.set(cellID, (cell = new Map()));
    let trails = cell.get(owner);
    if (!trails) cell.set(owner, (trails = new Map()));
    trails.set(key, {
      entry,
      x: pos % this.width,
      y: Math.floor(pos / this.width),
      radiusSquared: radius * radius,
    });
  }

  snapshot(): ShipVisionTrail[] {
    return [...this.entries.values()].map((entry) => [...entry]);
  }

  restore(entries: ShipVisionTrail[]): void {
    this.entries.clear();
    this.cells.clear();
    this.byOwner.clear();
    this.expirations.clear();
    for (const source of entries) {
      const entry: ShipVisionTrail = [...source];
      const [owner, pos, radius] = entry;
      const key = `${owner}:${pos}:${radius}`;
      const previous = this.entries.get(key);
      if (previous) this.unschedule(key, previous[3]);
      this.entries.set(key, entry);
      this.index(key, entry);
    }
  }
}
