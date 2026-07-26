"use client";

import {
  describeApiFailure,
  describeCaughtRequestError,
  type ClientErrorContext,
} from "@/lib/clientErrorReporting";

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  fallbackMessage: string,
  context?: Omit<ClientErrorContext, "fallbackMessage" | "endpoint"> & { endpoint?: string },
): Promise<{ response: Response; data: T | null }> {
  const endpoint = context?.endpoint
    || (typeof input === "string" ? input : input instanceof URL ? input.pathname : "request");
  const errorContext: ClientErrorContext = {
    operation: context?.operation || "api_request",
    endpoint,
    fallbackMessage,
    metadata: context?.metadata,
  };
  try {
    const response = await fetch(input, init);
    let data = (await response.json().catch(() => null)) as T | null;
    if (!response.ok) {
      const message = await describeApiFailure(response, data, errorContext);
      if (data && typeof data === "object") {
        data = { ...data, error: message } as T;
      } else {
        data = { error: message } as T;
      }
    }
    return { response, data };
  } catch (error) {
    throw new Error(await describeCaughtRequestError(error, errorContext));
  }
}
