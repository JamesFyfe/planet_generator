# Progress

## 2026-11-27 — Phase 0 scaffold

**Changed.** pnpm workspace with `packages/engine`, `packages/renderer`, and `apps/explorer`. Strict TypeScript, ESLint, Prettier, and Vitest in every package. Root scripts `dev`, `build`, `test`, `lint`, `typecheck`, and `check`. GitHub Actions runs `pnpm check` on pull requests.

Engine: mulberry32 PRNG, seeded 3D simplex, fBm, ridged multifractal, billow, domain warp, and Worley. All take a seed. Tests cover determinism, ranges, and seed changes. Parameter registry has `seed`, `radius` (meters, 5 km–500 km, default 50 km), and `noiseScale`. `PlanetParams.version` is 1.

Explorer: Vite + React + R3F unit sphere, orbit controls, zustand store, leva panel generated from the registry, and a readout of the store. The engine is imported from source. The renderer package is reserved and not imported yet. No `vercel.json`.

**Unfinished.** No terrain, LOD, chunks, workers, atmosphere, or renderer meshes. `noiseScale` is stored and not sampled. `Planet`, chunk request/response, and the feature-layer interface are intentionally undefined.

**Known issues.** The placeholder mesh is unit-sized so orbit controls have a stable target; radius is not applied to geometry yet. Simplex permutations are cached for the process lifetime; results do not depend on call order. Vercel still needs the dashboard checkbox that includes source files outside `apps/explorer`. The production JS chunk is about 1.3 MB (about 386 KB gzip) because three.js ships in the first load. drei logs a `THREE.Clock` deprecation warning from three r187; it does not affect the placeholder.

**Next.** Phase 1: single-resolution cube-sphere displaced by layered noise, sea level, height-based color, flat normals, and a debug-view channel switch.

## 2026-11-27 — Phase 0 review fixes

**Changed.** Worley grows its search shell until the second-nearest feature point cannot lie farther out. A fixed 3×3×3 reported a too-large `f2` on some samples. The simplex seed test now checks negative and non-finite seeds against `normalizeSeed`. Leva number boxes are wide enough for a 7-digit seed and a 6-digit radius in meters, and the panel is wide enough for the "Noise scale" label. CI runs `pnpm build` after `pnpm check`.

**Unfinished.** Same as the scaffold note. Radius stays in meters on the slider; the number box is wider so 500000 fits.

**Known issues.** Unchanged, apart from the Worley neighborhood and the clipped slider text, which are fixed.

**Next.** Phase 1, as above.

## 2026-11-27 — Phase 1 sphere and noise displacement

**Changed.** `PlanetParams` is version 2. The registry now includes `octaves`, `amplitude` (meters), and `seaLevel` (meters), beside the existing `noiseScale`. `createPlanet(params).sample(dir)` returns height and sea-relative height from fBm at the unit-sphere direction. Amplitude is applied once inside `sample`.

`buildPlanetMesh` builds one spherified cube (`PLANET_MESH_SEGMENTS` = 128) as typed arrays: positions, finite-difference normals, channel colors, and indices. Positions are planet-centered and divided by radius (`1 + height / radius`) so the buffer stays near unit length. The explorer orbits that mesh. Debug channels are `terrain`, `height`, and `slope`; the dropdown is generated from `DEBUG_CHANNEL_REGISTRY`. Terrain is lit; the data channels are unlit.

Screenshots, default settings except the seed: `docs/screenshots/phase-1/seed-1-terrain.png`, `seed-42-terrain.png`, `seed-1-height.png`, `seed-1-slope.png`.

Merged `d36bc5a` (Worley shell search, leva number-box width, CI `pnpm build`). The height field does not call Worley, so samples are unchanged. `App.tsx` keeps that panel theme so the new sliders do not clip seed or radius again.

**Unfinished.** No chunks, LOD, workers, floating origin, biomes, or `buildChunk`. Generation still runs on the main thread. The whole planet is one mesh.

**Known issues.** A full rebuild is about 200 ms, so slider drags are debounced by 80 ms and the mesh updates when the drag pauses. At high noise scale the grid is coarser than the noise, and cube-face edges show up as aliasing rather than a crack in `sample`. Coastlines are stair-stepped at this resolution. Amplitude can exceed radius at the slider extremes and pull the surface through the center. The shore band is a small fraction of radius and amplitude so it reads from orbit; it is not a physical beach width. The checked-in screenshots were taken before the panel theme merge, so their radius box still shows four digits. drei still logs the `THREE.Clock` deprecation from three r187.

**Next.** Phase 2: quadtree chunks, worker generation, skirts, and a floating origin with chunk-local positions.

## 2026-11-27 — Phase 2 chunk quadtree and LOD (main thread)

