"use client";

function friendlyFetchError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return new Error("请求已超时或被取消，请稍后重试。");
    }

    if (/failed to fetch|networkerror|load failed|fetch failed/i.test(error.message)) {
      return new Error("网络请求失败：请确认本地服务/生产站点可访问，刷新页面后重试。");
    }
  }

  return new Error(fallbackMessage);
}

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  fallbackMessage: string,
): Promise<{ response: Response; data: T | null }> {
  try {
    const response = await fetch(input, init);
    const data = (await response.json().catch(() => null)) as T | null;
    return { response, data };
  } catch (error) {
    throw friendlyFetchError(error, fallbackMessage);
  }
}

