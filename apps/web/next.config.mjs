const apiBase = process.env.API_BASE ?? 'http://localhost:3000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/v1/:path*',
        destination: `${apiBase}/v1/:path*`,
      },
      {
        source: '/health',
        destination: `${apiBase}/health`,
      },
    ];
  },
};

export default nextConfig;
