import {timingSafeEqual} from "node:crypto";
import {checkTodoReminders, processTodoReminders} from "@/lib/privateTodoReminderServer";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = {"Cache-Control":"private, no-store"};
export async function GET(request:Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const actual = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from("Bearer " + (secret || ""));
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual,expected)) return Response.json({error:"Unauthorized"},{status:401,headers});
  try {
    if (new URL(request.url).searchParams.get("check") === "1") {
      const check = await checkTodoReminders();
      return Response.json({ok:check.workspaceReady,...check},{status:check.workspaceReady ? 200 : 503, headers});
    }
    const summary = await processTodoReminders();
    return Response.json({ok:true,...summary},{headers});
  } catch {
    return Response.json({ok:false,error:"提醒任务暂时不可用。"},{status:503,headers});
  }
}
