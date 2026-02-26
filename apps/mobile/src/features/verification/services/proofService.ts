/**
 * Stub ZK proof generation service.
 *
 * In production, this will call a real Groth16 circuit (e.g., zkPassport).
 * For Phase 2, we generate deterministic stub proofs using keccak256.
 *
 * Passport data NEVER leaves the device.
 */

import { keccak256, encodePacked } from 'viem';
import type { ZKProof } from '../../../shared/types/verification';

export interface ProofInput {
  documentNumber: string;
  dateOfBirth: string;
  dateOfExpiry: string;
  nationality: string;
  walletAddress: `0x${string}`;
}

export interface ProofOutput {
  zkProof: ZKProof;
  nullifierHex: `0x${string}`;
  commitmentDecimal: string;
}

/**
 * Generate a stub ZK proof from passport + wallet data.
 *
 * The nullifier is derived from passport-unique fields so the same passport
 * always produces the same nullifier (preventing double-registration).
 * The semaphore identity commitment binds the nullifier to a specific wallet.
 *
 * The actual proof bytes are all zeros — a real Groth16 verifier would reject this.
 * This is replaced with real circuit output in Phase 3.
 */
export function generateStubProof(input: ProofInput): ProofOutput {
  // nullifier = keccak256(documentNumber || dateOfBirth || dateOfExpiry)
  const nullifier = keccak256(
    encodePacked(
      ['string', 'string', 'string'],
      [input.documentNumber, input.dateOfBirth, input.dateOfExpiry],
    ),
  );

  // semaphoreIdentityCommitment = keccak256(nullifier || walletAddress)
  const commitmentBytes = keccak256(
    encodePacked(['bytes32', 'address'], [nullifier, input.walletAddress]),
  );
  const commitment = BigInt(commitmentBytes);

  // Stub Groth16 proof: a[2] + b[2][2] + c[2] = 8 uint256 values = 256 bytes
  // Using 320 bytes to match the ABI encoding format with padding
  const zkProofBytes = ('0x' + '00'.repeat(320)) as `0x${string}`;

  const result: ProofOutput = {
    zkProof: {
      proof: zkProofBytes,
      nullifier,
      semaphoreIdentityCommitment: commitment,
    },
    nullifierHex: nullifier,
    commitmentDecimal: commitment.toString(10),
  };

  console.log('[PROOF] === ZK Proof Debug Info ===');
  console.log('[PROOF] Wallet Address:', input.walletAddress);
  console.log('[PROOF] Document Number:', input.documentNumber);
  console.log('[PROOF] Nullifier:', nullifier);
  console.log('[PROOF] Semaphore Commitment (hex):', commitmentBytes);
  console.log('[PROOF] Semaphore Commitment (dec):', commitment.toString(10));
  console.log('[PROOF] ZK Proof (first 64 bytes):', zkProofBytes.slice(0, 66) + '...');
  console.log('[PROOF] === End ZK Proof Debug Info ===');

  return result;
}
