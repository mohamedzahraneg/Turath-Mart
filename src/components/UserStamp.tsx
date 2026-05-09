// ─────────────────────────────────────────────────────────────────────────────
// Phase 22L — two-line user identity stamp.
//
// Renders the user's real display name on the top line and the role/job
// label on the bottom line. Used in audit log displays, the in-modal
// status history, the order-detail "بواسطة" lines, and the CRM
// complaint logs so the same identity reads the same way everywhere.
//
// Behaviour:
//   • Name line is always rendered. If the caller passes a missing or
//     placeholder name, the helper substitutes "مستخدم" so the layout
//     stays stable. The name line is intentionally bolder than the role.
//   • Role line is rendered only when a non-empty role label is
//     available (legacy CRM rows don't carry a role per entry).
//   • Role can be passed as r1..r6, legacy English name, or already-
//     Arabic label — `getRoleLabel` from userDisplay.ts canonicalises.
//
// Variants:
//   • size="sm" — compact, used inside dense lists (audit log timeline).
//   • size="md" — default, used inline in detail panels.
//   • align="end" — right-align the stamp; useful inside RTL flex rows
//     where the name should hug the trailing edge.
// ─────────────────────────────────────────────────────────────────────────────

'use client';

import React from 'react';
import { getRoleLabel } from '@/lib/utils/userDisplay';

interface UserStampProps {
  name?: string | null;
  role?: string | null;
  size?: 'sm' | 'md';
  align?: 'start' | 'end';
  /** Render inline (single line, "name · role") instead of stacked. */
  inline?: boolean;
  className?: string;
}

export function UserStamp({
  name,
  role,
  size = 'md',
  align = 'start',
  inline = false,
  className = '',
}: UserStampProps) {
  const trimmedName = name && String(name).trim();
  const displayName = trimmedName && trimmedName.length > 0 ? trimmedName : 'مستخدم';
  const roleLabel = getRoleLabel(role ?? null);

  const nameSize = size === 'sm' ? 'text-xs' : 'text-sm';
  const roleSize = size === 'sm' ? 'text-[10px]' : 'text-xs';

  if (inline) {
    return (
      <span className={`inline-flex items-center gap-1 ${className}`}>
        <span className={`font-semibold text-[hsl(var(--foreground))] ${nameSize}`}>
          {displayName}
        </span>
        {roleLabel && (
          <>
            <span className="text-[hsl(var(--muted-foreground))]">·</span>
            <span className={`text-[hsl(var(--muted-foreground))] ${roleSize}`}>{roleLabel}</span>
          </>
        )}
      </span>
    );
  }

  return (
    <div
      className={`flex flex-col leading-tight ${
        align === 'end' ? 'items-end' : 'items-start'
      } ${className}`}
    >
      <span className={`font-semibold text-[hsl(var(--foreground))] ${nameSize}`}>
        {displayName}
      </span>
      {roleLabel && (
        <span className={`text-[hsl(var(--muted-foreground))] ${roleSize}`}>{roleLabel}</span>
      )}
    </div>
  );
}
