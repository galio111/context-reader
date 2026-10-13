import test from 'node:test';
import assert from 'node:assert/strict';
import {compileUiDesign} from '../lib/uiDesignRuntime';
import {UI_DESIGN_TARGET_RULES,UI_TARGETS} from '../lib/uiDesignRegistry';
import {UI_EFFECTS} from '../lib/uiInventory';
import {validateUiDesignRecipe} from '../lib/uiDesign';
import {uiPreviewReadonlyAdmin} from '../lib/uiDesignPreview';

test('desktop geometry is isolated from mobile, but shared visual choices remain available',()=>{
 const css=compileUiDesign({version:1,targets:{'study.card':{offsetX:30,radius:24,mobile:{offsetY:12}}}});
 assert.match(css,/@media\(min-width:701px\)/);assert.match(css,/@media\(max-width:700px\)/);assert.match(css,/translate:30px 0px/);assert.match(css,/translate:0px 12px/);assert.match(css,/border-radius:24px/);
});
test('mobile-only entrance motion honors reduced motion and full reset has no target overrides',()=>{
 const css=compileUiDesign({version:1,targets:{'study.card':{mobile:{motion:'rise'}}}});
 assert.match(css,/prefers-reduced-motion:reduce/);assert.match(css,/StudyPanel_flashcard/);
 assert.doesNotMatch(compileUiDesign({version:1,targets:{}}),/translate:|StudyPanel_flashcard/);
});
test('gesture-owned geometry and animation cannot be overwritten by a saved design',()=>{
 const protectedTargets=UI_DESIGN_TARGET_RULES.filter(t=>/mobile-sheet|cover|ballpit|lanyard|intro|token/.test(t.id));
 for(const target of protectedTargets){assert.ok(!target.allowedFields?.includes('offsetY'),target.id);assert.ok(!target.allowedFields?.includes('motion'),target.id);}
 assert.throws(()=>validateUiDesignRecipe({version:1,targets:{'reader.mobile-sheet':{offsetY:30}}},UI_DESIGN_TARGET_RULES));
});
test('inventory ids are unique; old components and special effects are not writable recipes',()=>{
 const ids=[...UI_TARGETS,...UI_EFFECTS].map(t=>t.id);assert.equal(new Set(ids).size,ids.length);
 for(const t of UI_TARGETS.filter(t=>t.status!=='live'||t.capability!=='style'))assert.equal(UI_DESIGN_TARGET_RULES.find(r=>r.id===t.id)?.editable,false,t.id);
 assert.throws(()=>compileUiDesign({version:1,targets:{'study.rating-remembered':{componentId:'c-material-hold-button'}}}));
});
test('admin preview permits only reviewed GET requests, not probes, payments, learning or extra parameters',()=>{
 const permitted=['/api/admin/accounts?view=directory','/api/admin/billing','/api/admin/feedback','/api/admin/error-reports','/api/admin/models?config=1','/api/admin/study','/api/admin/product-analytics?days=30','/api/admin/usage?period=7&scope=reader'];
 for(const p of permitted){const url=new URL(p,'https://context-reader.com');assert.equal(uiPreviewReadonlyAdmin(url,'GET'),true,p);for(const method of ['POST','PATCH','DELETE'])assert.equal(uiPreviewReadonlyAdmin(url,method),false);}
 for(const p of ['/api/admin/models','/api/admin/models?status=1','/api/admin/models?config=1&status=1','/api/study','/api/admin/accounts?reset=1','/api/admin/billing?refund=x','/api/admin/product-analytics?days=999'])assert.equal(uiPreviewReadonlyAdmin(new URL(p,'https://context-reader.com'),'GET'),false,p);
});
