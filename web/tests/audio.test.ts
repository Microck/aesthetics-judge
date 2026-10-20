import { afterEach, expect, test } from "bun:test";
import { decodeToModelInput } from "../src/lib/audio";
const originalAudio = globalThis.AudioContext;
const originalOffline = globalThis.OfflineAudioContext;
afterEach(() => { globalThis.AudioContext=originalAudio; globalThis.OfflineAudioContext=originalOffline; });
for (const fail of [false,true]) {
 test(`decoder closes its AudioContext on ${fail ? "failure" : "success"}`,async()=>{
  let closed=0;
  globalThis.AudioContext=class {
   async decodeAudioData(){if(fail)throw new Error("decode fixture failure");return {duration:1};}
   async close(){closed++;}
  } as unknown as typeof AudioContext;
  globalThis.OfflineAudioContext=class {
   destination={}; createBufferSource(){return {buffer:null,connect(){},start(){}};}
   async startRendering(){return {getChannelData(){return new Float32Array(16000);}};}
  } as unknown as typeof OfflineAudioContext;
  if(fail)await expect(decodeToModelInput(new Blob(["fixture"]))).rejects.toThrow("decode fixture failure");
  else expect((await decodeToModelInput(new Blob(["fixture"]))).length).toBe(16000);
  expect(closed).toBe(1);
 });
}
