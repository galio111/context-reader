import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign, createCipheriv, randomBytes } from "node:crypto";
import { learningPoints, remainingCredit, addMemberMonths, englishWordCount } from "../lib/billingPolicy";
import { verifyWechat, decryptWechatNotification, wechatReady } from "../lib/wechatPay";
test("points follow actual word boundaries and explicit feature weights", () => {
 assert.equal(learningPoints("lookup"),1); assert.equal(learningPoints("standalone_dictionary"),5);
 assert.equal(learningPoints("sentence_question"),5);assert.equal(learningPoints("article_summary"),2);
 for(const [words,points] of [[1,10],[500,10],[501,20],[1000,20],[1001,30]])assert.equal(learningPoints("full_article_translation",words),points);
 assert.equal(englishWordCount("It's a well-known café. 中文 123"),4);
});
test("depleted accounts carry no credit, early upgrades respect both limits",()=>{
 assert.equal(remainingCredit(600,.8,0),0);assert.equal(remainingCredit(600,.2,.8),120);
 assert.equal(remainingCredit(600,.8,.2),120);assert.equal(remainingCredit(600,2,2),600);
 assert.equal(addMemberMonths("2026-01-30T18:00:00Z",1),"2026-02-27T18:00:00.000Z");
 assert.equal(addMemberMonths("2026-01-30T18:00:00Z",2),"2026-03-30T18:00:00.000Z");
});
test("WeChat accepts verified envelopes and rejects tampering, stale timestamps and foreign keys",()=>{
 const {privateKey,publicKey}=generateKeyPairSync("rsa",{modulusLength:2048});
 const old={...process.env};
 try {
 process.env.WECHAT_PAY_PUBLIC_KEY_ID="PUB_KEY_ID_TEST";process.env.WECHAT_PAY_PUBLIC_KEY=publicKey.export({type:"spki",format:"pem"}).toString();
 const body='{"amount":{"total":600}}'; const t=String(Math.floor(Date.now()/1000));
 const signer=createSign("RSA-SHA256");signer.update(t+"\nnonce\n"+body+"\n");signer.end();
 const h=new Headers({"Wechatpay-Timestamp":t,"Wechatpay-Nonce":"nonce","Wechatpay-Serial":"PUB_KEY_ID_TEST","Wechatpay-Signature":signer.sign(privateKey,"base64")});
 assert.doesNotThrow(()=>verifyWechat(h,body));assert.throws(()=>verifyWechat(h,body+" "));
 h.set("wechatpay-serial","FOREIGN");assert.throws(()=>verifyWechat(h,body));
 h.set("wechatpay-serial","PUB_KEY_ID_TEST");h.set("wechatpay-timestamp","1");assert.throws(()=>verifyWechat(h,body));
 assert.equal(wechatReady(),false);
 process.env.WECHAT_PAY_ENABLED="true";process.env.WECHAT_PAY_APP_ID="test";process.env.WECHAT_PAY_MCH_ID="test";
 process.env.WECHAT_PAY_SERIAL="test";process.env.WECHAT_PAY_PRIVATE_KEY="test";process.env.WECHAT_PAY_NOTIFY_URL="https://example.test/notify";
 process.env.WECHAT_PAY_API_V3_KEY="01234567890123456789012345678901";
 const nonce=randomBytes(12),aad=Buffer.from("transaction");const cipher=createCipheriv("aes-256-gcm",Buffer.from(process.env.WECHAT_PAY_API_V3_KEY),nonce);cipher.setAAD(aad);
 const transaction={appid:"test",trade_state:"SUCCESS",amount:{total:600}};
 const encrypted=Buffer.concat([cipher.update(JSON.stringify(transaction)),cipher.final(),cipher.getAuthTag()]);
 // Nonce in actual notifications is an ASCII string; build a second valid ASCII envelope.
 const ascii="0123456789ab",c2=createCipheriv("aes-256-gcm",Buffer.from(process.env.WECHAT_PAY_API_V3_KEY),ascii);c2.setAAD(aad);
 const ct=Buffer.concat([c2.update(JSON.stringify(transaction)),c2.final(),c2.getAuthTag()]);
 const envelope={event_type:"TRANSACTION.SUCCESS",resource:{algorithm:"AEAD_AES_256_GCM",nonce:ascii,associated_data:"transaction",ciphertext:ct.toString("base64")}};
 assert.deepEqual(decryptWechatNotification(JSON.stringify(envelope)),transaction);
 envelope.resource.ciphertext=encrypted.toString("base64");assert.throws(()=>decryptWechatNotification(JSON.stringify(envelope)));
 } finally { for(const k of Object.keys(process.env))if(k.startsWith("WECHAT_PAY_") && !(k in old))delete process.env[k];Object.assign(process.env,old); }
});
