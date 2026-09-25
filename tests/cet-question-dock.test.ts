import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {useCetQuestionDock} from '../components/cet/useCetQuestionDock';
test('dock opens once, pause hides synchronously and restores intent; close cancels pending automatic opening',async()=>{
 const dom=new JSDOM('<body></body>',{url:'http://localhost',pretendToBeVisual:true});
 for(const [key,value]of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window),IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 const {renderHook,act,cleanup}=await import('@testing-library/react');
 const h=renderHook(({key,available})=>useCetQuestionDock(key,available),{initialProps:{key:'owner:a:section',available:true}});
 await act(async()=>{await new Promise(r=>setTimeout(r,250));});assert.equal(h.result.current.open,true);
 h.rerender({key:'owner:a:section',available:false});assert.equal(h.result.current.open,false);
 h.rerender({key:'owner:a:section',available:true});assert.equal(h.result.current.open,true);
 act(()=>h.result.current.close());h.rerender({key:'owner:a:section',available:true});assert.equal(h.result.current.open,false);
 h.rerender({key:'owner:b:section',available:true});act(()=>h.result.current.close());await act(async()=>{await new Promise(r=>setTimeout(r,250));});assert.equal(h.result.current.open,false);
 act(()=>h.result.current.show());assert.equal(h.result.current.open,true);cleanup();dom.window.close();
});

