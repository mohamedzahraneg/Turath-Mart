// =============================================================================
// /track/t/[token]/layout.tsx — Phase 13C
//
// Sole purpose: emit `noindex, nofollow` for the token-keyed tracking
// page so search engines do not crawl, index, or follow the unguessable
// per-order URLs. Children inherit this metadata.
//
// Kept as a thin pass-through layout (renders children unchanged) so the
// existing /track/t/[token]/page.tsx UI layout remains untouched.
// =============================================================================

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function TrackTokenLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
