import { useCallback, useState } from 'react';
import {
  generateBaseProof,
  generatePrimaryProof,
  generateStubProof,
  type ProofInput,
  type BaseProofOutput,
  type PrimaryProofOutput,
  type ProofOutput,
} from '../services/proofService';
import type { VerificationTier } from '../../../app/navigation/types';

export interface UseProofGenerationResult {
  generate: (input: ProofInput, tier: VerificationTier) => Promise<ProofOutput>;
  isGenerating: boolean;
  result: ProofOutput | null;
  error: string | null;
}

/**
 * Hook wrapping ZK proof generation for both tiers.
 *
 * Tries the real Mopro native module (UltraHonk-Keccak, ~5–15s on device).
 * Falls back to a stub proof if the native module is unavailable (development).
 */
export function useProofGeneration(): UseProofGenerationResult {
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<ProofOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (input: ProofInput, tier: VerificationTier): Promise<ProofOutput> => {
    setIsGenerating(true);
    setError(null);
    setResult(null);

    // Map user-facing tier to contract-level tier
    const isPrimary = tier === 'unique';

    try {
      if (!input.walletAddress || !input.walletAddress.startsWith('0x')) {
        throw new Error('Invalid wallet address');
      }
      if (!input.rawDG1Hex) {
        throw new Error('Raw DG1 data is required');
      }
      if (!input.rawSODHex) {
        throw new Error('Raw SOD data is required');
      }

      let proofOutput: ProofOutput;

      try {
        proofOutput = isPrimary
          ? await generatePrimaryProof(input)
          : await generateBaseProof(input);
      } catch (moproErr) {
        const innerMsg = (moproErr != null && typeof moproErr === 'object' && 'inner' in moproErr && Array.isArray((moproErr as { inner: unknown[] }).inner))
          ? String((moproErr as { inner: unknown[] }).inner[0])
          : null;
        const msg = innerMsg ?? (moproErr instanceof Error ? moproErr.message : '');
        if (
          msg.includes('Mopro native module not available') ||
          msg.includes('circuit path not set') ||
          msg.includes('Incompatible versions of uniffi') ||
          msg.includes('ContractVersionMismatch')
        ) {
          // Development fallback: stub proof (not verifiable on-chain)
          console.warn('[PROOF] Mopro unavailable — using stub proof for development');
          const stub = generateStubProof(input);

          if (isPrimary) {
            // Stub primary: derive deterministic nullifier + nextCommitment from the stub nullifier
            const stubNullifier = stub.passportNullifierHex;
            // nextCommitment is a second keccak of the nullifier (mirrors circuit chaining logic)
            const { keccak256 } = await import('viem');
            const nextCommitment = keccak256(stubNullifier);
            proofOutput = {
              type: 'primary',
              zkProof: {
                proof: stub.zkProof.proof,
                vk: ('0x' + '00'.repeat(32)) as `0x${string}`,
                nullifier: stubNullifier,
                nextCommitment,
                hashedAddress: stub.zkProof.publicSignals[1].toString(),
                passportExpiry: (input.passportExpiryUnix ?? 0).toString(),
              },
              nullifier: stubNullifier,
              nextCommitment,
            } satisfies PrimaryProofOutput;
          } else {
            proofOutput = {
              type: 'base',
              zkProof: {
                proof: stub.zkProof.proof,
                vk: ('0x' + '00'.repeat(32)) as `0x${string}`,
                epochNullifier: stub.passportNullifierHex,
                hashedAddress: stub.zkProof.publicSignals[1].toString(),
                passportExpiry: (input.passportExpiryUnix ?? 0).toString(),
              },
              epochNullifier: stub.passportNullifierHex,
            } satisfies BaseProofOutput;
          }
        } else {
          throw moproErr;
        }
      }

      setResult(proofOutput);
      return proofOutput;
    } catch (err) {
      const innerMsg = (err != null && typeof err === 'object' && 'inner' in err && Array.isArray((err as { inner: unknown[] }).inner))
        ? String((err as { inner: unknown[] }).inner[0])
        : null;
      const message = innerMsg ?? (err instanceof Error ? err.message : 'Proof generation failed');
      console.error('[PROOF] Generation error:', message);
      setError(message);
      throw err;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  return { generate, isGenerating, result, error };
}
