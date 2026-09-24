"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
export interface CetSelectOption { key: string; text: string }
export function CetOptionList({ anchor, options, value, label, onChoose, onClose }: {
  anchor: HTMLElement; options: CetSelectOption[]; value: string; label: string;
  onChoose: (key: string) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const callbacks = useRef({onChoose, onClose}); callbacks.current = {onChoose, onClose};
  const [active, setActive] = useState(Math.max(0, options.findIndex(o => o.key === value)));
  const [position, setPosition] = useState({left: 12, top: 12, maxHeight: 320});
  const id = useId();
  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect(), height = Math.min(352, window.innerHeight - 32);
    const below = window.innerHeight - rect.bottom - 16, above = rect.top - 16;
    const openUp = below < Math.min(height, options.length * 44 + 16) && above > below;
    const maxHeight = Math.max(44, Math.min(height, options.length * 44 + 12, openUp ? above : below));
    setPosition({left: Math.max(12, Math.min(rect.left, window.innerWidth - 292)), top: openUp ? Math.max(12, rect.top - maxHeight - 6) : rect.bottom + 6, maxHeight});
    ref.current?.focus({preventScroll:true});
  }, [anchor, options.length]);
  useEffect(() => {
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) callbacks.current.onClose(); };
    const reposition = (e: Event) => { if (ref.current?.contains(e.target as Node)) return; callbacks.current.onClose(); };
    document.addEventListener("pointerdown", close); window.addEventListener("resize", reposition); window.addEventListener("scroll", reposition, true);
    return () => {document.removeEventListener("pointerdown", close);window.removeEventListener("resize", reposition);window.removeEventListener("scroll", reposition, true);};
  }, [anchor]);
  useEffect(() => { const list = ref.current, option = list?.querySelector<HTMLElement>(`[data-index="${active}"]`); if (list && option) { if(option.offsetTop < list.scrollTop) list.scrollTop=option.offsetTop; else if(option.offsetTop+option.offsetHeight > list.scrollTop+list.clientHeight) list.scrollTop=option.offsetTop+option.offsetHeight-list.clientHeight; } }, [active]);
  const choose = (key: string) => { callbacks.current.onChoose(key); anchor.focus({preventScroll:true}); };
  return createPortal(<div ref={ref} className="cet-select-list" role="listbox" tabIndex={-1} aria-label={label} aria-activedescendant={`${id}-${active}`} style={position} onKeyDown={e => {
    if (["ArrowDown","ArrowUp","Home","End"].includes(e.key)) { e.preventDefault();setActive(i => e.key === "Home" ? 0 : e.key === "End" ? options.length-1 : (i+(e.key === "ArrowDown" ? 1 : -1)+options.length)%options.length); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault();choose(options[active].key); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation();callbacks.current.onClose();anchor.focus({preventScroll:true}); }
    else if (e.key === "Tab") {callbacks.current.onClose();anchor.focus({preventScroll:true});}
  }}>{options.map((o,i)=><div key={o.key} id={`${id}-${i}`} data-index={i} role="option" aria-selected={o.key===value} data-active={i===active} onPointerMove={()=>setActive(i)} onClick={()=>choose(o.key)}><span>{o.text}</span><span aria-hidden="true">{o.key===value ? "✓" : ""}</span></div>)}</div>, anchor.closest("dialog") || document.body);
}
export function CetSelect({label, value, options, onChange}: {label:string;value:string;options:CetSelectOption[];onChange:(key:string)=>void}) {
 const ref=useRef<HTMLButtonElement>(null);const [open,setOpen]=useState(false);
 return <><button ref={ref} type="button" className="cet-select-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen(v=>!v)} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setOpen(true);}}}>{options.find(o=>o.key===value)?.text || label}<span aria-hidden="true">⌄</span></button>{open && ref.current && <CetOptionList anchor={ref.current} options={options} value={value} label={label} onChoose={key=>{onChange(key);setOpen(false);}} onClose={()=>setOpen(false)}/>}</>;
}
