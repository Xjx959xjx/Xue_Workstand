const devWatchIgnorePatterns = [
  "**/.git/**",
  "**/.next/**",
  "**/node_modules/**",
  "**/style-library/**",
  "**/.dev-server/**",
  "**/output/**",
  "**/dist/**",
  "**/coverage/**",
  "**/.playwright-cli/**"
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  output: "standalone",
  webpack(config, { dev }) {
    if (!dev) return config;

    config.watchOptions = {
      ...config.watchOptions,
      ignored: devWatchIgnorePatterns
    };

    return config;
  }
};

export default nextConfig;
