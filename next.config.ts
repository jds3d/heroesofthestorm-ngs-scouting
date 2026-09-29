import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Replay decoder loads protocol files from disk by build number.
  serverExternalPackages: ["hots-parser", "heroprotocol"],
  outputFileTracingIncludes: {
    "/api/review/*": ["./node_modules/heroprotocol/lib/**/*"],
  },
};

export default nextConfig;
