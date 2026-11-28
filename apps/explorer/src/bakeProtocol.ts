import type { GlobalBakePayload, PlanetParams } from "@planet/engine";

export interface BakeWorkerRequest {
  id: number;
  params: PlanetParams;
}

export interface BakeWorkerSuccess {
  id: number;
  payload: GlobalBakePayload;
}

export interface BakeWorkerFailure {
  id: number;
  error: string;
}

export type BakeWorkerResponse = BakeWorkerSuccess | BakeWorkerFailure;
