import {createHash, randomUUID} from "node:crypto";
import {accountFetch} from "./accountStore";
import {sendTodoDeadlineEmail, todoDeadlineEmailConfigured} from "./siteNotificationEmail";
import {dueTodoReminders, todoEmailText, type ReminderWorkspace} from "./privateTodoReminderSchedule";

type WorkspaceRow = { owner_id:string; revision:number; state:ReminderWorkspace };
type Outcome = "sent" | "retry" | "uncertain";
const dbRpc = <T>(name:string, payload:object) => accountFetch<T>("rpc/"+name, {method:"POST",body:JSON.stringify(payload)});
const services = {
  async load(): Promise<WorkspaceRow | null> {
    const rows = await accountFetch<WorkspaceRow[]>("personal_todo_workspace?singleton=eq.true&state->settings->>emailEnabled=eq.true&select=owner_id,revision,state&limit=1");
    return rows[0] || null;
  },
  start: (row:WorkspaceRow, key:string, task:string, dispatch:string) =>
    dbRpc<boolean>("start_personal_todo_delivery", {p_owner:row.owner_id,p_revision:row.revision,p_key:key,p_task:task,p_dispatch:dispatch}),
  send: sendTodoDeadlineEmail,
  finish: (owner:string, key:string, dispatch:string, result:Outcome) =>
    dbRpc<void>("finish_personal_todo_delivery", {p_owner:owner,p_key:key,p_dispatch:dispatch,p_result:result}),
  now: Date.now
};
export async function checkTodoReminders() {
  const [workspace] = await Promise.all([
    accountFetch<{singleton:boolean}[]>("personal_todo_workspace?singleton=eq.true&select=singleton&limit=1"),
    accountFetch<unknown[]>("personal_todo_delivery?select=phase&limit=0")
  ]);
  return {workspaceReady:workspace.length === 1, smtpConfigured:todoDeadlineEmailConfigured()};
}
export async function processTodoReminders(deps = services) {
  const summary = {sent:0, retry:0, uncertain:0};
  const row = await deps.load();
  if (!row) return summary;
  const candidates = dueTodoReminders(row.state, deps.now());
  for (const initial of candidates) {
    const fresh = await deps.load();
    if (!fresh || fresh.owner_id !== row.owner_id) break;
    const now = deps.now();
    const task = dueTodoReminders(fresh.state, now).find(r => r.key === initial.key);
    if (!task) continue;
    const dispatch = randomUUID();
    if (!await deps.start(fresh, task.key, task.taskId, dispatch)) continue;
    const mail = todoEmailText(task, now);
    const messageId = "<todo." + createHash("sha256").update(fresh.owner_id + ":" + task.key).digest("hex") + "@context-reader.com>";
    // Persist "sending" before SMTP. An ambiguous SMTP outcome or a process death
    // stays suppressed: blindly retrying could deliver a duplicate to the owner.
    const status = await deps.send(fresh.state.settings.emailAddress, mail.subject, mail.text, messageId);
    await deps.finish(fresh.owner_id,task.key,dispatch,status);
    summary[status]++;
  }
  return summary;
}
