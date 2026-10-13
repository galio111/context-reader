import test from 'node:test';
import assert from 'node:assert/strict';
import {uiTargetScene,uiEffectTarget} from '../lib/uiDesignNavigation';
import {UI_DESIGN_TARGET_RULES} from '../lib/uiDesignRegistry';
import {validateUiDesignRecipe} from '../lib/uiDesign';
import {galioOptions} from '../lib/uiDesignRuntime';

test('inventory destinations distinguish guest, member, reader and study states',()=>{
 for(const [id,group,scene] of [['home.title','home','guest'],['home.quick-import','home','home'],['study.entry','study','home'],['study.retention','study','study'],['reader.dictionary','reader','reader'],['account.login-input','account','guest'],['global.pronunciation','global','dictionary'],['admin.panel','admin','admin']])assert.equal(uiTargetScene(id,group),scene,id);
});
test('native capsule effect resolves to a real editable button with its new adapter',()=>{
 const id=uiEffectTarget('effect.pill-fill');assert.equal(id,'global.pill-button');
 const recipe=validateUiDesignRecipe({version:1,targets:{[id]:{componentId:'c-buttons-context-pill'}}},UI_DESIGN_TARGET_RULES);
 assert.equal(recipe.targets[id].componentId,'c-buttons-context-pill');
});
test('clearing explicit text color does not keep a previous SDK option',()=>{
 assert.equal(galioOptions({textColor:'#aabbcc'}).textColor,'#aabbcc');assert.equal(galioOptions({}).textColor,null);
 assert.equal(galioOptions({componentId:'c-buttons-context-pill'}).duration,300);
});
