// ─────────────────────────────────────────────────────────────────────────────
// src/lib/delegates/documentTypes.ts
//
// Phase 23I — canonical list of `turath_masr_delegate_documents.document_type`
// tokens + their Arabic display labels.
//
//     national_id_front  → صورة الرقم القومي - وجه
//     national_id_back   → صورة الرقم القومي - ظهر
//     driving_license    → رخصة القيادة
//     vehicle_license    → رخصة المركبة
//     vehicle_photo      → صورة وسيلة المواصلات
//     other              → أخرى
//
// Adding a type:
//   1. Append to DOCUMENT_TYPE_TOKENS.
//   2. Add the Arabic label to DOCUMENT_TYPE_LABELS_AR.
//   3. Mark required vs optional in DOCUMENT_TYPE_REQUIRED.
//   4. Bump the migration to widen the CHECK constraint on
//      `turath_masr_delegate_documents.document_type` — without that,
//      an INSERT with the new token surfaces as 23514.
//
// Storage path convention (caller-side, NOT enforced here):
//   delegates/<delegate_profile_id>/<document_type>/<unix_ts>-<safe_filename>
// ─────────────────────────────────────────────────────────────────────────────

export const DOCUMENT_TYPE_TOKENS = [
  'national_id_front',
  'national_id_back',
  'driving_license',
  'vehicle_license',
  'vehicle_photo',
  'other',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPE_TOKENS)[number];

export const DOCUMENT_TYPE_LABELS_AR: Record<DocumentType, string> = {
  national_id_front: 'صورة الرقم القومي - وجه',
  national_id_back: 'صورة الرقم القومي - ظهر',
  driving_license: 'رخصة القيادة',
  vehicle_license: 'رخصة المركبة',
  vehicle_photo: 'صورة وسيلة المواصلات',
  other: 'أخرى',
};

/** Which tokens are considered "required" for the completeness
 *  filter ("مستندات ناقصة"). Matches the spec's "Required documents"
 *  list. Vehicle photo + other are optional. */
export const DOCUMENT_TYPE_REQUIRED: Record<DocumentType, boolean> = {
  national_id_front: true,
  national_id_back: true,
  driving_license: true,
  vehicle_license: true,
  vehicle_photo: false,
  other: false,
};

export function documentTypeLabel(token: string | null | undefined): string {
  if (!token) return '';
  if ((DOCUMENT_TYPE_TOKENS as readonly string[]).includes(token)) {
    return DOCUMENT_TYPE_LABELS_AR[token as DocumentType];
  }
  return token;
}

/** Required-document set as a readonly array — useful for iterating
 *  to render the "missing required" placeholders in the documents
 *  tab even before any uploads exist. */
export const REQUIRED_DOCUMENT_TYPES: ReadonlyArray<DocumentType> = DOCUMENT_TYPE_TOKENS.filter(
  (t) => DOCUMENT_TYPE_REQUIRED[t]
);

/** Optional-document set — the second section of the documents tab
 *  ("Optional documents") iterates this. */
export const OPTIONAL_DOCUMENT_TYPES: ReadonlyArray<DocumentType> = DOCUMENT_TYPE_TOKENS.filter(
  (t) => !DOCUMENT_TYPE_REQUIRED[t]
);

// ─── Upload validation ──────────────────────────────────────────────────

/** Accepted MIME types for delegate documents. The UI rejects
 *  anything outside this set client-side; the server side has no
 *  enforcement (Storage doesn't constrain MIME). */
export const ACCEPTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export type AcceptedMime = (typeof ACCEPTED_MIME_TYPES)[number];

/** Max upload size, in bytes. 5 MB per Phase 23I spec. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function isAcceptedMime(mime: string): boolean {
  return (ACCEPTED_MIME_TYPES as readonly string[]).includes(mime);
}

/** Sanitise a filename to a safe storage-key fragment. Drops
 *  whitespace and any character that isn't a unicode letter / digit
 *  / dot / dash / underscore. Caps length at 80 chars so the
 *  composed storage key stays well under storage's 1KB key limit. */
export function sanitizeFilename(name: string): string {
  if (!name) return 'file';
  const trimmed = name.trim();
  // Split off the extension (last segment after the rightmost dot)
  const lastDot = trimmed.lastIndexOf('.');
  const base = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const ext = lastDot > 0 ? trimmed.slice(lastDot + 1) : '';
  const cleanBase = base.replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '');
  const cleanExt = ext.replace(/[^\p{L}\p{N}]/gu, '');
  const out = cleanExt ? `${cleanBase || 'file'}.${cleanExt.toLowerCase()}` : cleanBase || 'file';
  return out.slice(0, 80);
}

/** Compose the storage key the upload step writes to. Caller passes
 *  the sanitised filename + a millisecond timestamp; the bucket is
 *  always `delegate-documents`, the prefix is enforced here. */
export function buildStoragePath(
  delegateProfileId: string,
  documentType: DocumentType,
  timestampMs: number,
  safeFilename: string
): string {
  return `delegates/${delegateProfileId}/${documentType}/${timestampMs}-${safeFilename}`;
}
