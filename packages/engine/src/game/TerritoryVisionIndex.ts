import type { GameMap, TileRef } from "@openfront/engine-api/game/GameMap";

const SIZE = 16;

/** Shared ownership counts, not cached visibility or diplomacy. */
export class TerritoryVisionIndex {
  private readonly columns: number;
  private readonly cells: (Map<number, number> | undefined)[];
  private readonly width: number;
  private readonly height: number;
  private readonly owners: Uint16Array;

  constructor(map: GameMap) {
    this.width = map.width();
    this.height = map.height();
    this.columns = Math.ceil(this.width / SIZE);
    this.cells = new Array(this.columns * Math.ceil(this.height / SIZE));
    this.owners = map.tileStateBuffer();
    for (let tile = 0; tile < this.owners.length; tile++) {
      const owner = this.owners[tile] & 0xfff;
      if (owner !== 0) this.changeOwner(tile, 0, owner);
    }
  }

  changeOwner(tile: TileRef, previous: number, next: number): void {
    if (previous === next) return;
    const cellID =
      Math.floor(Math.floor(tile / this.width) / SIZE) * this.columns +
      Math.floor((tile % this.width) / SIZE);
    let cell = this.cells[cellID];
    if (previous !== 0 && cell) {
      const count = (cell.get(previous) ?? 0) - 1;
      if (count <= 0) cell.delete(previous);
      else cell.set(previous, count);
    }
    if (next !== 0) {
      cell ??= this.cells[cellID] = new Map();
      cell.set(next, (cell.get(next) ?? 0) + 1);
    }
    if (cell?.size === 0) this.cells[cellID] = undefined;
  }

  hasVision(
    tile: TileRef,
    radius: number,
    friendly: (owner: number) => boolean,
  ): boolean {
    const cx = tile % this.width,
      cy = Math.floor(tile / this.width);
    const left = Math.max(0, cx - radius),
      right = Math.min(this.width - 1, cx + radius);
    const top = Math.max(0, cy - radius),
      bottom = Math.min(this.height - 1, cy + radius);
    for (
      let row = Math.floor(top / SIZE);
      row <= Math.floor(bottom / SIZE);
      row++
    ) {
      for (
        let col = Math.floor(left / SIZE);
        col <= Math.floor(right / SIZE);
        col++
      ) {
        const cell = this.cells[row * this.columns + col];
        if (!cell) continue;
        let relevant = false;
        for (const owner of cell.keys()) {
          if (friendly(owner)) {
            relevant = true;
            break;
          }
        }
        if (!relevant) continue;
        const x0 = Math.max(left, col * SIZE),
          x1 = Math.min(right, (col + 1) * SIZE - 1);
        const y0 = Math.max(top, row * SIZE),
          y1 = Math.min(bottom, (row + 1) * SIZE - 1);
        // Only inspect exact diamond/cell intersections; diagonal corners
        // of the bounding square must never grant additional vision.
        for (let y = y0; y <= y1; y++) {
          const dx = radius - Math.abs(y - cy);
          const end = Math.min(x1, cx + dx);
          for (let x = Math.max(x0, cx - dx); x <= end; x++) {
            const owner = this.owners[y * this.width + x] & 0xfff;
            if (owner !== 0 && friendly(owner)) return true;
          }
        }
      }
    }
    return false;
  }
}

const indexes = new WeakMap<GameMap, TerritoryVisionIndex>();

export function territoryVisionIndex(map: GameMap): TerritoryVisionIndex {
  let index = indexes.get(map);
  if (!index) {
    index = new TerritoryVisionIndex(map);
    indexes.set(map, index);
  }
  return index;
}

/** Unused games pay no allocation cost; the first fog query builds the index. */
export function updateTerritoryVisionOwner(
  map: GameMap,
  tile: TileRef,
  previous: number,
  next: number,
): void {
  indexes.get(map)?.changeOwner(tile, previous, next);
}
