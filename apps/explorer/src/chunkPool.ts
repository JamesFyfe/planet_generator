import { releaseProxy, wrap } from "comlink";
import { chunkKey, chunkLodScore } from "@planet/engine";
import type {
  ChunkLodScore,
  ChunkRequest,
  DebugChannelId,
  LodSelectionInput,
  Planet,
  PlanetParams,
} from "@planet/engine";
import type { ChunkMeshPayload, ChunkMeshSource } from "@planet/renderer";
import type { ChunkWorkerApi } from "./chunk.worker";

const DEFAULT_CACHE_SIZE = 1024;

export class ChunkCancelled extends Error {
  constructor() {
    super("Chunk request cancelled");
    this.name = "ChunkCancelled";
  }
}

export interface ChunkExecutor {
  build(
    params: PlanetParams,
    channel: DebugChannelId,
    request: ChunkRequest,
  ): Promise<ChunkMeshPayload>;
}

export interface PlanetChunkSource extends ChunkMeshSource {
  /**
   * Drop queued work that left the selection and rank what remains.
   * `scores` are the selector's screen errors, so the queue does not measure
   * every tile again on the main thread.
   */
  retain(
    requests: readonly ChunkRequest[],
    view: LodSelectionInput,
    scores?: ReadonlyMap<string, ChunkLodScore>,
  ): void;
  dispose(): void;
}

interface Job {
  key: string;
  request: ChunkRequest;
  params: PlanetParams;
  channel: DebugChannelId;
  error: number;
  distance: number;
  cancelled: boolean;
  settled: boolean;
  epoch: number;
  promise: Promise<ChunkMeshPayload>;
  resolve: (payload: ChunkMeshPayload) => void;
  reject: (error: unknown) => void;
}

type Builder = ChunkExecutor["build"];

/**
 * Larger screen error first, then the closer patch. The key breaks remaining
 * ties so the same selection always starts in the same order.
 */
function compareJobs(a: Job, b: Job): number {
  if (a.error !== b.error) return a.error - b.error;
  if (a.distance !== b.distance) return b.distance - a.distance;
  if (a.key < b.key) return 1;
  if (a.key > b.key) return -1;
  return 0;
}

class JobQueue {
  private jobs: Job[] = [];
  private dirty = false;
  private waiters: (() => void)[] = [];
  paused = false;

  push(job: Job): void {
    this.jobs.push(job);
    this.dirty = true;
    this.wake();
  }

  find(key: string): Job | undefined {
    return this.jobs.find((job) => job.key === key);
  }

  rescore(score: (job: Job) => ChunkLodScore): void {
    for (const job of this.jobs) {
      const next = score(job);
      job.error = next.screenError;
      job.distance = next.distance;
    }
    this.dirty = true;
  }

  cancelMissing(wanted: ReadonlySet<string>): void {
    const keep: Job[] = [];
    for (const job of this.jobs) {
      if (wanted.has(job.key)) keep.push(job);
      else rejectJob(job);
    }
    this.jobs = keep;
    this.dirty = true;
  }

  cancelAll(): void {
    for (const job of this.jobs) rejectJob(job);
    this.jobs = [];
    this.dirty = false;
  }

  async take(): Promise<Job | null> {
    for (;;) {
      if (this.paused) return null;
      if (this.dirty) {
        this.jobs.sort(compareJobs);
        this.dirty = false;
      }
      const job = this.jobs.pop();
      if (job) return job;
      if (this.paused) return null;
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
  }

  wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter();
  }
}

class LruCache {
  private readonly entries = new Map<string, ChunkMeshPayload>();

  constructor(private readonly capacity: number) {}

