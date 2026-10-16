/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Chromium uses runtime-resolved files relative to its installed package.
    // Externalize it so Next/Webpack does not relocate its runtime path.
    serverComponentsExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
    // Vercel's output-file tracer can omit the Brotli-compressed browser payload
    // because it is loaded by path rather than imported. Include it in this API
    // function's serverless bundle so executablePath() can extract it at runtime.
    outputFileTracingIncludes: {
      "/api/capture-url": [
        "./node_modules/@sparticuz/chromium/bin/**/*",
      ],
    },
  },
};

module.exports = nextConfig;
