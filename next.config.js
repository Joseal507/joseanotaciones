/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  // El límite real para App Router API routes se maneja en el servidor
  // Vercel tiene límite de 4.5MB en el plan free para request body
  // Para PDFs grandes usamos R2 directamente desde el cliente


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