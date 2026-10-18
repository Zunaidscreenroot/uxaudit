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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://ux-direct.zunaid-cb7.workers.dev",
          },
        ],
      },
    ];
  },
  experimental: {
    // Externalize Chromium so Next/Webpack preserves the package's runtime path.
    serverComponentsExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
    // The .br binaries are loaded by filesystem path, so file tracing may not
    // discover them automatically. Include them in functions that capture screenshots.
    outputFileTracingIncludes: {
      "/api/capture-url": [
        "./node_modules/@sparticuz/chromium/bin/**/*",
      ],
      "/api/mcp": [
        "./node_modules/@sparticuz/chromium/bin/**/*",
      ],
    },
  },
  webpack(config, { isServer }) {
    if (isServer) {
      // Keep an explicit Webpack external rule in addition to Next's external-package
      // setting; Chromium resolves its compressed runtime assets relative to node_modules.
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
