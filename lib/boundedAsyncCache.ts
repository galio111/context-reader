/** Small process-local read cache. Never use for identity, entitlement or quota. */
export class BoundedAsyncCache<T> {
  private values = new Map<string, { value: T; expires: number; bytes: number }>();
  private pending = new Map<string, Promise<T>>();
  private generation = 0;
  private bytes = 0;
  constructor(private readonly ttlMs: number, private readonly maxEntries: number, private readonly maxBytes: number) {}

  clear(): void {
    this.generation++;
    this.values.clear();
    this.pending.clear();
    this.bytes = 0;
  }

  async get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.values.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const running = this.pending.get(key);
    if (running) return running;
    // Bound retained promises too; uncached loads still retain their normal route limits.
    if (this.pending.size >= this.maxEntries) return load();
    const generation = this.generation;
    const task = Promise.resolve().then(load).then(value => {
      const bytes = Buffer.byteLength(JSON.stringify(value) ?? "null");
      if (generation === this.generation && bytes <= this.maxBytes) {
        const previous = this.values.get(key);
        if (previous) { this.bytes -= previous.bytes; this.values.delete(key); }
        while (this.values.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
          const oldest = this.values.keys().next().value;
          if (oldest === undefined) break;
          this.bytes -= this.values.get(oldest)!.bytes;
          this.values.delete(oldest);
        }
        this.values.set(key, { value, expires: Date.now() + this.ttlMs, bytes });
        this.bytes += bytes;
      }
      return value;
    }).finally(() => { if (this.pending.get(key) === task) this.pending.delete(key); });
    this.pending.set(key, task);
    return task;
  }
}
