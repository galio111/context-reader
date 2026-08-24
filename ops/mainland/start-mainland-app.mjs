const EXPECTED_INTERNAL_API = "http://supabase-api:8000";

function fail(message) {
  console.error(`Mainland runtime guard refused to start: ${message}`);
  process.exit(78);
}

if (process.env.CONTEXT_READER_RUNTIME_MODE !== "mainland") {
  fail("CONTEXT_READER_RUNTIME_MODE must be mainland");
}

if (process.env.SUPABASE_URL !== EXPECTED_INTERNAL_API) {
  fail("account, auth, sync, and storage APIs must use the internal mainland gateway");
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
  fail("the internal service-role credential is missing");
}

await import("./server.js");
