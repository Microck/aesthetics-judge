// Runs Meta's Audiobox Aesthetics model (ONNX, int8) off the main thread.
//
// Mirrors audiobox_aesthetics.infer: split the track into back-to-back 10 s
// windows, score each, average weighted by window length. The library pads the
// last window and masks the padding; the ONNX export takes variable-length input
// instead, so the last window is simply fed at its real length (verified equal
// within 0.02 on a full track, see tools/export-onnx.py).
import * as ort from "onnxruntime-web/wasm";

import { AXES, type Scores, type WorkerEvent, type WorkerRequest } from "./scores";

const MODEL_URL = import.meta.env.VITE_MODEL_URL ?? "/models/aes.int8.onnx";
const WINDOW = 160_000; // 10 s at 16 kHz
// The model predicts normalized targets; these undo it (from the checkpoint).
const MEAN = { CE: 5.06865, CU: 5.73633, PC: 3.18591, PQ: 6.57505 };
const STD = { CE: 1.93029, CU: 1.75669, PC: 1.86637, PQ: 1.51466 };

// Threads need cross-origin isolation (COOP/COEP headers); fall back to one thread.
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

let session: Promise<ort.InferenceSession> | null = null;
const post = (event: WorkerEvent) => self.postMessage(event);

// Download once, then serve from the Cache API so repeat visits skip the 126 MB.
async function loadModel(): Promise<ort.InferenceSession> {
  const cache = await caches.open("aesthetics-model-v1");
  let response = await cache.match(MODEL_URL);
  if (!response) {
    const network = await fetch(MODEL_URL);
    if (!network.ok || !network.body) throw new Error(`model download failed (${network.status})`);
    const total = Number(network.headers.get("Content-Length")) || 0;
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    const reader = network.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      post({ type: "model", loaded, total });
    }
    response = new Response(new Blob(chunks as BlobPart[]));
    await cache.put(MODEL_URL, response.clone());
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
}

async function judge(pcm: Float32Array) {
  session ??= loadModel();
  const model = await session;
  const total = Math.ceil(pcm.length / WINDOW);
  const sum: Scores = { CE: 0, CU: 0, PC: 0, PQ: 0 };
  let weightSum = 0;

  for (let index = 0; index < total; index++) {
    const window = pcm.subarray(index * WINDOW, (index + 1) * WINDOW);
    const { out } = await model.run({ wav: new ort.Tensor("float32", window, [1, 1, window.length]) });
    const raw = out.data as Float32Array;
    const scores = Object.fromEntries(AXES.map((axis, i) => [axis, raw[i] * STD[axis] + MEAN[axis]])) as Scores;
    const weight = window.length / WINDOW;
    for (const axis of AXES) sum[axis] += scores[axis] * weight;
    weightSum += weight;
    post({ type: "window", index, total, scores });
  }
  post({ type: "done", scores: Object.fromEntries(AXES.map((axis) => [axis, sum[axis] / weightSum])) as Scores });
}

// ORT's bundled build spawns its thread pool from this same file (import.meta.url),
// naming those workers "em-pthread". They must keep Emscripten's message handler,
// so only the real model worker installs ours.
if (!self.name.startsWith("em-pthread")) {
  self.onmessage = (message: MessageEvent<WorkerRequest>) => {
    judge(message.data.pcm).catch((error: unknown) => {
      session = null; // let the next attempt retry a failed download
      post({ type: "error", message: error instanceof Error ? error.message : String(error) });
    });
  };
}
