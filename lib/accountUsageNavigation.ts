export const OPEN_ACCOUNT_USAGE_EVENT = "context-reader:open-account-usage";
export function openAccountUsage() {
 if (typeof window === "undefined") return;
 if (window.location.pathname === "/") window.dispatchEvent(new Event(OPEN_ACCOUNT_USAGE_EVENT));
 else window.location.assign("/?menu=account");
}
export function isQuotaMessage(message: string) { return /额度|点数|用量/.test(message); }
