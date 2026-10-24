import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // A lobby frame is a few megabytes. The proxy otherwise keeps only the first 10MB.
    proxyClientMaxBodySize: "20mb",
  },
  // Replay decoder loads protocol files from disk by build number.
  serverExternalPackages: ["hots-parser", "heroprotocol"],
  outputFileTracingIncludes: {
    "/api/review/*": ["./node_modules/heroprotocol/lib/**/*"],
  },
};

export default nextConfig;
