import { readDiscoverySetting, writeDiscoverySetting, type DiscoverySite } from './discoveryStore';
import { canonicalArticleUrl, readSourceFeed, type FeedItem } from './recommendationFeed';
import { sourceAllowsArticleUrl } from './recommendationSources';
import { shanghaiDay } from './discoveryPolicy';
import { applyIntakeFailure, intakeDue, type IntakeEntry, type IntakeStage } from './editorialIntakePolicy';

interface IntakeSource {
  lastScanDay?: string; lastScanAt?: string; lastSuccessAt?: string;
  feedErrors: string[]; entries: Record<string, IntakeEntry>;
}
const key = (id: string) => `recommendation_editorial_intake_v1_${id}`;
export const readEditorialIntake = (id: string) => readDiscoverySetting<IntakeSource>(key(id), { feedErrors: [], entries: {} });
const save = (id: string, state: IntakeSource) => writeDiscoverySetting(key(id), state);

/** Hourly discovery continues after paid editorial work closes, so short feeds do not roll past us overnight. */
export async function pollEditorialFeeds(sites: DiscoverySite[], now = Date.now(), capture = captureEditorialSource) {
  const pollKey = 'recommendation_editorial_feed_poll_v1';
  const previous = await readDiscoverySetting<{nextAt?:number;remaining?:string[];startedAt?:number}>(pollKey, {});
  if ((previous.nextAt || 0) > now) return;
  const enabled = sites.filter(s => s.enabled && s.verification?.ok);
  const remaining = (previous.remaining || enabled.map(s => s.id)).filter(id => enabled.some(s => s.id === id));
  for (const id of remaining.slice(0, 3)) await capture(enabled.find(s => s.id === id)!, 1, true);
  const rest = remaining.slice(3), startedAt = previous.startedAt || now;
  await writeDiscoverySetting(pollKey, rest.length ? {remaining:rest,startedAt} : {nextAt:Math.max(now,startedAt)+3600_000,completedAt:new Date(now).toISOString()});
}

/** The discovery lease owns writes. Store discoveries before spending on import or models. */
export async function captureEditorialSource(site: DiscoverySite, page = 1, force = false, readFeed = readSourceFeed) {
  const state = await readEditorialIntake(site.id), today = shanghaiDay();
  if (!force && page === 1 && state.lastScanDay === today) return state;
  const results = await Promise.allSettled(site.feeds.map(feed => {
    const url = new URL(feed);
    if (page > 1 && site.feedPagination !== 'none' && /\/feed(?:\/rss)?\/?$/.test(url.pathname)) url.searchParams.set('paged', String(Math.min(6, page)));
    return readFeed({ ...site, feedUrl: url.href }, site.topics[0]);
  }));
  const at = new Date().toISOString();
  state.feedErrors = [];
  // Keep decisions for 30 days; unresolved entries never expire when RSS rotates.
  for (const [url, entry] of Object.entries(state.entries)) {
    if (['candidate', 'skipped', 'rejected'].includes(entry.state) && Date.parse(entry.updatedAt) < Date.now() - 30 * 86400_000) delete state.entries[url];
  }
  for (const result of results) {
    if (result.status === 'rejected') { state.feedErrors.push(String(result.reason).slice(0, 300)); continue; }
    for (const item of result.value) {
      const canonical = canonicalArticleUrl(item.url);
      if (!canonical || state.entries[canonical]) continue;
      // Never silently evict unresolved work. A full queue is a visible source fault.
      if (Object.keys(state.entries).length >= 5000) { state.feedErrors.push('待处理记录达到存储边界，请处理积压后重新读取来源。'); break; }
      state.entries[canonical] = { url: item.url, title: item.title, description: item.description.slice(0, 2000), publishedAt: item.publishedAt,
        firstSeenAt: at, updatedAt: at, attempts: 0, state: 'waiting' };
    }
  }
  state.lastScanDay = today; state.lastScanAt = at;
  if (!state.feedErrors.length) state.lastSuccessAt = at;
  await save(site.id, state);
  return state;
}

/** Bounded, free feed collection covers all enabled sources, independently of category deficits. */
export async function captureEditorialRound(sites: DiscoverySite[], scanSince?: string) {
  const enabled = sites.filter(s => s.enabled && s.verification?.ok);
  const states = await Promise.all(enabled.map(async site => ({ site, state: await readEditorialIntake(site.id) })));
  const remaining = states.filter(row => row.state.lastScanDay !== shanghaiDay() || scanSince && Date.parse(row.state.lastScanAt || '') < Date.parse(scanSince));
  for (const row of remaining.slice(0, 3)) await captureEditorialSource(row.site, 1, true);
  return remaining.length <= 3;
}
export function queuedFeedItems(site: DiscoverySite, state: IntakeSource, now = Date.now()): FeedItem[] {
  return Object.values(state.entries).filter(entry => intakeDue(entry, now) && sourceAllowsArticleUrl(site, entry.url))
    .sort((a, b) => Date.parse(a.firstSeenAt) - Date.parse(b.firstSeenAt))
    .map(entry => ({ ...entry, source: site, relevance: 0 }));
}
export async function recordEditorialIntake(item: FeedItem, result: { error: unknown; stage: IntakeStage } | { candidateId: string } | { skipped: string }) {
  const state = await readEditorialIntake(item.source.id), canonical = canonicalArticleUrl(item.url);
  const entry = state.entries[canonical];
  if (!entry) return; // Existing-candidate refresh is journalled by the runner.
  state.entries[canonical] = 'error' in result ? applyIntakeFailure(entry, result.error, result.stage)
    : { ...entry, state: 'candidateId' in result ? 'candidate' : 'skipped', updatedAt: new Date().toISOString(), nextAttemptAt: undefined,
      ...('candidateId' in result ? { candidateId: result.candidateId } : { reason: result.skipped }) };
  await save(item.source.id, state);
}
export async function editorialIntakeStatus(sites: DiscoverySite[]) {
  return Promise.all(sites.filter(s => s.enabled).map(async site => {
    const state = await readEditorialIntake(site.id), entries = Object.values(state.entries);
    return { id: site.id, name: site.name, lastScanAt: state.lastScanAt, lastSuccessAt: state.lastSuccessAt, feedErrors: state.feedErrors,
      counts: Object.fromEntries(['waiting', 'retry', 'attention', 'rejected', 'skipped', 'candidate'].map(k => [k, entries.filter(e => e.state === k).length])),
      issues: entries.filter(e => e.state === 'retry' || e.state === 'attention').sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).slice(0, 20),
      decisions: entries.filter(e => e.state === 'rejected').sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).slice(0, 10),
      due: entries.filter(e => intakeDue(e)).length };
  }));
}

/** Explicit Admin retry reopens technical work only, retaining the previous evidence. */
export async function retryEditorialIntake(siteId: string, url: string) {
  const state = await readEditorialIntake(siteId), canonical = canonicalArticleUrl(url), entry = state.entries[canonical];
  if (!entry || !['attention', 'retry'].includes(entry.state)) throw new Error('该记录不是待处理的技术问题。');
  await writeDiscoverySetting(`recommendation_editorial_intake_retry_${Date.now()}`, { siteId, previous: entry });
  state.entries[canonical] = { ...entry, state: 'waiting', attempts: 0, nextAttemptAt: undefined, updatedAt: new Date().toISOString() };
  await save(siteId, state);
}
