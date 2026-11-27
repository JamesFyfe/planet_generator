# Planet Engine: Build Plan

A web-based procedural planet and moon generator with an explorer app on top. The engine is the product: it must be reusable by later games, sims and tools.

## 1. Goals

- Generate somewhat realistic, explorable 3D planets and moons from a seed plus a set of parameters.
- Seamless scale: view from orbit, descend, and walk on the surface, with continuous LOD.
- Realism comes from layered simulation (plates, climate, hydrology), not just raw noise.
- Everything is customizable through sliders; worlds are shareable via seed and settings.

## 2. Non-goals (do not build)

- Geology time-lapse or plate-motion animation over time
- Photo mode
- Names or labels for features
- Caves or volumetric terrain (heightfield only)
- Multiplayer, accounts, backend

## 3. Stack

- TypeScript everywhere, strict mode
- pnpm workspaces monorepo
- Vite, React, three, @react-three/fiber, @react-three/drei
- leva (slider panel), zustand (UI state)
- Comlink + Web Workers for generation
- Rapier (or custom raycast physics against the height function) for walking
- vitest for tests, Playwright for screenshot and perf checks
- WebGL2 baseline. WebGPU/compute is an optional later optimization, not a dependency.

## 4. Repository layout

```
packages/
  engine/      Pure TypeScript. No React, no three. Noise, fields, climate, features, chunk generation. Runs in workers and Node.
  renderer/    three.js specific: chunk meshes, materials, shaders, atmosphere, water. No React.
apps/
  explorer/    Vite + React + R3F app: scene, UI, controls, presets.
docs/
  ARCHITECTURE.md   Contracts and decisions (kept current)
  PROGRESS.md       Short handoff notes appended after every task
```

Rule: `engine` must never import from `renderer` or `apps`. `renderer` may import from `engine` types only.

## 5. Core contracts (define in Phase 0-2, then treat as stable)

1. **Determinism.** Every output is a pure function of `(params, seed, input)`. No `Math.random`, no wall-clock time. Use a seeded PRNG. A test must assert identical output for identical inputs.
2. **PlanetParams.** A typed, serializable, versioned object. Each parameter has metadata (label, min, max, default, step, group) in one registry; the UI sliders are generated from that registry, never hand-written per slider.
3. **Planet object.** `createPlanet(params) -> Planet` exposing:
   - `sample(dir: Vec3): Sample` where `Sample` has height, temperature, moisture, biomeId, slope inputs, rock/material, water depth, etc.
   - `buildChunk(request): ChunkData` returning typed arrays (positions, normals, per-vertex attributes). Chunk request is `{face, lod, x, y}`.
4. **Two-level data model.**
   - *Global bake*: when params change, bake a coarse cubemap of global fields once (plates, macro height, temperature, moisture, flow and rivers, lakes, ice). Debounce and run in a worker.
   - *Local detail*: chunk generation reads the global bake and adds detail noise and nearby feature stamps.
5. **Feature layers.** Craters, volcanoes, canyons, etc. are seeded lists of features queried by a spatial index on the sphere. Each implements a shared interface (e.g. `applyHeight(dir, h) -> h` plus optional material/biome overrides). Chunks only evaluate features near them.
6. **Coordinates and precision.** Units are meters. Chunk vertices are stored chunk-local, and the scene uses a floating origin re-centered on the camera. No raw float32 world-space positions for planet-scale geometry.
7. **Collision uses the engine.** Walking and physics sample the same height function (or the same chunk data) that rendering uses. Never maintain a separate approximation.
8. **Debug views.** The engine exposes any field as a debug channel (plates, height, temperature, moisture, flow, biome, slope, LOD level, chunk bounds). The explorer lets you toggle them.

## 6. Defaults and open decisions

- Default planet radius 50 km, slider range 5 km to 500 km. Keep radius a parameter everywhere; never hardcode.
- Chunk grid 33x33 vertices to start (tunable constant).
- Screen-space-error driven LOD splitting.
- Stylized vs realistic look is undecided: build physically plausible colors and lighting, keep material/palette tuning in data, not code.

## 7. Phases

Each phase ends with something runnable. Do not start a phase until the previous phase's acceptance criteria pass.

