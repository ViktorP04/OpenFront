# Giant World fog performance

Inspection date: 2026-10-26. Baseline: `db4b03d53`.

Giant World is 4108 x 1948 (8,002,384 tiles), four times the area of normal
World. The earlier optimization passes did not exercise this map or actual GPU
uploads. This pass targets both simulation delays and rendering stalls.

## Changes

- Fog restores only regions covered by last tick's unit/trail circles and changed
  territory instead of copying the entire eight-million-byte visibility buffer
  every tick. A full initial build still happens when entering fog.
- A conservative owner-to-chunk index limits alliance changes to relevant
  territory regions plus their vision halo. This avoids full-map visibility and
  masked-frame rebuilds on ordinary alliance changes. New ownership is indexed
  immediately; historical owner entries can cause extra work but cannot reveal
  hidden tiles. One-shot change iterators remain supported.
- Long AI shore filters switch from repeated multi-type global unit-grid probes
  to a short list of friendly vision circles after eight local probes. Dense
  fleets/alliance groups retain the spatial grid. Contexts remain confined to
  synchronous read-only planning; independent queries keep immediate semantics.
- Trail expiry uses scheduled tick buckets instead of scanning all global
  history each tick. An owner index lets the client retrieve friendly history
  directly. Snapshot entry order, refresh behavior, and expiry rules are preserved.
  Additional indexes trade some memory for substantially less repeated work.
- Exact trail and railroad tile changes now reach the actual GPU passes. Small
  edits use the existing integer-texture scatter shader rather than uploading
  an entire railroad texture or a map-wide trail row band. This also works
  without fog. Values are read at render time, so multiple queued updates,
  removals, and hide/reveal changes cannot replay stale information.
- Full uploads supersede queued changes and remain available for initialization,
  spectator transitions, seeks/replay producers, and dense updates. Sparse uploads
  flush before screen rendering, where framebuffer/viewport/blend state is reset.

The large textures previously cost up to 8 MB (railroads) plus 16 MB (trails)
per tick, or approximately 240 MB/s at 10 Hz, even for sparse edits spread across
the map. The issue is the browser/driver transfer and synchronization path,
not simply the GPU's advertised memory bandwidth.

## CPU comparison

This first comparison measures the region/cache and sparse-upload plumbing changes,
before the additional trail-history change measured in the long run below.

Same Giant World, Normal size, 400 bots, default nations (507 starting players),
Medium, `perf-default`, 1,800 ticks after the 202-tick spawn phase. The observer
remains alive. V8 CPU sampling enabled in both runs.

| Milliseconds per tick | Before | After |
| --- | ---: | ---: |
| Main-thread work, mean | 8.78 | 3.43 |
| Main-thread work, p95 | 15.1 | 6.82 |
| Main-thread work, p99 | 17.9 | 9.58 |
| Main-thread work, maximum | 56.8 | 20.3 |
| Main-thread bursts over 16.7 ms | 35 / 1,800 | 3 / 1,800 |
| Simulation, mean | 32.3 | 18.3 |
| Simulation, p95 | 121 | 56.0 |
| Simulation, p99 | 210 | 92.5 |
| Simulation, maximum | 251 | 169 |

Simulation hashes match: `55905413967497040` at tick 2000. View hashes match:
`1fc7a658`. Both finish at tick 2002 with 214 living players, 256 mirrored units,
and identical update payload totals. Host load affects wall timings, so these
numbers describe this comparison, not guaranteed speedups on another computer.
The CPU harness uses a no-op GL target and does not measure actual frame rate.

## Ten-minute match and trail-history follow-up

A 6,000-tick run exposed the global-history maintenance cost as fleets grew.
Compare the build with the region/GPU improvements against the same build plus
scheduled trail expiry and owner-indexed friendly source retrieval. These two
runs have CPU profiling disabled and follow a living faction after elimination.
They end with 53 living players and 1,341 units in the mirrored simulation.

