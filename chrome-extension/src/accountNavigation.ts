export const OPEN_ACCOUNT_USAGE_EVENT = "context-reader:open-account-usage";
export function openAccountUsage() { chrome.tabs.create({ url: "https://context-reader.com/account" }); }
export function isQuotaMessage(message: string) { return /额度|点数|用量/.test(message); }
