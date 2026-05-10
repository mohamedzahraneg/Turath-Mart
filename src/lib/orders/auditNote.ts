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
//
// Phase 22Q extension
//   The optional `schedule` field carries the delivery window the
//   admin set on this status-update event:
//     `{ date, from, to, reason? }`
//   It travels through the same `note` column so the audit log
//   timeline shows the full schedule change inline, even if the
//   `turath_masr_orders.scheduled_delivery_*` columns are later
//   overwritten by another reschedule. The customer-facing tracking
//   page reads the LATEST schedule from the orders columns, not
//   from the audit log — the audit log is the historical record,
//   not the live answer.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phase 22Q — structured delivery-schedule fragment carried inside an
 * audit note. Mirrors the columns added to `turath_masr_orders` by
 * `20260510150000_orders_add_scheduled_delivery.sql`.
 */
export interface ScheduleAuditFragment {
  /** Local calendar date in `YYYY-MM-DD` form. */
  date: string;
  /** Lower bound of the delivery window, `HH:MM` 24-hour. */
  from: string;
  /** Upper bound of the delivery window, `HH:MM` 24-hour. */
  to: string;
  /**
   * Reason the admin typed when MOVING an existing schedule. Required
   * by the StatusUpdateModal validation when date/from/to changes;
   * absent on first-time scheduling. Mirrored to
   * `turath_masr_orders.scheduled_delivery_reason`.
   */
  reason?: string;
}

export interface ParsedAuditNote {
  /** The structured "reason" field (cancellation / return reason). */
  reason?: string;
  /** The structured free-form note. */
  note?: string;
  /** Phase 22Q — structured delivery-schedule snapshot. */
  schedule?: ScheduleAuditFragment;
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
        // Phase 22Q — schedule fragment. Only accepted when ALL three
        // required pieces (date, from, to) are non-empty strings. The
        // optional `reason` is dropped when not a non-empty string so
        // the consumer can rely on `parsed.schedule.reason` being
        // truthy whenever it exists.
        let scheduleParsed: ScheduleAuditFragment | undefined;
        const scheduleRaw = obj.schedule;
        if (scheduleRaw && typeof scheduleRaw === 'object' && !Array.isArray(scheduleRaw)) {
          const s = scheduleRaw as Record<string, unknown>;
          const dateStr = typeof s.date === 'string' ? s.date.trim() : '';
          const fromStr = typeof s.from === 'string' ? s.from.trim() : '';
          const toStr = typeof s.to === 'string' ? s.to.trim() : '';
          const reasonStr = typeof s.reason === 'string' ? s.reason.trim() : '';
          if (dateStr && fromStr && toStr) {
            scheduleParsed = {
              date: dateStr,
              from: fromStr,
              to: toStr,
              ...(reasonStr ? { reason: reasonStr } : {}),
            };
          }
        }
        if (reasonRaw || noteRaw || scheduleParsed) {
          return {
            ...(reasonRaw ? { reason: reasonRaw } : {}),
            ...(noteRaw ? { note: noteRaw } : {}),
            ...(scheduleParsed ? { schedule: scheduleParsed } : {}),
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
 * `reason` / `note` / `schedule` inputs, ready to write to
 * `turath_masr_audit_logs.note`.
 *
 * Returns:
 *   - `null` when all inputs are empty / undefined. Caller can pass
 *     this straight through to the audit-log writer; `addAuditLog`
 *     writes `null` when `note` is falsy.
 *   - JSON string when at least one input is populated. Keys with
 *     empty / missing values are omitted so the parser's "no useful
 *     keys" branch doesn't have to deal with `{ reason: "" }`.
 *
 * Phase 22Q — `schedule` is included on the same envelope so the
 * audit row records the schedule snapshot at the moment of the
 * status update. The latest schedule also lives on
 * `turath_masr_orders.scheduled_delivery_*` for live reads; the
 * audit copy is the historical record only.
 */
export function buildAuditNote(input: {
  reason?: string;
  note?: string;
  schedule?: ScheduleAuditFragment;
}): string | null {
  const reason = (input.reason ?? '').trim();
  const note = (input.note ?? '').trim();
  const sched = input.schedule;
  // Only include a schedule fragment when all three required
  // components are present — matches the parser's acceptance rules
  // and avoids writing partial schedules that can't be rendered.
  let scheduleFragment: ScheduleAuditFragment | undefined;
  if (sched && sched.date && sched.from && sched.to) {
    const reasonStr = (sched.reason ?? '').trim();
    scheduleFragment = {
      date: sched.date,
      from: sched.from,
      to: sched.to,
      ...(reasonStr ? { reason: reasonStr } : {}),
    };
  }
  if (!reason && !note && !scheduleFragment) return null;
  return JSON.stringify({
    ...(reason ? { reason } : {}),
    ...(note ? { note } : {}),
    ...(scheduleFragment ? { schedule: scheduleFragment } : {}),
  });
}
