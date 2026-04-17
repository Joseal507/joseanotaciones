/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  webpack: (config) => {
    config.resolve.alias['pdfjs-dist'] = false;
    return config;
  },
};

module.exports = nextConfig;