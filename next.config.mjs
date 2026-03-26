import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  compress: true, // Enable gzip compression for API responses
  typescript: {
    ignoreBuildErrors: false, // Keep type checking
  },
  // Turbopack disabled - doesn't support complex polyfills needed for Nillion packages
  // Issue: Can't properly alias libsodium-wrappers-sumo relative imports
  // Will re-enable when Turbopack adds better resolve.fallback support
  // Mark server-only packages as external (prevents bundling for browser)
  // Nillion packages removed - need webpack bundling to apply libsodium alias
  serverExternalPackages: [
    'onnxruntime-node',
    'sharp',
    'alchemy-sdk',
    '@ethersproject/web',
    '@ethersproject/providers',
  ],
  experimental: {
    optimizePackageImports: ["react", "react-dom", "viem", "react-markdown"],
  },
  // Transpile Nillion packages - removed because they're in serverExternalPackages
  async rewrites() {
    return [
      {
        source: '/favicon.ico',
        destination: '/icon.svg',
      },
    ];
  },
  webpack: (config, { isServer }) => {
    // Reduce file watching overhead - prevent watching parent directories
    config.watchOptions = {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/localdata/**',
        '**/.next/**',
      ],
      aggregateTimeout: 200,
      poll: 1000, // Enable polling for better compatibility on Linux
    };

    // Handle Nillion dependencies that are not compatible with webpack
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        "libsodium-wrappers-sumo": "commonjs libsodium-wrappers-sumo",
        "@nillion/blindfold": "commonjs @nillion/blindfold",
      });
    }

    // Ignore React Native dependencies in MetaMask SDK (for both client and server)
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': false,
      // Fix libsodium-wrappers-sumo ESM issue - use CommonJS build
      'libsodium-wrappers-sumo': path.resolve(__dirname, 'node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js'),
    };

    // Stub out pino-pretty for client-side to prevent Node.js dependencies
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'pino-pretty': false,
      };
    }

    // Fix sql.js Node.js polyfills for browser-only usage
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        worker_threads: false,
        stream: false,
        os: false,
        util: false,
        assert: false,
        'pino-pretty': false,
      };
    }

    // Exclude native .node binaries from client bundle
    config.externals = config.externals || [];
    if (!isServer) {
      config.externals.push({
        'onnxruntime-node': 'commonjs onnxruntime-node',
        'sharp': 'commonjs sharp',
      });
    } else {
      // For server, mark sharp as external so it uses the actual installed module
      config.externals.push('sharp');
    }

    // Ignore .node files in webpack processing
    config.module = config.module || {};
    config.module.rules = config.module.rules || [];
    config.module.rules.push({
      test: /\.node$/,
      loader: 'node-loader',
    });

    return config;
  },
};

export default nextConfig;
