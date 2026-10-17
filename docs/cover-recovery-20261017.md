# Cover recovery — 2026-10-17

Candidate parent: `20261017T171700` (`87c422db6005287bd87f928f67b58370aec9c671`).

Implementation: two silent retries (1s/3s), bounded fallback, reconnect recovery, URL/unmount timer cleanup, and loaded-pixel fallback when decode rejects. Only images remount; motion surfaces and media limits remain stable.

Validation: hook and real eager-cover integration tests passed; 13 existing media regressions passed. Production build and guarded deployment are pending. The original transient transport/decode trigger is not established. Physical Safari and user visual acceptance remain open.