### Phase 0: Scaffold
- Monorepo, TS config, lint, formatting, vitest, CI script (`pnpm check` runs typecheck, lint, tests).
- Seeded PRNG, 3D simplex noise (own implementation or well-tested library, seeded), fBm / ridged / billow / domain warp helpers, Worley noise.
- Param registry, zustand store, leva panel generated from registry.
- Explorer app renders a placeholder sphere with orbit controls.
- Deployment-ready build: `pnpm build` produces a static bundle for `apps/explorer` (see section 8). Add a `vercel.json` if needed.
- GitHub Actions workflow running `pnpm check` on every PR.

Acceptance: `pnpm check` passes. Noise determinism and range tests pass. Panel appears and changes a value in the store. `pnpm build` succeeds from a clean checkout.

### Phase 1: Sphere and noise displacement
- Single-resolution cube-sphere (spherified mapping) displaced by layered noise sampled at the 3D unit-sphere position.
- Sea level, basic height-based coloring, flat normals from finite differences.
- Debug-view framework (switchable channel to color).

Acceptance: no visible seams at cube edges or poles. Sliders for noise scale, octaves, amplitude, sea level update the planet.

### Phase 2: Chunked LOD
- Quadtree per cube face, chunk generation in a worker pool (Comlink), prioritized queue, LRU cache, cancel stale requests.
- Split/merge by screen-space error, frustum culling, horizon culling.
- Skirts to hide cracks. (Vertex morphing optional later.)
- Floating origin and chunk-local vertices.

Acceptance: smooth descent from orbit to ground level with no cracks, no vertex jitter near the surface, no main-thread stalls longer than 16 ms from chunk generation. Chunk count and generation time shown in a stats overlay. Add a perf script that records average and worst frame time over a scripted flight.

### Phase 3: Terrain field v1 and settings
- Layered terrain: continents mask, mountains (ridged), hills, detail, domain warping.
- Proper normals, slope-aware coloring, triplanar texture hook.
- Settings panel grouped by category; seed input; URL-shareable settings; save/load JSON; first presets.

Acceptance: same URL reproduces the same planet. Changing any slider regenerates visibly and correctly. Terrain looks plausible from orbit and on the ground.

### Phase 4: Atmosphere, water, lighting
- Sun directional light, day/night terminator, space background.
- Atmospheric scattering (Rayleigh + Mie) usable from space and from the ground; parameters for density, color, scale height.
- Ocean surface with depth-based color, shoreline blending. Cloud shell (simple) as a separate layer.
- Axial tilt and simple orbital/rotation time controls (time scale slider).

Acceptance: visually correct sunrise/sunset, atmosphere rim from orbit, no banding. Atmosphere toggles off cleanly for airless bodies.

### Phase 5: Macro geology (tectonics)
- Voronoi plates on the sphere, each with a motion vector and crust type (continental/oceanic).
- Classify boundaries (convergent, divergent, transform) and derive uplift/rift/trench fields.
- Mountain ranges along collisions, rifts and trenches along divergence, island arcs, hotspot chains.
- Output goes into the global bake. Plate count and activity are sliders.

Acceptance: debug views show plates and boundary types. Mountain ranges visibly follow collision boundaries. Different seeds give clearly different continent layouts.

### Phase 6: Climate and biomes
- Temperature from latitude, axial tilt, altitude lapse rate, star distance.
- Wind belts, moisture advected from oceans, rain shadows behind mountains, continentality.
- Biome classification (Whittaker-style) using temperature, moisture, slope, rock/material, plus ice caps and permafrost.
- Biome blending in the shader (textures or palettes), per-biome material parameters.

Acceptance: deserts appear in rain shadows and continental interiors, lush zones on windward coasts, ice at poles and high altitude. Debug views for temperature, moisture and biome. Sliders for water level, tilt, star distance, atmosphere density change biomes sensibly.

### Phase 7: Features
Implement each as a feature layer using the shared interface:
- **Craters:** bowl, rim, ejecta, central peak for large ones; power-law size distribution; age-based degradation. Dominant on airless moons.
- **Volcanoes:** cone, caldera, lava flow channels; hotspot chains; volcanic activity slider.
- **Canyons:** carved along ridged-noise paths with varying depth.
- **Surface extras:** dunes in deserts, salt flats, island chains.

Acceptance: each feature has its own slider group and debug view, appears at plausible locations (e.g. volcanoes at boundaries and hotspots), and is visible at multiple LODs without popping. Spatial index keeps chunk generation within the Phase 2 time budget.

