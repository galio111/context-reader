import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
test('DNS failures retry once and remain distinct from unsafe destinations',async()=>{
 const require=createRequire(import.meta.url);const dns=require('node:dns/promises');const original=dns.lookup;let calls=0;let mode='recover';
 dns.lookup=async()=>{calls++;if(mode==='fail'||(mode==='recover'&&calls===1))throw Object.assign(new Error('temporary'),{code:'EAI_AGAIN'});return [{address:mode==='private'?'127.0.0.1':'93.184.216.34',family:4}];};
 try {const {assertSafeRemoteUrl,RemoteDnsError,UnsafeRemoteUrlError}=await import('../lib/safeRemoteFetch');await assertSafeRemoteUrl('https://example.org/story');assert.equal(calls,2);mode='fail';calls=0;await assert.rejects(()=>assertSafeRemoteUrl('https://example.org/'),RemoteDnsError);assert.equal(calls,2);mode='private';await assert.rejects(()=>assertSafeRemoteUrl('https://example.org/'),UnsafeRemoteUrlError);await assert.rejects(()=>assertSafeRemoteUrl('http://127.0.0.1/'),UnsafeRemoteUrlError);}finally{dns.lookup=original;}
});
