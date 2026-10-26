# Multiple saved accounts

## Behavior

The account and usage surface retains up to three signed-in accounts in this browser. Adding an account keeps the existing sessions; an unsuccessful login does not replace the active session. At capacity the user chooses an inactive account to remove before adding another. To remove the current account, switch first or use the existing logout action. Removing a saved login does not delete its cloud account, articles, vocabulary, review history or local archives. Expired sessions require signing in again.

## Session and data boundaries

Three independently encrypted AES-256-GCM HttpOnly, SameSite=Lax cookies hold session credentials. Encryption uses a purpose-separated key derived from the existing server secret; no new service or schema is required. Cookie values are never returned in account JSON. An HttpOnly roster lists at most three account identifiers; each encrypted credential cookie is keyed by its user id. Only enrollment/removal changes the roster, so a late response cannot reuse a removed account's slot. A separate HttpOnly selector chooses the active account but grants no authorization. Selected-slot lookup never falls back to another account's legacy cookie. Refreshing a background session updates its own slot and cannot overwrite a newer selection. Legacy single-account browsers migrate during a verified session check. Rotating the server secret invalidates saved sessions.

Switching validates the target session and active profile on the server. The browser pauses account sync, settles/aborts its outstanding work and flushes durable local changes before changing sessions. It then replaces the document at `/account/usage`, preventing outgoing Reader/study callbacks from writing into the incoming account. Existing IndexedDB owner archives and assets are reused; full cloud reconciliation stays in the background. Other tabs receive a switch signal and reload. Existing ownership checks reject cross-account sync, and IndexedDB compare-and-swap protects stale-tab writes. Account removal clears the browser's saved slot; ordinary logout also revokes its current server session only.

## Validation and acceptance

Candidate based on production `20261025T000500`, source `166866d727b55facdb008354c2bfc0eae535911a`. Production identity is recorded after guarded deployment.

- 103 targeted/core regression checks passed, including encrypted session limits, tampering, selected-account authority, logout scope, IndexedDB/CET isolation, sync recovery and switcher interactions.
- Production build, TypeScript check and 11 protected release contracts passed. Existing unrelated lint warnings remain.
- Four isolated temporary real accounts: three retained logins, rejected fourth without replacing current, nine repeat switches, wrong-owner sync rejection, invalid target preserving current, inactive removal/addition, cross-origin rejection, logout retaining other sessions, and returning to a saved session all passed.
- Local production build over the existing-server SSH tunnel: nine switch API samples 579–673 ms; maximum tested saved-cookie value 1344 bytes. These measure API completion only, not page rendering or whole-operation latency.
- Actual browser interaction, narrow-layout visual inspection, keyboard/reduced-motion inspection and user-perceived switching speed remain unverified. Windows Computer Use stopped because it could not confidently determine the current browser URL. Do not describe the speed/fluency acceptance gate as complete.
