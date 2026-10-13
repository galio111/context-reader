"use client";
import {useEffect,useRef,useState} from 'react';
import {usePathname} from 'next/navigation';
import {mountUiDesign} from '@/lib/uiDesignRuntime';
import {validateUiDesignRecipe,type UiDesignRecipe} from '@/lib/uiDesign';
import {UI_DESIGN_TARGET_RULES} from '@/lib/uiDesignRegistry';
export function UiDesignPublicRuntime({initial,initialRevision}:{initial:UiDesignRecipe;initialRevision:number}){
 const path=usePathname(),disabled=path.startsWith('/admin/ui-studio');const [recipe,setRecipe]=useState(initial);
 const revision=useRef(initialRevision);
 useEffect(()=>{document.querySelector('style[data-ui-design="initial"]')?.remove();if(disabled)return;return mountUiDesign(recipe);},[recipe,disabled]);
 useEffect(()=>{if(disabled)return;let alive=true,inFlight=false;const refresh=async()=>{if(document.hidden||inFlight)return;inFlight=true;try{const r=await fetch('/api/ui-design',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!r.ok)return;const value=await r.json();if(!Number.isSafeInteger(value.revision)||value.revision<revision.current)return;const next=validateUiDesignRecipe(value.recipe,UI_DESIGN_TARGET_RULES);if(alive){revision.current=value.revision;setRecipe(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);}}catch{}finally{inFlight=false;}};void refresh();const timer=setInterval(()=>void refresh(),15000);const visible=()=>void refresh();document.addEventListener('visibilitychange',visible);return()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[disabled]);
 return null;
}
