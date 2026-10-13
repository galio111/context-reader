import 'server-only';
import {readPublishedUiDesign} from '@/lib/uiDesignStore';
import {emptyUiDesignRecipe,type UiDesignPublicState} from './uiDesign';
let current:UiDesignPublicState={recipe:emptyUiDesignRecipe(),revision:0,updatedAt:null},expires=0,pending:Promise<UiDesignPublicState>|null=null,generation=0;
export function invalidatePublishedDesign(){generation++;expires=0;pending=null;}
export async function publishedDesignState(){
 if(Date.now()<expires)return current;
 if(!pending){const epoch=generation;const request=readPublishedUiDesign().then(value=>{if(epoch===generation){current=value;expires=Date.now()+5000;}return current;}).catch(()=>{if(epoch===generation)expires=Date.now()+5000;return current;}).finally(()=>{if(pending===request)pending=null;});pending=request;}
 // An unavailable design store must not prevent article entry.
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([pending,new Promise<UiDesignPublicState>(resolve=>{timer=setTimeout(()=>resolve(current),800);})]);}finally{clearTimeout(timer);}
}
export async function publishedDesignForPage(){return (await publishedDesignState()).recipe;}
