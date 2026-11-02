import path from 'node:path';
import type { NextConfig } from 'next';

const backendUrl = process.env.MEHTA_API_URL || 'http://127.0.0.1:3000';
const parsedBackendUrl = new URL(backendUrl);
if (!['http:', 'https:'].includes(parsedBackendUrl.protocol) || parsedBackendUrl.pathname !== '/' || parsedBackendUrl.search || parsedBackendUrl.hash || parsedBackendUrl.username || parsedBackendUrl.password) {
  throw new Error('MEHTA_API_URL must be an HTTP(S) origin without credentials, path, query, or fragment.');
}

const nextConfig: NextConfig = {
  agentRules: false,
  // Verification builds use a separate directory so they never disturb a running dev server.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  // The repository root, so the shared quotation maths in /public can be imported (and the ambient pnpm-workspace is ignored).
  turbopack: { root: path.resolve(process.cwd(), '../..') },
  async rewrites() {
    // The combined server dispatches API requests directly. An explicit origin
    // remains available for isolated UI verification builds only.
    return process.env.MEHTA_API_URL ? [{ source: '/api/:path*', destination: `${parsedBackendUrl.origin}/api/:path*` }] : [];
  }
};

export default nextConfig;
