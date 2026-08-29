export type StreamTermination = "cancelled" | "timeout" | "failed";

export function classifyStreamTermination(input: {
  clientAborted: boolean;
  timedOut: boolean;
  error: unknown;
}): StreamTermination {
  if (input.clientAborted) return "cancelled";
  if (input.timedOut) return "timeout";
  return "failed";
}
