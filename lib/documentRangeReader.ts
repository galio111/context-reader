import { cacheDocument, readCachedDocument } from "./documentBinaryCache";
import { MAX_DOCUMENT_BYTES } from "./documentSource";

export const DOCUMENT_RANGE_CHUNK = 256 * 1024;
interface RangeIO {
  read(key: string): Promise<ArrayBuffer | null>;
  write(key: string, bytes: ArrayBuffer): Promise<void>;
  fetch: typeof fetch;
}

/** Cache only bytes needed for reading, without a competing whole-file transfer. */
export async function openDocumentRanges(owner: string | null, id: string, url: string, signal: AbortSignal,
  io: RangeIO = { read: key => readCachedDocument(owner, key), write: (key, bytes) => cacheDocument(owner, key, bytes), fetch: (...args) => fetch(...args) }) {
  const sizeKey = `${id}:range-size-v1`;
  const savedSize = await io.read(sizeKey);
  let length = savedSize?.byteLength === 4 ? new DataView(savedSize).getUint32(0) : 0;
  if (length > MAX_DOCUMENT_BYTES) length = 0;
  let full: ArrayBuffer | null = null;
  const pending = new Map<number, Promise<ArrayBuffer>>();
  async function chunk(begin: number): Promise<ArrayBuffer> {
    const key = `${id}:range-v1:${begin}`;
    if (length) {
      const cached = await io.read(key);
      if (cached?.byteLength === Math.min(DOCUMENT_RANGE_CHUNK, length - begin)) return cached;
    }
    const end = length ? Math.min(length, begin + DOCUMENT_RANGE_CHUNK) : begin + DOCUMENT_RANGE_CHUNK;
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      try {
        const response = await io.fetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` }, cache: "no-store",
          signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
        if (!response.ok) throw new Error("文档暂时无法读取，请稍后重试。");
        const range = response.headers.get("content-range")?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
        const bytes = await response.arrayBuffer();
        signal.throwIfAborted();
        if (response.status === 200 && begin === 0 && bytes.byteLength && bytes.byteLength <= MAX_DOCUMENT_BYTES) {
          length = bytes.byteLength; full = bytes;
          await io.write(id, bytes);
          return bytes;
        }
        if (response.status !== 206 || !range || Number(range[1]) !== begin || Number(range[2]) + 1 !== begin + bytes.byteLength
          || Number(range[3]) < begin + bytes.byteLength || Number(range[3]) > MAX_DOCUMENT_BYTES
          || (length && Number(range[3]) !== length) || bytes.byteLength !== Math.min(DOCUMENT_RANGE_CHUNK, Number(range[3]) - begin)) {
          throw new Error("文档读取不完整，请稍后重试。");
        }
        length = Number(range[3]);
        // Memory cache is seeded synchronously; persistence must not delay paint.
        void io.write(key, bytes).catch(() => undefined);
        const size = new ArrayBuffer(4); new DataView(size).setUint32(0, length);
        void io.write(sizeKey, size).catch(() => undefined);
        return bytes;
      } catch (error) {
        if (signal.aborted || attempt >= 1) throw error;
      }
    }
  }
  const load = (begin: number) => {
    let job = pending.get(begin);
    if (!job) { job = chunk(begin); pending.set(begin, job); job.catch(() => pending.delete(begin)); }
    return job;
  };
  const initialData = new Uint8Array((await load(0)).slice(0));
  return {
    length, initialData, full,
    async read(begin: number, end: number): Promise<Uint8Array> {
      signal.throwIfAborted();
      if (begin < 0 || end > length || begin >= end) throw new Error("Invalid document range");
      if (full) return new Uint8Array(full.slice(begin, end));
      const starts: number[] = [];
      for (let offset = Math.floor(begin / DOCUMENT_RANGE_CHUNK) * DOCUMENT_RANGE_CHUNK; offset < end; offset += DOCUMENT_RANGE_CHUNK) starts.push(offset);
      const chunks = await Promise.all(starts.map(load));
      signal.throwIfAborted();
      const joined = new Uint8Array(end - begin);
      starts.forEach((start, index) => {
        const from = Math.max(begin, start), to = Math.min(end, start + chunks[index].byteLength);
        joined.set(new Uint8Array(chunks[index], from - start, to - from), from - begin);
      });
      return joined;
    },
  };
}
