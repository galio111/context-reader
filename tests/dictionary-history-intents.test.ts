import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {initializeLearningStorage,flushLearningStorage,getLearningStorage,isLearningStorage} from '../lib/learningStorage';
import {beginDictionaryQuery,recordStandaloneDictionaryHistory,readStandaloneDictionaryHistory,removeStandaloneDictionaryHistory,migrateStandaloneDictionarySessionHistory,readDictionaryHistoryEvents,mergeDictionaryHistoryEvents,STANDALONE_DICTIONARY_HISTORY_KEY,DICTIONARY_HISTORY_MIGRATIONS_KEY,writeStandaloneDictionaryHistory} from '../lib/standaloneDictionaryHistory';
import {prepareLocalAccountForUser} from '../lib/accountSyncClient';
async function fixture(run:()=>Promise<void>) {
 const dom=new JSDOM('',{url:'https://context-reader.com'});
 Object.assign(globalThis,{window:dom.window,CustomEvent:dom.window.CustomEvent});Object.defineProperty(window,'indexedDB',{value:new IDBFactory()});
 await initializeLearningStorage();getLearningStorage().setItem('context-reader:local-account-owner:v1','A');
 try {await run();}finally{await flushLearningStorage();const s=getLearningStorage();if(isLearningStorage(s))s.close();dom.window.close();}
}
test('legacy session migration -> delete -> remount never resurrects cached Chinese query',()=>fixture(async()=>{
 await migrateStandaloneDictionarySessionHistory(['我崩溃了'],'A');assert.equal(readStandaloneDictionaryHistory().length,1);
 await removeStandaloneDictionaryHistory('我崩溃了');assert.equal(readStandaloneDictionaryHistory().length,0);
 await migrateStandaloneDictionarySessionHistory(['我崩溃了'],'A');assert.equal(readStandaloneDictionaryHistory().length,0);
}));
test('migration is stable, owner-verified and never promotes missing cache entries into new durable history',()=>fixture(async()=>{
 await migrateStandaloneDictionarySessionHistory(['unowned']);assert.equal(getLearningStorage().getItem(STANDALONE_DICTIONARY_HISTORY_KEY),null);
 await migrateStandaloneDictionarySessionHistory(['other'],'B');assert.equal(readStandaloneDictionaryHistory().length,0);
 await migrateStandaloneDictionarySessionHistory(['old'],'A');const old=readStandaloneDictionaryHistory()[0];assert.ok(old.lastLookedUpAt.startsWith('2000-'));
 await migrateStandaloneDictionarySessionHistory(['old','new cache'],'A');assert.deepEqual(readStandaloneDictionaryHistory(),[old]);
}));
test('delete normalizes NFKC, spaces, case without touching unrelated Chinese records, cache or vocabulary',()=>fixture(async()=>{
 const s=getLearningStorage();s.setItem('context-reader:vocabulary:v1','[]');s.setItem('context-reader:standalone-dictionary-cache:v2','[]');
 recordStandaloneDictionaryHistory('ＴＡＫＥ   in');recordStandaloneDictionaryHistory('我崩溃了');
 await removeStandaloneDictionaryHistory('take in');assert.deepEqual(readStandaloneDictionaryHistory().map(x=>x.query),['我崩溃了']);
 assert.equal(s.getItem('context-reader:vocabulary:v1'),'[]');assert.equal(s.getItem('context-reader:standalone-dictionary-cache:v2'),'[]');
}));
test('request intent issued before deletion cannot resurrect; explicit new cached lookup can, old delete replay cannot undo it',()=>fixture(async()=>{
 const pending=beginDictionaryQuery('word');recordStandaloneDictionaryHistory('word',pending);
 await removeStandaloneDictionaryHistory('word');const deletes=readDictionaryHistoryEvents();
 recordStandaloneDictionaryHistory('word',pending);assert.equal(readStandaloneDictionaryHistory().length,0);
 const fresh=beginDictionaryQuery('word');recordStandaloneDictionaryHistory('word',fresh);recordStandaloneDictionaryHistory('word',fresh);
 mergeDictionaryHistoryEvents(getLearningStorage(),deletes);assert.equal(readStandaloneDictionaryHistory().length,1);
 assert.equal(readDictionaryHistoryEvents().filter(x=>x.id===fresh.event.id).length,1);
}));
test('persistent deletion masks old cloud/bootstrap active rows before and after event replay',()=>fixture(async()=>{
 recordStandaloneDictionaryHistory('word');const old=readStandaloneDictionaryHistory();await removeStandaloneDictionaryHistory('word');
 writeStandaloneDictionaryHistory(getLearningStorage(),old);assert.equal(readStandaloneDictionaryHistory().length,0);
 await flushLearningStorage();mergeDictionaryHistoryEvents(getLearningStorage(),readDictionaryHistoryEvents());assert.equal(readStandaloneDictionaryHistory().length,0);
}));
test('concurrent unknown deletion wins over a query that did not observe it, independent of clocks',()=>fixture(async()=>{
 const q=beginDictionaryQuery('word');recordStandaloneDictionaryHistory('word',q);
 mergeDictionaryHistoryEvents(getLearningStorage(),[{id:'other-device-delete',kind:'delete',query:'word',normalizedQuery:'word',at:'2001-01-01T00:00:00Z',observedDeletes:[]}]);
 assert.equal(readStandaloneDictionaryHistory().length,0);recordStandaloneDictionaryHistory('word');assert.equal(readStandaloneDictionaryHistory().length,1);
}));
test('account archive/restore keeps deletion and rejects stale owner request',()=>fixture(async()=>{
 const pending=beginDictionaryQuery('word');recordStandaloneDictionaryHistory('word');await removeStandaloneDictionaryHistory('word');
 await prepareLocalAccountForUser('B');recordStandaloneDictionaryHistory('word',pending);assert.equal(readStandaloneDictionaryHistory().length,0);
 recordStandaloneDictionaryHistory('B only');await prepareLocalAccountForUser('A');assert.equal(readStandaloneDictionaryHistory().length,0);
 await prepareLocalAccountForUser('B');assert.deepEqual(readStandaloneDictionaryHistory().map(i=>i.query),['B only']);
}));
test('migration flush failure cannot mark complete; deletion storage failure rejects',()=>fixture(async()=>{
 const s=getLearningStorage();assert.ok(isLearningStorage(s));const original=s.flush.bind(s);s.flush=async()=>{throw Error('disk failure');};
 await assert.rejects(migrateStandaloneDictionarySessionHistory(['old'],'A'));assert.equal(s.getItem(DICTIONARY_HISTORY_MIGRATIONS_KEY),null);
 await assert.rejects(removeStandaloneDictionaryHistory('old'));s.flush=original;
 await migrateStandaloneDictionarySessionHistory(['old'],'A');assert.equal(readStandaloneDictionaryHistory().length,0);
}));
