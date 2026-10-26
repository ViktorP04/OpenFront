import { ShipVisionTrails } from "@openfront/engine-lib/game/ShipVisionTrails";
import { CoarseFogOfWar } from "../../../src/client/view/CoarseFogOfWar";
/** Identical synthetic Giant-sized inputs; measures fog computation only. */
import { FogOfWar } from "../../../src/client/view/FogOfWar";

const width = 4108,
  height = 1948;
const friendly = new Set([1]);
for (const scale of [1, 2, 4, 8])
  for (const trailsEnabled of [true, false]) {
    const owners = new Uint16Array(width * height).fill(2);
    for (let y = 300; y < 700; y++)
      owners.fill(1, y * width + 100, y * width + 600);
    const fog =
      scale === 1
        ? new FogOfWar(width, height)
        : new CoarseFogOfWar(width, height, scale);
    const trails = new ShipVisionTrails(width);
    const times: number[] = [];
    for (let tick = 0; tick < 180; tick++) {
      const sources = Array.from({ length: 25 }, (_, ship) => ({
        owner: 1,
        pos: (800 + ship * 20) * width + 100 + ship * 100 + tick,
        radius: ship % 3 === 0 ? 10 : 35,
      }));
      if (trailsEnabled) trails.record(tick, sources);
      const changed = new Set<number>();
      for (let i = 0; i < 20; i++) {
        const tile = (300 + i * 3) * width + 599 + (tick % 8);
        owners[tile] = tick % 2 === 0 ? 1 : 2;
        changed.add(tile);
      }
      const start = performance.now();
      fog.update(owners, friendly, sources, tick === 0 ? undefined : changed);
      if (trailsEnabled) fog.addSources(trails.sources(tick, friendly));
      // Include source-removal invalidation; rendering pixel masking is excluded.
      void fog.dirtyChunks.size;
      if (tick >= 100) times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    console.log(
      JSON.stringify({
        scale,
        trails: trailsEnabled,
        cells: fog.visible.length,
        meanMs: times.reduce((a, b) => a + b, 0) / times.length,
        p95Ms: times[Math.floor(times.length * 0.95)],
      }),
    );
  }
