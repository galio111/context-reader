"use client";

import LZString from "lz-string";

export const LEARNING_STORAGE_EVENT = "context-reader:learning-storage";
const DATABASE = "context-reader-learning-v1";
const LEGACY_KEYS = new Set([
  "context-reader:dictionary-history-events:v1", "context-reader:dictionary-history-migrations:v1",
  "context-reader:cet-progress:v1",
  "context-reader:cet-activities:v2",
  "context-reader:cet-activities:v3",
  "context-reader:cet-finalizations:v3",
  "context-reader:cet-finalizations:v2",
  "context-reader:cet-exposures:v2",
  "context-reader:articles:v1", "context-reader:vocabulary:v1", "context-reader:explanations:v5",
  "context-reader:article-translations:v1", "context-reader:article-translation-blocks:v1",
  "context-reader:reading-states:v1", "context-reader:standalone-dictionary-history:v1",
  "context-reader:standalone-dictionary-cache:v1", "context-reader:standalone-dictionary-cache:v2",
  "context-reader:sync-state:v2", "context-reader:sync-tombstones:v1",
  "context-reader:vocabulary-conflict-recovery:v1", "context-reader:vocabulary-backup-before-dedupe:v1",
  "context-reader:local-account-owner:v1", "context-reader:recommendation-preferences:v1",
  "context-reader:cache-access:v1",
]);
const managed = (key: string) => LEGACY_KEYS.has(key) || key.startsWith("context-reader:temporary-reading:v1:");
type Descriptor = { key: string; format: "array" | "map" | "sync" | "scalar"; header?: Record<string, unknown> };
type Row = { bucket: string; id: string; json: string; order: number };
type Bucket = { descriptor: Descriptor; rows: Map<string, Row> };
type Change = { bucket: string; descriptor?: Descriptor | null; puts: Row[]; deletes: string[] };
export interface LearningStorageStatus { ready: boolean; pending: boolean; error: string; usage?: number; quota?: number }

function decode(raw: string): unknown {
  const value = raw.startsWith("lz-utf16:") ? LZString.decompressFromUTF16(raw.slice(9)) : raw;
  if (value === null) throw new Error("旧版本机数据无法读取，原数据已保留。");
  try { return JSON.parse(value); } catch { return value; }
}
function split(key: string, raw: string): Bucket {
  let value = decode(raw);
  let descriptor: Descriptor = { key, format: "scalar" };
  let entries: [string, unknown][];
  if (Array.isArray(value)) {
    descriptor = { key, format: "array" };
    entries = value.map((item, index) => [String(item?.id ?? item?.normalizedQuery ?? item?.query ?? index), item]);
    if (new Set(entries.map(([id]) => id)).size !== entries.length) entries = value.map((item, index) => [String(index), item]);
  } else if (value && typeof value === "object") {
    if (key === "context-reader:sync-state:v2") {
      const { manifest, ...header } = value as Record<string, unknown>;
      descriptor = { key, format: "sync", header };
      value = manifest || {};
    } else descriptor = { key, format: "map" };
    entries = Object.entries(value as Record<string, unknown>);
  } else entries = [["$", value]];
  return { descriptor, rows: new Map(entries.map(([id, item], order) => [id, { bucket: key, id, json: JSON.stringify(item), order }])) };
}
function join(bucket: Bucket): string {
  const rows = [...bucket.rows.values()].sort((a, b) => a.order - b.order);
  const values = rows.map(row => JSON.parse(row.json));
  if (bucket.descriptor.format === "scalar") return typeof values[0] === "string" ? values[0] : JSON.stringify(values[0]);
  if (bucket.descriptor.format === "array") return JSON.stringify(values);
  const map = Object.fromEntries(rows.map(row => [row.id, JSON.parse(row.json)]));
  return JSON.stringify(bucket.descriptor.format === "sync" ? { ...bucket.descriptor.header, manifest: map } : map);
}
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error || new Error("本机数据库写入中断。")); tx.onerror = () => reject(tx.error); });
}

