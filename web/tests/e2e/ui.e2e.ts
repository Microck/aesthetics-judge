import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
const directory=mkdtempSync(join(tmpdir(),"aesthetics-e2e-"));
process.once("exit",()=>rmSync(directory,{recursive:true,force:true}));
const file=join(directory,"synthetic.wav");
const wav=Buffer.alloc(44+32000);
wav.write("RIFF",0);wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);
wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);
wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(32000,40);
for(let i=0;i<16000;i++)wav.writeInt16LE(Math.round(500*Math.sin(2*Math.PI*440*i/16000)),44+i*2);
writeFileSync(file,wav);

test("fetcher settings can be saved and cleared without contacting the fetcher",async({app,browser,screen})=>{
 await browser.route("**/api/feed",route=>route.fulfill({json:[]}));
 await app.open("/");
 await expect(screen.getByRole("heading","aesthetics judge")).toBeVisible();
 await screen.getByRole("button","fetcher",{exact:true}).click();
 await screen.getByLabel("url",{exact:true}).fill("https://fixture.invalid/audio?src={url}");
 await screen.getByRole("button","save",{exact:true}).click();
 await expect(screen.getByPlaceholder("or paste a link for your fetcher")).toBeVisible();
 await screen.getByRole("button","fetcher on",{exact:true}).click();
 await screen.getByRole("button","clear",{exact:true}).click();
 await expect(screen.getByRole("button","fetcher",{exact:true})).toBeVisible();
});

test("worker startup failure releases busy state and a second upload can finish",async({app,browser,screen})=>{
 await browser.route("**/api/**",route=>route.fulfill({json:route.request.url.endsWith('/feed')?[]:{}}));
 await browser.route("https://itunes.apple.com/**",route=>route.fulfill({json:{results:[]}}));
 await browser.addInitScript(()=>{
  let count=0;
  class FakeWorker {
   id=++count; onmessage:((event:{data:unknown})=>void)|null=null; onerror:((event:{message:string})=>void)|null=null;
   terminate(){}
   postMessage(){queueMicrotask(()=>{
    if(this.id===1)this.onerror?.({message:"synthetic model worker failure"});
    else {const scores={CE:6,CU:6,PC:6,PQ:6};this.onmessage?.({data:{type:"window",index:0,total:1,scores}});this.onmessage?.({data:{type:"done",scores}});}
   });}
  }
  window.Worker=FakeWorker as unknown as typeof Worker;
 });
 await app.open("/");
 await screen.getByLabel("Audio file").setInputFiles(file);
 await expect(screen.getByText("synthetic model worker failure",{exact:true})).toBeVisible();
 await expect(screen.getByRole("button","choose a song")).toBeEnabled();
 await screen.getByLabel("Audio file").setInputFiles(file);
 await expect(screen.getByRole("button","download card")).toBeVisible();
});
