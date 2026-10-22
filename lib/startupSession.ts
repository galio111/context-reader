// Start the live check while HTML/scripts download, then consume it exactly once.
// No identity or authorization is restored from HTML or the service-worker cache.
export const startupSessionScript = `if(navigator.onLine&&!window.location.hash.includes("access_token=")){const c=new AbortController(),t=setTimeout(()=>c.abort(),8000);window.__crInitialSession=fetch('/api/auth/session',{cache:'no-store',credentials:'same-origin',priority:'high',signal:c.signal}).catch(()=>null).finally(()=>clearTimeout(t));}`;

export function takeStartupSession(): Promise<Response | null> | undefined {
  const target = window as typeof window & { __crInitialSession?: Promise<Response | null> };
  const pending = target.__crInitialSession;
  delete target.__crInitialSession;
  return pending;
}
