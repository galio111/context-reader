# Admin usage and cost reporting

The accepted 2026-09-22 design separates four tasks: 用量与成本, 用户管理, 套餐与额度, 邀请码. Desktop uses a sticky left navigation and mobile a sticky native section selector. Only the selected section is visible; switching preserves draft settings and report filters. Scoped overflow rules on the active accounts surface allow real document sticky positioning.

## Reporting contract

`GET /api/admin/usage` requires the same server-verified Admin authorization as accounts. It returns no credentials, article body or prompts and uses `Cache-Control: no-store`. Query `period` accepts today (default), yesterday, 7, 30 or date; date is a real Shanghai date inside the latest 30 calendar days. `scope` accepts all, reader, system or unclassified. Invalid parameters return 400; backend failures return a generic 503.

Executions and actions are paged separately, ordered by created_at and id, within a fixed [start,end) interval. Each has a 50,000-row safety ceiling; hitting it visibly marks all results incomplete. The execution query joins its action even when the action started before the selected interval. Actions belong to their creation date; costs belong to execution time. This prevents cross-midnight work from disappearing or acquiring a second user charge.

All-source totals include user activity and background classification, editorial review and manual model probes. Unattributable records remain visible under 待归属. Feature rows show actions, charged actions, quota units, cache hits, calls, failures/cancellations and known estimated CNY cost. Expanding a feature reveals its actual provider/model breakdown; model view reverses this relationship. Account ranking and recent 200 call details use the same filtered execution set. The recent-list cap never caps aggregates. Five core reader features remain visible at zero usage. Import operation rows only cover existing guest import ledger entries, not all signed-in imports.

Costs use actual recorded model identities and existing dated provider rates from usageCost.ts. Flash and Pro are separate. Recorded fallback attempts cost separately while the shared action charges once. Some legacy failover paths only wrote final outcomes; missing intermediate attempts cannot be reconstructed and are explicitly outside complete provider telemetry. Input cache misses are reconstructed as total input minus bounded cache hits because legacy recorders stored a default zero miss count. Unknown models and all-zero/absent token usage are 待核算, never free calls. Known totals exclude unknown charges and therefore are estimates, not provider invoices. Legacy summary/translation detail costs use this same estimator. No pricing, quota-consumption or model-routing configuration is changed by this report.

The users section preserves activity statistics, account search, plan assignment, suspension, bonus quota, reset actions, and the previous 30-day summary/translation/public-cache detail. Plan model controls and invitation management remain connected to their existing authorized endpoints.

## User-confirmed choices

Goals: inspect today's spend, compare models, find failures and high-usage accounts. Navigation: fixed desktop side navigation and sticky mobile selection. Default: Shanghai today with yesterday/7/30/day choices. Start with features and expand models. Include system costs in the all-site view with source filtering. Details are progressive disclosure. No additional requests.

## Validation status

Deployed release `20260922T083448`, parent `20260922T074500`, source `4d6b38840191d79acd4932b81ec37ae7b8d2c2e5`. Public mainland identity and active symlink match. Local desktop/mobile fixture inspection, authenticated production reports, account/sync/Admin boundaries, configured MiMo contextual explanation with sentence translation, Flash dictionary and full-article translation passed. Seven-service health, isolated 16-table backup restore and accepted current/parent rollback images passed. Dedicated tests cover Shanghai boundaries, multi-provider fallback, cache pricing, unknown charges, scope totals, cross-day joins and pagination-independent aggregates. HTTP fixture validation covers 1,203 rows, auth, invalid filters, empty days and no-store responses.
