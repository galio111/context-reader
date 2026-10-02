# Unified billing release

Candidate integrates accepted parent `20261002T225700` (source `ae4ece526668fa14bc1636445821f98291e500ae`), including its paused CET annotations and full question translation. Public cutover identity will be recorded after deployment, not inferred from this candidate.

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
