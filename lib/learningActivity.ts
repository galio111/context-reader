/** Count intervals between deliberate foreground interactions; never award an idle tail. */
export class LearningActivity {
  private previous:number|null=null;
  private total=0;
  constructor(private idleMs:number){}
  start(now:number){this.previous=now;}
  touch(now:number,foreground:boolean){
    if(!foreground){this.previous=null;return;}
    if(this.previous!==null){const gap=now-this.previous;if(gap>=0&&gap<=this.idleMs)this.total+=gap;}
    this.previous=now;
  }
  pause(){this.previous=null;}
  take(){const value=this.total;this.total=0;return value;}
}
export function claimLearningTab(owner:string,id:string){
  const key="context-reader-active-learning:"+owner;
  try { const previous=localStorage.getItem(key);localStorage.setItem(key,id);return !previous||previous===id; }
  catch { return true; }
}
