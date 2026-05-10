// ─────────────────────────────────────────────────────────────────────────────
// src/lib/orders/auditNote.ts
//
// Phase 22P — structured `note` payload for `turath_masr_audit_logs`
// rows.
//
// Why this exists
//   Before Phase 22P, the StatusUpdateModal collapsed the user's two
//   inputs (`reason` for cancellation / return + free-form `note`)
//   into a single `text` field via `data.reason || data.note || ''`.
//   The reason won when present, the note was dropped, and every
//   downstream surface (in-modal history, AuditLogModal,
//   OrderDetailModal) rendered the surviving value as a generic
//   italic quote — admins had no way to tell whether the line they
//   were looking at was a cancellation reason or a free-text note.
//
//   Phase 22P keeps the existing `turath_masr_audit_logs.note text`
//   column (no migration) and structures it as JSON when the user
//   supplied at least one of the two fields. Read paths use
//   `parseAuditNote()` to recover the structured shape; legacy rows
//   that hold plain text continue to render as a single note line.
//
// Storage shape
//   When at least one of `reason` / `note` is non-empty, we store
//   `JSON.stringify({ reason?, note? })` in the `note` column.
//   When both are empty we store `null` (omitting the column writes
//   nothing visible in the UI).
//
// Read shape
//   `parseAuditNote(raw)` returns
//     • `{ reason?, note? }` when raw is a JSON object literal carrying
//       either / both keys (Phase 22P+ rows);
//     • `{ raw }` when raw is non-empty plain text (legacy rows or
//       any other free-form text); render as the original "ملاحظة".
//     • `{}` when raw is empty / null / whitespace-only.
//
// Privacy posture
//   `note` itself is admin-internal — it's redacted out of the
//   customer-facing tracking RPCs in
//   `20260506_secure_tracking_rpc.sql` and
//   `20260507a_tracking_rpc_by_token.sql`. A separate Phase 22P
//   migration (see `supabase/migrations/`) extracts ONLY `reason`
//   from the JSON envelope as `return_reason` for use on the
//   public tracking timeline; the free-form `note` continues to
//   stay admin-only.
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedAuditNote {
  /** The structured "reason" field (cancellation / return reason). */
  reason?: string;
  /** The structured free-form note. */
  note?: string;
  /** Plain-text fallback for legacy rows that were never JSON-encoded. */
  raw?: string;
}

/**
 * Parse an audit-log `note` column value into the Phase 22P
 * structured shape. See module header for the storage contract.
 *
 * Behaviour:
 *   - empty / null / whitespace-only → `{}`
 *   - JSON object literal with `reason` and/or `note` keys → those
 *     keys, trimmed; non-string values are dropped. Other JSON
 *     keys are ignored.
 *   - any other non-empty string (including arrays, primitives that
 *     happen to be valid JSON like `"42"`, or plain text) → treated
 *     as legacy plain text and returned under `raw`.
 *
 * The function never throws.
 */
export function parseAuditNote(raw: string | null | undefined): ParsedAuditNote {
  if (typeof raw !== 'string') return {};
  const trimmed = raw.trim();
  if (!trimmed) return {};

  // Heuristic: only attempt JSON.parse when the value looks like an
  // object literal. This avoids accidentally interpreting legacy
  // free-text notes that happen to contain quotes / numbers as
  // JSON, and side-steps the "true / 42 / null" ambiguity entirely.
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        const reasonRaw = typeof obj.reason === 'string' ? obj.reason.trim() : '';
        const noteRaw = typeof obj.note === 'string' ? obj.note.trim() : '';
        if (reasonRaw || noteRaw) {
          return {
            ...(reasonRaw ? { reason: reasonRaw } : {}),
            ...(noteRaw ? { note: noteRaw } : {}),
          };
        }
        // JSON object but no useful keys — fall through to raw.
      }
    } catch {
      // Not JSON — fall through to raw fallback.
    }
  }

  return { raw: trimmed };
}

/**
 * Build the `note` column value from a status-update form's
 * `reason` / `note` inputs, ready to write to
 * `turath_masr_audit_logs.note`.
 *
 * Returns:
 *   - `null` when both inputs are empty (or whitespace-only). Caller
 *     can pass this straight through to the audit-log writer; the
 *     existing `addAuditLog` helper writes `null` when `note` is
 *     falsy.
 *   - JSON string (`{"reason":"...","note":"..."}`) when at least
 *     one of the two inputs is non-empty. Keys with empty values
 *     are omitted so the parser's "no useful keys" branch doesn't
 *     have to deal with `{ reason: "" }`.
 */
export function buildAuditNote(input: { reason?: string; note?: string }): string | null {
  const reason = (input.reason ?? '').trim();
  const note = (input.note ?? '').trim();
  if (!reason && !note) return null;
  return JSON.stringify({
    ...(reason ? { reason } : {}),
    ...(note ? { note } : {}),
  });
}