export class LearningStorage implements Storage {
  readonly indexed = true;
  private buckets = new Map<string, Bucket>();
  private pending: Change[] = [];
  private db?: IDBDatabase;
  private initialization?: Promise<void>;
  private saving?: Promise<void>;
  private channel?: BroadcastChannel;
  private state: LearningStorageStatus = { ready: false, pending: false, error: "" };
  private persistedOwner: string | null = null;
  private reloadChanges: Change[] | null = null;
  private reloading?: Promise<void>;
  private reloadAgain = false;
  private rawCache = new Map<string, string>();
  constructor(private legacy: Storage, private factory: IDBFactory, private signal: (status: LearningStorageStatus, changed?: string[]) => void = () => {}) {
    for (let i = 0; i < legacy.length; i++) {
      const key = legacy.key(i)!;
      if (managed(key)) this.buckets.set(key, split(key, legacy.getItem(key)!));
    }
  }
  get status(): LearningStorageStatus { return { ...this.state }; }
  get length(): number { return this.buckets.size; }
  key(index: number): string | null { return [...this.buckets.keys()][index] ?? null; }
  getItem(key: string): string | null {
    if (!managed(key)) return this.legacy.getItem(key);
    const bucket = this.buckets.get(key);
    if (!bucket) return null;
    if (!this.rawCache.has(key)) this.rawCache.set(key, join(bucket));
    return this.rawCache.get(key)!;
  }
  getRecord(bucket: string, id: string): unknown {
    const row = this.buckets.get(bucket)?.rows.get(id);
    return row ? JSON.parse(row.json) : undefined;
  }
  setRecord(key: string, id: string, value: unknown): void {
    let bucket = this.buckets.get(key);
    const descriptor = bucket ? undefined : { key, format: "map" as const };
    if (!bucket) { bucket = { descriptor: descriptor!, rows: new Map() }; this.buckets.set(key, bucket); }
    const old = bucket.rows.get(id);
    const row: Row = { bucket: key, id, json: JSON.stringify(value), order: old?.order ?? bucket.rows.size };
    if (old?.json === row.json) return;
    bucket.rows.set(id, row); this.rawCache.delete(key);
    this.enqueue({ bucket: key, descriptor, puts: [row], deletes: [] });
  }
  setItem(key: string, raw: string): void {
    if (!managed(key)) { this.legacy.setItem(key, raw); return; }
    const next = split(key, raw), previous = this.buckets.get(key);
    const puts = [...next.rows.values()].filter(row => {
      const old = previous?.rows.get(row.id);
      return !old || old.json !== row.json || old.order !== row.order;
    });
    const deletes = [...(previous?.rows.keys() || [])].filter(id => !next.rows.has(id));
    const descriptor = JSON.stringify(previous?.descriptor) === JSON.stringify(next.descriptor) ? undefined : next.descriptor;
    if (!puts.length && !deletes.length && !descriptor) return;
    this.buckets.set(key, next); this.rawCache.delete(key);
    this.enqueue({ bucket: key, descriptor, puts, deletes });
  }
  removeItem(key: string): void {
    if (!managed(key)) { this.legacy.removeItem(key); return; }
    const bucket = this.buckets.get(key);
    this.buckets.delete(key); this.rawCache.delete(key);
    this.enqueue({ bucket: key, descriptor: null, puts: [], deletes: [...(bucket?.rows.keys() || [])] });
  }
  clear(): void { for (const key of [...this.buckets.keys()]) this.removeItem(key); }
  private announce(changed?: string[]) { this.signal(this.status, changed); }
  private enqueue(change: Change) {
    this.reloadChanges?.push(change);
    this.pending.push(change); this.state.pending = true; this.announce();
    if (this.state.ready) queueMicrotask(() => { void this.flush().catch(() => {}); });
  }
  private fail(error: unknown) {
    this.state.error = error instanceof Error && error.name === "QuotaExceededError"
      ? "本机网站存储空间不足，尚未保存的更改仍在此页面，请保留页面并导出备份。"
      : error instanceof Error ? error.message : "本机数据库暂时无法写入，请保留页面并重试。";
    this.announce();
  }
  async initialize(): Promise<void> {
    if (this.initialization) return this.initialization;
    this.initialization = this.open().catch(error => { this.initialization = undefined; this.fail(error); throw error; });
    return this.initialization;
  }
  private async readBuckets(): Promise<Map<string, Bucket>> {
    const tx = this.db!.transaction(["collections", "records"], "readonly");
    const [descriptors, rows] = await Promise.all([
      request(tx.objectStore("collections").getAll()) as Promise<Descriptor[]>,
      request(tx.objectStore("records").getAll()) as Promise<Row[]>,
    ]);
    const buckets = new Map(descriptors.map(descriptor => [descriptor.key, { descriptor, rows: new Map<string, Row>() }]));
    for (const row of rows) buckets.get(row.bucket)?.rows.set(row.id, row);
    return buckets;
  }
  private async importLegacyTail(): Promise<void> {
    const incoming = new Map<string, string>();
    for (let i = 0; i < this.legacy.length; i++) { const key = this.legacy.key(i)!; if (managed(key)) incoming.set(key, this.legacy.getItem(key)!); }
    if (!incoming.size) return;
    const current = await this.readBuckets();
    const owner = current.get("context-reader:local-account-owner:v1");
    const oldOwner = incoming.get("context-reader:local-account-owner:v1");
    if (oldOwner && (!owner || oldOwner !== join(owner))) throw new Error("旧标签页的账号与本机数据库不一致，请先在旧页面导出备份并关闭该页面。");
    const changes: Row[] = [], descriptors: Descriptor[] = [];
    for (const [key, raw] of incoming) {
      // Never adopt obsolete cursors or another tab's account owner.
      if (key === "context-reader:sync-state:v2" || key === "context-reader:local-account-owner:v1") continue;
      const previousRaw = await request(this.db!.transaction("legacyBackup").objectStore("legacyBackup").get(key)) as string | undefined;
      const baseline = previousRaw ? split(key, previousRaw) : undefined;
      const bucket = split(key, raw), existing = current.get(key);
      if (!existing) descriptors.push(bucket.descriptor);
      for (const row of bucket.rows.values()) {
        const old = existing?.rows.get(row.id);
        if (row.json === baseline?.rows.get(row.id)?.json || row.json === old?.json) continue;
        const value = JSON.parse(row.json), oldValue = old ? JSON.parse(old.json) : null;
        const at = Date.parse(value?.updatedAt || value?.createdAt || "") || 0;
        const oldAt = Date.parse(oldValue?.updatedAt || oldValue?.createdAt || "") || 0;
        const deleted = current.get("context-reader:sync-state:v2")?.rows.get(`${key === "context-reader:articles:v1" ? "article" : "vocabulary"}:${row.id}`);
        if (deleted && JSON.parse(deleted.json)?.deleted) continue;
        if (!old || at > oldAt || (key === "context-reader:sync-tombstones:v1" && String(value) > String(oldValue))) changes.push(row);
      }
    }
    const tx = this.db!.transaction(["records", "collections", "legacyBackup"], "readwrite"); const done = completed(tx);
    for (const [key, raw] of incoming) tx.objectStore("legacyBackup").put(raw, `incoming:${key}`);
    for (const descriptor of descriptors) tx.objectStore("collections").put(descriptor);
    for (const row of changes) tx.objectStore("records").put(row);
    await done;
    const verified = await this.readBuckets();
    for (const row of changes) if (verified.get(row.bucket)?.rows.get(row.id)?.json !== row.json) throw new Error("旧标签页数据合并未完成，原数据已保留。");
    for (const [key, raw] of incoming) if (this.legacy.getItem(key) === raw) this.legacy.removeItem(key);
    this.legacy.removeItem("context-reader:indexeddb-sync-recovery:v1");
  }
  private async open() {
    const req = this.factory.open(DATABASE, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("records", { keyPath: ["bucket", "id"] });
      db.createObjectStore("collections", { keyPath: "key" });
      db.createObjectStore("legacyBackup");
      db.createObjectStore("meta");
      db.createObjectStore("bootstrap");
    };
    req.onblocked = () => { this.state.error = "请关闭其他旧版 Context Reader 标签页后重试本机数据升级。"; this.announce(); };
    this.db = await request(req);
    this.db.onversionchange = () => { this.db?.close(); this.state.error = "网站数据版本已更新，请刷新页面。"; this.announce(); };
    const migrated = await request(this.db.transaction("meta").objectStore("meta").get("migrated"));
    if (!migrated) {
      const originals = new Map<string, string>();
      for (let i = 0; i < this.legacy.length; i++) { const key = this.legacy.key(i)!; if (managed(key)) originals.set(key, this.legacy.getItem(key)!); }
      const tx = this.db.transaction(["records", "collections", "legacyBackup"], "readwrite");
      const done = completed(tx);
      tx.objectStore("records").clear(); tx.objectStore("collections").clear();
      for (const [key, raw] of originals) {
        const bucket = split(key, raw);
        tx.objectStore("legacyBackup").put(raw, key);
        tx.objectStore("collections").put(bucket.descriptor);
        for (const row of bucket.rows.values()) tx.objectStore("records").put(row);
      }
      await done;
      const verified = await this.readBuckets();
      for (const [key, raw] of originals) {
        if (!verified.has(key) || join(verified.get(key)!) !== join(split(key, raw))) throw new Error("本机数据迁移校验未通过，旧数据与备份均已保留。");
        if (this.legacy.getItem(key) !== raw) throw new Error("旧标签页正在更改数据，请关闭旧标签页后重新加载。");
      }
      const markerTx = this.db.transaction("meta", "readwrite"); const marked = completed(markerTx);
      markerTx.objectStore("meta").put(true, "migrated"); await marked;
      for (const [key, raw] of originals) if (this.legacy.getItem(key) === raw) this.legacy.removeItem(key);
    }
    if (migrated) await this.importLegacyTail();
    this.buckets = await this.readBuckets(); this.rawCache.clear();
    this.persistedOwner = this.getItem("context-reader:local-account-owner:v1");
    for (const change of this.pending) this.apply(change);
    this.state.ready = true; this.state.error = "";
    this.announce([...this.buckets.keys()]);
    // Browser-only invalidation; never sends learning content across the channel.
    if (typeof window !== "undefined" && typeof window.BroadcastChannel !== "undefined") {
      this.channel = new window.BroadcastChannel(DATABASE);
      this.channel.onmessage = () => { void this.reload().catch(error => this.fail(error)); };
    }
    await this.flush();
  }
  private apply(change: Change) {
    if (change.descriptor === null) { this.buckets.delete(change.bucket); return; }
    let bucket = this.buckets.get(change.bucket);
    if (!bucket) { if (!change.descriptor) return; bucket = { descriptor: change.descriptor, rows: new Map() }; this.buckets.set(change.bucket, bucket); }
    if (change.descriptor) bucket.descriptor = change.descriptor;
    for (const id of change.deletes) bucket.rows.delete(id);
    for (const row of change.puts) bucket.rows.set(row.id, row);
  }
  async reload(): Promise<void> {
    if (this.reloading) { this.reloadAgain = true; return this.reloading; }
    this.reloading = (async () => {
      do {
        this.reloadAgain = false;
        await this.initialize(); await this.flush();
        this.reloadChanges = [];
        try {
          const loaded = await this.readBuckets();
          const ownerBucket = loaded.get("context-reader:local-account-owner:v1");
          const owner = ownerBucket ? join(ownerBucket) : null;
          if (owner !== this.persistedOwner && this.reloadChanges.length) throw new Error("账号已在其他标签页切换，本页更改已保留，请先导出备份再刷新。");
          this.buckets = loaded; this.rawCache.clear(); this.persistedOwner = owner;
          for (const change of this.reloadChanges) this.apply(change);
          this.announce([...loaded.keys()]);
        } finally { this.reloadChanges = null; }
      } while (this.reloadAgain);
    })().finally(() => { this.reloading = undefined; });
    return this.reloading;
  }

