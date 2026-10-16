/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Externalize Chromium so Next/Webpack preserves the package's runtime path.
    serverComponentsExternalPackages: ["@sparticuz/chromium", "playwright-core"],
    // The .br binaries are loaded by filesystem path, so file tracing may not
    // discover them automatically. Include them in the screenshot API function.
    outputFileTracingIncludes: {
      "/api/capture-url": [
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
      externals.push("@sparticuz/chromium", "playwright-core");
      config.externals = externals;
    }
    return config;
  },
};

module.exports = nextConfig;
