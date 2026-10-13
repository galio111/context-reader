import {notFound} from 'next/navigation';
import {getAdminAccessMode} from '@/lib/adminAuth';
import {getAccountPlan} from '@/lib/accountStore';
import {previewAccount} from '@/lib/experiencePreview';
import {UI_SCENES,type UiScene} from '@/lib/uiDesignRegistry';
import {UiStudioFrame} from '@/components/UiStudioFrame';
import HomePage from '@/app/page';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{screen?:string;nonce?:string}>}){
 if(await getAdminAccessMode()!=='developer')notFound();
 const q=await searchParams;if(!q.nonce||!/^[a-f0-9-]{36}$/i.test(q.nonce))notFound();
 const scene=(UI_SCENES.some(([id])=>id===q.screen)?q.screen:'home') as UiScene;
 const account=previewAccount(await getAccountPlan(scene==='guest'?'guest':'plus'),'available');
 return <UiStudioFrame account={account} scene={scene} nonce={q.nonce} home={['home','guest'].includes(scene)?<HomePage searchParams={Promise.resolve({preview:scene==='guest'?'guest':undefined})}/>:null}/>;
}