**Changed.** Each cube face is a quadtree. `Planet.buildChunk({ face, lod, x, y })` returns chunk-local positions, grid normals, height, sea-relative height, slope, indices, a float64 origin, and a bounding radius. The grid is `CHUNK_GRID_SIZE` (33). Edges grow a skirt so a one-level LOD gap does not crack. `selectChunks` splits the worst screen-space error first, leaves chunks outside the view cone coarse, keeps edge neighbors within one LOD, and does not import three.js. The renderer adds and removes meshes through `ChunkMeshSource` (payload or promise). The explorer implementation is synchronous. The camera stays at the scene origin and each mesh is placed at `origin - camera`. Frustum and horizon culling hide the rest. The overlay shows chunk count, visible count, last and average generation time, and max LOD. Debug channel `lod` colors chunks by level. The single-resolution mesh helper is unchanged and is no longer what the explorer draws.

Screenshots at seed 1, default params. Distances are from the planet center: orbit 160 km (`seed-1-orbit-terrain.png`), approach 80 km (`seed-1-approach-terrain.png`), about 6 km above the surface (`seed-1-low-terrain.png` and `seed-1-low-height.png`), and 110 km for the LOD rings (`seed-1-low-lod.png`). Files are in `docs/screenshots/phase-2/`.

**Unfinished.** No worker pool, LRU, or cancellation. Generation still runs on the main thread, 32 new meshes per frame once the first shell exists. Vertex morphing between LODs is not implemented. `selectChunks` measures distance to the sphere of `radius`, so a tall mountain is tessellated as if the camera were that peak's height above the mean sphere. The perf flight script is not in this half.

**Known issues.** A fast zoom builds the new leaves over later frames, so the horizon can be coarse until the budget catches up. The selection cap is 2048 leaves before the LOD-gap pass. Coastlines are still stair-stepped because the shore is a vertex-color band on the grid. Skirt depth is a bound, not a measured crack. Shared materials mean a lit and an unlit chunk cannot coexist; the cache key includes the debug channel, so a channel change rebuilds. drei is unused after orbit controls moved into the scene. `THREE.Clock` deprecation from drei is gone with that import.

**Next.** Move `createPlanetChunkSource` behind a worker pool without changing the mesh manager. Add the scripted flight perf log after that, since the 16 ms stall budget depends on generation leaving the main thread.

## 2026-11-27 — Orbit drag direction and pole roll

**Changed.** Pointer drag follows the surface. A right drag increases theta and a down drag decreases phi, which is the direction that matches a camera fixed at the scene origin looking back at the planet. Screen-up is world +Y projected onto the view plane at every latitude. It used to switch to world +X once the view was within about 26° of a pole, and that swap rolled the camera by roughly a right angle in one frame.

**Unfinished.** Same as the phase 2 note. Chunk-edge normals are still one-sided grid differences, so lit seams of several degrees remain on coarse boundaries.

**Known issues.** The orbit stops 0.05 rad short of either pole so the up projection does not vanish. Crossing that clamp ends the pitch instead of tumbling over the pole.

**Next.** Unchanged.

## 2026-11-28 — Phase 5 macro geology

**Changed.** `PlanetParams` is version 3. The registry gained a Tectonics group: plate count, continental fraction, tectonic activity, mountain height, rift depth, boundary warp, and hotspot count. `createGlobalBake` fills a 512×512 cubemap per cube face once per parameter set. The explorer debounces edits by 80 ms, bakes in `bake.worker.ts`, and adopts the buffers before `createPlanet`. Chunks bilinear-sample that bake. Scalar channels wrap across cube edges; plate id, boundary kind, and crust stay nearest-texel.

Plates are a domain-warped spherical Voronoi diagram. Each has an id, an Euler pole and rate, and continental or oceanic crust. Continental plates grow from a few shuffled kernels, and each grown plate is steered into its parent so that shared boundary is a collision. Boundary kind comes from relative motion: collision, subduction, rift, ridge, or transform. Height is the crust shelf plus that relief. The existing fBm stays as detail on top. Hotspots are seeded points other phases can query; they do not move height.

Debug channels: plates, boundaries, uplift, crust, hotspots. Screenshots at seeds 1, 42, and 7: `docs/screenshots/phase-5/seed-1-plate.png`, `seed-1-boundary.png`, `seed-1-height.png`, and the same three views for seeds 42 and 7.

**Unfinished.** No climate, biomes, rivers, or feature layers. Hotspots do not affect height. Chunk generation is still on the main thread; only the bake is in a worker. There is no chunk worker pool.

**Known issues.** A 512 bake takes about 1.2 s, so a tectonic slider pauses the new planet until the worker finishes. The previous planet stays on screen. The cache holds four bakes, about 42 MB each. Coarse collision ridges can lean past 80° and still face outward. Relief is in meters, so the same mountains are subtle on a large planet and huge on a small one.

**Next.** Phase 6 climate, or move chunk generation into a worker pool. The 16 ms chunk budget is already met on the main thread (about 2–4 ms per chunk after the bake is cached).
