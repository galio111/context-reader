import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {startupSessionScript, takeStartupSession} from '../lib/startupSession';

test('startup performs one live noncached check and exposes no persisted authority',async()=>{
  let calls=0;
  const target: {__crInitialSession?:Promise<Response|null>;location:{hash:string}}={location:{hash:""}};
  const sandbox={window:target,navigator:{onLine:true},AbortController,setTimeout,clearTimeout,fetch:async(url:string,options:RequestInit)=>{calls++;assert.equal(url,'/api/auth/session');assert.equal(options.cache,'no-store');return new Response('{}');}};
  vm.runInNewContext(startupSessionScript,sandbox);
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{value:target,configurable:true});
  try {
    assert.ok(await takeStartupSession());
    assert.equal(takeStartupSession(),undefined);
    assert.equal(calls,1);
  } finally {if(previous) Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
});

test('offline startup never starts a request; network failure is handled without rejection',async()=>{
  const target: {__crInitialSession?:Promise<Response|null>;location:{hash:string}}={location:{hash:""}};
  const sandbox={window:target,navigator:{onLine:false},AbortController,setTimeout,clearTimeout,fetch:async()=>{throw Error('offline');}};
  vm.runInNewContext(startupSessionScript,sandbox);assert.equal(target.__crInitialSession,undefined);
  sandbox.navigator.onLine=true;vm.runInNewContext(startupSessionScript,sandbox);assert.equal(await target.__crInitialSession,null);
});

 test('session adoption links do not race an old live check',()=>{
   const window={location:{hash:'#access_token=new&refresh_token=token'}};
   vm.runInNewContext(startupSessionScript,{window,navigator:{onLine:true},fetch:()=>{throw Error('must not race session adoption');}});
   assert.equal('__crInitialSession' in window,false);
 });
