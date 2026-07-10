import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const browserEmptyModule = './lib/browser-empty.ts';
const libsodiumCommonJs =
  './node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js';

/** @type {import('next').NextConfig} */
const nextConfig = {
  compress: true, // Enable gzip compression for API responses
  typescript: {
    ignoreBuildErrors: false, // Keep type checking
  },
  // Mark server-only packages as external (prevents bundling for browser)
  serverExternalPackages: [
    'pg',
    'pg-native',
    'onnxruntime-node',
    'sharp',
    'alchemy-sdk',
    '@ethersproject/web',
    '@ethersproject/providers',
  ],
  experimental: {
    optimizePackageImports: ["react", "react-dom", "viem", "react-markdown"],
  },
  turbopack: {
    root: __dirname,
    resolveAlias: {
      '@react-native-async-storage/async-storage': browserEmptyModule,
      'libsodium-wrappers-sumo': libsodiumCommonJs,
      'pino-pretty': { browser: browserEmptyModule },
      fs: { browser: browserEmptyModule },
      path: { browser: browserEmptyModule },
      crypto: { browser: 'crypto-browserify' },
      worker_threads: { browser: browserEmptyModule },
      stream: { browser: browserEmptyModule },
      os: { browser: browserEmptyModule },
      util: { browser: browserEmptyModule },
      assert: { browser: browserEmptyModule },
      dns: { browser: browserEmptyModule },
      net: { browser: browserEmptyModule },
      tls: { browser: browserEmptyModule },
    },
  },
  async rewrites() {
    return [
      {
        source: '/favicon.ico',
        destination: '/icon.svg',
      },
    ];
  },
};

export default nextConfig;
