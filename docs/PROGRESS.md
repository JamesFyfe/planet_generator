# Progress

## 2026-11-27 — Phase 0 scaffold

**Changed.** pnpm workspace with `packages/engine`, `packages/renderer`, and `apps/explorer`. Strict TypeScript, ESLint, Prettier, and Vitest in every package. Root scripts `dev`, `build`, `test`, `lint`, `typecheck`, and `check`. GitHub Actions runs `pnpm check` on pull requests.

Engine: mulberry32 PRNG, seeded 3D simplex, fBm, ridged multifractal, billow, domain warp, and Worley. All take a seed. Tests cover determinism, ranges, and seed changes. Parameter registry has `seed`, `radius` (meters, 5 km–500 km, default 50 km), and `noiseScale`. `PlanetParams.version` is 1.

Explorer: Vite + React + R3F unit sphere, orbit controls, zustand store, leva panel generated from the registry, and a readout of the store. Engine and renderer are imported from source. No `vercel.json`.

**Unfinished.** No terrain, LOD, chunks, workers, atmosphere, or renderer meshes. `noiseScale` is stored and not sampled. `Planet`, chunk request/response, and the feature-layer interface are intentionally undefined.

**Known issues.** The placeholder mesh is unit-sized so orbit controls have a stable target; radius is not applied to geometry yet. Simplex permutations are cached for the process lifetime; results do not depend on call order. Vercel still needs the dashboard checkbox that includes source files outside `apps/explorer`. The production JS chunk is about 1.3 MB (about 386 KB gzip) because three.js ships in the first load. drei logs a `THREE.Clock` deprecation warning from three r187; it does not affect the placeholder.

**Next.** Phase 1: single-resolution cube-sphere displaced by layered noise, sea level, height-based color, flat normals, and a debug-view channel switch.
