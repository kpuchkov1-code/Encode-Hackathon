import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this app dir. A stray package-lock.json in the home
  // directory otherwise makes Next infer the wrong root.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Hide the Next.js dev-mode indicator (the floating circle in the bottom-left
  // corner). It only ever renders during `next dev`, never in production.
  devIndicators: false,
};

export default nextConfig;
