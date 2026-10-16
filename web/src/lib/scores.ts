// Shared between the UI and the model worker. Kept separate so importing these
// from the UI does not pull ONNX Runtime into the main bundle.
export const AXES = ["CE", "CU", "PC", "PQ"] as const;
export type Axis = (typeof AXES)[number];
export type Scores = Record<Axis, number>;

export const AXIS_LABELS: Record<Axis, string> = {
  CE: "content enjoyment",
  CU: "content usefulness",
  PC: "production complexity",
  PQ: "production quality",
};

export type WorkerRequest = { type: "judge"; pcm: Float32Array };
export type WorkerEvent =
  | { type: "model"; loaded: number; total: number }
  | { type: "window"; index: number; total: number; scores: Scores }
  | { type: "done"; scores: Scores }
  | { type: "error"; message: string };

// Heights are relative to the song's own low and high: on a fixed 1-10 scale most
// songs sit in a narrow 6-8 band and the strip looks flat.
export function barHeight(score: number, windows: number[]) {
  const low = Math.min(...windows);
  const span = Math.max(...windows) - low || 1;
  return 0.2 + 0.8 * ((score - low) / span);
}
