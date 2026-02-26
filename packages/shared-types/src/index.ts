// Verification types (mirror of contract structs)

/** Mirrors the Solidity WalletInfo struct in IVerificationRegistry. */
export interface WalletInfo {
  verified: boolean;
  previouslyUnregistered: boolean;
  groupSizeAtVerification: bigint;
  verifiedAt: bigint;
  identityCommitment: bigint;
}

/** Mirrors the Solidity WalletRecord struct (internal bookkeeping). */
export interface WalletRecord {
  nullifier: `0x${string}`;
  active: boolean;
}

/** Mirrors the Solidity NullifierInfo struct in IVerificationRegistry. */
export interface NullifierInfo {
  currentCount: bigint;
  currentCountSince: bigint;
  peakCount: bigint;
  peakCountAchieved: bigint;
  peakCountSince: bigint;
}

/** Contract addresses indexed by chain ID. */
export interface ContractAddresses {
  verificationRegistry: `0x${string}`;
}

// ZK Proof types
export interface ZKProofInputs {
  walletAddress: `0x${string}`;
  passportDataHash: `0x${string}`;
  nullifier: `0x${string}`;
  semaphoreCommitment: bigint;
}

export type VerificationPhase =
  | 'idle'
  | 'nfc_scanning'
  | 'proof_generation'
  | 'tx_confirmation'
  | 'complete'
  | 'error';

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  verificationRegistryAddress: `0x${string}`;
}
