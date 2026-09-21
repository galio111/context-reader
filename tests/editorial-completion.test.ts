import test from 'node:test';
import assert from 'node:assert/strict';
import {editorialDayClosed} from '../lib/editorialRunner';
const day='2026-09-22';
const store=(rows:Record<string,unknown>,seen:string[]=[])=>async<T>(key:string,fallback:T):Promise<T>=>{seen.push(key);return (rows[key]??fallback) as T;};
test('yesterday sent does not suppress a finished day whose email was interrupted',async()=>{
 const seen:string[]=[];
 const closed=await editorialDayClosed(day,store({['recommendation_editorial_day_'+day]:{finished:true},recommendation_editorial_email_2026_09_21:{status:'sent'}},seen));
 assert.equal(closed,false);assert.ok(seen.every(k=>k.includes(day)));
});
test('sent current-day email or explicit suspension closes without reading article bodies',async()=>{
 assert.equal(await editorialDayClosed(day,store({['recommendation_editorial_day_'+day]:{finished:true},['recommendation_editorial_email_'+day+'_30_complete']:{status:'sent'}})),true);
 const seen:string[]=[];assert.equal(await editorialDayClosed(day,store({['recommendation_editorial_day_'+day]:{finished:true,suspended:true}},seen)),true);assert.equal(seen.length,1);
});
test('running day does not query old delivery records',async()=>{
 const seen:string[]=[];assert.equal(await editorialDayClosed(day,store({},seen)),false);assert.equal(seen.length,1);
});
