import { imageHosts } from './image-hosts.config.mjs';
/** @type {import('next').NextConfig} */
const nextConfig = {
  productionBrowserSourceMaps: false, // disabled for faster builds & smaller bundles
  output: 'standalone',
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
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
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
