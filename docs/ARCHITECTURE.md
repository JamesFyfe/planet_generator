# Architecture

Current contracts for Planet Engine. Phase 2 adds the chunk quadtree, screen-space LOD selection, and chunk meshes with a floating origin. Phase 4 adds the renderer layers: sun, stars, atmosphere, clouds, and a chunk-attached ocean. Workers, the feature-layer interface, and the global bake are not contracts yet.

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
- `explorer` may import both packages. It owns UI state (zustand) and the leva panel. It calls `createPlanet`, `selectChunks`, and `planet.buildChunk`, and hands the typed arrays to the renderer.

## Determinism

Engine output is a pure function of `(params, seed, input)`.

- `createPrng(seed)` is mulberry32. State is one uint32. `normalizeSeed` maps finite numbers into that uint32 space (`>>> 0`); non-finite seeds become `0`.
- `simplex3`, `fbm`, `billow`, `ridgedMultifractal`, `domainWarp`, and `worley` all take that same seed. Permutation tables are cached per seed. The cache is a pure function of the seed, so call order does not change results.
- `createPlanet(params).sample(dir)`, `buildPlanetMesh`, and `planet.buildChunk` use that noise. Tests lock identical output for identical inputs, including an inline snapshot of one sample. `selectChunks` is a pure function of the camera, radius, and screen parameters.
- `createPlanet` copies and freezes `params`, so later edits to the caller's object do not change the planet.

## Units

Meters. Do not hardcode planet radius, sea level, or any other value that has a parameter. The radius slider is the build plan's range: 5 km to 500 km, default 50 km, stored as meters (`5000`, `500000`, `50000`).

`sample` height is meters of radial displacement from `params.radius`. Amplitude is applied once inside `sample`. The mesh adds that height to the radius; it does not multiply by amplitude again.

## Parameters

`PLANET_PARAM_REGISTRY` in `@planet/engine` is the only slider list. Each entry has `key`, `label`, `min`, `max`, `default`, `step`, and `group`.

`PlanetParams` is the registry fields plus `version`. `version` is `PLANET_PARAMS_VERSION` (`3`) and is not a slider. Version moved from 1 to 2 when the terrain fields joined the object, and from 2 to 3 when atmosphere, clouds, and motion joined it. Terrain sampling does not read the phase 4 fields, so a change to them does not change a chunk. `defaultPlanetParams()` builds the object from the registry. `clampPlanetParam` enforces min and max. The explorer store writes through that clamp.

The leva panel is generated from the registry (`controlsFromRegistry`). Do not hand-write a slider for a registered parameter. The debug-view dropdown is not a planet parameter; it is a view setting driven by `DEBUG_CHANNEL_REGISTRY`. Time scale is not a planet parameter either. It lives on the explorer store and is drawn by `TimeControl`, because putting it in `PlanetParams` would make the engine depend on time.

| key                   | group      | range                         | default |
| --------------------- | ---------- | ----------------------------- | ------- |
| seed                  | World      | 0 – 1_000_000, step 1         | 1       |
| radius                | World      | 5_000 – 500_000 m, step 1_000 | 50_000  |
| noiseScale            | Noise      | 0.1 – 10, step 0.1            | 1       |
| octaves               | Noise      | 1 – 8, step 1                 | 5       |
| amplitude             | Noise      | 0 – 20_000 m, step 100        | 3_000   |
| seaLevel              | Surface    | -10_000 – 10_000 m, step 100  | 0       |
| atmosphereDensity     | Atmosphere | 0 – 4, step 0.05              | 1       |
| atmosphereScaleHeight | Atmosphere | 100 – 30_000 m, step 50       | 2_000   |
| atmosphereThickness   | Atmosphere | 0 – 80_000 m, step 100        | 8_000   |
| rayleighR             | Atmosphere | 0 – 800, step 1               | 50      |
| rayleighG             | Atmosphere | 0 – 800, step 1               | 110     |
| rayleighB             | Atmosphere | 0 – 1_200, step 1             | 225     |
| mieStrength           | Atmosphere | 0 – 200, step 0.5             | 20      |
| cloudDensity          | Clouds     | 0 – 1, step 0.01              | 0.65    |
| cloudCoverage         | Clouds     | 0 – 1, step 0.01              | 0.48    |
| axialTilt             | Motion     | -90 – 90 °, step 0.1          | 23.4    |
| rotationPeriod        | Motion     | 0.5 – 240 h, step 0.5         | 24      |

`noiseScale` is the fBm frequency on the unit sphere. `octaves` is rounded to an integer before sampling because fBm requires a whole octave count. `amplitude` is the meter scale of the noise (about [-amplitude, amplitude]). `seaLevel` is meters in that same height space. Sea-relative height is `height - seaLevel`.

Rayleigh and Mie slider values are coefficients in units of `1e-6 / m`. Density multiplies them. Density `0` or thickness `0` switches the atmosphere off, which is the airless body. The cloud deck is a separate layer: density `0` or coverage `0` hides it, including on an airless body that still has an atmosphere slider left at zero.

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

`selectChunks` returns the leaves that should exist this frame, nearest camera first. A chunk splits while one grid step projects to more than `DEFAULT_PIXEL_ERROR` (4) pixels and the patch can meet the view cone (the tighter of the field of view and the horizon). Chunks entirely outside that cone stay coarse, so the cover is still complete and the budget is spent on the visible surface. Edge neighbors, including across cube faces, stay within `MAX_LOD_GAP` (1). The distance test uses the mean sphere of `radius`. `relief` is accepted and checked, and is not added to every bounding sphere: doing that forced a max-LOD disk the size of the amplitude.

