import test from 'node:test';
import assert from 'node:assert/strict';
import {accountFetch} from '../lib/accountStore';

test('pool acquisition failures retry the unexecuted request; ambiguous writes never retry',async()=>{
 const original=globalThis.fetch, url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://database.example';process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';
 let calls=0;
 try{
  globalThis.fetch=async()=>{calls++;return calls===1?Response.json({code:'PGRST003',message:'Timed out acquiring connection from connection pool.'},{status:504}):Response.json({saved:true});};
  assert.deepEqual(await accountFetch('rpc/study_local_event_v1',{method:'POST',body:'{}'}),{saved:true});assert.equal(calls,2);
  calls=0;globalThis.fetch=async()=>{calls++;return Response.json({message:'unavailable'},{status:503});};
  await assert.rejects(accountFetch('rpc/write',{method:'POST'}));assert.equal(calls,1);
  calls=0;globalThis.fetch=async()=>{calls++;throw new TypeError('connection lost after commit');};
  await assert.rejects(accountFetch('rpc/write',{method:'POST'}));assert.equal(calls,1);
  calls=0;globalThis.fetch=async()=>{calls++;return Response.json({code:'PGRST003'},{status:504});};
  await assert.rejects(accountFetch('rpc/write',{method:'POST'}));assert.equal(calls,3);
 }finally{globalThis.fetch=original;if(url===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=url;if(key===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=key;}
});
