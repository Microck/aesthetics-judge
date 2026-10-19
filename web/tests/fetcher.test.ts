import { afterEach, expect, test } from "bun:test";
import { fetchAudio } from "../src/lib/fetcher";
const original=globalThis.fetch;
afterEach(()=>{globalThis.fetch=original;});
for(const [header,name] of [
 ['attachment; filename="100% hits.wav"','100% hits.wav'],
 ["attachment; filename=backup.wav; filename*=UTF-8''caf%C3%A9.wav",'café.wav'],
 ["attachment; filename=backup.wav; filename*=UTF-8''bad%ZZ.wav",'backup.wav'],
 ['attachment; filename="semi;colon.wav"','semi;colon.wav'],
])test(`download filename ${name}`,async()=>{
 globalThis.fetch=async()=>new Response("fixture",{headers:{'Content-Type':'audio/wav','Content-Disposition':header}});
 expect((await fetchAudio('https://fixture.invalid/song',{url:'https://fixture.invalid/fetch',authorization:''})).name).toBe(name);
});
