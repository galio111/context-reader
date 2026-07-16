import { createClient } from "@supabase/supabase-js";

export const FEEDBACK_BUCKET = "context-reader-feedback";

export function feedbackAdminClient() {
  const url = process.env.SUPABASE_URL?.trim() || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!url || !key) throw new Error("反馈存储尚未配置。");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function ensureFeedbackBucket(client: ReturnType<typeof feedbackAdminClient>) {
  const { data } = await client.storage.getBucket(FEEDBACK_BUCKET);
  if (data) return;
  const { error } = await client.storage.createBucket(FEEDBACK_BUCKET, {
    public: false,
    fileSizeLimit: 24 * 1024,
    allowedMimeTypes: ["application/json"],
  });
  if (error && !/already exists/i.test(error.message)) throw error;
}

export function isFeedbackObjectPath(value: string): boolean {
  return /^\d{4}-\d{2}\/\d{4}-\d{2}-\d{2}-[0-9a-f-]{36}\.json$/i.test(value);
}
