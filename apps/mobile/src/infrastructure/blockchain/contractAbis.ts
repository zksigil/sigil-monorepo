/**
 * VerificationRegistry ABI
 *
 * Matches the IVerificationRegistry interface exactly.
 * IMPORTANT: Update this ABI whenever the contract interface changes.
 */
export const VERIFICATION_REGISTRY_ABI = [
  // --- Write functions ---
  {
    type: 'function',
    name: 'register',
    inputs: [
      { name: 'zkProof', type: 'bytes', internalType: 'bytes' },
      { name: 'nullifier', type: 'bytes32', internalType: 'bytes32' },
      { name: 'semaphoreIdentityCommitment', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'unregister',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // --- Read functions ---
  {
    type: 'function',
    name: 'isVerified',
    inputs: [{ name: 'wallet', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getWalletInfo',
    inputs: [{ name: 'wallet', type: 'address', internalType: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct IVerificationRegistry.WalletInfo',
        components: [
          { name: 'verified', type: 'bool', internalType: 'bool' },
          { name: 'previouslyUnregistered', type: 'bool', internalType: 'bool' },
          { name: 'groupSizeAtVerification', type: 'uint256', internalType: 'uint256' },
          { name: 'verifiedAt', type: 'uint256', internalType: 'uint256' },
          { name: 'identityCommitment', type: 'uint256', internalType: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getNullifierInfo',
    inputs: [{ name: 'nullifier', type: 'bytes32', internalType: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct IVerificationRegistry.NullifierInfo',
        components: [
          { name: 'currentCount', type: 'uint256', internalType: 'uint256' },
          { name: 'currentCountSince', type: 'uint256', internalType: 'uint256' },
          { name: 'peakCount', type: 'uint256', internalType: 'uint256' },
          { name: 'peakCountAchieved', type: 'uint256', internalType: 'uint256' },
          { name: 'peakCountSince', type: 'uint256', internalType: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getGroupSize',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },

  // --- Events ---
  {
    type: 'event',
    name: 'WalletRegistered',
    inputs: [
      { name: 'wallet', type: 'address', indexed: true, internalType: 'address' },
      { name: 'nullifier', type: 'bytes32', indexed: true, internalType: 'bytes32' },
      { name: 'groupSize', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'timestamp', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'WalletUnregistered',
    inputs: [
      { name: 'wallet', type: 'address', indexed: true, internalType: 'address' },
      { name: 'nullifier', type: 'bytes32', indexed: true, internalType: 'bytes32' },
      { name: 'newGroupSize', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'timestamp', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },
] as const;
