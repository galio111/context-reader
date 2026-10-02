import type { CetActivity, CetFinalization, CetListeningPlayback, CetPaper, CetSection } from "../types/cet";

export function validListeningSnapshots(value: CetFinalization["listeningSections"]): boolean {
  if(value===undefined)return true;
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length>1)return false;
  return Object.entries(value).every(([id,s])=>Boolean(id.endsWith('-listening')&&s&&s.audio
    &&/^\/cet-audio\/[a-f0-9]{64}\.(mp3|m4a)$/.test(s.audio.url)
    &&/^[a-f0-9]{64}$/.test(s.audio.sha256)&&s.audio.url.includes(s.audio.sha256)
    &&['audio/mpeg','audio/mp4'].includes(s.audio.mimeType)
    &&Number.isFinite(s.audio.durationSeconds)&&s.audio.durationSeconds>0&&s.audio.durationSeconds<=7200
    &&Number.isFinite(s.audio.bytes)&&s.audio.bytes>=1000&&s.audio.bytes<=104857600
    &&(s.audio.attribution===undefined||(Array.isArray(s.audio.attribution)&&s.audio.attribution.length<=6&&s.audio.attribution.every(a=>a&&typeof a.title==='string'&&a.title.length<=200&&typeof a.url==='string'&&/^https:\/\/[^\s]{1,500}$/.test(a.url)&&(a.license===undefined||(typeof a.license==='string'&&a.license.length<=100))&&(a.licenseUrl===undefined||(typeof a.licenseUrl==='string'&&/^https:\/\/[^\s]{1,500}$/.test(a.licenseUrl))))))
    &&Array.isArray(s.groups)&&s.groups.length>0&&s.groups.length<=10
    &&s.groups.every(g=>g&&typeof g.id==='string'&&typeof g.title==='string'
      &&Array.isArray(g.questionNumbers)&&g.questionNumbers.length>0&&g.questionNumbers.every(n=>Number.isInteger(n)&&n>=1&&n<=25)
      &&Array.isArray(g.transcript)&&g.transcript.length>0&&g.transcript.length<=50&&g.transcript.every(t=>typeof t==='string'&&t.length<=20000))));
}

export function validListeningPlayback(value: unknown): value is CetListeningPlayback {
  const p = value as CetListeningPlayback | null;
  return Boolean(p && Number.isFinite(p.position) && p.position >= 0 && p.position <= 7200
    && ["ready", "playing", "paused", "ended", "interrupted"].includes(p.state)
    && Number.isFinite(Date.parse(p.at)) && typeof p.eventId === "string" && p.eventId.length <= 100);
}
export function mergeListeningPlayback(a: CetActivity["listeningPlayback"], b: CetActivity["listeningPlayback"]) {
  const merged: NonNullable<CetActivity["listeningPlayback"]> = {};
  for (const [key, p] of [...Object.entries(a || {}), ...Object.entries(b || {})]) {
    if (!validListeningPlayback(p)) continue;
    const old = merged[key];
    if (!old || `${p.at}:${p.eventId}` > `${old.at}:${old.eventId}`) merged[key] = p;
  }
  return merged;
}
export function recordListeningPlayback(activity: CetActivity, sectionId: string, position: number, state: CetListeningPlayback["state"], now = Date.now()): CetActivity {
  if (!activity.sectionIds.includes(sectionId) || activity.status !== "in_progress" || !Number.isFinite(position) || position < 0) return activity;
  const previous = activity.listeningPlayback?.[sectionId];
  const at = new Date(Math.max(now, Date.parse(activity.updatedAt) + 1, previous ? Date.parse(previous.at) + 1 : 0)).toISOString();
  return { ...activity, updatedAt: at,
    listeningPlayback: { ...activity.listeningPlayback, [sectionId]: { position: Math.min(7200, position), state, at, eventId: crypto.randomUUID() } },
    conditions: activity.purpose === "self_test" && state === "interrupted" ? [...new Set([...activity.conditions, "listening_interrupted"])] : activity.conditions,
  };
}
export function listeningVisibleText(section: CetSection, revealed: (number: number) => boolean): string[] {
  return (section.listeningGroups || []).flatMap(group => [
    ...section.questions.filter(q => group.questionNumbers.includes(q.number)).flatMap(q => [q.stem, ...q.options.map(o => `${o.key}. ${o.text}`)]),
    ...(group.questionNumbers.every(revealed) ? group.transcript : []),
  ]);
}
export function listeningDefaultMinutes(paper: CetPaper, sectionId?: string) {
  const sections = sectionId ? paper.sections.filter(s => s.id === sectionId) : paper.sections;
  const audioSeconds = sections.reduce((sum,s) => sum + (s.audio?.durationSeconds || 0), 0);
  return audioSeconds ? Math.ceil(audioSeconds / 60) + (sectionId ? 5 : 40) : sectionId ? 10 : 40;
}
