import { expect,test } from "bun:test";
import { isCatalogResult } from "../src/lib/catalog";
test("only complete, usable optional catalog rows reach matching",()=>{
 const valid={artistName:"Artist",trackName:"Title",collectionName:"",releaseDate:"",artworkUrl:"",durationSec:1};
 expect(isCatalogResult(valid)).toBe(true);
 for(const value of [null,{},[],{...valid,artistName:undefined},{...valid,releaseDate:null},{...valid,durationSec:NaN},{...valid,durationSec:-1}])expect(isCatalogResult(value)).toBe(false);
});

import { readCatalogStore, normalizeItunesResults } from "../src/lib/catalog";
test("corrupt or unavailable optional caches are ignored", () => {
 for(const raw of ["{broken", "null", "[]", "123", '{"song":{}}']) {
  expect(readCatalogStore({getItem:()=>raw}, "itunes-v3")).toEqual({});
 }
 expect(readCatalogStore({getItem:()=>{throw new Error("blocked")}}, "itunes-v3")).toEqual({});
});
test("malformed iTunes rows do not discard usable results", () => {
 const good={artistName:"Artist",trackName:"Title",trackTimeMillis:3000};
 const rows=normalizeItunesResults([null,{},good,{...good,artworkUrl100:42},{...good,artworkUrl100:"https://example.test/100x100bb.jpg"}]);
 expect(rows).toHaveLength(3);
 expect(rows[0].artworkUrl).toBe("");
 expect(rows[2].artworkUrl).toContain("1200x1200bb");
 expect(normalizeItunesResults({})).toEqual([]);
});

test("fully corrupt cached rows are misses while genuine empty results stay cached", () => {
 const valid={artistName:"Artist",trackName:"Title",collectionName:"",releaseDate:"",artworkUrl:"",durationSec:1};
 const raw=JSON.stringify({empty:[],broken:[null,{}],mixed:[null,valid]});
 expect(readCatalogStore({getItem:()=>raw},"itunes-v3")).toEqual({empty:[],mixed:[valid]});
});

import { itunesResultsForCache } from "../src/lib/catalog";
test("malformed upstream results remain retryable while genuine empty results cache", () => {
 for (const value of [undefined, null, {}, [null, {}]]) expect(itunesResultsForCache(value)).toBeUndefined();
 expect(itunesResultsForCache([])).toEqual([]);
 expect(itunesResultsForCache([null,{artistName:"Artist",trackName:"Title"}])).toHaveLength(1);
});