Generation stays behind `ChunkMeshSource` in the renderer. The explorer's `createPlanetChunkSource` calls `buildChunk` on the main thread and returns the payload directly. A worker can return a `Promise` of the same payload; `createChunkMeshManager` already accepts either, and nothing else in the scene has to change.

The manager keeps at most `buildsPerFrame` new meshes per call (default 32) unless fewer than eight are missing, so a view can fill in without building the whole selection in one frame. The first shell still appears together. Selection order is nearest first, so the foreground arrives before the hidden chunks. It drops meshes that leave the selection. A `cacheKey` change throws the set away. The explorer key is the debug channel plus the terrain fields only (`terrainCacheKey`), so an atmosphere, cloud, or motion edit does not rebuild chunks. Frustum and horizon tests set `mesh.visible`. The horizon occluder is `max(radius * 0.5, radius - relief)` so a mountain can still peek over the limb. Chunk vertices are not transformed by a large planet matrix: each mesh sits at `origin - camera`, both subtracted in float64, and the camera stays at the scene origin.

## Rendering layers

`createPlanetVisuals(parent)` owns everything that is not a terrain chunk. `createChunkMeshManager` still owns the chunks. The camera stays at the scene origin. Shells are placed at `-cameraWorld` and scaled to their radius, so a float32 matrix never stores a planet-centered position.

Draw order is `renderOrder`, back to front:

| order | layer      | what it is                                                           |
| ----- | ---------- | -------------------------------------------------------------------- |
| -20   | stars      | points on a spinning sphere, pinned to the far plane, depth test off |
| 0     | terrain    | chunk meshes, lit by the sun directional and a dim ambient           |
| 1     | water      | one mesh per wet chunk, parented to that chunk                       |
| 2     | atmosphere | Rayleigh + Mie shell, or hidden when density or thickness is 0       |
| 3     | clouds     | noise shell above the sea, hidden when density or coverage is 0      |

The sun is a `DirectionalLight` aimed at the origin. Its direction comes from `sunDirection(tilt, period, timeSeconds)`. From inside the atmosphere the light color is the direct-beam transmittance, so sunrise and sunset redden the ground. From orbit the light stays white and the shell carries the limb. Stars use the same spin, so the sky and the sun move together. The planet mesh does not rotate.

Time is a number on the frame, `PlanetVisualFrame.timeSeconds`. The explorer advances it by `delta * timeScale` and passes it in. The engine never reads it. `timeScale` is seconds of simulation per second of wall clock.

### Atmosphere

One `ShaderMaterial` on a sphere of the outer radius. The sphere is only the raster mask. The ray starts at the camera, so the same shader is valid from orbit and from the ground. Outside, the material is front-sided. Inside, it is back-sided. The view ray is marched; the sun path uses the Chapman air mass `sqrt(π R / 2H)` instead of a short second march, which is what keeps the horizon from staying blue and from banding. Output is dithered. Blend is `One / OneMinusSrcAlpha`, where alpha is one minus the mean transmittance, so the shell both adds scatter and dims the ground. Density `0` sets `mesh.visible = false` and the direct sun transmittance returns white.

### Water

Water is a `ChunkAttachment`, not a scene sphere. `buildWaterGeometry` projects the chunk's surface grid onto the sea sphere in that chunk's local frame (`seaPoint - origin`). The mesh is parented to the terrain chunk, so it inherits `origin - camera` and the shoreline stays in float32 range. A chunk that is entirely above sea level gets no mesh. Quads that touch any wet vertex are kept, and the fragment discards depth at or below zero, which is the shore fade. There is no skirt: equal-LOD edges already meet on the sphere, and a skirt tall enough to hide a whole-chunk sagitta reads as a grid through a transparent surface. Wave normals are faded by `fwidth` once a wave is smaller than a pixel, so the orbit view does not alias into rings.

### Adding a layer

1. Implement `PlanetLayer` (`name`, `update(state)`, `dispose`) for a shell, a sky, or a light. Implement `ChunkAttachment` (`name`, `create(payload)`, `dispose`) when the geometry has to share a terrain chunk's floating origin.
2. Construct it in `createPlanetVisuals`. Append a scene layer to the `layers` array. Return a chunk attachment the way water does, and pass it to `createChunkMeshManager` as `attachments`.
3. Read parameters and `timeSeconds` from `PlanetRenderState`. Do not read a clock. Do not import React. Set `renderOrder` so transparent layers stay back to front.
4. A new registered parameter needs a `PLANET_PARAMS_VERSION` bump and a note in `docs/PROGRESS.md`. If the parameter must not rebuild terrain, leave it out of `terrainCacheKey`.

## Coordinates and precision

Units are meters. The Phase 1 helper mesh is still planet-centered and divided by radius. Chunk vertices are chunk-local meters, and the explorer re-centers the scene on the camera every frame. Do not feed raw float32 world positions into planet-scale meshes.

## Not a contract yet

Do not invent these until the phase that needs them, and do not change them later without a note in `docs/PROGRESS.md`:

- feature-layer interface
- global bake and worker protocol

The worker shape is fixed even though the pool is not: `ChunkMeshSource.buildChunk` may return a payload or a promise of one. Workers, when they arrive, must be constructed as `new Worker(new URL("./x.worker.ts", import.meta.url), { type: "module" })` so Vite bundles them. Do not use `SharedArrayBuffer` unless a later phase needs it. If it is added, COOP/COEP headers go in `vercel.json` at that point.

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

TypeScript is strict in `tsconfig.base.json`. Vitest is configured in each package.
