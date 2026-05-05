import { createBrowserClient } from '@supabase/ssr';

// ─────────────────────────────────────────────────────────────────────────────
// Supabase browser client.
//
// Uses the default @supabase/ssr cookie strategy so that the auth session is
// stored in standard, first-party cookies that the Next.js middleware
// (src/lib/supabase/middleware.ts) can read.
//
// The previous implementation used a custom localStorage fallback with
// `SameSite=None; Secure; Partitioned` (CHIPS) cookies, which was a
// workaround for embedded preview iframes. That made the session invisible
// to the server-side middleware, defeating route protection.
//
// Production deployment is first-party (turathmasr.com), so the default
// cookie behaviour is correct and works for both client and server.
//
// ANON_KEY only — never the service-role key.
// ─────────────────────────────────────────────────────────────────────────────

let _clientInstance: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (_clientInstance) return _clientInstance;
  _clientInstance = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  return _clientInstance;
}

// Reset singleton on sign out (called by AuthContext signOut).
export function resetSupabaseClient() {
  _clientInstance = null;
}
