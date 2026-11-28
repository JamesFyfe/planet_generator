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

## 2026-11-28 — Phase 4 atmosphere, water, lighting

**Changed.** `PlanetParams` is version 3. The registry gained atmosphere density, scale height, thickness, Rayleigh coefficients, Mie strength, cloud density, coverage, axial tilt, and rotation period. Terrain sampling ignores those fields. The explorer chunk cache key is terrain-only, so those sliders do not rebuild meshes. Time scale is explorer state, not a planet parameter, and `timeSeconds` is passed into the renderer each frame.

The renderer draws stars, a directional sun, a Rayleigh/Mie shell, and a cloud shell. Water is a per-chunk attachment on the sea sphere so it shares the floating origin. The sun path through the atmosphere uses the Chapman air mass, which is what makes the horizon go orange instead of staying blue. Wave normals fade out once they are smaller than a pixel. Water has no skirt, because a skirt sized from the whole chunk edge showed up as a grid.

Screenshots at seed 1, default params except where noted: `docs/screenshots/phase-4/seed-1-orbit.png`, `seed-1-sunset-ground.png`, `seed-1-shore.png`, and `seed-1-airless-orbit.png` (density, cloud density, and coverage at 0).

**Unfinished.** No weather, biomes, or multiple scattering. Clouds are a noise shell, not a forecast. The sun is a direction on a fixed planet; the mesh does not spin.

**Known issues.** Chunk-edge normals are still one-sided, so a low sun can show faint seams on coarse terrain. Coastlines are still stair-stepped on the grid. The orbit view at the default pixel error stops around LOD 3, which is the same selection as before. A one-level water T-junction can leave a sub-meter crack; it is not covered by a skirt. Generation is still on the main thread.

**Next.** Phase 5 is macro geology. Do not start it from this branch.
