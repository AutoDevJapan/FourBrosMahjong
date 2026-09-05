import type { NextConfig } from "next";
import {
  STATIC_SECURITY_HEADERS,
  SVG_CONTENT_SECURITY_POLICY,
} from "./src/app/_lib/securityHeaders";

const nextConfig: NextConfig = {
  // `AGENTS.md` is shared across projects and must remain read-only here.
  agentRules: false,
  async headers() {
    return [
      {
        // SVG can contain active content when opened as a top-level document.
        // Use a fixed policy here rather than the HTML nonce proxy so tile
        // artwork remains cacheable.
        source: "/:path*.svg",
        headers: [
          {
            key: "Content-Security-Policy",
            value: SVG_CONTENT_SECURITY_POLICY,
          },
          ...Object.entries(STATIC_SECURITY_HEADERS).map(([key, value]) => ({
            key,
            value,
          })),
        ],
      },
    ];
  },
};

export default nextConfig;
