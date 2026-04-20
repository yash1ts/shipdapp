/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      crypto: false,
    };
    config.externals = [...(config.externals || []), 'pino-pretty', 'encoding'];
    return config;
  },
};

module.exports = nextConfig;
