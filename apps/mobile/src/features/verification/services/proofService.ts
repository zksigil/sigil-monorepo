/**
 * Stub ZK proof generation service.
 *
 * In production (Phase 3), this will call a Noir circuit via Mopro SDK.
 * The stub derives passportNullifier = keccak256(rawDG1Hex || rawSODHex).
 * Real Phase 3: Poseidon(SHA256(DG1), SHA256(SOD)) via Mopro/Noir.
 *
 * Passport data NEVER leaves the device.
 */

import { keccak256, encodePacked, type Hex } from 'viem';
import type { ZKProof } from '../../../shared/types/verification';

export interface ProofInput {
  rawDG1Hex: string;               // hex-encoded DG1 bytes from NFC
  rawSODHex: string;               // hex-encoded SOD bytes from NFC
  walletAddress: `0x${string}`;
}

export interface ProofOutput {
  zkProof: ZKProof;
  passportNullifierHex: `0x${string}`;
}

/**
 * Generate a stub ZK proof from raw passport data + wallet address.
 *
 * The passportNullifier is derived from DG1 + SOD so the same passport
 * always produces the same nullifier (preventing double-registration).
 *
 * The actual proof bytes are all zeros — a real verifier would reject this.
 * This is replaced with real Noir/Mopro circuit output in Phase 3.
 */
export function generateStubProof(input: ProofInput): ProofOutput {
  const dg1Hex = (input.rawDG1Hex.startsWith('0x') ? input.rawDG1Hex : `0x${input.rawDG1Hex}`) as Hex;
  const sodHex = (input.rawSODHex.startsWith('0x') ? input.rawSODHex : `0x${input.rawSODHex}`) as Hex;

  // Stub: passportNullifier = keccak256(rawDG1Hex || rawSODHex)
  // Real Phase 3: Poseidon(SHA256(DG1), SHA256(SOD)) via Mopro/Noir
  const passportNullifier = keccak256(
    encodePacked(['bytes', 'bytes'], [dg1Hex, sodHex]),
  );

  const walletAddressBigInt = BigInt(input.walletAddress);
  const passportNullifierBigInt = BigInt(passportNullifier);

  // Stub Groth16 proof: a[2] + b[2][2] + c[2] = 8 uint256 values = 256 bytes
  // Using 320 bytes to match the ABI encoding format with padding
  const zkProofBytes = ('0x' + '00'.repeat(320)) as `0x${string}`;

  const result: ProofOutput = {
    zkProof: {
      proof: zkProofBytes,
      passportNullifier,
      publicSignals: [passportNullifierBigInt, walletAddressBigInt] as const,
    },
    passportNullifierHex: passportNullifier,
  };

  console.log('[PROOF] === ZK Proof Debug Info ===');
  console.log('[PROOF] Wallet Address:', input.walletAddress);
  console.log('[PROOF] DG1 Hex (first 32 chars):', dg1Hex.slice(0, 34) + '...');
  console.log('[PROOF] SOD Hex (first 32 chars):', sodHex.slice(0, 34) + '...');
  console.log('[PROOF] Passport Nullifier:', passportNullifier);
  console.log('[PROOF] Public Signals:', `[${passportNullifierBigInt}, ${walletAddressBigInt}]`);
  console.log('[PROOF] ZK Proof (first 64 bytes):', zkProofBytes.slice(0, 66) + '...');
  console.log('[PROOF] === End ZK Proof Debug Info ===');

  return result;
}