  get(key: string): ChunkMeshPayload | undefined {
    const value = this.entries.get(key);
    if (!value) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: ChunkMeshPayload): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

function rejectJob(job: Job): void {
  if (job.settled) return;
  job.settled = true;
  job.cancelled = true;
  job.reject(new ChunkCancelled());
}

function cacheKeyOf(params: PlanetParams, channel: DebugChannelId): string {
  return `${channel}:${JSON.stringify(params)}`;
}

function defaultConcurrency(): number {
  const cores = typeof navigator === "undefined" ? 4 : navigator.hardwareConcurrency || 4;
  return Math.max(1, Math.min(4, cores - 1));
}

/**
 * Vite only emits a production worker when this exact constructor form is
 * visible in the module. A string URL would 404 on the Vercel preview.
 */
function workerBuilder(): { build: Builder; stop: () => void } {
  const worker = new Worker(new URL("./chunk.worker.ts", import.meta.url), { type: "module" });
  const api = wrap<ChunkWorkerApi>(worker);
  return {
    build: (params, channel, request) => api.build(params, channel, request),
    stop() {
      api[releaseProxy]();
      worker.terminate();
    },
  };
}

export function createPlanetChunkSource(
  getPlanet: () => Planet,
  getChannel: () => DebugChannelId,
  options?: { concurrency?: number; cacheSize?: number; executor?: ChunkExecutor },
): PlanetChunkSource {
  const concurrency = options?.concurrency ?? (options?.executor ? 1 : defaultConcurrency());
  const cache = new LruCache(options?.cacheSize ?? DEFAULT_CACHE_SIZE);
  const queue = new JobQueue();
  const inflight = new Map<string, Job>();
  let view: LodSelectionInput | null = null;
  let scores: ReadonlyMap<string, ChunkLodScore> | null = null;
  let cacheKey = "";
  let epoch = 0;
  let token = 0;
  let lanesAlive = 0;
  const stops: (() => void)[] = [];

  function failInflight(): void {
    for (const job of inflight.values()) rejectJob(job);
    inflight.clear();
  }

  function syncPlanet(): void {
    const nextKey = cacheKeyOf(getPlanet().params, getChannel());
    if (nextKey === cacheKey) return;
    cacheKey = nextKey;
    epoch += 1;
    cache.clear();
    queue.cancelAll();
    failInflight();
  }

  function ensureStarted(): void {
    if (lanesAlive > 0 && !queue.paused) return;
    token += 1;
    const laneToken = token;
    queue.paused = false;
    for (let index = 0; index < concurrency; index += 1) {
      const lane = options?.executor
        ? { build: options.executor.build.bind(options.executor), stop: () => undefined }
        : workerBuilder();
      stops.push(lane.stop);
      lanesAlive += 1;
      void runLane(lane.build, laneToken).finally(() => {
        lanesAlive -= 1;
      });
    }
  }

  async function runLane(build: Builder, laneToken: number): Promise<void> {
    while (laneToken === token && !queue.paused) {
      const job = await queue.take();
      if (!job || laneToken !== token || queue.paused) {
        if (job) rejectJob(job);
        return;
      }
      if (job.settled || job.cancelled || job.epoch !== epoch) continue;
      inflight.set(job.key, job);
      try {
        const payload = await build(job.params, job.channel, job.request);
        if (laneToken !== token || job.epoch !== epoch) {
          rejectJob(job);
          return;
        }
        // Keep the arrays even if the selection moved on. The next request
        // for this tile is then a cache hit instead of another build.
        cache.set(job.key, payload);
        if (job.cancelled) rejectJob(job);
        else {
          job.settled = true;
          job.resolve(payload);
        }
      } catch {
        rejectJob(job);
        if (laneToken !== token) return;
      } finally {
        if (inflight.get(job.key) === job) inflight.delete(job.key);
      }
    }
  }

  function scoreOf(request: ChunkRequest): ChunkLodScore {
    const known = scores?.get(chunkKey(request));
    if (known) return known;
    if (!view) return { screenError: 0, distance: Number.POSITIVE_INFINITY };
    return chunkLodScore(request, view);
  }

  function enqueue(request: ChunkRequest): Promise<ChunkMeshPayload> {
    const planet = getPlanet();
    const channel = getChannel();
    const score = scoreOf(request);
    let resolve: (payload: ChunkMeshPayload) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const promise = new Promise<ChunkMeshPayload>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    queue.push({
      key: chunkKey(request),
      request,
      params: planet.params,
      channel,
      error: score.screenError,
      distance: score.distance,
      cancelled: false,
      settled: false,
      epoch,
      promise,
      resolve,
      reject,
    });
    return promise;
  }

  return {
    retain(requests, nextView, nextScores) {
      ensureStarted();
      syncPlanet();
      view = nextView;
      scores = nextScores ?? null;
      const wanted = new Set(requests.map((request) => chunkKey(request)));
      queue.cancelMissing(wanted);
      for (const job of inflight.values()) job.cancelled = !wanted.has(job.key);
      queue.rescore((job) => scoreOf(job.request));
    },
    buildChunk(request) {
      ensureStarted();
      syncPlanet();
      const key = chunkKey(request);
      const cached = cache.get(key);
      if (cached) return cached;
      const running = inflight.get(key);
      if (running && running.epoch === epoch && !running.settled) {
        running.cancelled = false;
        return running.promise;
      }
      const queued = queue.find(key);
      if (queued && !queued.settled) {
        queued.cancelled = false;
        return queued.promise;
      }
      return enqueue(request);
    },
    dispose() {
      token += 1;
      queue.paused = true;
      queue.cancelAll();
      failInflight();
      for (const stop of stops) stop();
      stops.length = 0;
      queue.wake();
    },
  };
}
