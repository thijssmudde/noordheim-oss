import type { NextConfig } from 'next';

// Discovery partners preview the game in an iframe; every other origin is
// refused. X-Frame-Options can't express an allowlist, so CSP carries it alone.
const FRAME_ANCESTORS = [
  "'self'",
  'https://buildhop.io',
  'https://www.buildhop.io',
  'https://freescan.app',
  'https://www.freescan.app',
].join(' ');

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: `frame-ancestors ${FRAME_ANCESTORS}`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
