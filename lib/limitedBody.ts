export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large.");
    this.name = "RequestBodyTooLargeError";
  }
}

export async function readRequestBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestBodyTooLargeError();
  }
  if (!request.body) {
    throw new SyntaxError("Request body is empty.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readJsonBody<T = unknown>(request: Request, maxBytes: number): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await readRequestBytes(request, maxBytes))) as T;
}

export async function readFormDataBody(request: Request, maxBytes: number): Promise<FormData> {
  const bytes = await readRequestBytes(request, maxBytes);
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const boundedRequest = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
  });
  return boundedRequest.formData();
}
