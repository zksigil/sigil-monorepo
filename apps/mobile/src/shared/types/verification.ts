// Phase 3 types — two-tier ZK proof architecture (UltraHonk-Keccak)

/** Base-tier proof: proof of personhood, fully unlinkable. */
export interface BaseZKProof {
  /** UltraHonk-Keccak proof bytes (hex). */
  proof: `0x${string}`;
  /** Verification key bytes (hex). */
  vk: `0x${string}`;
  /** epoch_nullifier as decimal field element — used on-chain for rate limiting. */
  epochNullifier: string;
  /** keccak256(wallet) mod BN254 as decimal — public input to the proof. */
  hashedAddress: string;
  /** Passport expiry as a unix epoch day (public input). */
  passportExpiry: string;
}

/** Primary-tier proof: sybil resistance via global nullifier chaining. */
export interface PrimaryZKProof {
  /** UltraHonk-Keccak proof bytes (hex). */
  proof: `0x${string}`;
  /** Verification key bytes (hex). */
  vk: `0x${string}`;
  /** nullifier = Poseidon2([s, nonce]) — global sybil-resistance key. */
  nullifier: string;
  /** nextCommitment = Poseidon2([Poseidon2([s, nonce+1])]) — for chained updates. */
  nextCommitment: string;
  /** keccak256(wallet) mod BN254 as decimal (public input). */
  hashedAddress: string;
  /** Passport expiry as a unix epoch day (public input). */
  passportExpiry: string;
}

/** Legacy type kept for backward compatibility with Phase 2 stub code. */
export interface ZKProof {
  proof: `0x${string}`;
  passportNullifier: `0x${string}`;  // Poseidon(passportSecret) — 32 bytes
  publicSignals: readonly [bigint, bigint];  // [passportNullifier, walletAddress]
}

export type VerificationStatus =
  | 'unverified'
  | 'pending_scan'
  | 'generating_proof'
  | 'submitting'
  | 'verified'
  | 'failed';
