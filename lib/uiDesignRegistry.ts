import targets from './ui-targets.json';
import type { UiDesignTargetRule, UiVisualField } from './uiDesign';
export const UI_GROUPS:Record<string,string>={home:'首页',reader:'阅读',cet:'四、六级',study:'背单词',dictionary:'词典',menu:'菜单',account:'账号',pricing:'套餐',guide:'使用说明',admin:'后台',global:'通用效果',legacy:'旧版留档'};
export const UI_TARGETS=targets;
export const UI_SCENES=[['home','首页 · 登录后'],['guest','首页 · 游客'],['reader','文章阅读'],['study','背单词'],['dictionary','词典'],['cet','四、六级'],['account','账号'],['billing','套餐'],['guide','使用说明'],['admin','后台']] as const;
export type UiScene=typeof UI_SCENES[number][0];
export function sceneForGroup(group:string):UiScene{return ({pricing:'billing',menu:'home',global:'home',legacy:'home'} as Record<string,UiScene>)[group]??(UI_SCENES.some(([id])=>id===group)?group as UiScene:'home');}
export const UI_BUTTON_COMPONENTS=['split','fill','circle','underline','shortcut','physical','reveal-arrow','pill','flip'].map(x=>'c-buttons-'+x);
export const UI_HOVER_COMPONENTS=['arrow-loop','radial','magnet','line-draw','tilt','spotlight','reveal','lift','border-trace'].map(x=>'c-hover-'+x);
const ownsTransform=(id:string)=>/mobile-sheet|mobile-dock|cover|ballpit|lanyard|intro|token|edit-canvas/.test(id);
const common:UiVisualField[]=['accent','background','textColor','font','fontSize','radius','padding','gap','opacity'];
export const UI_DESIGN_TARGET_RULES:UiDesignTargetRule[]=[{id:'site-background',editable:true,allowedFields:['background','accent']},...UI_TARGETS.map(t=>({id:t.id,editable:t.status==='live'&&t.capability==='style'&&!!t.selector,
 allowedFields:[...common,...(t.mayMoveWithinLayout&&!ownsTransform(t.id)?['width','maxWidth','offsetX','offsetY','order'] as UiVisualField[]:[]),...(t.kind==='button'?['material','componentId'] as UiVisualField[]:[]),...(['container','overlay','text'].includes(t.kind)&&!ownsTransform(t.id)?['motion','motionDuration'] as UiVisualField[]:[])],
 componentIds:t.kind==='button'?[...UI_BUTTON_COMPONENTS,...UI_HOVER_COMPONENTS]:[]}))];
export function targetRule(id:string){return UI_DESIGN_TARGET_RULES.find(t=>t.id===id);}
