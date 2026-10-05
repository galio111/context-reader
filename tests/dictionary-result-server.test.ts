import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import ts from "typescript";
import * as snapshot from "../lib/dictionaryResultSnapshot";
import type {DictionaryResult} from "../types/dictionary";
import type {AccountSyncObject} from "../types/account";

test("cloud result recovery is scoped to the verified user and writes use the existing CAS; invalid results cannot persist",async()=>{
  const paths:string[]=[],writes:AccountSyncObject[][]=[];
  const result={query:"contemplate",lemma:"contemplate",direction:"en_to_cn",inputStatus:"valid",
    senses:[{meaning:"思考"}],collocations:[],wordFamily:[],synonyms:[],commonMistakes:[]} as unknown as DictionaryResult;
  const payload={schemaVersion:2,query:"contemplate",result,updatedAt:new Date().toISOString()};
  const source=readFileSync(new URL("../lib/dictionaryResultServer.ts",import.meta.url),"utf8");
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const account={
    accountFetch:async(path:string)=>{paths.push(path);return [{payload,server_version:7,deleted_at:null}];},
    writeSyncObjects:async(user:string,objects:AccountSyncObject[])=>{assert.equal(user,"user-A");writes.push(objects);return objects.map(item=>({...item,accepted:true}));},
  };
  const modules:Record<string,unknown>={"server-only":{},"./accountStore":account,"./dictionaryResultSnapshot":snapshot};
  const api=runInNewContext(js+"\nexports",{exports:{},require:(key:string)=>modules[key]}) as {
    readDictionaryResult(user:string,query:string):Promise<DictionaryResult|null>;
    persistDictionaryResult(user:string,result:DictionaryResult):Promise<void>;
  };
  assert.equal((await api.readDictionaryResult("user-A","contemplate"))?.query,"contemplate");
  assert.equal(await api.readDictionaryResult("user-A","another"),null,"a mismatched payload must not become a query cache hit");
  assert.ok(paths.every(path=>path.includes("user_id=eq.user-A")&&path.includes("kind=eq.preferences")&&path.includes("limit=1")));
  await api.persistDictionaryResult("user-A",result);
  assert.equal(writes.length,1);assert.equal(writes[0][0].serverVersion,7);
  assert.equal(writes[0][0].objectKey,"standalone-dictionary-cache:contemplate");
  await api.persistDictionaryResult("user-A",{...result,senses:[]});
  assert.equal(writes.length,1);
});
