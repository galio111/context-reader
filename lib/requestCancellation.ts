export type StreamTermination = "cancelled" | "timeout" | "failed";

export class ClientRequestCancelledError extends Error {
  constructor(message = "The client cancelled the request.") {
    super(message);
    this.name = "ClientRequestCancelledError";
  }
}

export function classifyStreamTermination(input: {
  clientAborted: boolean;
  timedOut: boolean;
  error: unknown;
}): StreamTermination {
  if (input.clientAborted) return "cancelled";
  if (input.timedOut) return "timeout";
  return "failed";
}
