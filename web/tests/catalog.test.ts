import { expect,test } from "bun:test";
import { isCatalogResult } from "../src/lib/catalog";
test("only complete, usable optional catalog rows reach matching",()=>{
 const valid={artistName:"Artist",trackName:"Title",collectionName:"",releaseDate:"",artworkUrl:"",durationSec:1};
 expect(isCatalogResult(valid)).toBe(true);
 for(const value of [null,{},[],{...valid,artistName:undefined},{...valid,releaseDate:null},{...valid,durationSec:NaN},{...valid,durationSec:-1}])expect(isCatalogResult(value)).toBe(false);
});
