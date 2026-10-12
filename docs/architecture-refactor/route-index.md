# Route index

Generated from baseline source. See `route-inventory.json` for methods, field references, validation/response line evidence and source hashes. All entries are inventoried, not dynamically verified in this audit.

| Path | Methods | Source | Classification |
| --- | --- | --- | --- |
| `/api/account/activity` | GET, POST | `app/api/account/activity/route.ts` | product-or-infrastructure |
| `/api/account/export` | GET | `app/api/account/export/route.ts` | product-or-infrastructure |
| `/api/account/invitation-code` | POST | `app/api/account/invitation-code/route.ts` | product-or-infrastructure |
| `/api/account/password` | PATCH | `app/api/account/password/route.ts` | product-or-infrastructure |
| `/api/account/profile` | PATCH | `app/api/account/profile/route.ts` | product-or-infrastructure |
| `/api/account/sync` | GET, POST | `app/api/account/sync/route.ts` | product-or-infrastructure |
| `/api/account/vocabulary-repair` | POST | `app/api/account/vocabulary-repair/route.ts` | product-or-infrastructure |
| `/api/admin/accounts` | GET, PATCH | `app/api/admin/accounts/route.ts` | admin |
| `/api/admin/article-candidates` | DELETE, GET, PATCH, POST | `app/api/admin/article-candidates/route.ts` | admin |
| `/api/admin/article-classification` | POST | `app/api/admin/article-classification/route.ts` | admin |
| `/api/admin/article-covers` | PATCH, POST | `app/api/admin/article-covers/route.ts` | admin |
| `/api/admin/article-crawler` | GET, PATCH, POST | `app/api/admin/article-crawler/route.ts` | admin |
| `/api/admin/billing` | GET, POST | `app/api/admin/billing/route.ts` | admin |
| `/api/admin/cet-paper` | GET, PATCH | `app/api/admin/cet-paper/route.ts` | admin |
| `/api/admin/discovery-sources` | GET, POST | `app/api/admin/discovery-sources/route.ts` | admin |
| `/api/admin/editorial` | GET, PATCH, POST | `app/api/admin/editorial/route.ts` | admin |
| `/api/admin/error-reports` | DELETE, GET, PATCH | `app/api/admin/error-reports/route.ts` | admin |
| `/api/admin/feedback` | DELETE, GET, PATCH | `app/api/admin/feedback/route.ts` | admin |
| `/api/admin/homepage-curation` | GET, PATCH, PUT | `app/api/admin/homepage-curation/route.ts` | admin |
| `/api/admin/invitation-codes` | GET, PATCH, POST | `app/api/admin/invitation-codes/route.ts` | admin |
| `/api/admin/login` | POST | `app/api/admin/login/route.ts` | admin |
| `/api/admin/logout` | POST | `app/api/admin/logout/route.ts` | admin |
| `/api/admin/models` | GET, PATCH, POST | `app/api/admin/models/route.ts` | admin |
| `/api/admin/product-analytics` | GET | `app/api/admin/product-analytics/route.ts` | admin |
| `/api/admin/public-article-translations` | POST | `app/api/admin/public-article-translations/route.ts` | admin |
| `/api/admin/public-articles` | DELETE, GET, PATCH, POST | `app/api/admin/public-articles/route.ts` | admin |
| `/api/admin/saved-article-images` | PATCH | `app/api/admin/saved-article-images/route.ts` | admin |
| `/api/admin/session` | GET | `app/api/admin/session/route.ts` | admin |
| `/api/admin/study` | GET, POST | `app/api/admin/study/route.ts` | admin |
| `/api/admin/usage` | GET | `app/api/admin/usage/route.ts` | admin |
| `/api/anki/add-note` | POST | `app/api/anki/add-note/route.ts` | retained-compatibility-not-normal-ui |
| `/api/anki/check` | POST | `app/api/anki/check/route.ts` | retained-compatibility-not-normal-ui |
| `/api/anki/create-model` | POST | `app/api/anki/create-model/route.ts` | retained-compatibility-not-normal-ui |
| `/api/anki/decks` | POST | `app/api/anki/decks/route.ts` | retained-compatibility-not-normal-ui |
| `/api/anki/models` | POST | `app/api/anki/models/route.ts` | retained-compatibility-not-normal-ui |
| `/api/article-images/localize` | POST | `app/api/article-images/localize/route.ts` | product-or-infrastructure |
| `/api/ask-sentence` | POST | `app/api/ask-sentence/route.ts` | product-or-infrastructure |
| `/api/auth/adopt-session` | POST | `app/api/auth/adopt-session/route.ts` | retained-compatibility-not-normal-ui |
| `/api/auth/logout` | POST | `app/api/auth/logout/route.ts` | product-or-infrastructure |
| `/api/auth/phone-login` | POST | `app/api/auth/phone-login/route.ts` | product-or-infrastructure |
| `/api/auth/phone-register` | POST | `app/api/auth/phone-register/route.ts` | product-or-infrastructure |
| `/api/auth/request-otp` | POST | `app/api/auth/request-otp/route.ts` | retained-compatibility-not-normal-ui |
| `/api/auth/session` | GET | `app/api/auth/session/route.ts` | product-or-infrastructure |
| `/api/auth/verify-otp` | POST | `app/api/auth/verify-otp/route.ts` | retained-compatibility-not-normal-ui |
| `/api/billing` | GET, POST | `app/api/billing/route.ts` | commercial-capability-live-enablement-must-be-verified |
| `/api/billing/wechat/notify` | POST | `app/api/billing/wechat/notify/route.ts` | commercial-capability-live-enablement-must-be-verified |
| `/api/cet/preview` | GET | `app/api/cet/preview/route.ts` | product-or-infrastructure |
| `/api/cet` | GET | `app/api/cet/route.ts` | product-or-infrastructure |
| `/api/connectivity` | GET | `app/api/connectivity/route.ts` | product-or-infrastructure |
| `/api/cron/recommendations` | GET | `app/api/cron/recommendations/route.ts` | scheduler |
| `/api/dictionary` | POST | `app/api/dictionary/route.ts` | product-or-infrastructure |
| `/api/dictionary-history` | GET | `app/api/dictionary-history/route.ts` | product-or-infrastructure |
| `/api/dictionary-stream` | POST | `app/api/dictionary-stream/route.ts` | product-or-infrastructure |
| `/api/download-image` | GET | `app/api/download-image/route.ts` | product-or-infrastructure |
| `/api/error-reports` | POST | `app/api/error-reports/route.ts` | product-or-infrastructure |
| `/api/explain-word` | POST | `app/api/explain-word/route.ts` | product-or-infrastructure |
| `/api/explain-word-stream` | POST | `app/api/explain-word-stream/route.ts` | product-or-infrastructure |
| `/api/feedback` | POST | `app/api/feedback/route.ts` | product-or-infrastructure |
| `/api/import-url` | POST | `app/api/import-url/route.ts` | product-or-infrastructure |
| `/api/lookup-cancel` | POST | `app/api/lookup-cancel/route.ts` | product-or-infrastructure |
| `/api/ocr-image` | POST | `app/api/ocr-image/route.ts` | retained-compatibility-not-normal-ui |
| `/api/ocr-image-layout` | POST | `app/api/ocr-image-layout/route.ts` | retained-compatibility-not-normal-ui |
| `/api/ocr-image-url` | POST | `app/api/ocr-image-url/route.ts` | retained-compatibility-not-normal-ui |
| `/api/pronunciation` | POST | `app/api/pronunciation/route.ts` | product-or-infrastructure |
| `/api/public-articles/[id]` | GET | `app/api/public-articles/[id]/route.ts` | product-or-infrastructure |
| `/api/public-articles/daily-updates` | GET | `app/api/public-articles/daily-updates/route.ts` | product-or-infrastructure |
| `/api/public-articles/preview` | GET | `app/api/public-articles/preview/route.ts` | product-or-infrastructure |
| `/api/public-articles` | GET | `app/api/public-articles/route.ts` | product-or-infrastructure |
| `/api/static-asset/[...path]` | GET | `app/api/static-asset/[...path]/route.ts` | product-or-infrastructure |
| `/api/study/profile` | GET, POST | `app/api/study/profile/route.ts` | product-or-infrastructure |
| `/api/study/reading` | POST | `app/api/study/reading/route.ts` | product-or-infrastructure |
| `/api/study` | GET, POST | `app/api/study/route.ts` | product-or-infrastructure |
| `/api/summarize-article` | POST | `app/api/summarize-article/route.ts` | product-or-infrastructure |
| `/api/translate-article/finish` | POST | `app/api/translate-article/finish/route.ts` | product-or-infrastructure |
| `/api/translate-article` | POST | `app/api/translate-article/route.ts` | product-or-infrastructure |
| `/api/translate-article/start` | POST | `app/api/translate-article/start/route.ts` | product-or-infrastructure |
| `/api/usage/cache-lookup` | POST | `app/api/usage/cache-lookup/route.ts` | product-or-infrastructure |
| `/api/usage/guest-import` | POST | `app/api/usage/guest-import/route.ts` | product-or-infrastructure |

| Page | Source |
| --- | --- |
| `/account/repair-vocabulary` | `app/account/repair-vocabulary/page.tsx` |
| `/account/usage` | `app/account/usage/page.tsx` |
| `/admin/accounts` | `app/admin/accounts/page.tsx` |
| `/admin/experience/frame` | `app/admin/experience/frame/page.tsx` |
| `/admin/experience` | `app/admin/experience/page.tsx` |
| `/admin` | `app/admin/page.tsx` |
| `/admin/public-image-repair` | `app/admin/public-image-repair/page.tsx` |
| `/guide` | `app/guide/page.tsx` |
| `/home-v2` | `app/home-v2/page.tsx` |
| `/` | `app/page.tsx` |
| `/pricing` | `app/pricing/page.tsx` |
| `/study` | `app/study/page.tsx` |
