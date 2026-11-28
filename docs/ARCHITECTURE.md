# Architecture

Current contracts for Planet Engine. Phase 2 adds the chunk quadtree, screen-space LOD selection, chunk meshes with a floating origin, and a worker pool for chunk generation. The feature-layer interface and the global bake are not contracts yet.

## Layout

```
packages/engine     Pure TypeScript. Noise, fields, climate, features, chunk generation.
packages/renderer   three.js meshes, materials, and shaders. No React.
apps/explorer       Vite + React + React Three Fiber. Scene, UI, controls, presets.
docs                ARCHITECTURE.md (this file) and PROGRESS.md (handoff notes).
```

`packages/engine` and `packages/renderer` are consumed from TypeScript source (`exports` points at `src/index.ts`). Vite bundles that source into the explorer. There is no separate emit step.

## Dependency rules

- `engine` must not import `renderer`, `apps`, React, three.js, or DOM APIs. It must run in Node and in Web Workers. ESLint enforces the import ban, and bans `Math.random` and `Date.now` inside `packages/engine`.
- `renderer` must not import React or the explorer. It may import engine types only. `createPlanetMesh` and `createChunkMeshManager` upload buffers; they do not sample the planet.
- `explorer` may import both packages. It owns UI state (zustand) and the leva panel. It calls `createPlanet` and `selectChunks`, and asks a worker pool for chunk meshes. The pool calls `planet.buildChunk` off the main thread and hands the typed arrays to the renderer.

## Determinism

Engine output is a pure function of `(params, seed, input)`.

- `createPrng(seed)` is mulberry32. State is one uint32. `normalizeSeed` maps finite numbers into that uint32 space (`>>> 0`); non-finite seeds become `0`.
- `simplex3`, `fbm`, `billow`, `ridgedMultifractal`, `domainWarp`, and `worley` all take that same seed. Permutation tables are cached per seed. The cache is a pure function of the seed, so call order does not change results.
- `createPlanet(params).sample(dir)`, `buildPlanetMesh`, and `planet.buildChunk` use that noise. Tests lock identical output for identical inputs, including an inline snapshot of one sample. `selectChunks` and `chunkLodScore` are pure functions of the camera, radius, and screen parameters.
- `createPlanet` copies and freezes `params`, so later edits to the caller's object do not change the planet.

## Units

Meters. Do not hardcode planet radius, sea level, or any other value that has a parameter. The radius slider is the build plan's range: 5 km to 500 km, default 50 km, stored as meters (`5000`, `500000`, `50000`).

`sample` height is meters of radial displacement from `params.radius`. Amplitude is applied once inside `sample`. The mesh adds that height to the radius; it does not multiply by amplitude again.

## Parameters

`PLANET_PARAM_REGISTRY` in `@planet/engine` is the only slider list. Each entry has `key`, `label`, `min`, `max`, `default`, `step`, and `group`.

`PlanetParams` is `{ version, seed, radius, noiseScale, octaves, amplitude, seaLevel }`. `version` is `PLANET_PARAMS_VERSION` (`2`) and is not a slider. Version moved from 1 to 2 when the terrain fields joined the object. `defaultPlanetParams()` builds the object from the registry. `clampPlanetParam` enforces min and max. The explorer store writes through that clamp.

The leva panel is generated from the registry (`controlsFromRegistry`). Do not hand-write a slider for a registered parameter. The debug-view dropdown is not a planet parameter; it is a view setting driven by `DEBUG_CHANNEL_REGISTRY`.

| key        | group   | range                         | default |
| ---------- | ------- | ----------------------------- | ------- |
| seed       | World   | 0 – 1_000_000, step 1         | 1       |
| radius     | World   | 5_000 – 500_000 m, step 1_000 | 50_000  |
| noiseScale | Noise   | 0.1 – 10, step 0.1            | 1       |
| octaves    | Noise   | 1 – 8, step 1                 | 5       |
| amplitude  | Noise   | 0 – 20_000 m, step 100        | 3_000   |
| seaLevel   | Surface | -10_000 – 10_000 m, step 100  | 0       |

`noiseScale` is the fBm frequency on the unit sphere. `octaves` is rounded to an integer before sampling because fBm requires a whole octave count. `amplitude` is the meter scale of the noise (about [-amplitude, amplitude]). `seaLevel` is meters in that same height space. Sea-relative height is `height - seaLevel`.

