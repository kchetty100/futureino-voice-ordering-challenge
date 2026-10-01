import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  outputFileTracingIncludes: {
    "/images/[machine]/[file]": ["./images/**/*"],
    "/brand/[file]": ["./brand/**/*"],
  },
};

export default nextConfig;
