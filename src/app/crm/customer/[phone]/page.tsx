// Phase 24A — legacy customer-detail URL. The new profile page lives
// at /customers/[customerKey]. We preserve incoming links by
// redirecting and forwarding the phone segment as the customerKey
// (the new helper accepts the raw normalised phone unchanged).

import { redirect } from 'next/navigation';

interface PageProps {
  // Next.js 15 dynamic params are async — we await to read the phone.
  params: Promise<{ phone: string }>;
}

export default async function CrmCustomerRedirectPage({ params }: PageProps): Promise<never> {
  const { phone } = await params;
  const safe = encodeURIComponent(decodeURIComponent(phone || '').replace(/\D+/g, ''));
  redirect(`/customers/${safe}`);
}
