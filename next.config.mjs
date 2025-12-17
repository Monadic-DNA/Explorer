import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  compress: true, // Enable gzip compression for API responses
  eslint: {
    ignoreDuringBuilds: false, // Keep linting during builds but don't fail on warnings
  },
  typescript: {
    ignoreBuildErrors: false, // Keep type checking
  },
  experimental: {
    optimizePackageImports: ["react", "react-dom", "viem", "react-markdown"],
    serverComponentsExternalPackages: ['onnxruntime-node', 'sharp', 'alchemy-sdk', '@ethersproject/web', '@ethersproject/providers']
  },
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

    // Ignore React Native dependencies in MetaMask SDK (for both client and server)
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': false,
    };

    // Fix sql.js Node.js polyfills for browser-only usage
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
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
