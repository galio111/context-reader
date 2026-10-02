# Unified billing release

Initial release `20261002T232000`, source `d2fbd6224c44a26b0481d810a97d5d64270ad9af`, accepted at `2026-10-02T15:21:24Z`. It integrates accepted parent `20261002T225700` (source `ae4ece526668fa14bc1636445821f98291e500ae`), including its paused CET annotations and full question translation. Public identity and accepted server state agree; only app/caddy recreated.

## Implemented behavior

See [account rules](account-usage-plan.md) and [WeChat setup](wechat-pay-setup.md). The migration adds six service-only billing tables and RPCs without replacing guest/Admin `consume_usage`. Existing member per-feature counters remain historical; the first new grant starts the new points system without retrospective deductions. Already issued points/order snapshots remain stable when Admin changes the catalog. Normal fulfilled-order refunds remain a manual rights-and-money operation; abnormal never-fulfilled orders support idempotent original-route refunds. Native only; H5/JSAPI and automatic daily bank reconciliation are not implemented.

## Evidence before cutover

- Production build and nine protected release contracts passed.
- 95 core/billing/translation/Ballpit, 95 CET, 7 media and 7 loading tests passed.
- Fresh production backup `20261002T151127Z` passed SHA verification, full isolated restore, additive billing migration and legacy usage contracts before any production schema change.
- Isolated PostgreSQL ledger tests passed: once-only debit/refund/settlement, annual monthly grants, topups, reset cycle, expired membership, stale credit rejection, partial translation refunds, issued quota snapshots, month-end anchoring and browser-role revocations.
- Concurrent 24 debit requests stopped exactly at quota; 16 identical requests charged once. Legacy consume_usage was verified for every configured metric plus duplicate replay in a synthetic database.
- Real local pricing React UI checked at desktop and 390px mobile widths, including annual 60/150/300 prices and no horizontal overflow; fixture catalog used only in the test tab and removed afterwards. This does not substitute for production integration acceptance.
- Guest CET → Reader → home Ballpit overlay was reproduced on the then-active public release. Hook-order regression test verifies restoration is not overwritten by a missing controlled prop.

## Acceptance limits

Real WeChat merchant credentials and permissions are absent; collection stays disabled. Signature/AES/ledger tests are not real payment acceptance. Physical phone, Safari/Edge and final user visual judgment remain open. Server backup restore, public account/Admin boundaries, pricing integration and post-deploy repeat flows must be recorded below after execution.

## Public acceptance

Real signed-in synthetic account: contextual explanation 1 point, standalone dictionary 5, curated cached summary 2, short managed full translation 10; total 18/300, complete results and successful action statuses verified. Protocol-2 write/read and server-owned Basic quote (600 fen/5,000 points) passed. Anonymous private billing/Admin/sync return 401; cross-origin purchase 403; disabled checkout 503; invalid notification 400. Protected Admin config save and public catalog read share the same 300-point Free setting.

Actual public browser: desktop and 390px pricing/month-year switch, Menu used/total, upgrade quote/disabled payment and return state passed. Synthetic 15/300 threshold notice appeared, disappeared, and did not repeat on reload; exhaustion yielded 300/300 and its button opened Menu → account. Guest CET first and repeated returns plus switching to curated articles showed no Ballpit overlay. Keyboard QA found focus restoration/Escape propagation needing a two-component follow-up, implemented in this candidate and awaiting post-cutover recheck.

All seven services, recovery Admin routes, current/parent accepted images, and post-migration backup `20261002T152338Z` SHA/full isolated 23-table restore passed. No real merchant payment was attempted.
