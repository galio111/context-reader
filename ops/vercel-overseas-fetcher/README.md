# Context Reader overseas fetcher

This directory is the complete source of the isolated Vercel project `context-reader-overseas-fetch`. It is not a second Context Reader deployment: it has no UI, account, database, storage, AI, Admin, or parsing code. Its only route is `POST /api/fetch`.

The mainland application calls the route only after a bounded direct fetch fails or returns an explicitly retryable/blocked status. The request requires the server-only `OVERSEAS_FETCH_TOKEN`; the function validates and pins every public DNS destination and redirect, permits only standard HTTP(S), returns at most 1.5 MB, and never forwards cookies or arbitrary request headers.

Required Vercel Production environment variable:

- `OVERSEAS_FETCH_TOKEN`: a random server-only secret shared only with the mainland runtime.

The project must remain separate from the frozen `context-reader` Vercel project. Deploy this directory with `vercel --cwd ops/vercel-overseas-fetcher`. Only the dedicated `fetch.context-reader.com` subdomain may point here; the apex/public application domain must stay on the mainland stack.
