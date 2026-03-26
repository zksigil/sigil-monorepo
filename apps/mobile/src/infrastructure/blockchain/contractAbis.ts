/**
 * VerificationRegistry ABI
 *
 * Matches the IVerificationRegistry Phase 3 two-tier interface.
 * IMPORTANT: Update this ABI whenever the contract interface changes.
 */
export const VERIFICATION_REGISTRY_ABI = [
  // --- Base Tier ---
  {
    type: 'function',
    name: 'registerBase',
    inputs: [
      { name: 'epochNullifier', type: 'bytes32', internalType: 'bytes32' },
      { name: 'passportExpiry', type: 'uint48', internalType: 'uint48' },
      { name: 'proof', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'renewBase',
    inputs: [
      { name: 'passportExpiry', type: 'uint48', internalType: 'uint48' },
      { name: 'proof', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // --- Primary Tier ---
  {
    type: 'function',
    name: 'registerPrimary',
    inputs: [
      { name: 'nullifier', type: 'bytes32', internalType: 'bytes32' },
      { name: 'nextCommitment', type: 'bytes32', internalType: 'bytes32' },
      { name: 'passportExpiry', type: 'uint48', internalType: 'uint48' },
      { name: 'proof', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'renewPrimary',
    inputs: [
      { name: 'nullifier', type: 'bytes32', internalType: 'bytes32' },
      { name: 'passportExpiry', type: 'uint48', internalType: 'uint48' },
      { name: 'proof', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'changePrimary',
    inputs: [
      { name: 'revealedNextNullifier', type: 'bytes32', internalType: 'bytes32' },
      { name: 'newNextCommitment', type: 'bytes32', internalType: 'bytes32' },
      { name: 'passportExpiry', type: 'uint48', internalType: 'uint48' },
      { name: 'proof', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'unregisterPrimary',
    inputs: [
      { name: 'nullifier', type: 'bytes32', internalType: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'unregisterBase',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // --- Protocol Integration (read) ---
  {
    type: 'function',
    name: 'isVerified',
    inputs: [{ name: 'wallet', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isPrimaryVerified',
    inputs: [{ name: 'wallet', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getBaseExpiry',
    inputs: [{ name: 'wallet', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'uint48', internalType: 'uint48' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPrimaryExpiry',
    inputs: [{ name: 'wallet', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'uint48', internalType: 'uint48' }],
    stateMutability: 'view',
  },

  // --- Events ---
  {
    type: 'event',
    name: 'WalletVerified',
    inputs: [
      { name: 'wallet', type: 'address', indexed: true, internalType: 'address' },
    ],
    anonymous: false,
  },
] as const;