  async flush(): Promise<void> {
    if (!this.state.ready) { await this.initialize(); return; }
    if (this.saving) { await this.saving; if (this.pending.length) await this.flush(); return; }
    if (!this.pending.length) return;
    const changes = this.pending.splice(0);
    this.saving = (async () => {
      const tx = this.db!.transaction(["records", "collections"], "readwrite"); const done = completed(tx);
      const nextOwner = this.getItem("context-reader:local-account-owner:v1");
      let writeError: unknown;
      const ownerRequest = tx.objectStore("records").get(["context-reader:local-account-owner:v1", "$"]);
      ownerRequest.onsuccess = () => {
        try {
          const currentOwner = ownerRequest.result ? JSON.parse((ownerRequest.result as Row).json) : null;
          if (currentOwner !== this.persistedOwner) throw new Error("账号已在其他标签页切换，本页更改已保留，请先导出备份再刷新。");
          for (const change of changes) {
            if (change.descriptor === null) tx.objectStore("collections").delete(change.bucket);
            else if (change.descriptor) tx.objectStore("collections").put(change.descriptor);
            for (const id of change.deletes) tx.objectStore("records").delete([change.bucket, id]);
            for (const row of change.puts) tx.objectStore("records").put(row);
          }
        } catch (error) { writeError = error; tx.abort(); }
      };
      await done.catch(error => { throw writeError || error; });
      this.persistedOwner = nextOwner;

      this.state.error = "";
      this.channel?.postMessage({ changed: [...new Set(changes.map(c => c.bucket))] });
    })().catch(error => { this.pending.unshift(...changes); this.fail(error); throw error; }).finally(() => { this.saving = undefined; this.state.pending = this.pending.length > 0; this.announce(); });
    await this.saving;
    if (this.pending.length) await this.flush();
  }
  async archiveOwner(owner: string): Promise<void> {
    await this.initialize(); await this.flush();
    const snapshot = Object.fromEntries([...this.buckets.keys()].map(key => [key, this.getItem(key)]));
    const tx = this.db!.transaction("meta", "readwrite"); const done = completed(tx);
    tx.objectStore("meta").put(snapshot, `archive:${owner}`); await done;
  }
  async restoreOwner(owner: string): Promise<void> {
    const saved = await request(this.db!.transaction("meta").objectStore("meta").get(`archive:${owner}`)) as Record<string, string> | undefined;
    if (saved) for (const [key, value] of Object.entries(saved)) this.setItem(key, value);
    await this.flush();
  }
  async stageGet<T>(key: string): Promise<T | undefined> { await this.initialize(); return request(this.db!.transaction("bootstrap").objectStore("bootstrap").get(key)); }
  async stagePut(key: string, value: unknown): Promise<void> { await this.initialize(); const tx = this.db!.transaction("bootstrap", "readwrite"); const done = completed(tx); tx.objectStore("bootstrap").put(value, key); await done; }
  async clearStage(): Promise<void> { await this.initialize(); const tx = this.db!.transaction("bootstrap", "readwrite"); const done = completed(tx); tx.objectStore("bootstrap").clear(); await done; }
  async estimate(): Promise<void> { if (typeof navigator !== "undefined" && navigator.storage?.estimate) { const estimate = await navigator.storage.estimate(); this.state = { ...this.state, ...estimate }; this.announce(); } }
  close(): void { this.channel?.close(); this.db?.close(); }
}

