# Fog of war performance inspection

Measured on 2026-10-25 using World (2000 x 1000), 400 bots, default nations,
Medium difficulty, seed `perf-default`. The run observes the same living faction
for 600 simulation ticks after the 202-tick spawn phase. Both versions used the
same updated harness with V8 CPU sampling enabled, run sequentially on this machine.

## Findings and changes

- Rebuilding territory visibility and preparing masked render buffers dominated
  client CPU time. Before optimization, their sampled self times were 4.71 and
  8.11 seconds respectively across this run. Territory vision now caches ownership
  and updates affected 64 x 64 chunks with a twenty-tile halo. An alliance change
  still triggers a complete rebuild. Mobile, radar, satellite, and historical ship
  coverage is layered over territory with the same visibility rules.
- Masked render buffers now update only changed tiles and visibility chunks.
  Pending changes survive skipped rendering and intermediate input vision queries.
- Fog previously requested full trail and railroad uploads every tick, even when
  empty. These now upload only when masked values actually change. Visible
  structure membership changes invalidate structure graphics as needed.
- AI point queries repeatedly resolved the same owners and diplomacy while scanning
  up to 841 nearby tiles. They now read packed ownership and resolve each encountered
  owner's relationship once per query. No relationship or visibility result is
  cached across simulation actions, so captures and alliance changes remain immediate.
- The performance harness previously ran as a spectator, bypassing fog entirely.
  `--fog` now observes a faction with fog enabled; `--observe` does the same without
  fog. The GL stub was updated, texture upload counters added, and Windows CPU
  profile paths fixed so client functions appear in the report.

## Before and after

All times are milliseconds per tick. Renderer dispatch includes lazy fog evaluation.

| Measurement | Before | After |
| --- | ---: | ---: |
| Main-thread burst, mean | 24.6 | 3.73 |
| Main-thread burst, p95 | 31.0 | 7.85 |
| Main-thread burst, maximum | 36.9 | 11.9 |
| Main-thread bursts over 16.7 ms | 570 / 600 | 0 / 600 |
| Simulation, mean | 23.6 | 16.9 |
| Simulation, p99 | 462 | 228 |
| Simulation, maximum | 556 | 290 |
| Trail rows submitted, whole run | 600,000 | 0 |
| Railroad bytes submitted, whole run | 1,202,000,000 | 2,000,000 |

The observed faction had no visible transport/nuke trails or railroads in this
run. The after result includes the initial railroad texture upload; it does not
imply uploads are eliminated when visible trails or railroads change. Previously,
full trail and railroad textures alone submitted about 60 MB/s on World at 10 Hz.

Simulation hash is `26058660181223980` at tick 800 before and after. The final view
hash is `ae5d6bd3` in both runs. Identical tile/unit/player update totals also
confirm the same workload. Regression tests compare incremental vision with full
rebuilds and cover coverage loss/restoration, skipped frames, and alliance changes.

## Reproduce and remaining work

Using Node 24 with installed dependencies:

```powershell
node --import tsx tests/perf/client/ClientUpdatePerf.ts --map world --ticks 600 --bots 400 --fog --top 20
node --import tsx tests/perf/client/ClientUpdatePerf.ts --map world --ticks 600 --bots 400 --observe --top 20
```

The harness writes a CPU profile under `tests/perf/output/`. Open it in Chrome
DevTools. This measures actual simulation, cloning, view updates, and render
upload dispatch. It uses a no-op WebGL target: GPU execution, instance-buffer
construction inside the GL renderer, DOM/HUD work, network latency, and actual
frame rate on the friend's device are not measured. Upload counts describe
submitted data, not measured GPU transfer time. Peak heap varied between runs;
this change is not claimed to reduce memory usage.

The remaining worst simulation ticks still exceed the 100 ms budget for a 10 Hz
simulation. AI visibility queries remain a significant simulation cost. A next step
is a spatial ownership index that rejects empty territory regions cheaply, with
invalidation for ownership and alliance changes. Client work can also grow with
many overlapping ship trails/radars; this early-match scenario ends with only
16 units in the mirrored view. Profile a late naval match and capture a browser
Performance trace on the affected device before choosing further optimizations.
