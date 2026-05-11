// Phase 24A — the customer-service CRM page is rebuilt at /customers.
// This stub preserves any legacy /crm bookmarks by redirecting to the
// new location server-side (no client flash). The previous 1,017-line
// dashboard implementation lived here and was replaced by the new
// design under /customers (see src/app/customers/page.tsx + the
// /customers/[customerKey] profile route). Keep this file as a
// redirect rather than a full deletion so an inbound link doesn't 404.

import { redirect } from 'next/navigation';

export default function CrmRedirectPage(): never {
  redirect('/customers');
}
