/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  output: "standalone",
  turbopack: { moduleIds: "named" }
};

export default nextConfig;
