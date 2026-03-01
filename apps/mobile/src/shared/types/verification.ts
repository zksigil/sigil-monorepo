// Phase 3 types — one-address-per-passport architecture
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
