// Run only in the app container. Seed output contains synthetic-session secrets:
// redirect it to an ignored private file, never a transcript or a committed file.
const { randomBytes } = require("node:crypto");
const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) throw new Error("Run inside the configured app container");
async function api(path, method = "GET", body) {
  const r = await fetch(base + path, { method, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!r.ok) throw new Error(`QA service returned ${r.status}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}
(async () => {
  const action = process.argv[2];
  if (action === "seed") {
    const email = `extension-qa-${Date.now()}-${randomBytes(3).toString("hex")}@example.invalid`, password = "ExtensionQA!" + randomBytes(16).toString("hex");
    const created = await api("/auth/v1/admin/users", "POST", { email, password, email_confirm: true, user_metadata: { nickname: "扩展验收临时账号", extension_qa: true } });
    const user = created.user || created;
    try {
      const session = await api("/auth/v1/token?grant_type=password", "POST", { email, password });
      console.log(JSON.stringify({ userId: user.id, email, accessToken: session.access_token, refreshToken: session.refresh_token }));
    } catch (error) { await api(`/auth/v1/admin/users/${user.id}`, "DELETE"); throw error; }
  } else if (action === "cleanup") {
    const id = process.argv[3]; if (!/^[0-9a-f-]{36}$/i.test(id || "")) throw new Error("Expected exact test user UUID");
    const data = await api(`/auth/v1/admin/users/${id}`), user = data.user || data;
    if (!user.email?.startsWith("extension-qa-") || user.user_metadata?.extension_qa !== true) throw new Error("Refusing to remove a non-QA account");
    await api(`/rest/v1/user_data_objects?user_id=eq.${id}`, "DELETE");
    await api(`/auth/v1/admin/users/${id}`, "DELETE");
    const remaining = await api(`/rest/v1/browser_extension_connections?user_id=eq.${id}&select=id`);
    if (remaining.length) throw new Error("Test connections were not removed");
    console.log(JSON.stringify({ cleaned: true, userId: id, remainingConnections: remaining.length }));
  } else throw new Error("Expected seed or cleanup");
})().catch(error => { console.error(error.message); process.exitCode = 1; });
