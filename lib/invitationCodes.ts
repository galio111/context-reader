import "server-only";

import { createHash, randomBytes } from "node:crypto";

const INVITATION_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const INVITATION_SEGMENT_LENGTH = 4;
const INVITATION_SEGMENT_COUNT = 3;

export function normalizeInvitationCode(value: string): string {
  const compact = value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^2-9A-HJ-NP-Z]/g, "");
  return compact.length > 12 && compact.startsWith("CR") ? compact.slice(2) : compact;
}

export function invitationCodeHash(value: string): string {
  return createHash("sha256").update(normalizeInvitationCode(value), "utf8").digest("hex");
}

export function generateInvitationCode(): string {
  const length = INVITATION_SEGMENT_LENGTH * INVITATION_SEGMENT_COUNT;
  const bytes = randomBytes(length);
  let body = "";
  for (let index = 0; index < length; index += 1) {
    body += INVITATION_ALPHABET[bytes[index] % INVITATION_ALPHABET.length];
  }
  const segments = Array.from(
    { length: INVITATION_SEGMENT_COUNT },
    (_, index) => body.slice(index * INVITATION_SEGMENT_LENGTH, (index + 1) * INVITATION_SEGMENT_LENGTH),
  );
  return `CR-${segments.join("-")}`;
}

export function invitationCodeHint(value: string): string {
  const normalized = normalizeInvitationCode(value);
  return normalized.length >= 4 ? `末四位 ${normalized.slice(-4)}` : "已隐藏";
}
