/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // ✅ Excluir pdfjs-dist del bundle del servidor
      // para que Node.js lo cargue directamente sin webpack
      config.externals = config.externals || [];
      config.externals.push('pdfjs-dist');
      config.externals.push('canvas');
    } else {
      config.resolve.alias.canvas = false;
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        stream: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;