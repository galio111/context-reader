# Ballpit scroll lifecycle and blue billing

Accepted `20261003T002000`, parent `20261002T233200`, source `9ca86e4a77d94d2ea8c3322b7db4ecf1d84dc655`, at `2026-10-02T16:20:57.769093Z`. Public connectivity, server accepted state and current release agree with `mainland_internal`. The 40-file delta includes 33 previously accepted documentation/evidence updates; runtime changes are confined to home cover synchronization and billing colors. Only app/caddy recreated. The earlier candidate `20261003T001500` was interrupted by an SSH reset during build, never accepted; its directory was preserved, and a newly packaged candidate used the unchanged accepted parent and stable guarded entrypoint through a transient systemd unit.

No billing backend or schema changes.

## Diagnosis and changes

The user saw a full-window ball overlay over the lower publication bridge/import form after the earlier first-frame fix. The old public build was tested: at the bottom in a narrow viewport, opening Menu fixes the body at top -4816px and reports scrollY=0. Widening mounts the desktop Ballpit; the old onReady skips geometry while fixed, retaining cover progress 0 and a visible canvas. Closing Menu produced a scroll event and hid it during this reproduction; the user's exact lingering bare-page timing was not reproduced deterministically. This is an evidenced additional lifecycle defect, not a claim to know every historical trigger.

The shared geometry synchronizer now uses viewport positions even under body locking and updates both scene departure and an independent parent opacity gate. It runs on scene ready and covers scroll, viewport/layout resize, body style changes, pageshow and document visibility. Defaults remain hidden until measured. Mobile reduced-count balls stay clipped inside their hero; desktop departure easing/physics and reverse entry are unchanged. Billing colors are now cool blue with readable navy text, blue actions and pale-blue Plus emphasis, including focus/hover and modal backgrounds.

## Validation before deployment

- Production build, 89 critical regressions, 7 media regressions, 4 new cover motion tests and 9 release contracts passed.
- The new tests cover fixed-body initial geometry, reversible quarter phases, resize/late mount with a reset canvas, and unavailable refs.
- Local real-browser verification: normal hero balls appear, mid-departure stays animated, narrow lower page → Menu → desktop keeps parent opacity 0 even with scrollY 0.
- Also passed: retryable provider → independent Zhipu fallback / one reservation regression, 7 loading tests and static egress audit. Five real-browser departure positions were saved and inspected. Physical devices and user final visual judgment remain open.

The user explicitly approved a one-time 18 GB worktree creation threshold; the repository's default 20 GB guard was not edited. A prior automated cache-cleanup attempt was rejected and no cache deletion succeeded through that command.

## Public acceptance

- First CET paper entry/return and another paper entry/return completed. Returned resource list has departure 1 / parent opacity 0. During an intervening re-entry one request failed with a raw `Failed to fetch` alert; return/retry succeeded. Its network cause was not established and that existing error-copy path was not changed in this focused release.
- Curated/CET switching and the lower bridge/import form stayed clear; the actual reported lower-page composition was captured. Lower page → Menu → 390px/1440px resize shows body top -3828px, window scrollY 0, departure 1, canvas hidden and parent opacity 0. Closing Menu and returning to the hero preserve correct visibility.
- Synthetic account login, Menu account → upgrade → blue native dialog → back preserved account context. Logout completed and returned to guest hero at scrollY 0 with balls visible in the correct place.
- Public pricing shows blue rgb(34,89,172) actions, original 6/15/30 monthly and 60/150/300 annual prices; 390px view has no horizontal overflow. WeChat remains disabled. Local pricing preview used a public catalog fixture only; final public evidence used the live API without interception.
- Real signed-in explain/dictionary/full translation succeeded through deepseek-flash; explanation includes sentence translation. 1+5+2 cached summary+10 translation =18/300 points; protocol-2 write/read, server Basic quote, Admin billing and anonymous 401 boundaries passed.
- Stable release contracts, seven-service health, recovery Admin session/accounts/publication/automation checks, accepted current/parent images, and SHA/full isolated 23-table restore of `context-reader-20261002T152338Z.dump` passed. No DB/Auth/REST/Storage/gateway restart.
- Synthetic account removed under exact id/nickname/creation-window/no-order guards after browser logout. Temporary viewport/media overrides and local catalog interception cleared; secret session artifacts removed.

[Blue pricing](evidence/ballpit-scroll-lifecycle/production-blue-pricing.png) · [Mobile](evidence/ballpit-scroll-lifecycle/production-blue-mobile.png) · [Clear lower page](evidence/ballpit-scroll-lifecycle/production-import-clear.png) · [CET return](evidence/ballpit-scroll-lifecycle/production-cet-return.png) · [Locked resize](evidence/ballpit-scroll-lifecycle/production-lock-resize.json) · [Core/API ledger](evidence/ballpit-scroll-lifecycle/ballpit-acceptance.json)

Visual/device limit: the reproducible fixed-body remount defect is repaired and observed flows pass, but the exact timing of the user's lingering bare-page screenshot was not deterministically reproduced. Physical phone, Edge/Safari and final user visual acceptance remain open. These are not represented as complete by the build or viewport checks.
