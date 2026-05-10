'use client';
// ─────────────────────────────────────────────────────────────────────────────
// src/lib/inventory/InventoryThumbnail.tsx
//
// Phase E1-Fix3 — shared thumbnail component for inventory product
// images. Renders a Next.js <Image> when the URL is loadable and falls
// back to the product emoji glyph when the underlying request errors
// (404 from `/api/inventory/[id]/thumbnail` for rows with no stored
// image, network failure, unsupported mime, etc.).
//
// Originally lived inline in `AddOrderModal.tsx` (Phase E1-Fix1.1).
// Phase E1-Fix3 promotes it to a shared module so the same render +
// fallback contract is reused by:
//   • Add Order modal product cards (3 sites, all sizes)
//   • Inventory list table thumbnails (40×40)
//   • Reports product table thumbnails (32×32)
// All three drop the heavy `images` jsonb from their bulk select
// queries; this component lazily resolves a single image at a time
// via the cached, RLS-gated `/api/inventory/[id]/thumbnail` route.
//
// Why `unoptimized`
//   The thumbnail route is RLS-gated (it uses the SSR Supabase client
//   with the request's cookies). Next.js's built-in `/_next/image`
//   optimiser fetches the underlying URL server-to-server WITHOUT
//   forwarding cookies, so the optimiser would always trip RLS and the
//   image would never load for any user. `unoptimized` makes the
//   browser fetch the URL directly (cookies attached) and the route's
//   `Cache-Control: public, max-age=86400, immutable` keeps repeat
//   renders near-zero-egress.
//
// Why a span fallback with matching positioning
//   When `fill` is set, the underlying <Image> is absolutely positioned
//   to fill the parent. The emoji fallback uses
//   `absolute inset-0 flex items-center justify-center` so the emoji
//   occupies the same screen space — no layout shift on the swap. For
//   non-fill (fixed width/height) modes, the emoji span sizes itself
//   via inline style.
//
// Behaviour contract:
//   • src is a string URL (typically `/api/inventory/${id}/thumbnail`).
//     Other shapes are accepted — `data:`, `http(s)://`, `/`-prefixed.
//   • If src is missing/empty/unrecognised → emoji from the start.
//   • If src loads → image renders.
//   • If src errors → swap to emoji (per-instance state).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import Image from 'next/image';

interface InventoryThumbnailProps {
  src: string | undefined;
  alt: string;
  emoji: string;
  fill?: boolean;
  width?: number;
  height?: number;
  sizes?: string;
  className?: string;
  emojiClassName?: string;
}

export function InventoryThumbnail({
  src,
  alt,
  emoji,
  fill,
  width,
  height,
  sizes,
  className,
  emojiClassName,
}: InventoryThumbnailProps) {
  const [errored, setErrored] = useState(false);
  const isLoadableUrl =
    typeof src === 'string' &&
    src.length > 0 &&
    (src.startsWith('data:') ||
      src.startsWith('http://') ||
      src.startsWith('https://') ||
      src.startsWith('/'));

  if (!isLoadableUrl || errored) {
    if (fill) {
      return (
        <span
          className={`absolute inset-0 flex items-center justify-center ${emojiClassName ?? ''}`}
        >
          {emoji}
        </span>
      );
    }
    return (
      <span
        className={`inline-flex items-center justify-center ${emojiClassName ?? ''}`}
        style={{ width, height }}
      >
        {emoji}
      </span>
    );
  }

  if (fill) {
    return (
      <Image
        src={src as string}
        alt={alt}
        fill
        sizes={sizes}
        className={className}
        unoptimized
        onError={() => setErrored(true)}
      />
    );
  }

  return (
    <Image
      src={src as string}
      alt={alt}
      width={width || 32}
      height={height || 32}
      className={className}
      unoptimized
      onError={() => setErrored(true)}
    />
  );
}

/**
 * Convenience helper: build the cached thumbnail URL for an inventory id.
 * Centralises the path so future renames of the route are a one-line change.
 */
export function inventoryThumbnailUrl(id: string): string {
  return `/api/inventory/${encodeURIComponent(id)}/thumbnail`;
}
