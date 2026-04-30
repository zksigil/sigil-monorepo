// Phase 4 — single-tier sigil ZK proof type.

/** Sigil proof: links a wallet to a passport via a deterministic per-passport nullifier. */
export interface SigilZKProof {
  /** UltraHonk-Keccak proof bytes (hex). */
  proof: `0x${string}`;
  /** Verification key bytes (hex). */
  vk: `0x${string}`;
  /** Stable per-passport nullifier - sent on-chain as the wallet's identity. */
  nullifier: string;
  /** Daily epoch nullifier - sent on-chain for rate limiting. */
  epochNullifier: string;
  /** keccak256(wallet) mod BN254 as decimal - public input to the proof. */
  hashedAddress: string;
  /** Passport expiry as unix epoch seconds - submitted separately to the contract. */
  passportExpiry: string;
  /** CSCA Merkle root (hex) - binds proof to the current ICAO Master List. */
  cscaMerkleRoot: `0x${string}`;
}

/** Legacy type kept for backward compatibility with Phase 2 stub code. */
export interface ZKProof {
  proof: `0x${string}`;
  passportNullifier: `0x${string}`;
  publicSignals: readonly [bigint, bigint];
}

export type VerificationStatus =
  | 'unverified'
  | 'pending_scan'
  | 'generating_proof'
  | 'submitting'
  | 'verified'
  | 'failed';
