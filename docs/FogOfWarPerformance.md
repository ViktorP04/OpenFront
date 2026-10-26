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


## Second pass: 2026-10-26

The second pass compares commit `81f5188b3` against the new changes, using the
same World/default bots/Medium seed and profiler for 1,800 game ticks after
spawn (three minutes of simulated play). Both runs end at tick 2002 with 78
living players and 289 units in the client mirror. The longer run exposed
railroad construction and transport/nuke trail changes absent from the original
600-tick scenario.

Changes:

- AI territory queries share a lazily built 16 x 16 spatial ownership index.
  Cells without a friendly owner skip individual tile scans. Intersecting
  cells still use the exact twenty-tile Manhattan diamond. The index holds
  ownership counts, not visibility or alliance results, and updates on conquest,
  relinquishment, direct owner assignment, and packed tile updates. No index
  data enters snapshots or simulation hashes; restored games build it on demand.
- Trail and railroad caches report exact changed tile refs. The fog renderer
  no longer scans a whole trail row band or railroad texture for a few edits.
  Pending refs accumulate across skipped frames, including removals.
- Unchanged vision circles no longer invalidate render chunks every tick.
  Duplicate circles are rasterized once per update. Added, removed, moved,
  upgraded, wrapped, and expired sources still invalidate their coverage.

| Measurement (ms/tick) | Before second pass | After second pass |
| --- | ---: | ---: |
| Main-thread burst, mean | 5.21 | 2.02 |
| Main-thread burst, p95 | 10.4 | 3.73 |
| Main-thread burst, p99 | 14.0 | 5.08 |
| Main-thread burst, maximum | 38.9 | 6.36 |
| Main-thread bursts over 16.7 ms | 5 / 1,800 | 0 / 1,800 |
| Simulation, mean | 14.8 | 9.97 |
| Simulation, p99 | 212 | 82.2 |
| Simulation, maximum | 388 | 249 |

This is about 61% less average main-thread work and 33% less average simulation
work relative to the first pass, on this machine. Final simulation hashes match
(`27626989507481190` at tick 2000), as do final view hashes (`1b91d210`) and update
payload totals. The profiler was enabled in both runs; timings vary with host
load. Browser/GPU/DOM limitations described above still apply. This is a longer
natural match, not an endgame stress test with hundreds of satellites or ships.

Reproduce with the command above and `--ticks 1800`. Regression tests include
3,000 indexed queries compared against brute-force visibility through randomized
ownership and diplomacy changes, immediate same-tick ownership/alliance updates,
stationary/duplicate circles, and sparse rail/trail additions and removals across
skipped frames.

Some worst-case simulation ticks still exceed 100 ms. The next useful targets
are ship-trail point queries and AI naval planning, guided by a fresh profile
of the affected match. Actual browser traces remain necessary to diagnose GPU,
HUD, network, and device-specific pauses.


## Third pass: ship trails and naval planning (2026-10-26)

The baseline is commit `11d71a48b`. Initial profiling identified ship-trail point
queries as a major remaining cost under AI boat-route planning. A planner checks
all candidate shore tiles; previously each point rebuilt diplomacy lookup state
and fetched satellite/radar lists again. Each trail point query also resolved
friendliness for individual samples and recomputed their coordinates.

Changes:

- Each spatial trail cell groups samples by owner. Negative diplomacy checks skip
  an entire owner's samples. Coordinates and squared radius are computed when a
  sample enters the index, rather than at every point query. Refreshes retain the
  same indexed entry, and expiry removes empty owner groups/cells.
- A batch query context shares diplomacy lookups and lazily fetched radar/satellite
  lists during one synchronous, read-only planning operation. Candidate shores,
  random boat destinations, scout destinations, and hostile-warship filtering use
  these contexts. They are discarded before returning to simulation actions;
  independent point queries still create fresh contexts, so same-tick captures
  and alliance changes remain immediate.
- Candidate order, random draws, search limits, routes, and visibility rules are
  unchanged. Cached trail indexing does not alter snapshot contents/order.
- The performance harness now prints simulation functions as well as client
  functions, making future naval profiles easier to inspect.

Regression coverage compares mixed-owner trail queries against brute-force checks
through expiry, refresh, restore, and changing friendly owners. It also checks
that a dense owner group resolves diplomacy once and expired samples do not
resolve diplomacy. Batched queries match the client mask and independent queries;
existing AI scouting, combat, targeting, and snapshot tests continue to apply.

Use the 1,800-tick World command from the second pass to reproduce. The comparison
runs are sequential with V8 sampling enabled. Overall wall timings vary with host
load; they measure this CPU harness, not browser frame rate or network performance.


Latest paired profile (same 1,800 ticks, default World/400 bots/Medium):

| Sampled CPU time across run | Baseline | Optimized |
| --- | ---: | ---: |
| Ship-trail `hasVision`, self time | 1,401 ms | 345 ms |
| `planBoatRoute`, inclusive time | 3,597 ms | 2,360 ms |
| `findRandomBoatTarget`, inclusive time | 245 ms | 230 ms |

Inclusive planning time includes its visibility checks; these numbers must not
be added together. The targeted samples show approximately 75% less trail-query
self time and 34% less total boat-route planning time in this pair. These are
V8 sampling estimates, not instrumented exact timings.

Both versions finish with simulation hash `27626989507481190` at tick 2000,
view hash `1b91d210`, 78 living players, and 289 mirrored units. Payload counts
also match. Repeated optimized runs produced simulation averages of 6.01–12.9 ms
per tick; baseline repeats ranged from 8.34–14.8 ms. In the latest pair the overall
simulation mean rose from 8.34 to 12.9 ms even though the targeted CPU samples
fell, and the unchanged main-thread path rose from 1.78 to 3.22 ms. This variability
prevents a reliable whole-match speedup claim. Actual device/browser traces and
more controlled timing are still needed; no FPS improvement is claimed.

The ship-trail cost is reduced rather than eliminated. Very dense friendly trails
still require exact circle tests, and Hard/Impossible naval pathfinding can remain
expensive. This pass does not change how often the AI plans, reduce candidate
counts, or grant it information hidden by fog.


Giant World was subsequently profiled separately, including real GPU uploads and
a ten-minute match: see [Giant World performance](GiantWorldPerformance.md).
