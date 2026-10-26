# Fog of war performance options

Single-player and host lobby settings show two extra controls when fog of war
is enabled. These are shared game rules, saved with the game configuration and
used by both players and AI. They do not disable XP or achievements.

- **Fog resolution:** Full (1×1, the default), Medium (2×2), Low (4×4), or
  Very low (8×8). Each block shares visibility. Map terrain and units retain
  their original resolution, but visibility boundaries become less precise.
  A 4×4 block uses roughly sixteen times fewer fog cells than full resolution.
- **Ship visibility trails:** Enabled by default. When disabled, ships still
  reveal their current surroundings, but their past positions no longer leave
  ten seconds of lingering visibility. History recording and queries are skipped.
  This controls visibility history, rather than decorative ship wakes.

For Giant World, try 4×4 with trails disabled first. Choose smaller blocks or
enable trails again if the performance and gameplay tradeoff suits your device.
These options reduce fog work; simulation, map rendering, and other gameplay
still have costs, so an older laptop needs a real multiplayer test.

## Visibility rules

Friendly territory reveals its block and nearby blocks using a Manhattan radius.
Unit and history circles use block coordinates and round their radius down to
whole blocks. Satellites wrap around the coarse grid. Ownership changes and
alliances update affected blocks incrementally. Transport targeting and AI use
the same coarse visibility rules as the client mask.

Old configurations retain full-resolution fog and enabled visibility trails.
The options are selected before the match, rather than changed during a game.

## Isolated benchmark

The synthetic benchmark uses identical 4108×1948 inputs, 25 moving ships,
territory changes, and 180 ticks. Means below cover the last 80 ticks and include
fog updates and applying visibility history. They exclude history recording,
rendering, simulation, networking, and initial allocation. These are local CPU
measurements, not whole-game frame rates or predictions for another device.

| Fog block | Fog cells | Trails on, mean | Trails off, mean |
| --------- | --------: | --------------: | ---------------: |
| 1×1       | 8,002,384 |         4.29 ms |         0.217 ms |
| 2×2       | 2,000,596 |         1.40 ms |         0.095 ms |
| 4×4       |   500,149 |         1.09 ms |         0.081 ms |
| 8×8       |   125,416 |         0.46 ms |         0.042 ms |

Reproduce with Node 24:

```powershell
node --import tsx tests/perf/client/FogResolutionPerf.ts
node --import tsx tests/perf/client/ClientUpdatePerf.ts --map giantworldmap --ticks 1800 --fog --fog-scale 4 --no-fog-trails --no-cpu-profile
```

Full-game runs with different visibility settings can produce different AI
decisions and hashes. Client/engine agreement is checked separately at all
coarse scales, including partial edge blocks, alliances, captures, history,
satellites, and snapshot restoration.
