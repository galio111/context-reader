"use client";
import {useEffect, useRef, useState, type FormEvent, type ReactNode} from "react";
import {defaultUrgentColor,priorityLabels, type Task, type Settings} from "./planner-model";

export function EditorDialog({title, close, children}: {title:string;close:()=>void;children:ReactNode}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {const el = ref.current; if (!el?.open) el?.showModal(); return () => el?.close()}, []);
  return <dialog ref={ref} className="td-dialog" aria-label={title} onCancel={e=>{e.preventDefault();close()}}>
    <div className="td-heading"><h2>{title}</h2><button type="button" aria-label="关闭设置" onClick={close}>关闭</button></div>{children}
  </dialog>;
}
export function InlineEditor({task, categories, save, cancel}: {task:Task;categories:string[];save:(task:Task)=>Promise<void>;cancel:()=>void}) {
  const [draft, set] = useState(task);
  const [error, setError] = useState(""), [saving, setSaving] = useState(false);
  const update = <K extends keyof Task>(key:K, value:Task[K]) => set(old=>({...old,[key]:value}));
  async function submit(event:FormEvent) {
    event.preventDefault(); if (saving || !draft.title.trim()) return;
    setSaving(true);setError("");
    try {await save({...draft,title:draft.title.trim(),lead:draft.daily || !draft.date ? 0 : draft.lead,time:draft.daily || draft.date ? draft.time : ""})}
    catch(e){setError((e as Error).message);setSaving(false)}
  }
  return <form className="td-inline" onSubmit={submit} onKeyDown={e=>{if(e.key==="Escape"&&!saving){e.preventDefault();cancel()}}}>
    <label>待办内容<input autoFocus required maxLength={300} value={draft.title} onChange={e=>update("title",e.target.value)}/></label>
    <div className="td-fields">
      <label>{draft.daily ? "从哪天起" : "截止日期"}<input type="date" value={draft.date} onChange={e=>update("date",e.target.value)}/></label>
      <label>具体时间<input type="time" value={draft.time} disabled={!draft.date && !draft.daily} onChange={e=>update("time",e.target.value)}/></label>
      <label>分类<select value={draft.category} onChange={e=>update("category",e.target.value)}><option value="">未分类</option>{categories.map(c=><option key={c}>{c}</option>)}</select></label>
      <label>优先级<select value={draft.priority} onChange={e=>update("priority",e.target.value as Task["priority"])}>{Object.entries(priorityLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <div><label>事项标色<input type="color" value={draft.color || defaultUrgentColor} onChange={e=>update("color",e.target.value)}/></label>
        {draft.color && <button type="button" className="td-link" onClick={()=>update("color",undefined)}>恢复自动标色</button>}</div>
      {!draft.daily && draft.date && <label>提前几天开工<input type="number" min={0} max={365} value={draft.lead} onChange={e=>update("lead",Number(e.target.value))}/></label>}
      <label>重复<select value={draft.daily?"daily":"once"} onChange={e=>update("daily",e.target.value==="daily")}><option value="once">一次性</option><option value="daily">每天</option></select></label>
      {draft.daily && <label>当天漏做<select value={draft.missed} onChange={e=>update("missed",e.target.value as Task["missed"])}><option value="skip">次日跳过</option><option value="carry">保留待补</option></select></label>}
    </div>
    <div className="td-actions"><button className="td-primary" disabled={saving}>{saving?"保存中…":"保存修改"}</button><button type="button" onClick={cancel} disabled={saving}>取消</button></div>
    {error && <p role="alert">{error}</p>}
  </form>;
}
export function SettingsEditor({settings,categories,onSave,close}: {settings:Settings;categories:string[];onSave:(next:Settings,added:string[],removed:string[])=>Promise<void>;close:()=>void}) {
  const [draft,set] = useState(settings), [initialNames] = useState(categories), [names,setNames] = useState(categories), [category,setCategory] = useState("");
  const [error,setError] = useState(""), [saving,setSaving] = useState(false);
  const change = <K extends keyof Settings>(key:K,value:Settings[K])=>set(old=>({...old,[key]:value}));
  const add = () => {const name=category.trim(); if(name && !names.includes(name)) setNames(old=>[...old,name]);setCategory("")};
  async function submit(e:FormEvent) {
    e.preventDefault(); if(saving)return;setSaving(true);setError("");
    const text=category.trim(); const newNames=text && !names.includes(text)?[...names,text]:names;
    try {await onSave({...draft,emailAddress:draft.emailAddress.trim()},newNames.filter(name=>!initialNames.includes(name)),initialNames.filter(name=>!newNames.includes(name)));close()}
    catch(e){setError((e as Error).message);setSaving(false)}
  }
  return <EditorDialog close={()=>{if(!saving)close()}} title="待办设置"><form onSubmit={submit}>
    <fieldset><legend>邮件提醒</legend>
      <label className="td-check-label"><input type="checkbox" checked={draft.emailEnabled} onChange={e=>change("emailEnabled",e.target.checked)}/>临近截止且还没勾选时发邮件</label>
      <p>仅一次性待办发送提醒，邮件包含标题和时间。时间按上海时区计算。</p>
      <label>收件邮箱<input type="email" autoComplete="email" required={draft.emailEnabled} value={draft.emailAddress} onChange={e=>change("emailAddress",e.target.value)}/></label>
      <div className="td-fields"><label>有时刻的事项提前几分钟<input type="number" min={0} max={10080} required value={draft.remindMinutes} onChange={e=>change("remindMinutes",Number(e.target.value))}/></label>
      <label>全天事项当天几点发信<input type="time" required value={draft.allDayTime} onChange={e=>change("allDayTime",e.target.value)}/></label></div>
    </fieldset>
    <fieldset><legend>显示颜色</legend>
      <label>紧急事项颜色<input type="color" value={draft.urgentColor || defaultUrgentColor} onChange={e=>change("urgentColor",e.target.value)}/></label>
      <p>高优先级、已到开工日、临近或超过截止时间的事项自动标色。</p>
    </fieldset>
    <fieldset><legend>录入习惯</legend>
      <label className="td-check-label"><input type="checkbox" checked={draft.learnDefaults} onChange={e=>change("learnDefaults",e.target.checked)}/>参考我的历史待办，建议分类和常用默认值</label>
      <label>新建每日任务时默认<select value={draft.defaultMissed} onChange={e=>change("defaultMissed",e.target.value as Settings["defaultMissed"])}><option value="skip">漏做自动跳过</option><option value="carry">漏做留到次日补办</option></select></label>
    </fieldset>
    <fieldset><legend>我的分类</legend><div className="td-tags">{names.map(name=><span key={name}>{name}<button type="button" aria-label={"删除分类「"+name+"」"} disabled={saving} onClick={()=>setNames(list=>list.filter(n=>n!==name))}>×</button></span>)}</div>
      {initialNames.some(name=>!names.includes(name)) && <div className="td-removed-categories">
        <p>保存后，这些分类下的待办将移到「未分类」。</p>
        {initialNames.filter(name=>!names.includes(name)).map(name=><button type="button" key={name} disabled={saving} onClick={()=>setNames(list=>[...list,name])}>撤销删除「{name}」</button>)}
      </div>}
      <div className="td-actions"><input aria-label="新分类名称" placeholder="新分类名称" maxLength={32} value={category} onChange={e=>setCategory(e.target.value)} onKeyDown={e=>{if(e.key==="Enter" && !e.nativeEvent.isComposing){e.preventDefault();add()}}}/><button type="button" onClick={add} disabled={!category.trim()}>添加</button></div>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    <div className="td-actions"><button className="td-primary" disabled={saving}>{saving?"保存中…":"保存设置"}</button><button type="button" onClick={close} disabled={saving}>取消</button></div>
  </form></EditorDialog>;
}
