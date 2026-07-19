import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray lockfile above the repo confuses workspace-root inference.
  turbopack: { root: __dirname },
};

export default nextConfig;
