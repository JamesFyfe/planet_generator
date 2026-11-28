import { adoptGlobalBake, bakeInputKey, getGlobalBake, hasGlobalBake } from "@planet/engine";
import type { PlanetParams } from "@planet/engine";
import type { BakeWorkerRequest, BakeWorkerResponse } from "./bakeProtocol";

let worker: Worker | null = null;
let nextId = 1;
let chain: Promise<void> = Promise.resolve();
const pending = new Map<string, Promise<void>>();
const waiters = new Map<number, (message: BakeWorkerResponse) => void>();

function workerFor(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL("./bake.worker.ts", import.meta.url), { type: "module" });
  created.onmessage = (event: MessageEvent<BakeWorkerResponse>) => {
    const resolve = waiters.get(event.data.id);
    if (!resolve) return;
    waiters.delete(event.data.id);
    resolve(event.data);
  };
  created.onerror = () => {
    for (const [id, resolve] of waiters) {
      waiters.delete(id);
      resolve({ id, error: "bake worker failed to start" });
    }
  };
  worker = created;
  return created;
}

function postBake(params: PlanetParams): Promise<BakeWorkerResponse> {
  const id = nextId;
  nextId += 1;
  const request: BakeWorkerRequest = { id, params };
  return new Promise((resolve, reject) => {
    waiters.set(id, resolve);
    try {
      workerFor().postMessage(request);
    } catch (error) {
      waiters.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function schedule(params: PlanetParams): Promise<void> {
  const run = chain.then(async () => {
    if (hasGlobalBake(params)) return;
    try {
      const message = await postBake(params);
      if ("error" in message) throw new Error(message.error);
      adoptGlobalBake(params, message.payload);
    } catch (error) {
      // The worker is the normal path. A failed startup still has to produce
      // the same bake, on the main thread, or the planet never appears.
      console.warn("Plate bake worker failed; baking on the main thread.", error);
      getGlobalBake(params);
    }
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Resolve when the cached bake for these tectonic inputs is ready. */
export function ensureGlobalBake(params: PlanetParams): Promise<void> {
  if (hasGlobalBake(params)) return Promise.resolve();
  const key = bakeInputKey(params);
  const existing = pending.get(key);
  if (existing) return existing;
  const promise = schedule(params).finally(() => {
    pending.delete(key);
  });
  pending.set(key, promise);
  return promise;
}
