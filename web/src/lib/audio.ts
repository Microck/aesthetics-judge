// Decode any browser-playable audio file to the model's input:
// mono Float32 PCM at 16 kHz, the whole track.
export const SAMPLE_RATE = 16000;

export async function decodeToModelInput(file: Blob): Promise<Float32Array> {
  const bytes = await file.arrayBuffer();
  // decodeAudioData needs a context; its own rate does not matter here.
  const decoded = await new AudioContext().decodeAudioData(bytes);
  // An OfflineAudioContext with one output channel downmixes and resamples in one render.
  const frames = Math.ceil(decoded.duration * SAMPLE_RATE);
  const offline = new OfflineAudioContext(1, frames, SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}
