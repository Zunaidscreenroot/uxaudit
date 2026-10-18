/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/.well-known/oauth-authorization-server",
          destination: "/api/mcp/oauth/metadata/authorization-server",
        },
        {
          source: "/.well-known/oauth-protected-resource/api/mcp",
          destination: "/api/mcp/oauth/metadata/protected-resource",
        },
        {
          source: "/.well-known/oauth-protected-resource",
          destination: "/api/mcp/oauth/metadata/protected-resource",
        },
      ],
    };
  },
  // Next.js 15 moved these settings out of "experimental".
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/capture-url": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
    ],
    "/api/mcp": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
    ],
  },
  webpack(config, { isServer }) {
    if (isServer) {
      // Preserve these packages as runtime externals for server-side routes.
      const externals = Array.isArray(config.externals)
        ? config.externals
        : config.externals
          ? [config.externals]
          : [];
      externals.push("@sparticuz/chromium", "puppeteer-core");
      config.externals = externals;
    }
    return config;
  },
};

module.exports = nextConfig;