### Phase 8: Hydrology
- Using the coarse global bake: flow direction, depression filling into lakes, flow accumulation, river extraction.
- Carve valleys, render rivers with width from accumulation, deltas at coasts, glaciers at high altitude/latitude.
- Rivers must connect to the sea or a lake and be continuous across chunk boundaries.

Acceptance: rivers flow downhill, merge into larger rivers, end in the ocean or lakes. No rivers crossing chunk seams discontinuously. Debug view for flow accumulation.

### Phase 9: Planet types and systems
- Presets: Earthlike, desert, ice world, ocean world, lava world, airless moon.
- Rings, moons orbiting a planet, tidal locking, star distance and seasons.
- A simple system view to switch between bodies.

Acceptance: each preset is recognizably distinct. Moons generated from the same engine with different parameter sets.

### Phase 10: Exploration
- Free-fly camera with seamless space-to-ground transition.
- Walking controller with spherical gravity and local "up", collision from the engine, simple jump/sprint.
- Globe/map view with map projections; export heightmap PNG and glTF of selected regions.

Acceptance: land on a planet and walk without falling through terrain or jitter. Exports open correctly in external tools.

### Phase 11: Surface detail and weather
- Instanced vegetation and rocks by biome, with density driven by climate.
- Detail normals and texture variation up close.
- Weather tied to biomes: rain, snow, fog, wind, dust storms; cloud layer reacting to moisture. Start simple (particles + fog), dynamic weather only after it looks good static.
- Aurora near magnetic poles for suitable planets.

Acceptance: weather types only occur in biomes that justify them. Frame budget holds on a mid-range laptop.

### Phase 12: Hardening
- Engine public API documented; one small example consumer app proving the engine works without the explorer.
- Perf budgets enforced by the perf script. Memory leak check on repeated regeneration.
- Optional: move the heaviest generation to GPU compute.

## 8. Deployment (Vercel)

- Pushing to `main` auto-deploys to production. Therefore **`main` must always build and pass `pnpm check`**. No agent pushes directly to `main`; all work happens on branches and merges via PR.
- Every non-main branch gets a Vercel preview deployment automatically. Use previews for visual review at phase gates.
- Protect `main` on GitHub: require the CI check to pass before merging.
- It is a static single-page app: no backend, no server functions. Query-string settings URLs need no rewrites.
- Monorepo setup on Vercel: root directory `apps/explorer`, enable including source files outside the root directory so `packages/*` are available, install with pnpm from the repo root. The engine and renderer packages must be consumed from source (workspace deps) or built as part of `pnpm build`.
- Web Workers must be created with the Vite-compatible pattern `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })` so they bundle in production.
- If SharedArrayBuffer is ever used, add COOP/COEP headers in `vercel.json`. Do not use it unless needed.
- Keep the production bundle lean: lazy-load heavy modules, no large binary assets in git (generate textures procedurally or keep them small).
- Verify production behavior (workers, shaders, URL settings) on a preview deployment at the end of Phases 2, 4 and 10.

## 9. Rules for any agent working on this repo

1. Read `docs/ARCHITECTURE.md` and `docs/PROGRESS.md` before starting. Read the section of this plan for your task.
2. Stay within your task's scope and owned directories. If a contract needs to change, stop and propose it in `docs/PROGRESS.md` instead of silently changing it.
3. Keep PRs small and focused: one task, one branch.
4. Every task adds or updates tests. Determinism tests are mandatory for anything in `engine`.
5. Run `pnpm check` before declaring done. For visual work, produce screenshots of the relevant debug views at fixed seeds and attach them.
6. Never use `Math.random`, `Date.now()`, or other non-deterministic sources in `engine`.
7. Do not hardcode radius, sea level, or any planet constant that has a parameter.
8. End every task by appending a short note to `docs/PROGRESS.md`: what changed, what is unfinished, known issues, next suggested step.

## 10. Known hard problems (expect to iterate)

- Float precision at planet scale (floating origin and chunk-local vertices are mandatory).
- Crack-free LOD transitions between neighboring chunks.
- Rivers across chunk boundaries (solve on the global bake, never per chunk).
- Keeping CPU-generated geometry and collision identical.
- Making noise-based terrain look designed rather than random (plates, erosion-like noise, and climate are the answer).