## Noise

All functions are exported from `@planet/engine`.

| function                                      | result                                                    |
| --------------------------------------------- | --------------------------------------------------------- |
| `simplex3(seed, x, y, z)`                     | 3D simplex in [-1, 1]                                     |
| `fbm(seed, x, y, z, options?)`                | normalized fBm in [-1, 1]                                 |
| `billow(seed, x, y, z, options?)`             | absolute simplex, remapped, stacked, in [-1, 1]           |
| `ridgedMultifractal(seed, x, y, z, options?)` | ridged multifractal in [0, 1]                             |
| `domainWarp(seed, x, y, z, options?)`         | input point plus a simplex displacement                   |
| `worley(seed, x, y, z)`                       | `{ f1, f2 }` Euclidean distances, one point per unit cell |

Fractal options are `octaves` (1–16, default 4), `lacunarity` (default 2), `gain` (default 0.5), and `frequency` (default 1). Domain warp options are `amplitude` (default 1) and `frequency` (default 1). Worley has no frequency argument; scale the coordinates instead. The search starts with the query cell and grows one Chebyshev shell at a time until the next shell cannot contain a closer second neighbor. The octave cap exists so a bad value cannot request an unbounded sample loop. The terrain slider stops at 8, under that cap.

## Planet sample

`createPlanet(params)` returns a `Planet`. `Planet.sample(dir)` returns `{ height, seaRelativeHeight }`.

- `dir` is a 3D direction. It is normalized before sampling, so the vector length does not matter. A zero vector throws.
- Height is layered fBm at that unit direction, multiplied by `amplitude`. The sample never uses latitude/longitude, so there is no seam at the antimeridian and no pinch at the poles.
- `Planet.buildChunk(request)` samples that same field. Temperature, moisture, and biome are not on the sample yet.

## Cube sphere

`buildPlanetMesh(planet, channel, segments?)` returns `PlanetMeshData`: `positions`, `normals`, `colors`, `indices`, and `lit`.

