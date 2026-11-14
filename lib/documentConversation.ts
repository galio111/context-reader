/** Bounded continuous conversation; keep old questions instead of a four-turn window.
 * Older answers use labelled head/tail excerpts when the entire conversation is
 * too long. The durable history is never rewritten by this transport projection.
 */
export function documentConversation(history: readonly {question:string;answer:string}[] = []) {
  const turns=history.filter(t=>t.question.trim() && t.answer.trim()).slice(-512);
  if(turns.reduce((n,t)=>n+t.question.length+t.answer.length,0)<=40000)return turns.map(t=>({question:t.question.slice(0,1000),answer:t.answer}));
  const shorten=(text:string,limit:number)=>{
    if(text.length<=limit)return text;
    const label="\n（较早内容节选）\n",available=Math.max(2,limit-label.length),head=Math.ceil(available*.65);
    return text.slice(0,head)+label+text.slice(-(available-head));
  };
  const questionBudget=Math.min(16000,turns.reduce((n,t)=>n+t.question.length,0));
  const perQuestion=Math.max(30,Math.floor(questionBudget/Math.max(1,turns.length)));
  const rows=turns.map(t=>({question:shorten(t.question,Math.min(1000,perQuestion)) ,answer:t.answer}));
  const available=40000-rows.reduce((n,t)=>n+t.question.length,0);
  // Reserve full recent answers first; older turns still remain in the model's
  // actual conversation messages with their questions and answer excerpts.
  const recentStart=Math.max(0,rows.length-8);
  const olderAllowance=recentStart?Math.min(16000,Math.floor(available*.45)):0;
  const recentAllowance=available-olderAllowance;
  for(let i=0;i<rows.length;i++){
    const limit=i<recentStart?Math.max(32,Math.floor(olderAllowance/recentStart)):Math.max(32,Math.floor(recentAllowance/(rows.length-recentStart)));
    rows[i].answer=shorten(rows[i].answer,limit);
  }
  return rows;
}
