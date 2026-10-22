import { createClient } from "@supabase/supabase-js";
import { MAX_DOCUMENT_BYTES } from "./documentSource";
export const DOCUMENT_BUCKET = "private-reading-documents";
export function documentStore() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function ensureDocumentBucket(client: ReturnType<typeof documentStore>) {
  const { data, error: readError } = await client.storage.getBucket(DOCUMENT_BUCKET);
  if (data) { if (data.public) throw new Error("Document bucket must be private"); return; }
  const { error } = await client.storage.createBucket(DOCUMENT_BUCKET, { public: false, fileSizeLimit: MAX_DOCUMENT_BYTES,
    allowedMimeTypes: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] });
  if (error && !/already exists/i.test(error.message)) throw error || readError;
}
