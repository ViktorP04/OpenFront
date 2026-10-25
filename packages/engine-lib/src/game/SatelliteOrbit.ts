export const SATELLITE_VISION = 160;
const wrap = (n: number, size: number) => ((n % size) + size) % size;

/** One tile along the dominant axis per simulation tick; exact integer inputs. */
export function satellitePosition(
  width: number,
  height: number,
  x: number,
  y: number,
  dx: number,
  dy: number,
  ticks: number,
) {
  const scale = Math.max(Math.abs(dx), Math.abs(dy));
  if (scale === 0) throw new Error("Satellite orbit needs a direction");
  return {
    x: wrap(x + Math.floor((ticks * dx) / scale), width),
    y: wrap(y + Math.floor((ticks * dy) / scale), height),
  };
}

/** Preview one dominant-axis circuit, splitting lines at map seams. */
export function satelliteOrbitSegments(
  width: number,
  height: number,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): number[][] {
  const dx = tx - sx,
    dy = ty - sy;
  const scale = Math.max(Math.abs(dx), Math.abs(dy));
  if (scale === 0) return [];
  const vx = dx / scale,
    vy = dy / scale;
  let remaining = Math.abs(dx) >= Math.abs(dy) ? width : height;
  let x = sx + 0.5,
    y = sy + 0.5;
  const lines: number[][] = [];
  const maxSegments =
    Math.ceil((Math.abs(vx) * remaining) / width) +
    Math.ceil((Math.abs(vy) * remaining) / height) +
    3;
  for (let i = 0; i < maxSegments && remaining > 0.000001; i++) {
    const ex = vx > 0 ? (width - x) / vx : vx < 0 ? -x / vx : Infinity;
    const ey = vy > 0 ? (height - y) / vy : vy < 0 ? -y / vy : Infinity;
    const step = Math.min(remaining, ex, ey);
    const nx = x + vx * step,
      ny = y + vy * step;
    lines.push([x, y, nx, ny]);
    remaining -= step;
    x = ex <= step + 0.000001 ? (vx > 0 ? 0 : width) : nx;
    y = ey <= step + 0.000001 ? (vy > 0 ? 0 : height) : ny;
  }
  return lines;
}

export function satelliteDistanceSquared(
  width: number,
  height: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = Math.min(Math.abs(ax - bx), width - Math.abs(ax - bx));
  const dy = Math.min(Math.abs(ay - by), height - Math.abs(ay - by));
  return dx * dx + dy * dy;
}
