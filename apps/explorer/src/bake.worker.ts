import { createGlobalBake, serializeGlobalBake } from "@planet/engine";
import type { BakeWorkerRequest } from "./bakeProtocol";

self.onmessage = (event: MessageEvent<BakeWorkerRequest>) => {
  const { id, params } = event.data;
  try {
    const payload = serializeGlobalBake(createGlobalBake(params));
    const transfer = payload.channels.map((channel) => channel.data.buffer);
    self.postMessage({ id, payload }, { transfer });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({ id, error: message });
  }
};
