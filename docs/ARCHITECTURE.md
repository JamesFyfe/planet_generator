# Architecture

Current contracts for Planet Engine. Phase 0 defines the workspace, the noise helpers, and the parameter registry. The planet object, chunk protocol, and feature-layer interface are not contracts yet.

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
- `renderer` must not import React or the explorer. It may import engine types only. Phase 0 does not import the engine yet, because no mesh API exists.
- `explorer` may import both packages. It owns UI state (zustand) and the leva panel.

## Determinism

Engine output is a pure function of `(params, seed, input)`.

- `createPrng(seed)` is mulberry32. State is one uint32. `normalizeSeed` maps finite numbers into that uint32 space (`>>> 0`); non-finite seeds become `0`.
- `simplex3`, `fbm`, `billow`, `ridgedMultifractal`, `domainWarp`, and `worley` all take that same seed. Permutation tables are cached per seed. The cache is a pure function of the seed, so call order does not change results.
- Tests lock identical output for identical inputs, range bounds, and that a different seed changes the output. Inline snapshots lock a few sample values so the algorithms cannot drift silently.

## Units

Meters. Do not hardcode planet radius, sea level, or any other value that has a parameter. The radius slider is the build plan's range: 5 km to 500 km, default 50 km, stored as meters (`5000`, `500000`, `50000`).

## Parameters

`PLANET_PARAM_REGISTRY` in `@planet/engine` is the only slider list. Each entry has `key`, `label`, `min`, `max`, `default`, `step`, and `group`.

`PlanetParams` is `{ version, seed, radius, noiseScale }`. `version` is `PLANET_PARAMS_VERSION` (`1`) and is not a slider. `defaultPlanetParams()` builds the object from the registry. `clampPlanetParam` enforces min and max. The explorer store writes through that clamp.

The leva panel is generated from the registry (`controlsFromRegistry`). Do not hand-write a slider for a registered parameter.

Phase 0 placeholders:

| key        | group | range                         | default |
| ---------- | ----- | ----------------------------- | ------- |
| seed       | World | 0 – 1_000_000, step 1         | 1       |
| radius     | World | 5_000 – 500_000 m, step 1_000 | 50_000  |
| noiseScale | Noise | 0.1 – 10, step 0.1            | 1       |

`noiseScale` is stored and shown. Nothing samples terrain with it yet.

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

Fractal options are `octaves` (1–16, default 4), `lacunarity` (default 2), `gain` (default 0.5), and `frequency` (default 1). Domain warp options are `amplitude` (default 1) and `frequency` (default 1). Worley has no frequency argument; scale the coordinates instead. The octave cap exists so a bad value cannot request an unbounded sample loop.

## Coordinates and precision

Units are meters. When planet geometry arrives, chunk vertices stay chunk-local and the scene uses a floating origin. Do not feed raw float32 world positions into planet-scale meshes.

The Phase 0 explorer draws a **unit** sphere on purpose. A 50 km radius would be the wrong camera target, and the real radius must come from `PlanetParams` rather than a hardcoded mesh size. Orbit controls target that unit sphere. Seed tints the material so the store is visible; it is not a terrain debug view.

## Not a contract yet

Do not invent these until the phase that needs them, and do not change them later without a note in `docs/PROGRESS.md`:

- `createPlanet`, `Planet.sample`, `Planet.buildChunk`
- chunk request `{ face, lod, x, y }` and chunk typed arrays
- feature-layer interface
- global bake and worker protocol

Workers, when they arrive, must be constructed as `new Worker(new URL("./x.worker.ts", import.meta.url), { type: "module" })` so Vite bundles them. Do not use `SharedArrayBuffer` unless a later phase needs it. If it is added, COOP/COEP headers go in `vercel.json` at that point.

Collision, rivers, and debug channels are later phases. Collision must sample the engine height function. Rivers must come from the global bake.

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
