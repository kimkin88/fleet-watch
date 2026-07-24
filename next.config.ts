import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  async redirects() {
    return [
      { source: "/index.html", destination: "/dashboard", permanent: true },
      { source: "/landing.html", destination: "/", permanent: true },
      { source: "/network-insights.html", destination: "/network-insights", permanent: true },
      { source: "/api-proof.html", destination: "/api-proof", permanent: true },
      { source: "/campaign-audit.html", destination: "/campaign-audit", permanent: true },
    ];
  },
};

export default nextConfig;
