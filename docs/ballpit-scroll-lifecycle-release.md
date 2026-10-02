# Ballpit scroll lifecycle and blue billing

Candidate based on accepted `20261002T233200` / source `38bba496bf233a2d4f6cac0a16b74a3ee1336ec4`, with documentation-only origin/main `3c2a7e8` integrated. No billing backend or schema changes.

## Diagnosis and changes

The user saw a full-window ball overlay over the lower publication bridge/import form after the earlier first-frame fix. The old public build was tested: at the bottom in a narrow viewport, opening Menu fixes the body at top -4816px and reports scrollY=0. Widening mounts the desktop Ballpit; the old onReady skips geometry while fixed, retaining cover progress 0 and a visible canvas. Closing Menu produced a scroll event and hid it during this reproduction; the user's exact lingering bare-page timing was not reproduced deterministically. This is an evidenced additional lifecycle defect, not a claim to know every historical trigger.

The shared geometry synchronizer now uses viewport positions even under body locking and updates both scene departure and an independent parent opacity gate. It runs on scene ready and covers scroll, viewport/layout resize, body style changes, pageshow and document visibility. Defaults remain hidden until measured. Mobile reduced-count balls stay clipped inside their hero; desktop departure easing/physics and reverse entry are unchanged. Billing colors are now cool blue with readable navy text, blue actions and pale-blue Plus emphasis, including focus/hover and modal backgrounds.

## Validation before deployment

- Production build, 89 critical regressions, 7 media regressions, 4 new cover motion tests and 9 release contracts passed.
- The new tests cover fixed-body initial geometry, reversible quarter phases, resize/late mount with a reset canvas, and unavailable refs.
- Local real-browser verification: normal hero balls appear, mid-departure stays animated, narrow lower page → Menu → desktop keeps parent opacity 0 even with scrollY 0.
- Production repeat flows and operations evidence to be added after guarded deployment. Physical devices and user final visual judgment remain open.

The user explicitly approved a one-time 18 GB worktree creation threshold; the repository's default 20 GB guard was not edited. A prior automated cache-cleanup attempt was rejected and no cache deletion succeeded through that command.
