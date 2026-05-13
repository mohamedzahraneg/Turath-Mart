import { imageHosts } from './image-hosts.config.mjs';
/** @type {import('next').NextConfig} */
const nextConfig = {
  productionBrowserSourceMaps: false, // disabled for faster builds & smaller bundles
  // Phase 16: removed `output: 'standalone'`. Production runs via `next start`
  // (PM2 process turath-mart-main → `npm start`), so the standalone artifact
  // was dead output and Next.js logged "this config requires
  // node .next/standalone/server.js" on every request boot. The default
  // build (regular `.next/`) is what the running site actually serves.
  distDir: process.env.DIST_DIR || '.next',
  // TypeScript and ESLint now run during build.
  // Re-enabled in Phase 6 after typecheck reached 0 errors and lint reached
  // 0 errors (warnings remain visible but do not block the build).
  // If a future change re-introduces type errors or eslint errors, the build
  // will fail on purpose — DO NOT silence them by re-enabling these flags.
  // Compress responses
  compress: true,
  // Optimize images
  images: {
    remotePatterns: imageHosts,
    minimumCacheTTL: 3600, // cache images for 1 hour (was 60s)
    formats: ['image/avif', 'image/webp'],
  },
  // Optimize package imports to reduce bundle size
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  // Cache headers for static assets
  async headers() {
    return [
      {
        source: '/_next/static/(.*)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/((?!api|_next/static|_next/image|favicon.ico|assets|images).*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate, max-age=0',
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: '/sign-up-login-screen',
        permanent: false,
      },
    ];
  },
};
export default nextConfig;