| Milliseconds per tick | Before trail-history change | After |
| --- | ---: | ---: |
| GameView update, mean | 7.72 | 3.36 |
| Renderer dispatch, mean | 5.65 | 1.72 |
| Total main-thread work, mean | 13.9 | 5.46 |
| Total main-thread work, p95 | 34.1 | 12.5 |
| Total main-thread work, p99 | 42.0 | 18.5 |
| Total main-thread work, maximum | 62.6 | 48.2 |
| Main-thread bursts over 16.7 ms | 2,277 / 6,000 | 96 / 6,000 |
| Simulation, mean | 27.3 | 21.1 |
| Simulation, p95 | 77.8 | 56.6 |
| Simulation, p99 | 121 | 119 |
| Simulation, maximum | 304 | 220 |
| Peak Node heap | 427 MB | 459 MB |

Both runs complete at tick 6202 with simulation hash `48292840029490580` at tick
6200, view hash `462f9f3c`, the same final living observer, and identical update
payload totals. The optimized run completed 600 seconds of simulated play in
about 160 seconds of harness wall time. This is not a real-time multiplayer
or browser FPS test. The heap figure excludes typed-array backing stores and GPU
textures; the new indexes are not claimed to reduce memory usage.

The mean client cost fell roughly 61% in this long-run comparison. Some client
bursts still exceed a 60 Hz frame budget and some simulation ticks exceed the
100 ms budget for 10 Hz, so occasional pauses remain possible, particularly on
slower CPUs. The natural scenario covers growing fleets, not every possible
endgame or hardware configuration.

## Real WebGL check

Chrome with ANGLE/D3D11 on the local NVIDIA RTX 4080 SUPER. Actual R8UI and R16UI
textures at Giant World dimensions, the production scatter shader, 30 updates
per mode, four changed pixels spread across the map. Each iteration calls
`gl.finish()` to include completed GPU work. This is an isolated sparse-update
stress case, not a whole-game FPS benchmark.

| Texture | Full upload/update | Sparse update | Full bytes | Sparse point-buffer bytes |
| --- | ---: | ---: | ---: | ---: |
| R8UI railroad | 9.52 ms | 0.10 ms | 8,002,384 | 48 |
| R16UI trail | 22.64 ms | 0.04 ms | 16,004,768 | 48 |

Integer framebuffer completeness, pixel readback at distant map edges, unchanged
pixels, queued clear-after-reveal, and WebGL errors were checked for both formats.
The checks passed with no WebGL errors. Real matches change more than four pixels;
scatter cost scales with the number of changed pixels and dense updates fall
back to full uploads. Initial textures still require full uploads.

## Reproduce

With Node 24 and installed dependencies:

```powershell
node --import tsx tests/perf/client/ClientUpdatePerf.ts --map giantworldmap --ticks 1800 --bots 400 --fog --top 20
node --import tsx tests/perf/client/ClientUpdatePerf.ts --map giantworldmap --ticks 6000 --bots 400 --fog --follow-living --no-cpu-profile
```

`--follow-living` selects another living faction when the observer is eliminated,
so a long run does not silently become a spectator benchmark with fog bypassed.
The harness prints the final observed faction and estimates submitted texture
bytes. Estimates do not include every driver operation or GPU completion time.

For the real WebGL check, start `npm run start:client`, open the local page,
and run this in its browser console:

```javascript
await import("/tests/perf/client/GiantTexturePerf.ts")
```

The result is appended to the page and available as `window.giantTextureResult`.
The check does not change gameplay or saved settings.

## Limits

An older laptop's CPU, GPU, memory, display resolution, and browser still need
an actual multiplayer test. The deterministic simulation still runs on each
client. This pass does not reduce the bot count, change fog visibility or AI
choices, remove gameplay features, or establish a minimum hardware specification.
Some simulation spikes remain; a high-end benchmark cannot guarantee that every
older laptop will sustain the game. A long natural match also differs from an
adversarial endgame with hundreds of satellites and simultaneous nuclear strikes.
