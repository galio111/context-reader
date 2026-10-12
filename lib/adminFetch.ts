// Share concurrent reads only. No stored responses, cached authorization or
// browser persistence; mutations always reach the server independently.
const pending = new Map<string, Promise<Response>>();
export async function adminFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if ((init.method ?? "GET").toUpperCase() !== "GET" || init.signal || init.headers) {
    return fetch(input, init);
  }
  let request = pending.get(input);
  if (!request) {
    request = fetch(input, { ...init, cache: "no-store" });
    pending.set(input, request);
    void request.finally(() => {
      if (pending.get(input) === request) pending.delete(input);
    }).catch(() => {});
  }
  return (await request).clone();
}