const instances = new WeakMap<Storage, LearningStorage>();
export function getLearningStorage(): Storage {
  if (typeof window === "undefined") throw new Error("本机数据库只在浏览器中可用。");
  const legacy = window.localStorage;
  let storage = instances.get(legacy);
  if (!storage) {
    if (!window.indexedDB) throw new Error("此浏览器未开放网站数据库，请允许网站存储或使用普通浏览窗口。");
    storage = new LearningStorage(legacy, window.indexedDB, (status, changed) => {
      window.dispatchEvent(new CustomEvent(LEARNING_STORAGE_EVENT, { detail: { ...status, changed } }));
      if (changed) window.dispatchEvent(new CustomEvent("context-reader:account-data-merged", { detail: { kinds: [] } }));
    });
    instances.set(legacy, storage);
  }
  return storage;
}
export function isLearningStorage(storage: Storage): storage is LearningStorage { return storage instanceof LearningStorage; }
export async function initializeLearningStorage(): Promise<void> { const storage = getLearningStorage(); if (isLearningStorage(storage)) await storage.initialize(); }
export async function flushLearningStorage(): Promise<void> { const storage = getLearningStorage(); if (isLearningStorage(storage)) await storage.flush(); }

export async function downloadLearningBackup(): Promise<void> {
  const storage = getLearningStorage();
  await flushLearningStorage().catch(() => {});
  const stores = Object.fromEntries(Array.from({ length: storage.length }, (_, index) => storage.key(index)!).filter(key => managed(key)).map(key => [key, storage.getItem(key)]));
  const blob = new Blob([JSON.stringify({ format: "context-reader-local-backup-v1", exportedAt: new Date().toISOString(), stores })], { type: "application/json" });
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = `context-reader-local-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
