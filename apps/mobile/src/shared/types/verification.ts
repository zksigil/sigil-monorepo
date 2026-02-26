// Phase 2 types — stubs so infrastructure layer can reference them now
export interface ZKProof {
  proof: `0x${string}`;
  nullifier: `0x${string}`;
  semaphoreIdentityCommitment: bigint;
}

export type VerificationStatus =
  | 'unverified'
  | 'pending_scan'
  | 'generating_proof'
  | 'submitting'
  | 'verified'
  | 'failed';
