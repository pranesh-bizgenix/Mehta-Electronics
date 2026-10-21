import type { NextConfig } from 'next';

const backendUrl = process.env.MEHTA_API_URL || 'http://127.0.0.1:3000';
const parsedBackendUrl = new URL(backendUrl);
if (!['http:', 'https:'].includes(parsedBackendUrl.protocol) || parsedBackendUrl.pathname !== '/' || parsedBackendUrl.search || parsedBackendUrl.hash || parsedBackendUrl.username || parsedBackendUrl.password) {
  throw new Error('MEHTA_API_URL must be an HTTP(S) origin without credentials, path, query, or fragment.');
}

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${parsedBackendUrl.origin}/api/:path*` }];
  }
};

export default nextConfig;
