// ─────────────────────────────────────────────────────────────────────────────
// GET /api/settings/shipping-regions
//
// Phase E1-Fix2 — return the `settings_regions` array (governorate /
// area / neighborhood hierarchy) as JSON behind a 5-minute private
// browser cache, so the heavy ~754 KB read is no longer issued by
// every Add Order modal open against the Supabase REST API.
//
// What this route does
//   1. Builds an SSR Supabase client with the request's cookies. RLS on
//      `turath_masr_settings` (`settings_authenticated_select`) gates
//      access exactly the way the existing direct client query does:
//      authenticated admins read freely, anonymous browsers receive
//      the same RLS rejection they would get hitting
//      `/rest/v1/turath_masr_settings` directly. No service-role
//      bypass.
//   2. Projects ONLY the `value` of the `settings_regions` row. No
//      other settings key leaves the DB on this path.
//   3. Returns the array directly (or `[]` on RLS rejection / missing
//      row) with `Cache-Control: private, max-age=300,
//      stale-while-revalidate=600`. The `private` directive keeps any
//      shared cache (CDN, ISP proxy) from storing per-admin RLS
//      results.
//
// Why this route exists
//   Before: every `AddOrderModal` mount hit Supabase with
//   `from('turath_masr_settings').select('value').eq('key',
//   'settings_regions').single()`, transferring ~754 KB of governorate
//   / area / neighborhood JSON for each modal open. With multiple
//   admins opening the modal repeatedly through the day, that
//   single key dominated REST egress after Phase E1-Fix1 + Fix1.1.
//   This route lets the browser fetch the data through Next.js once
//   and serve repeat reads from the application + HTTP cache layer
//   for 5 minutes (with a 10-minute SWR window). The `/settings`
//   admin page invalidates the application-side cache after a
//   successful save so admin edits surface immediately on the same
//   browser session.
//
// Privacy / authorisation
//   - Same RLS posture as the existing client-side query. No new
//     surface area exposed.
//   - The route does NOT use `service_role`; it cannot read what an
//     unauthenticated browser cannot already read via the Supabase
//     REST endpoint.
//   - Anonymous requests still receive 200 with `[]` (matching the
//     "no row visible to me" outcome of the equivalent direct
//     query). Returning a 401 here would surface RLS policy details
//     unnecessarily and break the simple client-side fallback path.
//
// Response shape
//   200: `[ ...regions array... ]`  (the raw `settings_regions` value)
//   500: `{ "error": "fetch_failed" }`  (Supabase non-PGRST116 error)
//
// Error semantics:
//   - PGRST116 (single() did not return one row) → treated as empty,
//     returns 200 + `[]`. Matches the pre-route behaviour where the
//     client just rendered an empty regions list.
//   - Any other Supabase error → logged server-side, returned as 500
//     with a non-cached body so the next mount retries.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export const runtime = 'nodejs';
// Don't statically generate; the body depends on per-user cookies for
// RLS. Cache-Control headers below own the per-browser caching layer.
export const dynamic = 'force-dynamic';

async function buildSupabaseClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value, options } of cookiesToSet) {
            try {
              cookieStore.set(name, value, options);
            } catch {
              // Route handlers can't always mutate cookies; ignored
              // intentionally. The next user-driven request will
              // refresh tokens if needed.
            }
          }
        },
      },
    }
  );
}

export async function GET() {
  const supabase = await buildSupabaseClient();
  const { data, error } = await supabase
    .from('turath_masr_settings')
    .select('value')
    .eq('key', 'settings_regions')
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.error('[settings-shipping-regions] supabase error', error);
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
  }

  const value = (data as { value?: unknown } | null)?.value;
  const regions = Array.isArray(value) ? value : [];

  return NextResponse.json(regions, {
    status: 200,
    headers: {
      // `private` because the row is RLS-gated; we don't want a shared
      // cache (CDN / ISP proxy) storing per-admin responses. 5-minute
      // hard cache + 10-minute SWR window. The application-side cache
      // (sessionStorage in the AddOrderModal helper) is the primary
      // layer for repeat modal opens within the same tab; this header
      // is a safety net for SPA navigations that re-instantiate the
      // module-level memory cache without remounting the tab.
      'Cache-Control': 'private, max-age=300, stale-while-revalidate=600',
    },
  });
}
