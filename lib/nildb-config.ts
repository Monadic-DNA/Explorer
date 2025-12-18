// nilDB Mainnet Configuration
// Hard-coded per user request - no env vars needed

export const NILDB_CONFIG = {
  // Collection ID for degen score submissions
  collectionId: '87ca35ac-a81f-4f03-b466-082a8096dc68',

  // Mainnet URLs
  nilchainUrl: 'http://nilchain-rpc.nillion.network',
  nilauthUrl: 'https://nilauth-cf7f.nillion.network',
  nilauthPublicKey: '020b419e17d0d11445ea46520086952772eb18f5cb9f949c0ad0b418282617cf7f',

  // nilDB Mainnet Nodes
  nodes: [
    'https://nildb-5ab1.nillion.network',
    'https://nildb-f496.pairpointweb3.io',
    'https://nildb-f375.stcbahrain.net'
  ]
} as const;
