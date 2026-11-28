import {accountFetch} from "@/lib/accountStore";
import {privateTodoAccess,todoAccessFailure,todoResponse} from "@/lib/privateTodoAccess";
import {isoDay} from "@/components/todo/planner-model";
import type {CalendarEvent,TodoTask} from "@/lib/privateTodoState";

export const dynamic="force-dynamic";

function civilDate(s:string|null):s is string {
  if(!s || !/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
  const parsed=new Date(s+"T12:00:00Z");
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0,10)===s;
}

export async function GET(request:Request) {
  const access=await privateTodoAccess();
  if(access.kind!=="owner")return todoAccessFailure(access.kind);
  const params=new URL(request.url).searchParams,from=params.get("from"),to=params.get("to");
  if(!civilDate(from)||!civilDate(to)||from>to||to>isoDay()||Date.parse(to)-Date.parse(from)>365*86400000)
    return todoResponse({error:"日志日期范围无效。"},400);
  type Plan={day:string;tasks:TodoTask[];events:CalendarEvent[]};
  const base="personal_todo_day_plan?select=day,tasks,events&owner_id=eq."+encodeURIComponent(access.id);
  try {
    const [prior,changes]=await Promise.all([
      accountFetch<Plan[]>(base+"&day=lte."+from+"&order=day.desc&limit=1"),
      accountFetch<Plan[]>(base+"&day=gt."+from+"&day=lte."+to+"&order=day.asc")
    ]);
    if(!prior.length)return todoResponse({error:"这段日期没有可用的日志底稿。"},503);
    return todoResponse({plans:[...prior,...changes]});
  } catch {return todoAccessFailure("unavailable")}
}
