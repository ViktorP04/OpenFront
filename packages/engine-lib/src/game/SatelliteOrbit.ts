export const SATELLITE_VISION = 160;
const wrap = (n: number, size: number) => ((n % size) + size) % size;

/** Fixed edge-to-edge track through the silo, in launch-direction order. */
function orbitTrack(
  width: number,
  height: number,
  x: number,
  y: number,
  dx: number,
  dy: number,
) {
  const scale = Math.max(Math.abs(dx), Math.abs(dy));
  if (scale === 0) throw new Error("Satellite orbit needs a direction");
  const vx = dx / scale,
    vy = dy / scale;
  const cx = x + 0.5,
    cy = y + 0.5;
  const bounds = (p: number, v: number, size: number) =>
    v === 0
      ? [-Infinity, Infinity]
      : [Math.min(-p / v, (size - p) / v), Math.max(-p / v, (size - p) / v)];
  const [x0, x1] = bounds(cx, vx, width);
  const [y0, y1] = bounds(cy, vy, height);
  return { cx, cy, vx, vy, start: Math.max(x0, y0), end: Math.min(x1, y1) };
}

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
  const { cx, cy, vx, vy, start, end } = orbitTrack(
    width,
    height,
    x,
    y,
    dx,
    dy,
  );
  const phase = start + wrap(ticks - start, end - start);
  return {
    x: Math.max(0, Math.min(width - 1, Math.floor(cx + phase * vx))),
    y: Math.max(0, Math.min(height - 1, Math.floor(cy + phase * vy))),
  };
}

/** Preview the permanent track; its end wraps directly back to its start. */
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
  if (dx === 0 && dy === 0) return [];
  const { cx, cy, vx, vy, start, end } = orbitTrack(
    width,
    height,
    sx,
    sy,
    dx,
    dy,
  );
  return [[cx + start * vx, cy + start * vy, cx + end * vx, cy + end * vy]];
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
