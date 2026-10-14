import test from "node:test";
import assert from "node:assert/strict";
import {issueStudyOfflinePermit,verifyStudyOfflinePermit} from "../lib/studyOfflinePermit";
test("offline permission is account scoped, signed, and rejects invented old/future events",()=>{
 const previous=process.env.ADMIN_SESSION_SECRET;process.env.ADMIN_SESSION_SECRET="test-only-study-offline-signing-secret";
 try{const now=Date.now(),token=issueStudyOfflinePermit("alice",now);
  assert.equal(verifyStudyOfflinePermit(token,"alice",new Date(now).toISOString(),now),true);
  assert.equal(verifyStudyOfflinePermit(token,"bob",new Date(now).toISOString(),now),false);
  assert.equal(verifyStudyOfflinePermit(token+"x","alice",new Date(now).toISOString(),now),false);
  assert.equal(verifyStudyOfflinePermit(token,"alice",new Date(now-3600000).toISOString(),now),false);
  assert.equal(verifyStudyOfflinePermit(token,"alice",new Date(now+3600000).toISOString(),now),false);
  assert.equal(verifyStudyOfflinePermit(token,"alice",new Date(now+86400000).toISOString(),now+86400000),true);
 }finally{if(previous===undefined)delete process.env.ADMIN_SESSION_SECRET;else process.env.ADMIN_SESSION_SECRET=previous;}
});
