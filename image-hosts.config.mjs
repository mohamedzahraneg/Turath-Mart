/**
 * Image Hosts Configuration (add your image hosts here).
 *
 * Used as `images.remotePatterns` in next.config.mjs. The Supabase storage
 * host is derived from NEXT_PUBLIC_SUPABASE_URL at config time so we never
 * hardcode the project id in source.
 */

const supabaseHostname = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
})();

const baseHosts = [
  { protocol: 'https', hostname: 'images.unsplash.com' },
  { protocol: 'https', hostname: 'images.pexels.com' },
  { protocol: 'https', hostname: 'images.pixabay.com' },
  { protocol: 'https', hostname: 'img.rocket.new' },
];

const supabaseHosts = supabaseHostname
  ? [
      // Public objects served by Supabase Storage live under
      //   https://<project>.supabase.co/storage/v1/object/public/...
      // Adding the resolved hostname (no wildcard, single project only).
      { protocol: 'https', hostname: supabaseHostname },
    ]
  : [];

export const imageHosts = [...baseHosts, ...supabaseHosts];
