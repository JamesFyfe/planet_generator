# AGENTS.md

Standing instructions for any AI coding agent working in this repo. Keep this file short; the detailed plan is in `BUILD_PLAN.md`.

## Project

Planet Engine: a web-based procedural planet/moon generator (TypeScript, React Three Fiber) with an explorer app on top. The engine is the product and must stay reusable by future games and tools.

Read, in this order, before starting any task:
1. `docs/ARCHITECTURE.md` (current contracts and decisions, once it exists)
2. `docs/PROGRESS.md` (handoff notes from previous tasks)
3. The section of `BUILD_PLAN.md` for your task

## Layout

- `packages/engine`: pure TypeScript. Noise, fields, climate, features, chunk generation. No React, no three.js, no DOM. Must run in Node and Web Workers.
- `packages/renderer`: three.js-specific meshes, materials, shaders. No React. May import engine types only.
- `apps/explorer`: Vite + React + R3F app, UI, controls, presets.

`engine` must never import from `renderer` or `apps`.

## Commands

- `pnpm install`
- `pnpm dev`: run the explorer
- `pnpm check`: typecheck + lint + tests (must pass before you finish)
- `pnpm test`: unit tests
- `pnpm build`: production build

(If a command is missing, creating it is part of Phase 0.)

## Git workflow

- Never commit or push directly to `main`. Pushes to `main` auto-deploy to production.
- Work on the branch you were given. One task per branch, small focused commits.
- Do not merge your own branch; open a PR and stop.
- Do not edit files outside your task's scope or owned directories.

## Hard rules

- Determinism: engine output is a pure function of `(params, seed, input)`. Never use `Math.random`, `Date.now()`, or other non-deterministic sources in `engine`. Use the seeded PRNG.
- Units are meters. Never hardcode planet radius, sea level or other values that have a parameter.
- Parameters live in one registry with metadata (label, min, max, default, step, group). The UI is generated from it. Do not hand-write sliders.
- Planet-scale geometry uses chunk-local vertex positions and a floating origin. No raw float32 world positions.
- Collision and walking must use the engine's height function or chunk data, never a separate approximation.
- Rivers and other global features are computed from the coarse global bake, never per chunk.
- Heavy generation runs in Web Workers, never on the main thread.
- Do not build out-of-scope features: geology time-lapse, photo mode, names/labels, caves or volumetric terrain, backend.

## Contracts

Do not change public interfaces (`PlanetParams`, `Planet`, chunk request/response, feature layer interface) silently. If a change is needed, stop, describe it in `docs/PROGRESS.md`, and wait for approval.

## Definition of done

1. `pnpm check` passes.
2. New engine logic has tests, including a determinism test.
3. Visual work includes screenshots of the relevant debug views at fixed seeds.
4. Acceptance criteria for the task are met and listed with pass/fail in your final message.
5. A short note is appended to `docs/PROGRESS.md`: what changed, what is unfinished, known issues, suggested next step.

## Style

- TypeScript strict. Prefer small pure functions and typed arrays for bulk data.
- No new dependencies without a one-line justification in the PR description.
- Comments explain why, not what.
