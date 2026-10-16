import type { StudyLocalRecord } from "./studyOffline";

// One transaction owns both the authoritative base and the pending journal.
// Acknowledgements cannot delete an answer without persisting its replacement.
export async function updateStudyLocalRecord(owner:string,change:(record:StudyLocalRecord|null)=>StudyLocalRecord|null,factory:IDBFactory=indexedDB):Promise<StudyLocalRecord|null>{
  if(!owner)throw new Error("请先登录后开始学习。");
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{
    const r=factory.open("context-reader-study-offline",1);
    r.onupgradeneeded=()=>r.result.createObjectStore("sessions",{keyPath:"owner"});
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction("sessions","readwrite"),store=tx.objectStore("sessions"),r=store.get(owner);
    let result:StudyLocalRecord|null=null;
    r.onsuccess=()=>{try{result=change(r.result??null);if(result&&result!==r.result)store.put(result);}catch(e){tx.abort();reject(e);}};
    tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(tx.error??new Error("本机无法保存学习记录，请释放空间后重试。"));
  });}finally{db.close();}
}
