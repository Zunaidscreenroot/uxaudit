/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Keep Chromium's runtime binary resources external rather than webpack-bundling them.
    serverComponentsExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  },
};

module.exports = nextConfig;
