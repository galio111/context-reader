"use client";
import {UiPreviewOpeningContext} from './UiPreviewOpeningContext';
import {UiStudioBridge as Bridge} from './UiStudioBridge';
import {useEffect,useState,type ReactNode} from 'react';
import type {AccountSessionState} from '@/types/account';
import {AccountProvider,useAccount} from './AccountProvider';
import {HomeOptionMenu} from './HomeOptionMenu';
import {ReaderView} from './ReaderView';
import {StudyPanel} from './StudyPanel';
import {StudyHost} from './StudyHost';
import {BookDictionary} from './BookDictionary';
import {CetLibrary,type CetEntry} from './cet/CetLibrary';
import {CetReader} from './cet/CetReader';
import {AccountUsagePageContent} from './AccountUsagePageContent';
import {BillingPage} from './BillingPage';
import {GuidePageContent} from './GuidePageContent';
import AdminPage from '@/app/admin/page';
import {installUiDesignPreview,UI_PREVIEW_ARTICLE} from '@/lib/uiDesignPreview';
import {type UiScene} from '@/lib/uiDesignRegistry';

function Scene({scene,home}:{scene:UiScene;home:ReactNode}){
 const [entry,setEntry]=useState<CetEntry|null>(null),[study,setStudy]=useState(true);
 const [menu,setMenu]=useState(false);const {account}=useAccount();
 useEffect(()=>{const open=()=>setMenu(true),openStudy=()=>setStudy(true);window.addEventListener('context-reader-open-main-menu',open);window.addEventListener('context-reader-open-study',openStudy);return()=>{window.removeEventListener('context-reader-open-main-menu',open);window.removeEventListener('context-reader-open-study',openStudy);};},[]);
 const back=()=>{const q=new URLSearchParams(location.search);q.set('screen','home');location.href=location.pathname+'?'+q;};
 if(scene==='reader')return <ReaderView article={UI_PREVIEW_ARTICLE} onBack={back} onArticleSaved={()=>{}}/>;
 if(scene==='study')return <><button onClick={()=>setStudy(true)}>继续背词</button><StudyPanel visible={study} onClose={()=>setStudy(false)} onSource={back} notice=""/><HomeOptionMenu open={menu} isAdmin={false} account={account} isOffline={false} localAccount={null} savedArticles={[]} vocabularyEntries={[]} onClose={()=>setMenu(false)} onOpenSavedArticle={()=>{}}/></>;
 if(scene==='dictionary')return <BookDictionary embedded active onBack={back} initialQuery="subtle"/>;
 if(scene==='cet')return entry?<CetReader entry={entry} onOpen={setEntry} onBack={()=>setEntry(null)} onArticleSaved={()=>{}}/>:<CetLibrary onOpen={setEntry}/>;
 if(scene==='account')return <AccountUsagePageContent embedded/>;
 if(scene==='billing')return <BillingPage/>;
 if(scene==='guide')return <GuidePageContent embedded/>;
 if(scene==='admin')return <AdminPage/>;
 return home;
}
export function UiStudioFrame({account,scene,nonce,home,skipOpening=true}:{account:AccountSessionState;scene:UiScene;nonce:string;home:ReactNode;skipOpening?:boolean}){
 const [ready,setReady]=useState(false);
 useEffect(()=>{const restore=installUiDesignPreview(account);setReady(true);return restore;},[account]);
 return ready?<UiPreviewOpeningContext.Provider value={skipOpening}><AccountProvider><Scene scene={scene} home={home}/>{scene!=='study'&&<StudyHost/>}<Bridge nonce={nonce}/></AccountProvider></UiPreviewOpeningContext.Provider>:null;
}