- One resolution, `PLANET_MESH_SEGMENTS` (128). The optional `segments` argument exists so tests can build a small grid. There is no LOD.
- The sphere is a spherified cube (Nowell's map), not a normalized cube, so face quads stay roughly even. The map is continuous: vertices duplicated along a cube edge are the same point.
- Each vertex is displaced to `direction * (1 + height / radius)`. Dividing by radius keeps the float32 buffer near unit length instead of storing raw meter-scale positions. The explorer no longer draws this mesh; it draws chunk meshes. The function remains for tests and for a single-resolution bake.
- Normals are finite differences on that displaced sphere, not averages of mesh faces. Slope is the angle between the normal and the radial direction.
- Colors come from the selected debug channel.

## Debug channels

`DEBUG_CHANNEL_REGISTRY` is the list of color outputs. `isDebugChannelId` guards the dropdown.

| id      | label   | coloring                                                 | lit |
| ------- | ------- | -------------------------------------------------------- | --- |
| terrain | Terrain | ocean, shore, land, high ground from sea-relative height | yes |
| height  | Height  | sea-relative height ramp                                 | no  |
| slope   | Slope   | slope-angle ramp                                         | no  |
| lod     | LOD     | one flat color per chunk level                           | no  |

The shore band is the smaller of a radius fraction and a slice of the amplitude, so the coastline stays visible from orbit without swallowing the lowlands. Data channels are unlit so lighting does not hide the ramp.

## Chunks and LOD

One quadtree per cube face. `ChunkRequest` is `{ face, lod, x, y }`. Face order matches the cube sphere: `+X, -X, +Y, -Y, +Z, -Z`. `x` and `y` are tile coordinates in `[0, 2^lod)`.

`CHUNK_GRID_SIZE` is 33 (32 quads along an edge). `planet.buildChunk(request)` returns:

- `positions`, `normals`: chunk-local meters and unit normals. The center grid vertex is the origin, so positions stay small at high LOD.
- `height`, `seaRelativeHeight`, `slope`: one value per vertex, including skirt vertices copied from the edge they hang from.
- `indices`, `origin` (planet-centered meters, float64), and `boundingRadius`.

Skirts are a ring of vertices pulled toward the planet center. Their depth scales with the chunk edge and with `amplitude * noiseScale`, and is capped at a quarter of the edge so a steep gradient cannot pull the skirt through the planet.

`selectChunks` returns the leaves that should exist this frame, nearest camera first. `selectChunkPlan` returns those leaves and the screen-error scores already computed for them. A chunk splits while one grid step projects to more than `DEFAULT_PIXEL_ERROR` (4) pixels and the patch can meet the view cone (the tighter of the field of view and the horizon). Chunks entirely outside that cone stay coarse, so the cover is still complete and the budget is spent on the visible surface. Edge neighbors, including across cube faces, stay within `MAX_LOD_GAP` (1). The distance test uses the mean sphere of `radius`. `relief` is accepted and checked, and is not added to every bounding sphere: doing that forced a max-LOD disk the size of the amplitude. `chunkLodScore` reports that same screen-space error and distance so the generator can rank a queue without a second definition of the split.

Generation stays behind `ChunkMeshSource`. `createPlanetChunkSource` keeps an LRU of payloads (1024) and a pool of module workers, one fewer than `navigator.hardwareConcurrency`, clamped to 1–4. Each worker is `new Worker(new URL("./chunk.worker.ts", import.meta.url), { type: "module" })`, wrapped with Comlink. The worker builds the chunk, colors it, and transfers the position, normal, color, and index buffers. The queue runs the largest screen error first and the closer patch when those errors match. `retain(selection, view)` drops queued jobs that left the selection; an in-flight job finishes and may fill the cache, but its promise rejects so the mesh is not uploaded. A params or debug-channel change clears the cache and cancels outstanding jobs.

The manager asks for up to 64 missing selected chunks per call, closest first, then uploads at most `buildsPerFrame` geometries per call (default 8). It does not drop a mesh the moment it leaves the selection. The draw set is the selected leaves that are ready, except a coarser ready ancestor stays up until every selected leaf under it is ready, and resident descendants stay up until a coarser selection is uploaded. The swap happens in one call, so the parent does not disappear while its children are still building. A `cacheKey` change throws the meshes and the payload cache away. Frustum and horizon tests set `mesh.visible`. The horizon occluder is `max(radius * 0.5, radius - relief)` so a mountain can still peek over the limb. Chunk vertices are not transformed by a large planet matrix: each mesh sits at `origin - camera`, both subtracted in float64, and the camera stays at the scene origin.

## Coordinates and precision

Units are meters. The Phase 1 helper mesh is still planet-centered and divided by radius. Chunk vertices are chunk-local meters, and the explorer re-centers the scene on the camera every frame. Do not feed raw float32 world positions into planet-scale meshes.

## Not a contract yet

Do not invent these until the phase that needs them, and do not change them later without a note in `docs/PROGRESS.md`:

- feature-layer interface
- global bake and worker protocol

`ChunkMeshSource.buildChunk` may return a payload or a promise of one. Workers are constructed as `new Worker(new URL("./chunk.worker.ts", import.meta.url), { type: "module" })` so Vite bundles them. Do not use `SharedArrayBuffer` unless a later phase needs it. If it is added, COOP/COEP headers go in `vercel.json` at that point.

Collision must sample the engine height function. Rivers must come from the global bake.

## Deployment

Static SPA. No backend and no server functions.

`pnpm build` typechecks every package and writes the explorer to `apps/explorer/dist`. Vercel project settings:

- Root directory: `apps/explorer`
- Include source files outside the root directory: on (so `packages/*` are visible)
- Install from the repo root with pnpm
- Framework: Vite, output directory `dist`

There is no `vercel.json`. The app has no client router, so query-string settings need no rewrites, and nothing sets COOP/COEP.

Pushing `main` deploys to production. Do not push `main` directly. CI runs `pnpm check` on pull requests (`.github/workflows/ci.yml`).

## Commands

- `pnpm install`
- `pnpm dev` — explorer
- `pnpm test` — vitest in engine, renderer, and explorer
- `pnpm typecheck` — `tsc --noEmit` in each package
- `pnpm lint` — eslint and prettier
- `pnpm check` — typecheck, then lint, then test
- `pnpm build` — typecheck packages and emit `apps/explorer/dist`
- `pnpm perf` — build the explorer, then fly from orbit to the ground in headless Chromium and print average frame time, worst frame time, and the longest main-thread task

TypeScript is strict in `tsconfig.base.json`. Vitest is configured in each package.
